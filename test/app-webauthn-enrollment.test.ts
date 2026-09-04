import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { verifyRegistrationResponse } = vi.hoisted(() => ({
  verifyRegistrationResponse: vi.fn(),
}))

vi.mock('@simplewebauthn/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simplewebauthn/server')>()
  return {
    ...actual,
    verifyRegistrationResponse,
  }
})

import app from '../src/app'
import { signAccessToken } from '../src/domain/tokens'
import { webAuthnPrfStatusCode } from '../src/domain/webauthn-registration'
import { FakeD1Database, requiredTables } from './support/fake-d1'

const tokenSecret = 'test-token-secret'
const publicKey = new Uint8Array([1, 2, 3, 4])
const encryptedTriple = {
  encryptedUserKey: '2.encrypted-user-key',
  encryptedPublicKey: '2.encrypted-public-key',
  encryptedPrivateKey: '2.encrypted-private-key',
}

describe('HON-210 WebAuthn enrollment', () => {
  afterEach(() => {
    vi.useRealTimers()
    verifyRegistrationResponse.mockReset()
  })

  beforeEach(() => {
    mockVerifiedRegistration()
  })

  it('fails closed with 501 when WebAuthn is disabled and does not advertise passkeys', async () => {
    const user = authUserRecord()
    const token = await recentPasswordAccessTokenFor(user)
    const env = requestEnv(user, { HONOWARDEN_WEBAUTHN_ENABLED: 'false' })

    for (const [method, path] of [
      ['GET', '/api/webauthn'],
      ['POST', '/api/webauthn/attestation-options'],
      ['POST', '/api/webauthn'],
    ] as const) {
      const init: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
      if (method !== 'GET') {
        init.body = '{}'
      }
      const response = await app.request(path, init, env)
      expect(response.status, `${method} ${path}`).toBe(501)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'unsupported_feature' },
      })
    }

    const config = await app.request('/api/config', {}, env)
    const body = (await config.json()) as {
      featureStates: Record<string, boolean>
    }
    expect(
      Object.keys(body.featureStates).some((key) =>
        /webauthn|passkey/i.test(key),
      ),
    ).toBe(false)
  })

  it('rejects refresh-authenticated registration options', async () => {
    const user = authUserRecord()
    const token = await refreshAccessTokenFor(user)
    const response = await app.request(
      '/api/webauthn/attestation-options',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
      requestEnv(user),
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'reauth_required' },
    })
  })

  it('issues official-shaped registration options with an exclude list', async () => {
    const user = authUserRecord()
    const token = await recentPasswordAccessTokenFor(user)
    const env = requestEnv(user, {
      webauthnCredentials: [storedCredential(user.id, 'existing-credential')],
    })
    const response = await app.request(
      '/api/webauthn/attestation-options',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ masterPasswordHash: user.masterPasswordHash }),
      },
      env,
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      object: string
      token: string
      options: {
        challenge: string
        attestation: string
        timeout: number
        rp: { id: string }
        authenticatorSelection: Record<string, unknown>
        excludeCredentials: Array<{ id: string }>
        extensions?: Record<string, unknown>
      }
    }
    expect(body.object).toBe('webauthnCredentialCreateOptions')
    expect(body.token.length).toBeGreaterThan(20)
    expect(body.options.rp.id).toBe('example.com')
    expect(body.options.attestation).toBe('none')
    expect(body.options.timeout).toBe(7 * 60 * 1000)
    expect(body.options.authenticatorSelection).toMatchObject({
      residentKey: 'required',
      userVerification: 'required',
    })
    expect(body.options.excludeCredentials.map((item) => item.id)).toContain(
      'existing-credential',
    )
    expect(body.options.extensions ?? {}).not.toHaveProperty('prf')
    expect(JSON.stringify(body)).not.toContain('public-key-bytes')
  })

  it('creates and lists an owner credential without leaking verifier material', async () => {
    const user = authUserRecord()
    const env = requestEnv(user)
    const created = await enrollCredential(env, user, {
      name: 'Laptop',
      supportsPrf: true,
      keys: encryptedTriple,
    })

    expect(created.status).toBe(200)
    expect(created.body).toMatchObject({
      object: 'webauthnCredential',
      name: 'Laptop',
      prfStatus: webAuthnPrfStatusCode.enabled,
      encryptedUserKey: encryptedTriple.encryptedUserKey,
      encryptedPublicKey: encryptedTriple.encryptedPublicKey,
    })
    expect(JSON.stringify(created.body)).not.toContain(
      'credential-from-authenticator',
    )
    expect(JSON.stringify(created.body)).not.toContain('public-key-bytes')
    expect(JSON.stringify(created.body)).not.toContain('aaguid')

    const listed = await app.request(
      '/api/webauthn',
      {
        headers: {
          Authorization: `Bearer ${await accessTokenFor(user)}`,
        },
      },
      env,
    )
    expect(listed.status).toBe(200)
    const listBody = (await listed.json()) as {
      object: string
      data: Array<Record<string, unknown>>
      continuationToken: null
    }
    expect(listBody.object).toBe('list')
    expect(listBody.data).toHaveLength(1)
    expect(listBody.data[0]).toMatchObject({
      object: 'webauthnCredential',
      name: 'Laptop',
      prfStatus: webAuthnPrfStatusCode.enabled,
    })
    expect(listBody.data[0]).not.toHaveProperty('credentialId')
    expect(listBody.data[0]).not.toHaveProperty('publicKey')
    expect(listBody.data[0]).not.toHaveProperty('aaguid')
    expect(listBody.data[0]).not.toHaveProperty('encryptedPrivateKey')
  })

  it('rejects a sixth credential and a duplicate without writing a row', async () => {
    const user = authUserRecord()
    const env = requestEnv(user, {
      webauthnCredentials: Array.from({ length: 5 }, (_, index) =>
        storedCredential(user.id, `seeded-${index}`, `row-${index}`),
      ),
    })
    const sixth = await enrollCredential(env, user, { name: 'Sixth' })
    expect(sixth.status).toBe(400)
    expect((env.DB as FakeD1Database).webauthnCredentials).toHaveLength(5)

    const isolated = requestEnv(user)
    const first = await enrollCredential(isolated, user, {
      name: 'First',
      credentialId: 'same-credential',
    })
    expect(first.status).toBe(200)
    mockVerifiedRegistration('same-credential')
    const duplicate = await enrollCredential(isolated, user, {
      name: 'Duplicate',
      credentialId: 'same-credential',
    })
    expect(duplicate.status).toBe(400)
    expect((isolated.DB as FakeD1Database).webauthnCredentials).toHaveLength(1)
  })

  it('rejects replayed, foreign, and malformed registration responses without partial writes', async () => {
    const user = authUserRecord()
    const env = requestEnv(user)
    const options = await issueOptions(env, user)
    const createBody = registrationBody(options.challenge, options.token)

    const first = await postCreate(env, user, createBody)
    expect(first.status).toBe(200)

    mockVerifiedRegistration('replayed-credential')
    const replay = await postCreate(env, user, createBody)
    expect(replay.status).toBe(400)

    const foreign = authUserRecord({
      id: '22222222-2222-4222-8222-222222222222',
    })
    const foreignEnv = requestEnv(foreign)
    const stolen = await postCreate(foreignEnv, foreign, createBody)
    expect(stolen.status).toBe(400)

    const malformed = await postCreate(env, user, { name: 'Nope' })
    expect(malformed.status).toBe(400)
    expect((env.DB as FakeD1Database).webauthnCredentials).toHaveLength(1)
    expect((foreignEnv.DB as FakeD1Database).webauthnCredentials).toHaveLength(
      0,
    )
  })

  it('rejects missing user verification and keeps PRF material client-side', async () => {
    const user = authUserRecord()
    const env = requestEnv(user)
    verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'uv-missing',
          publicKey,
          counter: 0,
          transports: ['internal'],
        },
        aaguid: '00000000-0000-0000-0000-000000000000',
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        userVerified: false,
        credentialType: 'public-key',
      },
    })
    const failed = await enrollCredential(env, user, {
      name: 'UV missing',
      supportsPrf: true,
      keys: encryptedTriple,
      extensionResults: { prf: { results: { first: 'client-prf-output' } } },
    })
    expect(failed.status).toBe(400)
    expect((env.DB as FakeD1Database).webauthnCredentials).toHaveLength(0)
    expect(verifyRegistrationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        requireUserVerification: true,
        response: expect.objectContaining({
          clientExtensionResults: {},
        }),
      }),
    )
  })

  it('isolates list output to the authenticated owner', async () => {
    const alice = authUserRecord({ id: '11111111-1111-4111-8111-111111111111' })
    const bob = authUserRecord({
      id: '22222222-2222-4222-8222-222222222222',
      emailNormalized: 'bob@example.test',
    })
    const env = {
      DB: new FakeD1Database(null, [...requiredTables], {
        authUsers: [alice, bob],
        webauthnCredentials: [
          storedCredential(alice.id, 'alice-cred', 'alice-row'),
          storedCredential(bob.id, 'bob-cred', 'bob-row'),
        ],
      }),
      ...webAuthnBindings(),
    }

    const response = await app.request(
      '/api/webauthn',
      { headers: { Authorization: `Bearer ${await accessTokenFor(alice)}` } },
      env,
    )
    const body = (await response.json()) as {
      data: Array<{ id: string; name: string }>
    }
    expect(body.data).toEqual([
      expect.objectContaining({ id: 'alice-row', name: 'Passkey' }),
    ])
    expect(JSON.stringify(body)).not.toContain('bob-row')
    expect(JSON.stringify(body)).not.toContain('bob-cred')
  })

  it('records secret-safe enrollment audit events', async () => {
    const user = authUserRecord()
    const env = requestEnv(user, { HONOWARDEN_AUDIT_LOGS: 'true' })
    await enrollCredential(env, user, {
      name: 'Audited',
      supportsPrf: false,
    })
    const inserts = (env.DB as FakeD1Database).auditEventInserts
    expect(inserts.map((event) => event.name)).toEqual([
      'webauthn.registration_options',
      'webauthn.create',
    ])
    expect(inserts.every((event) => event.outcome === 'success')).toBe(true)
    expect(JSON.stringify(inserts)).not.toContain('opaque-route-token')
    expect(JSON.stringify(inserts)).not.toContain('client-prf-output')
    expect(JSON.stringify(inserts)).not.toContain(
      'credential-from-authenticator',
    )
    expect(JSON.stringify(inserts)).not.toMatch(/aaguid/i)
  })
})

function mockVerifiedRegistration(
  credentialId = 'credential-from-authenticator',
) {
  verifyRegistrationResponse.mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: {
        id: credentialId,
        publicKey,
        counter: 0,
        transports: ['internal'],
      },
      aaguid: '00000000-0000-0000-0000-000000000000',
      credentialDeviceType: 'multiDevice',
      credentialBackedUp: true,
      userVerified: true,
      credentialType: 'public-key',
    },
  })
}

async function enrollCredential(
  env: Record<string, unknown>,
  user: ReturnType<typeof authUserRecord>,
  input: {
    name: string
    supportsPrf?: boolean
    keys?: typeof encryptedTriple
    credentialId?: string
    extensionResults?: Record<string, unknown>
  },
) {
  if (input.credentialId) {
    mockVerifiedRegistration(input.credentialId)
  }
  const options = await issueOptions(env, user)
  return postCreate(
    env,
    user,
    registrationBody(options.challenge, options.token, input),
  )
}

async function issueOptions(
  env: Record<string, unknown>,
  user: ReturnType<typeof authUserRecord>,
) {
  const response = await app.request(
    '/api/webauthn/attestation-options',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await recentPasswordAccessTokenFor(user)}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    },
    env,
  )
  expect(response.status).toBe(200)
  const body = (await response.json()) as {
    token: string
    options: { challenge: string }
  }
  return { token: body.token, challenge: body.options.challenge }
}

async function postCreate(
  env: Record<string, unknown>,
  user: ReturnType<typeof authUserRecord>,
  body: unknown,
) {
  const response = await app.request(
    '/api/webauthn',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await accessTokenFor(user)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    env,
  )
  return {
    status: response.status,
    body: await response.json(),
  }
}

function registrationBody(
  challenge: string,
  token: string,
  input: {
    name?: string
    supportsPrf?: boolean
    keys?: typeof encryptedTriple
    extensionResults?: Record<string, unknown>
  } = {},
) {
  return {
    deviceResponse: {
      id: 'credential-from-authenticator',
      rawId: 'credential-from-authenticator',
      type: 'public-key',
      response: {
        attestationObject: 'attestation-object',
        clientDataJson: encodeClientData({
          type: 'webauthn.create',
          challenge,
          origin: 'https://vault.example.com',
        }),
      },
      clientExtensionResults: input.extensionResults ?? {},
    },
    name: input.name ?? 'Laptop',
    token,
    supportsPrf: input.supportsPrf ?? false,
    ...(input.keys ?? {}),
  }
}

function encodeClientData(value: Record<string, string>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function requestEnv(
  user: ReturnType<typeof authUserRecord>,
  extra: Record<string, unknown> = {},
) {
  const { webauthnCredentials, HONOWARDEN_WEBAUTHN_ENABLED, ...bindings } =
    extra
  const database = new FakeD1Database(null, [...requiredTables], {
    authUser: user,
    ...(Array.isArray(webauthnCredentials)
      ? {
          webauthnCredentials: webauthnCredentials as Record<string, unknown>[],
        }
      : {}),
  })
  return {
    DB: database,
    ...webAuthnBindings(
      typeof HONOWARDEN_WEBAUTHN_ENABLED === 'string'
        ? HONOWARDEN_WEBAUTHN_ENABLED
        : 'true',
    ),
    ...bindings,
  }
}

function webAuthnBindings(enabled = 'true') {
  return {
    HONOWARDEN_TOKEN_SECRET: tokenSecret,
    HONOWARDEN_WEBAUTHN_ENABLED: enabled,
    HONOWARDEN_WEBAUTHN_RP_ID: 'example.com',
    HONOWARDEN_WEBAUTHN_ORIGINS: 'https://vault.example.com',
  }
}

function storedCredential(
  userId: string,
  credentialId: string,
  id = credentialId,
) {
  return {
    id,
    userId,
    credentialId,
    publicKey: 'public-key-bytes',
    userHandle: 'user-handle',
    signCount: 0,
    credentialType: 'public-key',
    transports: JSON.stringify(['internal']),
    aaguid: '00000000-0000-0000-0000-000000000000',
    discoverable: 1,
    backupEligible: 1,
    backupState: 0,
    prfSupported: 0,
    encryptedUserKey: null,
    encryptedPublicKey: null,
    encryptedPrivateKey: null,
    name: 'Passkey',
    createdAt: '2026-07-06T00:00:00.000Z',
    revisionDate: '2026-07-06T00:00:00.000Z',
    lastUsedAt: null,
  }
}

function authUserRecord(overrides: Partial<ReturnType<typeof baseUser>> = {}) {
  return { ...baseUser(), ...overrides }
}

function baseUser() {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'Person@Example.Test',
    emailNormalized: 'person@example.test',
    emailVerifiedAt: '2026-07-06T00:00:00.000Z',
    displayName: 'Person',
    kdfAlgorithm: 'pbkdf2-sha256',
    kdfIterations: 600000,
    kdfMemory: null,
    kdfParallelism: null,
    masterPasswordHash: 'synthetic-master-password-hash',
    userKey: '2.synthetic-user-key',
    publicKey: 'synthetic-public-key',
    privateKey: '2.synthetic-private-key',
    securityStamp: 'security-stamp',
    revisionDate: '2026-07-06T00:00:00.000Z',
    createdAt: '2026-07-06T00:00:00.000Z',
    disabledAt: null,
    loginFailedCount: 0,
    loginFailedAt: null,
    loginLockedUntil: null,
    totpEnabled: false,
    totpEncryptedSecret: null,
    totpLastAcceptedStep: null,
  }
}

async function accessTokenFor(user: ReturnType<typeof authUserRecord>) {
  const issuedAt = Math.floor(Date.now() / 1000)
  return signAccessToken(tokenSecret, {
    sub: user.id,
    email: user.emailNormalized,
    device: 'fixture-device',
    securityStamp: user.securityStamp,
    iat: issuedAt,
    exp: issuedAt + 3600,
    authMethod: 'password',
  })
}

async function recentPasswordAccessTokenFor(
  user: ReturnType<typeof authUserRecord>,
) {
  return accessTokenFor(user)
}

async function refreshAccessTokenFor(user: ReturnType<typeof authUserRecord>) {
  const issuedAt = Math.floor(Date.now() / 1000)
  return signAccessToken(tokenSecret, {
    sub: user.id,
    email: user.emailNormalized,
    device: 'fixture-device',
    securityStamp: user.securityStamp,
    iat: issuedAt,
    exp: issuedAt + 3600,
    authMethod: 'refresh',
  })
}

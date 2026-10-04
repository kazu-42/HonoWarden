import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  createEmailVerificationChallenge,
  verifyEmailVerification,
  type EmailIssuerResolver,
} from '../src/email-verification'
import {
  hashEmailVerificationNonce,
  resolveEmailVerificationRuntimePolicy,
} from '../src/domain/email-verification'
import * as repository from '../src/repositories/email-verification-repository'
import * as quota from '../src/repositories/request-quota-repository'

const actor = {
  userId: 'owner',
  sessionId: 'family',
  deviceIdentifier: 'desktop',
  emailNormalized: 'owner@example.test',
  securityStamp: 'stamp',
}
const audience = 'https://vault.example.test'
const issuer = 'https://issuer.example.test'
const now = new Date('2026-10-04T00:00:00.000Z')
const challengeId = '12345678-1234-4234-9234-123456789abc'
const nonce = 'AQEB'.repeat(10) + 'AQE'
const database = {} as D1Database
const policy = resolveEmailVerificationRuntimePolicy({
  HONOWARDEN_EMAIL_VERIFICATION_ENABLED: 'true',
  HONOWARDEN_EMAIL_VERIFICATION_RP_ORIGIN: audience,
  HONOWARDEN_EMAIL_VERIFICATION_ISSUERS: JSON.stringify([
    {
      emailDomain: 'example.test',
      issuer,
      jwksUri: 'https://keys.example.test/keys',
    },
  ]),
})
if (policy.status !== 'ready') throw new Error('Synthetic policy not ready')
const readyPolicy = policy
let issuerKeys: CryptoKeyPair,
  holderKeys: CryptoKeyPair,
  issuerJwk: JsonWebKey,
  holderJwk: JsonWebKey

beforeAll(async () => {
  issuerKeys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  holderKeys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  issuerJwk = (await crypto.subtle.exportKey(
    'jwk',
    issuerKeys.publicKey,
  )) as JsonWebKey
  holderJwk = {
    ...((await crypto.subtle.exportKey(
      'jwk',
      holderKeys.publicKey,
    )) as JsonWebKey),
    alg: 'Ed25519',
  }
})
beforeEach(async () => {
  vi.spyOn(quota, 'recordRequestQuotaHit').mockResolvedValue({
    bucketKey: 'synthetic-bucket',
    scope: 'authenticated',
    requestCount: 1,
    windowStartedAt: now.toISOString(),
    blockedUntil: null,
    updatedAt: now.toISOString(),
  })
  vi.spyOn(
    repository,
    'cleanupExpiredEmailVerificationChallenges',
  ).mockResolvedValue()
  vi.spyOn(
    repository,
    'createEmailVerificationChallengeRecord',
  ).mockResolvedValue(true)
  vi.spyOn(repository, 'consumeEmailVerificationChallenge').mockResolvedValue(
    true,
  )
  vi.spyOn(repository, 'findEmailVerificationChallenge').mockResolvedValue({
    id: challengeId,
    nonceDigest: await hashEmailVerificationNonce(nonce),
    audience,
    expiresAt: '2026-10-04T00:05:00.000Z',
  })
})
afterEach(() => vi.restoreAllMocks())

describe('account email verification service with actual proof signatures', () => {
  it('generates a fresh 256-bit nonce while persisting only its digest and trusted current-account scope', async () => {
    const result = await createEmailVerificationChallenge(database, {
      actor,
      policy: readyPolicy,
      now,
    })
    expect(result.status).toBe('success')
    if (result.status !== 'success') throw new Error('No challenge')
    const generated = result.body.nonce as string
    expect(generated).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(result.body).toMatchObject({
      email: actor.emailNormalized,
      audience,
      expiresAt: '2026-10-04T00:05:00.000Z',
    })
    const persisted = vi.mocked(
      repository.createEmailVerificationChallengeRecord,
    ).mock.calls[0]![1]
    expect(persisted).toMatchObject({
      actor,
      audience,
      nonceDigest: await hashEmailVerificationNonce(generated),
    })
    expect(JSON.stringify(persisted)).not.toContain(generated)
  })

  it('consumes proof only after both actual issuer and holder signatures verify for this family', async () => {
    const resolver = resolverFixture()
    const result = await verifyEmailVerification(database, {
      actor,
      policy: readyPolicy,
      challengeId,
      token: await token(),
      resolver,
      requestId: 'request-id',
      now: () => now,
    })
    expect(result).toEqual({
      status: 'success',
      body: { object: 'emailVerification', verified: true, method: 'evp' },
    })
    expect(repository.consumeEmailVerificationChallenge).toHaveBeenCalledWith(
      database,
      expect.objectContaining({
        actor,
        id: challengeId,
        audience,
        nonceDigest: await hashEmailVerificationNonce(nonce),
        requestId: 'request-id',
      }),
    )
    expect(resolver.resolve).toHaveBeenCalledWith(readyPolicy.issuers[0])
  })

  it('rejects a stale database family even after proof verification', async () => {
    vi.mocked(repository.consumeEmailVerificationChallenge).mockResolvedValue(
      false,
    )
    expect(
      await verifyEmailVerification(database, {
        actor,
        policy: readyPolicy,
        challengeId,
        token: await token(),
        resolver: resolverFixture(),
        requestId: 'request-id',
        now: () => now,
      }),
    ).toEqual({ status: 'invalid_request' })
  })

  it.each([
    'missing-challenge',
    'different-email',
    'different-nonce',
    'different-issuer',
  ] as const)(
    'rejects %s before issuer network discovery or proof consumption',
    async (condition) => {
      if (condition === 'missing-challenge')
        vi.mocked(repository.findEmailVerificationChallenge).mockResolvedValue(
          null,
        )
      const resolver = resolverFixture()
      const proof = await token(
        {
          email:
            condition === 'different-email'
              ? 'Owner@example.test'
              : actor.emailNormalized,
          iss:
            condition === 'different-issuer'
              ? 'https://attacker.example.test'
              : issuer,
        },
        condition === 'different-nonce' ? 'AgIC'.repeat(10) + 'AgI' : nonce,
      )
      expect(
        await verifyEmailVerification(database, {
          actor,
          policy: readyPolicy,
          challengeId,
          token: proof,
          resolver,
          requestId: 'request-id',
          now: () => now,
        }),
      ).toEqual({ status: 'invalid_request' })
      expect(resolver.resolve).not.toHaveBeenCalled()
      expect(
        repository.consumeEmailVerificationChallenge,
      ).not.toHaveBeenCalled()
    },
  )

  it('returns a bounded account quota rejection before challenge lookup or network', async () => {
    vi.mocked(quota.recordRequestQuotaHit).mockResolvedValue({
      bucketKey: 'synthetic',
      scope: 'authenticated',
      requestCount: 11,
      windowStartedAt: now.toISOString(),
      blockedUntil: '2026-10-04T00:01:00.000Z',
      updatedAt: now.toISOString(),
    })
    const resolver = resolverFixture()
    expect(
      await verifyEmailVerification(database, {
        actor,
        policy: readyPolicy,
        challengeId,
        token: await token(),
        resolver,
        requestId: 'request-id',
        now: () => now,
      }),
    ).toEqual({ status: 'rate_limited', retryAfter: 60 })
    expect(repository.findEmailVerificationChallenge).not.toHaveBeenCalled()
    expect(resolver.resolve).not.toHaveBeenCalled()
  })

  it('rejects unregistered account domains before quota, state, or network', async () => {
    expect(
      await createEmailVerificationChallenge(database, {
        actor: { ...actor, emailNormalized: 'owner@unsupported.test' },
        policy: readyPolicy,
        now,
      }),
    ).toEqual({ status: 'issuer_unsupported' })
    expect(quota.recordRequestQuotaHit).not.toHaveBeenCalled()
    expect(
      repository.createEmailVerificationChallengeRecord,
    ).not.toHaveBeenCalled()
  })

  it('requires the actual EVT algorithm to be advertised by issuer metadata', async () => {
    const resolver = resolverFixture()
    resolver.resolve.mockResolvedValue({
      jwks: { keys: [{ ...issuerJwk, kid: 'issuer-key' }] },
      algorithms: ['ES256'],
    })
    expect(
      await verifyEmailVerification(database, {
        actor,
        policy: readyPolicy,
        challengeId,
        token: await token(),
        resolver,
        requestId: 'request-id',
        now: () => now,
      }),
    ).toEqual({ status: 'invalid_request' })
    expect(repository.consumeEmailVerificationChallenge).not.toHaveBeenCalled()
  })
})

function resolverFixture() {
  return {
    resolve: vi.fn<EmailIssuerResolver['resolve']>().mockResolvedValue({
      jwks: { keys: [{ ...issuerJwk, kid: 'issuer-key' }] },
      algorithms: ['Ed25519'],
    }),
  }
}
async function token(
  overrides: Record<string, unknown> = {},
  proofNonce = nonce,
) {
  const evt = await sign(
    { alg: 'Ed25519', kid: 'issuer-key', typ: 'evt+jwt' },
    {
      iss: issuer,
      email: actor.emailNormalized,
      email_verified: true,
      iat: now.getTime() / 1000,
      cnf: { jwk: holderJwk },
      ...overrides,
    },
    issuerKeys.privateKey,
  )
  const sdHash = encode(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(`${evt}~`),
      ),
    ),
  )
  const kb = await sign(
    { alg: 'Ed25519', typ: 'kb+jwt' },
    {
      aud: audience,
      nonce: proofNonce,
      iat: now.getTime() / 1000,
      sd_hash: sdHash,
    },
    holderKeys.privateKey,
  )
  return `${evt}~${kb}`
}
async function sign(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  key: CryptoKey,
) {
  const input = `${encode(new TextEncoder().encode(JSON.stringify(header)))}.${encode(new TextEncoder().encode(JSON.stringify(payload)))}`
  return `${input}.${encode(new Uint8Array(await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(input))))}`
}
function encode(value: Uint8Array) {
  return btoa(String.fromCharCode(...value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

import { describe, expect, it } from 'vitest'

import app from '../../src/app'
import { FakeD1Database } from '../support/fake-d1'

type JsonObject = Record<string, unknown>

const tokenSecret = 'test-token-secret'
const bootstrapToken = 'synthetic-bootstrap-token'
const disabledAt = '2026-07-10T07:25:00.000Z'

describe('synthetic two-user dogfood and disabled-user lifecycle evidence', () => {
  it('bootstraps two synthetic users, proves isolation, and denies disabled-user flows', async () => {
    const authUsers: JsonObject[] = []
    const folders: JsonObject[] = []
    const ciphers: JsonObject[] = []
    const database = new FakeD1Database(null, [], {
      authUsers,
      folders,
      ciphers,
    })
    const env = {
      DB: database,
      HONOWARDEN_ALLOWED_EMAILS:
        'dogfood-a@example.test,dogfood-b@example.test',
      HONOWARDEN_BOOTSTRAP_ENABLED: 'true',
      HONOWARDEN_BOOTSTRAP_TOKEN: bootstrapToken,
      HONOWARDEN_TOKEN_SECRET: tokenSecret,
    }

    const aliceBootstrap = await bootstrapSyntheticUser(env, {
      email: 'Dogfood-A@Example.Test',
      passwordHash: 'synthetic-master-password-hash-a',
      userKey: '2.synthetic-user-key-a',
      requestId: 'dogfood-bootstrap-a',
    })
    const bobBootstrap = await bootstrapSyntheticUser(env, {
      email: 'Dogfood-B@Example.Test',
      passwordHash: 'synthetic-master-password-hash-b',
      userKey: '2.synthetic-user-key-b',
      requestId: 'dogfood-bootstrap-b',
    })

    expect(aliceBootstrap).toMatchObject({
      object: 'user',
      email: 'dogfood-a@example.test',
      requestId: 'dogfood-bootstrap-a',
    })
    expect(bobBootstrap).toMatchObject({
      object: 'user',
      email: 'dogfood-b@example.test',
      requestId: 'dogfood-bootstrap-b',
    })
    expect(authUsers).toHaveLength(2)

    const alice = authUsers.find(
      (user) => user.emailNormalized === 'dogfood-a@example.test',
    )
    const bob = authUsers.find(
      (user) => user.emailNormalized === 'dogfood-b@example.test',
    )
    expect(alice?.id).toBe(aliceBootstrap.id)
    expect(bob?.id).toBe(bobBootstrap.id)
    expect(alice?.id).not.toBe(bob?.id)

    seedSyntheticVaultRows({
      folders,
      ciphers,
      aliceUserId: String(alice!.id),
      bobUserId: String(bob!.id),
    })

    const aliceToken = await passwordGrant(env, {
      username: 'dogfood-a@example.test',
      passwordHash: 'synthetic-master-password-hash-a',
      deviceIdentifier: 'dogfood-device-a',
    })
    const bobToken = await passwordGrant(env, {
      username: 'dogfood-b@example.test',
      passwordHash: 'synthetic-master-password-hash-b',
      deviceIdentifier: 'dogfood-device-b',
    })

    const aliceSync = await syncVault(env, aliceToken)
    const bobSync = await syncVault(env, bobToken)

    expect(aliceSync).toMatchObject({
      Profile: {
        Id: alice!.id,
        Email: 'dogfood-a@example.test',
      },
      Folders: [{ id: 'dogfood-a-folder' }],
      Ciphers: [{ id: 'dogfood-a-cipher' }],
    })
    expect(JSON.stringify(aliceSync)).not.toContain('dogfood-b-')
    expect(bobSync).toMatchObject({
      Profile: {
        Id: bob!.id,
        Email: 'dogfood-b@example.test',
      },
      Folders: [{ id: 'dogfood-b-folder' }],
      Ciphers: [{ id: 'dogfood-b-cipher' }],
    })
    expect(JSON.stringify(bobSync)).not.toContain('dogfood-a-')

    await expectStatus(
      app.request(
        '/api/folders/dogfood-b-folder',
        {
          headers: {
            Authorization: `Bearer ${aliceToken}`,
          },
        },
        env,
      ),
      404,
    )
    await expectStatus(
      app.request(
        '/api/ciphers/dogfood-a-cipher',
        {
          headers: {
            Authorization: `Bearer ${bobToken}`,
          },
        },
        env,
      ),
      404,
    )
    await expectStatus(
      app.request(
        '/api/ciphers/dogfood-a-cipher',
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${bobToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...cipherPayload({
              folderId: 'dogfood-b-folder',
              name: '2.synthetic-bob-cross-user-update',
            }),
            revisionDate: '2026-07-10T07:29:00.000Z',
          }),
        },
        env,
      ),
      404,
    )

    alice!.disabledAt = disabledAt

    await expectPasswordGrantDenied(env, {
      username: 'dogfood-a@example.test',
      passwordHash: 'synthetic-master-password-hash-a',
      deviceIdentifier: 'dogfood-device-a-disabled',
    })
    await expectRefreshGrantDeniedForDisabledUser(alice!)
    await expectStatus(
      app.request(
        '/api/sync',
        {
          headers: {
            Authorization: `Bearer ${aliceToken}`,
          },
        },
        env,
      ),
      401,
    )

    for (const request of [
      {
        path: '/api/folders',
        body: { name: '2.synthetic-disabled-folder' },
      },
      {
        path: '/api/ciphers',
        body: cipherPayload({
          folderId: 'dogfood-a-folder',
          name: '2.synthetic-disabled-cipher',
        }),
      },
    ]) {
      await expectStatus(
        app.request(
          request.path,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${aliceToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(request.body),
          },
          env,
        ),
        401,
      )
    }
  })
})

async function bootstrapSyntheticUser(
  env: Record<string, unknown>,
  input: {
    email: string
    passwordHash: string
    userKey: string
    requestId: string
  },
): Promise<JsonObject> {
  const response = await app.request(
    '/api/accounts/bootstrap',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-HonoWarden-Bootstrap-Token': bootstrapToken,
        'X-Request-Id': input.requestId,
      },
      body: JSON.stringify({
        email: input.email,
        masterPasswordHash: input.passwordHash,
        userKey: input.userKey,
      }),
    },
    env,
  )

  expect(response.status).toBe(201)
  return (await response.json()) as JsonObject
}

async function passwordGrant(
  env: Record<string, unknown>,
  input: {
    username: string
    passwordHash: string
    deviceIdentifier: string
  },
): Promise<string> {
  const response = await app.request(
    '/identity/connect/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Device-Identifier': input.deviceIdentifier,
        'Device-Name': 'Synthetic Dogfood Device',
        'Device-Type': '9',
      },
      body: new URLSearchParams({
        grant_type: 'password',
        username: input.username,
        password: input.passwordHash,
        scope: 'api offline_access',
      }),
    },
    env,
  )

  expect(response.status).toBe(200)
  const body = (await response.json()) as { access_token?: string }
  expect(body.access_token).toEqual(expect.any(String))
  return body.access_token!
}

async function expectPasswordGrantDenied(
  env: Record<string, unknown>,
  input: {
    username: string
    passwordHash: string
    deviceIdentifier: string
  },
): Promise<void> {
  const response = await app.request(
    '/identity/connect/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Device-Identifier': input.deviceIdentifier,
      },
      body: new URLSearchParams({
        grant_type: 'password',
        username: input.username,
        password: input.passwordHash,
      }),
    },
    env,
  )

  expect(response.status).toBe(400)
  await expect(response.json()).resolves.toMatchObject({
    error: 'invalid_grant',
  })
}

async function expectRefreshGrantDeniedForDisabledUser(
  user: JsonObject,
): Promise<void> {
  const response = await app.request(
    '/identity/connect/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: 'synthetic-refresh-token',
      }),
    },
    {
      DB: new FakeD1Database(null, [], {
        refreshSession: {
          tokenId: 'dogfood-refresh-token-id',
          userId: user.id,
          deviceId: 'dogfood-device-id',
          deviceIdentifier: 'dogfood-device-a',
          tokenExpiresAt: '2999-08-05T00:00:00.000Z',
          tokenRevokedAt: null,
          deviceRevokedAt: null,
          email: user.email,
          emailNormalized: user.emailNormalized,
          displayName: user.displayName,
          kdfAlgorithm: user.kdfAlgorithm,
          kdfIterations: user.kdfIterations,
          kdfMemory: user.kdfMemory,
          kdfParallelism: user.kdfParallelism,
          masterPasswordHash: user.masterPasswordHash,
          userKey: user.userKey,
          publicKey: user.publicKey,
          privateKey: user.privateKey,
          securityStamp: user.securityStamp,
          revisionDate: user.revisionDate,
          createdAt: user.createdAt,
          disabledAt: user.disabledAt,
          loginFailedCount: user.loginFailedCount,
          loginFailedAt: user.loginFailedAt,
          loginLockedUntil: user.loginLockedUntil,
          totpEnabled: user.totpEnabled,
          totpEncryptedSecret: user.totpEncryptedSecret,
          totpLastAcceptedStep: user.totpLastAcceptedStep,
        },
        refreshRotationChanges: 0,
      }),
      HONOWARDEN_TOKEN_SECRET: tokenSecret,
    },
  )

  expect(response.status).toBe(400)
  await expect(response.json()).resolves.toMatchObject({
    error: 'invalid_grant',
  })
}

async function syncVault(
  env: Record<string, unknown>,
  accessToken: string,
): Promise<JsonObject> {
  const response = await app.request(
    '/api/sync',
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    env,
  )

  expect(response.status).toBe(200)
  return (await response.json()) as JsonObject
}

async function expectStatus(
  responsePromise: Response | Promise<Response>,
  status: number,
): Promise<void> {
  const response = await responsePromise
  expect(response.status).toBe(status)
}

function seedSyntheticVaultRows(input: {
  folders: JsonObject[]
  ciphers: JsonObject[]
  aliceUserId: string
  bobUserId: string
}): void {
  input.folders.push(
    {
      id: 'dogfood-a-folder',
      userId: input.aliceUserId,
      name: '2.synthetic-alice-folder',
      revisionDate: '2026-07-10T07:26:00.000Z',
    },
    {
      id: 'dogfood-b-folder',
      userId: input.bobUserId,
      name: '2.synthetic-bob-folder',
      revisionDate: '2026-07-10T07:27:00.000Z',
    },
  )
  input.ciphers.push(
    {
      id: 'dogfood-a-cipher',
      userId: input.aliceUserId,
      folderId: 'dogfood-a-folder',
      type: 1,
      favorite: 1,
      encryptedJson: JSON.stringify(
        cipherPayload({
          folderId: 'dogfood-a-folder',
          name: '2.synthetic-alice-cipher',
        }),
      ),
      revisionDate: '2026-07-10T07:28:00.000Z',
      createdAt: '2026-07-10T07:28:00.000Z',
    },
    {
      id: 'dogfood-b-cipher',
      userId: input.bobUserId,
      folderId: 'dogfood-b-folder',
      type: 1,
      favorite: 0,
      encryptedJson: JSON.stringify(
        cipherPayload({
          folderId: 'dogfood-b-folder',
          name: '2.synthetic-bob-cipher',
        }),
      ),
      revisionDate: '2026-07-10T07:28:30.000Z',
      createdAt: '2026-07-10T07:28:30.000Z',
    },
  )
}

function cipherPayload(input: { folderId: string; name: string }) {
  return {
    type: 1,
    folderId: input.folderId,
    favorite: true,
    name: input.name,
    notes: null,
    login: {
      username: '2.synthetic-username',
      password: '2.synthetic-password',
      uris: [],
    },
  }
}

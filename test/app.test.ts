import { describe, expect, it } from 'vitest'

import app from '../src/app'
import { signAccessToken } from '../src/domain/tokens'
import { FakeD1Database, requiredTables } from './support/fake-d1'

describe('HonoWarden app', () => {
  it('returns service metadata from the root route', async () => {
    const response = await app.request('/', {
      headers: {
        'X-Request-Id': 'root-request',
      },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('X-Request-Id')).toBe('root-request')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    await expect(response.json()).resolves.toMatchObject({
      name: 'HonoWarden',
      status: 'pre-alpha',
      requestId: 'root-request',
      links: {
        config: '/api/config',
        health: '/health',
      },
    })
  })

  it('returns a health response', async () => {
    const response = await app.request('/health', {
      headers: {
        'X-Request-Id': 'health-request',
      },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: 'honowarden',
      version: '0.0.0-alpha',
      requestId: 'health-request',
    })
  })

  it('keeps the healthz alias for infrastructure probes', async () => {
    const response = await app.request('/healthz', {
      headers: {
        'X-Request-Id': 'healthz-request',
      },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      service: 'honowarden',
      requestId: 'healthz-request',
    })
  })

  it('returns database health for migrated D1 schema', async () => {
    const response = await app.request(
      '/health/db',
      {
        headers: {
          'X-Request-Id': 'db-health-request',
        },
      },
      {
        DB: new FakeD1Database('0001', [...requiredTables]),
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: 'honowarden',
      database: {
        schemaVersion: '0001',
        requiredTables: [...requiredTables],
      },
      requestId: 'db-health-request',
    })
  })

  it('returns 503 when D1 schema metadata is missing', async () => {
    const response = await app.request(
      '/health/db',
      {},
      {
        DB: new FakeD1Database(null, [...requiredTables]),
      },
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      status: 'error',
      service: 'honowarden',
      database: {
        ok: false,
        code: 'schema_version_missing',
      },
    })
  })

  it('returns prelogin KDF parameters for an allowed email', async () => {
    const response = await app.request(
      '/identity/accounts/prelogin',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': 'prelogin-request',
        },
        body: JSON.stringify({
          email: 'Person@Example.Test',
        }),
      },
      {
        HONOWARDEN_ALLOWED_EMAILS: 'person@example.test',
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('X-Request-Id')).toBe('prelogin-request')
    await expect(response.json()).resolves.toEqual({
      kdf: 0,
      kdfIterations: 600000,
      kdfMemory: null,
      kdfParallelism: null,
    })
  })

  it('denies prelogin for emails outside the allowlist', async () => {
    const response = await app.request(
      '/identity/accounts/prelogin',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'person@example.test',
        }),
      },
      {
        HONOWARDEN_ALLOWED_EMAILS: '',
      },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'prelogin_not_allowed',
      },
    })
  })

  it('rejects malformed prelogin requests', async () => {
    const response = await app.request('/identity/accounts/prelogin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_request',
      },
    })
  })

  it('rejects public account registration', async () => {
    for (const path of [
      '/api/accounts/register',
      '/identity/accounts/register',
    ]) {
      const response = await app.request(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'person@example.test',
        }),
      })

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: 'registration_disabled',
        },
      })
    }
  })

  it('keeps account bootstrap disabled by default', async () => {
    const response = await app.request('/api/accounts/bootstrap', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'person@example.test',
        masterPasswordHash: 'synthetic-master-password-hash',
      }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'bootstrap_disabled',
      },
    })
  })

  it('requires a bootstrap token when bootstrap is enabled', async () => {
    const response = await app.request(
      '/api/accounts/bootstrap',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'person@example.test',
          masterPasswordHash: 'synthetic-master-password-hash',
        }),
      },
      {
        HONOWARDEN_BOOTSTRAP_ENABLED: 'true',
        HONOWARDEN_BOOTSTRAP_TOKEN: 'expected-token',
      },
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'bootstrap_forbidden',
      },
    })
  })

  it('creates an allowlisted bootstrap account', async () => {
    const response = await app.request(
      '/api/accounts/bootstrap',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-HonoWarden-Bootstrap-Token': 'expected-token',
          'X-Request-Id': 'bootstrap-create-request',
        },
        body: JSON.stringify({
          email: 'Person@Example.Test',
          masterPasswordHash: 'synthetic-master-password-hash',
          userKey: '2.synthetic-user-key',
        }),
      },
      {
        DB: new FakeD1Database(null, [], { userInsertChanges: 1 }),
        HONOWARDEN_ALLOWED_EMAILS: 'person@example.test',
        HONOWARDEN_BOOTSTRAP_ENABLED: 'true',
        HONOWARDEN_BOOTSTRAP_TOKEN: 'expected-token',
      },
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      object: 'user',
      email: 'person@example.test',
      requestId: 'bootstrap-create-request',
    })
  })

  it('returns conflict for duplicate bootstrap accounts', async () => {
    const response = await app.request(
      '/api/accounts/bootstrap',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-HonoWarden-Bootstrap-Token': 'expected-token',
        },
        body: JSON.stringify({
          email: 'person@example.test',
          masterPasswordHash: 'synthetic-master-password-hash',
        }),
      },
      {
        DB: new FakeD1Database(null, [], { userInsertChanges: 0 }),
        HONOWARDEN_ALLOWED_EMAILS: 'person@example.test',
        HONOWARDEN_BOOTSTRAP_ENABLED: 'true',
        HONOWARDEN_BOOTSTRAP_TOKEN: 'expected-token',
      },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'account_exists',
      },
    })
  })

  it('exchanges a valid password grant for tokens', async () => {
    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Device-Identifier': 'fixture-device',
          'Device-Name': 'Fixture Device',
          'Device-Type': '9',
        },
        body: new URLSearchParams({
          grant_type: 'password',
          username: 'Person@Example.Test',
          password: 'synthetic-master-password-hash',
          scope: 'api offline_access',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: authUserRecord(),
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      token_type: 'Bearer',
      expires_in: 3600,
      Key: '2.synthetic-user-key',
      PrivateKey: null,
      Kdf: 0,
      KdfIterations: 600000,
      KdfMemory: null,
      KdfParallelism: null,
      AccountKeys: null,
      ForcePasswordReset: false,
      TwoFactorToken: null,
      MasterPasswordPolicy: null,
      UserDecryptionOptions: null,
      KeyConnectorUrl: null,
    })
  })

  it('rejects password grant when token secret is missing', async () => {
    const response = await app.request('/identity/connect/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'password',
        username: 'person@example.test',
        password: 'synthetic-master-password-hash',
      }),
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'server_misconfigured',
      },
    })
  })

  it('requires device information for password grant', async () => {
    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'password',
          username: 'person@example.test',
          password: 'synthetic-master-password-hash',
        }),
      },
      {
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'invalid_request',
      ErrorModel: {
        Message: 'Device information is required.',
      },
    })
  })

  it('rejects invalid password grants without revealing user existence', async () => {
    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Device-Identifier': 'fixture-device',
        },
        body: new URLSearchParams({
          grant_type: 'password',
          username: 'person@example.test',
          password: 'wrong-master-password-hash',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: authUserRecord(),
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_grant',
      ErrorModel: {
        Message: 'Invalid username or password.',
        Object: 'error',
      },
    })
  })

  it('rotates refresh tokens for a valid refresh grant', async () => {
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
          refreshSession: refreshTokenSessionRecord(),
          refreshRotationChanges: 1,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
      token_type: 'Bearer',
      expires_in: 3600,
      Key: '2.synthetic-user-key',
      Kdf: 0,
      KdfIterations: 600000,
    })
  })

  it('invalidates a refresh token session when a revoked token is reused', async () => {
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
            ...refreshTokenSessionRecord(),
            tokenRevokedAt: '2026-07-06T00:00:00.000Z',
          },
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_grant',
      ErrorModel: {
        Message: 'Invalid username or password.',
        Object: 'error',
      },
    })
  })

  it('rejects unknown refresh tokens without session changes', async () => {
    const response = await app.request(
      '/identity/connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: 'unknown-refresh-token',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          refreshSession: null,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'invalid_grant',
    })
  })

  it('returns 503 for sync when token secret is missing', async () => {
    const response = await app.request('/api/sync', {
      headers: {
        Authorization: 'Bearer synthetic-access-token',
        'X-Request-Id': 'sync-missing-secret-request',
      },
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'server_misconfigured',
      },
      requestId: 'sync-missing-secret-request',
    })
  })

  it('requires bearer authorization for sync', async () => {
    const response = await app.request(
      '/api/sync',
      {
        headers: {
          'X-Request-Id': 'sync-missing-token-request',
        },
      },
      {
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'missing_token',
      },
      requestId: 'sync-missing-token-request',
    })
  })

  it('rejects invalid access tokens for sync', async () => {
    const response = await app.request(
      '/api/sync',
      {
        headers: {
          Authorization: 'Bearer invalid-token',
          'X-Request-Id': 'sync-invalid-token-request',
        },
      },
      {
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_token',
      },
      requestId: 'sync-invalid-token-request',
    })
  })

  it('returns an empty personal vault sync for a valid access token', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/sync',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      object: 'sync',
      Profile: {
        Id: 'user-id',
        Name: 'Person',
        Email: 'person@example.test',
        EmailVerified: true,
        Premium: false,
        PremiumFromOrganization: false,
        Culture: 'en-US',
        TwoFactorEnabled: false,
        Key: '2.synthetic-user-key',
        AccountKeys: null,
        AvatarColor: '#3366cc',
        CreationDate: '2026-07-06T00:00:00.000Z',
        PrivateKey: null,
        SecurityStamp: 'security-stamp',
        ForcePasswordReset: false,
        UsesKeyConnector: false,
        VerifyDevices: false,
        Organizations: [],
        OrganizationsNew: [],
        Providers: [],
        ProviderOrganizations: [],
      },
      Folders: [],
      Collections: [],
      Ciphers: [],
      Domains: {
        EquivalentDomains: [],
        GlobalEquivalentDomains: [],
      },
      Policies: [],
      PoliciesNew: [],
      Sends: [],
      UserDecryption: null,
    })
  })

  it('includes active folders in sync', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/sync',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          folders: [
            {
              id: 'folder-id',
              userId: 'user-id',
              name: '2.encrypted-folder-name',
              revisionDate: '2026-07-06T00:03:00.000Z',
            },
          ],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      Folders: [
        {
          object: 'folder',
          id: 'folder-id',
          name: '2.encrypted-folder-name',
          revisionDate: '2026-07-06T00:03:00.000Z',
        },
      ],
    })
  })

  it('rejects sync for disabled users', async () => {
    const user = {
      ...authUserRecord(),
      disabledAt: '2026-07-06T00:00:00.000Z',
    }
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/sync',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_token',
      },
    })
  })

  it('rejects sync when the user security stamp changed after token issue', async () => {
    const tokenUser = authUserRecord()
    const accessToken = await accessTokenFor(tokenUser)
    const response = await app.request(
      '/api/sync',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: {
            ...tokenUser,
            securityStamp: 'rotated-security-stamp',
          },
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_token',
      },
    })
  })

  it('creates a folder for the authenticated user', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/folders',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: '2.encrypted-folder-name',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      object: 'folder',
      id: expect.any(String),
      name: '2.encrypted-folder-name',
      revisionDate: expect.any(String),
    })
  })

  it('rejects malformed folder create requests', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/folders',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'folder-invalid-body-request',
        },
        body: JSON.stringify({
          name: '',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_request',
      },
      requestId: 'folder-invalid-body-request',
    })
  })

  it('updates a folder for the authenticated user', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/folders/folder-id',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: '2.updated-encrypted-folder-name',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          folderUpdateChanges: 1,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      object: 'folder',
      id: 'folder-id',
      name: '2.updated-encrypted-folder-name',
      revisionDate: expect.any(String),
    })
  })

  it('returns not found when updating a missing or cross-user folder', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/folders/folder-id',
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: '2.updated-encrypted-folder-name',
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          folderUpdateChanges: 0,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'folder_not_found',
      },
    })
  })

  it('soft-deletes a folder for the authenticated user', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/folders/folder-id',
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          folderDeleteChanges: 1,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      object: 'folderDeletion',
      id: 'folder-id',
      revisionDate: expect.any(String),
    })
  })

  it('returns not found when deleting a missing or cross-user folder', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/folders/folder-id',
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          folderDeleteChanges: 0,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'folder_not_found',
      },
    })
  })

  it('creates a login cipher for the authenticated user', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/ciphers',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(cipherCreateBody()),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          folder: {
            id: 'folder-id',
          },
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      object: 'cipher',
      id: expect.any(String),
      organizationId: null,
      folderId: 'folder-id',
      type: 1,
      favorite: true,
      name: '2.encrypted-cipher-name',
      login: {
        username: '2.encrypted-username',
        password: '2.encrypted-password',
      },
      revisionDate: expect.any(String),
      creationDate: expect.any(String),
      deletedDate: null,
    })
  })

  it('includes active ciphers in sync', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/sync',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          ciphers: [
            {
              id: 'cipher-id',
              userId: 'user-id',
              folderId: 'folder-id',
              type: 1,
              favorite: 1,
              encryptedJson: JSON.stringify(cipherCreateBody()),
              revisionDate: '2026-07-06T00:05:00.000Z',
              createdAt: '2026-07-06T00:04:00.000Z',
            },
          ],
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      Ciphers: [
        {
          object: 'cipher',
          id: 'cipher-id',
          organizationId: null,
          folderId: 'folder-id',
          type: 1,
          favorite: true,
          name: '2.encrypted-cipher-name',
          revisionDate: '2026-07-06T00:05:00.000Z',
          creationDate: '2026-07-06T00:04:00.000Z',
          deletedDate: null,
        },
      ],
    })
  })

  it('rejects malformed cipher create requests', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/ciphers',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Request-Id': 'cipher-invalid-body-request',
        },
        body: JSON.stringify({
          favorite: true,
        }),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'invalid_request',
      },
      requestId: 'cipher-invalid-body-request',
    })
  })

  it('rejects cipher create when folder does not belong to the user', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const response = await app.request(
      '/api/ciphers',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(cipherCreateBody()),
      },
      {
        DB: new FakeD1Database(null, [], {
          authUser: user,
          folder: null,
        }),
        HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'cipher_folder_not_found',
      },
    })
  })

  it('returns a minimal upstream-compatible server config', async () => {
    const response = await app.request('https://vault.example.test/api/config')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      version: '0.0.0-alpha',
      server: null,
      environment: {
        cloudRegion: 'self-hosted',
        vault: 'https://vault.example.test',
        api: 'https://vault.example.test/api',
        identity: 'https://vault.example.test/identity',
        notifications: 'https://vault.example.test/notifications',
      },
      settings: {
        disableUserRegistration: true,
      },
      object: 'config',
    })
  })

  it('returns structured JSON for unknown routes', async () => {
    const response = await app.request('/missing', {
      headers: {
        'X-Request-Id': 'missing-request',
      },
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'not_found',
        message: 'The requested resource was not found.',
      },
      requestId: 'missing-request',
    })
  })
})

function authUserRecord() {
  return {
    id: 'user-id',
    email: 'Person@Example.Test',
    emailNormalized: 'person@example.test',
    displayName: 'Person',
    kdfAlgorithm: 'pbkdf2-sha256',
    kdfIterations: 600000,
    kdfMemory: null,
    kdfParallelism: null,
    masterPasswordHash: 'synthetic-master-password-hash',
    userKey: '2.synthetic-user-key',
    privateKey: null,
    securityStamp: 'security-stamp',
    createdAt: '2026-07-06T00:00:00.000Z',
    disabledAt: null,
  }
}

function refreshTokenSessionRecord() {
  return {
    tokenId: 'refresh-token-id',
    userId: 'user-id',
    deviceId: 'device-id',
    deviceIdentifier: 'fixture-device',
    tokenExpiresAt: '2999-08-05T00:00:00.000Z',
    tokenRevokedAt: null,
    deviceRevokedAt: null,
    email: 'Person@Example.Test',
    emailNormalized: 'person@example.test',
    displayName: 'Person',
    kdfAlgorithm: 'pbkdf2-sha256',
    kdfIterations: 600000,
    kdfMemory: null,
    kdfParallelism: null,
    masterPasswordHash: 'synthetic-master-password-hash',
    userKey: '2.synthetic-user-key',
    privateKey: null,
    securityStamp: 'security-stamp',
    createdAt: '2026-07-06T00:00:00.000Z',
    disabledAt: null,
  }
}

function cipherCreateBody() {
  return {
    type: 1,
    folderId: 'folder-id',
    favorite: true,
    name: '2.encrypted-cipher-name',
    notes: null,
    login: {
      username: '2.encrypted-username',
      password: '2.encrypted-password',
      uris: [],
    },
  }
}

async function accessTokenFor(
  user: Pick<
    ReturnType<typeof authUserRecord>,
    'emailNormalized' | 'id' | 'securityStamp'
  >,
) {
  return signAccessToken('test-token-secret', {
    sub: user.id,
    email: user.emailNormalized,
    device: 'fixture-device',
    securityStamp: user.securityStamp,
    iat: 1,
    exp: 4_102_444_800,
  })
}

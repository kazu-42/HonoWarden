import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it, vi } from 'vitest'

import app from '../../src/app'
import {
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from '../../src/domain/tokens'
import type { AccessTokenClaims } from '../../src/domain/tokens'
import {
  createPasswordGrantSession,
  invalidateRefreshTokenSession,
  revokeDeviceSession,
  revokeOtherDeviceSessions,
} from '../../src/repositories/auth-repository'

const instances: Miniflare[] = []
const owner = '11111111-1111-4111-8111-111111111111'
const secret = 'synthetic-session-test-secret'
const stamp = 'synthetic-stamp'
const initial = '2026-09-22T00:00:00.000Z'

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()))
})

describe('device-bound bearer authorization on real local D1', () => {
  it('rejects an already-issued bearer immediately after explicit device revocation', async () => {
    const db = await database()
    const bearer = await login(db, 'target', 'first-session')
    expect((await authorized(db, bearer)).status).toBe(200)
    await revokeDeviceSession(db, {
      userId: owner,
      deviceId: `${owner}:target`,
      revokedAt: initial,
    })
    expect((await authorized(db, bearer)).status).toBe(401)
  })

  it('preserves the current bearer while revoking every other device', async () => {
    const db = await database()
    const current = await login(db, 'current', 'current-session')
    const other = await login(db, 'other', 'other-session')
    await revokeOtherDeviceSessions(db, {
      userId: owner,
      currentDeviceId: `${owner}:current`,
      revokedAt: initial,
    })
    expect((await authorized(db, current)).status).toBe(200)
    expect((await authorized(db, other)).status).toBe(401)
  })

  it('rolls targeted revocation back when refresh-family revocation fails', async () => {
    const db = await database()
    const bearer = await login(db, 'target', 'first-session')
    await db
      .prepare(
        "CREATE TRIGGER reject_refresh_revoke BEFORE UPDATE ON refresh_tokens BEGIN SELECT RAISE(ABORT, 'synthetic refresh revoke failure'); END",
      )
      .run()
    await expect(
      revokeDeviceSession(db, {
        userId: owner,
        deviceId: `${owner}:target`,
        revokedAt: initial,
      }),
    ).rejects.toThrow('synthetic refresh revoke failure')
    expect((await authorized(db, bearer)).status).toBe(200)
    expect(
      await db
        .prepare('SELECT revoked_at FROM devices WHERE id = ?')
        .bind(`${owner}:target`)
        .first(),
    ).toEqual({ revoked_at: null })
  })

  it('does not revoke a fresh login inserted at the former two-write interleaving boundary', async () => {
    const db = await database()
    const old = await login(db, 'target', 'old-session')
    let fresh: string | undefined
    const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>()
    function prepare(sql: string): D1PreparedStatement {
      function wrap(statement: D1PreparedStatement): D1PreparedStatement {
        const wrapped = new Proxy(statement, {
          get(target, property) {
            if (property === 'bind')
              return (...values: unknown[]) => wrap(target.bind(...values))
            if (property === 'run')
              return async () => {
                const result = await target.run()
                if (sql.includes('UPDATE devices'))
                  fresh = await login(db, 'target', 'new-session')
                return result
              }
            const value = Reflect.get(target, property)
            return typeof value === 'function' ? value.bind(target) : value
          },
        })
        originals.set(wrapped, statement)
        return wrapped
      }
      return wrap(db.prepare(sql))
    }
    const boundary = {
      prepare,
      async batch<T>(statements: D1PreparedStatement[]) {
        const results = await db.batch<T>(
          statements.map((statement) => originals.get(statement) ?? statement),
        )
        fresh = await login(db, 'target', 'new-session')
        return results
      },
    }
    expect(
      await revokeDeviceSession(boundary, {
        userId: owner,
        deviceId: `${owner}:target`,
        revokedAt: initial,
      }),
    ).toMatchObject({ status: 'revoked' })
    expect(fresh).toBeDefined()
    expect((await authorized(db, old)).status).toBe(401)
    expect((await authorized(db, fresh!)).status).toBe(200)
    expect((await refresh(db, 'new-session')).status).toBe(200)
  })

  it('rejects bearer access after refresh-family reuse invalidates the device', async () => {
    const db = await database()
    const bearer = await login(db, 'target', 'first-session')
    await invalidateRefreshTokenSession(db, owner, `${owner}:target`, initial)
    expect((await authorized(db, bearer)).status).toBe(401)
  })

  it('does not revive an old bearer when the same device signs in again', async () => {
    const db = await database()
    const old = await login(db, 'target', 'old-session')
    await revokeDeviceSession(db, {
      userId: owner,
      deviceId: `${owner}:target`,
      revokedAt: initial,
    })
    const next = await login(db, 'target', 'new-session')
    expect((await authorized(db, next)).status).toBe(200)
    expect((await authorized(db, old)).status).toBe(401)
  })

  it('allows only the final same-device concurrent login generation', async () => {
    const db = await database()
    const attempts = await Promise.all([
      login(db, 'target', 'concurrent-a'),
      login(db, 'target', 'concurrent-b'),
    ])
    const statuses = await Promise.all(
      attempts.map(async (bearer) => (await authorized(db, bearer)).status),
    )
    expect(statuses.sort()).toEqual([200, 401])
  })

  it('fails legacy sessionless bearer tokens closed, requiring a fresh login', async () => {
    const db = await database()
    await login(db, 'target', 'first-session')
    const legacy = await token('target')
    expect((await authorized(db, legacy)).status).toBe(401)
  })

  it('requires the existing device and exact session generation for bearer access', async () => {
    const db = await database()
    await login(db, 'target', 'first-session')
    for (const [device, sessionId] of [
      ['missing-device', 'first-session'],
      ['target', 'foreign-session'],
    ]) {
      expect(
        (await authorized(db, await token(device!, sessionId!))).status,
      ).toBe(401)
    }
  })

  it('rejects a foreign owner and disabled owner even with a known device family', async () => {
    const db = await database()
    const bearer = await login(db, 'target', 'first-session')
    const foreign = await signAccessToken(secret, {
      sub: '22222222-2222-4222-8222-222222222222',
      email: 'foreign@example.test',
      device: 'target',
      sessionId: 'first-session',
      securityStamp: stamp,
      iat: 1,
      exp: 4102444800,
    })
    expect((await authorized(db, foreign)).status).toBe(401)
    await db
      .prepare('UPDATE users SET disabled_at = ? WHERE id = ?')
      .bind(initial, owner)
      .run()
    expect((await authorized(db, bearer)).status).toBe(401)
  })

  it.each(['', 'a'.repeat(129), null, 42])(
    'rejects a malformed session claim before reading D1',
    async (sessionId) => {
      const prepare = vi.fn(() => {
        throw new Error('must not read D1')
      })
      const DB = { prepare } as unknown as D1Database
      const bearer = await signAccessToken(secret, {
        sub: owner,
        email: 'owner@example.test',
        device: 'target',
        sessionId,
        securityStamp: stamp,
        iat: 1,
        exp: 4102444800,
      } as AccessTokenClaims)
      expect((await authorized(DB, bearer)).status).toBe(401)
      expect(prepare).not.toHaveBeenCalled()
    },
  )

  it('keeps the immutable session family through refresh without invalidating its bearer', async () => {
    const db = await database()
    const original = await login(db, 'target', 'first-session')
    const response = await refresh(db, 'first-session')
    expect(response.status).toBe(200)
    const body = (await response.json()) as { access_token: string }
    expect(await verifyAccessToken(secret, body.access_token)).toMatchObject({
      ok: true,
      claims: { sessionId: 'first-session', authMethod: 'refresh' },
    })
    expect((await authorized(db, original)).status).toBe(200)
    expect((await authorized(db, body.access_token)).status).toBe(200)
    const rows = await db.prepare('SELECT session_id FROM refresh_tokens').all()
    expect(rows.results).toEqual([
      { session_id: 'first-session' },
      { session_id: 'first-session' },
    ])
  })

  it('does not let an older refresh family revoke or recreate a newer login', async () => {
    const db = await database()
    const old = await login(db, 'target', 'old-session')
    const next = await login(db, 'target', 'new-session')
    expect((await refresh(db, 'old-session')).status).toBe(400)
    expect((await authorized(db, old)).status).toBe(401)
    expect((await authorized(db, next)).status).toBe(200)
    // A now-revoked old-family token still must not revoke the newer session.
    expect((await refresh(db, 'old-session')).status).toBe(400)
    expect((await authorized(db, next)).status).toBe(200)
    expect((await refresh(db, 'new-session')).status).toBe(200)
  })

  it('invalidates an active family bearer when a previously rotated token is reused', async () => {
    const db = await database()
    const original = await login(db, 'target', 'first-session')
    const first = await refresh(db, 'first-session')
    expect(first.status).toBe(200)
    const body = (await first.json()) as { access_token: string }
    expect((await refresh(db, 'first-session')).status).toBe(400)
    expect((await authorized(db, original)).status).toBe(401)
    expect((await authorized(db, body.access_token)).status).toBe(401)
  })

  it('rejects a pre-migration refresh family without establishing a new session', async () => {
    const db = await database()
    await login(db, 'target', 'first-session')
    await db.prepare('UPDATE refresh_tokens SET session_id = NULL').run()
    expect((await refresh(db, 'first-session')).status).toBe(400)
    expect(
      (await db.prepare('SELECT id FROM refresh_tokens').all()).results,
    ).toHaveLength(1)
  })

  it('fails closed and logs a safe event when the device-bound lookup fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const DB = {
      prepare() {
        throw new Error('synthetic lookup failure')
      },
    } as unknown as D1Database
    const response = await authorized(
      DB,
      await token('target', 'first-session'),
    )
    expect(response.status).toBe(503)
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('vault_authentication_failed'),
    )
    expect(log.mock.calls.flat().join(' ')).not.toContain(secret)
  })
})

async function login(db: D1Database, device: string, sessionId: string) {
  expect(
    await createPasswordGrantSession(db, {
      userId: owner,
      expectedMasterPasswordHash: 'synthetic-hash',
      expectedSecurityStamp: stamp,
      deviceIdentifier: device,
      deviceName: null,
      deviceType: null,
      refreshTokenId: sessionId,
      refreshTokenHash: await hashRefreshToken(
        secret,
        `synthetic-refresh-${sessionId}`,
      ),
      refreshTokenExpiresAt: '2100-01-01T00:00:00.000Z',
      now: initial,
    }),
  ).toEqual({ status: 'created' })
  return token(device, sessionId)
}

function token(device: string, sessionId?: string) {
  return signAccessToken(secret, {
    sub: owner,
    email: 'owner@example.test',
    device,
    securityStamp: stamp,
    iat: 1,
    exp: 4102444800,
    ...(sessionId ? { sessionId } : {}),
  })
}

function authorized(DB: D1Database, bearer: string) {
  return app.request(
    '/api/accounts/revision-date',
    { headers: { Authorization: `Bearer ${bearer}` } },
    { DB, HONOWARDEN_TOKEN_SECRET: secret },
  )
}

function refresh(DB: D1Database, sessionId: string) {
  return app.request(
    '/identity/connect/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: `synthetic-refresh-${sessionId}`,
      }),
    },
    { DB, HONOWARDEN_TOKEN_SECRET: secret },
  )
}

async function database(): Promise<D1Database> {
  const instance = new Miniflare({
    compatibilityDate: '2026-07-21',
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: { DB: crypto.randomUUID() },
  })
  instances.push(instance)
  const db = await instance.getD1Database('DB')
  const root = fileURLToPath(
    new URL('../../migrations', import.meta.url).toString(),
  )
  for (const file of readdirSync(root)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const lines: string[] = []
    let inTrigger = false
    for (const line of readFileSync(`${root}/${file}`, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (lines.length === 0 && !trimmed) continue
      if (/^CREATE\s+TRIGGER\b/iu.test(trimmed)) inTrigger = true
      lines.push(line)
      if (inTrigger ? /^END;$/iu.test(trimmed) : trimmed.endsWith(';')) {
        await db.prepare(lines.join('\n')).run()
        lines.length = 0
        inTrigger = false
      }
    }
    if (lines.some((line) => line.trim()))
      throw new Error(`Incomplete migration: ${file}`)
  }
  await db
    .prepare(
      `INSERT INTO users (id, email, email_normalized, kdf_algorithm, kdf_iterations, master_password_hash, user_key, security_stamp, revision_date) VALUES (?, 'owner@example.test', 'owner@example.test', 'pbkdf2-sha256', 600000, 'synthetic-hash', '2.synthetic-wrapper', ?, ?)`,
    )
    .bind(owner, stamp, initial)
    .run()
  return db
}

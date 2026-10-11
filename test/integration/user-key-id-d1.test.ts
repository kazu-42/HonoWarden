import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it } from 'vitest'

import app from '../../src/app'
import { buildAuditEvent } from '../../src/domain/audit'
import { signAccessToken } from '../../src/domain/tokens'
import { findAuthUserById } from '../../src/repositories/auth-repository'
import { registerUserKeyId } from '../../src/repositories/user-key-id-repository'

const instances: Miniflare[] = []
const owner = '11111111-1111-4111-8111-111111111111'
const keyId = '0123456789abcdef0123456789abcdef'
const now = '2026-09-22T00:00:00.000Z'
const next = '2026-09-22T00:00:00.001Z'
const route = '/api/accounts/key-management/user-key-id'

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()))
})

describe('user-key ID registration on real local D1', () => {
  it('atomically registers and audits once, preserving the winning ID', async () => {
    const db = await createDatabase()
    expect(await registerUserKeyId(db, input())).toBe(true)
    for (const userKeyId of [keyId, 'f'.repeat(32)]) {
      expect(
        await registerUserKeyId(db, {
          ...input(),
          expectedRevisionDate: next,
          userKeyId,
        }),
      ).toBe(false)
    }
    expect(await state(db)).toEqual({ user_key_id: keyId, revision_date: next })
    const events = await db
      .prepare('SELECT name, context_json FROM audit_events')
      .all()
    expect(events.results).toEqual([
      { name: 'account.user_key_id.register', context_json: null },
    ])
    expect(await findAuthUserById(db, owner)).toMatchObject({
      userKeyId: keyId,
    })
  })

  it('allows exactly one concurrent same-millisecond winner', async () => {
    const db = await createDatabase()
    const attempts = await Promise.all(
      [0, 1, 2, 3].map((index) =>
        registerUserKeyId(db, {
          ...input(),
          userKeyId: index.toString().repeat(32),
        }),
      ),
    )
    expect(attempts.filter(Boolean)).toHaveLength(1)
    expect(
      (await db.prepare('SELECT id FROM audit_events').all()).results,
    ).toHaveLength(1)
  })

  it('rejects stale generations, disabled owners, and foreign owner IDs', async () => {
    const db = await createDatabase()
    for (const mismatch of [
      { expectedSecurityStamp: 'stale' },
      { expectedRevisionDate: next },
      { expectedUserKey: '2.stale' },
      { userId: 'foreign' },
    ]) {
      expect(await registerUserKeyId(db, { ...input(), ...mismatch })).toBe(
        false,
      )
    }
    await db
      .prepare('UPDATE users SET disabled_at = ? WHERE id = ?')
      .bind(now, owner)
      .run()
    expect(await registerUserKeyId(db, input())).toBe(false)
    expect(await state(db)).toEqual({ user_key_id: null, revision_date: now })
    expect(
      (await db.prepare('SELECT id FROM audit_events').all()).results,
    ).toHaveLength(0)
  })

  it('rolls back registration and revision when mandatory audit insertion fails', async () => {
    const db = await createDatabase()
    await db
      .prepare(
        "CREATE TRIGGER reject_id_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END",
      )
      .run()
    await expect(registerUserKeyId(db, input())).rejects.toThrow(
      'synthetic audit failure',
    )
    expect(await state(db)).toEqual({ user_key_id: null, revision_date: now })
    await db.prepare('DROP TRIGGER reject_id_audit').run()
    expect(await registerUserKeyId(db, input())).toBe(true)
  })

  it('enforces canonical IDs at the database boundary', async () => {
    const db = await createDatabase()
    for (const invalid of [
      '',
      'a'.repeat(31),
      'A'.repeat(32),
      'g'.repeat(32),
    ]) {
      await expect(
        db
          .prepare('UPDATE users SET user_key_id = ? WHERE id = ?')
          .bind(invalid, owner)
          .run(),
      ).rejects.toThrow()
    }
    expect(await state(db)).toEqual({ user_key_id: null, revision_date: now })
  })

  it('invalidates an unchanged ID when legacy writers replace a wrapped key', async () => {
    const db = await createDatabase()
    await registerUserKeyId(db, input())
    await db
      .prepare('UPDATE users SET user_key = ? WHERE id = ?')
      .bind('2.next-wrapper', owner)
      .run()
    expect((await state(db))?.user_key_id).toBeNull()
    const nextId = 'f'.repeat(32)
    await db
      .prepare('UPDATE users SET user_key_id = ? WHERE id = ?')
      .bind(keyId, owner)
      .run()
    await db
      .prepare('UPDATE users SET user_key = ?, user_key_id = ? WHERE id = ?')
      .bind('2.next-generation', nextId, owner)
      .run()
    expect((await state(db))?.user_key_id).toBe(nextId)
  })

  it('keeps the disabled route D1-free even with global quota enabled', async () => {
    const DB = {
      prepare() {
        throw new Error('must not access D1')
      },
    } as unknown as D1Database
    for (const method of ['GET', 'HEAD', 'POST']) {
      const response = await app.request(
        route,
        { method },
        { DB, HONOWARDEN_GLOBAL_REQUEST_QUOTA: 'true' },
      )
      expect(response.status).toBe(501)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
    }
  })

  it('requires authentication and bounded valid input, then returns an empty no-store 200', async () => {
    const db = await createDatabase()
    expect((await request(db, { userKeyId: keyId }, false)).status).toBe(401)
    for (const body of [
      {},
      { userKeyId: 'invalid' },
      { userKeyId: keyId, owner: 'foreign' },
      { userKeyId: 'a'.repeat(5000) },
    ]) {
      expect((await request(db, body)).status).toBe(400)
    }
    const response = await request(db, { userKeyId: keyId })
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.text()).toBe('')
    expect((await request(db, { userKeyId: keyId })).status).toBe(400)
    const sync = await app.request(
      '/api/sync',
      { headers: { Authorization: `Bearer ${await token()}` } },
      env(db),
    )
    expect(sync.status).toBe(200)
    expect(await sync.json()).toMatchObject({
      userDecryption: {
        userKeyId: keyId,
        masterPasswordUnlock: { containedKeyId: keyId },
      },
    })
  })

  it('reports infrastructure failure without claiming successful registration', async () => {
    const db = await createDatabase()
    await db
      .prepare(
        "CREATE TRIGGER reject_id_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END",
      )
      .run()
    const response = await request(db, { userKeyId: keyId })
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      error: { code: 'database_unavailable' },
    })
    expect((await state(db))?.user_key_id).toBeNull()
  })
})

function input() {
  return {
    userId: owner,
    userKeyId: keyId,
    expectedUserKey: '2.synthetic-wrapper',
    expectedSecurityStamp: 'stamp',
    expectedRevisionDate: now,
    nextRevisionDate: next,
    auditEvent: buildAuditEvent({
      name: 'account.user_key_id.register',
      outcome: 'success',
      requestId: 'synthetic-request',
      occurredAt: next,
      actor: { userId: owner, deviceIdentifier: 'synthetic-device' },
      target: { type: 'account', id: owner },
    }),
  }
}

function state(db: D1Database) {
  return db
    .prepare('SELECT user_key_id, revision_date FROM users WHERE id = ?')
    .bind(owner)
    .first()
}

function env(DB: D1Database) {
  return {
    DB,
    HONOWARDEN_USER_KEY_ID_ENABLED: 'true',
    HONOWARDEN_TOKEN_SECRET: 'synthetic-token-secret',
    HONOWARDEN_GLOBAL_REQUEST_QUOTA: 'false',
  }
}

function token() {
  return signAccessToken('synthetic-token-secret', {
    sub: owner,
    email: 'owner@example.test',
    device: 'synthetic-device',
    sessionId: 'synthetic-session-id',
    securityStamp: 'stamp',
    iat: 1,
    exp: 4102444800,
  })
}

async function request(db: D1Database, body: unknown, authenticated = true) {
  return app.request(
    route,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authenticated ? { Authorization: `Bearer ${await token()}` } : {}),
      },
      body: JSON.stringify(body),
    },
    env(db),
  )
}

async function createDatabase(): Promise<D1Database> {
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
      `INSERT INTO users (id, email, email_normalized, kdf_algorithm, kdf_iterations, master_password_hash, user_key, security_stamp, revision_date) VALUES (?, 'owner@example.test', 'owner@example.test', 'pbkdf2-sha256', 600000, 'synthetic-hash', '2.synthetic-wrapper', 'stamp', ?)`,
    )
    .bind(owner, now)
    .run()
  await db
    .prepare(
      `INSERT INTO devices (id, user_id, identifier, session_id) VALUES ('synthetic-device-id', ?, 'synthetic-device', 'synthetic-session-id')`,
    )
    .bind(owner)
    .run()
  return db
}

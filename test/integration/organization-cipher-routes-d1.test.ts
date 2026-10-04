import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Miniflare } from 'miniflare'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import app from '../../src/app'
import { signAccessToken } from '../../src/domain/tokens'

const instances: Miniflare[] = []
const initialRevision = '2026-10-01T00:00:00.000Z'
const secret = 'synthetic-org-route-token-secret'
const actor = 'assigned-member'
const creator = 'original-author'
const organizationId = 'synthetic-organization'
const collectionId = 'assigned-collection'
let requestClock = 0

beforeEach(() => {
  requestClock = Date.parse('2026-10-03T00:00:00.000Z')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(requestClock)
})

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()))
})

describe('organization cipher routes on real D1', () => {
  it.each([0, 1, 2])(
    'runs the full cipher lifecycle for assigned role %i without collection management rights',
    async (role) => {
      const db = await createDatabase({ role })
      const createdResponse = await request(db, 'POST', '/api/ciphers/create', {
        cipher: { ...payload(), organizationId, key: '2.initial-cipher-key' },
        collectionIds: [collectionId],
      })
      expect(createdResponse.status).toBe(200)
      const created = await createdResponse.json<Record<string, unknown>>()
      expect(created).toMatchObject({
        organizationId,
        collectionIds: [collectionId],
        key: '2.initial-cipher-key',
        edit: true,
        viewPassword: false,
      })
      const id = String(created.id)

      const updatedResponse = await request(db, 'PUT', `/api/ciphers/${id}`, {
        ...payload('2.updated-name'),
        organizationId,
        revisionDate: created.revisionDate,
        edit: false,
        viewPassword: true,
        permissions: { delete: false, restore: false },
        collectionIds: ['forged-unassigned-collection'],
      })
      expect(updatedResponse.status).toBe(200)
      const updated = await updatedResponse.json<Record<string, unknown>>()
      expect(updated).toMatchObject({
        id,
        name: '2.updated-name',
        organizationId,
        collectionIds: [collectionId],
        key: '2.initial-cipher-key',
        edit: true,
        viewPassword: false,
        permissions: { delete: true, restore: true },
      })
      expect(updated.revisionDate).not.toBe(created.revisionDate)
      for (const path of [`/api/ciphers/${id}`, '/api/ciphers', '/api/sync']) {
        const projection = await request(db, 'GET', path)
        expect(projection.status).toBe(200)
        const body = await projection.json<Record<string, unknown>>()
        const projectedCipher =
          path === '/api/ciphers'
            ? (body.data as Array<Record<string, unknown>>).find(
                (cipher) => cipher.id === id,
              )
            : path === '/api/sync'
              ? (body.ciphers as Array<Record<string, unknown>>).find(
                  (cipher) => cipher.id === id,
                )
              : body
        expect(projectedCipher).toMatchObject({
          id,
          permissions: { delete: true, restore: true },
        })
      }

      const rotatedResponse = await request(db, 'PUT', `/api/ciphers/${id}`, {
        ...payload('2.rotated-name'),
        organizationId,
        key: '2.rotated-cipher-key',
        lastKnownRevisionDate: updated.revisionDate,
      })
      expect(rotatedResponse.status).toBe(200)
      const rotated = await rotatedResponse.json<Record<string, unknown>>()
      expect(rotated).toMatchObject({
        organizationId,
        collectionIds: [collectionId],
        key: '2.rotated-cipher-key',
        edit: true,
        viewPassword: false,
      })
      const persisted = await cipherRow(db, id)
      expect(persisted).toMatchObject({
        organization_id: organizationId,
        cipher_key: '2.rotated-cipher-key',
        user_id: actor,
      })
      expect(JSON.parse(String(persisted?.encrypted_json))).toMatchObject({
        name: '2.rotated-name',
      })

      const trashedResponse = await request(
        db,
        'PUT',
        `/api/ciphers/${id}/delete`,
      )
      expect(trashedResponse.status).toBe(200)
      expect(await cipherRow(db, id)).toMatchObject({
        deleted_at: expect.any(String),
      })
      const restoredResponse = await request(
        db,
        'PUT',
        `/api/ciphers/${id}/restore`,
      )
      expect(restoredResponse.status).toBe(200)
      expect(await cipherRow(db, id)).toMatchObject({
        deleted_at: null,
        organization_id: organizationId,
        cipher_key: '2.rotated-cipher-key',
      })
      const readResponse = await request(db, 'GET', `/api/ciphers/${id}`)
      expect(readResponse.status).toBe(200)
      expect(await readResponse.json()).toMatchObject({
        organizationId,
        collectionIds: [collectionId],
        key: '2.rotated-cipher-key',
        edit: true,
        viewPassword: false,
      })
      const deletedResponse = await request(db, 'DELETE', `/api/ciphers/${id}`)
      expect(deletedResponse.status).toBe(200)
      expect(await cipherRow(db, id)).toBeNull()
      expect(
        (
          await db
            .prepare('SELECT * FROM collection_ciphers WHERE cipher_id = ?')
            .bind(id)
            .all()
        ).results,
      ).toEqual([])
    },
  )

  it('projects readonly and hidden-password assignments while denying every mutation without state changes', async () => {
    const db = await createDatabase({ readOnly: true })
    await seedCipher(db)
    await seedCipher(db, 'trashed-cipher', initialRevision)
    await db
      .prepare('UPDATE ciphers SET encrypted_json = ?')
      .bind(
        JSON.stringify({
          ...payload(),
          permissions: { delete: true, restore: true },
        }),
      )
      .run()
    const before = await snapshot(db)
    const read = await request(db, 'GET', '/api/ciphers/shared-cipher')
    expect(read.status).toBe(200)
    expect(await read.json()).toMatchObject({
      edit: false,
      viewPassword: false,
      permissions: { delete: false, restore: false },
      organizationId,
      collectionIds: [collectionId],
    })
    const sync = await request(db, 'GET', '/api/sync')
    expect(sync.status).toBe(200)
    expect(await sync.json()).toMatchObject({
      ciphers: expect.arrayContaining([
        expect.objectContaining({
          id: 'shared-cipher',
          edit: false,
          viewPassword: false,
          permissions: { delete: false, restore: false },
        }),
      ]),
    })
    const list = await request(db, 'GET', '/api/ciphers')
    expect(list.status).toBe(200)
    expect(await list.json()).toMatchObject({
      data: expect.arrayContaining([
        expect.objectContaining({
          id: 'shared-cipher',
          edit: false,
          permissions: { delete: false, restore: false },
        }),
      ]),
    })
    await expectMutationsDenied(db)
    expect(
      (await request(db, 'PUT', '/api/ciphers/trashed-cipher/restore')).status,
    ).toBe(404)
    expect(
      (
        await request(db, 'POST', '/api/ciphers/create', {
          cipher: { ...payload(), organizationId, key: '2.new-key' },
          collectionIds: [collectionId],
        })
      ).status,
    ).toBe(404)
    expect(await snapshot(db)).toEqual(before)
  })

  it.each(['membership_revoked', 'organization_disabled'] as const)(
    'denies %s despite a valid active device session',
    async (reason) => {
      const db = await createDatabase()
      await seedCipher(db)
      await seedCipher(db, 'trashed-cipher', initialRevision)
      if (reason === 'membership_revoked') {
        await db
          .prepare('UPDATE organization_users SET status = 0 WHERE user_id = ?')
          .bind(actor)
          .run()
      } else {
        await db
          .prepare('UPDATE organizations SET enabled = 0 WHERE id = ?')
          .bind(organizationId)
          .run()
      }
      const before = await snapshot(db)
      expect(
        (await request(db, 'GET', '/api/ciphers/shared-cipher')).status,
      ).toBe(404)
      await expectMutationsDenied(db)
      expect(
        (await request(db, 'PUT', '/api/ciphers/trashed-cipher/restore'))
          .status,
      ).toBe(404)
      expect(await snapshot(db)).toEqual(before)
    },
  )

  it.each(['assignment', 'membership', 'organization'] as const)(
    'rechecks %s revocation in the actual SQL write after route preflight',
    async (scope) => {
      const db = await createDatabase()
      await seedCipher(db)
      const before = await snapshot(db)
      let intercepted = false
      const revoke = async () => {
        intercepted = true
        if (scope === 'assignment') {
          await db
            .prepare(
              'UPDATE collection_users SET read_only = 1 WHERE collection_id = ?',
            )
            .bind(collectionId)
            .run()
        } else if (scope === 'membership') {
          await db
            .prepare(
              'UPDATE organization_users SET status = 0 WHERE user_id = ?',
            )
            .bind(actor)
            .run()
        } else {
          await db
            .prepare('UPDATE organizations SET enabled = 0 WHERE id = ?')
            .bind(organizationId)
            .run()
        }
      }
      const guardedDb = {
        prepare(sql: string) {
          const statement = db.prepare(sql)
          if (!/^\s*UPDATE\s+ciphers\b/iu.test(sql)) return statement
          let bound = statement
          const wrapper = {
            bind(...values: unknown[]) {
              bound = statement.bind(...values)
              return wrapper
            },
            async first<T = unknown>(column?: string): Promise<T | null> {
              await revoke()
              return bound.first<T>(column)
            },
            all: <T = unknown>() => bound.all<T>(),
            run: <T = unknown>() => bound.run<T>(),
            raw: <T = unknown>() => bound.raw<T>(),
          } as D1PreparedStatement
          return wrapper
        },
        batch: db.batch.bind(db),
      } as unknown as D1Database
      const response = await request(
        guardedDb,
        'PUT',
        '/api/ciphers/shared-cipher',
        {
          ...payload('2.must-not-commit'),
          revisionDate: initialRevision,
          key: '2.must-not-replace',
        },
      )
      expect(intercepted).toBe(true)
      expect(response.status).toBe(404)
      expect(await snapshot(db)).toEqual(before)
    },
  )

  it('denies the original author a personal ownership bypass after the cipher belongs to an organization', async () => {
    const db = await createDatabase()
    await seedCipher(db)
    await seedCipher(db, 'trashed-cipher', initialRevision)
    const before = await snapshot(db)
    expect(
      (
        await request(
          db,
          'GET',
          '/api/ciphers/shared-cipher',
          undefined,
          creator,
        )
      ).status,
    ).toBe(404)
    await expectMutationsDenied(db, creator)
    expect(
      (
        await request(
          db,
          'PUT',
          '/api/ciphers/trashed-cipher/restore',
          undefined,
          creator,
        )
      ).status,
    ).toBe(404)
    expect(await snapshot(db)).toEqual(before)
  })

  it.each(['device_revoked', 'user_disabled', 'wrong_session'] as const)(
    'rejects %s before reading or mutating an assigned cipher',
    async (reason) => {
      const db = await createDatabase()
      await seedCipher(db)
      if (reason === 'device_revoked')
        await db
          .prepare('UPDATE devices SET revoked_at = ? WHERE user_id = ?')
          .bind(initialRevision, actor)
          .run()
      if (reason === 'user_disabled')
        await db
          .prepare('UPDATE users SET disabled_at = ? WHERE id = ?')
          .bind(initialRevision, actor)
          .run()
      const before = await snapshot(db)
      for (const [method, path] of [
        ['GET', '/api/ciphers/shared-cipher'],
        ['PUT', '/api/ciphers/shared-cipher'],
        ['PUT', '/api/ciphers/shared-cipher/delete'],
        ['DELETE', '/api/ciphers/shared-cipher'],
      ] as const) {
        const response = await request(
          db,
          method,
          path,
          method === 'PUT' && !path.endsWith('/delete')
            ? { ...payload(), revisionDate: initialRevision }
            : undefined,
          actor,
          reason === 'wrong_session' ? 'retired-session' : undefined,
        )
        expect(response.status).toBe(401)
      }
      expect(await snapshot(db)).toEqual(before)
    },
  )

  it('rejects forged organization, personal folder, and malformed key inputs without changing ciphertext or mappings', async () => {
    const db = await createDatabase()
    await seedCipher(db)
    await db
      .prepare(
        'INSERT INTO folders (id, user_id, encrypted_name, revision_date) VALUES (?, ?, ?, ?)',
      )
      .bind('personal-folder', actor, '2.folder', initialRevision)
      .run()
    const before = await snapshot(db)
    for (const extras of [
      { organizationId: 'other-organization' },
      { organizationId: null },
      { folderId: 'personal-folder' },
      { key: '' },
      { key: null },
      { key: {} },
      { key: 'あ'.repeat(21_846) },
    ]) {
      const response = await request(db, 'PUT', '/api/ciphers/shared-cipher', {
        ...payload(),
        revisionDate: initialRevision,
        ...extras,
      })
      expect(response.status).toBe(400)
      expect(await snapshot(db)).toEqual(before)
    }
  })

  it('returns a stale-revision conflict without replacing either ciphertext or its key', async () => {
    const db = await createDatabase()
    await seedCipher(db)
    const before = await snapshot(db)
    const response = await request(db, 'PUT', '/api/ciphers/shared-cipher', {
      ...payload('2.conflicting-name'),
      organizationId,
      key: '2.conflicting-key',
      revisionDate: '2026-09-01T00:00:00.000Z',
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: { code: 'revision_conflict' },
    })
    expect(await snapshot(db)).toEqual(before)
  })

  it('derives response password visibility from assigned mapped collections', async () => {
    const db = await createDatabase()
    await seedCipher(db)
    await db
      .prepare(
        'UPDATE collection_users SET hide_passwords = 0 WHERE collection_id = ?',
      )
      .bind(collectionId)
      .run()
    const response = await request(db, 'PUT', '/api/ciphers/shared-cipher', {
      ...payload(),
      revisionDate: initialRevision,
      edit: false,
      viewPassword: false,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      edit: true,
      viewPassword: true,
      organizationId,
      collectionIds: [collectionId],
    })
  })
})

function payload(name = '2.synthetic-name') {
  return {
    type: 1,
    name,
    folderId: null,
    favorite: false,
    login: {
      username: '2.synthetic-username',
      password: '2.synthetic-password',
      uris: [],
    },
  }
}

async function request(
  db: D1Database,
  method: string,
  path: string,
  body?: unknown,
  userId = actor,
  sessionId?: string,
) {
  requestClock += 1_000
  vi.setSystemTime(requestClock)
  const token = await signAccessToken(secret, {
    sub: userId,
    email: `${userId}@example.test`,
    device: 'synthetic-device',
    sessionId: sessionId ?? `${userId}-active-session`,
    securityStamp: 'synthetic-stamp',
    iat: 1,
    exp: 4_102_444_800,
  })
  return app.request(
    path,
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    {
      DB: db,
      HONOWARDEN_TOKEN_SECRET: secret,
      HONOWARDEN_GLOBAL_REQUEST_QUOTA: 'false',
      HONOWARDEN_ENV: 'development',
    },
  )
}

async function expectMutationsDenied(db: D1Database, userId = actor) {
  for (const [method, path, body] of [
    [
      'PUT',
      '/api/ciphers/shared-cipher',
      { ...payload(), revisionDate: initialRevision },
    ],
    ['PUT', '/api/ciphers/shared-cipher/delete', undefined],
    ['DELETE', '/api/ciphers/shared-cipher', undefined],
  ] as const) {
    expect((await request(db, method, path, body, userId)).status).toBe(404)
  }
}

async function cipherRow(db: D1Database, id: string) {
  return db
    .prepare('SELECT * FROM ciphers WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>()
}

async function snapshot(db: D1Database) {
  const [ciphers, mappings] = await Promise.all([
    db.prepare('SELECT * FROM ciphers ORDER BY id').all(),
    db
      .prepare(
        'SELECT * FROM collection_ciphers ORDER BY collection_id, cipher_id',
      )
      .all(),
  ])
  return { ciphers: ciphers.results, mappings: mappings.results }
}

async function seedCipher(
  db: D1Database,
  id = 'shared-cipher',
  deletedAt: string | null = null,
) {
  await db.batch([
    db
      .prepare(
        'INSERT INTO ciphers (id, user_id, organization_id, type, encrypted_json, cipher_key, revision_date, updated_at, deleted_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)',
      )
      .bind(
        id,
        creator,
        organizationId,
        JSON.stringify(payload()),
        '2.initial-cipher-key',
        initialRevision,
        initialRevision,
        deletedAt,
      ),
    db
      .prepare(
        'INSERT INTO collection_ciphers (collection_id, cipher_id) VALUES (?, ?)',
      )
      .bind(collectionId, id),
  ])
}

async function createDatabase(
  options: { role?: number; readOnly?: boolean } = {},
) {
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
  for (const userId of [actor, creator]) {
    await db.batch([
      db
        .prepare(
          'INSERT INTO users (id, email, email_normalized, kdf_algorithm, kdf_iterations, master_password_hash, security_stamp, revision_date) VALUES (?, ?, ?, ?, 600000, ?, ?, ?)',
        )
        .bind(
          userId,
          `${userId}@example.test`,
          `${userId}@example.test`,
          'pbkdf2-sha256',
          'synthetic-hash',
          'synthetic-stamp',
          initialRevision,
        ),
      db
        .prepare(
          'INSERT INTO devices (id, user_id, identifier, session_id) VALUES (?, ?, ?, ?)',
        )
        .bind(
          `${userId}:synthetic-device`,
          userId,
          'synthetic-device',
          `${userId}-active-session`,
        ),
    ])
  }
  await db.batch([
    db
      .prepare(
        'INSERT INTO organizations (id, name, revision_date) VALUES (?, ?, ?)',
      )
      .bind(organizationId, 'Synthetic organization', initialRevision),
    db
      .prepare(
        'INSERT INTO organization_users (id, organization_id, user_id, email, status, type) VALUES (?, ?, ?, ?, 2, ?)',
      )
      .bind(
        'assigned-membership',
        organizationId,
        actor,
        `${actor}@example.test`,
        options.role ?? 2,
      ),
    db
      .prepare(
        'INSERT INTO collections (id, organization_id, encrypted_name, revision_date) VALUES (?, ?, ?, ?)',
      )
      .bind(
        collectionId,
        organizationId,
        '2.synthetic-collection',
        initialRevision,
      ),
    db
      .prepare(
        'INSERT INTO collection_users (collection_id, organization_user_id, manage, read_only, hide_passwords) VALUES (?, ?, 0, ?, 1)',
      )
      .bind(collectionId, 'assigned-membership', options.readOnly ? 1 : 0),
  ])
  return db
}

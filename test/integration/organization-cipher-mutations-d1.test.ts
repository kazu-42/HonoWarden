import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it } from 'vitest'

import {
  permanentlyDeleteOrganizationCipher,
  restoreOrganizationCipher,
  softDeleteOrganizationCipher,
  updateOrganizationCipher,
} from '../../src/repositories/organization-cipher-mutation-repository'

const owner = 'cipher-creator'
const caller = 'ordinary-member'
const originalRevision = '2026-10-03T00:00:00.000Z'
const nextRevision = '2026-10-03T00:00:01.000Z'
const laterRevision = '2026-10-03T00:00:02.000Z'
const instances: Miniflare[] = []

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()))
})

describe('organization cipher mutations on real local D1', () => {
  it('allows an ordinary assigned writable member without collection management and preserves ownership/key/mappings', async () => {
    const database = await createDatabase()
    await expect(
      updateOrganizationCipher(database, updateInput()),
    ).resolves.toMatchObject({
      status: 'updated',
      cipher: {
        id: 'cipher',
        userId: owner,
        organizationId: 'org',
        cipherKey: '2.original-key',
        encryptedJson: '{"name":"2.updated"}',
        type: 2,
        favorite: true,
        createdAt: originalRevision,
        folderId: null,
        revisionDate: nextRevision,
      },
    })
    const state = await readState(database)
    expect(state.cipher).toMatchObject({
      user_id: owner,
      organization_id: 'org',
      cipher_key: '2.original-key',
      encrypted_json: '{"name":"2.updated"}',
      type: 2,
      favorite: 1,
      folder_id: null,
    })
    expect(state.mappings).toEqual([
      { collection_id: 'collection', cipher_id: 'cipher' },
    ])
  })

  it('atomically selects one concurrent update winner and reports the accessible current revision', async () => {
    const database = await createDatabase()
    const results = await Promise.all([
      updateOrganizationCipher(database, updateInput()),
      updateOrganizationCipher(database, {
        ...updateInput(),
        encryptedJson: '{"name":"2.competitor"}',
        revisionDate: laterRevision,
      }),
    ])
    expect(results.map((result) => result.status).sort()).toEqual([
      'conflict',
      'updated',
    ])
    const winner = results.find((result) => result.status === 'updated')!
    const loser = results.find((result) => result.status === 'conflict')!
    expect(loser.currentRevisionDate).toBe(winner.cipher.revisionDate)
    expect((await readState(database)).cipher).toMatchObject({
      encrypted_json: winner.cipher.encryptedJson,
      revision_date: winner.cipher.revisionDate,
    })
  })

  it('updates the wrapped key and encrypted payload in the same CAS while preserving organization, provenance, and collections', async () => {
    const database = await createDatabase()
    await expect(
      updateOrganizationCipher(database, {
        ...updateInput(),
        cipherKey: '2.updated-wrapped-key',
      }),
    ).resolves.toMatchObject({
      status: 'updated',
      cipher: {
        cipherKey: '2.updated-wrapped-key',
        encryptedJson: '{"name":"2.updated"}',
      },
    })
    expect(await readState(database)).toMatchObject({
      cipher: {
        cipher_key: '2.updated-wrapped-key',
        encrypted_json: '{"name":"2.updated"}',
        user_id: owner,
        organization_id: 'org',
      },
      mappings: [{ collection_id: 'collection', cipher_id: 'cipher' }],
    })
    const updated = await readState(database)
    await expect(
      updateOrganizationCipher(database, {
        ...updateInput(),
        revisionDate: laterRevision,
        cipherKey: '2.stale-wrapped-key',
        encryptedJson: '{"name":"2.stale"}',
      }),
    ).resolves.toEqual({
      status: 'conflict',
      currentRevisionDate: nextRevision,
    })
    expect(await readState(database)).toEqual(updated)
  })

  it.each(['', 'x'.repeat(65537), 'é'.repeat(32769)])(
    'rejects invalid wrapped key size without changing either key or payload (%#)',
    async (cipherKey) => {
      const database = await createDatabase()
      const before = await readState(database)
      await expect(
        updateOrganizationCipher(database, { ...updateInput(), cipherKey }),
      ).rejects.toThrow(TypeError)
      expect(await readState(database)).toEqual(before)
    },
  )

  it('accepts an opaque wrapped key at the UTF-8 byte limit', async () => {
    const database = await createDatabase()
    const cipherKey = 'é'.repeat(32768)
    await expect(
      updateOrganizationCipher(database, { ...updateInput(), cipherKey }),
    ).resolves.toMatchObject({ status: 'updated', cipher: { cipherKey } })
    expect((await readState(database)).cipher?.cipher_key).toBe(cipherKey)
  })

  it('supports soft delete, restore, and permanent delete with mapped-collection cascades', async () => {
    const database = await createDatabase()
    await expect(
      softDeleteOrganizationCipher(database, {
        id: 'cipher',
        userId: caller,
        deletedAt: nextRevision,
        expectedRevisionDate: originalRevision,
      }),
    ).resolves.toEqual({
      status: 'deleted',
      id: 'cipher',
      revisionDate: nextRevision,
      deletedAt: nextRevision,
    })
    expect((await readState(database)).cipher?.deleted_at).toBe(nextRevision)
    await expect(
      restoreOrganizationCipher(database, {
        id: 'cipher',
        userId: caller,
        revisionDate: laterRevision,
        expectedRevisionDate: nextRevision,
      }),
    ).resolves.toEqual({
      status: 'restored',
      id: 'cipher',
      revisionDate: laterRevision,
    })
    expect((await readState(database)).cipher?.deleted_at).toBeNull()
    await expect(
      permanentlyDeleteOrganizationCipher(database, {
        id: 'cipher',
        userId: caller,
        revisionDate: laterRevision,
      }),
    ).resolves.toEqual({
      status: 'deleted',
      id: 'cipher',
      revisionDate: laterRevision,
    })
    expect(await readState(database)).toMatchObject({
      cipher: null,
      mappings: [],
    })
  })

  it.each([originalRevision, '2026-10-02T00:00:00.000Z'])(
    'rejects a nonadvancing revision %s so revision guards cannot be reused',
    async (revisionDate) => {
      const database = await createDatabase()
      const before = await readState(database)
      await expect(
        updateOrganizationCipher(database, { ...updateInput(), revisionDate }),
      ).resolves.toEqual({
        status: 'conflict',
        currentRevisionDate: originalRevision,
      })
      await expect(
        softDeleteOrganizationCipher(database, {
          id: 'cipher',
          userId: caller,
          deletedAt: revisionDate,
          expectedRevisionDate: originalRevision,
        }),
      ).resolves.toEqual({
        status: 'conflict',
        currentRevisionDate: originalRevision,
      })
      expect(await readState(database)).toEqual(before)
      await database
        .prepare('UPDATE ciphers SET deleted_at = ? WHERE id = ?')
        .bind(originalRevision, 'cipher')
        .run()
      const trashed = await readState(database)
      await expect(
        restoreOrganizationCipher(database, {
          id: 'cipher',
          userId: caller,
          revisionDate,
          expectedRevisionDate: originalRevision,
        }),
      ).resolves.toEqual({
        status: 'conflict',
        currentRevisionDate: originalRevision,
      })
      expect(await readState(database)).toEqual(trashed)
    },
  )

  it('enforces lifecycle revision guards without changing stale data', async () => {
    const database = await createDatabase()
    const before = await readState(database)
    const input = {
      id: 'cipher',
      userId: caller,
      revisionDate: nextRevision,
      expectedRevisionDate: 'stale',
    }
    await expect(
      softDeleteOrganizationCipher(database, {
        ...input,
        deletedAt: nextRevision,
      }),
    ).resolves.toEqual({
      status: 'conflict',
      currentRevisionDate: originalRevision,
    })
    await expect(
      permanentlyDeleteOrganizationCipher(database, input),
    ).resolves.toEqual({
      status: 'conflict',
      currentRevisionDate: originalRevision,
    })
    expect(await readState(database)).toEqual(before)
    await database
      .prepare('UPDATE ciphers SET deleted_at = ? WHERE id = ?')
      .bind(originalRevision, 'cipher')
      .run()
    const trashed = await readState(database)
    await expect(restoreOrganizationCipher(database, input)).resolves.toEqual({
      status: 'conflict',
      currentRevisionDate: originalRevision,
    })
    expect(await readState(database)).toEqual(trashed)
  })

  it.each([
    ['readonly', 'UPDATE collection_users SET read_only = 1'],
    ['revoked', 'UPDATE organization_users SET status = 3'],
    ['nonmember', 'DELETE FROM organization_users'],
    [
      'disabled organization',
      "UPDATE organizations SET enabled = 0 WHERE id = 'org'",
    ],
    ['unassigned', 'DELETE FROM collection_users'],
    ['unsupported member role', 'UPDATE organization_users SET type = 3'],
    [
      'cross organization collection',
      "UPDATE collections SET organization_id = 'other-org'",
    ],
    ['personal cipher', 'UPDATE ciphers SET organization_id = NULL'],
  ])(
    'denies %s across all mutations with no revision or encrypted data disclosure',
    async (_label, sql) => {
      const database = await createDatabase()
      await database.prepare(sql).run()
      await expectAllMutationsDenied(database)
    },
  )

  it('denies a historical creator who lacks a writable organization assignment', async () => {
    const database = await createDatabase()
    const before = await readState(database)
    await expect(
      updateOrganizationCipher(database, { ...updateInput(), userId: owner }),
    ).resolves.toEqual({ status: 'not_found' })
    await expect(
      softDeleteOrganizationCipher(database, {
        id: 'cipher',
        userId: owner,
        deletedAt: nextRevision,
      }),
    ).resolves.toEqual({ status: 'not_found' })
    await expect(
      permanentlyDeleteOrganizationCipher(database, {
        id: 'cipher',
        userId: owner,
        revisionDate: nextRevision,
      }),
    ).resolves.toEqual({ status: 'not_found' })
    expect(await readState(database)).toEqual(before)
  })

  it('rejects unsupported organization attachments before metadata or object inventory can be lost', async () => {
    const database = await createDatabase()
    await database
      .prepare(
        `INSERT INTO cipher_attachments (
      id, user_id, cipher_id, object_key, file_name, attachment_key, size, revision_date
    ) VALUES ('attachment', ?, 'cipher', 'synthetic-object', '2.filename', '2.key', 1, ?)`,
      )
      .bind(owner, originalRevision)
      .run()
    await expectAllMutationsDenied(database)
    expect(
      await database
        .prepare('SELECT object_key FROM cipher_attachments')
        .first(),
    ).toEqual({ object_key: 'synthetic-object' })
  })

  it('does not borrow a writable grant from an unrelated collection', async () => {
    const database = await createDatabase()
    await database.prepare('UPDATE collection_users SET read_only = 1').run()
    await database
      .prepare(
        `INSERT INTO collections (id, organization_id, encrypted_name, revision_date) VALUES ('unrelated', 'org', '2.name', ?)`,
      )
      .bind(originalRevision)
      .run()
    await database
      .prepare(
        `INSERT INTO collection_users (collection_id, organization_user_id, read_only, manage) VALUES ('unrelated', 'member', 0, 1)`,
      )
      .run()
    await expectAllMutationsDenied(database)
  })

  it('does not return a stale revision to a member revoked between mutation and conflict readback', async () => {
    const database = await createDatabase()
    const wrapped: Pick<D1Database, 'prepare'> = {
      prepare(query) {
        const statement = database.prepare(query)
        if (!query.includes('UPDATE ciphers')) return statement
        return {
          ...statement,
          bind(...values: unknown[]) {
            const bound = statement.bind(...values)
            return {
              ...bound,
              async first<T>() {
                const result = await bound.first<T>()
                await database
                  .prepare('UPDATE organization_users SET status = 3')
                  .run()
                return result
              },
            } as D1PreparedStatement
          },
        } as D1PreparedStatement
      },
    }
    await expect(
      updateOrganizationCipher(wrapped, {
        ...updateInput(),
        expectedRevisionDate: 'stale',
      }),
    ).resolves.toEqual({ status: 'not_found' })
    expect((await readState(database)).cipher?.revision_date).toBe(
      originalRevision,
    )
  })
})

function updateInput() {
  return {
    id: 'cipher',
    userId: caller,
    type: 2,
    favorite: true,
    encryptedJson: '{"name":"2.updated"}',
    revisionDate: nextRevision,
    expectedRevisionDate: originalRevision,
  }
}

async function expectAllMutationsDenied(database: D1Database) {
  const before = await readState(database)
  await expect(
    updateOrganizationCipher(database, {
      ...updateInput(),
      expectedRevisionDate: 'stale',
    }),
  ).resolves.toEqual({ status: 'not_found' })
  await expect(
    softDeleteOrganizationCipher(database, {
      id: 'cipher',
      userId: caller,
      deletedAt: nextRevision,
      expectedRevisionDate: 'stale',
    }),
  ).resolves.toEqual({ status: 'not_found' })
  await expect(
    permanentlyDeleteOrganizationCipher(database, {
      id: 'cipher',
      userId: caller,
      revisionDate: nextRevision,
      expectedRevisionDate: 'stale',
    }),
  ).resolves.toEqual({ status: 'not_found' })
  expect(await readState(database)).toEqual(before)
  await database
    .prepare('UPDATE ciphers SET deleted_at = ? WHERE id = ?')
    .bind(originalRevision, 'cipher')
    .run()
  const trashed = await readState(database)
  await expect(
    restoreOrganizationCipher(database, {
      id: 'cipher',
      userId: caller,
      revisionDate: nextRevision,
      expectedRevisionDate: 'stale',
    }),
  ).resolves.toEqual({ status: 'not_found' })
  expect(await readState(database)).toEqual(trashed)
}

async function readState(database: D1Database) {
  return {
    cipher: await database
      .prepare('SELECT * FROM ciphers WHERE id = ?')
      .bind('cipher')
      .first<Record<string, unknown>>(),
    mappings: (
      await database
        .prepare('SELECT * FROM collection_ciphers ORDER BY collection_id')
        .all()
    ).results,
  }
}

async function createDatabase(): Promise<D1Database> {
  const instance = new Miniflare({
    compatibilityDate: '2026-07-21',
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: { DB: crypto.randomUUID() },
  })
  instances.push(instance)
  const database = await instance.getD1Database('DB')
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
        await database.prepare(lines.join('\n')).run()
        lines.length = 0
        inTrigger = false
      }
    }
    if (lines.some((line) => line.trim()))
      throw new Error(`Incomplete migration: ${file}`)
  }
  for (const id of [owner, caller]) {
    await database
      .prepare(
        `INSERT INTO users (id, email, email_normalized, kdf_algorithm, kdf_iterations, master_password_hash, security_stamp, revision_date) VALUES (?, ?, ?, 'pbkdf2-sha256', 600000, 'synthetic-hash', 'synthetic-stamp', ?)`,
      )
      .bind(id, `${id}@example.test`, `${id}@example.test`, originalRevision)
      .run()
  }
  for (const id of ['org', 'other-org']) {
    await database
      .prepare(
        'INSERT INTO organizations (id, name, revision_date) VALUES (?, ?, ?)',
      )
      .bind(id, 'Synthetic organization', originalRevision)
      .run()
  }
  await database
    .prepare(
      `INSERT INTO organization_users (id, organization_id, user_id, email, status, type) VALUES ('member', 'org', ?, ?, 2, 2)`,
    )
    .bind(caller, `${caller}@example.test`)
    .run()
  await database
    .prepare(
      `INSERT INTO collections (id, organization_id, encrypted_name, revision_date) VALUES ('collection', 'org', '2.name', ?)`,
    )
    .bind(originalRevision)
    .run()
  await database
    .prepare(
      `INSERT INTO collection_users (collection_id, organization_user_id, read_only, manage) VALUES ('collection', 'member', 0, 0)`,
    )
    .run()
  await database
    .prepare(
      `INSERT INTO ciphers (id, user_id, organization_id, type, encrypted_json, revision_date, cipher_key, created_at, updated_at) VALUES ('cipher', ?, 'org', 1, '{"name":"2.original"}', ?, '2.original-key', ?, ?)`,
    )
    .bind(owner, originalRevision, originalRevision, originalRevision)
    .run()
  await database
    .prepare(
      `INSERT INTO collection_ciphers (collection_id, cipher_id) VALUES ('collection', 'cipher')`,
    )
    .run()
  return database as unknown as D1Database
}

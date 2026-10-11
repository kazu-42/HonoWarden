import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createOrganizationCollection,
  createOrganizationFoundation,
  deleteOrganizationCollection,
  deleteOrganizationCollections,
  findAccessibleOrganizationCollection,
  findConfirmedOrganizationOwner,
  findOrganizationForConfirmedMember,
  findOwnerOrganizationCollection,
  listAccessibleOrganizationCollections,
  listAccessibleOrganizationCollectionsByOrganization,
  listConfirmedOrganizationMemberships,
  listOrganizationCollectionUsersForOwner,
  updateOrganizationCollection,
} from '../../src/repositories/organization-repository'

const instances: Miniflare[] = []
const now = '2026-10-03T00:00:00.000Z'
const next = '2026-10-03T00:00:01.000Z'
const scope = {
  organizationId: 'org',
  collectionId: 'collection',
  userId: 'owner',
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()))
})

describe('organization authorization on real local D1', () => {
  it('restricts additional organization creation to a confirmed Owner inside the insert', async () => {
    const db = await createDatabase()
    const foundation = (userId: string, organizationId: string) => ({
      restrictCreation: true,
      organizationId,
      organizationUserId: `${organizationId}-owner`,
      collectionId: `${organizationId}-collection`,
      userId,
      email: `${userId}@example.test`,
      name: 'Next team',
      billingEmail: null,
      planType: 0,
      orgKey: '2.wrapper',
      publicKey: 'public',
      privateKey: '2.private',
      encryptedCollectionName: '2.collection',
      now: next,
    })
    expect(
      await createOrganizationFoundation(db, foundation('outsider', 'blocked')),
    ).toBeNull()
    expect(
      await db
        .prepare("SELECT id FROM organizations WHERE id='blocked'")
        .first(),
    ).toBeNull()
    expect(
      await createOrganizationFoundation(db, {
        ...foundation('owner', 'stale-session'),
        actor: {
          userId: 'owner',
          deviceIdentifier: 'desktop',
          sessionId: 'stale',
        },
      }),
    ).toBeNull()
    expect(
      (await createOrganizationFoundation(db, foundation('owner', 'allowed')))
        ?.organization.id,
    ).toBe('allowed')
    await db
      .prepare("UPDATE organization_users SET status=1 WHERE id='membership'")
      .run()
    expect(
      await createOrganizationFoundation(
        db,
        foundation('outsider', 'blocked-again'),
      ),
    ).toBeNull()
  })

  it('requires the existing Owner to satisfy an enabled TOTP policy', async () => {
    const db = await createDatabase()
    await db
      .prepare(
        `INSERT INTO organization_policies
      (id,organization_id,type,enabled,revision_date,created_at,updated_at)
      VALUES ('required','org',0,1,?,?,?)`,
      )
      .bind(now, now, now)
      .run()
    expect(
      await createOrganizationFoundation(db, {
        restrictCreation: true,
        organizationId: 'blocked-by-policy',
        organizationUserId: 'blocked-owner',
        collectionId: 'blocked-collection',
        userId: 'owner',
        email: 'owner@example.test',
        name: 'Another company',
        billingEmail: null,
        planType: 0,
        orgKey: '2.wrapper',
        publicKey: 'public',
        privateKey: '2.private',
        encryptedCollectionName: '2.collection',
        now: next,
      }),
    ).toBeNull()
  })

  it('admits at most one concurrent first organization creation', async () => {
    const db = await createDatabase()
    await db.prepare('DELETE FROM organizations').run()
    const create = (userId: string) =>
      createOrganizationFoundation(db, {
        restrictCreation: true,
        organizationId: `first-${userId}`,
        organizationUserId: `first-${userId}-owner`,
        collectionId: `first-${userId}-collection`,
        userId,
        email: `${userId}@example.test`,
        name: 'First company',
        billingEmail: null,
        planType: 0,
        orgKey: '2.wrapper',
        publicKey: 'public',
        privateKey: '2.private',
        encryptedCollectionName: '2.collection',
        now: next,
      })
    const results = await Promise.allSettled([
      create('owner'),
      create('outsider'),
    ])
    expect(
      results.filter(
        (result) => result.status === 'fulfilled' && result.value !== null,
      ),
    ).toHaveLength(1)
    expect(
      await db.prepare('SELECT COUNT(*) AS count FROM organizations').first(),
    ).toEqual({ count: 1 })
  })
  it('excludes disabled organizations from all membership and collection reads', async () => {
    const db = await createDatabase()
    await db.prepare('UPDATE organizations SET enabled = 0').run()
    await assertNoReads(db, scope.userId)
  })

  it.each([0, 1, -1])(
    'excludes non-confirmed membership status %s',
    async (status) => {
      const db = await createDatabase()
      await db
        .prepare('UPDATE organization_users SET status = ?')
        .bind(status)
        .run()
      await assertNoReads(db, scope.userId)
    },
  )

  it('hides organization metadata from a nonmember', async () => {
    const db = await createDatabase()
    await assertNoReads(db, 'outsider')
  })

  it('allows assigned read-only nonmanagers to read their own collection metadata', async () => {
    const db = await createDatabase()
    await db.prepare('UPDATE organization_users SET type = 2').run()
    await db
      .prepare('UPDATE collection_users SET read_only = 1, manage = 0')
      .run()
    expect(await findOrganizationForConfirmedMember(db, scope)).not.toBeNull()
    expect(
      await listAccessibleOrganizationCollections(db, 'owner'),
    ).toHaveLength(1)
    expect(
      await listAccessibleOrganizationCollectionsByOrganization(db, scope),
    ).toHaveLength(1)
    expect(await findAccessibleOrganizationCollection(db, scope)).toMatchObject(
      {
        readOnly: true,
        manage: false,
      },
    )
    expect(await findConfirmedOrganizationOwner(db, scope)).toBeNull()
    expect(await findOwnerOrganizationCollection(db, scope)).toBeNull()
    expect(await listOrganizationCollectionUsersForOwner(db, scope)).toEqual([])
  })

  it.each(['disabled', 'revoked', 'read-only', 'nonmanager', 'nonowner'])(
    'denies owner collection update/delete when %s and leaves revisions unchanged',
    async (condition) => {
      const db = await createDatabase()
      if (condition === 'disabled')
        await db.prepare('UPDATE organizations SET enabled = 0').run()
      if (condition === 'revoked')
        await db.prepare('UPDATE organization_users SET status = -1').run()
      if (condition === 'read-only')
        await db.prepare('UPDATE collection_users SET read_only = 1').run()
      if (condition === 'nonmanager')
        await db.prepare('UPDATE collection_users SET manage = 0').run()
      if (condition === 'nonowner')
        await db.prepare('UPDATE organization_users SET type = 1').run()
      expect(
        await updateOrganizationCollection(db, {
          id: scope.collectionId,
          organizationId: scope.organizationId,
          userId: scope.userId,
          encryptedName: '2.changed',
          externalId: undefined,
          now: next,
        }),
      ).toBeNull()
      expect(
        await deleteOrganizationCollection(db, { ...scope, now: next }),
      ).toBe(false)
      expect(
        await db.prepare('SELECT revision_date FROM organizations').first(),
      ).toEqual({ revision_date: now })
      expect(
        await db
          .prepare('SELECT encrypted_name, revision_date FROM collections')
          .first(),
      ).toEqual({
        encrypted_name: '2.collection',
        revision_date: now,
      })
    },
  )

  it('rejects disabled organization collection creation atomically', async () => {
    const db = await createDatabase()
    await db.prepare('UPDATE organizations SET enabled = 0').run()
    await expect(
      createOrganizationCollection(db, {
        id: 'new-collection',
        organizationId: scope.organizationId,
        organizationUserId: 'membership',
        userId: scope.userId,
        encryptedName: '2.new',
        externalId: null,
        now: next,
      }),
    ).rejects.toThrow('Organization collection batch did not fully apply.')
    expect(
      await db.prepare('SELECT COUNT(*) as count FROM collections').first(),
    ).toEqual({ count: 1 })
    expect(
      await db.prepare('SELECT revision_date FROM organizations').first(),
    ).toEqual({ revision_date: now })
  })

  it('allows enabled confirmed owner management and preserves omitted external IDs', async () => {
    const db = await createDatabase()
    await db.prepare("UPDATE collections SET external_id = 'existing'").run()
    expect(
      await updateOrganizationCollection(db, {
        id: scope.collectionId,
        organizationId: scope.organizationId,
        userId: scope.userId,
        encryptedName: '2.changed',
        externalId: undefined,
        now: next,
      }),
    ).toMatchObject({ encryptedName: '2.changed', externalId: 'existing' })
    expect(
      await deleteOrganizationCollection(db, { ...scope, now: next }),
    ).toBe(true)
  })

  it('reports bulk deletion using returned collection rows despite cascading access rows', async () => {
    const db = await createDatabase()
    await createOrganizationCollection(db, {
      id: 'second-collection',
      organizationId: scope.organizationId,
      organizationUserId: 'membership',
      userId: scope.userId,
      encryptedName: '2.second',
      externalId: null,
      now: next,
    })
    expect(
      await deleteOrganizationCollections(db, {
        organizationId: scope.organizationId,
        collectionIds: [scope.collectionId, 'second-collection'],
        userId: scope.userId,
        now: next,
      }),
    ).toBe(true)
    expect(
      await db.prepare('SELECT COUNT(*) as count FROM collections').first(),
    ).toEqual({ count: 0 })
    expect(
      await db
        .prepare('SELECT COUNT(*) as count FROM collection_users')
        .first(),
    ).toEqual({ count: 0 })
  })

  it('rejects deleting the last collection for a shared cipher without changing state', async () => {
    const db = await createDatabase()
    await db.batch([
      db.prepare(
        `INSERT INTO ciphers (id, user_id, organization_id, type, encrypted_json, revision_date)
          VALUES ('shared', 'owner', 'org', 1, '{"name":"2.shared"}', '${now}')`,
      ),
      db.prepare(
        "INSERT INTO collection_ciphers VALUES ('collection', 'shared')",
      ),
    ])
    expect(
      await deleteOrganizationCollection(db, { ...scope, now: next }),
    ).toBe(false)
    expect(
      await db.prepare('SELECT revision_date FROM organizations').first(),
    ).toEqual({ revision_date: now })
    expect(
      await db
        .prepare('SELECT COUNT(*) as count FROM collection_ciphers')
        .first(),
    ).toEqual({ count: 1 })
  })
})

async function assertNoReads(db: D1Database, userId: string) {
  const input = { ...scope, userId }
  expect(await findOrganizationForConfirmedMember(db, input)).toBeNull()
  expect(await listConfirmedOrganizationMemberships(db, userId)).toEqual([])
  expect(await listAccessibleOrganizationCollections(db, userId)).toEqual([])
  expect(
    await listAccessibleOrganizationCollectionsByOrganization(db, input),
  ).toEqual([])
  expect(await findAccessibleOrganizationCollection(db, input)).toBeNull()
  expect(await findConfirmedOrganizationOwner(db, input)).toBeNull()
  expect(await findOwnerOrganizationCollection(db, input)).toBeNull()
  expect(await listOrganizationCollectionUsersForOwner(db, input)).toEqual([])
}

async function createDatabase(): Promise<D1Database> {
  const instance = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: '2026-07-06',
    d1Databases: { DB: 'organization-authorization-test' },
  })
  instances.push(instance)
  const db = (await instance.getD1Database('DB')) as unknown as D1Database
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
  for (const userId of ['owner', 'outsider']) {
    await db
      .prepare(
        `INSERT INTO users (
      id, email, email_normalized, kdf_algorithm, kdf_iterations,
      master_password_hash, user_key, security_stamp, revision_date
    ) VALUES (?, ?, ?, 'pbkdf2-sha256', 600000, 'synthetic-hash', '2.wrapper', 'stamp', ?)`,
      )
      .bind(userId, `${userId}@example.test`, `${userId}@example.test`, now)
      .run()
  }
  await createOrganizationFoundation(db, {
    organizationId: scope.organizationId,
    organizationUserId: 'membership',
    collectionId: scope.collectionId,
    userId: scope.userId,
    email: 'owner@example.test',
    name: 'Synthetic team',
    billingEmail: null,
    planType: 0,
    orgKey: '2.wrapped-org-key',
    publicKey: 'opaque-public-key',
    privateKey: '2.encrypted-private-key',
    encryptedCollectionName: '2.collection',
    now,
  })
  return db
}

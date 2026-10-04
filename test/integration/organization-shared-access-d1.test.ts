import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createOrganizationCipher,
  findAccessibleCipherById,
  listAccessibleCiphersByUser,
  listAccessibleCiphersByUserPage,
  resolveCipherAccess,
  sharePersonalCipherWithOrganization,
  softDeleteCipher,
  validateManagedOrganizationCollections,
} from '../../src/repositories/cipher-repository'
import {
  permanentlyDeleteOrganizationCipher,
  restoreOrganizationCipher,
  softDeleteOrganizationCipher,
  updateOrganizationCipher,
} from '../../src/repositories/organization-cipher-mutation-repository'
import type { OrganizationPolicyActor } from '../../src/repositories/organization-policy-sql'
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
import { getAccountRevisionDate } from '../../src/repositories/user-repository'

const instances: Miniflare[] = []
const now = '2026-10-04T00:00:00.000Z'
const next = '2026-10-04T00:00:01.000Z'
const later = '2026-10-04T00:00:02.000Z'
const scope = {
  organizationId: 'org',
  collectionId: 'collection',
  userId: 'member',
}
const actor: OrganizationPolicyActor = {
  userId: 'member',
  sessionId: 'session',
  deviceIdentifier: 'device',
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()))
})

describe('effective group and policy access on real local D1', () => {
  it('reads and writes a group-only collection as an ordinary confirmed member', async () => {
    const db = await createDatabase()
    expect(
      await listAccessibleOrganizationCollections(db, 'member'),
    ).toMatchObject([
      {
        id: 'collection',
        readOnly: false,
        hidePasswords: false,
        manage: false,
      },
    ])
    expect(
      await findAccessibleCipherById(db, { id: 'shared', userId: 'member' }),
    ).toMatchObject({
      id: 'shared',
      userId: 'creator',
      canEdit: true,
      canViewPassword: true,
      collectionIds: ['collection'],
    })
    expect(
      await validateManagedOrganizationCollections(db, {
        userId: 'member',
        organizationId: 'org',
        collectionIds: ['collection'],
      }),
    ).toBe(true)
    expect(
      await createOrganizationCipher(db, {
        id: 'new-shared',
        userId: 'member',
        organizationId: 'org',
        collectionIds: ['collection'],
        type: 1,
        favorite: false,
        encryptedJson: '{"name":"2.group-created"}',
        cipherKey: '2.wrapped',
        now: next,
      }),
    ).toEqual({ status: 'created' })
    expect(await updateOrganizationCipher(db, updateInput())).toMatchObject({
      status: 'updated',
    })
    expect(await getAccountRevisionDate(db, 'member')).toBe(next)
  })

  it('unions direct and group grants, projects one collection, and aggregates each capability independently', async () => {
    const db = await createDatabase()
    await db
      .prepare(
        `INSERT INTO collection_users VALUES ('collection', 'membership', 1, 0, 0)`,
      )
      .run()
    await db
      .prepare(
        'UPDATE collection_groups SET read_only = 0, hide_passwords = 1, manage = 1',
      )
      .run()
    expect(
      await listAccessibleOrganizationCollections(db, 'member'),
    ).toMatchObject([
      { id: 'collection', readOnly: false, hidePasswords: false, manage: true },
    ])
    const shared = (await listAccessibleCiphersByUser(db, 'member')).filter(
      (cipher) => cipher.organizationId,
    )
    expect(shared).toHaveLength(1)
    expect(shared[0]).toMatchObject({
      canEdit: true,
      canViewPassword: true,
      collectionIds: ['collection'],
    })
    expect(await resolveCipherAccess(db, 'member', 'shared')).toMatchObject({
      canRead: true,
      canEdit: true,
      canDelete: true,
      canViewPassword: true,
    })
    await db.prepare('DELETE FROM organization_group_users').run()
    expect(
      await findAccessibleCipherById(db, { id: 'shared', userId: 'member' }),
    ).toMatchObject({
      canEdit: false,
      canViewPassword: true,
    })
    expect(await updateOrganizationCipher(db, updateInput())).toEqual({
      status: 'not_found',
    })
  })

  it('uses a group management grant for an owner collection update without a direct assignment', async () => {
    const db = await createDatabase()
    await db.prepare('UPDATE organization_users SET type = 0').run()
    await db.prepare('UPDATE collection_groups SET manage = 1').run()
    expect(await findOwnerOrganizationCollection(db, scope)).toMatchObject({
      manage: true,
    })
    expect(
      await updateOrganizationCollection(db, {
        id: 'collection',
        organizationId: 'org',
        userId: 'member',
        encryptedName: '2.renamed',
        externalId: undefined,
        now: next,
      }),
    ).toMatchObject({ encryptedName: '2.renamed' })
  })

  it('does not turn a read-only group management grant into content or collection write access', async () => {
    const db = await createDatabase()
    await db.prepare('UPDATE organization_users SET type = 0').run()
    await db
      .prepare(
        'UPDATE collection_groups SET read_only = 1, hide_passwords = 1, manage = 1',
      )
      .run()
    expect(await findAccessibleOrganizationCollection(db, scope)).toMatchObject(
      {
        readOnly: true,
        hidePasswords: true,
        manage: true,
      },
    )
    expect(await resolveCipherAccess(db, 'member', 'shared')).toMatchObject({
      canRead: true,
      canEdit: false,
      canDelete: false,
      canViewPassword: false,
    })
    expect(await findOwnerOrganizationCollection(db, scope)).toBeNull()
    expect(await updateOrganizationCipher(db, updateInput())).toEqual({
      status: 'not_found',
    })
    expect(
      await validateManagedOrganizationCollections(db, {
        userId: 'member',
        organizationId: 'org',
        collectionIds: ['collection'],
      }),
    ).toBe(false)
    expect(
      await updateOrganizationCollection(db, {
        id: 'collection',
        organizationId: 'org',
        userId: 'member',
        encryptedName: '2.denied',
        externalId: undefined,
        now: next,
      }),
    ).toBeNull()
  })

  it('deduplicates multiple group grants and refuses creation when any destination lacks writable access', async () => {
    const db = await createDatabase()
    await db.batch([
      db
        .prepare(
          `INSERT INTO organization_groups (id, organization_id, name, revision_date, last_mutation_id)
        VALUES ('second-group', 'org', 'Second group', ?, 'setup')`,
        )
        .bind(now),
      db.prepare(
        `INSERT INTO organization_group_users VALUES ('second-group', 'org', 'membership')`,
      ),
      db.prepare(
        `INSERT INTO collection_groups VALUES ('collection', 'org', 'second-group', 1, 1, 1)`,
      ),
      db
        .prepare(
          `INSERT INTO collections (id, organization_id, encrypted_name, revision_date)
        VALUES ('restricted', 'org', '2.restricted', ?)`,
        )
        .bind(now),
      db.prepare(
        `INSERT INTO collection_groups VALUES ('restricted', 'org', 'second-group', 1, 1, 1)`,
      ),
    ])
    expect(
      await listAccessibleOrganizationCollections(db, 'member'),
    ).toMatchObject([
      { id: 'collection', readOnly: false, hidePasswords: false, manage: true },
      { id: 'restricted', readOnly: true, hidePasswords: true, manage: true },
    ])
    expect(await listAccessibleCiphersByUser(db, 'member')).toHaveLength(2)
    await expect(
      createOrganizationCipher(db, {
        id: 'denied-shared',
        userId: 'member',
        organizationId: 'org',
        collectionIds: ['collection', 'restricted'],
        type: 1,
        favorite: false,
        encryptedJson: '{"name":"2.denied"}',
        cipherKey: '2.wrapped',
        now: next,
      }),
    ).rejects.toThrow('Organization cipher batch did not fully apply.')
    expect(
      await db
        .prepare('SELECT id FROM ciphers WHERE id = ?')
        .bind('denied-shared')
        .first(),
    ).toBeNull()
  })

  it('shares a personal cipher using a group-only writable destination and preserves its provenance', async () => {
    const db = await createDatabase()
    expect(
      await sharePersonalCipherWithOrganization(db, {
        id: 'personal',
        userId: 'member',
        organizationId: 'org',
        collectionIds: ['collection'],
        type: 1,
        favorite: false,
        encryptedJson: '{"name":"2.reshared"}',
        cipherKey: '2.wrapped',
        now: next,
        expectedRevisionDate: now,
      }),
    ).toEqual({ status: 'shared' })
    expect(
      await findAccessibleCipherById(db, { id: 'personal', userId: 'member' }),
    ).toMatchObject({
      organizationId: 'org',
      userId: 'member',
      collectionIds: ['collection'],
    })
  })

  it('rechecks group removal after preflight and conceals the current shared revision on stale mutation readback', async () => {
    const db = await createDatabase()
    expect((await resolveCipherAccess(db, 'member', 'shared')).canEdit).toBe(
      true,
    )
    await db.prepare('DELETE FROM organization_group_users').run()
    expect(
      await updateOrganizationCipher(db, {
        ...updateInput(),
        expectedRevisionDate: 'stale',
      }),
    ).toEqual({ status: 'not_found' })
    expect(
      await softDeleteOrganizationCipher(db, {
        id: 'shared',
        userId: 'member',
        deletedAt: next,
        expectedRevisionDate: 'stale',
      }),
    ).toEqual({ status: 'not_found' })
    expect(
      await permanentlyDeleteOrganizationCipher(db, {
        id: 'shared',
        userId: 'member',
        revisionDate: next,
        expectedRevisionDate: 'stale',
      }),
    ).toEqual({ status: 'not_found' })
    expect(
      await db
        .prepare(
          'SELECT encrypted_json, revision_date FROM ciphers WHERE id = ?',
        )
        .bind('shared')
        .first(),
    ).toEqual({ encrypted_json: '{"name":"2.shared"}', revision_date: now })
    await db
      .prepare('UPDATE ciphers SET deleted_at = ? WHERE id = ?')
      .bind(now, 'shared')
      .run()
    expect(
      await restoreOrganizationCipher(db, {
        id: 'shared',
        userId: 'member',
        revisionDate: next,
        expectedRevisionDate: 'stale',
      }),
    ).toEqual({ status: 'not_found' })
  })

  it.each([
    'disabled-account',
    'revoked-session',
    'superseded-session',
    'mismatched-actor',
  ])(
    'rechecks %s between authentication preflight and shared SQL execution with policy disabled',
    async (condition) => {
      const db = await createDatabase()
      await db.prepare('UPDATE organization_users SET type = 0').run()
      await db.prepare('UPDATE collection_groups SET manage = 1').run()
      expect(
        (await resolveCipherAccess(db, 'member', 'shared', actor)).canEdit,
      ).toBe(true)
      expect(
        await findOwnerOrganizationCollection(db, { ...scope, actor }),
      ).not.toBeNull()
      let currentActor = actor
      if (condition === 'disabled-account') {
        await db
          .prepare('UPDATE users SET disabled_at = ? WHERE id = ?')
          .bind(next, 'member')
          .run()
      }
      if (condition === 'revoked-session') {
        await db.prepare('UPDATE devices SET revoked_at = ?').bind(next).run()
      }
      if (condition === 'superseded-session') {
        await db
          .prepare('UPDATE devices SET session_id = ?')
          .bind('new-login-session')
          .run()
      }
      if (condition === 'mismatched-actor')
        currentActor = { ...actor, userId: 'creator' }
      await assertDenied(db, currentActor)
      expect(
        await updateOrganizationCollection(db, {
          id: 'collection',
          organizationId: 'org',
          userId: 'member',
          actor: currentActor,
          encryptedName: '2.denied',
          externalId: undefined,
          now: next,
        }),
      ).toBeNull()
      expect(
        await deleteOrganizationCollection(db, {
          ...scope,
          actor: currentActor,
          now: next,
        }),
      ).toBe(false)
      expect(
        await softDeleteOrganizationCipher(db, {
          id: 'shared',
          userId: 'member',
          actor: currentActor,
          deletedAt: next,
          expectedRevisionDate: 'stale',
        }),
      ).toEqual({ status: 'not_found' })
      expect(
        await permanentlyDeleteOrganizationCipher(db, {
          id: 'shared',
          userId: 'member',
          actor: currentActor,
          revisionDate: next,
          expectedRevisionDate: 'stale',
        }),
      ).toEqual({ status: 'not_found' })
      await db
        .prepare('UPDATE ciphers SET deleted_at = ? WHERE id = ?')
        .bind(now, 'shared')
        .run()
      expect(
        await restoreOrganizationCipher(db, {
          id: 'shared',
          userId: 'member',
          actor: currentActor,
          revisionDate: next,
          expectedRevisionDate: 'stale',
        }),
      ).toEqual({ status: 'not_found' })
      expect(
        await db.prepare('SELECT revision_date FROM organizations').first(),
      ).toEqual({ revision_date: now })
    },
  )

  it('always denies a disabled account even for a policy-free legacy helper call without actor context', async () => {
    const db = await createDatabase()
    expect((await resolveCipherAccess(db, 'member', 'shared')).canEdit).toBe(
      true,
    )
    await db
      .prepare('UPDATE users SET disabled_at = ? WHERE id = ?')
      .bind(next, 'member')
      .run()
    await assertDenied(db)
  })

  it.each([
    'active-session',
    'legacy-active-account',
    'disabled-account',
    'legacy-disabled-account',
    'revoked-session',
    'superseded-session',
    'mismatched-actor',
  ])(
    'creates an organization only for an active creator after %s preflight',
    async (condition) => {
      const db = await createDatabase()
      expect(
        (await resolveCipherAccess(db, 'member', 'shared', actor)).canRead,
      ).toBe(true)
      let candidate: OrganizationPolicyActor | undefined = actor
      if (condition.startsWith('legacy-')) candidate = undefined
      if (condition.endsWith('disabled-account')) {
        await db
          .prepare('UPDATE users SET disabled_at = ? WHERE id = ?')
          .bind(next, 'member')
          .run()
      }
      if (condition === 'revoked-session')
        await db.prepare('UPDATE devices SET revoked_at = ?').bind(next).run()
      if (condition === 'superseded-session')
        await db
          .prepare('UPDATE devices SET session_id = ?')
          .bind('new-session')
          .run()
      if (condition === 'mismatched-actor')
        candidate = { ...actor, userId: 'creator' }
      const operation = createOrganizationFoundation(db, {
        ...foundationInput(),
        actor: candidate,
      })
      if (
        condition === 'active-session' ||
        condition === 'legacy-active-account'
      ) {
        expect(await operation).toMatchObject({
          organization: { id: 'new-org' },
          collection: { id: 'new-collection' },
        })
        expect(
          await db
            .prepare(
              `SELECT COUNT(*) AS count FROM collection_users
          WHERE collection_id = 'new-collection' AND organization_user_id = 'new-owner'`,
            )
            .first(),
        ).toEqual({ count: 1 })
      } else {
        await expect(operation).rejects.toThrow(
          'Organization foundation batch did not fully apply.',
        )
        await assertNoFoundationRows(db)
      }
    },
  )

  it('rolls back the organization and owner when a foundation descendant cannot be inserted', async () => {
    const db = await createDatabase()
    await expect(
      createOrganizationFoundation(db, {
        ...foundationInput(),
        actor,
        collectionId: 'collection',
      }),
    ).rejects.toThrow()
    await assertNoFoundationRows(db)
  })

  it('keeps all 100 destination collections inside the D1 parameter limit for validation, creation, sharing, and bulk deletion', async () => {
    const rawDb = await createDatabase()
    const db = withBoundParameterLimit(rawDb)
    await db.prepare('UPDATE organization_users SET type = 0').run()
    await db.prepare('UPDATE collection_groups SET manage = 1').run()
    const collectionIds = [
      'collection',
      ...Array.from({ length: 99 }, (_, index) => `collection-${index}`),
    ]
    await db.batch(
      collectionIds.slice(1).flatMap((id) => [
        db
          .prepare(
            `INSERT INTO collections (id, organization_id, encrypted_name, revision_date)
        VALUES (?, 'org', '2.collection', ?)`,
          )
          .bind(id, now),
        db
          .prepare(
            `INSERT INTO collection_groups VALUES (?, 'org', 'group', 0, 0, 1)`,
          )
          .bind(id),
      ]),
    )
    expect(
      await validateManagedOrganizationCollections(db, {
        userId: 'member',
        actor,
        organizationId: 'org',
        collectionIds,
      }),
    ).toBe(true)
    const input = {
      userId: 'member',
      actor,
      organizationId: 'org',
      collectionIds,
      type: 1,
      favorite: false,
      encryptedJson: '{"name":"2.created"}',
      cipherKey: '2.wrapped',
      now: next,
    }
    expect(
      await createOrganizationCipher(db, { ...input, id: 'hundred-shared' }),
    ).toEqual({ status: 'created' })
    expect(
      await sharePersonalCipherWithOrganization(db, {
        ...input,
        id: 'personal',
        expectedRevisionDate: now,
      }),
    ).toEqual({ status: 'shared' })
    expect(
      await findAccessibleCipherById(db, {
        id: 'hundred-shared',
        userId: 'member',
        actor,
      }),
    ).toMatchObject({ collectionIds: [...collectionIds].sort() })
    expect(
      await deleteOrganizationCollections(db, {
        organizationId: 'org',
        userId: 'member',
        actor,
        collectionIds,
        now: later,
      }),
    ).toBe(false)
    for (const id of ['shared', 'hundred-shared', 'personal']) {
      expect(
        await permanentlyDeleteOrganizationCipher(db, {
          id,
          userId: 'member',
          actor,
          revisionDate: later,
        }),
      ).toMatchObject({ status: 'deleted' })
    }
    expect(
      await deleteOrganizationCollections(db, {
        organizationId: 'org',
        userId: 'member',
        actor,
        collectionIds,
        now: later,
      }),
    ).toBe(true)
    expect(
      await db.prepare('SELECT COUNT(*) AS count FROM collections').first(),
    ).toEqual({ count: 0 })
  })

  it.each(['disabled', 'unconfirmed', 'revoked', 'unsupported-role'])(
    'rejects group grants when the organization or membership is %s',
    async (condition) => {
      const db = await createDatabase()
      if (condition === 'disabled')
        await db.prepare('UPDATE organizations SET enabled = 0').run()
      if (condition === 'unconfirmed')
        await db.prepare('UPDATE organization_users SET status = 1').run()
      if (condition === 'revoked')
        await db.prepare('UPDATE organization_users SET status = -1').run()
      if (condition === 'unsupported-role')
        await db.prepare('UPDATE organization_users SET type = 3').run()
      await assertDenied(db)
    },
  )

  it('rejects cross-organization direct grants even alongside valid group membership', async () => {
    const db = await createDatabase()
    await db.batch([
      db.prepare(
        `INSERT INTO organizations (id, name, revision_date) VALUES ('other-org', 'Other team', '${now}')`,
      ),
      db.prepare(
        `INSERT INTO collections (id, organization_id, encrypted_name, revision_date) VALUES ('other-collection', 'other-org', '2.other', '${now}')`,
      ),
      db.prepare(
        `INSERT INTO collection_users VALUES ('other-collection', 'membership', 0, 0, 1)`,
      ),
    ])
    expect(
      await listAccessibleOrganizationCollections(db, 'member'),
    ).toHaveLength(1)
    expect(
      await validateManagedOrganizationCollections(db, {
        userId: 'member',
        organizationId: 'other-org',
        collectionIds: ['other-collection'],
      }),
    ).toBe(false)
  })

  it.each([
    'missing-context',
    'other-user',
    'other-session',
    'other-device',
    'unproved-session',
    'old-generation',
    'revoked-device',
    'disabled-totp',
    'unverified-totp',
    'deleted-totp',
  ])(
    'fails closed under required TOTP with %s and preserves personal access',
    async (condition) => {
      const db = await createDatabase()
      await enablePolicy(db)
      let candidate: OrganizationPolicyActor | undefined = actor
      if (condition === 'missing-context') candidate = undefined
      if (condition === 'other-user')
        candidate = { ...actor, userId: 'creator' }
      if (condition === 'other-session')
        candidate = { ...actor, sessionId: 'other-session' }
      if (condition === 'other-device')
        candidate = { ...actor, deviceIdentifier: 'other-device' }
      if (condition === 'unproved-session')
        await db.prepare('UPDATE devices SET mfa_verified_at = NULL').run()
      if (condition === 'old-generation')
        await db
          .prepare(
            `UPDATE devices SET mfa_totp_credential_generation = 'old-generation'`,
          )
          .run()
      if (condition === 'revoked-device')
        await db.prepare('UPDATE devices SET revoked_at = ?').bind(next).run()
      if (condition === 'disabled-totp')
        await db.prepare('UPDATE user_totp SET enabled = 0').run()
      if (condition === 'unverified-totp')
        await db.prepare('UPDATE user_totp SET verified_at = NULL').run()
      if (condition === 'deleted-totp')
        await db.prepare('DELETE FROM user_totp').run()
      await assertDenied(db, candidate)
      expect(
        await listAccessibleCiphersByUser(db, 'member', candidate),
      ).toMatchObject([{ id: 'personal' }])
      expect(
        await resolveCipherAccess(db, 'member', 'personal', candidate),
      ).toMatchObject({ canRead: true, canEdit: true })
      expect(
        await softDeleteCipher(db, {
          id: 'personal',
          userId: 'member',
          deletedAt: next,
        }),
      ).toMatchObject({ status: 'deleted' })
    },
  )

  it('allows the current proved session under policy for reads, paged sync, creation, and lifecycle mutations', async () => {
    const db = await createDatabase()
    await enablePolicy(db)
    expect(
      await listConfirmedOrganizationMemberships(db, 'member', actor),
    ).toHaveLength(1)
    expect(
      await findAccessibleOrganizationCollection(db, { ...scope, actor }),
    ).not.toBeNull()
    expect(
      await listAccessibleCiphersByUserPage(db, {
        userId: 'member',
        actor,
        limit: 10,
        cursor: null,
      }),
    ).toMatchObject({
      hasMore: false,
      items: [{ id: 'personal' }, { id: 'shared' }],
    })
    expect(
      await createOrganizationCipher(db, {
        id: 'new-shared',
        userId: 'member',
        actor,
        organizationId: 'org',
        collectionIds: ['collection'],
        type: 1,
        favorite: false,
        encryptedJson: '{"name":"2.new"}',
        cipherKey: '2.wrapped',
        now: next,
      }),
    ).toEqual({ status: 'created' })
    expect(
      await softDeleteOrganizationCipher(db, {
        id: 'shared',
        userId: 'member',
        actor,
        deletedAt: next,
      }),
    ).toMatchObject({ status: 'deleted' })
    expect(
      await restoreOrganizationCipher(db, {
        id: 'shared',
        userId: 'member',
        actor,
        revisionDate: later,
      }),
    ).toMatchObject({ status: 'restored' })
    expect(
      await permanentlyDeleteOrganizationCipher(db, {
        id: 'shared',
        userId: 'member',
        actor,
        revisionDate: later,
      }),
    ).toMatchObject({ status: 'deleted' })
  })

  it('rechecks policy activation after a successful access read and denies collection and content writes', async () => {
    const db = await createDatabase()
    await db.prepare('UPDATE organization_users SET type = 0').run()
    await db.prepare('UPDATE collection_groups SET manage = 1').run()
    expect(await findOwnerOrganizationCollection(db, scope)).not.toBeNull()
    expect((await resolveCipherAccess(db, 'member', 'shared')).canEdit).toBe(
      true,
    )
    await enablePolicy(db)
    expect(await updateOrganizationCipher(db, updateInput())).toEqual({
      status: 'not_found',
    })
    expect(
      await updateOrganizationCollection(db, {
        id: 'collection',
        organizationId: 'org',
        userId: 'member',
        encryptedName: '2.denied',
        externalId: undefined,
        now: next,
      }),
    ).toBeNull()
    await expect(
      createOrganizationCollection(db, {
        id: 'new-collection',
        organizationId: 'org',
        organizationUserId: 'membership',
        userId: 'member',
        encryptedName: '2.denied',
        externalId: null,
        now: next,
      }),
    ).rejects.toThrow('Organization collection batch did not fully apply.')
    expect(
      await db.prepare('SELECT revision_date FROM organizations').first(),
    ).toEqual({ revision_date: now })
    expect(
      await findOwnerOrganizationCollection(db, { ...scope, actor }),
    ).not.toBeNull()
  })

  it('keeps lifecycle revisions observable while policy excludes shared cipher revisions', async () => {
    const db = await createDatabase()
    const future = '2026-10-04T00:00:10.000Z'
    await db
      .prepare('UPDATE ciphers SET revision_date = ? WHERE id = ?')
      .bind(future, 'shared')
      .run()
    await db
      .prepare('UPDATE organizations SET revision_date = ?')
      .bind(later)
      .run()
    expect(await getAccountRevisionDate(db, 'member')).toBe(future)
    await enablePolicy(db)
    expect(await getAccountRevisionDate(db, 'member')).toBe(later)
    expect(await getAccountRevisionDate(db, 'member', actor)).toBe(future)
    await db.prepare('UPDATE organization_policies SET enabled = 0').run()
    expect(await getAccountRevisionDate(db, 'member')).toBe(future)
  })
})

function updateInput() {
  return {
    id: 'shared',
    userId: 'member',
    type: 1,
    favorite: false,
    encryptedJson: '{"name":"2.changed"}',
    expectedRevisionDate: now,
    revisionDate: next,
  }
}

function foundationInput() {
  return {
    organizationId: 'new-org',
    organizationUserId: 'new-owner',
    collectionId: 'new-collection',
    userId: 'member',
    email: 'member@example.test',
    name: 'Synthetic new team',
    billingEmail: null,
    planType: 0,
    orgKey: '2.wrapped-org-key',
    publicKey: 'synthetic-public-key',
    privateKey: '2.wrapped-private-key',
    encryptedCollectionName: '2.default-collection',
    now: next,
  }
}

async function assertNoFoundationRows(db: D1Database) {
  expect(
    await db
      .prepare(
        `SELECT
    (SELECT COUNT(*) FROM organizations WHERE id = 'new-org') +
    (SELECT COUNT(*) FROM organization_users WHERE id = 'new-owner') +
    (SELECT COUNT(*) FROM collections WHERE id = 'new-collection') +
    (SELECT COUNT(*) FROM collection_users WHERE organization_user_id = 'new-owner') AS count`,
      )
      .first(),
  ).toEqual({ count: 0 })
}

async function assertDenied(
  db: D1Database,
  candidate?: OrganizationPolicyActor,
) {
  const input = { ...scope, actor: candidate }
  expect(await findOrganizationForConfirmedMember(db, input)).toBeNull()
  expect(
    await listConfirmedOrganizationMemberships(db, 'member', candidate),
  ).toEqual([])
  expect(
    await listAccessibleOrganizationCollections(db, 'member', candidate),
  ).toEqual([])
  expect(
    await listAccessibleOrganizationCollectionsByOrganization(db, input),
  ).toEqual([])
  expect(await findAccessibleOrganizationCollection(db, input)).toBeNull()
  expect(await findConfirmedOrganizationOwner(db, input)).toBeNull()
  expect(await listOrganizationCollectionUsersForOwner(db, input)).toEqual([])
  expect(
    await findAccessibleCipherById(db, {
      id: 'shared',
      userId: 'member',
      actor: candidate,
    }),
  ).toBeNull()
  expect(
    await resolveCipherAccess(db, 'member', 'shared', candidate),
  ).toMatchObject({ canRead: false, canEdit: false })
  expect(
    await validateManagedOrganizationCollections(db, {
      userId: 'member',
      actor: candidate,
      organizationId: 'org',
      collectionIds: ['collection'],
    }),
  ).toBe(false)
  expect(
    await updateOrganizationCipher(db, {
      ...updateInput(),
      actor: candidate,
      expectedRevisionDate: 'stale',
    }),
  ).toEqual({ status: 'not_found' })
  await expect(
    createOrganizationCipher(db, {
      id: 'denied-shared',
      userId: 'member',
      actor: candidate,
      organizationId: 'org',
      collectionIds: ['collection'],
      type: 1,
      favorite: false,
      encryptedJson: '{"name":"2.denied"}',
      cipherKey: '2.wrapped',
      now: next,
    }),
  ).rejects.toThrow('Organization cipher batch did not fully apply.')
  expect(
    await db
      .prepare('SELECT revision_date FROM ciphers WHERE id = ?')
      .bind('shared')
      .first(),
  ).toEqual({ revision_date: now })
}

async function enablePolicy(db: D1Database) {
  await db
    .prepare(
      `INSERT INTO organization_policies
    (id, organization_id, type, enabled, revision_date, created_at, updated_at)
    VALUES ('policy', 'org', 0, 1, ?, ?, ?)`,
    )
    .bind(now, now, now)
    .run()
}

function withBoundParameterLimit(database: D1Database): D1Database {
  // Miniflare's SQLite may allow more parameters than hosted D1. Keep the
  // production limit while executing the actual statements on local D1.
  return {
    prepare(query: string) {
      const statement = database.prepare(query)
      const bind = statement.bind.bind(statement)
      statement.bind = (...values: unknown[]) => {
        if (values.length > 100)
          throw new Error('D1 maximum bound parameters per query exceeded')
        return bind(...values)
      }
      return statement
    },
    batch: database.batch.bind(database),
  } as D1Database
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
  const db = database as unknown as D1Database
  for (const id of ['member', 'creator']) {
    await db
      .prepare(
        `INSERT INTO users
      (id, email, email_normalized, kdf_algorithm, kdf_iterations, master_password_hash, security_stamp, revision_date)
      VALUES (?, ?, ?, 'pbkdf2-sha256', 600000, 'synthetic-hash', 'synthetic-stamp', ?)`,
      )
      .bind(id, `${id}@example.test`, `${id}@example.test`, now)
      .run()
  }
  await db.batch([
    db
      .prepare(
        `INSERT INTO organizations (id, name, revision_date) VALUES ('org', 'Synthetic team', ?)`,
      )
      .bind(now),
    db.prepare(`INSERT INTO organization_users (id, organization_id, user_id, email, status, type)
      VALUES ('membership', 'org', 'member', 'member@example.test', 2, 2)`),
    db
      .prepare(
        `INSERT INTO collections (id, organization_id, encrypted_name, revision_date)
      VALUES ('collection', 'org', '2.collection', ?)`,
      )
      .bind(now),
    db
      .prepare(
        `INSERT INTO organization_groups (id, organization_id, name, revision_date, last_mutation_id)
      VALUES ('group', 'org', 'Synthetic group', ?, 'setup')`,
      )
      .bind(now),
    db.prepare(
      `INSERT INTO organization_group_users VALUES ('group', 'org', 'membership')`,
    ),
    db.prepare(
      `INSERT INTO collection_groups VALUES ('collection', 'org', 'group', 0, 0, 0)`,
    ),
    db
      .prepare(
        `INSERT INTO ciphers
      (id, user_id, organization_id, type, encrypted_json, revision_date, cipher_key)
      VALUES ('shared', 'creator', 'org', 1, '{"name":"2.shared"}', ?, '2.wrapped')`,
      )
      .bind(now),
    db.prepare(
      `INSERT INTO collection_ciphers VALUES ('collection', 'shared')`,
    ),
    db
      .prepare(
        `INSERT INTO ciphers (id, user_id, type, encrypted_json, revision_date)
      VALUES ('personal', 'member', 1, '{"name":"2.personal"}', ?)`,
      )
      .bind(now),
    db
      .prepare(
        `INSERT INTO user_totp
      (user_id, encrypted_secret, enabled, verified_at, credential_generation)
      VALUES ('member', 'synthetic-encrypted-secret', 1, ?, 'generation')`,
      )
      .bind(now),
    db
      .prepare(
        `INSERT INTO devices
      (id, user_id, identifier, session_id, mfa_totp_credential_generation, mfa_verified_at)
      VALUES ('device-row', 'member', 'device', 'session', 'generation', ?)`,
      )
      .bind(now),
  ])
  return db
}

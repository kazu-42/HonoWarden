import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it } from 'vitest'

import app from '../../src/app'
import { signAccessToken } from '../../src/domain/tokens'
import {
  createCipherAttachment,
  createPendingCipherAttachment,
} from '../../src/repositories/attachment-repository'

import {
  bulkMoveCiphers,
  bulkPermanentlyDeleteCiphers,
  bulkRestoreCiphers,
  bulkSoftDeleteCiphers,
  createOrganizationCipher,
  findAccessibleCipherById,
  findCipherById,
  listAccessibleCiphersByUser,
  listAccessibleCiphersByUserPage,
  permanentlyDeleteCipher,
  resolveCipherAccess,
  restoreCipher,
  sharePersonalCipherWithOrganization,
  softDeleteCipher,
  updateCipher,
  validateManagedOrganizationCollections,
} from '../../src/repositories/cipher-repository'

const instances: Miniflare[] = []
const databaseInstances = new WeakMap<D1Database, Miniflare>()
const owner = 'former-author'
const now = '2026-10-03T00:00:00.000Z'
const next = '2026-10-03T00:00:01.000Z'

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()))
})

describe('personal cipher lifecycle on real D1', () => {
  it('projects ordinary assigned member read, edit, and password-view grants independently across mapped collections', async () => {
    const db = await createDatabase()
    await seedCipher(db, 'org-active', owner, 'organization')
    await db.batch([
      db
        .prepare(
          'INSERT INTO organization_users (id, organization_id, user_id, email, status, type) VALUES (?, ?, ?, ?, 2, 2)',
        )
        .bind(
          'ordinary-member',
          'organization',
          'other-user',
          'other-user@example.test',
        ),
      db
        .prepare(
          'INSERT INTO collections (id, organization_id, encrypted_name, revision_date) VALUES (?, ?, ?, ?)',
        )
        .bind('hidden-readonly', 'organization', '2.hidden-readonly', now),
      db
        .prepare(
          'INSERT INTO collection_users (collection_id, organization_user_id, manage, read_only, hide_passwords) VALUES (?, ?, 0, 1, 1)',
        )
        .bind('hidden-readonly', 'ordinary-member'),
      db
        .prepare(
          'INSERT INTO collection_ciphers (collection_id, cipher_id) VALUES (?, ?)',
        )
        .bind('hidden-readonly', 'org-active'),
    ])
    const caller = { id: 'org-active', userId: 'other-user' }
    expect(await findAccessibleCipherById(db, caller)).toMatchObject({
      id: 'org-active',
      canEdit: false,
      canViewPassword: false,
    })
    expect(
      await resolveCipherAccess(db, 'other-user', 'org-active'),
    ).toMatchObject({
      canRead: true,
      canEdit: false,
      canDelete: false,
      canViewPassword: false,
    })
    expect(
      (await listAccessibleCiphersByUser(db, 'other-user'))[0],
    ).toMatchObject({ canEdit: false, canViewPassword: false })
    await db.batch([
      db
        .prepare(
          'INSERT INTO collections (id, organization_id, encrypted_name, revision_date) VALUES (?, ?, ?, ?)',
        )
        .bind('hidden-writable', 'organization', '2.hidden-writable', now),
      db
        .prepare(
          'INSERT INTO collection_users (collection_id, organization_user_id, manage, read_only, hide_passwords) VALUES (?, ?, 0, 0, 1)',
        )
        .bind('hidden-writable', 'ordinary-member'),
      db
        .prepare(
          'INSERT INTO collection_ciphers (collection_id, cipher_id) VALUES (?, ?)',
        )
        .bind('hidden-writable', 'org-active'),
      db
        .prepare(
          'INSERT INTO collections (id, organization_id, encrypted_name, revision_date) VALUES (?, ?, ?, ?)',
        )
        .bind('visible-readonly', 'organization', '2.visible-readonly', now),
      db
        .prepare(
          'INSERT INTO collection_users (collection_id, organization_user_id, manage, read_only, hide_passwords) VALUES (?, ?, 0, 1, 0)',
        )
        .bind('visible-readonly', 'ordinary-member'),
    ])
    expect(await findAccessibleCipherById(db, caller)).toMatchObject({
      canEdit: true,
      canViewPassword: false,
    })
    expect(
      await resolveCipherAccess(db, 'other-user', 'org-active'),
    ).toMatchObject({
      canRead: true,
      canEdit: true,
      canDelete: true,
      canViewPassword: false,
    })
    const ordinaryWrite = {
      userId: 'other-user',
      organizationId: 'organization',
      collectionIds: ['hidden-writable'],
      type: 1,
      favorite: false,
      encryptedJson: '{"name":"2.ordinary-shared"}',
      cipherKey: '2.ordinary-cipher-key',
      now: next,
    }
    expect(
      await validateManagedOrganizationCollections(db, ordinaryWrite),
    ).toBe(true)
    expect(
      await createOrganizationCipher(db, {
        ...ordinaryWrite,
        id: 'ordinary-created',
      }),
    ).toEqual({ status: 'created' })
    await seedCipher(db, 'ordinary-personal', 'other-user')
    expect(
      await sharePersonalCipherWithOrganization(db, {
        ...ordinaryWrite,
        id: 'ordinary-personal',
        expectedRevisionDate: now,
      }),
    ).toEqual({ status: 'shared' })
    expect(
      await findAccessibleCipherById(db, {
        id: 'ordinary-personal',
        userId: 'other-user',
      }),
    ).toMatchObject({
      organizationId: 'organization',
      collectionIds: ['hidden-writable'],
      canEdit: true,
      canViewPassword: false,
    })
    await db
      .prepare(
        'INSERT INTO collection_ciphers (collection_id, cipher_id) VALUES (?, ?)',
      )
      .bind('visible-readonly', 'org-active')
      .run()
    expect(await findAccessibleCipherById(db, caller)).toMatchObject({
      canEdit: true,
      canViewPassword: true,
      collectionIds: ['hidden-readonly', 'hidden-writable', 'visible-readonly'],
    })
    expect(
      await resolveCipherAccess(db, 'other-user', 'org-active'),
    ).toMatchObject({ canEdit: true, canViewPassword: true })
    expect(
      (
        await listAccessibleCiphersByUserPage(db, {
          userId: 'other-user',
          limit: 100,
          cursor: null,
        })
      ).items[0],
    ).toMatchObject({ canEdit: true, canViewPassword: true })
    await db
      .prepare('DELETE FROM collection_ciphers WHERE collection_id = ?')
      .bind('hidden-writable')
      .run()
    expect(
      await resolveCipherAccess(db, 'other-user', 'org-active'),
    ).toMatchObject({
      canRead: true,
      canEdit: false,
      canDelete: false,
      canViewPassword: true,
    })
    await db.batch([
      db
        .prepare(
          'INSERT INTO organizations (id, name, revision_date) VALUES (?, ?, ?)',
        )
        .bind('foreign-organization', 'Synthetic foreign organization', now),
      db
        .prepare(
          'INSERT INTO organization_users (id, organization_id, user_id, email, status, type) VALUES (?, ?, ?, ?, 2, 2)',
        )
        .bind(
          'foreign-membership',
          'foreign-organization',
          'other-user',
          'other-user@example.test',
        ),
      db
        .prepare(
          'INSERT INTO collections (id, organization_id, encrypted_name, revision_date) VALUES (?, ?, ?, ?)',
        )
        .bind('foreign-writable', 'foreign-organization', '2.foreign', now),
      db
        .prepare(
          'INSERT INTO collection_users (collection_id, organization_user_id, manage, read_only, hide_passwords) VALUES (?, ?, 0, 0, 0)',
        )
        .bind('foreign-writable', 'foreign-membership'),
      db
        .prepare(
          'INSERT INTO collection_ciphers (collection_id, cipher_id) VALUES (?, ?)',
        )
        .bind('foreign-writable', 'org-active'),
    ])
    expect(await findAccessibleCipherById(db, caller)).toMatchObject({
      canEdit: false,
      collectionIds: ['hidden-readonly', 'visible-readonly'],
    })
    expect(
      await resolveCipherAccess(db, 'other-user', 'org-active'),
    ).toMatchObject({ canRead: true, canEdit: false })
    await db
      .prepare('UPDATE organization_users SET status = -1 WHERE id = ?')
      .bind('ordinary-member')
      .run()
    expect(await findAccessibleCipherById(db, caller)).toBeNull()
    expect(
      await resolveCipherAccess(db, 'other-user', 'org-active'),
    ).toMatchObject({ canRead: false, canEdit: false, canViewPassword: false })
  })

  it('rejects attachment allocations after a previously personal cipher is shared to an organization', async () => {
    const db = await createDatabase()
    await seedCipher(db, 'source', owner)
    await db.batch([
      db
        .prepare(
          'INSERT INTO organization_users (id, organization_id, user_id, email, status, type) VALUES (?, ?, ?, ?, 2, 0)',
        )
        .bind('author-manager', 'organization', owner, `${owner}@example.test`),
      db
        .prepare(
          'INSERT INTO collections (id, organization_id, encrypted_name, revision_date) VALUES (?, ?, ?, ?)',
        )
        .bind('collection', 'organization', '2.synthetic-collection', now),
      db
        .prepare(
          'INSERT INTO collection_users (collection_id, organization_user_id, manage) VALUES (?, ?, 1)',
        )
        .bind('collection', 'author-manager'),
    ])
    expect(
      await findCipherById(db, { id: 'source', userId: owner }),
    ).toMatchObject({ id: 'source' })
    expect(
      await sharePersonalCipherWithOrganization(db, {
        id: 'source',
        userId: owner,
        organizationId: 'organization',
        collectionIds: ['collection'],
        type: 1,
        favorite: false,
        encryptedJson: '{"name":"2.org"}',
        cipherKey: '2.org-key',
        now: next,
        expectedRevisionDate: now,
      }),
    ).toEqual({ status: 'shared' })
    const attachment = {
      id: 'race-attachment',
      userId: owner,
      cipherId: 'source',
      objectKey: 'synthetic-race-object',
      fileName: '2.synthetic-file',
      attachmentKey: '2.synthetic-key',
      size: 1,
      revisionDate: next,
      createdAt: next,
      updatedAt: next,
    }
    expect(
      await createPendingCipherAttachment(
        db,
        {
          ...attachment,
          contentType: null,
          uploadState: 'pending',
          pendingExpiresAt: '2026-10-03T00:15:01.000Z',
        },
        { maxStorageBytes: 100, expiredBefore: now },
      ),
    ).toEqual({ status: 'not_found' })
    expect(
      await createCipherAttachment(db, {
        ...attachment,
        contentType: 'application/octet-stream',
        uploadState: 'uploaded',
        pendingExpiresAt: null,
      }),
    ).toBeNull()
    expect(
      await db.prepare('SELECT id FROM cipher_attachments').all(),
    ).toMatchObject({ results: [] })
    const bucket = (await databaseInstances
      .get(db)!
      .getR2Bucket('VAULT_OBJECTS')) as unknown as R2Bucket
    expect((await bucket.list()).objects).toEqual([])
    await seedCipher(db, 'personal-source', owner)
    expect(
      await createPendingCipherAttachment(
        db,
        {
          ...attachment,
          cipherId: 'personal-source',
          contentType: null,
          uploadState: 'pending',
          pendingExpiresAt: '2026-10-03T00:15:01.000Z',
        },
        { maxStorageBytes: 100, expiredBefore: now },
      ),
    ).toMatchObject({ status: 'created' })
    await seedCipher(db, 'deleted-source', owner, null, now)
    await seedCipher(db, 'foreign-source', 'other-user')
    for (const cipherId of [
      'deleted-source',
      'foreign-source',
      'missing-source',
    ]) {
      expect(
        await createPendingCipherAttachment(
          db,
          {
            ...attachment,
            id: 'denied-allocation',
            cipherId,
            contentType: null,
            uploadState: 'pending',
            pendingExpiresAt: '2026-10-03T00:15:01.000Z',
          },
          { maxStorageBytes: 100, expiredBefore: now },
        ),
      ).toEqual({ status: 'not_found' })
      expect(
        await createCipherAttachment(db, {
          ...attachment,
          id: 'denied-allocation',
          cipherId,
          contentType: 'application/octet-stream',
          uploadState: 'uploaded',
          pendingExpiresAt: null,
        }),
      ).toBeNull()
    }
    expect(
      await createPendingCipherAttachment(
        db,
        {
          ...attachment,
          id: 'over-quota',
          cipherId: 'personal-source',
          contentType: null,
          uploadState: 'pending',
          pendingExpiresAt: '2026-10-03T00:15:01.000Z',
        },
        { maxStorageBytes: 1, expiredBefore: now },
      ),
    ).toEqual({ status: 'quota_exceeded' })
  })

  it('reports a personal permanent deletion correctly when D1 cascades attachment metadata', async () => {
    const db = await createDatabase()
    await seedCipher(db, 'personal-active', owner)
    await db
      .prepare(
        'INSERT INTO cipher_attachments (id, user_id, cipher_id, object_key, file_name, attachment_key, size, content_type, revision_date) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
      )
      .bind(
        'attachment',
        owner,
        'personal-active',
        'synthetic-object',
        '2.synthetic-file',
        '2.synthetic-key',
        'application/octet-stream',
        now,
      )
      .run()
    expect(
      await permanentlyDeleteCipher(db, {
        id: 'personal-active',
        userId: owner,
        revisionDate: next,
      }),
    ).toMatchObject({ status: 'deleted', id: 'personal-active' })
    expect(await db.prepare('SELECT id FROM ciphers').all()).toMatchObject({
      results: [],
    })
    expect(
      await db.prepare('SELECT id FROM cipher_attachments').all(),
    ).toMatchObject({ results: [] })
  })

  it('denies disabled organizations across cipher reads, access resolution, create, and share', async () => {
    const db = await createDatabase()
    await seedCipher(db, 'org-active', owner, 'organization')
    await seedCipher(db, 'personal-active', owner)
    await db.batch([
      db
        .prepare(
          'INSERT INTO organization_users (id, organization_id, user_id, email, status, type) VALUES (?, ?, ?, ?, 2, 0)',
        )
        .bind('author-manager', 'organization', owner, `${owner}@example.test`),
      db
        .prepare(
          'INSERT INTO collections (id, organization_id, encrypted_name, revision_date) VALUES (?, ?, ?, ?)',
        )
        .bind('collection', 'organization', '2.synthetic-collection', now),
      db
        .prepare(
          'INSERT INTO collection_users (collection_id, organization_user_id, manage) VALUES (?, ?, 1)',
        )
        .bind('collection', 'author-manager'),
      db
        .prepare(
          'INSERT INTO collection_ciphers (collection_id, cipher_id) VALUES (?, ?)',
        )
        .bind('collection', 'org-active'),
    ])
    const collections = {
      userId: owner,
      organizationId: 'organization',
      collectionIds: ['collection'],
    }
    expect(await validateManagedOrganizationCollections(db, collections)).toBe(
      true,
    )
    expect(
      await findAccessibleCipherById(db, { id: 'org-active', userId: owner }),
    ).toMatchObject({ organizationId: 'organization' })
    const writableBefore = await snapshot(db)
    await db
      .prepare(
        'UPDATE collection_users SET read_only = 1 WHERE collection_id = ?',
      )
      .bind('collection')
      .run()
    await db.batch([
      db
        .prepare(
          'INSERT INTO collections (id, organization_id, encrypted_name, revision_date) VALUES (?, ?, ?, ?)',
        )
        .bind(
          'other-writable-collection',
          'organization',
          '2.synthetic-other',
          now,
        ),
      db
        .prepare(
          'INSERT INTO collection_users (collection_id, organization_user_id, manage, read_only) VALUES (?, ?, 1, 0)',
        )
        .bind('other-writable-collection', 'author-manager'),
    ])
    expect(
      await findAccessibleCipherById(db, { id: 'org-active', userId: owner }),
    ).toMatchObject({ organizationId: 'organization', canEdit: false })
    expect(await resolveCipherAccess(db, owner, 'org-active')).toMatchObject({
      canRead: true,
      canEdit: false,
      canDelete: false,
    })
    expect(await validateManagedOrganizationCollections(db, collections)).toBe(
      false,
    )
    expect(
      await validateManagedOrganizationCollections(db, {
        ...collections,
        collectionIds: ['collection', 'other-writable-collection'],
      }),
    ).toBe(false)
    const readonlyWrite = {
      ...collections,
      type: 1,
      favorite: false,
      encryptedJson: '{"name":"2.synthetic-new"}',
      cipherKey: '2.synthetic-key',
      now: next,
    }
    await expect(
      createOrganizationCipher(db, {
        ...readonlyWrite,
        id: 'readonly-org-cipher',
      }),
    ).rejects.toThrow('Organization cipher batch did not fully apply.')
    await expect(
      createOrganizationCipher(db, {
        ...readonlyWrite,
        id: 'mixed-org-cipher',
        collectionIds: ['collection', 'other-writable-collection'],
      }),
    ).rejects.toThrow('Organization cipher batch did not fully apply.')
    expect(
      await sharePersonalCipherWithOrganization(db, {
        ...readonlyWrite,
        id: 'personal-active',
        expectedRevisionDate: now,
      }),
    ).toEqual({ status: 'not_found' })
    expect(await snapshot(db)).toEqual(writableBefore)
    await db
      .prepare(
        'UPDATE collection_users SET read_only = 0 WHERE collection_id = ?',
      )
      .bind('collection')
      .run()
    expect(await resolveCipherAccess(db, owner, 'org-active')).toMatchObject({
      canRead: true,
      canEdit: true,
      canDelete: true,
    })
    expect(
      await findAccessibleCipherById(db, { id: 'org-active', userId: owner }),
    ).toMatchObject({ canEdit: true })
    await db
      .prepare('UPDATE organizations SET enabled = 0 WHERE id = ?')
      .bind('organization')
      .run()
    const before = await snapshot(db)
    expect(
      await findAccessibleCipherById(db, { id: 'org-active', userId: owner }),
    ).toBeNull()
    expect(
      (await listAccessibleCiphersByUser(db, owner)).map((row) => row.id),
    ).toEqual(['personal-active'])
    expect(
      (
        await listAccessibleCiphersByUserPage(db, {
          userId: owner,
          limit: 100,
          cursor: null,
        })
      ).items.map((row) => row.id),
    ).toEqual(['personal-active'])
    expect(await resolveCipherAccess(db, owner, 'org-active')).toMatchObject({
      canRead: false,
      canEdit: false,
      canDelete: false,
    })
    expect(await validateManagedOrganizationCollections(db, collections)).toBe(
      false,
    )
    const write = {
      ...collections,
      type: 1,
      favorite: false,
      encryptedJson: '{"name":"2.synthetic-new"}',
      cipherKey: '2.synthetic-key',
      now: next,
    }
    await expect(
      createOrganizationCipher(db, { ...write, id: 'new-org-cipher' }),
    ).rejects.toThrow('Organization cipher batch did not fully apply.')
    expect(
      await sharePersonalCipherWithOrganization(db, {
        ...write,
        id: 'personal-active',
        expectedRevisionDate: now,
      }),
    ).toEqual({ status: 'not_found' })
    expect(await snapshot(db)).toEqual(before)
    expect(
      await db
        .prepare('SELECT cipher_id FROM collection_ciphers ORDER BY cipher_id')
        .all(),
    ).toMatchObject({ results: [{ cipher_id: 'org-active' }] })
  })

  it('does not delete R2 objects when an organization author reaches the personal permanent-delete route', async () => {
    const db = await createDatabase()
    await seedCipher(db, 'org-active', owner, 'organization')
    await db.batch([
      db
        .prepare(
          'INSERT INTO organization_users (id, organization_id, user_id, email, status, type) VALUES (?, ?, ?, ?, 2, 0)',
        )
        .bind('author-manager', 'organization', owner, `${owner}@example.test`),
      db
        .prepare(
          'INSERT INTO collections (id, organization_id, encrypted_name, revision_date) VALUES (?, ?, ?, ?)',
        )
        .bind('collection', 'organization', '2.synthetic-collection', now),
      db
        .prepare(
          'INSERT INTO collection_users (collection_id, organization_user_id, manage) VALUES (?, ?, 1)',
        )
        .bind('collection', 'author-manager'),
      db
        .prepare(
          'INSERT INTO collection_ciphers (collection_id, cipher_id) VALUES (?, ?)',
        )
        .bind('collection', 'org-active'),
      db
        .prepare(
          'INSERT INTO cipher_attachments (id, user_id, cipher_id, object_key, file_name, attachment_key, size, content_type, revision_date) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
        )
        .bind(
          'attachment',
          owner,
          'org-active',
          'synthetic-object',
          '2.synthetic-file',
          '2.synthetic-key',
          'application/octet-stream',
          now,
        ),
    ])
    expect(await resolveCipherAccess(db, owner, 'org-active')).toMatchObject({
      canRead: true,
      canDelete: true,
    })
    const tokenSecret = 'synthetic-lifecycle-test-secret'
    const token = await signAccessToken(tokenSecret, {
      sub: owner,
      email: `${owner}@example.test`,
      device: 'synthetic-device',
      sessionId: 'synthetic-session',
      securityStamp: 'synthetic-stamp',
      iat: 1,
      exp: 4_102_444_800,
      authMethod: 'password',
    })
    const bucket = (await databaseInstances
      .get(db)!
      .getR2Bucket('VAULT_OBJECTS')) as unknown as R2Bucket
    await db
      .prepare(
        'INSERT INTO devices (id, user_id, identifier, session_id) VALUES (?, ?, ?, ?)',
      )
      .bind(
        'synthetic-device-id',
        owner,
        'synthetic-device',
        'synthetic-session',
      )
      .run()
    await bucket.put('synthetic-object', 'synthetic-encrypted-attachment')
    const response = await app.request(
      '/api/ciphers/org-active',
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      },
      {
        DB: db,
        HONOWARDEN_TOKEN_SECRET: tokenSecret,
        VAULT_OBJECTS: bucket,
      },
    )
    expect(response.status).toBe(404)
    expect(await (await bucket.get('synthetic-object'))?.text()).toBe(
      'synthetic-encrypted-attachment',
    )
    expect(
      await db
        .prepare('SELECT id FROM cipher_attachments WHERE id = ?')
        .bind('attachment')
        .first(),
    ).toMatchObject({ id: 'attachment' })
    expect(
      await db
        .prepare('SELECT id FROM ciphers WHERE id = ?')
        .bind('org-active')
        .first(),
    ).toMatchObject({ id: 'org-active' })
  })

  it('isolates personal lookup and update while keeping relationship-authorized organization reads', async () => {
    const db = await createDatabase()
    await seedCipher(db, 'org-active', owner, 'organization')
    await seedCipher(db, 'personal-active', owner)
    await db.batch([
      db
        .prepare(
          'INSERT INTO organization_users (id, organization_id, user_id, email, status, type) VALUES (?, ?, ?, ?, 2, 0)',
        )
        .bind(
          'manager',
          'organization',
          'other-user',
          'other-user@example.test',
        ),
      db
        .prepare(
          'INSERT INTO collections (id, organization_id, encrypted_name, revision_date) VALUES (?, ?, ?, ?)',
        )
        .bind('collection', 'organization', '2.synthetic-collection', now),
      db
        .prepare(
          'INSERT INTO collection_users (collection_id, organization_user_id, manage) VALUES (?, ?, 1)',
        )
        .bind('collection', 'manager'),
      db
        .prepare(
          'INSERT INTO collection_ciphers (collection_id, cipher_id) VALUES (?, ?)',
        )
        .bind('collection', 'org-active'),
    ])
    expect(
      await findCipherById(db, { id: 'org-active', userId: owner }),
    ).toBeNull()
    expect(
      await findAccessibleCipherById(db, { id: 'org-active', userId: owner }),
    ).toBeNull()
    expect(
      await findAccessibleCipherById(db, {
        id: 'org-active',
        userId: 'other-user',
      }),
    ).toMatchObject({
      id: 'org-active',
      organizationId: 'organization',
      collectionIds: ['collection'],
    })
    const before = await snapshot(db)
    const input = {
      userId: owner,
      folderId: null,
      type: 1,
      favorite: false,
      encryptedJson: '{"name":"2.changed-ciphertext"}',
      expectedRevisionDate: now,
      revisionDate: next,
      createdAt: now,
    }
    expect(await updateCipher(db, { ...input, id: 'org-active' })).toEqual({
      status: 'not_found',
    })
    expect(
      await updateCipher(db, {
        ...input,
        id: 'org-active',
        expectedRevisionDate: next,
      }),
    ).toEqual({ status: 'not_found' })
    expect(await snapshot(db)).toEqual(before)
    expect(
      await updateCipher(db, { ...input, id: 'personal-active' }),
    ).toMatchObject({ status: 'updated' })
    expect(
      await updateCipher(db, { ...input, id: 'personal-active' }),
    ).toMatchObject({ status: 'conflict', currentRevisionDate: next })
  })

  it('rejects a former organization author on single trash, restore, and permanent delete', async () => {
    const db = await createDatabase()
    await seedCipher(db, 'org-active', owner, 'organization')
    await seedCipher(db, 'org-trash', owner, 'organization', now)
    const denied = await resolveCipherAccess(db, owner, 'org-active')
    expect(denied).toMatchObject({ canRead: false, canDelete: false })
    const before = await snapshot(db)

    expect(
      await softDeleteCipher(db, {
        id: 'org-active',
        userId: owner,
        deletedAt: next,
      }),
    ).toEqual({ status: 'not_found' })
    expect(
      await restoreCipher(db, {
        id: 'org-trash',
        userId: owner,
        revisionDate: next,
      }),
    ).toEqual({ status: 'not_found' })
    expect(
      await permanentlyDeleteCipher(db, {
        id: 'org-active',
        userId: owner,
        revisionDate: next,
      }),
    ).toEqual({ status: 'not_found' })
    expect(await snapshot(db)).toEqual(before)
  })

  it('limits every mixed bulk mutation to the caller personal vault', async () => {
    const db = await createDatabase()
    await seedCipher(db, 'personal-active', owner)
    await seedCipher(db, 'personal-trash', owner, null, now)
    await seedCipher(db, 'org-active', owner, 'organization')
    await seedCipher(db, 'org-trash', owner, 'organization', now)
    await seedCipher(db, 'foreign-active', 'other-user')
    await seedCipher(db, 'foreign-trash', 'other-user', null, now)
    const protectedBefore = (await snapshot(db)).filter(
      (row) => !String(row.id).startsWith('personal-'),
    )
    const input = {
      ids: [
        'personal-active',
        'personal-trash',
        'org-active',
        'org-trash',
        'foreign-active',
        'foreign-trash',
      ],
      userId: owner,
      revisionDate: next,
    }

    expect(
      await bulkMoveCiphers(db, { ...input, folderId: 'personal-folder' }),
    ).toBe(1)
    expect(await bulkSoftDeleteCiphers(db, input)).toBe(1)
    expect((await bulkRestoreCiphers(db, input)).sort()).toEqual([
      'personal-active',
      'personal-trash',
    ])
    expect(await bulkPermanentlyDeleteCiphers(db, input)).toBe(2)
    expect(await snapshot(db)).toEqual(protectedBefore)
  })

  it('preserves owner personal lifecycle behavior and rejects cross-user single mutations', async () => {
    const db = await createDatabase()
    await seedCipher(db, 'personal-active', owner)
    await seedCipher(db, 'foreign-active', 'other-user')
    await seedCipher(db, 'foreign-trash', 'other-user', null, now)
    const input = { userId: owner, revisionDate: next }
    expect(
      await softDeleteCipher(db, {
        id: 'foreign-active',
        userId: owner,
        deletedAt: next,
      }),
    ).toEqual({ status: 'not_found' })
    expect(await restoreCipher(db, { ...input, id: 'foreign-trash' })).toEqual({
      status: 'not_found',
    })
    expect(
      await permanentlyDeleteCipher(db, { ...input, id: 'foreign-active' }),
    ).toEqual({ status: 'not_found' })
    expect(
      await softDeleteCipher(db, {
        id: 'personal-active',
        userId: owner,
        deletedAt: next,
      }),
    ).toMatchObject({ status: 'deleted' })
    expect(
      await restoreCipher(db, { ...input, id: 'personal-active' }),
    ).toMatchObject({ status: 'restored' })
    expect(
      await permanentlyDeleteCipher(db, { ...input, id: 'personal-active' }),
    ).toMatchObject({ status: 'deleted' })
    expect((await snapshot(db)).map((row) => row.id)).toEqual([
      'foreign-active',
      'foreign-trash',
    ])
  })
})

async function snapshot(db: D1Database): Promise<Record<string, unknown>[]> {
  const result = await db
    .prepare(
      'SELECT id, user_id, organization_id, folder_id, encrypted_json, revision_date, deleted_at, updated_at FROM ciphers ORDER BY id',
    )
    .all<Record<string, unknown>>()
  return result.results
}

async function seedCipher(
  db: D1Database,
  id: string,
  userId: string,
  organizationId: string | null = null,
  deletedAt: string | null = null,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO ciphers (id, user_id, organization_id, type, encrypted_json, revision_date, deleted_at, cipher_key, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)',
    )
    .bind(
      id,
      userId,
      organizationId,
      '{"name":"2.synthetic-ciphertext"}',
      now,
      deletedAt,
      organizationId ? '2.synthetic-key' : null,
      now,
    )
    .run()
}

async function createDatabase(): Promise<D1Database> {
  const instance = new Miniflare({
    compatibilityDate: '2026-07-21',
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: { DB: crypto.randomUUID() },
    r2Buckets: ['VAULT_OBJECTS'],
  })
  instances.push(instance)
  const db = await instance.getD1Database('DB')
  databaseInstances.set(db, instance)
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
  for (const id of [owner, 'other-user']) {
    await db
      .prepare(
        'INSERT INTO users (id, email, email_normalized, kdf_algorithm, kdf_iterations, master_password_hash, security_stamp, revision_date) VALUES (?, ?, ?, ?, 600000, ?, ?, ?)',
      )
      .bind(
        id,
        `${id}@example.test`,
        `${id}@example.test`,
        'pbkdf2-sha256',
        'synthetic-hash',
        'synthetic-stamp',
        now,
      )
      .run()
  }
  await db
    .prepare(
      'INSERT INTO organizations (id, name, revision_date) VALUES (?, ?, ?)',
    )
    .bind('organization', 'Synthetic organization', now)
    .run()
  await db
    .prepare(
      'INSERT INTO folders (id, user_id, encrypted_name, revision_date) VALUES (?, ?, ?, ?)',
    )
    .bind('personal-folder', owner, '2.synthetic-folder', now)
    .run()
  return db
}

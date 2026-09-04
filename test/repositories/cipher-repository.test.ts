import { describe, expect, it } from 'vitest'

import {
  bulkMoveCiphers,
  bulkPermanentlyDeleteCiphers,
  bulkRestoreCiphers,
  bulkSoftDeleteCiphers,
  createCipher,
  createOrganizationCipher,
  findAccessibleCipherById,
  findCipherById,
  listAccessibleCiphersByUser,
  listAccessibleCiphersByUserPage,
  permanentlyDeleteCipher,
  restoreCipher,
  sharePersonalCipherWithOrganization,
  softDeleteCipher,
  listCiphersByUser,
  listCiphersByUserPage,
  updateCipher,
  validateManagedOrganizationCollections,
} from '../../src/repositories/cipher-repository'

const fakeMeta = {
  duration: 0,
  size_after: 0,
  rows_read: 1,
  rows_written: 1,
  last_row_id: 1,
  changed_db: true,
  changes: 1,
} satisfies D1Meta & Record<string, unknown>

describe('cipher repository', () => {
  it('validates the complete confirmed owner-managed collection set', async () => {
    const database = new RecordingCipherD1Database([{ count: 2 }])

    await expect(
      validateManagedOrganizationCollections(database, {
        userId: 'user-id',
        organizationId: 'organization-id',
        collectionIds: ['collection-one', 'collection-two'],
      }),
    ).resolves.toBe(true)

    expect(database.queries.join('\n')).toContain(
      'COUNT(DISTINCT collection.id)',
    )
    expect(database.queries.join('\n')).toContain('membership.status = 2')
    expect(database.queries.join('\n')).toContain('membership.type = 0')
    expect(database.queries.join('\n')).toContain('collection_user.manage = 1')
    expect(database.queries.join('\n')).toContain(
      'membership.organization_id = collection.organization_id',
    )
    expect(database.boundValueSets).toEqual([
      ['user-id', 'organization-id', 'collection-one', 'collection-two'],
    ])
  })

  it('creates an organization cipher and every collection assignment in one guarded batch', async () => {
    const database = new RecordingCipherD1Database([], {
      batchChanges: [1, 2],
    })

    await expect(
      createOrganizationCipher(database, {
        id: 'organization-cipher-id',
        userId: 'user-id',
        organizationId: 'organization-id',
        collectionIds: ['collection-one', 'collection-two'],
        type: 1,
        favorite: true,
        encryptedJson: '{"name":"2.organization"}',
        cipherKey: '2.opaque-cipher-key',
        now: '2026-07-06T00:10:00.000Z',
      }),
    ).resolves.toEqual({ status: 'created' })

    expect(database.queries).toHaveLength(2)
    expect(database.queries[0]).toContain('INSERT INTO ciphers')
    expect(database.queries[0]).toContain('organization_id')
    expect(database.queries[0]).toContain('cipher_key')
    expect(database.queries[0]).toContain('COUNT(DISTINCT collection.id)')
    expect(database.queries[1]).toContain('INSERT INTO collection_ciphers')
    expect(database.queries[1]).toContain('FROM ciphers transitioned_cipher')
    expect(database.queries[1]).toContain('changes() = 1')
    expect(database.boundValues).toEqual(
      expect.arrayContaining([
        'organization-cipher-id',
        'user-id',
        'organization-id',
        'collection-one',
        'collection-two',
        '2.opaque-cipher-key',
      ]),
    )
  })

  it('shares an active personal cipher without changing its id or provenance owner', async () => {
    const database = new RecordingCipherD1Database([], {
      batchChanges: [1, 2],
    })

    await expect(
      sharePersonalCipherWithOrganization(database, {
        id: 'cipher-id',
        userId: 'user-id',
        organizationId: 'organization-id',
        collectionIds: ['collection-one', 'collection-two'],
        type: 1,
        favorite: false,
        encryptedJson: '{"name":"2.reencrypted"}',
        cipherKey: '2.opaque-cipher-key',
        expectedRevisionDate: '2026-07-06T00:05:00.000Z',
        now: '2026-07-06T00:10:00.000Z',
      }),
    ).resolves.toEqual({ status: 'shared' })

    expect(database.queries).toHaveLength(2)
    expect(database.queries[0]).toContain('UPDATE ciphers')
    expect(database.queries[0]).toContain('organization_id IS NULL')
    expect(database.queries[0]).toContain('deleted_at IS NULL')
    expect(database.queries[0]).toContain('revision_date = ?')
    expect(database.queries[0]).toContain(
      'FROM collection_ciphers existing_mapping',
    )
    expect(database.queries[0]).toContain('FROM cipher_attachments attachment')
    expect(database.queries[1]).toContain('INSERT INTO collection_ciphers')
    expect(database.boundValues).toEqual(
      expect.arrayContaining([
        'cipher-id',
        'user-id',
        'organization-id',
        '2026-07-06T00:05:00.000Z',
      ]),
    )
  })

  it('distinguishes a stale owned source from a missing or ineligible share source', async () => {
    const conflictDatabase = new RecordingCipherD1Database(
      [{ revisionDate: '2026-07-06T00:06:00.000Z' }],
      { batchChanges: [0, 0] },
    )
    const input = {
      id: 'cipher-id',
      userId: 'user-id',
      organizationId: 'organization-id',
      collectionIds: ['collection-id'],
      type: 1 as const,
      favorite: false,
      encryptedJson: '{"name":"2.reencrypted"}',
      cipherKey: '2.opaque-cipher-key',
      expectedRevisionDate: '2026-07-06T00:05:00.000Z',
      now: '2026-07-06T00:10:00.000Z',
    }

    await expect(
      sharePersonalCipherWithOrganization(conflictDatabase, input),
    ).resolves.toEqual({
      status: 'conflict',
      currentRevisionDate: '2026-07-06T00:06:00.000Z',
    })
    await expect(
      sharePersonalCipherWithOrganization(
        new RecordingCipherD1Database([], { batchChanges: [0, 0] }),
        input,
      ),
    ).resolves.toEqual({ status: 'not_found' })
  })

  it('fails loudly when an organization transition batch is incomplete', async () => {
    const database = new RecordingCipherD1Database([], {
      batchChanges: [1, 1],
    })

    await expect(
      createOrganizationCipher(database, {
        id: 'organization-cipher-id',
        userId: 'user-id',
        organizationId: 'organization-id',
        collectionIds: ['collection-one', 'collection-two'],
        type: 1,
        favorite: true,
        encryptedJson: '{"name":"2.organization"}',
        cipherKey: '2.opaque-cipher-key',
        now: '2026-07-06T00:10:00.000Z',
      }),
    ).rejects.toThrow('Organization cipher batch did not fully apply')
  })

  it('projects personal and accessible organization ciphers without duplicate collection ids', async () => {
    const database = new RecordingCipherD1Database([
      {
        id: 'personal-cipher-id',
        userId: 'user-id',
        folderId: 'folder-id',
        type: 1,
        favorite: 1,
        encryptedJson: '{"name":"2.personal"}',
        revisionDate: '2026-07-06T00:04:00.000Z',
        createdAt: '2026-07-06T00:04:00.000Z',
        organizationId: null,
        cipherKey: null,
        collectionIdsJson: '[]',
      },
      {
        id: 'organization-cipher-id',
        userId: 'creator-user-id',
        folderId: null,
        type: 1,
        favorite: 0,
        encryptedJson: '{"name":"2.organization"}',
        revisionDate: '2026-07-06T00:05:00.000Z',
        createdAt: '2026-07-06T00:05:00.000Z',
        organizationId: 'organization-id',
        cipherKey: '2.opaque-cipher-key',
        collectionIdsJson:
          '["collection-two","collection-one","collection-one"]',
      },
    ])

    await expect(
      listAccessibleCiphersByUser(database, 'user-id'),
    ).resolves.toEqual([
      {
        id: 'personal-cipher-id',
        userId: 'user-id',
        folderId: 'folder-id',
        type: 1,
        favorite: true,
        encryptedJson: '{"name":"2.personal"}',
        revisionDate: '2026-07-06T00:04:00.000Z',
        createdAt: '2026-07-06T00:04:00.000Z',
        organizationId: null,
        cipherKey: null,
        collectionIds: [],
      },
      {
        id: 'organization-cipher-id',
        userId: 'creator-user-id',
        folderId: null,
        type: 1,
        favorite: false,
        encryptedJson: '{"name":"2.organization"}',
        revisionDate: '2026-07-06T00:05:00.000Z',
        createdAt: '2026-07-06T00:05:00.000Z',
        organizationId: 'organization-id',
        cipherKey: '2.opaque-cipher-key',
        collectionIds: ['collection-one', 'collection-two'],
      },
    ])
    expect(database.boundValueSets).toEqual([['user-id', 'user-id']])
    expect(database.queries.join('\n')).toContain(
      'WITH accessible_organization_collections AS',
    )
    expect(database.queries.join('\n')).toContain('membership.status = 2')
    expect(database.queries.join('\n')).toContain('collection_user.manage = 1')
    expect(database.queries.join('\n')).toContain('json_group_array')
  })

  it('pages and finds ciphers through the same relationship-derived read scope', async () => {
    const row = {
      id: 'organization-cipher-id',
      userId: 'creator-user-id',
      folderId: null,
      type: 1,
      favorite: 0,
      encryptedJson: '{"name":"2.organization"}',
      revisionDate: '2026-07-06T00:06:00.000Z',
      createdAt: '2026-07-06T00:05:00.000Z',
      organizationId: 'organization-id',
      cipherKey: '2.opaque-cipher-key',
      collectionIdsJson: '["collection-id"]',
    }
    const pageDatabase = new RecordingCipherD1Database([
      row,
      { ...row, id: 'organization-cipher-extra' },
    ])

    await expect(
      listAccessibleCiphersByUserPage(pageDatabase, {
        userId: 'user-id',
        limit: 1,
        cursor: {
          revisionDate: '2026-07-06T00:05:00.000Z',
          id: 'cipher-current',
        },
      }),
    ).resolves.toEqual({
      items: [
        {
          id: 'organization-cipher-id',
          userId: 'creator-user-id',
          folderId: null,
          type: 1,
          favorite: false,
          encryptedJson: '{"name":"2.organization"}',
          revisionDate: '2026-07-06T00:06:00.000Z',
          createdAt: '2026-07-06T00:05:00.000Z',
          organizationId: 'organization-id',
          cipherKey: '2.opaque-cipher-key',
          collectionIds: ['collection-id'],
        },
      ],
      hasMore: true,
    })
    expect(pageDatabase.boundValueSets).toEqual([
      [
        'user-id',
        'user-id',
        '2026-07-06T00:05:00.000Z',
        '2026-07-06T00:05:00.000Z',
        'cipher-current',
        2,
      ],
    ])
    expect(pageDatabase.queries.join('\n')).toContain(
      '(cipher.revision_date > ? OR (cipher.revision_date = ? AND cipher.id > ?))',
    )
    expect(pageDatabase.queries.join('\n')).toContain('LIMIT ?')

    const findDatabase = new RecordingCipherD1Database([row])
    await expect(
      findAccessibleCipherById(findDatabase, {
        id: 'organization-cipher-id',
        userId: 'user-id',
      }),
    ).resolves.toEqual({
      id: 'organization-cipher-id',
      userId: 'creator-user-id',
      folderId: null,
      type: 1,
      favorite: false,
      encryptedJson: '{"name":"2.organization"}',
      revisionDate: '2026-07-06T00:06:00.000Z',
      createdAt: '2026-07-06T00:05:00.000Z',
      organizationId: 'organization-id',
      cipherKey: '2.opaque-cipher-key',
      collectionIds: ['collection-id'],
    })
    expect(findDatabase.boundValueSets).toEqual([
      ['user-id', 'organization-cipher-id', 'user-id'],
    ])
    expect(findDatabase.queries.join('\n')).toContain('cipher.id = ?')
  })

  it('rejects organization ciphers that are missing their opaque key', async () => {
    const database = new RecordingCipherD1Database([
      {
        id: 'organization-cipher-id',
        userId: 'creator-user-id',
        folderId: null,
        type: 1,
        favorite: 0,
        encryptedJson: '{"name":"2.organization"}',
        revisionDate: '2026-07-06T00:06:00.000Z',
        createdAt: '2026-07-06T00:05:00.000Z',
        organizationId: 'organization-id',
        cipherKey: null,
        collectionIdsJson: '["collection-id"]',
      },
    ])

    await expect(
      listAccessibleCiphersByUser(database, 'user-id'),
    ).rejects.toThrow(
      'Accessible organization cipher is missing its opaque key.',
    )
  })

  it('lists user ciphers for sync, including trashed rows', async () => {
    const database = new RecordingCipherD1Database([
      {
        id: 'cipher-id',
        userId: 'user-id',
        folderId: 'folder-id',
        type: 1,
        favorite: 1,
        encryptedJson: '{"name":"2.encrypted-name"}',
        revisionDate: '2026-07-06T00:04:00.000Z',
        createdAt: '2026-07-06T00:04:00.000Z',
      },
      {
        id: 'trashed-cipher-id',
        userId: 'user-id',
        folderId: null,
        type: 1,
        favorite: 0,
        encryptedJson: '{"name":"2.trashed-encrypted-name"}',
        revisionDate: '2026-07-06T00:05:00.000Z',
        createdAt: '2026-07-06T00:04:00.000Z',
        deletedAt: '2026-07-06T00:05:00.000Z',
      },
    ])

    await expect(listCiphersByUser(database, 'user-id')).resolves.toEqual([
      {
        id: 'cipher-id',
        userId: 'user-id',
        folderId: 'folder-id',
        type: 1,
        favorite: true,
        encryptedJson: '{"name":"2.encrypted-name"}',
        revisionDate: '2026-07-06T00:04:00.000Z',
        createdAt: '2026-07-06T00:04:00.000Z',
      },
      {
        id: 'trashed-cipher-id',
        userId: 'user-id',
        folderId: null,
        type: 1,
        favorite: false,
        encryptedJson: '{"name":"2.trashed-encrypted-name"}',
        revisionDate: '2026-07-06T00:05:00.000Z',
        createdAt: '2026-07-06T00:04:00.000Z',
        deletedAt: '2026-07-06T00:05:00.000Z',
      },
    ])
    expect(database.boundValues).toContain('user-id')
    expect(database.queries.join('\n')).toContain('WHERE user_id = ?')
    expect(database.queries.join('\n')).not.toContain('deleted_at IS NULL')
  })

  it('lists a bounded page of ciphers using a keyset cursor', async () => {
    const database = new RecordingCipherD1Database([
      {
        id: 'cipher-next',
        userId: 'user-id',
        folderId: null,
        type: 1,
        favorite: 0,
        encryptedJson: '{"name":"2.next-cipher"}',
        revisionDate: '2026-07-06T00:06:00.000Z',
        createdAt: '2026-07-06T00:04:00.000Z',
      },
      {
        id: 'cipher-extra',
        userId: 'user-id',
        folderId: null,
        type: 1,
        favorite: 0,
        encryptedJson: '{"name":"2.extra-cipher"}',
        revisionDate: '2026-07-06T00:07:00.000Z',
        createdAt: '2026-07-06T00:04:00.000Z',
        deletedAt: '2026-07-06T00:07:00.000Z',
      },
    ])

    await expect(
      listCiphersByUserPage(database, {
        userId: 'user-id',
        limit: 1,
        cursor: {
          revisionDate: '2026-07-06T00:05:00.000Z',
          id: 'cipher-current',
        },
      }),
    ).resolves.toEqual({
      items: [
        {
          id: 'cipher-next',
          userId: 'user-id',
          folderId: null,
          type: 1,
          favorite: false,
          encryptedJson: '{"name":"2.next-cipher"}',
          revisionDate: '2026-07-06T00:06:00.000Z',
          createdAt: '2026-07-06T00:04:00.000Z',
        },
      ],
      hasMore: true,
    })
    expect(database.boundValues).toEqual([
      'user-id',
      '2026-07-06T00:05:00.000Z',
      '2026-07-06T00:05:00.000Z',
      'cipher-current',
      2,
    ])
    expect(database.queries.join('\n')).toContain(
      '(revision_date > ? OR (revision_date = ? AND id > ?))',
    )
    expect(database.queries.join('\n')).toContain('LIMIT ?')
    expect(database.queries.join('\n')).not.toContain('deleted_at IS NULL')
  })

  it('finds one cipher for a user, including trashed rows', async () => {
    const database = new RecordingCipherD1Database([
      {
        id: 'trashed-cipher-id',
        userId: 'user-id',
        folderId: null,
        type: 1,
        favorite: 0,
        encryptedJson: '{"name":"2.trashed-encrypted-name"}',
        revisionDate: '2026-07-06T00:05:00.000Z',
        createdAt: '2026-07-06T00:04:00.000Z',
        deletedAt: '2026-07-06T00:05:00.000Z',
      },
    ])

    await expect(
      findCipherById(database, {
        id: 'trashed-cipher-id',
        userId: 'user-id',
      }),
    ).resolves.toEqual({
      id: 'trashed-cipher-id',
      userId: 'user-id',
      folderId: null,
      type: 1,
      favorite: false,
      encryptedJson: '{"name":"2.trashed-encrypted-name"}',
      revisionDate: '2026-07-06T00:05:00.000Z',
      createdAt: '2026-07-06T00:04:00.000Z',
      deletedAt: '2026-07-06T00:05:00.000Z',
    })
    expect(database.boundValues).toContain('trashed-cipher-id')
    expect(database.boundValues).toContain('user-id')
    expect(database.queries.join('\n')).toContain('WHERE id = ?')
    expect(database.queries.join('\n')).toContain('user_id = ?')
    expect(database.queries.join('\n')).not.toContain('deleted_at IS NULL')
  })

  it('creates a cipher with encrypted JSON as an opaque payload', async () => {
    const database = new RecordingCipherD1Database([])

    await expect(
      createCipher(database, {
        id: 'cipher-id',
        userId: 'user-id',
        folderId: 'folder-id',
        type: 1,
        favorite: true,
        encryptedJson: '{"name":"2.encrypted-name"}',
        revisionDate: '2026-07-06T00:04:00.000Z',
        createdAt: '2026-07-06T00:04:00.000Z',
      }),
    ).resolves.toEqual({
      id: 'cipher-id',
      userId: 'user-id',
      folderId: 'folder-id',
      type: 1,
      favorite: true,
      encryptedJson: '{"name":"2.encrypted-name"}',
      revisionDate: '2026-07-06T00:04:00.000Z',
      createdAt: '2026-07-06T00:04:00.000Z',
    })
    expect(database.boundValues).toContain('{"name":"2.encrypted-name"}')
    expect(database.boundValues).toContain(1)
    expect(database.boundValues).toContain('folder-id')
    expect(database.boundValues).toContain('user-id')
  })

  it('updates an active cipher only when it belongs to the user', async () => {
    const database = new RecordingCipherD1Database(
      [
        {
          createdAt: '2026-07-06T00:04:00.000Z',
        },
      ],
      {
        updateChanges: 1,
      },
    )

    await expect(
      updateCipher(database, {
        id: 'cipher-id',
        userId: 'user-id',
        folderId: null,
        type: 1,
        favorite: false,
        encryptedJson: '{"name":"2.updated-encrypted-name"}',
        expectedRevisionDate: '2026-07-06T00:04:00.000Z',
        revisionDate: '2026-07-06T00:06:00.000Z',
        createdAt: '2026-07-06T00:06:00.000Z',
      }),
    ).resolves.toEqual({
      status: 'updated',
      cipher: {
        id: 'cipher-id',
        userId: 'user-id',
        folderId: null,
        type: 1,
        favorite: false,
        encryptedJson: '{"name":"2.updated-encrypted-name"}',
        revisionDate: '2026-07-06T00:06:00.000Z',
        createdAt: '2026-07-06T00:04:00.000Z',
      },
    })
    expect(database.boundValues).toContain('cipher-id')
    expect(database.boundValues).toContain('user-id')
    expect(database.boundValues).toContain('2026-07-06T00:04:00.000Z')
    expect(database.queries.join('\n')).toContain('deleted_at IS NULL')
    expect(database.queries.join('\n')).toContain('AND revision_date = ?')
  })

  it('returns not found when updating a missing, deleted, or cross-user cipher', async () => {
    const database = new RecordingCipherD1Database([], {
      updateChanges: 0,
    })

    await expect(
      updateCipher(database, {
        id: 'cipher-id',
        userId: 'user-id',
        folderId: null,
        type: 1,
        favorite: false,
        encryptedJson: '{"name":"2.updated-encrypted-name"}',
        expectedRevisionDate: '2026-07-06T00:04:00.000Z',
        revisionDate: '2026-07-06T00:06:00.000Z',
        createdAt: '2026-07-06T00:04:00.000Z',
      }),
    ).resolves.toEqual({ status: 'not_found' })
  })

  it('returns conflict when updating a stale active cipher', async () => {
    const database = new RecordingCipherD1Database(
      [
        {
          revisionDate: '2026-07-06T00:05:00.000Z',
        },
      ],
      {
        updateChanges: 0,
      },
    )

    await expect(
      updateCipher(database, {
        id: 'cipher-id',
        userId: 'user-id',
        folderId: null,
        type: 1,
        favorite: false,
        encryptedJson: '{"name":"2.updated-encrypted-name"}',
        expectedRevisionDate: '2026-07-06T00:04:00.000Z',
        revisionDate: '2026-07-06T00:06:00.000Z',
        createdAt: '2026-07-06T00:04:00.000Z',
      }),
    ).resolves.toEqual({
      status: 'conflict',
      currentRevisionDate: '2026-07-06T00:05:00.000Z',
    })
    expect(database.queries.join('\n')).toContain('SELECT revision_date')
    expect(database.queries.join('\n')).toContain('FROM ciphers')
  })

  it('soft-deletes an active cipher for one user', async () => {
    const database = new RecordingCipherD1Database([], {
      softDeleteChanges: 1,
    })

    await expect(
      softDeleteCipher(database, {
        id: 'cipher-id',
        userId: 'user-id',
        deletedAt: '2026-07-06T00:07:00.000Z',
      }),
    ).resolves.toEqual({
      status: 'deleted',
      id: 'cipher-id',
      revisionDate: '2026-07-06T00:07:00.000Z',
      deletedAt: '2026-07-06T00:07:00.000Z',
    })
    expect(database.boundValues).toContain('cipher-id')
    expect(database.boundValues).toContain('user-id')
    expect(database.queries.join('\n')).toContain('deleted_at = ?')
    expect(database.queries.join('\n')).toContain('deleted_at IS NULL')
  })

  it('restores a deleted cipher for one user', async () => {
    const database = new RecordingCipherD1Database([], {
      restoreChanges: 1,
    })

    await expect(
      restoreCipher(database, {
        id: 'cipher-id',
        userId: 'user-id',
        revisionDate: '2026-07-06T00:08:00.000Z',
      }),
    ).resolves.toEqual({
      status: 'restored',
      id: 'cipher-id',
      revisionDate: '2026-07-06T00:08:00.000Z',
    })
    expect(database.boundValues).toContain('cipher-id')
    expect(database.boundValues).toContain('user-id')
    expect(database.queries.join('\n')).toContain('deleted_at = NULL')
    expect(database.queries.join('\n')).toContain('deleted_at IS NOT NULL')
  })

  it('permanently deletes a cipher only when it belongs to the user', async () => {
    const database = new RecordingCipherD1Database([], {
      permanentDeleteChanges: 1,
    })

    await expect(
      permanentlyDeleteCipher(database, {
        id: 'cipher-id',
        userId: 'user-id',
        revisionDate: '2026-07-06T00:09:00.000Z',
      }),
    ).resolves.toEqual({
      status: 'deleted',
      id: 'cipher-id',
      revisionDate: '2026-07-06T00:09:00.000Z',
    })
    expect(database.boundValues).toContain('cipher-id')
    expect(database.boundValues).toContain('user-id')
    expect(database.queries.join('\n')).toContain('DELETE FROM ciphers')
    expect(database.queries.join('\n')).toContain('user_id = ?')
  })

  it('batches bulk mutations with owner-scoped lifecycle predicates', async () => {
    const input = {
      ids: ['cipher-one', 'cipher-two'],
      userId: 'user-id',
      revisionDate: '2026-07-06T00:10:00.000Z',
    }

    const moveDatabase = new RecordingCipherD1Database([], {
      batchChanges: [1],
    })
    await expect(
      bulkMoveCiphers(moveDatabase, { ...input, folderId: 'folder-id' }),
    ).resolves.toBe(1)
    expectOwnerScopedBatch(moveDatabase, 1, 'deleted_at IS NULL')
    expect(moveDatabase.queries.join('\n')).toContain('folder_id = ?')

    const trashDatabase = new RecordingCipherD1Database([], {
      batchChanges: [1],
    })
    await expect(bulkSoftDeleteCiphers(trashDatabase, input)).resolves.toBe(1)
    expectOwnerScopedBatch(trashDatabase, 1, 'deleted_at IS NULL')
    expect(trashDatabase.queries.join('\n')).toContain('deleted_at = ?')

    const restoreDatabase = new RecordingCipherD1Database(
      [{ id: 'cipher-one' }],
      {
        batchChanges: [0, 1],
      },
    )
    await expect(bulkRestoreCiphers(restoreDatabase, input)).resolves.toEqual([
      'cipher-one',
    ])
    expectOwnerScopedBatch(restoreDatabase, 2, 'deleted_at IS NOT NULL')
    expect(restoreDatabase.queries.join('\n')).toContain('deleted_at = NULL')

    const deleteDatabase = new RecordingCipherD1Database([], {
      batchChanges: [1],
    })
    await expect(
      bulkPermanentlyDeleteCiphers(deleteDatabase, input),
    ).resolves.toBe(1)
    expectOwnerScopedBatch(deleteDatabase, 1)
    expect(deleteDatabase.queries.join('\n')).toContain('DELETE FROM ciphers')
  })

  it('chunks the 1000-id bulk boundary below the D1 parameter limit', async () => {
    const input = {
      ids: Array.from({ length: 1_000 }, (_, index) => `cipher-${index}`),
      userId: 'user-id',
      revisionDate: '2026-07-06T00:10:00.000Z',
    }

    for (const run of [
      (database: RecordingCipherD1Database) =>
        bulkMoveCiphers(database, { ...input, folderId: null }),
      (database: RecordingCipherD1Database) =>
        bulkSoftDeleteCiphers(database, input),
      (database: RecordingCipherD1Database) =>
        bulkRestoreCiphers(database, input),
      (database: RecordingCipherD1Database) =>
        bulkPermanentlyDeleteCiphers(database, input),
    ]) {
      const database = new RecordingCipherD1Database([])

      await expect(run(database)).resolves.toBeDefined()
      expect(database.queries.length).toBeLessThanOrEqual(24)
      expect(database.boundValueSets.length).toBe(database.queries.length)
      expect(
        database.boundValueSets.every((values) => values.length <= 100),
      ).toBe(true)
      expect(database.queries.every((query) => query.includes('id IN ('))).toBe(
        true,
      )
      expect(
        database.queries.every((query) => query.includes('user_id = ?')),
      ).toBe(true)
    }
  })

  it('returns not found when lifecycle mutations affect no rows', async () => {
    const database = new RecordingCipherD1Database([], {
      permanentDeleteChanges: 0,
      restoreChanges: 0,
      softDeleteChanges: 0,
    })

    await expect(
      softDeleteCipher(database, {
        id: 'cipher-id',
        userId: 'user-id',
        deletedAt: '2026-07-06T00:07:00.000Z',
      }),
    ).resolves.toEqual({ status: 'not_found' })
    await expect(
      restoreCipher(database, {
        id: 'cipher-id',
        userId: 'user-id',
        revisionDate: '2026-07-06T00:08:00.000Z',
      }),
    ).resolves.toEqual({ status: 'not_found' })
    await expect(
      permanentlyDeleteCipher(database, {
        id: 'cipher-id',
        userId: 'user-id',
        revisionDate: '2026-07-06T00:09:00.000Z',
      }),
    ).resolves.toEqual({ status: 'not_found' })
  })
})

class RecordingCipherD1Database {
  boundValues: unknown[] = []
  boundValueSets: unknown[][] = []
  queries: string[] = []

  constructor(
    private readonly cipherRows: unknown[],
    private readonly options: {
      batchChanges?: number[]
      permanentDeleteChanges?: number
      restoreChanges?: number
      softDeleteChanges?: number
      updateChanges?: number
    } = {},
  ) {}

  prepare(query: string): D1PreparedStatement {
    this.queries.push(query)
    const pushValues = (values: unknown[]) => {
      this.boundValues.push(...values)
      this.boundValueSets.push(values)
    }
    const getRows = () => this.cipherRows
    const getOptions = () => this.options

    const statement = {
      bind(...values: unknown[]) {
        pushValues(values)
        return statement
      },
      async first<T = unknown>(): Promise<T | null> {
        return (getRows()[0] ?? null) as T | null
      },
      async all<T = unknown>(): Promise<D1Result<T>> {
        return {
          success: true,
          results: getRows() as T[],
          meta: fakeMeta,
        }
      },
      async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        let changes = 1

        if (/DELETE\s+FROM\s+ciphers/.test(query)) {
          changes = getOptions().permanentDeleteChanges ?? 1
        } else if (query.includes('deleted_at = NULL')) {
          changes = getOptions().restoreChanges ?? 1
        } else if (query.includes('deleted_at = ?')) {
          changes = getOptions().softDeleteChanges ?? 1
        } else if (/UPDATE\s+ciphers/.test(query)) {
          changes = getOptions().updateChanges ?? 1
        }

        return {
          success: true,
          results: [],
          meta: {
            ...fakeMeta,
            changes,
          },
        }
      },
      async raw<T = unknown>(): Promise<T[]> {
        return []
      },
    } as D1PreparedStatement

    return statement
  }

  async batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    const firstQueryIndex = this.queries.length - statements.length

    return statements.map((_, index) => {
      const query = this.queries[firstQueryIndex + index] ?? ''

      return {
        success: true,
        results: query.includes('SELECT id') ? (this.cipherRows as T[]) : [],
        meta: {
          ...fakeMeta,
          changes: this.options.batchChanges?.[index] ?? 1,
        },
      }
    })
  }
}

function expectOwnerScopedBatch(
  database: RecordingCipherD1Database,
  expectedQueryCount: number,
  lifecyclePredicate?: string,
) {
  expect(database.queries).toHaveLength(expectedQueryCount)
  expect(database.queries.every((query) => query.includes('user_id = ?'))).toBe(
    true,
  )
  if (lifecyclePredicate) {
    expect(
      database.queries.every((query) => query.includes(lifecyclePredicate)),
    ).toBe(true)
  }
  expect(
    database.boundValues.filter((value) => value === 'user-id'),
  ).toHaveLength(expectedQueryCount)
  expect(database.boundValues).toEqual(
    expect.arrayContaining(['cipher-one', 'cipher-two']),
  )
  expect(database.queries.every((query) => query.includes('id IN ('))).toBe(
    true,
  )
}

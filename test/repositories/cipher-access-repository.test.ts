import { describe, expect, it } from 'vitest'

import { resolveCipherAccess } from '../../src/repositories/cipher-repository'
import { FakeD1Database } from '../support/fake-d1'

describe('resolveCipherAccess', () => {
  it('allows only the owner to access a personal cipher', async () => {
    const database = new FakeD1Database(null, [], {
      ciphers: [
        {
          id: 'personal-cipher-id',
          userId: 'owner-user-id',
          organizationId: null,
        },
      ],
    })

    await expect(
      resolveCipherAccess(database, 'owner-user-id', 'personal-cipher-id'),
    ).resolves.toEqual({
      found: true,
      canRead: true,
      canEdit: true,
      canDelete: true,
      organizationId: null,
    })
    await expect(
      resolveCipherAccess(database, 'other-user-id', 'personal-cipher-id'),
    ).resolves.toEqual({
      found: true,
      canRead: false,
      canEdit: false,
      canDelete: false,
      organizationId: null,
    })
    await expect(
      resolveCipherAccess(database, 'owner-user-id', 'missing-cipher-id'),
    ).resolves.toEqual({
      found: false,
      canRead: false,
      canEdit: false,
      canDelete: false,
      organizationId: null,
    })
  })

  it('allows a confirmed member with managed collection access to an org cipher', async () => {
    const database = new FakeD1Database(null, [], {
      ciphers: [
        {
          id: 'organization-cipher-id',
          userId: 'owner-user-id',
          organizationId: 'organization-id',
        },
      ],
      organizationUsers: [
        {
          id: 'organization-user-id',
          organizationId: 'organization-id',
          userId: 'owner-user-id',
          status: 2,
        },
        {
          id: 'unconfirmed-organization-user-id',
          organizationId: 'organization-id',
          userId: 'unconfirmed-user-id',
          status: 1,
        },
      ],
      collections: [
        {
          id: 'collection-id',
          organizationId: 'organization-id',
        },
      ],
      collectionUsers: [
        {
          collectionId: 'collection-id',
          organizationUserId: 'organization-user-id',
          manage: 1,
        },
        {
          collectionId: 'collection-id',
          organizationUserId: 'unconfirmed-organization-user-id',
          manage: 1,
        },
      ],
      collectionCiphers: [
        {
          collectionId: 'collection-id',
          cipherId: 'organization-cipher-id',
        },
      ],
    })

    await expect(
      resolveCipherAccess(database, 'owner-user-id', 'organization-cipher-id'),
    ).resolves.toEqual({
      found: true,
      canRead: true,
      canEdit: true,
      canDelete: true,
      organizationId: 'organization-id',
    })

    for (const userId of ['other-user-id', 'unconfirmed-user-id']) {
      await expect(
        resolveCipherAccess(database, userId, 'organization-cipher-id'),
      ).resolves.toEqual({
        found: true,
        canRead: false,
        canEdit: false,
        canDelete: false,
        organizationId: 'organization-id',
      })
    }
  })
})

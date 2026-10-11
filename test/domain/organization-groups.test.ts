import { describe, expect, it } from 'vitest'
import {
  organizationGroupEtag,
  parseOrganizationGroupIfMatch,
  parseOrganizationGroupWriteRequest,
  projectOrganizationGroup,
} from '../../src/domain/organization-groups'

const body = {
  name: 'Engineering',
  collections: [{ id: 'collection' }],
  users: ['member'],
}

describe('organization group protocol', () => {
  it('requires explicit replacement sets and defaults independent grant dimensions', () => {
    expect(parseOrganizationGroupWriteRequest(body)).toEqual({
      ok: true,
      value: {
        ...body,
        collections: [
          {
            id: 'collection',
            readOnly: false,
            hidePasswords: false,
            manage: false,
          },
        ],
      },
    })
    expect(
      parseOrganizationGroupWriteRequest({
        Name: 'Engineering',
        Collections: [],
        Users: [],
      }),
    ).toEqual({
      ok: true,
      value: { name: 'Engineering', collections: [], users: [] },
    })
    expect(
      parseOrganizationGroupWriteRequest({
        ...body,
        collections: [{ id: 'collection', readOnly: true, manage: true }],
      }).ok,
    ).toBe(true)
  })

  it.each([
    null,
    [],
    { name: 'Engineering', collections: [] },
    { name: 'Engineering', users: [] },
    { ...body, Name: 'Duplicate' },
    { ...body, accessAll: true },
    { ...body, externalId: 'directory' },
    { ...body, name: ' ' },
    { ...body, name: 'a'.repeat(101) },
    { ...body, name: 'name\n' },
    { ...body, users: ['member', 'member'] },
    { ...body, users: ['foreign/id'] },
    {
      ...body,
      users: Array.from({ length: 101 }, (_, index) => `member-${index}`),
    },
    {
      ...body,
      collections: Array.from({ length: 101 }, (_, index) => ({
        id: `collection-${index}`,
      })),
    },
    { ...body, collections: [{ id: 'collection' }, { id: 'collection' }] },
    { ...body, collections: [{ id: 'collection', Id: 'collection' }] },
    { ...body, collections: [{ id: 'collection', readOnly: null }] },
    { ...body, collections: [{ id: 'collection', hidePasswords: 1 }] },
    { ...body, collections: [{ id: 'collection', manage: 'false' }] },
    { ...body, collections: [{ id: 'collection', role: 0 }] },
  ])('rejects malformed or ambiguous request %j', (candidate) => {
    expect(parseOrganizationGroupWriteRequest(candidate)).toEqual({ ok: false })
  })

  it('projects pinned group/details shapes without users or internal revision', () => {
    const record = {
      id: 'group',
      organizationId: 'org',
      revisionDate: '2026-10-04T00:00:00.001Z',
      name: 'Engineering',
      users: ['member'],
      collections: [
        {
          id: 'collection',
          readOnly: true,
          hidePasswords: false,
          manage: false,
        },
      ],
    }
    expect(projectOrganizationGroup(record)).toEqual({
      Object: 'group',
      Id: 'group',
      OrganizationId: 'org',
      Name: 'Engineering',
      ExternalId: null,
    })
    expect(projectOrganizationGroup(record, true)).toEqual({
      Object: 'groupDetails',
      Id: 'group',
      OrganizationId: 'org',
      Name: 'Engineering',
      ExternalId: null,
      Collections: [
        {
          Id: 'collection',
          ReadOnly: true,
          HidePasswords: false,
          Manage: false,
        },
      ],
    })
    const etag = organizationGroupEtag(record)
    expect(parseOrganizationGroupIfMatch(etag, 'group')).toEqual({
      ok: true,
      expectedRevisionDate: record.revisionDate,
    })
    expect(parseOrganizationGroupIfMatch(undefined, 'group')).toEqual({
      ok: true,
    })
    for (const invalid of [
      '*',
      `W/${etag}`,
      `${etag},${etag}`,
      etag.replace('group:', 'foreign:'),
      '"group:tomorrow"',
    ]) {
      expect(parseOrganizationGroupIfMatch(invalid, 'group')).toEqual({
        ok: false,
      })
    }
  })
})

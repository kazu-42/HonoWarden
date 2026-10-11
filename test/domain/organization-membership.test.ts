import { describe, expect, it } from 'vitest'

import { buildEmergencyAccessInviteTokenHash } from '../../src/domain/emergency-access'
import {
  buildOrganizationMembershipInviteTokenHash,
  generateOrganizationMembershipInviteToken,
  organizationMembershipInviteExpiresAt,
  organizationMembershipPolicy,
  organizationMembershipStatus,
  parseOrganizationMembershipAcceptRequest,
  parseOrganizationMembershipConfirmRequest,
  parseOrganizationMembershipIdsRequest,
  parseOrganizationMembershipInviteRequest,
  parseOrganizationMembershipUpdateRequest,
  projectOrganizationMembershipMember,
  projectOrganizationMembershipPublicKey,
  verifyOrganizationMembershipInviteToken,
} from '../../src/domain/organization-membership'

const invalid = { ok: false, code: 'invalid_request' }
const unsupported = { ok: false, code: 'unsupported_feature' }
const invite = { emails: ['recipient@example.test'], type: 2, collections: [] }
const secret = 'organization-membership-invite-secret-32b'

describe('organization membership validation', () => {
  it('normalizes casing and emails while preserving independent collection grants', () => {
    expect(
      parseOrganizationMembershipInviteRequest({
        Emails: ['  RECIPIENT@example.test  ', 'second@example.test'],
        Type: 2,
        Collections: [
          {
            Id: 'collection-a',
            ReadOnly: true,
            HidePasswords: true,
            Manage: false,
          },
          {
            id: 'collection-b',
            readOnly: false,
            hidePasswords: false,
            manage: true,
          },
        ],
        Groups: [],
        AccessAll: false,
        Permissions: {},
      }),
    ).toEqual({
      ok: true,
      value: {
        emailsNormalized: ['recipient@example.test', 'second@example.test'],
        type: 2,
        collections: [
          {
            id: 'collection-a',
            readOnly: true,
            hidePasswords: true,
            manage: false,
          },
          {
            id: 'collection-b',
            readOnly: false,
            hidePasswords: false,
            manage: true,
          },
        ],
      },
    })
  })

  it.each([0, 1, 2])(
    'accepts implemented role %i and defaults omitted assignments to empty',
    (type) => {
      expect(
        parseOrganizationMembershipInviteRequest({
          emails: invite.emails,
          type,
        }),
      ).toEqual({
        ok: true,
        value: { emailsNormalized: invite.emails, type, collections: [] },
      })
    },
  )

  it.each([
    null,
    [],
    {},
    { ...invite, Emails: invite.emails },
    { ...invite, emails: [] },
    { ...invite, emails: ['first@example.test', ' FIRST@example.test '] },
    { ...invite, emails: ['@invalid'] },
    { ...invite, emails: ['first@@example.test'] },
    { ...invite, emails: ['first\n@example.test'] },
    { ...invite, emails: [`${'a'.repeat(250)}@example.test`] },
    {
      ...invite,
      emails: Array.from({ length: 21 }, (_, i) => `u${i}@example.test`),
    },
    { ...invite, type: '2' },
    { ...invite, type: -1 },
    { ...invite, type: 2.1 },
    { ...invite, groups: null },
    { ...invite, accessAll: 'false' },
    { ...invite, permissions: [] },
    { ...invite, unknownAuthority: true },
  ])('rejects invalid or ambiguous invitation payload %#', (body) => {
    expect(parseOrganizationMembershipInviteRequest(body)).toEqual(invalid)
  })

  it.each([
    { ...invite, type: 4 },
    { ...invite, groups: ['group-a'] },
    { ...invite, accessAll: true },
    { ...invite, permissions: { manageUsers: true } },
  ])('explicitly rejects unsupported authorization semantics %#', (body) => {
    expect(parseOrganizationMembershipInviteRequest(body)).toEqual(unsupported)
  })

  it('allows the bounded batch maximum without silently truncating recipients', () => {
    const emails = Array.from({ length: 20 }, (_, i) => `u${i}@example.test`)
    expect(
      parseOrganizationMembershipInviteRequest({ ...invite, emails }),
    ).toEqual({
      ok: true,
      value: { emailsNormalized: emails, type: 2, collections: [] },
    })
    expect(organizationMembershipPolicy.maxInvites).toBe(20)
  })

  it('accepts only current client neutral product flags and its empty permissions wrapper', () => {
    expect(
      parseOrganizationMembershipInviteRequest({
        ...invite,
        accessSecretsManager: false,
        permissions: { response: null },
      }),
    ).toEqual({
      ok: true,
      value: { emailsNormalized: invite.emails, type: 2, collections: [] },
    })
    expect(
      parseOrganizationMembershipUpdateRequest({
        type: 2,
        collections: [],
        AccessSecretsManager: false,
        AccessPam: false,
      }),
    ).toEqual({ ok: true, value: { type: 2, collections: [] } })
    for (const fields of [
      { accessSecretsManager: true },
      { accessPam: true },
      { permissions: { response: null, manageUsers: true } },
      { permissions: { response: {} } },
    ]) {
      expect(
        parseOrganizationMembershipInviteRequest({ ...invite, ...fields }),
      ).toEqual(unsupported)
    }
    for (const fields of [
      { accessSecretsManager: 'false' },
      { accessPam: null },
    ]) {
      expect(
        parseOrganizationMembershipInviteRequest({ ...invite, ...fields }),
      ).toEqual(invalid)
    }
  })

  it.each([
    null,
    {},
    [{ id: '' }],
    [{ id: 'with space' }],
    [{ id: 'x'.repeat(129) }],
    [{ id: 'collection-a', readOnly: 'false' }],
    [{ id: 'collection-a', readOnly: false, ReadOnly: true }],
    [{ id: 'collection-a', manage: null }],
    [{ id: 'collection-a', permissions: {} }],
    [{ id: 'collection-a' }, { id: 'collection-a' }],
    Array.from({ length: 101 }, (_, i) => ({ id: `c-${i}` })),
  ])(
    'rejects malformed assignments %# without partial grants',
    (collections) => {
      expect(
        parseOrganizationMembershipUpdateRequest({ type: 2, collections }),
      ).toEqual(invalid)
    },
  )

  it('parses role/grant replacement and refuses opaque key mutation through updates', () => {
    expect(
      parseOrganizationMembershipUpdateRequest({
        Type: 1,
        Collections: [{ Id: 'collection-a' }],
      }),
    ).toEqual({
      ok: true,
      value: {
        type: 1,
        collections: [
          {
            id: 'collection-a',
            readOnly: false,
            hidePasswords: false,
            manage: false,
          },
        ],
      },
    })
    expect(parseOrganizationMembershipUpdateRequest({ type: 1 })).toEqual(
      invalid,
    )
    expect(
      parseOrganizationMembershipUpdateRequest({
        type: 1,
        collections: [],
        key: 'opaque',
      }),
    ).toEqual(invalid)
  })

  it('accepts generated bearer tokens and rejects short, oversized, or ambiguous bodies', () => {
    const token = generateOrganizationMembershipInviteToken()
    expect(parseOrganizationMembershipAcceptRequest({ Token: token })).toEqual({
      ok: true,
      value: { token },
    })
    for (const body of [
      { token: '' },
      { token: 'short' },
      { token: 'x'.repeat(43) },
      { token: 'A'.repeat(42) },
      { token: 'x'.repeat(257) },
      { token, Token: token },
      { token, type: 0 },
    ]) {
      expect(parseOrganizationMembershipAcceptRequest(body)).toEqual(invalid)
    }
  })

  it('bounds opaque recipient keys in UTF-8 bytes without interpreting their ciphertext', () => {
    const key = 'opaque-member-specific-key'
    expect(parseOrganizationMembershipConfirmRequest({ Key: key })).toEqual({
      ok: true,
      value: { keyEncrypted: key },
    })
    expect(
      parseOrganizationMembershipConfirmRequest({ key: 'x'.repeat(65_536) }).ok,
    ).toBe(true)
    for (const body of [
      { key: '' },
      { key: null },
      { key: 'x'.repeat(65_537) },
      { key: 'é'.repeat(32_769) },
      { key, Key: key },
      { key, orgKey: 'other' },
    ]) {
      expect(parseOrganizationMembershipConfirmRequest(body)).toEqual(invalid)
    }
  })

  it('bounds current client default collection metadata while My Items remains unsupported and disabled', () => {
    const key = 'opaque-member-specific-key'
    for (const defaultUserCollectionName of [
      'opaque-encrypted-my-items',
      '',
      null,
      'x'.repeat(65_536),
    ]) {
      expect(
        parseOrganizationMembershipConfirmRequest({
          key,
          defaultUserCollectionName,
        }),
      ).toEqual({ ok: true, value: { keyEncrypted: key } })
    }
    for (const defaultUserCollectionName of [
      false,
      {},
      'x'.repeat(65_537),
      'é'.repeat(32_769),
    ]) {
      expect(
        parseOrganizationMembershipConfirmRequest({
          key,
          defaultUserCollectionName,
        }),
      ).toEqual(invalid)
    }
    expect(
      parseOrganizationMembershipConfirmRequest({
        key,
        DefaultUserCollectionName: 'opaque',
        defaultUserCollectionName: 'ambiguous',
      }),
    ).toEqual(invalid)
  })

  it('bounds and deduplicates public-key membership ids', () => {
    expect(
      parseOrganizationMembershipIdsRequest({ Ids: ['member-a', 'member-b'] }),
    ).toEqual({ ok: true, value: { ids: ['member-a', 'member-b'] } })
    for (const ids of [
      [],
      ['member-a', 'member-a'],
      ['member/a'],
      ['member\0a'],
      [4],
      Array.from({ length: 101 }, (_, i) => `m-${i}`),
    ]) {
      expect(parseOrganizationMembershipIdsRequest({ ids })).toEqual(invalid)
    }
  })

  it('projects membership details without member wrapped keys or invite verifiers', () => {
    const record = {
      id: 'member-a',
      userId: 'user-a',
      emailNormalized: 'recipient@example.test',
      status: 2 as const,
      type: 2 as const,
      collections: [
        {
          id: 'collection-a',
          readOnly: true,
          hidePasswords: false,
          manage: false,
        },
      ],
      orgKey: 'must-not-leak-wrapped-key',
      inviteTokenHash: 'must-not-leak-verifier',
      token: 'must-not-leak-token',
    }
    const view = projectOrganizationMembershipMember(record)
    expect(view).toEqual({
      Object: 'organizationUserUserDetails',
      Id: 'member-a',
      UserId: 'user-a',
      Name: null,
      Email: 'recipient@example.test',
      Status: 2,
      Type: 2,
      AccessAll: false,
      Permissions: null,
      Groups: [],
      Collections: [
        {
          Id: 'collection-a',
          ReadOnly: true,
          HidePasswords: false,
          Manage: false,
        },
      ],
    })
    expect(JSON.stringify(view)).not.toContain('must-not-leak')
  })

  it('returns only public key material in the recipient public key projection', () => {
    const record = {
      id: 'member-a',
      userId: 'user-a',
      publicKey: 'public-key',
      orgKey: 'must-not-leak',
      inviteTokenHash: 'must-not-leak',
    }
    expect(projectOrganizationMembershipPublicKey(record)).toEqual({
      Object: 'organizationUserPublicKeyResponseModel',
      Id: 'member-a',
      UserId: 'user-a',
      Key: 'public-key',
    })
  })
})

describe('organization membership invite verifier', () => {
  it('keeps explicit state values and expires invitations after exactly five days', () => {
    expect(organizationMembershipStatus).toEqual({
      invited: 0,
      accepted: 1,
      confirmed: 2,
      revoked: -1,
    })
    expect(
      organizationMembershipInviteExpiresAt('2026-10-03T12:00:00.000Z'),
    ).toBe('2026-10-08T12:00:00.000Z')
    expect(() => organizationMembershipInviteExpiresAt('invalid')).toThrow(
      /clock/u,
    )
  })

  it('generates 32-byte unpadded URL tokens and rejects invalid entropy adapters', () => {
    expect(
      generateOrganizationMembershipInviteToken((bytes) => {
        bytes.fill(9)
        return bytes
      }),
    ).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(() =>
      generateOrganizationMembershipInviteToken(() => new Uint8Array(32)),
    ).toThrow(/entropy/u)
    expect(() =>
      generateOrganizationMembershipInviteToken(() => new Uint8Array(8)),
    ).toThrow(/entropy/u)
  })

  it('binds verifiers to organization, membership, email, secret, token and a distinct crypto domain', async () => {
    const token = generateOrganizationMembershipInviteToken()
    const input = {
      secret,
      organizationId: 'org-a',
      membershipId: 'member-a',
      emailNormalized: 'recipient@example.test',
      token,
    }
    const hash = await buildOrganizationMembershipInviteTokenHash(input)
    expect(hash).toMatch(/^hmac-sha256:v1:[A-Za-z0-9_-]{43}$/u)
    expect(hash).not.toContain(token)
    await expect(
      verifyOrganizationMembershipInviteToken({ ...input, storedHash: hash }),
    ).resolves.toBe(true)
    for (const change of [
      { organizationId: 'org-b' },
      { membershipId: 'member-b' },
      { emailNormalized: 'other@example.test' },
      { secret: `${secret}other` },
      { token: generateOrganizationMembershipInviteToken() },
    ]) {
      await expect(
        verifyOrganizationMembershipInviteToken({
          ...input,
          ...change,
          storedHash: hash,
        }),
      ).resolves.toBe(false)
    }
    await expect(
      verifyOrganizationMembershipInviteToken({
        ...input,
        storedHash: `${hash}x`,
      }),
    ).resolves.toBe(false)
    expect(hash).not.toBe(
      await buildEmergencyAccessInviteTokenHash({
        secret,
        relationshipId: 'member-a',
        emailNormalized: input.emailNormalized,
        token,
      }),
    )
  })

  it('fails loudly for insufficient secret material and ambiguous binding components', async () => {
    const input = {
      secret,
      organizationId: 'org-a',
      membershipId: 'member-a',
      emailNormalized: 'recipient@example.test',
      token: generateOrganizationMembershipInviteToken(),
    }
    await expect(
      buildOrganizationMembershipInviteTokenHash({ ...input, secret: 'short' }),
    ).rejects.toThrow(/32 bytes/u)
    await expect(
      buildOrganizationMembershipInviteTokenHash({
        ...input,
        organizationId: 'org-a\0member-a',
      }),
    ).rejects.toThrow(/binding/u)
    await expect(
      buildOrganizationMembershipInviteTokenHash({
        ...input,
        emailNormalized: 'RECIPIENT@example.test',
      }),
    ).rejects.toThrow(/binding/u)
  })
})

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it } from 'vitest'
import { buildAuditEvent } from '../../src/domain/audit'
import {
  acceptOrganizationMemberInvite,
  confirmOrganizationMember,
  findOrganizationMemberForActor,
  findOrganizationUserPublicKeyForActor,
  insertOrganizationMemberInvites,
  listOrganizationMemberPublicKeys,
  listOrganizationMembers,
  reinviteOrganizationMember,
  removeOrganizationMember,
  revokeOrganizationMember,
  updateOrganizationMember,
} from '../../src/repositories/organization-membership-repository'
import { createOrganizationFoundation } from '../../src/repositories/organization-repository'

const instances: Miniflare[] = []
const now = '2026-10-03T00:00:00.000Z'
const later = '2026-10-03T00:00:01.000Z'
const expiry = '2026-10-08T00:00:00.000Z'
const scope = { organizationId: 'org', actorUserId: 'owner' }
const grant = {
  id: 'collection',
  readOnly: true,
  hidePasswords: true,
  manage: false,
}
const audit = () =>
  buildAuditEvent({
    name: 'organization.member.update',
    outcome: 'success',
    requestId: crypto.randomUUID(),
    occurredAt: later,
    actor: { userId: 'owner' },
    target: { type: 'organization_user', id: 'member' },
  })
const mutation = () => ({
  ...scope,
  membershipId: 'member',
  now: later,
  auditEvent: audit(),
})
const acceptance = () => ({
  organizationId: 'org',
  membershipId: 'member',
  userId: 'recipient',
  emailNormalized: 'recipient@example.test',
  inviteTokenHash: 'synthetic-verifier',
  now: later,
  auditEvent: audit(),
})

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()))
})

describe('organization memberships on real D1 with every tracked migration', () => {
  it.each([
    ['actor', 50],
    ['organization', 200],
  ] as const)(
    'atomically refuses an invitation at the %s mail cap',
    async (scopeName, limit) => {
      const db = await database()
      for (let index = 0; index < limit; index++) {
        await db
          .prepare(
            `INSERT INTO audit_events
        (id,schema_version,name,outcome,request_id,occurred_at,actor_user_id,target_type,target_id,context_json)
        VALUES (?,1,'organization.member.invite','success',?,?,?,'organization_user',?,?)`,
          )
          .bind(
            `old-${index}`,
            `request-${index}`,
            now,
            scopeName === 'actor' ? 'owner' : 'other-manager',
            `old-member-${index}`,
            JSON.stringify({ organizationId: 'org' }),
          )
          .run()
      }
      const before = await count(db, 'audit_events')
      expect(
        await insertOrganizationMemberInvites(db, {
          ...scope,
          now: later,
          type: 2,
          collections: [],
          invites: [
            {
              id: 'blocked-member',
              emailNormalized: 'blocked@example.test',
              inviteTokenHash: 'synthetic',
              inviteExpiresAt: expiry,
            },
          ],
          auditEvents: [
            buildAuditEvent({
              name: 'organization.member.invite',
              outcome: 'success',
              requestId: 'blocked',
              occurredAt: later,
              actor: { userId: 'owner' },
              target: { type: 'organization_user', id: 'blocked-member' },
              context: { organizationId: 'org' },
            }),
          ],
        }),
      ).toEqual({ status: 'rate_limited' })
      expect(await count(db, 'audit_events')).toBe(before)
      expect(
        await db
          .prepare(
            "SELECT id FROM organization_users WHERE id='blocked-member'",
          )
          .first(),
      ).toBeNull()
    },
  )

  it('keeps a reinvite token and audit unchanged during the ten-minute cooldown', async () => {
    const db = await database()
    await invite(db)
    const first = {
      ...mutation(),
      emailNormalized: 'recipient@example.test',
      inviteTokenHash: 'first-rotation',
      inviteExpiresAt: expiry,
      auditEvent: buildAuditEvent({
        name: 'organization.member.reinvite',
        outcome: 'success',
        requestId: 'first',
        occurredAt: later,
        actor: { userId: 'owner' },
        target: { type: 'organization_user', id: 'member' },
        context: { organizationId: 'org' },
      }),
    }
    expect(await reinviteOrganizationMember(db, first)).toEqual({
      status: 'success',
    })
    expect(
      await reinviteOrganizationMember(db, {
        ...first,
        inviteTokenHash: 'second-rotation',
        now: '2026-10-03T00:01:00.000Z',
      }),
    ).toEqual({ status: 'rate_limited' })
    expect(
      await db
        .prepare(
          "SELECT invite_token_hash AS hash FROM organization_users WHERE id='member'",
        )
        .first(),
    ).toEqual({ hash: 'first-rotation' })
    expect(
      await db
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_events WHERE name='organization.member.reinvite'",
        )
        .first(),
    ).toEqual({ count: 1 })
  })
  it('returns one sanitized organization-scoped member and only a managed recipient public key', async () => {
    const db = await database()
    await invite(db)
    await acceptOrganizationMemberInvite(db, acceptance())
    expect(
      await findOrganizationMemberForActor(db, {
        ...scope,
        membershipId: 'member',
      }),
    ).toEqual({
      status: 'success',
      member: {
        id: 'member',
        userId: 'recipient',
        name: 'Synthetic recipient',
        emailNormalized: 'recipient@example.test',
        status: 1,
        type: 2,
        collections: [grant],
      },
    })
    expect(
      await findOrganizationUserPublicKeyForActor(db, {
        actorUserId: 'owner',
        userId: 'recipient',
      }),
    ).toEqual({
      status: 'success',
      userId: 'recipient',
      publicKey: 'synthetic-public',
    })
    await db
      .prepare(
        "INSERT INTO organization_users (id,organization_id,user_id,email,status,type) VALUES ('admin-membership','org','admin','admin@example.test',2,1)",
      )
      .run()
    expect(
      (
        await findOrganizationMemberForActor(db, {
          ...scope,
          actorUserId: 'admin',
          membershipId: 'member',
        })
      ).status,
    ).toBe('success')
    expect(
      await findOrganizationUserPublicKeyForActor(db, {
        actorUserId: 'admin',
        userId: 'recipient',
      }),
    ).toEqual({
      status: 'success',
      userId: 'recipient',
      publicKey: 'synthetic-public',
    })
    expect(
      await findOrganizationUserPublicKeyForActor(db, {
        actorUserId: 'admin',
        userId: 'owner',
      }),
    ).toEqual({ status: 'not_found' })
    expect(
      await findOrganizationUserPublicKeyForActor(db, {
        actorUserId: 'admin',
        userId: 'admin',
      }),
    ).toEqual({ status: 'not_found' })
  })

  it.each([
    'foreign-user',
    'ordinary-actor',
    'revoked-recipient',
    'invited-recipient',
    'disabled-recipient',
    'disabled-actor',
    'disabled-org',
    'revoked-actor',
    'missing-key',
  ])('denies account public-key read for %s', async (condition) => {
    const db = await database()
    await confirmed(db)
    const input = { actorUserId: 'owner', userId: 'recipient' }
    if (condition === 'foreign-user') {
      await db
        .prepare(
          "INSERT INTO organizations (id,name,revision_date) VALUES ('foreign','Foreign',?)",
        )
        .bind(now)
        .run()
      await db
        .prepare(
          "INSERT INTO organization_users (id,organization_id,user_id,email,status,type) VALUES ('foreign-member','foreign','outsider','outsider@example.test',2,2)",
        )
        .run()
      input.userId = 'outsider'
      expect(
        await findOrganizationMemberForActor(db, {
          ...scope,
          membershipId: 'foreign-member',
        }),
      ).toEqual({ status: 'not_found' })
    }
    if (condition === 'ordinary-actor') input.actorUserId = 'recipient'
    if (condition === 'revoked-recipient')
      await db
        .prepare(
          "UPDATE organization_users SET status = -1 WHERE id = 'member'",
        )
        .run()
    if (condition === 'invited-recipient')
      await db
        .prepare("UPDATE organization_users SET status = 0 WHERE id = 'member'")
        .run()
    if (condition === 'disabled-recipient')
      await db
        .prepare("UPDATE users SET disabled_at = ? WHERE id = 'recipient'")
        .bind(now)
        .run()
    if (condition === 'disabled-actor')
      await db
        .prepare("UPDATE users SET disabled_at = ? WHERE id = 'owner'")
        .bind(now)
        .run()
    if (condition === 'disabled-org')
      await db.prepare('UPDATE organizations SET enabled = 0').run()
    if (condition === 'revoked-actor')
      await db
        .prepare(
          "UPDATE organization_users SET status = -1 WHERE id = 'owner-membership'",
        )
        .run()
    if (condition === 'missing-key')
      await db
        .prepare("UPDATE users SET public_key = NULL WHERE id = 'recipient'")
        .run()
    expect(await findOrganizationUserPublicKeyForActor(db, input)).toEqual({
      status: 'not_found',
    })
    if (
      [
        'ordinary-actor',
        'disabled-actor',
        'disabled-org',
        'revoked-actor',
      ].includes(condition)
    )
      expect(
        await findOrganizationMemberForActor(db, {
          ...scope,
          actorUserId: input.actorUserId,
          membershipId: 'member',
        }),
      ).toEqual({ status: 'not_found' })
  })
  it('activates an opaque recipient key and assigned grants only after acceptance and confirmation', async () => {
    const db = await database()
    expect(await invite(db)).toEqual({ status: 'success' })
    expect(
      await listOrganizationMemberPublicKeys(db, { ...scope, ids: ['member'] }),
    ).toEqual({ status: 'not_found' })
    expect(await acceptOrganizationMemberInvite(db, acceptance())).toEqual({
      status: 'success',
    })
    expect(
      await listOrganizationMemberPublicKeys(db, { ...scope, ids: ['member'] }),
    ).toEqual({
      status: 'success',
      publicKeys: [
        { id: 'member', userId: 'recipient', publicKey: 'synthetic-public' },
      ],
    })
    expect(
      await confirmOrganizationMember(db, {
        ...mutation(),
        keyEncrypted: '2.synthetic-recipient-wrapper',
      }),
    ).toEqual({ status: 'success' })
    const members = await listOrganizationMembers(db, scope)
    expect(members).toMatchObject({
      status: 'success',
      members: expect.arrayContaining([
        {
          id: 'member',
          userId: 'recipient',
          name: 'Synthetic recipient',
          emailNormalized: 'recipient@example.test',
          status: 2,
          type: 2,
          collections: [grant],
        },
      ]),
    })
    expect(JSON.stringify(members)).not.toContain('synthetic-recipient-wrapper')
    expect(JSON.stringify(members)).not.toContain('synthetic-verifier')
    expect(await count(db, 'audit_events')).toBe(3)
  })

  it.each([
    'wrong-email',
    'wrong-actor',
    'wrong-token',
    'expired',
    'disabled-account',
    'disabled-org',
  ])(
    'denies invitation acceptance %s without mutation or audit',
    async (condition) => {
      const db = await database()
      await invite(db)
      const input = acceptance()
      if (condition === 'wrong-email')
        input.emailNormalized = 'other@example.test'
      if (condition === 'wrong-actor') input.userId = 'outsider'
      if (condition === 'wrong-token') input.inviteTokenHash = 'wrong'
      if (condition === 'expired') input.now = expiry
      if (condition === 'disabled-account')
        await db
          .prepare("UPDATE users SET disabled_at = ? WHERE id = 'recipient'")
          .bind(now)
          .run()
      if (condition === 'disabled-org')
        await db.prepare('UPDATE organizations SET enabled = 0').run()
      expect(await acceptOrganizationMemberInvite(db, input)).toEqual({
        status: 'not_found',
      })
      expect(
        await db
          .prepare(
            "SELECT status, user_id FROM organization_users WHERE id = 'member'",
          )
          .first(),
      ).toEqual({ status: 0, user_id: null })
      expect(await count(db, 'audit_events')).toBe(1)
    },
  )

  it('has exactly one winner for concurrent token acceptance and confirmation', async () => {
    const db = await database()
    await invite(db)
    const accepts = await Promise.all([
      acceptOrganizationMemberInvite(db, acceptance()),
      acceptOrganizationMemberInvite(db, acceptance()),
    ])
    expect(accepts.map((result) => result.status).sort()).toEqual([
      'not_found',
      'success',
    ])
    const confirms = await Promise.all([
      confirmOrganizationMember(db, {
        ...mutation(),
        keyEncrypted: '2.wrapper-a',
      }),
      confirmOrganizationMember(db, {
        ...mutation(),
        keyEncrypted: '2.wrapper-b',
      }),
    ])
    expect(confirms.map((result) => result.status).sort()).toEqual([
      'not_found',
      'success',
    ])
    expect(await count(db, 'audit_events')).toBe(3)
  })

  it('rotates invited verifiers and refuses reinvite after acceptance', async () => {
    const db = await database()
    await invite(db)
    const reinvite = {
      ...mutation(),
      emailNormalized: 'recipient@example.test',
      inviteTokenHash: 'new-verifier',
      inviteExpiresAt: expiry,
    }
    expect(await reinviteOrganizationMember(db, reinvite)).toEqual({
      status: 'success',
    })
    expect(await acceptOrganizationMemberInvite(db, acceptance())).toEqual({
      status: 'not_found',
    })
    expect(
      await acceptOrganizationMemberInvite(db, {
        ...acceptance(),
        inviteTokenHash: 'new-verifier',
      }),
    ).toEqual({ status: 'success' })
    expect(await reinviteOrganizationMember(db, reinvite)).toEqual({
      status: 'not_found',
    })
  })

  it('enforces Admin hierarchy and denies ordinary members, disabled accounts, and cross-org assignments', async () => {
    const db = await database()
    await confirmed(db)
    await db
      .prepare(
        "INSERT INTO organization_users (id, organization_id, user_id, email, type, status) VALUES ('admin-membership', 'org', 'admin', 'admin@example.test', 1, 2)",
      )
      .run()
    expect(
      await updateOrganizationMember(db, {
        ...mutation(),
        actorUserId: 'admin',
        type: 2,
        collections: [],
      }),
    ).toEqual({ status: 'success' })
    expect(
      await updateOrganizationMember(db, {
        ...mutation(),
        actorUserId: 'admin',
        type: 0,
        collections: [],
      }),
    ).toEqual({ status: 'not_found' })
    expect(
      await revokeOrganizationMember(db, {
        ...mutation(),
        actorUserId: 'admin',
        membershipId: 'owner-membership',
      }),
    ).toEqual({ status: 'not_found' })
    expect(
      await updateOrganizationMember(db, {
        ...mutation(),
        actorUserId: 'recipient',
        type: 2,
        collections: [],
      }),
    ).toEqual({ status: 'not_found' })
    await db
      .prepare(
        "INSERT INTO organizations (id,name,revision_date) VALUES ('foreign','Foreign',?)",
      )
      .bind(now)
      .run()
    await db
      .prepare(
        "INSERT INTO collections (id,organization_id,encrypted_name,revision_date) VALUES ('foreign-collection','foreign','2.foreign',?)",
      )
      .bind(now)
      .run()
    expect(
      await updateOrganizationMember(db, {
        ...mutation(),
        type: 2,
        collections: [{ ...grant, id: 'foreign-collection' }],
      }),
    ).toEqual({ status: 'not_found' })
    await db
      .prepare("UPDATE users SET disabled_at = ? WHERE id = 'owner'")
      .bind(now)
      .run()
    expect(await revokeOrganizationMember(db, mutation())).toEqual({
      status: 'not_found',
    })
    expect(await listOrganizationMembers(db, scope)).toEqual({
      status: 'not_found',
    })
  })

  it('protects the last enabled confirmed Owner under revoke, remove and demotion and concurrent owners', async () => {
    const db = await database()
    const input = { ...mutation(), membershipId: 'owner-membership' }
    expect(await revokeOrganizationMember(db, input)).toEqual({
      status: 'not_found',
    })
    expect(await removeOrganizationMember(db, input)).toEqual({
      status: 'not_found',
    })
    expect(
      await updateOrganizationMember(db, {
        ...input,
        type: 1,
        collections: [],
      }),
    ).toEqual({ status: 'not_found' })
    await db
      .prepare(
        "INSERT INTO organization_users (id,organization_id,user_id,email,status,type) VALUES ('other-owner','org','admin','admin@example.test',2,0)",
      )
      .run()
    const results = await Promise.all([
      revokeOrganizationMember(db, input),
      revokeOrganizationMember(db, {
        ...input,
        membershipId: 'other-owner',
        actorUserId: 'admin',
      }),
    ])
    expect(results.map((result) => result.status).sort()).toEqual([
      'not_found',
      'success',
    ])
    expect(
      await db
        .prepare(
          'SELECT COUNT(*) count FROM organization_users WHERE status = 2 AND type = 0',
        )
        .first(),
    ).toEqual({ count: 1 })
  })

  it.each(['confirm', 'update', 'revoke', 'remove', 'invite'])(
    'rolls back %s including grants and revisions when mandatory audit persistence fails',
    async (action) => {
      const db = await database()
      if (action !== 'invite') {
        await invite(db)
        await acceptOrganizationMemberInvite(db, acceptance())
      }
      if (['update', 'revoke', 'remove'].includes(action))
        await confirmOrganizationMember(db, {
          ...mutation(),
          keyEncrypted: '2.original-wrapper',
        })
      const before = await snapshot(db)
      await db
        .prepare(
          "CREATE TRIGGER fail_membership_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END;",
        )
        .run()
      const operation =
        action === 'confirm'
          ? confirmOrganizationMember(db, {
              ...mutation(),
              keyEncrypted: '2.new-wrapper',
            })
          : action === 'update'
            ? updateOrganizationMember(db, {
                ...mutation(),
                type: 1,
                collections: [],
              })
            : action === 'revoke'
              ? revokeOrganizationMember(db, mutation())
              : action === 'remove'
                ? removeOrganizationMember(db, mutation())
                : invite(db)
      await expect(operation).rejects.toThrow('synthetic audit failure')
      expect(await snapshot(db)).toEqual(before)
    },
  )

  it('returns success on cascade removal and advances polling revision beyond disappearing shared data', async () => {
    const db = await database()
    await confirmed(db)
    const future = '2027-01-01T00:00:00.000Z'
    await db
      .prepare('UPDATE organizations SET revision_date = ?')
      .bind(future)
      .run()
    expect(await removeOrganizationMember(db, mutation())).toEqual({
      status: 'success',
    })
    expect(
      await db
        .prepare("SELECT revision_date FROM users WHERE id = 'recipient'")
        .first(),
    ).toEqual({ revision_date: '2027-01-01T00:00:00.002Z' })
    expect(
      await db
        .prepare(
          "SELECT COUNT(*) count FROM collection_users WHERE organization_user_id = 'member'",
        )
        .first(),
    ).toEqual({ count: 0 })
    expect(
      await db
        .prepare(
          "SELECT COUNT(*) count FROM organization_users WHERE id = 'member'",
        )
        .first(),
    ).toEqual({ count: 0 })
  })

  it('rejects duplicate email invite batches and foreign public-key IDs without partial writes or disclosures', async () => {
    const db = await database()
    await confirmed(db)
    expect(await invite(db)).toEqual({ status: 'conflict' })
    expect(
      await listOrganizationMemberPublicKeys(db, {
        ...scope,
        ids: ['member', 'missing'],
      }),
    ).toEqual({ status: 'not_found' })
    expect(
      await listOrganizationMemberPublicKeys(db, {
        ...scope,
        actorUserId: 'recipient',
        ids: ['owner-membership'],
      }),
    ).toEqual({ status: 'not_found' })
    await db
      .prepare(
        "INSERT INTO organizations (id,name,revision_date) VALUES ('foreign','Foreign',?)",
      )
      .bind(now)
      .run()
    await db
      .prepare(
        "INSERT INTO organization_users (id,organization_id,user_id,email,status,type) VALUES ('foreign-member','foreign','outsider','outsider@example.test',2,2)",
      )
      .run()
    expect(
      await listOrganizationMemberPublicKeys(db, {
        ...scope,
        ids: ['member', 'foreign-member'],
      }),
    ).toEqual({ status: 'not_found' })
    await db
      .prepare("UPDATE users SET disabled_at = ? WHERE id = 'recipient'")
      .bind(now)
      .run()
    expect(
      await listOrganizationMemberPublicKeys(db, { ...scope, ids: ['member'] }),
    ).toEqual({ status: 'not_found' })
  })

  it('creates bounded invite batches atomically and rejects a mixed duplicate batch', async () => {
    const db = await database()
    const invites = ['recipient', 'outsider'].map((user) => ({
      id: `invite-${user}`,
      emailNormalized: `${user}@example.test`,
      inviteTokenHash: `synthetic-${user}-verifier`,
      inviteExpiresAt: expiry,
    }))
    const input = {
      ...scope,
      now,
      type: 2 as const,
      collections: [grant],
      invites,
      auditEvents: [audit(), audit()],
    }
    expect(await insertOrganizationMemberInvites(db, input)).toEqual({
      status: 'success',
    })
    expect(await count(db, 'organization_users')).toBe(3)
    expect(await count(db, 'collection_users')).toBe(3)
    expect(await count(db, 'audit_events')).toBe(2)
    const before = await snapshot(db)
    expect(
      await insertOrganizationMemberInvites(db, {
        ...input,
        invites: [
          invites[0]!,
          {
            ...invites[1]!,
            id: 'new-admin',
            emailNormalized: 'admin@example.test',
          },
        ],
      }),
    ).toEqual({ status: 'conflict' })
    expect(await snapshot(db)).toEqual(before)
  })

  it.each(['remove', 'demote'])(
    'retains one owner after concurrent self %s even with stale request timestamps',
    async (action) => {
      const db = await database()
      await db
        .prepare(
          "INSERT INTO organization_users (id,organization_id,user_id,email,status,type) VALUES ('other-owner','org','admin','admin@example.test',2,0)",
        )
        .run()
      const owner = { ...mutation(), membershipId: 'owner-membership', now }
      const other = {
        ...mutation(),
        membershipId: 'other-owner',
        actorUserId: 'admin',
        now,
      }
      const operation = (input: ReturnType<typeof mutation>) =>
        action === 'remove'
          ? removeOrganizationMember(db, input)
          : updateOrganizationMember(db, { ...input, type: 2, collections: [] })
      const results = await Promise.all([operation(owner), operation(other)])
      expect(results.map((result) => result.status).sort()).toEqual([
        'not_found',
        'success',
      ])
      expect(
        await db
          .prepare(
            'SELECT COUNT(*) count FROM organization_users WHERE status = 2 AND type = 0',
          )
          .first(),
      ).toEqual({ count: 1 })
    },
  )

  it('does not treat a disabled confirmed owner as a surviving enabled owner', async () => {
    const db = await database()
    await db
      .prepare(
        "INSERT INTO organization_users (id,organization_id,user_id,email,status,type) VALUES ('other-owner','org','admin','admin@example.test',2,0)",
      )
      .run()
    await db
      .prepare("UPDATE users SET disabled_at = ? WHERE id = 'admin'")
      .bind(now)
      .run()
    expect(
      await removeOrganizationMember(db, {
        ...mutation(),
        membershipId: 'owner-membership',
      }),
    ).toEqual({ status: 'not_found' })
    expect(
      await updateOrganizationMember(db, {
        ...mutation(),
        membershipId: 'owner-membership',
        type: 1,
        collections: [],
      }),
    ).toEqual({ status: 'not_found' })
  })

  it('rechecks actor role after a successful service authorization read', async () => {
    const db = await database()
    await confirmed(db)
    expect((await listOrganizationMembers(db, scope)).status).toBe('success')
    await db
      .prepare(
        "UPDATE organization_users SET type = 2 WHERE id = 'owner-membership'",
      )
      .run()
    const before = await snapshot(db)
    expect(
      await updateOrganizationMember(db, {
        ...mutation(),
        type: 2,
        collections: [],
      }),
    ).toEqual({ status: 'not_found' })
    expect(await revokeOrganizationMember(db, mutation())).toEqual({
      status: 'not_found',
    })
    expect(await snapshot(db)).toEqual(before)
  })
})

async function invite(db: D1Database) {
  return insertOrganizationMemberInvites(db, {
    ...scope,
    now,
    type: 2,
    collections: [grant],
    invites: [
      {
        id: 'member',
        emailNormalized: 'recipient@example.test',
        inviteTokenHash: 'synthetic-verifier',
        inviteExpiresAt: expiry,
      },
    ],
    auditEvents: [audit()],
  })
}
async function confirmed(db: D1Database) {
  await invite(db)
  await acceptOrganizationMemberInvite(db, acceptance())
  await confirmOrganizationMember(db, {
    ...mutation(),
    keyEncrypted: '2.recipient-wrapper',
  })
}
async function count(db: D1Database, table: string) {
  return (await db
    .prepare(`SELECT COUNT(*) count FROM ${table}`)
    .first<{ count: number }>())!.count
}
async function snapshot(db: D1Database) {
  return Promise.all(
    [
      'organization_users',
      'collection_users',
      'organizations',
      'users',
      'audit_events',
    ].map(
      async (table) =>
        (await db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results,
    ),
  )
}
async function database(): Promise<D1Database> {
  const instance = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: '2026-07-21',
    d1Databases: { DB: crypto.randomUUID() },
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
  for (const user of ['owner', 'recipient', 'admin', 'outsider']) {
    await db
      .prepare(
        `INSERT INTO users (id,email,email_normalized,display_name,kdf_algorithm,kdf_iterations,master_password_hash,security_stamp,revision_date,public_key)
      VALUES (?,?,?,?,'pbkdf2-sha256',600000,'synthetic-hash','synthetic-stamp',?,'synthetic-public')`,
      )
      .bind(
        user,
        `${user}@example.test`,
        `${user}@example.test`,
        user === 'recipient' ? 'Synthetic recipient' : user,
        now,
      )
      .run()
  }
  await createOrganizationFoundation(db, {
    organizationId: 'org',
    organizationUserId: 'owner-membership',
    collectionId: 'collection',
    userId: 'owner',
    email: 'owner@example.test',
    name: 'Synthetic company',
    billingEmail: null,
    planType: 0,
    orgKey: '2.owner-wrapper',
    publicKey: 'synthetic-org-public',
    privateKey: '2.org-private',
    encryptedCollectionName: '2.collection',
    now,
  })
  return db
}

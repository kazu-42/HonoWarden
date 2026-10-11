import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it } from 'vitest'
import { buildAuditEvent, type AuditEventName } from '../../src/domain/audit'
import {
  listOrganizationMembers as listMembersService,
  readOrganizationMember as readMemberService,
} from '../../src/organization-membership'
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
import { updateOrganizationCipher } from '../../src/repositories/organization-cipher-mutation-repository'
import { getAccountRevisionDate } from '../../src/repositories/user-repository'
import { registerOrganizationMembershipRoutes } from '../../src/organization-membership-routes'

const instances: Miniflare[] = []
const now = '2026-10-04T00:00:00.000Z'
const expires = '2026-10-09T00:00:00.000Z'
const proof = { sessionId: 'owner-family', deviceIdentifier: 'owner-device' }
const scope = { organizationId: 'org', actorUserId: 'owner', ...proof }
const grant = {
  id: 'collection',
  readOnly: true,
  hidePasswords: false,
  manage: false,
}
const event = (name: AuditEventName, id = 'member') =>
  buildAuditEvent({
    name,
    outcome: 'success',
    requestId: crypto.randomUUID(),
    occurredAt: now,
    actor: { userId: 'owner' },
    target: { type: 'organization_user', id },
    context: { organizationId: 'org' },
  })
const mutation = (membershipId = 'member') => ({
  ...scope,
  membershipId,
  now,
  auditEvent: event('organization.member.update', membershipId),
})
const acceptance = () => ({
  organizationId: 'org',
  membershipId: 'invited',
  userId: 'outsider',
  emailNormalized: 'outsider@example.test',
  inviteTokenHash: 'synthetic-verifier',
  now,
  auditEvent: event('organization.member.accept', 'invited'),
})

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()))
})

describe('membership required-TOTP and atomic offboarding on actual migrated D1', () => {
  it.each([
    'missing-context',
    'wrong-family',
    'wrong-device',
    'other-user',
    'unenrolled',
    'disabled-factor',
    'unverified-factor',
    'missing-generation',
    'stale-generation',
    'revoked-session',
    'disabled-account',
    'revoked-membership',
    'disabled-org',
  ])(
    'denies protected member reads and writes with %s without mutation',
    async (condition) => {
      const db = await database()
      await requirePolicy(db)
      await enroll(db, 'owner', true)
      const context: {
        actorUserId: string
        sessionId?: string
        deviceIdentifier?: string
      } = { ...scope }
      if (condition === 'missing-context') {
        delete context.sessionId
        delete context.deviceIdentifier
      }
      if (condition === 'wrong-family') context.sessionId = 'older-family'
      if (condition === 'wrong-device')
        context.deviceIdentifier = 'other-device'
      if (condition === 'other-user') context.actorUserId = 'admin'
      if (condition === 'unenrolled')
        await db.prepare("DELETE FROM user_totp WHERE user_id='owner'").run()
      if (condition === 'disabled-factor')
        await db
          .prepare("UPDATE user_totp SET enabled=0 WHERE user_id='owner'")
          .run()
      if (condition === 'unverified-factor')
        await db
          .prepare(
            "UPDATE user_totp SET verified_at=NULL WHERE user_id='owner'",
          )
          .run()
      if (condition === 'missing-generation')
        await db
          .prepare(
            "UPDATE user_totp SET credential_generation=NULL WHERE user_id='owner'",
          )
          .run()
      if (condition === 'stale-generation')
        await db
          .prepare(
            "UPDATE devices SET mfa_totp_credential_generation='old-generation' WHERE user_id='owner'",
          )
          .run()
      if (condition === 'revoked-session')
        await db
          .prepare("UPDATE devices SET revoked_at=? WHERE user_id='owner'")
          .bind(now)
          .run()
      if (condition === 'disabled-account')
        await db
          .prepare("UPDATE users SET disabled_at=? WHERE id='owner'")
          .bind(now)
          .run()
      if (condition === 'revoked-membership')
        await db
          .prepare(
            "UPDATE organization_users SET status=-1 WHERE id='owner-member'",
          )
          .run()
      if (condition === 'disabled-org')
        await db
          .prepare("UPDATE organizations SET enabled=0 WHERE id='org'")
          .run()
      const input = {
        organizationId: 'org',
        membershipId: 'member',
        now,
        auditEvent: event('organization.member.update'),
        ...context,
      }
      const before = await snapshot(db)
      expect(
        await listOrganizationMembers(db, {
          organizationId: 'org',
          ...context,
        }),
      ).toEqual({ status: 'not_found' })
      expect(await findOrganizationMemberForActor(db, input)).toEqual({
        status: 'not_found',
      })
      expect(
        await listOrganizationMemberPublicKeys(db, {
          organizationId: 'org',
          ...context,
          ids: ['member'],
        }),
      ).toEqual({ status: 'not_found' })
      expect(
        await findOrganizationUserPublicKeyForActor(db, {
          ...context,
          userId: 'recipient',
        }),
      ).toEqual({ status: 'not_found' })
      expect(
        await insertOrganizationMemberInvites(db, invitation(context)),
      ).toEqual({ status: 'not_found' })
      expect(
        await confirmOrganizationMember(db, {
          ...input,
          keyEncrypted: '2.synthetic-member-key',
        }),
      ).toEqual({ status: 'not_found' })
      expect(
        await updateOrganizationMember(db, {
          ...input,
          type: 2,
          collections: [],
        }),
      ).toEqual({ status: 'not_found' })
      expect(await revokeOrganizationMember(db, input)).toEqual({
        status: 'not_found',
      })
      expect(await removeOrganizationMember(db, input)).toEqual({
        status: 'not_found',
      })
      expect(
        await reinviteOrganizationMember(db, {
          ...input,
          membershipId: 'invited',
          emailNormalized: 'outsider@example.test',
          inviteTokenHash: 'synthetic-replacement',
          inviteExpiresAt: expires,
        }),
      ).toEqual({ status: 'not_found' })
      expect(await snapshot(db)).toEqual(before)
    },
  )

  it('requires accepting recipient own live family proof and rechecks disabled accounts', async () => {
    const db = await database()
    await requirePolicy(db)
    await enroll(db, 'outsider', true)
    const before = await snapshot(db)
    expect(await acceptOrganizationMemberInvite(db, acceptance())).toEqual({
      status: 'not_found',
    })
    expect(
      await acceptOrganizationMemberInvite(db, { ...acceptance(), ...proof }),
    ).toEqual({ status: 'not_found' })
    expect(await snapshot(db)).toEqual(before)
    await db
      .prepare("UPDATE users SET disabled_at=? WHERE id='outsider'")
      .bind(now)
      .run()
    const disabled = await snapshot(db)
    expect(
      await acceptOrganizationMemberInvite(db, {
        ...acceptance(),
        sessionId: 'outsider-family',
        deviceIdentifier: 'outsider-device',
      }),
    ).toEqual({ status: 'not_found' })
    expect(await snapshot(db)).toEqual(disabled)
    await db
      .prepare("UPDATE users SET disabled_at=NULL WHERE id='outsider'")
      .run()
    expect(
      await acceptOrganizationMemberInvite(db, {
        ...acceptance(),
        sessionId: 'outsider-family',
        deviceIdentifier: 'outsider-device',
      }),
    ).toEqual({ status: 'success' })
  })

  it.each([
    'missing-factor',
    'disabled-factor',
    'unverified-factor',
    'missing-generation',
    'disabled-recipient',
  ])('refuses confirmation when recipient posture is %s', async (condition) => {
    const db = await database()
    await requirePolicy(db)
    await enroll(db, 'owner', true)
    if (condition !== 'missing-factor') await enroll(db, 'recipient', false)
    if (condition === 'disabled-factor')
      await db
        .prepare("UPDATE user_totp SET enabled=0 WHERE user_id='recipient'")
        .run()
    if (condition === 'unverified-factor')
      await db
        .prepare(
          "UPDATE user_totp SET verified_at=NULL WHERE user_id='recipient'",
        )
        .run()
    if (condition === 'missing-generation')
      await db
        .prepare(
          "UPDATE user_totp SET credential_generation=NULL WHERE user_id='recipient'",
        )
        .run()
    if (condition === 'disabled-recipient')
      await db
        .prepare("UPDATE users SET disabled_at=? WHERE id='recipient'")
        .bind(now)
        .run()
    const before = await snapshot(db)
    expect(
      await confirmOrganizationMember(db, {
        ...mutation(),
        keyEncrypted: '2.synthetic-member-key',
      }),
    ).toEqual({ status: 'not_found' })
    expect(await snapshot(db)).toEqual(before)
  })

  it('confirms an enrolled recipient without requiring an online recipient family', async () => {
    const db = await database()
    await requirePolicy(db)
    await enroll(db, 'owner', true)
    await enroll(db, 'recipient', false)
    expect(
      await confirmOrganizationMember(db, {
        ...mutation(),
        keyEncrypted: '2.synthetic-member-key',
      }),
    ).toEqual({ status: 'success' })
    expect(
      await db
        .prepare(
          "SELECT status,org_key FROM organization_users WHERE id='member'",
        )
        .first(),
    ).toEqual({ status: 2, org_key: '2.synthetic-member-key' })
    expect(
      await db
        .prepare(
          "SELECT COUNT(*) AS count FROM devices WHERE user_id='recipient'",
        )
        .first(),
    ).toEqual({ count: 0 })
  })

  it.each(['downgrade', 'revoke', 'remove'] as const)(
    'protects the last enrolled active confirmed Owner on %s despite another unenrolled Owner',
    async (operation) => {
      const db = await database()
      await requirePolicy(db)
      await enroll(db, 'owner', true)
      const input = mutation('owner-member')
      const before = await snapshot(db)
      expect(await ownerOperation(db, operation, input)).toEqual({
        status: 'not_found',
      })
      expect(await snapshot(db)).toEqual(before)
      await enroll(db, 'owner2', false)
      expect(await ownerOperation(db, operation, input)).toEqual({
        status: 'success',
      })
    },
  )

  it('has exactly one winner when two enrolled Owners revoke themselves concurrently', async () => {
    const db = await database()
    await requirePolicy(db)
    await enroll(db, 'owner', true)
    await enroll(db, 'owner2', true)
    const results = await Promise.all([
      revokeOrganizationMember(db, mutation('owner-member')),
      revokeOrganizationMember(db, {
        ...mutation('owner2-member'),
        actorUserId: 'owner2',
        sessionId: 'owner2-family',
        deviceIdentifier: 'owner2-device',
      }),
    ])
    expect(results.map((result) => result.status).sort()).toEqual([
      'not_found',
      'success',
    ])
    expect(
      await db
        .prepare(
          `SELECT COUNT(*) AS count FROM organization_users membership
      JOIN users account ON account.id=membership.user_id AND account.disabled_at IS NULL
      JOIN user_totp factor ON factor.user_id=membership.user_id AND factor.enabled=1
        AND factor.verified_at IS NOT NULL AND factor.credential_generation IS NOT NULL
      WHERE membership.organization_id='org' AND membership.type=0 AND membership.status=2`,
        )
        .first(),
    ).toEqual({ count: 1 })
    expect(await count(db, 'audit_events')).toBe(1)
  })

  it('does not count a disabled enrolled Owner as a surviving recovery authority', async () => {
    const db = await database()
    await requirePolicy(db)
    await enroll(db, 'owner', true)
    await enroll(db, 'owner2', false)
    await db
      .prepare("UPDATE users SET disabled_at=? WHERE id='owner2'")
      .bind(now)
      .run()
    const before = await snapshot(db)
    expect(
      await removeOrganizationMember(db, mutation('owner-member')),
    ).toEqual({ status: 'not_found' })
    expect(await snapshot(db)).toEqual(before)
  })

  it.each([
    'invite',
    'accept',
    'confirm',
    'update',
    'reinvite',
    'revoke',
    'remove',
  ] as const)(
    'rolls back every lifecycle field and grant when mandatory audit is silently ignored on %s',
    async (operation) => {
      const db = await database()
      await db
        .prepare(
          'CREATE TRIGGER ignore_member_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(IGNORE); END;',
        )
        .run()
      const before = await snapshot(db)
      await expect(lifecycle(db, operation)).rejects.toThrow()
      expect(await snapshot(db)).toEqual(before)
      await db.prepare('DROP TRIGGER ignore_member_audit').run()
      expect(await lifecycle(db, operation)).toEqual({ status: 'success' })
    },
  )

  it('rolls back the whole invite batch when only a later mandatory audit is ignored', async () => {
    const db = await database()
    const input = invitation()
    input.invites.push({
      id: 'new-invited-2',
      emailNormalized: 'new-recipient-2@example.test',
      inviteTokenHash: 'synthetic-second',
      inviteExpiresAt: expires,
    })
    input.auditEvents.push(event('organization.member.invite', 'new-invited-2'))
    await db
      .prepare(
        "CREATE TRIGGER ignore_later_audit BEFORE INSERT ON audit_events WHEN NEW.target_id='new-invited-2' BEGIN SELECT RAISE(IGNORE); END;",
      )
      .run()
    const before = await snapshot(db)
    await expect(insertOrganizationMemberInvites(db, input)).rejects.toThrow()
    expect(await snapshot(db)).toEqual(before)
  })

  it.each([
    [
      'group-cleanup',
      'CREATE TRIGGER ignore_required_write BEFORE DELETE ON organization_group_users BEGIN SELECT RAISE(IGNORE); END;',
      'revoke',
    ],
    [
      'user-revision',
      'CREATE TRIGGER ignore_required_write BEFORE UPDATE ON users BEGIN SELECT RAISE(IGNORE); END;',
      'revoke',
    ],
    [
      'organization-revision',
      'CREATE TRIGGER ignore_required_write BEFORE UPDATE ON organizations BEGIN SELECT RAISE(IGNORE); END;',
      'revoke',
    ],
    [
      'member-removal',
      'CREATE TRIGGER ignore_required_write BEFORE DELETE ON organization_users BEGIN SELECT RAISE(IGNORE); END;',
      'remove',
    ],
    [
      'direct-grant-delete',
      'CREATE TRIGGER ignore_required_write BEFORE DELETE ON collection_users BEGIN SELECT RAISE(IGNORE); END;',
      'revoke',
    ],
    [
      'direct-grant-delete-before-remove',
      'CREATE TRIGGER ignore_required_write BEFORE DELETE ON collection_users BEGIN SELECT RAISE(IGNORE); END;',
      'remove',
    ],
    [
      'direct-grant-insert',
      'CREATE TRIGGER ignore_required_write BEFORE INSERT ON collection_users BEGIN SELECT RAISE(IGNORE); END;',
      'update',
    ],
  ] as const)(
    'rolls back audit/state/revisions if %s is ignored',
    async (_condition, trigger, operation) => {
      const db = await database()
      await db.prepare(trigger).run()
      const before = await snapshot(db)
      await expect(lifecycle(db, operation)).rejects.toThrow()
      expect(await snapshot(db)).toEqual(before)
    },
  )

  it.each(['revoke', 'remove'] as const)(
    'clears direct and group grants atomically and advances polling on %s',
    async (operation) => {
      const db = await database()
      await confirmOrganizationMember(db, {
        ...mutation(),
        keyEncrypted: '2.synthetic-member-key',
      })
      const before = await getAccountRevisionDate(db, 'recipient')
      expect(await lifecycle(db, operation)).toEqual({ status: 'success' })
      const after = await getAccountRevisionDate(db, 'recipient')
      expect(after! > before!).toBe(true)
      expect(after! > '2027-01-01T00:00:00.000Z').toBe(true)
      expect(await count(db, 'organization_group_users')).toBe(0)
      expect(await count(db, 'collection_users')).toBe(0)
      expect(
        await updateOrganizationCipher(db, {
          id: 'shared',
          userId: 'recipient',
          type: 1,
          favorite: false,
          encryptedJson: '{}',
          revisionDate: '2027-01-01T00:00:01.000Z',
          expectedRevisionDate: '2027-01-01T00:00:00.000Z',
        }),
      ).toEqual({ status: 'not_found' })
    },
  )

  it('projects actual same-org group IDs only when includeGroups is requested', async () => {
    const db = await database()
    const input = {
      actor: {
        userId: 'owner',
        emailNormalized: 'owner@example.test',
        ...proof,
      },
      organizationId: 'org',
      membershipId: 'member',
      requestId: 'projection-test',
      now,
    }
    const listed = await listMembersService(db, {
      ...input,
      includeCollections: false,
      includeGroups: true,
    })
    expect(listed).toMatchObject({
      status: 'success',
      body: {
        data: expect.arrayContaining([
          expect.objectContaining({ Id: 'member', Groups: ['group'] }),
        ]),
      },
    })
    const read = await readMemberService(db, { ...input, includeGroups: true })
    expect(read).toMatchObject({
      status: 'success',
      body: { Groups: ['group'] },
    })
    expect(JSON.stringify(read)).not.toContain('synthetic-verifier')
    expect(read).not.toHaveProperty('body.Key')
    expect(await readMemberService(db, input)).toMatchObject({
      status: 'success',
      body: { Groups: [] },
    })
  })

  it('rechecks current account activity and family proof after a successful manager read', async () => {
    const db = await database()
    await requirePolicy(db)
    await enroll(db, 'owner', true)
    expect((await findOrganizationMemberForActor(db, mutation())).status).toBe(
      'success',
    )
    await db
      .prepare(
        "UPDATE user_totp SET credential_generation='replacement-generation' WHERE user_id='owner'",
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
    expect(await snapshot(db)).toEqual(before)
  })

  it.each(['revoked-family', 'superseded-family', 'disabled-account'])(
    'rechecks %s after a successful manager read with policy disabled',
    async (condition) => {
      const db = await database()
      expect(
        (await findOrganizationMemberForActor(db, mutation())).status,
      ).toBe('success')
      if (condition === 'revoked-family')
        await db
          .prepare("UPDATE devices SET revoked_at=? WHERE user_id='owner'")
          .bind(now)
          .run()
      if (condition === 'superseded-family')
        await db
          .prepare(
            "UPDATE devices SET session_id='replacement-family' WHERE user_id='owner'",
          )
          .run()
      if (condition === 'disabled-account')
        await db
          .prepare("UPDATE users SET disabled_at=? WHERE id='owner'")
          .bind(now)
          .run()
      const before = await snapshot(db)
      expect(await listOrganizationMembers(db, scope)).toEqual({
        status: 'not_found',
      })
      expect(
        await updateOrganizationMember(db, {
          ...mutation(),
          type: 2,
          collections: [],
        }),
      ).toEqual({ status: 'not_found' })
      expect(await snapshot(db)).toEqual(before)
    },
  )

  it.each(['revoked', 'superseded'])(
    'rejects a %s family changed after HTTP authentication with policy disabled',
    async (condition) => {
      const db = await database()
      const app = new Hono()
      registerOrganizationMembershipRoutes(app, {
        authenticate: async () => {
          if (condition === 'revoked')
            await db
              .prepare("UPDATE devices SET revoked_at=? WHERE user_id='owner'")
              .bind(now)
              .run()
          else
            await db
              .prepare(
                "UPDATE devices SET session_id='replacement-family' WHERE user_id='owner'",
              )
              .run()
          return {
            ok: true,
            actor: {
              userId: 'owner',
              emailNormalized: 'owner@example.test',
              ...proof,
            },
          }
        },
        runtime: () => ({
          enabled: true,
          database: db,
          inviteSecret: 'synthetic-organization-secret',
        }),
        requestId: () => 'synthetic-membership-request',
        reportFailure: () => undefined,
      })
      const before = await snapshot(db)
      const path = '/api/organizations/org/users'
      expect(
        (
          await app.request(`${path}/member`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 2, collections: [] }),
          })
        ).status,
      ).toBe(404)
      expect((await app.request(`${path}?includeGroups=true`)).status).toBe(404)
      expect(await snapshot(db)).toEqual(before)
    },
  )
})

function invitation(
  context: {
    actorUserId: string
    sessionId?: string
    deviceIdentifier?: string
  } = scope,
) {
  return {
    organizationId: 'org',
    ...context,
    now,
    type: 2 as const,
    collections: [grant],
    invites: [
      {
        id: 'new-invited',
        emailNormalized: 'new-recipient@example.test',
        inviteTokenHash: 'synthetic-new-verifier',
        inviteExpiresAt: expires,
      },
    ],
    auditEvents: [event('organization.member.invite', 'new-invited')],
  }
}
function lifecycle(
  db: D1Database,
  operation:
    | 'invite'
    | 'accept'
    | 'confirm'
    | 'update'
    | 'reinvite'
    | 'revoke'
    | 'remove',
) {
  if (operation === 'invite')
    return insertOrganizationMemberInvites(db, invitation())
  if (operation === 'accept')
    return acceptOrganizationMemberInvite(db, acceptance())
  if (operation === 'confirm')
    return confirmOrganizationMember(db, {
      ...mutation(),
      keyEncrypted: '2.synthetic-member-key',
    })
  if (operation === 'update')
    return updateOrganizationMember(db, {
      ...mutation(),
      type: 2,
      collections: [grant],
    })
  if (operation === 'reinvite')
    return reinviteOrganizationMember(db, {
      ...mutation('invited'),
      emailNormalized: 'outsider@example.test',
      inviteTokenHash: 'synthetic-replacement',
      inviteExpiresAt: expires,
    })
  return operation === 'revoke'
    ? revokeOrganizationMember(db, mutation())
    : removeOrganizationMember(db, mutation())
}
function ownerOperation(
  db: D1Database,
  operation: 'downgrade' | 'revoke' | 'remove',
  input: ReturnType<typeof mutation>,
) {
  if (operation === 'downgrade')
    return updateOrganizationMember(db, { ...input, type: 2, collections: [] })
  return operation === 'revoke'
    ? revokeOrganizationMember(db, input)
    : removeOrganizationMember(db, input)
}
async function requirePolicy(db: D1Database) {
  await db
    .prepare(
      "INSERT INTO organization_policies(id,organization_id,type,enabled,revision_date,created_at,updated_at) VALUES('policy','org',0,1,?,?,?)",
    )
    .bind(now, now, now)
    .run()
}
async function enroll(
  db: D1Database,
  userId: string,
  verifiedSession: boolean,
) {
  await db
    .prepare(
      'INSERT INTO user_totp(user_id,encrypted_secret,enabled,verified_at,credential_generation) VALUES(?, ?, 1, ?, ?)',
    )
    .bind(userId, 'synthetic-encrypted-factor', now, `${userId}-generation`)
    .run()
  if (verifiedSession)
    await db
      .prepare(
        `INSERT INTO devices(id,user_id,identifier,session_id,mfa_totp_credential_generation,mfa_verified_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(user_id,identifier) DO UPDATE SET session_id=excluded.session_id,
          mfa_totp_credential_generation=excluded.mfa_totp_credential_generation,mfa_verified_at=excluded.mfa_verified_at`,
      )
      .bind(
        `${userId}-device-id`,
        userId,
        `${userId}-device`,
        `${userId}-family`,
        `${userId}-generation`,
        now,
      )
      .run()
}
async function count(db: D1Database, table: string) {
  return (await db
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .first<{ count: number }>())!.count
}
async function snapshot(db: D1Database) {
  const result = []
  for (const table of [
    'users',
    'organization_users',
    'organizations',
    'collection_users',
    'organization_group_users',
    'organization_groups',
    'collection_groups',
    'audit_events',
  ])
    result.push(
      (await db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all()).results,
    )
  return result
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
  for (const userId of ['owner', 'owner2', 'recipient', 'admin', 'outsider'])
    await db
      .prepare(
        `INSERT INTO users(id,email,email_normalized,display_name,kdf_algorithm,kdf_iterations,master_password_hash,security_stamp,revision_date,public_key)
    VALUES(?,?,?,?,'pbkdf2-sha256',600000,'synthetic-hash','synthetic-stamp',?,'synthetic-public')`,
      )
      .bind(
        userId,
        `${userId}@example.test`,
        `${userId}@example.test`,
        userId,
        now,
      )
      .run()
  await db
    .prepare(
      "INSERT INTO devices(id,user_id,identifier,session_id) VALUES('owner-device-id','owner','owner-device','owner-family')",
    )
    .run()
  for (const organizationId of ['org', 'foreign'])
    await db
      .prepare('INSERT INTO organizations(id,name,revision_date) VALUES(?,?,?)')
      .bind(organizationId, 'Synthetic company', now)
      .run()
  for (const [id, userId, status, type] of [
    ['owner-member', 'owner', 2, 0],
    ['owner2-member', 'owner2', 2, 0],
    ['member', 'recipient', 1, 2],
    ['admin-member', 'admin', 2, 1],
  ] as const)
    await db
      .prepare(
        "INSERT INTO organization_users(id,organization_id,user_id,email,status,type) VALUES(?,'org',?,?,?,?)",
      )
      .bind(id, userId, `${userId}@example.test`, status, type)
      .run()
  await db
    .prepare(
      "INSERT INTO organization_users(id,organization_id,email,status,type,invite_token_hash,invite_expires_at) VALUES('invited','org','outsider@example.test',0,2,'synthetic-verifier',?)",
    )
    .bind(expires)
    .run()
  await db
    .prepare(
      "INSERT INTO collections(id,organization_id,encrypted_name,revision_date) VALUES('collection','org','2.synthetic-name',?)",
    )
    .bind(now)
    .run()
  await db
    .prepare(
      "INSERT INTO collection_users(collection_id,organization_user_id,read_only) VALUES('collection','member',1)",
    )
    .run()
  await db
    .prepare(
      "INSERT INTO organization_groups(id,organization_id,name,revision_date,last_mutation_id) VALUES('group','org','Synthetic group',?,?)",
    )
    .bind(now, crypto.randomUUID())
    .run()
  await db
    .prepare(
      "INSERT INTO organization_group_users(group_id,organization_id,organization_user_id) VALUES('group','org','member')",
    )
    .run()
  await db
    .prepare(
      "INSERT INTO collection_groups(group_id,organization_id,collection_id) VALUES('group','org','collection')",
    )
    .run()
  await db
    .prepare(
      "INSERT INTO ciphers(id,user_id,type,encrypted_json,revision_date,organization_id) VALUES('shared','owner',1,'{}','2027-01-01T00:00:00.000Z','org')",
    )
    .run()
  await db
    .prepare(
      "INSERT INTO collection_ciphers(collection_id,cipher_id) VALUES('collection','shared')",
    )
    .run()
  return db
}

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it } from 'vitest'
import { registerOrganizationAuditRoutes } from '../../src/organization-audit-routes'
import {
  acceptOrganizationMember,
  confirmOrganizationMember,
  inviteOrganizationMembers,
  reinviteOrganizationMember,
  removeOrganizationMember,
  revokeOrganizationMember,
  updateOrganizationMember,
  type OrganizationMembershipDelivery,
} from '../../src/organization-membership'
import {
  organizationAuditScopeExpression,
  readOrganizationAuditPage,
} from '../../src/repositories/organization-audit-repository'
import { createOrganizationFoundation } from '../../src/repositories/organization-repository'

const instances: Miniflare[] = []
const from = '2026-10-03T00:00:00.000Z'
const occurredAt = '2026-10-03T00:00:01.000Z'
const to = '2026-10-04T00:00:00.000Z'
const actor = {
  userId: 'owner',
  sessionId: 'owner-session',
  deviceIdentifier: 'owner-device',
}
const owner = { ...actor, emailNormalized: 'owner@example.test' }
const recipientActor = {
  userId: 'recipient',
  emailNormalized: 'recipient@example.test',
  sessionId: 'recipient-session',
  deviceIdentifier: 'recipient-device',
}
const inviteSecret = 'synthetic-invitation-secret-32-bytes-long'
const cursorSecret = 'synthetic-audit-cursor-secret-at-least-32-bytes'
const csvHeader =
  '"id","occurredAt","name","outcome","actorUserId","targetType","targetId"\r\n'
type ReadInput = Parameters<typeof readOrganizationAuditPage>[1]
type AuditListBody = {
  object: 'list'
  data: { id: string }[]
  continuationToken: string | null
  query: {
    from: string
    to: string
    eventName: string | null
    actorUserId: string | null
    limit: number
  }
}
type AuditRowInput = {
  id: string
  schemaVersion?: number
  name?: string
  outcome?: 'success' | 'failure'
  occurredAt?: string
  actorUserId?: string | null
  targetType?: string | null
  targetId?: string | null
  contextJson?: string | null
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()))
})

describe('organization audit reads on real D1 with every tracked migration', () => {
  it('attributes events to their recorded organization with a shared actor and surviving historical targets', async () => {
    const db = await database()
    await db.batch([
      db.prepare(
        "INSERT INTO organization_users (id, organization_id, user_id, email, status, type) VALUES ('deleted-member', 'org-a', 'recipient', 'recipient@example.test', 2, 2)",
      ),
      db.prepare(
        "INSERT INTO organization_users (id, organization_id, user_id, email, status, type) VALUES ('foreign-member', 'org-b', 'outsider', 'outsider@example.test', 2, 2)",
      ),
    ])
    await insertEvents(db, [
      { id: 'a-existing', targetId: 'owner-a' },
      { id: 'a-deleted', targetId: 'deleted-member' },
      { id: 'a-historical', targetId: 'foreign-member' },
      {
        id: 'b-existing',
        targetId: 'owner-b',
        contextJson: JSON.stringify({ organizationId: 'org-b' }),
      },
      {
        id: 'b-historical',
        targetId: 'owner-a',
        contextJson: JSON.stringify({ organizationId: 'org-b' }),
      },
    ])
    await db
      .prepare("DELETE FROM organization_users WHERE id = 'deleted-member'")
      .run()

    const a = await successPage(db)
    const b = await successPage(db, { organizationId: 'org-b' })
    expect(a.records.map((record) => record.id)).toEqual([
      'a-historical',
      'a-existing',
      'a-deleted',
    ])
    expect(b.records.map((record) => record.id)).toEqual([
      'b-historical',
      'b-existing',
    ])
    expect(a.hasMore).toBe(false)
    expect(b.hasMore).toBe(false)
    expect(a.records.find((record) => record.id === 'a-deleted')).toEqual({
      object: 'organizationAuditEvent',
      id: 'a-deleted',
      schemaVersion: 1,
      name: 'organization.member.update',
      outcome: 'success',
      occurredAt,
      actorUserId: 'owner',
      targetType: 'organization_user',
      targetId: 'deleted-member',
    })
  })

  it('excludes unscoped, foreign, personal, unsupported and malformed events without JSON errors or private fields', async () => {
    const db = await database()
    await insertEvents(db, [
      {
        id: 'valid',
        contextJson: JSON.stringify({
          organizationId: 'org-a',
          privateMetadata: 'synthetic-private-context',
        }),
      },
      { id: 'valid-null-actor-target', actorUserId: null, targetId: null },
      { id: 'unscoped-null', contextJson: null },
      { id: 'unscoped-object', contextJson: '{}' },
      {
        id: 'foreign',
        contextJson: JSON.stringify({ organizationId: 'org-b' }),
      },
      { id: 'personal', name: 'cipher.update' },
      { id: 'unknown-name', name: 'organization.member.future' },
      { id: 'wrong-pair-group-name', name: 'organization.group.create' },
      { id: 'wrong-pair-policy-name', name: 'organization.policy.update' },
      { id: 'wrong-target', targetType: 'cipher' },
      { id: 'missing-target-type', targetType: null },
      { id: 'unknown-schema', schemaVersion: 2 },
      { id: 'failure', outcome: 'failure' },
      { id: 'malformed-json', contextJson: '{' },
      { id: 'array-context', contextJson: '[{"organizationId":"org-a"}]' },
      { id: 'string-context', contextJson: '"org-a"' },
      { id: 'null-context', contextJson: 'null' },
      { id: 'boolean-context', contextJson: 'true' },
      { id: 'number-context', contextJson: '1' },
      { id: 'number-scope', contextJson: '{"organizationId":1}' },
      { id: 'boolean-scope', contextJson: '{"organizationId":true}' },
      { id: 'null-scope', contextJson: '{"organizationId":null}' },
      { id: 'object-scope', contextJson: '{"organizationId":{"id":"org-a"}}' },
      { id: 'array-scope', contextJson: '{"organizationId":["org-a"]}' },
    ])

    const page = await successPage(db)
    expect(page.records.map((record) => record.id)).toEqual([
      'valid-null-actor-target',
      'valid',
    ])
    expect(page.records[0]).toEqual({
      object: 'organizationAuditEvent',
      id: 'valid-null-actor-target',
      schemaVersion: 1,
      name: 'organization.member.update',
      outcome: 'success',
      occurredAt,
      actorUserId: null,
      targetType: 'organization_user',
      targetId: null,
    })
    expect(Object.keys(page.records[1]!).sort()).toEqual([
      'actorUserId',
      'id',
      'name',
      'object',
      'occurredAt',
      'outcome',
      'schemaVersion',
      'targetId',
      'targetType',
    ])
    expect(JSON.stringify(page)).not.toContain('synthetic-private-context')
    expect(JSON.stringify(page)).not.toContain('synthetic-request')
    expect(JSON.stringify(page)).not.toContain('synthetic-actor-device')
    expect(page.hasMore).toBe(false)
  })

  it('includes supported group and policy history after targets disappear and enforces event-name target pairs', async () => {
    const db = await database()
    await db.batch([
      db
        .prepare(
          "INSERT INTO organization_groups (id, organization_id, name, revision_date, last_mutation_id) VALUES ('deleted-group', 'org-a', 'synthetic-deleted-group-name', ?, 'synthetic-mutation')",
        )
        .bind(from),
      db
        .prepare(
          "INSERT INTO organization_policies (id, organization_id, type, enabled, revision_date, created_at, updated_at) VALUES ('deleted-policy', 'org-a', 0, 0, ?, ?, ?)",
        )
        .bind(from, from, from),
    ])
    await insertEvents(db, [
      {
        id: 'supported-group-create',
        name: 'organization.group.create',
        targetType: 'organization_group',
        targetId: 'deleted-group',
      },
      {
        id: 'supported-group-update',
        name: 'organization.group.update',
        targetType: 'organization_group',
        targetId: 'deleted-group',
      },
      {
        id: 'supported-group-delete',
        name: 'organization.group.delete',
        targetType: 'organization_group',
        targetId: 'deleted-group',
      },
      {
        id: 'supported-group-member-remove',
        name: 'organization.group.member.remove',
        targetType: 'organization_group',
        targetId: 'deleted-group',
      },
      {
        id: 'supported-policy',
        name: 'organization.policy.update',
        targetType: 'organization',
        targetId: 'org-a',
      },
      {
        id: 'foreign-group',
        name: 'organization.group.delete',
        targetType: 'organization_group',
        targetId: 'deleted-group',
        contextJson: '{"organizationId":"org-b"}',
      },
      {
        id: 'foreign-policy',
        name: 'organization.policy.update',
        targetType: 'organization',
        targetId: 'org-a',
        contextJson: '{"organizationId":"org-b"}',
      },
      {
        id: 'wrong-group-member-pair',
        name: 'organization.group.create',
        targetType: 'organization_user',
        targetId: 'owner-a',
      },
      {
        id: 'wrong-policy-group-pair',
        name: 'organization.policy.update',
        targetType: 'organization_group',
        targetId: 'deleted-group',
      },
      {
        id: 'wrong-member-organization-pair',
        name: 'organization.member.update',
        targetType: 'organization',
        targetId: 'org-a',
      },
    ])
    await db.batch([
      db.prepare("DELETE FROM organization_groups WHERE id = 'deleted-group'"),
      db.prepare(
        "DELETE FROM organization_policies WHERE id = 'deleted-policy'",
      ),
    ])
    const page = await successPage(db)
    expect(
      page.records.map((record) => ({
        name: record.name,
        targetType: record.targetType,
        targetId: record.targetId,
      })),
    ).toEqual([
      {
        name: 'organization.policy.update',
        targetType: 'organization',
        targetId: 'org-a',
      },
      {
        name: 'organization.group.update',
        targetType: 'organization_group',
        targetId: 'deleted-group',
      },
      {
        name: 'organization.group.member.remove',
        targetType: 'organization_group',
        targetId: 'deleted-group',
      },
      {
        name: 'organization.group.delete',
        targetType: 'organization_group',
        targetId: 'deleted-group',
      },
      {
        name: 'organization.group.create',
        targetType: 'organization_group',
        targetId: 'deleted-group',
      },
    ])
    expect(page.hasMore).toBe(false)
    expect(
      (await successPage(db, { organizationId: 'org-b' })).records.map(
        (record) => record.id,
      ),
    ).toEqual(['foreign-policy', 'foreign-group'])
    expect(
      (
        await successPage(db, { eventName: 'organization.policy.update' })
      ).records.map((record) => record.id),
    ).toEqual(['supported-policy'])
    const route = auditApp(db)
    const response = await route.app.request(auditPath({ operation: 'export' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('x-honowarden-audit-rows')).toBe('5')
    const csv = await response.text()
    expect(csv).toContain('"organization_group","deleted-group"')
    expect(csv).toContain('"organization","org-a"')
    for (const marker of [
      'synthetic-deleted-group-name',
      'foreign-group',
      'foreign-policy',
      'wrong-group-member-pair',
      'wrong-policy-group-pair',
      'wrong-member-organization-pair',
    ])
      expect(csv).not.toContain(marker)
    expect(route.failures).toEqual([])
  })

  it('accepts only text organization scope even for a numeric-looking organization ID', async () => {
    const db = await database()
    await createOrganizationFoundation(db, {
      organizationId: '1',
      organizationUserId: 'owner-numeric',
      collectionId: 'collection-numeric',
      userId: 'owner',
      email: 'owner@example.test',
      name: 'Synthetic numeric company',
      billingEmail: null,
      planType: 0,
      orgKey: '2.synthetic-owner-wrapper',
      publicKey: 'synthetic-org-public',
      privateKey: '2.synthetic-org-private',
      encryptedCollectionName: '2.synthetic-collection',
      now: from,
    })
    await insertEvents(db, [
      { id: 'text-scope', contextJson: '{"organizationId":"1"}' },
      { id: 'numeric-scope', contextJson: '{"organizationId":1}' },
      { id: 'boolean-scope', contextJson: '{"organizationId":true}' },
    ])
    expect(
      (await successPage(db, { organizationId: '1' })).records.map(
        (record) => record.id,
      ),
    ).toEqual(['text-scope'])
  })

  it.each(['query', 'export'] as const)(
    'refuses policy-off %s when the family is revoked after HTTP authentication',
    async (operation) => {
      const db = await database()
      await insertEvents(db, [{ id: 'scoped-history' }])
      const policy = await db
        .prepare(
          "SELECT 1 AS enabled FROM organization_policies WHERE organization_id = 'org-a' AND type = 0 AND enabled = 1",
        )
        .first()
      expect(policy).toBeNull()
      let preflightAccepted = false
      const failures: { code: string; operation: string }[] = []
      const app = new Hono()
      registerOrganizationAuditRoutes(app, {
        authenticate: async () => {
          const live = await db
            .prepare(
              'SELECT 1 AS active FROM devices WHERE user_id = ? AND identifier = ? AND session_id = ? AND revoked_at IS NULL',
            )
            .bind(actor.userId, actor.deviceIdentifier, actor.sessionId)
            .first()
          expect(live).toEqual({ active: 1 })
          preflightAccepted = true
          await db
            .prepare(
              "UPDATE devices SET revoked_at = ? WHERE id = 'verified-device'",
            )
            .bind(occurredAt)
            .run()
          return { ok: true as const, actor }
        },
        runtime: () => ({
          enabled: true,
          database: db,
          cursorSecret,
          optionalAuditLoggingEnabled: false,
        }),
        now: () => to,
        requestId: () => 'synthetic-revocation-race',
        reportFailure: (_context, failure) => {
          failures.push(failure)
        },
      })
      const response = await app.request(auditPath({ operation }))
      expect(preflightAccepted).toBe(true)
      expect(response.status).toBe(404)
      expect(response.headers.get('content-disposition')).toBeNull()
      expect(await response.json()).toEqual({
        error: {
          code: 'organization_not_found',
          message: 'Organization was not found.',
        },
        requestId: 'synthetic-revocation-race',
      })
      expect(failures).toEqual([])
    },
  )

  it('distinguishes an authorized empty result from a missing organization or a nonmanager', async () => {
    const db = await database()
    expect(await successPage(db)).toEqual({
      status: 'success',
      records: [],
      hasMore: false,
    })
    expect(
      await readOrganizationAuditPage(
        db,
        readInput({ organizationId: 'missing' }),
      ),
    ).toEqual({ status: 'not_found' })
    expect(
      await readOrganizationAuditPage(
        db,
        readInput({ actor: { ...actor, userId: 'outsider' } }),
      ),
    ).toEqual({ status: 'not_found' })
    await db
      .prepare(
        "INSERT INTO organization_users (id, organization_id, user_id, email, status, type) VALUES ('admin-a', 'org-a', 'admin', 'admin@example.test', 2, 1)",
      )
      .run()
    expect(
      await successPage(db, { actor: { ...actor, userId: 'admin' } }),
    ).toEqual({ status: 'success', records: [], hasMore: false })
    await db
      .prepare("UPDATE organization_users SET type = 2 WHERE id = 'admin-a'")
      .run()
    expect(
      await readOrganizationAuditPage(
        db,
        readInput({ actor: { ...actor, userId: 'admin' } }),
      ),
    ).toEqual({ status: 'not_found' })
  })

  it.each([
    'demoted',
    'invited',
    'accepted',
    'revoked',
    'membership-removed',
    'account-disabled',
    'organization-disabled',
    'required-totp-enabled',
  ])(
    'rechecks current authorization between pages when %s',
    async (condition) => {
      const db = await database()
      await insertEvents(db, [{ id: 'event-b' }, { id: 'event-a' }])
      const first = await successPage(db, { limit: 1 })
      expect(first.hasMore).toBe(true)
      const cursor = first.records[0]!

      if (condition === 'demoted')
        await db
          .prepare(
            "UPDATE organization_users SET type = 2 WHERE id = 'owner-a'",
          )
          .run()
      if (['invited', 'accepted', 'revoked'].includes(condition))
        await db
          .prepare(
            "UPDATE organization_users SET status = ? WHERE id = 'owner-a'",
          )
          .bind(condition === 'invited' ? 0 : condition === 'accepted' ? 1 : -1)
          .run()
      if (condition === 'membership-removed')
        await db
          .prepare("DELETE FROM organization_users WHERE id = 'owner-a'")
          .run()
      if (condition === 'account-disabled')
        await db
          .prepare("UPDATE users SET disabled_at = ? WHERE id = 'owner'")
          .bind(occurredAt)
          .run()
      if (condition === 'organization-disabled')
        await db
          .prepare("UPDATE organizations SET enabled = 0 WHERE id = 'org-a'")
          .run()
      if (condition === 'required-totp-enabled')
        await db
          .prepare(
            "INSERT INTO organization_policies (id, organization_id, type, enabled, revision_date, created_at, updated_at) VALUES ('policy-a', 'org-a', 0, 1, ?, ?, ?)",
          )
          .bind(occurredAt, occurredAt, occurredAt)
          .run()

      expect(
        await readOrganizationAuditPage(
          db,
          readInput({
            limit: 1,
            cursor: { occurredAt: cursor.occurredAt, id: cursor.id },
          }),
        ),
      ).toEqual({ status: 'not_found' })
    },
  )

  it('requires current session and device assurance when required TOTP is enabled', async () => {
    const db = await database()
    await insertEvents(db, [{ id: 'event-b' }, { id: 'event-a' }])
    await requireTotp(db)
    expect(await readOrganizationAuditPage(db, readInput())).toEqual({
      status: 'not_found',
    })
    await db
      .prepare(
        "INSERT INTO user_totp (user_id, encrypted_secret, enabled, verified_at, credential_generation) VALUES ('owner', 'synthetic-totp-envelope', 1, ?, 'synthetic-generation')",
      )
      .bind(occurredAt)
      .run()
    expect(await readOrganizationAuditPage(db, readInput())).toEqual({
      status: 'not_found',
    })
    await verifiedDevice(db)
    const first = await successPage(db, { limit: 1 })
    const position = first.records[0]!
    const next = {
      limit: 1,
      cursor: { occurredAt: position.occurredAt, id: position.id },
    }
    expect(
      (await successPage(db, next)).records.map((record) => record.id),
    ).toEqual(['event-a'])
    expect(
      await readOrganizationAuditPage(
        db,
        readInput({ ...next, actor: { ...actor, sessionId: 'other-session' } }),
      ),
    ).toEqual({ status: 'not_found' })
    expect(
      await readOrganizationAuditPage(
        db,
        readInput({
          ...next,
          actor: { ...actor, deviceIdentifier: 'other-device' },
        }),
      ),
    ).toEqual({ status: 'not_found' })
  })

  it.each([
    'device-revoked',
    'session-replaced',
    'stale-proof-generation',
    'totp-generation-changed',
    'totp-disabled',
  ])(
    'rejects continuation when previously valid policy assurance becomes %s',
    async (condition) => {
      const db = await database()
      await insertEvents(db, [{ id: 'event-b' }, { id: 'event-a' }])
      await requireTotp(db)
      await db
        .prepare(
          "INSERT INTO user_totp (user_id, encrypted_secret, enabled, verified_at, credential_generation) VALUES ('owner', 'synthetic-totp-envelope', 1, ?, 'synthetic-generation')",
        )
        .bind(occurredAt)
        .run()
      await verifiedDevice(db)
      const first = await successPage(db, { limit: 1 })
      expect(first.hasMore).toBe(true)
      const position = first.records[0]!
      if (condition === 'device-revoked')
        await db
          .prepare(
            "UPDATE devices SET revoked_at = ? WHERE id = 'verified-device'",
          )
          .bind(occurredAt)
          .run()
      if (condition === 'session-replaced')
        await db
          .prepare(
            "UPDATE devices SET session_id = 'replacement-session' WHERE id = 'verified-device'",
          )
          .run()
      if (condition === 'stale-proof-generation')
        await db
          .prepare(
            "UPDATE devices SET mfa_totp_credential_generation = 'stale-generation' WHERE id = 'verified-device'",
          )
          .run()
      if (condition === 'totp-generation-changed')
        await db
          .prepare(
            "UPDATE user_totp SET credential_generation = 'replacement-generation' WHERE user_id = 'owner'",
          )
          .run()
      if (condition === 'totp-disabled')
        await db
          .prepare("UPDATE user_totp SET enabled = 0 WHERE user_id = 'owner'")
          .run()
      expect(
        await readOrganizationAuditPage(
          db,
          readInput({
            limit: 1,
            cursor: { occurredAt: position.occurredAt, id: position.id },
          }),
        ),
      ).toEqual({ status: 'not_found' })
    },
  )

  it('uses stable descending timestamp and ID boundaries with an inclusive start and exclusive end', async () => {
    const db = await database()
    await insertEvents(db, [
      { id: 'before-start', occurredAt: '2026-10-02T23:59:59.999Z' },
      { id: 'at-start', occurredAt: from },
      { id: 'tie-a' },
      { id: 'tie-b' },
      { id: 'tie-c' },
      { id: 'at-end', occurredAt: to },
      { id: 'after-end', occurredAt: '2026-10-04T00:00:00.001Z' },
    ])
    const first = await successPage(db, { limit: 2 })
    expect(first.records.map((record) => record.id)).toEqual(['tie-c', 'tie-b'])
    expect(first.hasMore).toBe(true)
    const boundary = first.records.at(-1)!
    await insertEvents(db, [
      { id: 'newer-insertion', occurredAt: '2026-10-03T00:00:02.000Z' },
      { id: 'tie-z' },
    ])
    const second = await successPage(db, {
      limit: 2,
      cursor: { occurredAt: boundary.occurredAt, id: boundary.id },
    })
    expect(second.records.map((record) => record.id)).toEqual([
      'tie-a',
      'at-start',
    ])
    expect(second.hasMore).toBe(false)
    expect(
      new Set([...first.records, ...second.records].map((record) => record.id))
        .size,
    ).toBe(4)
    const terminal = second.records.at(-1)!
    expect(
      await successPage(db, {
        cursor: { occurredAt: terminal.occurredAt, id: terminal.id },
      }),
    ).toEqual({ status: 'success', records: [], hasMore: false })
  })

  it('applies event and actor filters together before determining whether another page exists', async () => {
    const db = await database()
    await insertEvents(db, [
      { id: 'owner-update' },
      { id: 'owner-remove', name: 'organization.member.remove' },
      { id: 'recipient-update', actorUserId: 'recipient' },
      {
        id: 'recipient-remove',
        actorUserId: 'recipient',
        name: 'organization.member.remove',
      },
      { id: 'missing-actor', actorUserId: null },
    ])
    expect(
      (
        await successPage(db, { eventName: 'organization.member.remove' })
      ).records.map((record) => record.id),
    ).toEqual(['recipient-remove', 'owner-remove'])
    expect(
      (await successPage(db, { filterActorUserId: 'recipient' })).records.map(
        (record) => record.id,
      ),
    ).toEqual(['recipient-update', 'recipient-remove'])
    const filtered = await successPage(db, {
      eventName: 'organization.member.remove',
      filterActorUserId: 'recipient',
      limit: 1,
    })
    expect(filtered.records.map((record) => record.id)).toEqual([
      'recipient-remove',
    ])
    expect(filtered.hasMore).toBe(false)
    expect(await successPage(db, { filterActorUserId: 'unknown' })).toEqual({
      status: 'success',
      records: [],
      hasMore: false,
    })
  })

  it.each([100, 1000])(
    'probes one extra row for the %s record page or export limit',
    async (limit) => {
      const db = await database()
      const events = Array.from({ length: limit + 1 }, (_, index) => ({
        id: `event-${String(index).padStart(4, '0')}`,
      }))
      await insertEvents(db, events)
      const page = await successPage(db, { limit })
      expect(page.records).toHaveLength(limit)
      expect(page.hasMore).toBe(true)
      const boundary = page.records.at(-1)!
      const final = await successPage(db, {
        limit,
        cursor: { occurredAt: boundary.occurredAt, id: boundary.id },
      })
      expect(final.records.map((record) => record.id)).toEqual(['event-0000'])
      expect(final.hasMore).toBe(false)
      const route = auditApp(db)
      if (limit === 1000) {
        const overflow = await route.app.request(
          auditPath({ operation: 'export' }),
        )
        expect(overflow.status).toBe(413)
        expect(overflow.headers.get('content-type')).toContain(
          'application/json',
        )
        expect(overflow.headers.get('content-disposition')).toBeNull()
        expect(overflow.headers.get('x-honowarden-audit-rows')).toBeNull()
        const overflowBody = await overflow.text()
        expect(JSON.parse(overflowBody)).toMatchObject({
          error: { code: 'audit_export_too_large' },
        })
        expect(overflowBody).not.toContain(csvHeader)
        expect(overflowBody).not.toContain('event-0000')
      }
      await db.prepare("DELETE FROM audit_events WHERE id = 'event-0000'").run()
      const exact = await successPage(db, { limit })
      expect(exact.records).toHaveLength(limit)
      expect(exact.hasMore).toBe(false)
      if (limit === 1000) {
        const exportResponse = await route.app.request(
          auditPath({ operation: 'export' }),
        )
        expect(exportResponse.status).toBe(200)
        expect(exportResponse.headers.get('content-type')).toBe(
          'text/csv; charset=utf-8',
        )
        expect(exportResponse.headers.get('content-disposition')).toBe(
          'attachment; filename="honowarden-organization-audit.csv"',
        )
        expect(exportResponse.headers.get('x-honowarden-audit-rows')).toBe(
          '1000',
        )
        const csv = await exportResponse.text()
        expect(csv.startsWith(csvHeader)).toBe(true)
        expect(csv.split('\r\n').filter(Boolean)).toHaveLength(1001)
        expect(csv).toContain('"event-0001"')
        expect(csv).not.toContain('"event-0000"')
        expect(route.failures).toEqual([])
      }
    },
  )

  it('exports only supported event-time organization history through the actual route without raw metadata', async () => {
    const db = await database()
    await db.batch([
      db.prepare(
        "INSERT INTO organization_users (id, organization_id, user_id, email, status, type) VALUES ('deleted-member', 'org-a', 'recipient', 'recipient@example.test', 2, 2)",
      ),
      db.prepare(
        "INSERT INTO organization_users (id, organization_id, user_id, email, status, type) VALUES ('foreign-member', 'org-b', 'outsider', 'outsider@example.test', 2, 2)",
      ),
      db.prepare(
        "UPDATE users SET display_name = 'synthetic-account-name-marker' WHERE id = 'owner'",
      ),
    ])
    await insertEvents(db, [
      {
        id: 'a-supported',
        targetId: 'owner-a',
        contextJson: JSON.stringify({
          organizationId: 'org-a',
          rawContext: 'synthetic-raw-context-marker',
          displayName: 'synthetic-context-name-marker',
          email: 'synthetic-email-marker@example.test',
        }),
      },
      { id: 'a-history', targetId: 'foreign-member' },
      {
        id: 'a-deleted',
        name: 'organization.member.remove',
        targetId: 'deleted-member',
      },
      {
        id: 'b-scoped',
        targetId: 'owner-a',
        contextJson: JSON.stringify({ organizationId: 'org-b' }),
      },
      { id: 'unscoped', contextJson: null },
      { id: 'personal', name: 'cipher.update' },
      { id: 'unsupported', name: 'organization.member.future' },
      { id: 'malformed', contextJson: '{' },
    ])
    await db
      .prepare("DELETE FROM organization_users WHERE id = 'deleted-member'")
      .run()
    const route = auditApp(db)
    const response = await route.app.request(auditPath({ operation: 'export' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="honowarden-organization-audit.csv"',
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-honowarden-audit-from')).toBe(from)
    expect(response.headers.get('x-honowarden-audit-to')).toBe(to)
    expect(response.headers.get('x-honowarden-audit-rows')).toBe('3')
    expect(response.headers.get('x-honowarden-audit-coverage')).toBe(
      'committed-organization-administration;partial',
    )
    const csv = await response.text()
    expect(csv).toBe(
      csvHeader +
        `"a-supported","${occurredAt}","organization.member.update","success","owner","organization_user","owner-a"\r\n` +
        `"a-history","${occurredAt}","organization.member.update","success","owner","organization_user","foreign-member"\r\n` +
        `"a-deleted","${occurredAt}","organization.member.remove","success","owner","organization_user","deleted-member"\r\n`,
    )
    for (const marker of [
      'synthetic-raw-context-marker',
      'synthetic-account-name-marker',
      'synthetic-context-name-marker',
      'synthetic-email-marker@example.test',
      'synthetic-request',
      'synthetic-actor-device',
      'owner@example.test',
      'recipient@example.test',
      'b-scoped',
      'unscoped',
      'personal',
      'unsupported',
      'malformed',
    ])
      expect(csv).not.toContain(marker)
    const otherOrganization = await route.app.request(
      auditPath({ organizationId: 'org-b', operation: 'export' }),
    )
    expect(otherOrganization.status).toBe(200)
    expect(await otherOrganization.text()).toBe(
      csvHeader +
        `"b-scoped","${occurredAt}","organization.member.update","success","owner","organization_user","owner-a"\r\n`,
    )
    expect(route.failures).toEqual([])
  })

  it('restores signed cursor bounds and filters through actual routes and rechecks authority after revocation', async () => {
    const db = await database()
    await insertEvents(db, [
      { id: 'event-c', name: 'organization.member.remove' },
      { id: 'event-b', name: 'organization.member.remove' },
      { id: 'event-a', name: 'organization.member.remove' },
      {
        id: 'before-window',
        name: 'organization.member.remove',
        occurredAt: '2026-10-02T23:59:59.999Z',
      },
      {
        id: 'at-window-end',
        name: 'organization.member.remove',
        occurredAt: to,
      },
      { id: 'filtered-name', name: 'organization.member.update' },
      {
        id: 'filtered-actor',
        name: 'organization.member.remove',
        actorUserId: 'recipient',
      },
      {
        id: 'foreign',
        name: 'organization.member.remove',
        contextJson: JSON.stringify({ organizationId: 'org-b' }),
      },
    ])
    const route = auditApp(db)
    const first = await route.app.request(
      auditPath({
        query: {
          from,
          to,
          limit: '1',
          eventName: 'organization.member.remove',
          actorUserId: 'owner',
        },
      }),
    )
    expect(first.status).toBe(200)
    const firstBody = (await first.json()) as AuditListBody
    expect(firstBody.data.map((record) => record.id)).toEqual(['event-c'])
    expect(firstBody.continuationToken).toEqual(expect.any(String))
    const continuationToken = firstBody.continuationToken!
    expect(
      (
        await route.app.request(
          auditPath({ organizationId: 'org-b', query: { continuationToken } }),
        )
      ).status,
    ).toBe(400)
    expect(
      (
        await route.app.request(
          auditPath({ query: { continuationToken, limit: '2' } }),
        )
      ).status,
    ).toBe(400)

    route.setNow('2026-10-04T00:00:30.000Z')
    const second = await route.app.request(
      auditPath({ query: { continuationToken } }),
    )
    expect(second.status).toBe(200)
    expect(second.headers.get('cache-control')).toBe('no-store')
    const secondBody = (await second.json()) as AuditListBody
    expect(secondBody.data.map((record) => record.id)).toEqual(['event-b'])
    expect(secondBody.query).toEqual({
      from,
      to,
      eventName: 'organization.member.remove',
      actorUserId: 'owner',
      limit: 1,
    })
    expect(secondBody.continuationToken).toEqual(expect.any(String))
    const finalToken = secondBody.continuationToken!
    const terminal = await route.app.request(
      auditPath({ query: { continuationToken: finalToken } }),
    )
    expect(terminal.status).toBe(200)
    const terminalBody = (await terminal.json()) as AuditListBody
    expect(terminalBody.data.map((record) => record.id)).toEqual(['event-a'])
    expect(terminalBody.query).toEqual(secondBody.query)
    expect(terminalBody.continuationToken).toBeNull()

    await db
      .prepare("UPDATE organization_users SET status = -1 WHERE id = 'owner-a'")
      .run()
    const denied = await route.app.request(
      auditPath({ query: { continuationToken: finalToken } }),
    )
    expect(denied.status).toBe(404)
    expect(denied.headers.get('cache-control')).toBe('no-store')
    expect(await denied.json()).toEqual({
      error: {
        code: 'organization_not_found',
        message: 'Organization was not found.',
      },
      requestId: 'synthetic-route-request',
    })
    expect(route.failures).toEqual([])
  })

  it('searches the organization equality and event-time range through the scoped index without forcing an index scan', async () => {
    const db = await database()
    await insertEvents(db, [
      { id: 'scoped' },
      {
        id: 'foreign',
        contextJson: JSON.stringify({ organizationId: 'org-b' }),
      },
    ])
    const plan = await db
      .prepare(
        `EXPLAIN QUERY PLAN
      SELECT event.id FROM audit_events event
      WHERE ${organizationAuditScopeExpression} = ?
        AND event.occurred_at >= ? AND event.occurred_at < ?
      ORDER BY event.occurred_at DESC, event.id DESC LIMIT ?`,
      )
      .bind('org-a', from, to, 101)
      .all<{ detail: string }>()
    const details = plan.results.map((row) => row.detail)
    const indexedSearch = details.find((detail) =>
      /SEARCH event USING (?:COVERING )?INDEX idx_organization_audit_scope_occurred/.test(
        detail,
      ),
    )
    expect(indexedSearch).toBeDefined()
    expect(indexedSearch).toMatch(/<expr>=\?/)
    expect(indexedSearch).toMatch(/occurred_at>=?\?/)
    expect(indexedSearch).toMatch(/occurred_at<=?\?/)
    expect(
      details.some((detail) => detail.includes('USE TEMP B-TREE FOR ORDER BY')),
    ).toBe(false)

    let repositorySql = ''
    let repositoryBindings: (string | number | null)[] = []
    const capturedDatabase = {
      prepare(sql: string) {
        repositorySql = sql
        const statement = db.prepare(sql)
        return {
          bind(...bindings: (string | number | null)[]) {
            repositoryBindings = bindings
            return statement.bind(...bindings)
          },
        } as D1PreparedStatement
      },
    }
    expect(
      (await readOrganizationAuditPage(capturedDatabase, readInput())).status,
    ).toBe('success')
    const repositoryPlan = await db
      .prepare(`EXPLAIN QUERY PLAN ${repositorySql}`)
      .bind(...repositoryBindings)
      .all<{ detail: string }>()
    const repositorySearch = repositoryPlan.results.find((row) =>
      /SEARCH event USING (?:COVERING )?INDEX idx_organization_audit_scope_occurred/.test(
        row.detail,
      ),
    )
    expect(repositorySearch?.detail).toMatch(/<expr>=\?/)
    expect(repositorySearch?.detail).toMatch(/occurred_at>=?\?/)
    expect(repositorySearch?.detail).toMatch(/occurred_at<=?\?/)
  })

  it('fails loudly when the required scoped event-time index is absent', async () => {
    const db = await database()
    await db.prepare('DROP INDEX idx_organization_audit_scope_occurred').run()
    await expect(readOrganizationAuditPage(db, readInput())).rejects.toThrow(
      'idx_organization_audit_scope_occurred',
    )
  })

  it('rejects invalid repository row bounds', async () => {
    const db = await database()
    for (const limit of [0, -1, 1.5, 1001, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(
        readOrganizationAuditPage(db, readInput({ limit })),
      ).rejects.toThrow('Organization audit read exceeds its row bound.')
    }
  })

  it('reads all seven actual membership-service writers after membership removal with the original organization scope', async () => {
    const db = await database()
    const deliveries: OrganizationMembershipDelivery[] = []
    await serviceInvite(db, deliveries)
    const original = deliveries[0]!
    const input = membershipInput(original.membershipId)
    expect(
      await reinviteOrganizationMember(db, {
        ...input,
        inviteSecret,
        delivery: async (delivery) => {
          deliveries.push(delivery)
        },
      }),
    ).toEqual({ status: 'success' })
    const beforeWrongFamily = await snapshot(db)
    expect(
      await acceptOrganizationMember(db, {
        ...input,
        actor: {
          ...recipientActor,
          sessionId: actor.sessionId,
          deviceIdentifier: actor.deviceIdentifier,
        },
        inviteSecret,
        body: { token: deliveries[1]!.token },
      }),
    ).toEqual({ status: 'not_found' })
    expect(await snapshot(db)).toEqual(beforeWrongFamily)
    expect(
      await acceptOrganizationMember(db, {
        ...input,
        actor: recipientActor,
        inviteSecret,
        body: { token: deliveries[1]!.token },
      }),
    ).toEqual({ status: 'success' })
    expect(
      await confirmOrganizationMember(db, {
        ...input,
        body: { key: '2.synthetic-recipient-wrapper' },
      }),
    ).toEqual({ status: 'success' })
    expect(
      await updateOrganizationMember(db, {
        ...input,
        body: { type: 2, collections: [] },
      }),
    ).toEqual({ status: 'success' })
    expect(await revokeOrganizationMember(db, input)).toEqual({
      status: 'success',
    })
    expect(await removeOrganizationMember(db, input)).toEqual({
      status: 'success',
    })
    expect(
      await db
        .prepare('SELECT id FROM organization_users WHERE id = ?')
        .bind(original.membershipId)
        .first(),
    ).toBeNull()

    const page = await successPage(db)
    expect(page.records).toHaveLength(7)
    expect(page.records.map((record) => record.name).sort()).toEqual([
      'organization.member.accept',
      'organization.member.confirm',
      'organization.member.invite',
      'organization.member.reinvite',
      'organization.member.remove',
      'organization.member.revoke',
      'organization.member.update',
    ])
    for (const record of page.records) {
      expect(record).toMatchObject({
        object: 'organizationAuditEvent',
        schemaVersion: 1,
        outcome: 'success',
        occurredAt,
        actorUserId:
          record.name === 'organization.member.accept' ? 'recipient' : 'owner',
        targetType: 'organization_user',
        targetId: original.membershipId,
      })
    }
    const persisted = await db
      .prepare('SELECT context_json FROM audit_events')
      .all<{ context_json: string }>()
    expect(
      persisted.results.every(
        (row) => JSON.parse(row.context_json).organizationId === 'org-a',
      ),
    ).toBe(true)
    expect(await successPage(db, { organizationId: 'org-b' })).toEqual({
      status: 'success',
      records: [],
      hasMore: false,
    })
    expect(JSON.stringify(page)).not.toContain(inviteSecret)
    expect(JSON.stringify(page)).not.toContain(deliveries[1]!.token)
    expect(JSON.stringify(page)).not.toContain('synthetic-recipient-wrapper')
  })

  it.each(['accept', 'reinvite'])(
    'rolls back the actual %s service mutation when mandatory audit persistence fails',
    async (action) => {
      const db = await database()
      const deliveries: OrganizationMembershipDelivery[] = []
      await serviceInvite(db, deliveries)
      const original = deliveries[0]!
      const input = membershipInput(original.membershipId)
      const acceptance = {
        ...input,
        actor: recipientActor,
        inviteSecret,
        body: { token: original.token },
      }
      const before = await snapshot(db)
      await db
        .prepare(
          "CREATE TRIGGER fail_organization_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END;",
        )
        .run()
      const operation =
        action === 'accept'
          ? acceptOrganizationMember(db, acceptance)
          : reinviteOrganizationMember(db, {
              ...input,
              inviteSecret,
              delivery: async (delivery) => {
                deliveries.push(delivery)
              },
            })
      await expect(operation).rejects.toThrow('synthetic audit failure')
      expect(await snapshot(db)).toEqual(before)
      expect(deliveries).toHaveLength(1)
      expect(
        (await successPage(db)).records.map((record) => record.name),
      ).toEqual(['organization.member.invite'])
      await db.prepare('DROP TRIGGER fail_organization_audit').run()
      expect(await acceptOrganizationMember(db, acceptance)).toEqual({
        status: 'success',
      })
    },
  )
})

function readInput(overrides: Partial<ReadInput> = {}): ReadInput {
  return {
    organizationId: 'org-a',
    actor,
    from,
    to,
    eventName: null,
    filterActorUserId: null,
    limit: 100,
    cursor: null,
    ...overrides,
  }
}

function auditApp(db: D1Database) {
  let clock = to
  const failures: { code: string; operation: string }[] = []
  const app = new Hono()
  registerOrganizationAuditRoutes(app, {
    authenticate: async () => ({ ok: true as const, actor }),
    runtime: () => ({
      enabled: true,
      database: db,
      cursorSecret,
      optionalAuditLoggingEnabled: false,
    }),
    now: () => clock,
    requestId: () => 'synthetic-route-request',
    reportFailure: (_context, failure) => {
      failures.push(failure)
    },
  })
  return {
    app,
    failures,
    setNow(value: string) {
      clock = value
    },
  }
}

function auditPath(
  input: {
    organizationId?: string
    operation?: 'query' | 'export'
    query?: Record<string, string>
  } = {},
) {
  const query = new URLSearchParams(input.query ?? { from, to })
  const suffix = input.operation === 'export' ? '/export' : ''
  return `/api/organizations/${input.organizationId ?? 'org-a'}/audit-events${suffix}?${query}`
}

async function successPage(db: D1Database, overrides: Partial<ReadInput> = {}) {
  const page = await readOrganizationAuditPage(db, readInput(overrides))
  expect(page.status).toBe('success')
  if (page.status !== 'success')
    throw new Error('Expected authorized audit page.')
  return page
}

function membershipInput(membershipId: string) {
  return {
    actor: owner,
    organizationId: 'org-a',
    membershipId,
    requestId: crypto.randomUUID(),
    now: occurredAt,
  }
}

async function serviceInvite(
  db: D1Database,
  deliveries: OrganizationMembershipDelivery[],
) {
  expect(
    await inviteOrganizationMembers(db, {
      ...membershipInput('unused'),
      inviteSecret,
      delivery: async (delivery) => {
        deliveries.push(delivery)
      },
      body: {
        emails: ['recipient@example.test'],
        type: 2,
        collections: [
          {
            id: 'collection-a',
            readOnly: true,
            hidePasswords: true,
            manage: false,
          },
        ],
      },
    }),
  ).toEqual({ status: 'success' })
}

async function requireTotp(db: D1Database) {
  await db
    .prepare(
      "INSERT INTO organization_policies (id, organization_id, type, enabled, revision_date, created_at, updated_at) VALUES ('policy-a', 'org-a', 0, 1, ?, ?, ?)",
    )
    .bind(occurredAt, occurredAt, occurredAt)
    .run()
}

async function verifiedDevice(db: D1Database) {
  await db
    .prepare(
      "UPDATE devices SET mfa_totp_credential_generation = 'synthetic-generation', mfa_verified_at = ? WHERE id = 'verified-device' AND user_id = 'owner' AND identifier = ? AND session_id = ?",
    )
    .bind(occurredAt, actor.deviceIdentifier, actor.sessionId)
    .run()
}

async function insertEvents(db: D1Database, events: AuditRowInput[]) {
  for (let start = 0; start < events.length; start += 100) {
    await db.batch(
      events.slice(start, start + 100).map((event) =>
        db
          .prepare(
            `INSERT INTO audit_events (id, schema_version, name, outcome, request_id, occurred_at,
          actor_user_id, actor_device_identifier, target_type, target_id, context_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            event.id,
            event.schemaVersion ?? 1,
            event.name ?? 'organization.member.update',
            event.outcome ?? 'success',
            'synthetic-request',
            event.occurredAt ?? occurredAt,
            event.actorUserId === undefined ? 'owner' : event.actorUserId,
            'synthetic-actor-device',
            event.targetType === undefined
              ? 'organization_user'
              : event.targetType,
            event.targetId === undefined ? 'historical-member' : event.targetId,
            event.contextJson === undefined
              ? JSON.stringify({ organizationId: 'org-a' })
              : event.contextJson,
          ),
      ),
    )
  }
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
        `INSERT INTO users (id, email, email_normalized, display_name, kdf_algorithm, kdf_iterations,
        master_password_hash, security_stamp, revision_date, public_key)
      VALUES (?, ?, ?, ?, 'pbkdf2-sha256', 600000, 'synthetic-hash', 'synthetic-stamp', ?, 'synthetic-public')`,
      )
      .bind(user, `${user}@example.test`, `${user}@example.test`, user, from)
      .run()
  }
  for (const user of ['owner', 'admin']) {
    await db
      .prepare(
        'INSERT INTO devices (id, user_id, identifier, session_id) VALUES (?, ?, ?, ?)',
      )
      .bind(
        user === 'owner' ? 'verified-device' : 'admin-live-device',
        user,
        actor.deviceIdentifier,
        actor.sessionId,
      )
      .run()
  }
  await db
    .prepare(
      "INSERT INTO devices (id, user_id, identifier, session_id) VALUES ('recipient-live-device', ?, ?, ?)",
    )
    .bind(
      recipientActor.userId,
      recipientActor.deviceIdentifier,
      recipientActor.sessionId,
    )
    .run()
  for (const suffix of ['a', 'b']) {
    await createOrganizationFoundation(db, {
      organizationId: `org-${suffix}`,
      organizationUserId: `owner-${suffix}`,
      collectionId: `collection-${suffix}`,
      userId: 'owner',
      email: 'owner@example.test',
      name: `Synthetic company ${suffix}`,
      billingEmail: null,
      planType: 0,
      orgKey: '2.synthetic-owner-wrapper',
      publicKey: 'synthetic-org-public',
      privateKey: '2.synthetic-org-private',
      encryptedCollectionName: '2.synthetic-collection',
      now: from,
    })
  }
  return db
}

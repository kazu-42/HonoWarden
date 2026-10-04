import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it } from 'vitest'
import { readOrganizationAuditPage } from '../../src/repositories/organization-audit-repository'
import {
  listOrganizationPolicies,
  listOrganizationPoliciesForUser,
  readOrganizationPolicy,
  readOrganizationPolicyImpact,
  updateOrganizationPolicy,
} from '../../src/repositories/organization-policy-repository'
import { organizationPolicyAllowsSql } from '../../src/repositories/organization-policy-sql'
import { createOrganizationFoundation } from '../../src/repositories/organization-repository'

const instances: Miniflare[] = []
const now = '2026-10-04T00:00:00.000Z'
const later = '2026-10-04T00:00:01.000Z'
const generation = 'synthetic-generation-1'
const actor = {
  userId: 'owner',
  sessionId: 'owner-session',
  deviceIdentifier: 'owner-device',
}
const scope = { organizationId: 'org', actor }
const defaultPolicy = {
  id: null,
  organizationId: 'org',
  type: 0,
  enabled: false,
  revisionDate: null,
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()))
})

describe('organization policies on real D1 with every tracked migration', () => {
  it('projects a missing row as one disabled policy without creating state', async () => {
    const db = await database()
    const before = await snapshot(db)
    expect(await readOrganizationPolicy(db, scope)).toEqual({
      status: 'success',
      policy: defaultPolicy,
    })
    expect(await listOrganizationPolicies(db, scope)).toEqual({
      status: 'success',
      policies: [defaultPolicy],
    })
    expect(await listOrganizationPoliciesForUser(db, 'owner', actor)).toEqual(
      [],
    )
    expect(await snapshot(db)).toEqual(before)
  })

  it.each(['owner', 'admin', 'member', 'accepted'])(
    'lets an active %s read sanitized policy metadata without MFA for remediation',
    async (userId) => {
      const db = await database()
      await seedPolicy(db, true)
      const requested = { ...scope, actor: await unassuredActor(db, userId) }
      const expected = {
        ...defaultPolicy,
        id: 'org-policy',
        enabled: true,
        revisionDate: now,
      }
      const before = await snapshot(db)
      expect(await readOrganizationPolicy(db, requested)).toEqual({
        status: 'success',
        policy: expected,
      })
      expect(await listOrganizationPolicies(db, requested)).toEqual({
        status: 'success',
        policies: [expected],
      })
      expect(
        await listOrganizationPoliciesForUser(db, userId, requested.actor),
      ).toEqual([expected])
      expect(await snapshot(db)).toEqual(before)
    },
  )

  it.each(['outsider', 'invited', 'revoked', 'disabled'])(
    'obscures policy metadata from an %s membership or account',
    async (userId) => {
      const db = await database()
      await seedPolicy(db, true)
      const requested = { ...scope, actor: { ...actor, userId } }
      expect(await readOrganizationPolicy(db, requested)).toEqual({
        status: 'not_found',
      })
      expect(await listOrganizationPolicies(db, requested)).toEqual({
        status: 'not_found',
      })
      expect(
        await listOrganizationPoliciesForUser(db, userId, requested.actor),
      ).toEqual([])
    },
  )

  it.each(
    [false, true].flatMap((enabled) =>
      [
        'revoked-family',
        'replaced-family',
        'legacy-family',
        'missing-family',
        'wrong-session',
        'wrong-device',
        'disabled-account',
      ].map((condition) => ({ enabled, condition })),
    ),
  )(
    'rechecks $condition at every metadata read after preflight with policy enabled=$enabled',
    async ({ enabled, condition }) => {
      const db = await database()
      await seedPolicy(db, enabled)
      expect((await readOrganizationPolicy(db, scope)).status).toBe('success')
      expect((await readOrganizationPolicyImpact(db, scope)).status).toBe(
        'success',
      )
      expect(
        await listOrganizationPoliciesForUser(db, 'owner', actor),
      ).toHaveLength(1)

      let requestedActor = actor
      if (condition === 'revoked-family')
        await db
          .prepare(
            "UPDATE devices SET revoked_at = ? WHERE id = 'owner-device-id'",
          )
          .bind(now)
          .run()
      if (condition === 'replaced-family')
        await db
          .prepare(
            "UPDATE devices SET session_id = 'replacement-session' WHERE id = 'owner-device-id'",
          )
          .run()
      if (condition === 'legacy-family')
        await db
          .prepare(
            "UPDATE devices SET session_id = NULL WHERE id = 'owner-device-id'",
          )
          .run()
      if (condition === 'missing-family')
        await db
          .prepare("DELETE FROM devices WHERE id = 'owner-device-id'")
          .run()
      if (condition === 'wrong-session')
        requestedActor = { ...actor, sessionId: 'other-session' }
      if (condition === 'wrong-device')
        requestedActor = { ...actor, deviceIdentifier: 'other-device' }
      if (condition === 'disabled-account')
        await db
          .prepare("UPDATE users SET disabled_at = ? WHERE id = 'owner'")
          .bind(now)
          .run()

      const before = await snapshot(db)
      const requested = { ...scope, actor: requestedActor }
      expect(await readOrganizationPolicy(db, requested)).toEqual({
        status: 'not_found',
      })
      expect(await listOrganizationPolicies(db, requested)).toEqual({
        status: 'not_found',
      })
      expect(await readOrganizationPolicyImpact(db, requested)).toEqual({
        status: 'not_found',
      })
      expect(
        await listOrganizationPoliciesForUser(db, 'owner', requestedActor),
      ).toEqual([])
      expect(await snapshot(db)).toEqual(before)
    },
  )

  it('rejects a different active actor in the global policy metadata query', async () => {
    const db = await database()
    await seedPolicy(db, false)
    const adminActor = await unassuredActor(db, 'admin')
    expect(
      await listOrganizationPoliciesForUser(db, 'admin', adminActor),
    ).toHaveLength(1)
    expect(
      await listOrganizationPoliciesForUser(db, 'owner', adminActor),
    ).toEqual([])
  })

  it('obscures a missing or disabled organization even from its Owner', async () => {
    const db = await database()
    for (const organizationId of ['missing', 'org']) {
      if (organizationId === 'org')
        await db
          .prepare("UPDATE organizations SET enabled = 0 WHERE id = 'org'")
          .run()
      const input = { ...scope, organizationId }
      expect(await readOrganizationPolicy(db, input)).toEqual({
        status: 'not_found',
      })
      expect(await listOrganizationPolicies(db, input)).toEqual({
        status: 'not_found',
      })
      expect(await readOrganizationPolicyImpact(db, input)).toEqual({
        status: 'not_found',
      })
      expect(
        await updateOrganizationPolicy(db, mutation({ organizationId })),
      ).toEqual({
        status: 'not_found',
      })
    }
    expect(await listOrganizationPoliciesForUser(db, 'owner', actor)).toEqual(
      [],
    )
    expect(await count(db, 'organization_policies')).toBe(0)
    expect(await count(db, 'audit_events')).toBe(0)
  })

  it.each([
    'outsider',
    'admin',
    'member',
    'accepted',
    'invited',
    'revoked',
    'disabled',
  ])(
    'denies a %s policy write without state, polling revision, or audit changes',
    async (userId) => {
      const db = await database()
      const requested = await assureActor(db, userId)
      const before = await snapshot(db)
      expect(
        await updateOrganizationPolicy(db, mutation({ actor: requested })),
      ).toEqual({ status: 'not_found' })
      expect(await snapshot(db)).toEqual(before)
    },
  )

  it.each([
    'accepted-owner',
    'invited-owner',
    'revoked-owner',
    'disabled-owner',
    'demoted-owner',
  ])(
    'rechecks %s state at mutation time after a metadata read',
    async (condition) => {
      const db = await database()
      await assureOwner(db)
      expect((await readOrganizationPolicy(db, scope)).status).toBe('success')
      if (condition === 'disabled-owner')
        await db
          .prepare("UPDATE users SET disabled_at = ? WHERE id = 'owner'")
          .bind(now)
          .run()
      else if (condition === 'demoted-owner')
        await db
          .prepare(
            "UPDATE organization_users SET type = 1 WHERE id = 'owner-membership'",
          )
          .run()
      else
        await db
          .prepare(
            "UPDATE organization_users SET status = ? WHERE id = 'owner-membership'",
          )
          .bind(
            condition === 'accepted-owner'
              ? 1
              : condition === 'invited-owner'
                ? 0
                : -1,
          )
          .run()
      const before = await snapshot(db)
      expect(await updateOrganizationPolicy(db, mutation())).toEqual({
        status: 'not_found',
      })
      expect(await snapshot(db)).toEqual(before)
    },
  )

  it.each([
    'unenrolled',
    'pending-enrollment',
    'unverified-enrollment',
    'missing-evidence',
    'unverified-evidence',
    'foreign-device-evidence',
    'foreign-user-evidence',
    'revoked-device',
    'legacy-generation',
    'legacy-session',
    'wrong-session',
    'wrong-device',
    'wrong-generation',
  ])(
    'refuses to enable with %s despite the Owner role and leaves all state unchanged',
    async (condition) => {
      const db = await database()
      await assureOwner(db)
      const requested = await invalidateAssurance(db, condition)
      const before = await snapshot(db)
      expect(
        await updateOrganizationPolicy(db, mutation({ actor: requested })),
      ).toEqual({ status: assuranceFailureStatus(condition) })
      expect(await snapshot(db)).toEqual(before)
    },
  )

  it.each([
    'unenrolled',
    'pending-enrollment',
    'unverified-enrollment',
    'missing-evidence',
    'unverified-evidence',
    'foreign-device-evidence',
    'revoked-device',
    'legacy-generation',
    'legacy-session',
    'wrong-session',
    'wrong-generation',
  ])(
    'refuses a weak Owner recovery bypass when disabling an enabled policy with %s',
    async (condition) => {
      const db = await database()
      await seedPolicy(db, true)
      await assureOwner(db)
      const requested = await invalidateAssurance(db, condition)
      const before = await snapshot(db)
      expect(
        await updateOrganizationPolicy(
          db,
          mutation({ actor: requested, enabled: false }),
        ),
      ).toEqual({ status: assuranceFailureStatus(condition) })
      expect(await snapshot(db)).toEqual(before)
    },
  )

  it('requires assurance when enabling an existing disabled row', async () => {
    const db = await database()
    await seedPolicy(db, false)
    await enroll(db, 'owner')
    const before = await snapshot(db)
    expect(await updateOrganizationPolicy(db, mutation())).toEqual({
      status: 'mfa_required',
    })
    expect(await snapshot(db)).toEqual(before)
  })

  it('permits an unassured Owner to keep a disabled policy disabled', async () => {
    const db = await database()
    await seedPolicy(db, false)
    expect(
      await updateOrganizationPolicy(db, mutation({ enabled: false })),
    ).toMatchObject({
      status: 'success',
      policy: { organizationId: 'org', type: 0, enabled: false },
    })
    expect(await count(db, 'audit_events')).toBe(1)
    expect(await allows(db)).toBe(true)
  })

  it.each([
    'revoked-device',
    'legacy-session',
    'wrong-session',
    'wrong-device',
  ])(
    'denies disabled policy writes from %s even when MFA is not required',
    async (condition) => {
      for (const persisted of [false, true]) {
        const db = await database()
        if (persisted) await seedPolicy(db, false)
        const requested = await invalidateAssurance(db, condition)
        const before = await snapshot(db)
        expect(
          await updateOrganizationPolicy(
            db,
            mutation({ actor: requested, enabled: false }),
          ),
        ).toEqual({ status: 'not_found' })
        expect(await snapshot(db)).toEqual(before)
      }
    },
  )

  it('enables and disables with current same-family assurance and records only safe audit metadata', async () => {
    const db = await database()
    await assureOwner(db)
    const enabled = await updateOrganizationPolicy(db, mutation())
    expect(enabled).toEqual({
      status: 'success',
      policy: {
        id: expect.any(String),
        organizationId: 'org',
        type: 0,
        enabled: true,
        revisionDate: expect.any(String),
      },
    })
    if (enabled.status !== 'success')
      throw new Error('Expected policy update success')
    expect(await readOrganizationPolicy(db, scope)).toEqual(enabled)
    expect(await listOrganizationPoliciesForUser(db, 'owner', actor)).toEqual([
      enabled.policy,
    ])
    const disabled = await updateOrganizationPolicy(
      db,
      mutation({ enabled: false, requestId: 'synthetic-disable-request' }),
    )
    expect(disabled).toMatchObject({
      status: 'success',
      policy: { organizationId: 'org', type: 0, enabled: false },
    })
    const events = await db
      .prepare(
        `SELECT name, outcome, request_id, actor_user_id, actor_device_identifier,
          target_type, target_id, context_json FROM audit_events ORDER BY occurred_at, id`,
      )
      .all()
    expect(events.results).toEqual(
      expect.arrayContaining([
        {
          name: 'organization.policy.update',
          outcome: 'success',
          request_id: 'synthetic-enable-request',
          actor_user_id: 'owner',
          actor_device_identifier: 'owner-device',
          target_type: 'organization',
          target_id: 'org',
          context_json: expect.any(String),
        },
        {
          name: 'organization.policy.update',
          outcome: 'success',
          request_id: 'synthetic-disable-request',
          actor_user_id: 'owner',
          actor_device_identifier: 'owner-device',
          target_type: 'organization',
          target_id: 'org',
          context_json: expect.any(String),
        },
      ]),
    )
    expect(events.results).toHaveLength(2)
    expect(
      events.results.map((event) => JSON.parse(String(event.context_json))),
    ).toEqual(
      expect.arrayContaining([
        {
          organizationId: 'org',
          policyType: 0,
          enabled: true,
          policyRevision: expect.any(String),
        },
        {
          organizationId: 'org',
          policyType: 0,
          enabled: false,
          policyRevision: expect.any(String),
        },
      ]),
    )
    expect(JSON.stringify(events.results)).not.toContain(
      'synthetic-totp-envelope',
    )
    expect(JSON.stringify(events.results)).not.toContain(generation)
    expect(JSON.stringify(events.results)).not.toContain(
      '2.synthetic-owner-wrapper',
    )
    expect(JSON.stringify(events.results)).not.toContain('owner@example.test')
  })

  it('keeps revisions strictly monotonic for identical updates and backward request times', async () => {
    const db = await database()
    await assureOwner(db)
    let previousPolicy = now
    let previousOrganization = now
    let previousUser = now
    for (const [index, timestamp] of [later, later, now].entries()) {
      const result = await updateOrganizationPolicy(
        db,
        mutation({ now: timestamp, requestId: `synthetic-repeat-${index}` }),
      )
      expect(result.status).toBe('success')
      if (result.status !== 'success')
        throw new Error('Expected policy update success')
      expect(result.policy.enabled).toBe(true)
      expect(result.policy.revisionDate).not.toBeNull()
      expect(result.policy.revisionDate! > previousPolicy).toBe(true)
      const organization = await db
        .prepare("SELECT revision_date FROM organizations WHERE id = 'org'")
        .first<{ revision_date: string }>()
      const user = await db
        .prepare("SELECT revision_date FROM users WHERE id = 'owner'")
        .first<{ revision_date: string }>()
      expect(organization!.revision_date > previousOrganization).toBe(true)
      expect(user!.revision_date > previousUser).toBe(true)
      previousPolicy = result.policy.revisionDate!
      previousOrganization = organization!.revision_date
      previousUser = user!.revision_date
    }
    expect(await count(db, 'organization_policies')).toBe(1)
    expect(await count(db, 'audit_events')).toBe(3)
  })

  it('exposes the real committed policy event through the scoped audit repository', async () => {
    const db = await database()
    await assureOwner(db)
    expect((await updateOrganizationPolicy(db, mutation())).status).toBe(
      'success',
    )
    const page = await readOrganizationAuditPage(db, {
      organizationId: 'org',
      actor,
      from: now,
      to: '2026-10-04T00:00:02.000Z',
      eventName: 'organization.policy.update',
      filterActorUserId: null,
      limit: 100,
      cursor: null,
    })
    expect(page).toMatchObject({
      status: 'success',
      hasMore: false,
      records: [
        {
          name: 'organization.policy.update',
          actorUserId: 'owner',
          targetType: 'organization',
          targetId: 'org',
        },
      ],
    })
    if (page.status !== 'success')
      throw new Error('Expected scoped audit read success')
    expect(page.records).toHaveLength(1)
  })

  it.each(['create', 'enable', 'disable', 'repeat'])(
    'rolls back the %s operation, member revisions, and policy row when mandatory audit insertion fails',
    async (action) => {
      const db = await database()
      await assureOwner(db)
      if (action !== 'create') await seedPolicy(db, action !== 'enable')
      const before = await snapshot(db)
      await db
        .prepare(
          "CREATE TRIGGER fail_policy_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'synthetic policy audit failure'); END;",
        )
        .run()
      await expect(
        updateOrganizationPolicy(
          db,
          mutation({ enabled: action !== 'disable' }),
        ),
      ).rejects.toThrow('synthetic policy audit failure')
      expect(await snapshot(db)).toEqual(before)
    },
  )

  it.each(['create', 'enable', 'disable', 'repeat'])(
    'rolls back the %s operation when its mandatory audit is silently ignored',
    async (action) => {
      const db = await database()
      await assureOwner(db)
      if (action !== 'create') await seedPolicy(db, action !== 'enable')
      const before = await snapshot(db)
      await ignorePolicyAudit(db)
      await expect(
        updateOrganizationPolicy(
          db,
          mutation({ enabled: action !== 'disable' }),
        ),
      ).rejects.toThrow()
      expect(await snapshot(db)).toEqual(before)

      await db.prepare('DROP TRIGGER ignore_policy_audit').run()
      const retry = await updateOrganizationPolicy(
        db,
        mutation({ enabled: action !== 'disable' }),
      )
      expect(retry.status).toBe('success')
      expect(await count(db, 'audit_events')).toBe(1)
    },
  )

  it('does not mistake a denied actor for a silently ignored mandatory audit', async () => {
    const db = await database()
    const adminActor = await assureActor(db, 'admin')
    await seedPolicy(db, true)
    await ignorePolicyAudit(db)
    const before = await snapshot(db)
    expect(
      await updateOrganizationPolicy(db, mutation({ actor: adminActor })),
    ).toEqual({ status: 'not_found' })
    expect(await snapshot(db)).toEqual(before)
  })

  it('rolls back a silently ignored mandatory audit at a repeated request timestamp', async () => {
    const db = await database()
    await assureOwner(db)
    expect((await updateOrganizationPolicy(db, mutation())).status).toBe(
      'success',
    )
    const before = await snapshot(db)
    await ignorePolicyAudit(db)
    await expect(updateOrganizationPolicy(db, mutation())).rejects.toThrow()
    expect(await snapshot(db)).toEqual(before)
    await db.prepare('DROP TRIGGER ignore_policy_audit').run()
    expect((await updateOrganizationPolicy(db, mutation())).status).toBe(
      'success',
    )
    expect(await count(db, 'audit_events')).toBe(2)
  })

  it.each(['owner', 'admin'])(
    'returns sanitized enrollment impact to a confirmed %s without session MFA',
    async (userId) => {
      const db = await database()
      await seedPolicy(db, true)
      await enroll(db, 'owner')
      const requestedActor = await unassuredActor(db, userId)
      const before = await snapshot(db)
      const result = await readOrganizationPolicyImpact(db, {
        ...scope,
        actor: requestedActor,
      })
      expect(result).toEqual({
        status: 'success',
        impact: {
          organizationId: 'org',
          enabled: true,
          policyRevisionDate: now,
          enrolledOwnerCount: 1,
          noncompliantConfirmedMemberCount: 2,
          noncompliantAcceptedMemberCount: 1,
        },
      })
      expect(JSON.stringify(result)).not.toContain('@example.test')
      expect(JSON.stringify(result)).not.toContain('synthetic-totp-envelope')
      expect(JSON.stringify(result)).not.toContain('member-membership')
      expect(await snapshot(db)).toEqual(before)
    },
  )

  it.each(['member', 'accepted', 'invited', 'revoked', 'disabled', 'outsider'])(
    'obscures enrollment impact from an unauthorized %s',
    async (userId) => {
      const db = await database()
      expect(
        await readOrganizationPolicyImpact(db, {
          ...scope,
          actor: { ...actor, userId },
        }),
      ).toEqual({ status: 'not_found' })
    },
  )

  it('keeps organizations separate across reads, writes, impact, polling revisions, and enforcement', async () => {
    const db = await database()
    await foundation(db, 'foreign', 'outsider')
    await assureOwner(db)
    const outsiderActor = await unassuredActor(db, 'outsider')
    const foreignBefore = await db
      .prepare("SELECT * FROM organizations WHERE id = 'foreign'")
      .first()
    expect(await updateOrganizationPolicy(db, mutation())).toMatchObject({
      status: 'success',
      policy: { organizationId: 'org', enabled: true },
    })
    expect(
      await listOrganizationPoliciesForUser(db, 'outsider', outsiderActor),
    ).toEqual([])
    expect(
      await readOrganizationPolicy(db, { ...scope, organizationId: 'foreign' }),
    ).toEqual({
      status: 'not_found',
    })
    expect(
      await updateOrganizationPolicy(
        db,
        mutation({ organizationId: 'foreign', enabled: false }),
      ),
    ).toEqual({ status: 'not_found' })
    expect(
      await readOrganizationPolicyImpact(db, {
        ...scope,
        organizationId: 'foreign',
        actor: outsiderActor,
      }),
    ).toEqual({
      status: 'success',
      impact: {
        organizationId: 'foreign',
        enabled: false,
        policyRevisionDate: null,
        enrolledOwnerCount: 0,
        noncompliantConfirmedMemberCount: 1,
        noncompliantAcceptedMemberCount: 0,
      },
    })
    expect(
      await db
        .prepare("SELECT * FROM organizations WHERE id = 'foreign'")
        .first(),
    ).toEqual(foreignBefore)
    expect(await allows(db, { ...actor, sessionId: 'other-session' })).toBe(
      false,
    )
    expect(
      await allows(db, { ...actor, sessionId: 'other-session' }, 'foreign'),
    ).toBe(true)
    expect(await count(db, 'audit_events')).toBe(1)
  })

  it('stores only the supported policy type and one policy per organization', async () => {
    const db = await database()
    await seedPolicy(db, false)
    await expect(
      db
        .prepare(
          "INSERT INTO organization_policies (id,organization_id,type,enabled,revision_date,created_at,updated_at) VALUES ('unsupported','org',1,0,?,?,?)",
        )
        .bind(now, now, now)
        .run(),
    ).rejects.toThrow()
    await expect(
      db
        .prepare(
          "INSERT INTO organization_policies (id,organization_id,type,enabled,revision_date,created_at,updated_at) VALUES ('duplicate','org',0,0,?,?,?)",
        )
        .bind(now, now, now)
        .run(),
    ).rejects.toThrow()
    expect(await count(db, 'organization_policies')).toBe(1)
  })
})

describe('organization policy predicate on real D1', () => {
  it('allows missing or disabled policy rows without requiring TOTP posture', async () => {
    const db = await database()
    expect(await allows(db)).toBe(true)
    await seedPolicy(db, false)
    expect(await allows(db)).toBe(true)
    expect(await allows(db, { ...actor, sessionId: 'foreign-session' })).toBe(
      true,
    )
  })

  it('enforces persisted enabled policy state without a writer feature flag', async () => {
    const db = await database()
    await seedPolicy(db, true)
    expect(await allows(db)).toBe(false)
    await enroll(db, 'owner')
    expect(await allows(db)).toBe(false)
    await verifyDevice(db)
    expect(await allows(db)).toBe(true)
    expect(await allows(db, { ...actor, sessionId: 'foreign-session' })).toBe(
      false,
    )
    expect(
      await allows(db, { ...actor, deviceIdentifier: 'foreign-device' }),
    ).toBe(false)
  })

  it.each([
    'unenrolled',
    'pending-enrollment',
    'unverified-enrollment',
    'missing-evidence',
    'unverified-evidence',
    'foreign-device-evidence',
    'foreign-user-evidence',
    'revoked-device',
    'legacy-generation',
    'legacy-session',
    'wrong-session',
    'wrong-device',
    'wrong-generation',
  ])('fails closed for enabled policy with %s', async (condition) => {
    const db = await database()
    await seedPolicy(db, true)
    await assureOwner(db)
    const requested = await invalidateAssurance(db, condition)
    expect(await allows(db, requested)).toBe(false)
  })

  it('invalidates a previously valid family immediately when enrollment is removed', async () => {
    const db = await database()
    await seedPolicy(db, true)
    await assureOwner(db)
    expect(await allows(db)).toBe(true)
    await db.prepare("DELETE FROM user_totp WHERE user_id = 'owner'").run()
    expect(await allows(db)).toBe(false)
    expect(
      await updateOrganizationPolicy(db, mutation({ enabled: false })),
    ).toEqual({ status: 'mfa_required' })
  })

  it.each(['disable', 'delete'])(
    'discards every persisted family proof after enrollment %s and never revives it',
    async (operation) => {
      const db = await database()
      await seedPolicy(db, true)
      await assureOwner(db)
      const otherActor = {
        ...actor,
        sessionId: 'other-owner-session',
        deviceIdentifier: 'other-owner-device',
      }
      await insertAssuredDevice(db, 'other-owner-device-id', otherActor)
      expect(await allows(db)).toBe(true)
      expect(await allows(db, otherActor)).toBe(true)
      if (operation === 'disable')
        await db
          .prepare("UPDATE user_totp SET enabled = 0 WHERE user_id = 'owner'")
          .run()
      if (operation === 'delete')
        await db.prepare("DELETE FROM user_totp WHERE user_id = 'owner'").run()
      const evidence = await db
        .prepare(
          `SELECT mfa_totp_credential_generation, mfa_verified_at
          FROM devices WHERE user_id = 'owner' ORDER BY id`,
        )
        .all()
      expect(evidence.results).toEqual([
        { mfa_totp_credential_generation: null, mfa_verified_at: null },
        { mfa_totp_credential_generation: null, mfa_verified_at: null },
      ])
      if (operation === 'delete') await enroll(db, 'owner')
      else
        await db
          .prepare(
            "UPDATE user_totp SET enabled = 1, credential_generation = ? WHERE user_id = 'owner'",
          )
          .bind(generation)
          .run()
      expect(await allows(db)).toBe(false)
      expect(await allows(db, otherActor)).toBe(false)
    },
  )

  it('keeps a separately compliant Owner family available for safe recovery', async () => {
    const db = await database()
    await seedPolicy(db, true)
    await assureOwner(db)
    await db
      .prepare(
        "UPDATE organization_users SET type = 0 WHERE id = 'admin-membership'",
      )
      .run()
    await enroll(db, 'admin')
    const recoveryActor = {
      userId: 'admin',
      sessionId: 'recovery-owner-session',
      deviceIdentifier: 'recovery-owner-device',
    }
    await db
      .prepare(
        `INSERT INTO devices
          (id,user_id,identifier,session_id,mfa_totp_credential_generation,mfa_verified_at)
        VALUES ('recovery-owner-device-id',?,?,?,?,?)`,
      )
      .bind(
        recoveryActor.userId,
        recoveryActor.deviceIdentifier,
        recoveryActor.sessionId,
        generation,
        now,
      )
      .run()
    await db.prepare("DELETE FROM user_totp WHERE user_id = 'owner'").run()
    const before = await snapshot(db)
    expect(await allows(db)).toBe(false)
    expect(await allows(db, recoveryActor)).toBe(true)
    expect(
      await allows(db, { ...recoveryActor, sessionId: 'unassured-session' }),
    ).toBe(false)
    expect(await snapshot(db)).toEqual(before)
  })

  it('requires current-generation proof after a family has been replaced', async () => {
    const db = await database()
    await seedPolicy(db, true)
    await assureOwner(db)
    await db
      .prepare(
        "UPDATE user_totp SET credential_generation = 'synthetic-generation-2' WHERE user_id = 'owner'",
      )
      .run()
    expect(await allows(db)).toBe(false)
    await db
      .prepare(
        "UPDATE devices SET mfa_totp_credential_generation = 'synthetic-generation-2', mfa_verified_at = ? WHERE id = 'owner-device-id'",
      )
      .bind(now)
      .run()
    expect(await allows(db)).toBe(true)
    await db
      .prepare(
        `UPDATE devices SET session_id = 'replacement-session',
          mfa_totp_credential_generation = NULL, mfa_verified_at = NULL
        WHERE id = 'owner-device-id'`,
      )
      .run()
    expect(await allows(db)).toBe(false)
    const replacement = { ...actor, sessionId: 'replacement-session' }
    expect(await allows(db, replacement)).toBe(false)
    await db
      .prepare(
        "UPDATE devices SET mfa_totp_credential_generation = 'synthetic-generation-2', mfa_verified_at = ? WHERE id = 'owner-device-id'",
      )
      .bind(now)
      .run()
    expect(await allows(db, replacement)).toBe(true)
    expect(await allows(db)).toBe(false)
  })
})

function mutation(
  overrides: Partial<Parameters<typeof updateOrganizationPolicy>[1]> = {},
): Parameters<typeof updateOrganizationPolicy>[1] {
  return {
    ...scope,
    enabled: true,
    now: later,
    requestId: 'synthetic-enable-request',
    ...overrides,
  }
}

async function seedPolicy(db: D1Database, enabled: boolean) {
  await db
    .prepare(
      `INSERT INTO organization_policies
        (id,organization_id,type,enabled,revision_date,created_at,updated_at)
      VALUES ('org-policy','org',0,?,?,?,?)`,
    )
    .bind(enabled ? 1 : 0, now, now, now)
    .run()
}

async function ignorePolicyAudit(db: D1Database) {
  await db
    .prepare(
      `CREATE TRIGGER ignore_policy_audit BEFORE INSERT ON audit_events
    WHEN NEW.name = 'organization.policy.update'
    BEGIN SELECT RAISE(IGNORE); END;`,
    )
    .run()
}

async function enroll(db: D1Database, userId: string) {
  await db
    .prepare(
      `INSERT INTO user_totp
        (user_id,encrypted_secret,enabled,verified_at,credential_generation)
      VALUES (?,'synthetic-totp-envelope',1,?,?)`,
    )
    .bind(userId, now, generation)
    .run()
}

async function verifyDevice(db: D1Database) {
  await db
    .prepare(
      `UPDATE devices SET mfa_totp_credential_generation = ?, mfa_verified_at = ?
      WHERE id = 'owner-device-id'`,
    )
    .bind(generation, now)
    .run()
}

async function assureOwner(db: D1Database) {
  await enroll(db, 'owner')
  await verifyDevice(db)
}

async function assureActor(db: D1Database, userId: string) {
  const requested = {
    userId,
    sessionId: `${userId}-session`,
    deviceIdentifier: `${userId}-device`,
  }
  await enroll(db, userId)
  await insertAssuredDevice(db, `${userId}-device-id`, requested)
  return requested
}

async function unassuredActor(db: D1Database, userId: string) {
  const requested = {
    userId,
    sessionId: `${userId}-unassured-session`,
    deviceIdentifier: `${userId}-unassured-device`,
  }
  await db
    .prepare(
      `INSERT INTO devices (id,user_id,identifier,session_id)
    VALUES (?,?,?,?)`,
    )
    .bind(
      `${userId}-unassured-device-id`,
      userId,
      requested.deviceIdentifier,
      requested.sessionId,
    )
    .run()
  return requested
}

async function insertAssuredDevice(
  db: D1Database,
  id: string,
  requested: typeof actor,
) {
  await db
    .prepare(
      `INSERT INTO devices
        (id,user_id,identifier,session_id,mfa_totp_credential_generation,mfa_verified_at)
      VALUES (?,?,?,?,?,?)`,
    )
    .bind(
      id,
      requested.userId,
      requested.deviceIdentifier,
      requested.sessionId,
      generation,
      now,
    )
    .run()
}

function assuranceFailureStatus(condition: string) {
  return [
    'revoked-device',
    'legacy-session',
    'wrong-session',
    'wrong-device',
  ].includes(condition)
    ? 'not_found'
    : 'mfa_required'
}

async function invalidateAssurance(db: D1Database, condition: string) {
  const requested = { ...actor }
  if (condition === 'unenrolled')
    await db.prepare("DELETE FROM user_totp WHERE user_id = 'owner'").run()
  if (condition === 'pending-enrollment')
    await db
      .prepare(
        `UPDATE user_totp SET enabled = 0, verified_at = NULL,
          pending_encrypted_secret = 'synthetic-pending-totp-envelope', pending_created_at = ?
        WHERE user_id = 'owner'`,
      )
      .bind(now)
      .run()
  if (condition === 'unverified-enrollment')
    await db
      .prepare(
        "UPDATE user_totp SET verified_at = NULL WHERE user_id = 'owner'",
      )
      .run()
  if (condition === 'missing-evidence')
    await db
      .prepare(
        "UPDATE devices SET mfa_totp_credential_generation = NULL, mfa_verified_at = NULL WHERE id = 'owner-device-id'",
      )
      .run()
  if (condition === 'unverified-evidence')
    await db
      .prepare(
        "UPDATE devices SET mfa_verified_at = NULL WHERE id = 'owner-device-id'",
      )
      .run()
  if (
    condition === 'foreign-device-evidence' ||
    condition === 'foreign-user-evidence'
  ) {
    await db
      .prepare(
        "UPDATE devices SET mfa_totp_credential_generation = NULL, mfa_verified_at = NULL WHERE id = 'owner-device-id'",
      )
      .run()
    await db
      .prepare(
        `INSERT INTO devices
          (id,user_id,identifier,session_id,mfa_totp_credential_generation,mfa_verified_at)
        VALUES ('foreign-evidence',?,?,?,?,?)`,
      )
      .bind(
        condition === 'foreign-user-evidence' ? 'admin' : 'owner',
        condition === 'foreign-user-evidence'
          ? actor.deviceIdentifier
          : 'other-owner-device',
        condition === 'foreign-user-evidence'
          ? actor.sessionId
          : 'other-owner-session',
        generation,
        now,
      )
      .run()
    if (condition === 'foreign-user-evidence') await enroll(db, 'admin')
  }
  if (condition === 'revoked-device')
    await db
      .prepare("UPDATE devices SET revoked_at = ? WHERE id = 'owner-device-id'")
      .bind(now)
      .run()
  if (condition === 'legacy-generation')
    await db
      .prepare(
        "UPDATE user_totp SET credential_generation = NULL WHERE user_id = 'owner'",
      )
      .run()
  if (condition === 'legacy-session')
    await db
      .prepare(
        "UPDATE devices SET session_id = NULL WHERE id = 'owner-device-id'",
      )
      .run()
  if (condition === 'wrong-session') requested.sessionId = 'wrong-session'
  if (condition === 'wrong-device') requested.deviceIdentifier = 'wrong-device'
  if (condition === 'wrong-generation')
    await db
      .prepare(
        "UPDATE devices SET mfa_totp_credential_generation = 'synthetic-previous-generation' WHERE id = 'owner-device-id'",
      )
      .run()
  return requested
}

async function allows(
  db: D1Database,
  requested = actor,
  organizationId = 'org',
) {
  const predicate = organizationPolicyAllowsSql({
    organizationId: 'organization.id',
    userId: 'requested_actor.user_id',
    sessionId: 'requested_actor.session_id',
    deviceIdentifier: 'requested_actor.device_identifier',
  })
  const row = await db
    .prepare(
      `WITH requested_actor AS (
        SELECT ? AS user_id, ? AS session_id, ? AS device_identifier
      )
      SELECT (${predicate}) AS allowed
      FROM organizations organization CROSS JOIN requested_actor
      WHERE organization.id = ?`,
    )
    .bind(
      requested.userId,
      requested.sessionId,
      requested.deviceIdentifier,
      organizationId,
    )
    .first<{ allowed: number }>()
  return row?.allowed === 1
}

async function count(db: D1Database, table: string) {
  return (await db
    .prepare(`SELECT COUNT(*) count FROM ${table}`)
    .first<{ count: number }>())!.count
}

async function snapshot(db: D1Database) {
  return Promise.all(
    ['organization_policies', 'organizations', 'users', 'audit_events'].map(
      async (table) =>
        (await db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results,
    ),
  )
}

async function foundation(
  db: D1Database,
  organizationId: string,
  userId: string,
) {
  await createOrganizationFoundation(db, {
    organizationId,
    organizationUserId: `${organizationId === 'org' ? userId : organizationId}-membership`,
    collectionId: `${organizationId}-collection`,
    userId,
    email: `${userId}@example.test`,
    name: `Synthetic ${organizationId} company`,
    billingEmail: null,
    planType: 0,
    orgKey: '2.synthetic-owner-wrapper',
    publicKey: 'synthetic-org-public',
    privateKey: '2.synthetic-org-private',
    encryptedCollectionName: '2.synthetic-collection',
    now,
  })
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
  for (const userId of [
    'owner',
    'admin',
    'member',
    'accepted',
    'invited',
    'revoked',
    'disabled',
    'outsider',
  ]) {
    await db
      .prepare(
        `INSERT INTO users
          (id,email,email_normalized,display_name,kdf_algorithm,kdf_iterations,
            master_password_hash,security_stamp,revision_date,disabled_at)
        VALUES (?,?,?,?,'pbkdf2-sha256',600000,'synthetic-password-hash','synthetic-security-stamp',?,?)`,
      )
      .bind(
        userId,
        `${userId}@example.test`,
        `${userId}@example.test`,
        `Synthetic ${userId}`,
        now,
        userId === 'disabled' ? now : null,
      )
      .run()
  }
  await foundation(db, 'org', 'owner')
  for (const [userId, status, role] of [
    ['admin', 2, 1],
    ['member', 2, 2],
    ['accepted', 1, 2],
    ['invited', 0, 2],
    ['revoked', -1, 2],
    ['disabled', 2, 2],
  ] as const) {
    await db
      .prepare(
        `INSERT INTO organization_users
          (id,organization_id,user_id,email,org_key,status,type,invite_token_hash)
        VALUES (?,'org',?,?,'2.synthetic-member-wrapper',?,?,?)`,
      )
      .bind(
        `${userId}-membership`,
        userId,
        `${userId}@example.test`,
        status,
        role,
        status === 0 ? 'synthetic-invite-verifier' : null,
      )
      .run()
  }
  await db
    .prepare(
      `INSERT INTO devices (id,user_id,identifier,session_id)
      VALUES ('owner-device-id','owner',?,?)`,
    )
    .bind(actor.deviceIdentifier, actor.sessionId)
    .run()
  return db
}

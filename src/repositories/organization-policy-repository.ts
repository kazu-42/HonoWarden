import type { OrganizationPolicyRecord } from '../domain/organization-policy'
import {
  organizationSessionTotpVerifiedSql,
  type OrganizationPolicyActor,
} from './organization-policy-sql'

type Database = Pick<D1Database, 'prepare' | 'batch'>
type Scope = { organizationId: string; actor: OrganizationPolicyActor }
type PolicyRow = Omit<OrganizationPolicyRecord, 'enabled'> & {
  enabled: number | boolean
}
type ReadResult =
  | { status: 'success'; policy: OrganizationPolicyRecord }
  | { status: 'not_found' }

export type OrganizationPolicyImpact = {
  organizationId: string
  enabled: boolean
  policyRevisionDate: string | null
  enrolledOwnerCount: number
  noncompliantConfirmedMemberCount: number
  noncompliantAcceptedMemberCount: number
}

const actorCte = `WITH requested_actor AS (
  SELECT ? AS user_id, ? AS session_id, ? AS device_identifier
)`
const actorMembership = `
  membership.user_id = requested_actor.user_id
  AND membership.status IN (1, 2) AND membership.type IN (0, 1, 2)
  AND actor_account.disabled_at IS NULL AND organization.enabled = 1
`
const actorMfa = organizationSessionTotpVerifiedSql({
  userId: 'requested_actor.user_id',
  sessionId: 'requested_actor.session_id',
  deviceIdentifier: 'requested_actor.device_identifier',
})
const activeActorSession = `EXISTS (
  SELECT 1 FROM devices actor_session
  WHERE actor_session.user_id = requested_actor.user_id
    AND actor_session.identifier = requested_actor.device_identifier
    AND actor_session.session_id = requested_actor.session_id
    AND actor_session.revoked_at IS NULL
)`
const enrolledRecipient = `EXISTS (
  SELECT 1 FROM user_totp recipient_totp
  WHERE recipient_totp.user_id = recipient.user_id
    AND recipient_totp.enabled = 1 AND recipient_totp.verified_at IS NOT NULL
    AND recipient_totp.credential_generation IS NOT NULL
)`

// These reads expose policy metadata to members who need to remediate MFA.
// Organization keys and protected resources use organizationPolicyAllowsSql.
export async function readOrganizationPolicy(
  database: Database,
  input: Scope,
): Promise<ReadResult> {
  const row = await database
    .prepare(
      `${actorCte}
      SELECT policy.id, organization.id AS organizationId, 0 AS type,
        COALESCE(policy.enabled, 0) AS enabled, policy.revision_date AS revisionDate
      FROM organizations organization
      JOIN organization_users membership ON membership.organization_id = organization.id
      JOIN users actor_account ON actor_account.id = membership.user_id
      CROSS JOIN requested_actor
      LEFT JOIN organization_policies policy ON policy.organization_id = organization.id AND policy.type = 0
      WHERE organization.id = ? AND ${actorMembership}
        AND ${activeActorSession}
      LIMIT 1`,
    )
    .bind(...actorBindings(input.actor), input.organizationId)
    .first<PolicyRow>()
  return row
    ? { status: 'success', policy: fromRow(row) }
    : { status: 'not_found' }
}

export async function listOrganizationPolicies(
  database: Database,
  input: Scope,
): Promise<
  | { status: 'success'; policies: OrganizationPolicyRecord[] }
  | { status: 'not_found' }
> {
  const result = await readOrganizationPolicy(database, input)
  return result.status === 'success'
    ? { status: 'success', policies: [result.policy] }
    : result
}

export async function listOrganizationPoliciesForUser(
  database: Database,
  userId: string,
  actor: OrganizationPolicyActor,
): Promise<OrganizationPolicyRecord[]> {
  const rows = await database
    .prepare(
      `${actorCte}
      SELECT DISTINCT policy.id, policy.organization_id AS organizationId,
        policy.type, policy.enabled, policy.revision_date AS revisionDate
      FROM organization_policies policy
      JOIN organizations organization ON organization.id = policy.organization_id AND organization.enabled = 1
      JOIN organization_users membership ON membership.organization_id = organization.id
      JOIN users account ON account.id = membership.user_id AND account.disabled_at IS NULL
      CROSS JOIN requested_actor
      WHERE membership.user_id = ? AND membership.user_id = requested_actor.user_id
        AND ${activeActorSession} AND membership.status IN (1, 2)
        AND membership.type IN (0, 1, 2) AND policy.type = 0
      ORDER BY policy.organization_id`,
    )
    .bind(...actorBindings(actor), userId)
    .all<PolicyRow>()
  assertRead(rows)
  return rows.results.map(fromRow)
}

export async function readOrganizationPolicyImpact(
  database: Database,
  input: Scope,
): Promise<
  | { status: 'success'; impact: OrganizationPolicyImpact }
  | { status: 'not_found' }
> {
  const row = await database
    .prepare(
      `${actorCte}
      SELECT organization.id AS organizationId, COALESCE(policy.enabled, 0) AS enabled,
        policy.revision_date AS policyRevisionDate,
        (SELECT COUNT(*) FROM organization_users recipient
          JOIN users recipient_account ON recipient_account.id = recipient.user_id AND recipient_account.disabled_at IS NULL
          WHERE recipient.organization_id = organization.id AND recipient.status = 2 AND recipient.type = 0
            AND ${enrolledRecipient}) AS enrolledOwnerCount,
        (SELECT COUNT(*) FROM organization_users recipient
          JOIN users recipient_account ON recipient_account.id = recipient.user_id AND recipient_account.disabled_at IS NULL
          WHERE recipient.organization_id = organization.id AND recipient.status = 2 AND recipient.type IN (0, 1, 2)
            AND NOT ${enrolledRecipient}) AS noncompliantConfirmedMemberCount,
        (SELECT COUNT(*) FROM organization_users recipient
          JOIN users recipient_account ON recipient_account.id = recipient.user_id AND recipient_account.disabled_at IS NULL
          WHERE recipient.organization_id = organization.id AND recipient.status = 1 AND recipient.type IN (0, 1, 2)
            AND NOT ${enrolledRecipient}) AS noncompliantAcceptedMemberCount
      FROM organizations organization
      JOIN organization_users membership ON membership.organization_id = organization.id
      JOIN users actor_account ON actor_account.id = membership.user_id
      CROSS JOIN requested_actor
      LEFT JOIN organization_policies policy ON policy.organization_id = organization.id AND policy.type = 0
      WHERE organization.id = ? AND ${actorMembership}
        AND ${activeActorSession}
        AND membership.status = 2 AND membership.type IN (0, 1)
      LIMIT 1`,
    )
    .bind(...actorBindings(input.actor), input.organizationId)
    .first<Omit<OrganizationPolicyImpact, 'enabled'> & { enabled: number }>()
  return row
    ? { status: 'success', impact: { ...row, enabled: row.enabled === 1 } }
    : { status: 'not_found' }
}

export async function updateOrganizationPolicy(
  database: Database,
  input: Scope & { enabled: boolean; now: string; requestId: string },
): Promise<ReadResult | { status: 'mfa_required' }> {
  const auditId = crypto.randomUUID()
  const policyId = crypto.randomUUID()
  const mutation = database
    .prepare(
      `${actorCte}
      INSERT INTO organization_policies (id, organization_id, type, enabled,
        revision_date, created_at, updated_at, last_mutation_id)
      SELECT DISTINCT ?, organization.id, 0, ?, ?, ?, ?, ?
      FROM organizations organization
      JOIN organization_users membership ON membership.organization_id = organization.id
      JOIN users actor_account ON actor_account.id = membership.user_id
      CROSS JOIN requested_actor
      WHERE organization.id = ? AND ${actorMembership}
        AND membership.status = 2 AND membership.type = 0
        AND ${activeActorSession}
        AND ((? = 0 AND NOT EXISTS (
          SELECT 1 FROM organization_policies existing_policy
          WHERE existing_policy.organization_id = organization.id AND existing_policy.type = 0 AND existing_policy.enabled = 1
        )) OR ${actorMfa})
      ON CONFLICT(organization_id, type) DO UPDATE SET
        enabled = excluded.enabled,
        revision_date = strftime('%Y-%m-%dT%H:%M:%fZ', MAX(organization_policies.revision_date, excluded.revision_date), '+0.001 seconds'),
        updated_at = excluded.updated_at,
        last_mutation_id = excluded.last_mutation_id`,
    )
    .bind(
      ...actorBindings(input.actor),
      policyId,
      input.enabled ? 1 : 0,
      input.now,
      input.now,
      input.now,
      auditId,
      input.organizationId,
      input.enabled ? 1 : 0,
    )
  const statements = [
    mutation,
    database
      .prepare(
        `INSERT INTO audit_events (id, schema_version, name, outcome, request_id, occurred_at,
          actor_user_id, actor_device_identifier, target_type, target_id, context_json)
        SELECT ?, 1, 'organization.policy.update', 'success', ?, ?, ?, ?, 'organization', ?,
          json_object('organizationId', ?, 'policyType', 0, 'enabled', json(CASE WHEN enabled = 1 THEN 'true' ELSE 'false' END), 'policyRevision', revision_date)
        FROM organization_policies WHERE organization_id = ? AND type = 0 AND changes() = 1`,
      )
      .bind(
        auditId,
        input.requestId,
        input.now,
        input.actor.userId,
        input.actor.deviceIdentifier,
        input.organizationId,
        input.organizationId,
        input.organizationId,
      ),
    // Fail inside the transaction: a post-batch row-count check cannot undo a write.
    database
      .prepare(
        `SELECT CASE WHEN EXISTS (SELECT 1 FROM organization_policies
          WHERE organization_id = ? AND type = 0 AND last_mutation_id = ?)
          AND NOT EXISTS (SELECT 1 FROM audit_events WHERE id = ?)
          THEN json('mandatory policy audit missing') ELSE 1 END AS valid`,
      )
      .bind(input.organizationId, auditId, auditId),
    database
      .prepare(
        `UPDATE organizations
        SET revision_date = strftime('%Y-%m-%dT%H:%M:%fZ', MAX(revision_date, ?,
          (SELECT revision_date FROM organization_policies WHERE organization_id = organizations.id AND type = 0)), '+0.001 seconds'),
          updated_at = ?
        WHERE id = ? AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?)`,
      )
      .bind(input.now, input.now, input.organizationId, auditId),
    database
      .prepare(
        `UPDATE users SET revision_date = strftime('%Y-%m-%dT%H:%M:%fZ', MAX(
          users.revision_date, ?,
          COALESCE((SELECT MAX(revision_date) FROM folders WHERE user_id = users.id), users.revision_date),
          COALESCE((SELECT MAX(revision_date) FROM ciphers WHERE user_id = users.id AND organization_id IS NULL), users.revision_date),
          COALESCE((SELECT MAX(organization.revision_date) FROM organizations organization JOIN organization_users membership
            ON membership.organization_id = organization.id WHERE membership.user_id = users.id), users.revision_date),
          COALESCE((SELECT MAX(cipher.revision_date) FROM ciphers cipher JOIN organization_users membership
            ON membership.organization_id = cipher.organization_id WHERE membership.user_id = users.id), users.revision_date)
        ), '+0.001 seconds')
        WHERE id IN (SELECT user_id FROM organization_users WHERE organization_id = ? AND user_id IS NOT NULL)
          AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?)`,
      )
      .bind(input.now, input.organizationId, auditId),
    database
      .prepare(
        `SELECT id, organization_id AS organizationId, type, enabled, revision_date AS revisionDate
        FROM organization_policies WHERE organization_id = ? AND type = 0
          AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?)`,
      )
      .bind(input.organizationId, auditId),
  ]
  const results = await database.batch(statements)
  if (
    results.length !== statements.length ||
    results.some((result) => !result.success)
  )
    throw new Error('Organization policy mutation batch did not fully apply.')
  const changed = results[0]?.meta.changes ?? 0
  if (changed === 1) {
    const row = results[5]?.results[0] as PolicyRow | undefined
    if (
      results[1]?.meta.changes !== 1 ||
      results[3]?.meta.changes !== 1 ||
      !row
    )
      throw new Error('Organization policy audit or revision invariant failed.')
    return { status: 'success', policy: fromRow(row) }
  }
  if (changed !== 0 || results[1]?.meta.changes !== 0)
    throw new Error(
      'Organization policy mutation affected an invalid row count.',
    )
  // Only a currently authorized Owner may receive the remediation reason.
  const owner = await database
    .prepare(
      `${actorCte}
      SELECT 1 AS allowed FROM organizations organization
      JOIN organization_users membership ON membership.organization_id = organization.id
      JOIN users actor_account ON actor_account.id = membership.user_id
      CROSS JOIN requested_actor
      WHERE organization.id = ? AND ${actorMembership}
        AND membership.status = 2 AND membership.type = 0
        AND ${activeActorSession} LIMIT 1`,
    )
    .bind(...actorBindings(input.actor), input.organizationId)
    .first()
  return { status: owner ? 'mfa_required' : 'not_found' }
}

function actorBindings(actor: OrganizationPolicyActor) {
  return [actor.userId, actor.sessionId, actor.deviceIdentifier] as const
}

function fromRow(row: PolicyRow): OrganizationPolicyRecord {
  return { ...row, type: 0, enabled: row.enabled === 1 || row.enabled === true }
}

function assertRead(result: D1Result): void {
  if (!result.success) throw new Error('Organization policy read failed.')
}

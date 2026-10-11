import {
  organizationAuditEventNames,
  organizationAuditEventTargets,
  organizationAuditPolicy,
  projectOrganizationAuditRecord,
  type OrganizationAuditEventName,
  type OrganizationAuditPosition,
  type OrganizationAuditRecord,
  type OrganizationAuditStoredProjection,
} from '../domain/organization-audit'
import {
  organizationPolicyAllowsSql,
  type OrganizationPolicyActor,
} from './organization-policy-sql'

type Database = Pick<D1Database, 'prepare'>
export type OrganizationAuditReadInput = {
  organizationId: string
  actor: OrganizationPolicyActor
  from: string
  to: string
  eventName: OrganizationAuditEventName | null
  filterActorUserId: string | null
  limit: number
  cursor: OrganizationAuditPosition | null
}

export type OrganizationAuditReadResult =
  | { status: 'not_found' }
  | {
      status: 'success'
      records: OrganizationAuditRecord[]
      hasMore: boolean
    }

// Keep this expression identical to migration 0028 for indexed scope equality.
export const organizationAuditScopeExpression = `CASE
  WHEN json_valid(event.context_json)
  THEN CASE
    WHEN json_type(event.context_json) = 'object'
      AND json_type(event.context_json, '$.organizationId') = 'text'
    THEN json_extract(event.context_json, '$.organizationId')
    ELSE NULL
  END
  ELSE NULL
END`

export async function readOrganizationAuditPage(
  database: Database,
  input: OrganizationAuditReadInput,
): Promise<OrganizationAuditReadResult> {
  if (
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > organizationAuditPolicy.maxExportRows
  )
    throw new Error('Organization audit read exceeds its row bound.')
  const policy = organizationPolicyAllowsSql({
    organizationId: 'actor.organization_id',
    userId: 'actor.user_id',
    sessionId: 'requested_actor.session_id',
    deviceIdentifier: 'requested_actor.device_identifier',
  })
  const cursorSql = input.cursor
    ? `AND (event.occurred_at < ? OR (event.occurred_at = ? AND event.id < ?))`
    : ''
  const bindings: (string | number | null)[] = [
    input.actor.userId,
    input.actor.sessionId,
    input.actor.deviceIdentifier,
    input.organizationId,
    input.organizationId,
    input.from,
    input.to,
    input.eventName,
    input.eventName,
    input.filterActorUserId,
    input.filterActorUserId,
  ]
  if (input.cursor)
    bindings.push(
      input.cursor.occurredAt,
      input.cursor.occurredAt,
      input.cursor.id,
    )
  bindings.push(input.limit + 1)
  const result = await database
    .prepare(
      `WITH requested_actor(user_id, session_id, device_identifier) AS (
        VALUES (?, ?, ?)
      ), authorized AS (
        SELECT 1 AS allowed
        FROM organization_users actor
        JOIN users actor_account ON actor_account.id = actor.user_id
        JOIN organizations organization ON organization.id = actor.organization_id
        CROSS JOIN requested_actor
        WHERE actor.organization_id = ?
          AND actor.user_id = requested_actor.user_id
          AND actor.status = 2 AND actor.type IN (0, 1)
          AND actor_account.disabled_at IS NULL AND organization.enabled = 1
          AND EXISTS (
            SELECT 1 FROM devices actor_session
            WHERE actor_session.user_id = requested_actor.user_id
              AND actor_session.identifier = requested_actor.device_identifier
              AND actor_session.session_id = requested_actor.session_id
              AND actor_session.revoked_at IS NULL
          )
          AND ${policy}
        LIMIT 1
      ), page AS (
        SELECT event.id, event.schema_version AS schemaVersion, event.name,
          event.outcome, event.occurred_at AS occurredAt,
          event.actor_user_id AS actorUserId, event.target_type AS targetType,
          event.target_id AS targetId
        FROM audit_events event INDEXED BY idx_organization_audit_scope_occurred
        WHERE EXISTS (SELECT 1 FROM authorized)
          AND ${organizationAuditScopeExpression} = ?
          AND event.schema_version = 1 AND event.outcome = 'success'
          AND (${organizationAuditEventNames.map((name) => `(event.name = '${name}' AND event.target_type = '${organizationAuditEventTargets[name]}')`).join(' OR ')})
          AND event.occurred_at >= ? AND event.occurred_at < ?
          AND (? IS NULL OR event.name = ?)
          AND (? IS NULL OR event.actor_user_id = ?)
          ${cursorSql}
        ORDER BY event.occurred_at DESC, event.id DESC
        LIMIT ?
      )
      SELECT authorized.allowed, page.* FROM authorized LEFT JOIN page ON 1 = 1
      ORDER BY page.occurredAt DESC, page.id DESC`,
    )
    .bind(...bindings)
    .all<
      Omit<OrganizationAuditStoredProjection, 'id'> & {
        allowed: number
        id: string | null
      }
    >()
  if (result.results.length === 0) return { status: 'not_found' }
  const rows = result.results.filter(
    (row): row is OrganizationAuditStoredProjection & { allowed: number } =>
      row.id !== null,
  )
  return {
    status: 'success',
    records: rows.slice(0, input.limit).map(projectOrganizationAuditRecord),
    hasMore: rows.length > input.limit,
  }
}

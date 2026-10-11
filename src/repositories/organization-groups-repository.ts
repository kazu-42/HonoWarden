import type { AuditEvent } from '../domain/audit'
import type {
  OrganizationGroupRecord,
  OrganizationGroupWriteRequest,
} from '../domain/organization-groups'
import {
  organizationPolicyAllowsSql,
  type OrganizationPolicyActor,
} from './organization-policy-sql'

type Database = Pick<D1Database, 'prepare' | 'batch'>
export type OrganizationGroupScope = {
  organizationId: string
  actor: OrganizationPolicyActor
}
export type OrganizationGroupMutation = OrganizationGroupScope & {
  groupId: string
  now: string
  auditEvent: AuditEvent
  expectedRevisionDate?: string
}
type Result = { status: 'success' } | { status: 'not_found' | 'conflict' }
type GroupRow = {
  id: string
  organizationId: string
  name: string
  revisionDate: string
  collectionsJson: string
  usersJson: string
}

const actorCtes = `WITH requested_actor AS (
  SELECT ? AS user_id, ? AS session_id, ? AS device_identifier
), requested_scope AS (SELECT ? AS organization_id)`

const manager = `EXISTS (
  SELECT 1 FROM organization_users actor
  JOIN users actor_account ON actor_account.id = actor.user_id
    AND actor_account.disabled_at IS NULL
  JOIN organizations organization ON organization.id = actor.organization_id
    AND organization.enabled = 1
  CROSS JOIN requested_actor CROSS JOIN requested_scope
  WHERE actor.organization_id = requested_scope.organization_id
    AND actor.user_id = requested_actor.user_id AND actor.status = 2
    AND actor.type IN (0, 1)
    AND EXISTS (SELECT 1 FROM devices actor_session
      WHERE actor_session.user_id = requested_actor.user_id
        AND actor_session.identifier = requested_actor.device_identifier
        AND actor_session.session_id = requested_actor.session_id
        AND actor_session.revoked_at IS NULL)
    AND ${organizationPolicyAllowsSql({
      organizationId: 'organization.id',
      userId: 'actor.user_id',
      sessionId: 'requested_actor.session_id',
      deviceIdentifier: 'requested_actor.device_identifier',
    })}
)`

const owner = `EXISTS (SELECT 1 FROM organization_users actor
  CROSS JOIN requested_actor CROSS JOIN requested_scope
  WHERE actor.organization_id = requested_scope.organization_id
    AND actor.user_id = requested_actor.user_id AND actor.status = 2
    AND actor.type = 0)`

const groupSelect = `SELECT group_row.id,
  group_row.organization_id AS organizationId, group_row.name,
  group_row.revision_date AS revisionDate,
  COALESCE((SELECT json_group_array(json_object('id', collection_id,
    'readOnly', read_only, 'hidePasswords', hide_passwords, 'manage', manage))
    FROM (SELECT collection_id, read_only, hide_passwords, manage FROM collection_groups
      WHERE group_id = group_row.id AND organization_id = group_row.organization_id
      ORDER BY collection_id)), '[]') AS collectionsJson,
  COALESCE((SELECT json_group_array(organization_user_id)
    FROM (SELECT organization_user_id FROM organization_group_users
      WHERE group_id = group_row.id AND organization_id = group_row.organization_id
      ORDER BY organization_user_id)), '[]') AS usersJson
  FROM organization_groups group_row
  WHERE group_row.organization_id = (SELECT organization_id FROM requested_scope)
    AND ${manager}`

export async function listOrganizationGroups(
  database: Database,
  input: OrganizationGroupScope,
): Promise<
  | { status: 'success'; groups: OrganizationGroupRecord[] }
  | { status: 'not_found' }
> {
  if (!(await canManage(database, input))) return { status: 'not_found' }
  const result = await database
    .prepare(`${actorCtes} ${groupSelect} ORDER BY group_row.id`)
    .bind(...scopeValues(input))
    .all<GroupRow>()
  return { status: 'success', groups: result.results.map(fromRow) }
}

export async function findOrganizationGroup(
  database: Database,
  input: OrganizationGroupScope & { groupId: string },
): Promise<OrganizationGroupRecord | null> {
  const row = await database
    .prepare(`${actorCtes} ${groupSelect} AND group_row.id = ?`)
    .bind(...scopeValues(input), input.groupId)
    .first<GroupRow>()
  return row ? fromRow(row) : null
}

export async function createOrganizationGroup(
  database: Database,
  input: OrganizationGroupMutation & OrganizationGroupWriteRequest,
): Promise<Result> {
  const mutationId = crypto.randomUUID()
  const root = database
    .prepare(
      `${actorCtes}
      INSERT INTO organization_groups (id, organization_id, name,
        revision_date, last_mutation_id, created_at, updated_at)
      SELECT ?, requested_scope.organization_id, ?,
        strftime('%Y-%m-%dT%H:%M:%fZ', ?, '+0.001 seconds'), ?, ?, ?
      FROM requested_scope WHERE ${manager} AND ${validRequestedAccessSql()}`,
    )
    .bind(
      ...scopeValues(input),
      input.groupId,
      input.name,
      input.now,
      mutationId,
      input.now,
      input.now,
      JSON.stringify(input.collections),
      JSON.stringify(input.users),
    )
  return runMutation(database, root, input, mutationId, 'replace', input)
}

export async function updateOrganizationGroup(
  database: Database,
  input: OrganizationGroupMutation & OrganizationGroupWriteRequest,
): Promise<Result> {
  const mutationId = crypto.randomUUID()
  const root = database
    .prepare(
      `${actorCtes}
      UPDATE organization_groups SET name = ?,
        revision_date = strftime('%Y-%m-%dT%H:%M:%fZ', MAX(revision_date, ?), '+0.001 seconds'),
        last_mutation_id = ?, updated_at = ?
      WHERE id = ? AND organization_id = (SELECT organization_id FROM requested_scope)
        AND (? IS NULL OR revision_date = ?)
        AND ${manager} AND ${adminCurrentMembersSql()}
        AND ${validRequestedAccessSql()}`,
    )
    .bind(
      ...scopeValues(input),
      input.name,
      input.now,
      mutationId,
      input.now,
      input.groupId,
      input.expectedRevisionDate ?? null,
      input.expectedRevisionDate ?? null,
      JSON.stringify(input.collections),
      JSON.stringify(input.users),
    )
  return runMutation(database, root, input, mutationId, 'replace', input)
}

export async function deleteOrganizationGroup(
  database: Database,
  input: OrganizationGroupMutation,
): Promise<Result> {
  return mutateExisting(database, input, 'delete')
}

export async function removeOrganizationGroupMember(
  database: Database,
  input: OrganizationGroupMutation & { membershipId: string },
): Promise<Result> {
  return mutateExisting(database, input, 'remove-member', input.membershipId)
}

function validRequestedAccessSql(): string {
  return `NOT EXISTS (SELECT 1 FROM json_each(?) requested
    LEFT JOIN collections collection ON collection.id = json_extract(requested.value, '$.id')
      AND collection.organization_id = (SELECT organization_id FROM requested_scope)
    WHERE collection.id IS NULL)
  AND NOT EXISTS (SELECT 1 FROM json_each(?) requested
    LEFT JOIN organization_users recipient ON recipient.id = requested.value
      AND recipient.organization_id = (SELECT organization_id FROM requested_scope)
    LEFT JOIN users recipient_account ON recipient_account.id = recipient.user_id
    WHERE recipient.id IS NULL OR recipient.status NOT IN (0, 1, 2)
      OR recipient.type NOT IN (0, 1, 2)
      OR (recipient.user_id IS NOT NULL AND recipient_account.disabled_at IS NOT NULL)
      OR (NOT ${owner} AND recipient.type <> 2))`
}

function adminCurrentMembersSql(): string {
  return `(${owner} OR NOT EXISTS (
    SELECT 1 FROM organization_group_users current_link
    JOIN organization_users current_member ON current_member.id = current_link.organization_user_id
      AND current_member.organization_id = current_link.organization_id
    WHERE current_link.group_id = organization_groups.id
      AND current_link.organization_id = organization_groups.organization_id
      AND current_member.type <> 2))`
}

async function mutateExisting(
  database: Database,
  input: OrganizationGroupMutation,
  operation: 'delete' | 'remove-member',
  membershipId?: string,
): Promise<Result> {
  const mutationId = crypto.randomUUID()
  const root = database
    .prepare(
      `${actorCtes}
      UPDATE organization_groups SET
        revision_date = strftime('%Y-%m-%dT%H:%M:%fZ', MAX(revision_date, ?), '+0.001 seconds'),
        last_mutation_id = ?, updated_at = ?
      WHERE id = ? AND organization_id = (SELECT organization_id FROM requested_scope)
        AND (? IS NULL OR revision_date = ?)
        AND ${manager} AND ${adminCurrentMembersSql()}
        ${membershipId === undefined ? '' : 'AND EXISTS (SELECT 1 FROM organization_group_users link WHERE link.group_id = organization_groups.id AND link.organization_id = organization_groups.organization_id AND link.organization_user_id = ?)'}
      `,
    )
    .bind(
      ...scopeValues(input),
      input.now,
      mutationId,
      input.now,
      input.groupId,
      input.expectedRevisionDate ?? null,
      input.expectedRevisionDate ?? null,
      ...(membershipId === undefined ? [] : [membershipId]),
    )
  return runMutation(
    database,
    root,
    input,
    mutationId,
    operation,
    undefined,
    membershipId,
  )
}

async function runMutation(
  database: Database,
  root: D1PreparedStatement,
  input: OrganizationGroupMutation,
  mutationId: string,
  operation: 'replace' | 'delete' | 'remove-member',
  replacement?: OrganizationGroupWriteRequest,
  membershipId?: string,
): Promise<Result> {
  const event = input.auditEvent
  const marker = `EXISTS (SELECT 1 FROM audit_events WHERE id = ?)`
  const statements = [
    root,
    database
      .prepare(
        `INSERT INTO audit_events (id, schema_version, name, outcome, request_id,
        occurred_at, actor_user_id, actor_device_identifier, target_type, target_id, context_json)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`,
      )
      .bind(
        mutationId,
        event.schemaVersion,
        event.name,
        event.outcome,
        event.requestId,
        event.occurredAt,
        event.actor?.userId ?? null,
        event.actor?.deviceIdentifier ?? null,
        event.target?.type ?? null,
        event.target?.id ?? null,
        event.context ? JSON.stringify(event.context) : null,
      ),
    // A thrown assertion joins the batch transaction; a post-batch check cannot roll it back.
    database
      .prepare(
        `SELECT CASE WHEN EXISTS (SELECT 1 FROM organization_groups
        WHERE id = ? AND organization_id = ? AND last_mutation_id = ?)
        AND NOT ${marker} THEN json('mandatory group audit missing') ELSE 1 END AS valid`,
      )
      .bind(input.groupId, input.organizationId, mutationId, mutationId),
    database
      .prepare(
        `UPDATE organizations SET revision_date =
        strftime('%Y-%m-%dT%H:%M:%fZ', MAX(revision_date, ?), '+0.001 seconds'), updated_at = ?
        WHERE id = ? AND ${marker}`,
      )
      .bind(input.now, input.now, input.organizationId, mutationId),
    assertion(database, `NOT ${marker} OR changes() = 1`, [mutationId]),
  ]
  const newUsers = JSON.stringify(replacement?.users ?? [])
  const affectedUsers = `SELECT DISTINCT membership.user_id FROM organization_users membership
    WHERE membership.organization_id = ? AND membership.user_id IS NOT NULL
      AND (membership.id IN (SELECT organization_user_id FROM organization_group_users
        WHERE group_id = ? AND organization_id = ?)
        OR membership.id IN (SELECT value FROM json_each(?)))`
  const affectedValues = [
    input.organizationId,
    input.groupId,
    input.organizationId,
    newUsers,
  ]
  statements.push(
    database
      .prepare(
        `UPDATE users SET revision_date = strftime('%Y-%m-%dT%H:%M:%fZ', MAX(
        users.revision_date, ?,
        COALESCE((SELECT MAX(revision_date) FROM folders WHERE user_id = users.id), users.revision_date),
        COALESCE((SELECT MAX(revision_date) FROM ciphers WHERE user_id = users.id AND organization_id IS NULL), users.revision_date),
        COALESCE((SELECT MAX(organization.revision_date) FROM organizations organization
          JOIN organization_users membership ON membership.organization_id = organization.id
          WHERE membership.user_id = users.id), users.revision_date),
        COALESCE((SELECT MAX(cipher.revision_date) FROM ciphers cipher
          JOIN organization_users membership ON membership.organization_id = cipher.organization_id
          WHERE membership.user_id = users.id), users.revision_date)
        ), '+0.001 seconds') WHERE id IN (${affectedUsers}) AND ${marker}`,
      )
      .bind(input.now, ...affectedValues, mutationId),
    assertion(
      database,
      `NOT ${marker} OR changes() = (SELECT COUNT(*) FROM users WHERE id IN (${affectedUsers}))`,
      [mutationId, ...affectedValues],
    ),
  )
  if (operation === 'replace' && replacement) {
    statements.push(
      database
        .prepare(
          `DELETE FROM organization_group_users WHERE group_id = ? AND organization_id = ? AND ${marker}`,
        )
        .bind(input.groupId, input.organizationId, mutationId),
      database
        .prepare(
          `INSERT INTO organization_group_users (group_id, organization_id, organization_user_id)
          SELECT ?, ?, value FROM json_each(?) WHERE ${marker}`,
        )
        .bind(input.groupId, input.organizationId, newUsers, mutationId),
      assertion(
        database,
        `NOT ${marker} OR (changes() = ? AND
        (SELECT COUNT(*) FROM organization_group_users WHERE group_id = ? AND organization_id = ?) = ?)`,
        [
          mutationId,
          replacement.users.length,
          input.groupId,
          input.organizationId,
          replacement.users.length,
        ],
      ),
      database
        .prepare(
          `DELETE FROM collection_groups WHERE group_id = ? AND organization_id = ? AND ${marker}`,
        )
        .bind(input.groupId, input.organizationId, mutationId),
      database
        .prepare(
          `INSERT INTO collection_groups (group_id, organization_id, collection_id, read_only, hide_passwords, manage)
          SELECT ?, ?, json_extract(value, '$.id'), json_extract(value, '$.readOnly'),
            json_extract(value, '$.hidePasswords'), json_extract(value, '$.manage')
          FROM json_each(?) WHERE ${marker}`,
        )
        .bind(
          input.groupId,
          input.organizationId,
          JSON.stringify(replacement.collections),
          mutationId,
        ),
      assertion(
        database,
        `NOT ${marker} OR (changes() = ? AND
        (SELECT COUNT(*) FROM collection_groups WHERE group_id = ? AND organization_id = ?) = ?)`,
        [
          mutationId,
          replacement.collections.length,
          input.groupId,
          input.organizationId,
          replacement.collections.length,
        ],
      ),
    )
  } else if (operation === 'delete') {
    statements.push(
      database
        .prepare(
          `DELETE FROM organization_groups WHERE id = ? AND organization_id = ? AND ${marker} RETURNING id`,
        )
        .bind(input.groupId, input.organizationId, mutationId),
      assertion(
        database,
        `NOT ${marker} OR NOT EXISTS (SELECT 1 FROM organization_groups WHERE id = ? AND organization_id = ?)`,
        [mutationId, input.groupId, input.organizationId],
      ),
    )
  } else {
    statements.push(
      database
        .prepare(
          `DELETE FROM organization_group_users WHERE group_id = ? AND organization_id = ?
          AND organization_user_id = ? AND ${marker}`,
        )
        .bind(input.groupId, input.organizationId, membershipId, mutationId),
      assertion(database, `NOT ${marker} OR changes() = 1`, [mutationId]),
    )
  }
  const results = await database.batch(statements)
  if (
    results.length !== statements.length ||
    results.some((result) => !result.success)
  )
    throw new Error('Organization group batch did not fully apply.')
  if (results[1]?.meta.changes === 1) return { status: 'success' }
  if (input.expectedRevisionDate !== undefined) {
    const current = await findOrganizationGroup(database, input)
    if (current && current.revisionDate !== input.expectedRevisionDate)
      return { status: 'conflict' }
  }
  return { status: 'not_found' }
}

function assertion(
  database: Database,
  condition: string,
  values: unknown[],
): D1PreparedStatement {
  return database
    .prepare(
      `SELECT CASE WHEN ${condition} THEN 1 ELSE json('organization group batch invariant failed') END AS valid`,
    )
    .bind(...values)
}

async function canManage(
  database: Database,
  input: OrganizationGroupScope,
): Promise<boolean> {
  return Boolean(
    await database
      .prepare(`${actorCtes} SELECT 1 AS allowed WHERE ${manager}`)
      .bind(...scopeValues(input))
      .first(),
  )
}

function scopeValues(input: OrganizationGroupScope): string[] {
  return [
    input.actor.userId,
    input.actor.sessionId,
    input.actor.deviceIdentifier,
    input.organizationId,
  ]
}

function fromRow(row: GroupRow): OrganizationGroupRecord {
  const grants = JSON.parse(row.collectionsJson) as {
    id: string
    readOnly: number
    hidePasswords: number
    manage: number
  }[]
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    revisionDate: row.revisionDate,
    users: JSON.parse(row.usersJson) as string[],
    collections: grants.map((grant) => ({
      id: grant.id,
      readOnly: Boolean(grant.readOnly),
      hidePasswords: Boolean(grant.hidePasswords),
      manage: Boolean(grant.manage),
    })),
  }
}

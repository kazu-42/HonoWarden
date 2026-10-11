import type { AuditEvent } from '../domain/audit'
import type {
  OrganizationMembershipCollectionGrant,
  OrganizationMembershipMemberRecord,
  OrganizationMembershipRole,
} from '../domain/organization-membership'
import {
  organizationPolicyAllowsSql,
  organizationTotpEnrollmentAllowsSql,
} from './organization-policy-sql'

type Database = Pick<D1Database, 'prepare' | 'batch'>
type SessionContext = { sessionId?: string; deviceIdentifier?: string }
type Scope = SessionContext & { organizationId: string; actorUserId: string }
type MemberRecord = OrganizationMembershipMemberRecord & { groups?: string[] }
type Mutation = Scope & {
  membershipId: string
  now: string
  auditEvent: AuditEvent
}
type Result = { status: 'success' } | { status: 'not_found' }

const actorCte = `WITH requested_actor AS (
  SELECT ? AS user_id, ? AS session_id, ? AS device_identifier
)`
const activeActorFamily = `((requested_actor.session_id IS NULL AND requested_actor.device_identifier IS NULL)
  OR EXISTS (SELECT 1 FROM devices actor_session
    WHERE actor_session.user_id = requested_actor.user_id
      AND actor_session.identifier = requested_actor.device_identifier
      AND actor_session.session_id = requested_actor.session_id
      AND actor_session.revoked_at IS NULL))`
const actorPolicy = `${activeActorFamily} AND ${organizationPolicyAllowsSql({
  organizationId: 'organization.id',
  userId: 'actor.user_id',
  sessionId: 'requested_actor.session_id',
  deviceIdentifier: 'requested_actor.device_identifier',
})}`

// Authorization is evaluated inside the mutation transaction, not from a prior read.
const manager = `EXISTS (
  SELECT 1 FROM organization_users actor
  JOIN users actor_account ON actor_account.id = actor.user_id AND actor_account.disabled_at IS NULL
  JOIN organizations organization ON organization.id = actor.organization_id AND organization.enabled = 1
  CROSS JOIN requested_actor
  WHERE actor.organization_id = ? AND actor.user_id = ? AND actor.status = 2
    AND actor.user_id = requested_actor.user_id AND ${actorPolicy}
    AND (actor.type = 0 OR (actor.type = 1 AND organization_users.type = 2))
)`
const enabledOwner = `EXISTS (
  SELECT 1 FROM organization_users surviving_owner
  JOIN users owner_account ON owner_account.id = surviving_owner.user_id AND owner_account.disabled_at IS NULL
  WHERE surviving_owner.organization_id = organization_users.organization_id
    AND surviving_owner.id <> organization_users.id AND surviving_owner.type = 0 AND surviving_owner.status = 2
    AND ${organizationTotpEnrollmentAllowsSql({
      organizationId: 'surviving_owner.organization_id',
      userId: 'surviving_owner.user_id',
    })}
)`
const readManager = `EXISTS (
  SELECT 1 FROM organization_users actor JOIN users actor_account ON actor_account.id = actor.user_id
  JOIN organizations organization ON organization.id = actor.organization_id
  CROSS JOIN requested_actor
  WHERE actor.organization_id = ? AND actor.user_id = ? AND actor.status = 2
    AND actor.type IN (0, 1) AND actor_account.disabled_at IS NULL AND organization.enabled = 1
    AND actor.user_id = requested_actor.user_id AND ${actorPolicy}
)`

export async function listOrganizationMembers(
  database: Database,
  input: Scope & { includeGroups?: boolean },
): Promise<
  { status: 'success'; members: MemberRecord[] } | { status: 'not_found' }
> {
  if (!(await canRead(database, input))) return { status: 'not_found' }
  const rows = await database
    .prepare(
      `${actorCte}
    SELECT membership.id, membership.user_id AS userId, account.display_name AS name,
      membership.email AS emailNormalized, membership.status, membership.type,
      COALESCE((SELECT json_group_array(json_object('id', collection.id,
        'readOnly', grant_row.read_only, 'hidePasswords', grant_row.hide_passwords, 'manage', grant_row.manage))
        FROM collection_users grant_row JOIN collections collection ON collection.id = grant_row.collection_id
        WHERE grant_row.organization_user_id = membership.id AND collection.organization_id = membership.organization_id), '[]') AS collectionsJson,
      COALESCE((SELECT json_group_array(group_id) FROM (
        SELECT group_link.group_id FROM organization_group_users group_link
        JOIN organization_groups group_row ON group_row.id = group_link.group_id AND group_row.organization_id = group_link.organization_id
        WHERE group_link.organization_user_id = membership.id AND group_link.organization_id = membership.organization_id
        ORDER BY group_link.group_id)), '[]') AS groupsJson
    FROM organization_users membership LEFT JOIN users account ON account.id = membership.user_id
    WHERE membership.organization_id = ? AND ${readManager} ORDER BY membership.id
  `,
    )
    .bind(
      ...actorValues(input.actorUserId, input),
      input.organizationId,
      input.organizationId,
      input.actorUserId,
    )
    .all<
      Omit<OrganizationMembershipMemberRecord, 'collections'> & {
        collectionsJson: string
        groupsJson: string
      }
    >()
  return {
    status: 'success',
    members: rows.results.map(({ collectionsJson, groupsJson, ...row }) => ({
      ...row,
      ...(input.includeGroups
        ? { groups: JSON.parse(groupsJson) as string[] }
        : {}),
      collections: (
        JSON.parse(collectionsJson) as OrganizationMembershipCollectionGrant[]
      ).map((grant) => ({
        ...grant,
        readOnly: Boolean(grant.readOnly),
        hidePasswords: Boolean(grant.hidePasswords),
        manage: Boolean(grant.manage),
      })),
    })),
  }
}

export async function listOrganizationMemberPublicKeys(
  database: Database,
  input: Scope & { ids: string[] },
): Promise<
  | {
      status: 'success'
      publicKeys: { id: string; userId: string; publicKey: string }[]
    }
  | { status: 'not_found' }
> {
  if (!(await canRead(database, input))) return { status: 'not_found' }
  const rows = await database
    .prepare(
      `${actorCte}
    SELECT membership.id, membership.user_id AS userId, account.public_key AS publicKey FROM organization_users membership
    JOIN users account ON account.id = membership.user_id AND account.disabled_at IS NULL
    WHERE membership.organization_id = ? AND membership.status IN (1, 2)
      AND account.public_key IS NOT NULL AND membership.id IN (SELECT value FROM json_each(?))
      AND ${readManager} ORDER BY membership.id
  `,
    )
    .bind(
      ...actorValues(input.actorUserId, input),
      input.organizationId,
      JSON.stringify(input.ids),
      input.organizationId,
      input.actorUserId,
    )
    .all<{ id: string; userId: string; publicKey: string }>()
  if (rows.results.length !== input.ids.length) return { status: 'not_found' }
  return { status: 'success', publicKeys: rows.results }
}

export async function findOrganizationMemberForActor(
  database: Database,
  input: Scope & { membershipId: string; includeGroups?: boolean },
): Promise<
  { status: 'success'; member: MemberRecord } | { status: 'not_found' }
> {
  const row = await database
    .prepare(
      `${actorCte}
    SELECT membership.id, membership.user_id AS userId, account.display_name AS name,
      membership.email AS emailNormalized, membership.status, membership.type,
      COALESCE((SELECT json_group_array(json_object('id', collection.id,
        'readOnly', grant_row.read_only, 'hidePasswords', grant_row.hide_passwords, 'manage', grant_row.manage))
        FROM collection_users grant_row JOIN collections collection ON collection.id = grant_row.collection_id
        WHERE grant_row.organization_user_id = membership.id AND collection.organization_id = membership.organization_id), '[]') AS collectionsJson,
      COALESCE((SELECT json_group_array(group_id) FROM (
        SELECT group_link.group_id FROM organization_group_users group_link
        JOIN organization_groups group_row ON group_row.id = group_link.group_id AND group_row.organization_id = group_link.organization_id
        WHERE group_link.organization_user_id = membership.id AND group_link.organization_id = membership.organization_id
        ORDER BY group_link.group_id)), '[]') AS groupsJson
    FROM organization_users membership LEFT JOIN users account ON account.id = membership.user_id
    WHERE membership.organization_id = ? AND membership.id = ? AND ${readManager}
  `,
    )
    .bind(
      ...actorValues(input.actorUserId, input),
      input.organizationId,
      input.membershipId,
      input.organizationId,
      input.actorUserId,
    )
    .first<
      Omit<OrganizationMembershipMemberRecord, 'collections'> & {
        collectionsJson: string
        groupsJson: string
      }
    >()
  if (!row) return { status: 'not_found' }
  const { collectionsJson, groupsJson, ...record } = row
  return {
    status: 'success',
    member: {
      ...record,
      ...(input.includeGroups
        ? { groups: JSON.parse(groupsJson) as string[] }
        : {}),
      collections: (
        JSON.parse(collectionsJson) as OrganizationMembershipCollectionGrant[]
      ).map((grant) => ({
        ...grant,
        readOnly: Boolean(grant.readOnly),
        hidePasswords: Boolean(grant.hidePasswords),
        manage: Boolean(grant.manage),
      })),
    },
  }
}

export async function findOrganizationUserPublicKeyForActor(
  database: Database,
  input: SessionContext & { actorUserId: string; userId: string },
): Promise<
  | { status: 'success'; userId: string; publicKey: string }
  | { status: 'not_found' }
> {
  const row = await database
    .prepare(
      `${actorCte}
    SELECT recipient_account.id AS userId, recipient_account.public_key AS publicKey
    FROM users recipient_account
    WHERE recipient_account.id = ? AND recipient_account.disabled_at IS NULL AND recipient_account.public_key IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM organization_users recipient
        JOIN organizations organization ON organization.id = recipient.organization_id AND organization.enabled = 1
        JOIN organization_users actor ON actor.organization_id = recipient.organization_id
        JOIN users actor_account ON actor_account.id = actor.user_id AND actor_account.disabled_at IS NULL
        CROSS JOIN requested_actor
        WHERE recipient.user_id = recipient_account.id AND recipient.status IN (1, 2) AND recipient.type IN (0, 1, 2)
          AND actor.user_id = ? AND actor.status = 2 AND (actor.type = 0 OR (actor.type = 1 AND recipient.type = 2))
          AND actor.user_id = requested_actor.user_id AND ${actorPolicy}
      )
  `,
    )
    .bind(
      ...actorValues(input.actorUserId, input),
      input.userId,
      input.actorUserId,
    )
    .first<{ userId: string; publicKey: string }>()
  return row ? { status: 'success', ...row } : { status: 'not_found' }
}

export async function insertOrganizationMemberInvites(
  database: Database,
  input: Scope & {
    now: string
    type: OrganizationMembershipRole
    collections: OrganizationMembershipCollectionGrant[]
    invites: {
      id: string
      emailNormalized: string
      inviteTokenHash: string
      inviteExpiresAt: string
    }[]
    auditEvents: AuditEvent[]
  },
): Promise<Result | { status: 'conflict' }> {
  if (
    input.invites.length < 1 ||
    input.invites.length > 20 ||
    input.auditEvents.length !== input.invites.length
  )
    throw new Error('Organization invite batch bounds or audit count invalid.')
  const auditIds = input.auditEvents.map(() => crypto.randomUUID())
  const invitesJson = JSON.stringify(
    input.invites.map((invite, index) => ({
      ...invite,
      mutationId: auditIds[index],
    })),
  )
  const grantsJson = JSON.stringify(input.collections)
  const mutation = database
    .prepare(
      `${actorCte}
    INSERT INTO organization_users (id, organization_id, email, type, status, created_at, updated_at, invite_token_hash, invite_expires_at, last_membership_mutation_id)
    SELECT json_extract(invite.value, '$.id'), ?, json_extract(invite.value, '$.emailNormalized'), ?, 0, ?, ?,
      json_extract(invite.value, '$.inviteTokenHash'), json_extract(invite.value, '$.inviteExpiresAt'), json_extract(invite.value, '$.mutationId')
    FROM json_each(?) invite
    WHERE EXISTS (SELECT 1 FROM organization_users actor
      JOIN users account ON account.id = actor.user_id AND account.disabled_at IS NULL
      JOIN organizations organization ON organization.id = actor.organization_id AND organization.enabled = 1
      CROSS JOIN requested_actor
      WHERE actor.organization_id = ? AND actor.user_id = ? AND actor.status = 2
        AND (actor.type = 0 OR (actor.type = 1 AND ? = 2))
        AND actor.user_id = requested_actor.user_id AND ${actorPolicy})
      AND NOT EXISTS (SELECT 1 FROM json_each(?) requested
        LEFT JOIN collections collection ON collection.id = json_extract(requested.value, '$.id') AND collection.organization_id = ?
        WHERE collection.id IS NULL)
      AND NOT EXISTS (SELECT 1 FROM organization_users existing JOIN json_each(?) candidate
        ON existing.email = json_extract(candidate.value, '$.emailNormalized') WHERE existing.organization_id = ?)
  `,
    )
    .bind(
      ...actorValues(input.actorUserId, input),
      input.organizationId,
      input.type,
      input.now,
      input.now,
      invitesJson,
      input.organizationId,
      input.actorUserId,
      input.type,
      grantsJson,
      input.organizationId,
      invitesJson,
      input.organizationId,
    )
  const statements = [mutation]
  for (const [index, event] of input.auditEvents.entries()) {
    const condition =
      index === 0
        ? `changes() = ${input.invites.length}`
        : `EXISTS (SELECT 1 FROM audit_events WHERE id = '${auditIds[0]}')`
    statements.push(
      auditStatement(database, event, auditIds[index]!, condition),
    )
  }
  const marker = auditIds[0]!
  const markedCount = `(SELECT COUNT(*) FROM organization_users membership
    JOIN json_each(?) candidate ON membership.id = json_extract(candidate.value, '$.id')
      AND membership.last_membership_mutation_id = json_extract(candidate.value, '$.mutationId')
    WHERE membership.organization_id = ?)`
  statements.push(
    assertion(
      database,
      `${markedCount} = 0 OR (${markedCount} = ?
      AND (SELECT COUNT(*) FROM audit_events WHERE id IN (SELECT value FROM json_each(?))) = ?)`,
      [
        invitesJson,
        input.organizationId,
        invitesJson,
        input.organizationId,
        input.invites.length,
        JSON.stringify(auditIds),
        input.invites.length,
      ],
    ),
    database
      .prepare(
        `
    INSERT INTO collection_users (collection_id, organization_user_id, read_only, hide_passwords, manage)
    SELECT json_extract(grant_row.value, '$.id'), json_extract(invite.value, '$.id'),
      json_extract(grant_row.value, '$.readOnly'), json_extract(grant_row.value, '$.hidePasswords'), json_extract(grant_row.value, '$.manage')
    FROM json_each(?) grant_row CROSS JOIN json_each(?) invite WHERE EXISTS (SELECT 1 FROM audit_events WHERE id = ?)
  `,
      )
      .bind(grantsJson, invitesJson, marker),
    assertion(
      database,
      'NOT EXISTS (SELECT 1 FROM audit_events WHERE id = ?) OR changes() = ?',
      [marker, input.collections.length * input.invites.length],
    ),
    revisionStatement(database, input.organizationId, input.now, marker),
    assertion(
      database,
      'NOT EXISTS (SELECT 1 FROM audit_events WHERE id = ?) OR changes() = 1',
      [marker],
    ),
  )
  try {
    const results = await database.batch(statements)
    assertBatch(results, statements.length)
    if (
      results[0]?.meta.changes === input.invites.length &&
      results
        .slice(1, 1 + input.invites.length)
        .some((result) => result.meta.changes !== 1)
    )
      throw new Error('Organization invitation audit did not fully apply.')
    if (results[0]?.meta.changes === input.invites.length)
      return { status: 'success' }
    return (await canRead(database, input))
      ? { status: 'conflict' }
      : { status: 'not_found' }
  } catch (error) {
    if (String(error).includes('UNIQUE constraint failed: organization_users.'))
      return { status: 'conflict' }
    throw error
  }
}

export async function acceptOrganizationMemberInvite(
  database: Database,
  input: SessionContext & {
    organizationId: string
    membershipId: string
    userId: string
    emailNormalized: string
    inviteTokenHash: string
    now: string
    auditEvent: AuditEvent
  },
): Promise<Result> {
  const mutationId = crypto.randomUUID()
  const mutation = database
    .prepare(
      `${actorCte}
    UPDATE organization_users SET user_id = ?, status = 1, invite_token_hash = NULL, invite_expires_at = NULL, updated_at = ?, last_membership_mutation_id = ?
    WHERE id = ? AND organization_id = ? AND status = 0 AND email = ? AND invite_token_hash = ? AND invite_expires_at > ?
      AND EXISTS (SELECT 1 FROM users account WHERE account.id = ? AND account.email_normalized = organization_users.email AND account.disabled_at IS NULL)
      AND EXISTS (SELECT 1 FROM organizations organization WHERE organization.id = organization_users.organization_id AND organization.enabled = 1)
      AND EXISTS (SELECT 1 FROM requested_actor WHERE ${activeActorFamily} AND ${organizationPolicyAllowsSql(
        {
          organizationId: 'organization_users.organization_id',
          userId: 'requested_actor.user_id',
          sessionId: 'requested_actor.session_id',
          deviceIdentifier: 'requested_actor.device_identifier',
        },
      )})
      AND NOT EXISTS (SELECT 1 FROM organization_users existing WHERE existing.organization_id = organization_users.organization_id AND existing.user_id = ? AND existing.id <> organization_users.id)
  `,
    )
    .bind(
      ...actorValues(input.userId, input),
      input.userId,
      input.now,
      mutationId,
      input.membershipId,
      input.organizationId,
      input.emailNormalized,
      input.inviteTokenHash,
      input.now,
      input.userId,
      input.userId,
    )
  return runMutation(database, mutation, input, mutationId)
}

export async function confirmOrganizationMember(
  database: Database,
  input: Mutation & { keyEncrypted: string },
): Promise<Result> {
  const mutationId = crypto.randomUUID()
  const mutation = database
    .prepare(
      `${actorCte}
    UPDATE organization_users SET status = 2, org_key = ?, updated_at = ?, last_membership_mutation_id = ?
    WHERE id = ? AND organization_id = ? AND status = 1 AND org_key IS NULL AND ${manager}
      AND EXISTS (SELECT 1 FROM users recipient WHERE recipient.id = organization_users.user_id AND recipient.disabled_at IS NULL AND recipient.email_normalized = organization_users.email
        AND ${organizationTotpEnrollmentAllowsSql({
          organizationId: 'organization_users.organization_id',
          userId: 'recipient.id',
        })})
  `,
    )
    .bind(
      ...actorValues(input.actorUserId, input),
      input.keyEncrypted,
      input.now,
      mutationId,
      input.membershipId,
      input.organizationId,
      input.organizationId,
      input.actorUserId,
    )
  return runMutation(database, mutation, input, mutationId)
}

export async function updateOrganizationMember(
  database: Database,
  input: Mutation & {
    type: OrganizationMembershipRole
    collections: OrganizationMembershipCollectionGrant[]
  },
): Promise<Result> {
  const mutationId = crypto.randomUUID()
  const grantsJson = JSON.stringify(input.collections)
  const mutation = database
    .prepare(
      `${actorCte}
    UPDATE organization_users SET type = ?, permissions = NULL, updated_at = ?, last_membership_mutation_id = ?
    WHERE id = ? AND organization_id = ? AND status IN (0, 1, 2) AND ${manager}
      AND (? = 2 OR EXISTS (SELECT 1 FROM organization_users actor WHERE actor.organization_id = organization_users.organization_id AND actor.user_id = ? AND actor.status = 2 AND actor.type = 0))
      AND (type <> 0 OR status <> 2 OR ? = 0 OR ${enabledOwner})
      AND NOT EXISTS (SELECT 1 FROM json_each(?) requested LEFT JOIN collections collection
        ON collection.id = json_extract(requested.value, '$.id') AND collection.organization_id = organization_users.organization_id WHERE collection.id IS NULL)
  `,
    )
    .bind(
      ...actorValues(input.actorUserId, input),
      input.type,
      input.now,
      mutationId,
      input.membershipId,
      input.organizationId,
      input.organizationId,
      input.actorUserId,
      input.type,
      input.actorUserId,
      input.type,
      grantsJson,
    )
  return runMutation(database, mutation, input, mutationId, input.collections)
}

export async function revokeOrganizationMember(
  database: Database,
  input: Mutation,
): Promise<Result> {
  const mutationId = crypto.randomUUID()
  const mutation = database
    .prepare(
      `${actorCte}
    UPDATE organization_users SET status = -1, org_key = NULL, invite_token_hash = NULL, invite_expires_at = NULL, updated_at = ?, last_membership_mutation_id = ?
    WHERE id = ? AND organization_id = ? AND status IN (0, 1, 2) AND ${manager}
      AND (type <> 0 OR status <> 2 OR ${enabledOwner})
  `,
    )
    .bind(
      ...actorValues(input.actorUserId, input),
      input.now,
      mutationId,
      input.membershipId,
      input.organizationId,
      input.organizationId,
      input.actorUserId,
    )
  return runMutation(database, mutation, input, mutationId, [], false, true)
}

export async function removeOrganizationMember(
  database: Database,
  input: Mutation,
): Promise<Result> {
  const mutationId = crypto.randomUUID()
  // Keep the recipient binding until its polling revision has advanced in this batch.
  const mutation = database
    .prepare(
      `${actorCte} UPDATE organization_users SET status = -1, org_key = NULL,
    invite_token_hash = NULL, invite_expires_at = NULL, updated_at = ?, last_membership_mutation_id = ?
    WHERE id = ? AND organization_id = ? AND ${manager} AND (type <> 0 OR status <> 2 OR ${enabledOwner})
  `,
    )
    .bind(
      ...actorValues(input.actorUserId, input),
      input.now,
      mutationId,
      input.membershipId,
      input.organizationId,
      input.organizationId,
      input.actorUserId,
    )
  return runMutation(database, mutation, input, mutationId, [], true, true)
}

export async function reinviteOrganizationMember(
  database: Database,
  input: Mutation & {
    inviteTokenHash: string
    inviteExpiresAt: string
    emailNormalized: string
  },
): Promise<Result> {
  const mutationId = crypto.randomUUID()
  const mutation = database
    .prepare(
      `${actorCte} UPDATE organization_users SET status = 0, user_id = NULL, org_key = NULL,
    invite_token_hash = ?, invite_expires_at = ?, updated_at = ?, last_membership_mutation_id = ?
    WHERE id = ? AND organization_id = ? AND status = 0 AND email = ? AND ${manager}
  `,
    )
    .bind(
      ...actorValues(input.actorUserId, input),
      input.inviteTokenHash,
      input.inviteExpiresAt,
      input.now,
      mutationId,
      input.membershipId,
      input.organizationId,
      input.emailNormalized,
      input.organizationId,
      input.actorUserId,
    )
  return runMutation(database, mutation, input, mutationId)
}

async function canRead(database: Database, input: Scope): Promise<boolean> {
  return Boolean(
    await database
      .prepare(`${actorCte} SELECT 1 AS allowed WHERE ${readManager}`)
      .bind(
        ...actorValues(input.actorUserId, input),
        input.organizationId,
        input.actorUserId,
      )
      .first(),
  )
}

async function runMutation(
  database: Database,
  mutation: D1PreparedStatement,
  input: {
    organizationId: string
    membershipId: string
    now: string
    auditEvent: AuditEvent
  },
  auditId: string,
  grants?: OrganizationMembershipCollectionGrant[],
  remove = false,
  clearGroups = false,
): Promise<Result> {
  const statements = [
    mutation,
    auditStatement(database, input.auditEvent, auditId, 'changes() = 1'),
    assertion(
      database,
      `NOT EXISTS (SELECT 1 FROM organization_users WHERE id = ? AND organization_id = ?
      AND last_membership_mutation_id = ?) OR EXISTS (SELECT 1 FROM audit_events WHERE id = ?)`,
      [input.membershipId, input.organizationId, auditId, auditId],
    ),
  ]
  if (grants !== undefined) {
    statements.push(
      database
        .prepare(
          `DELETE FROM collection_users WHERE organization_user_id = ?
      AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?)`,
        )
        .bind(input.membershipId, auditId),
    )
    statements.push(
      database
        .prepare(
          `
      INSERT INTO collection_users (collection_id, organization_user_id, read_only, hide_passwords, manage)
      SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.readOnly'), json_extract(value, '$.hidePasswords'), json_extract(value, '$.manage')
      FROM json_each(?) WHERE EXISTS (SELECT 1 FROM audit_events WHERE id = ?)
    `,
        )
        .bind(input.membershipId, JSON.stringify(grants), auditId),
      assertion(
        database,
        `NOT EXISTS (SELECT 1 FROM audit_events WHERE id = ?) OR
        (changes() = ? AND (SELECT COUNT(*) FROM collection_users WHERE organization_user_id = ?) = ?)`,
        [auditId, grants.length, input.membershipId, grants.length],
      ),
    )
  }
  statements.push(
    revisionStatement(database, input.organizationId, input.now, auditId),
    assertion(
      database,
      'NOT EXISTS (SELECT 1 FROM audit_events WHERE id = ?) OR changes() = 1',
      [auditId],
    ),
  )
  statements.push(
    database
      .prepare(
        `
    UPDATE users SET revision_date = strftime('%Y-%m-%dT%H:%M:%fZ', MAX(
      users.revision_date, ?,
      COALESCE((SELECT MAX(revision_date) FROM folders WHERE user_id = users.id), users.revision_date),
      COALESCE((SELECT MAX(revision_date) FROM ciphers WHERE user_id = users.id AND organization_id IS NULL), users.revision_date),
      COALESCE((SELECT MAX(organization.revision_date) FROM organizations organization JOIN organization_users membership
        ON membership.organization_id = organization.id WHERE membership.user_id = users.id), users.revision_date),
      COALESCE((SELECT MAX(cipher.revision_date) FROM ciphers cipher JOIN organization_users membership
        ON membership.organization_id = cipher.organization_id WHERE membership.user_id = users.id), users.revision_date)
    ), '+0.001 seconds')
    WHERE id = (SELECT user_id FROM organization_users WHERE id = ? AND organization_id = ?)
      AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?)
  `,
      )
      .bind(input.now, input.membershipId, input.organizationId, auditId),
    assertion(
      database,
      `NOT EXISTS (SELECT 1 FROM audit_events WHERE id = ?) OR changes() =
      (SELECT COUNT(*) FROM users WHERE id = (SELECT user_id FROM organization_users WHERE id = ? AND organization_id = ?))`,
      [auditId, input.membershipId, input.organizationId],
    ),
  )
  if (clearGroups) {
    statements.push(
      database
        .prepare(
          `DELETE FROM organization_group_users
        WHERE organization_user_id = ? AND organization_id = ?
          AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?)`,
        )
        .bind(input.membershipId, input.organizationId, auditId),
      assertion(
        database,
        `NOT EXISTS (SELECT 1 FROM audit_events WHERE id = ?) OR NOT EXISTS (
        SELECT 1 FROM organization_group_users WHERE organization_user_id = ? AND organization_id = ?)`,
        [auditId, input.membershipId, input.organizationId],
      ),
    )
  }
  if (remove) {
    statements.push(
      database
        .prepare(
          `DELETE FROM organization_users
    WHERE id = ? AND organization_id = ? AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?) RETURNING id`,
        )
        .bind(input.membershipId, input.organizationId, auditId),
      assertion(
        database,
        `NOT EXISTS (SELECT 1 FROM audit_events WHERE id = ?) OR NOT EXISTS (
        SELECT 1 FROM organization_users WHERE id = ? AND organization_id = ?)`,
        [auditId, input.membershipId, input.organizationId],
      ),
    )
  }
  const results = await database.batch(statements)
  assertBatch(results, statements.length)
  if (results[0]?.meta.changes === 1 && results[1]?.meta.changes !== 1)
    throw new Error('Organization membership audit did not fully apply.')
  if (
    remove &&
    results[1]?.meta.changes === 1 &&
    results.at(-2)?.results.length !== 1
  )
    throw new Error('Organization membership removal did not fully apply.')
  // The audit INSERT reports one direct row; DELETE meta.changes includes FK cascades.
  return { status: results[1]?.meta.changes === 1 ? 'success' : 'not_found' }
}

function actorValues(userId: string, input: SessionContext): (string | null)[] {
  return [userId, input.sessionId ?? null, input.deviceIdentifier ?? null]
}

function assertion(
  database: Database,
  condition: string,
  values: unknown[],
): D1PreparedStatement {
  return database
    .prepare(
      `SELECT CASE WHEN ${condition} THEN 1 ELSE json('organization membership batch invariant failed') END AS valid`,
    )
    .bind(...values)
}

function revisionStatement(
  database: Database,
  organizationId: string,
  now: string,
  auditId: string,
): D1PreparedStatement {
  return database
    .prepare(
      `UPDATE organizations SET revision_date = strftime('%Y-%m-%dT%H:%M:%fZ', MAX(revision_date, ?), '+0.001 seconds'), updated_at = ?
    WHERE id = ? AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?)`,
    )
    .bind(now, now, organizationId, auditId)
}

function assertBatch(results: D1Result[], expected: number): void {
  if (results.length !== expected || results.some((result) => !result.success))
    throw new Error('Organization membership batch did not fully apply.')
}

function auditStatement(
  database: Database,
  event: AuditEvent,
  id: string,
  condition: string,
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO audit_events (id, schema_version, name, outcome, request_id, occurred_at,
    actor_user_id, actor_device_identifier, target_type, target_id, context_json)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${condition}`,
    )
    .bind(
      id,
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
    )
}

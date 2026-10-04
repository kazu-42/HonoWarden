import {
  organizationPolicyAllowsSql,
  type OrganizationPolicyActor,
} from './organization-policy-sql'

export type OrganizationAccessContext = {
  actor?: OrganizationPolicyActor | undefined
}

// Bind caller identity once. An explicit session is always checked, including
// policy-free organizations; mismatched actors cannot use the legacy path.
export function organizationAccessActorValues(
  userId: string,
  actor?: OrganizationPolicyActor,
): [string, string | null, string | null, number] {
  return [
    userId,
    actor?.userId === userId ? actor.sessionId : null,
    actor?.userId === userId ? actor.deviceIdentifier : null,
    actor === undefined ? 0 : 1,
  ]
}

export const organizationAccessActorCte = `
  requested_actor AS (
    SELECT ? AS user_id, ? AS session_id, ? AS device_identifier,
      ? AS actor_provided
  ),
  active_organization_actor AS (
    SELECT requested_actor.*
    FROM requested_actor
    INNER JOIN users active_account
      ON active_account.id = requested_actor.user_id
      AND active_account.disabled_at IS NULL
    WHERE requested_actor.actor_provided = 0 OR EXISTS (
      SELECT 1 FROM devices active_session
      WHERE active_session.user_id = requested_actor.user_id
        AND active_session.identifier = requested_actor.device_identifier
        AND active_session.session_id = requested_actor.session_id
        AND active_session.revoked_at IS NULL
    )
  )
`

export const organizationCollectionAccessCtes = `
  ${organizationAccessActorCte},
  confirmed_memberships AS (
    SELECT membership.id AS organizationUserId,
      membership.organization_id AS organizationId,
      membership.user_id AS userId, membership.type,
      membership.org_key AS orgKey, membership.permissions
    FROM organization_users membership
    INNER JOIN organizations organization
      ON organization.id = membership.organization_id
      AND organization.enabled = 1
    INNER JOIN active_organization_actor requested_actor
      ON requested_actor.user_id = membership.user_id
    WHERE membership.status = 2 AND membership.type IN (0, 1, 2)
      AND ${organizationPolicyAllowsSql({
        organizationId: 'organization.id',
        userId: 'membership.user_id',
        sessionId: 'requested_actor.session_id',
        deviceIdentifier: 'requested_actor.device_identifier',
      })}
  ),
  organization_collection_grants AS (
    SELECT collection.id AS collectionId,
      collection.organization_id AS organizationId,
      membership.organizationUserId,
      assignment.read_only AS readOnly,
      assignment.hide_passwords AS hidePasswords, assignment.manage
    FROM confirmed_memberships membership
    INNER JOIN collection_users assignment
      ON assignment.organization_user_id = membership.organizationUserId
    INNER JOIN collections collection
      ON collection.id = assignment.collection_id
      AND collection.organization_id = membership.organizationId
    UNION ALL
    SELECT collection.id AS collectionId,
      collection.organization_id AS organizationId,
      membership.organizationUserId,
      assignment.read_only AS readOnly,
      assignment.hide_passwords AS hidePasswords, assignment.manage
    FROM confirmed_memberships membership
    INNER JOIN organization_group_users group_member
      ON group_member.organization_user_id = membership.organizationUserId
      AND group_member.organization_id = membership.organizationId
    INNER JOIN organization_groups organization_group
      ON organization_group.id = group_member.group_id
      AND organization_group.organization_id = membership.organizationId
    INNER JOIN collection_groups assignment
      ON assignment.group_id = organization_group.id
      AND assignment.organization_id = membership.organizationId
    INNER JOIN collections collection
      ON collection.id = assignment.collection_id
      AND collection.organization_id = membership.organizationId
  ),
  accessible_organization_collections AS (
    SELECT collectionId, organizationId, organizationUserId,
      MIN(readOnly) AS readOnly, MIN(hidePasswords) AS hidePasswords,
      MAX(manage) AS manage
    FROM organization_collection_grants
    GROUP BY collectionId, organizationId, organizationUserId
  )
`

export const organizationCollectionAccessCte = `
  WITH ${organizationCollectionAccessCtes}
`

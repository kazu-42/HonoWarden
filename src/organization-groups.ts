import { buildAuditEvent, type AuditEventName } from './domain/audit'
import {
  organizationGroupEtag,
  parseOrganizationGroupWriteRequest,
  projectOrganizationGroup,
} from './domain/organization-groups'
import {
  createOrganizationGroup as createGroup,
  deleteOrganizationGroup as deleteGroup,
  findOrganizationGroup,
  listOrganizationGroups as listGroups,
  removeOrganizationGroupMember as removeMember,
  updateOrganizationGroup as updateGroup,
  type OrganizationGroupScope,
} from './repositories/organization-groups-repository'

export type OrganizationGroupInput = OrganizationGroupScope & {
  groupId: string
  requestId: string
  now: string
  expectedRevisionDate?: string
}
export type OrganizationGroupResult =
  | { status: 'success'; body?: unknown; etag?: string }
  | { status: 'invalid_request' | 'not_found' | 'conflict' }

export async function listOrganizationGroups(
  database: D1Database,
  input: OrganizationGroupScope & { details: boolean },
): Promise<OrganizationGroupResult> {
  const result = await listGroups(database, input)
  if (result.status !== 'success') return result
  return {
    status: 'success',
    body: {
      object: 'list',
      data: result.groups.map((group) =>
        projectOrganizationGroup(group, input.details),
      ),
      continuationToken: null,
    },
  }
}

export async function readOrganizationGroup(
  database: D1Database,
  input: OrganizationGroupScope & {
    groupId: string
    details: boolean
    users: boolean
  },
): Promise<OrganizationGroupResult> {
  const group = await findOrganizationGroup(database, input)
  if (!group) return { status: 'not_found' }
  return {
    status: 'success',
    body: input.users
      ? group.users
      : projectOrganizationGroup(group, input.details),
    etag: organizationGroupEtag(group),
  }
}

export async function createOrganizationGroup(
  database: D1Database,
  input: OrganizationGroupInput & { body: unknown },
): Promise<OrganizationGroupResult> {
  const request = parseOrganizationGroupWriteRequest(input.body)
  if (!request.ok) return { status: 'invalid_request' }
  const groupId = crypto.randomUUID()
  const mutation = { ...input, groupId }
  const result = await createGroup(database, {
    ...mutation,
    ...request.value,
    auditEvent: audit(mutation, 'organization.group.create', {
      memberCount: request.value.users.length,
      assignmentCount: request.value.collections.length,
    }),
  })
  return result.status === 'success'
    ? readAfterWrite(database, mutation)
    : result
}

export async function updateOrganizationGroup(
  database: D1Database,
  input: OrganizationGroupInput & { body: unknown },
): Promise<OrganizationGroupResult> {
  const request = parseOrganizationGroupWriteRequest(input.body)
  if (!request.ok) return { status: 'invalid_request' }
  const result = await updateGroup(database, {
    ...input,
    ...request.value,
    auditEvent: audit(input, 'organization.group.update', {
      memberCount: request.value.users.length,
      assignmentCount: request.value.collections.length,
    }),
  })
  return result.status === 'success' ? readAfterWrite(database, input) : result
}

export async function deleteOrganizationGroup(
  database: D1Database,
  input: OrganizationGroupInput,
): Promise<OrganizationGroupResult> {
  return deleteGroup(database, {
    ...input,
    auditEvent: audit(input, 'organization.group.delete'),
  })
}

export async function removeOrganizationGroupMember(
  database: D1Database,
  input: OrganizationGroupInput & { membershipId: string },
): Promise<OrganizationGroupResult> {
  return removeMember(database, {
    ...input,
    auditEvent: audit(input, 'organization.group.member.remove', {
      membershipId: input.membershipId,
    }),
  })
}

async function readAfterWrite(
  database: D1Database,
  input: OrganizationGroupInput,
): Promise<OrganizationGroupResult> {
  const group = await findOrganizationGroup(database, input)
  if (!group)
    throw new Error('Committed organization group could not be read back.')
  return {
    status: 'success',
    body: projectOrganizationGroup(group),
    etag: organizationGroupEtag(group),
  }
}

function audit(
  input: OrganizationGroupInput,
  name: AuditEventName,
  context?: Record<string, string | number | boolean>,
) {
  return buildAuditEvent({
    name,
    outcome: 'success',
    requestId: input.requestId,
    occurredAt: input.now,
    actor: {
      userId: input.actor.userId,
      deviceIdentifier: input.actor.deviceIdentifier,
    },
    target: { type: 'organization_group', id: input.groupId },
    context: { organizationId: input.organizationId, ...context },
  })
}

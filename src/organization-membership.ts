import { buildAuditEvent, type AuditEventName } from './domain/audit'
import {
  buildOrganizationMembershipInviteTokenHash,
  generateOrganizationMembershipInviteToken,
  organizationMembershipInviteExpiresAt,
  parseOrganizationMembershipAcceptRequest,
  parseOrganizationMembershipConfirmRequest,
  parseOrganizationMembershipIdsRequest,
  parseOrganizationMembershipInviteRequest,
  parseOrganizationMembershipUpdateRequest,
  projectOrganizationMembershipMember,
  projectOrganizationMembershipPublicKey,
} from './domain/organization-membership'
import {
  acceptOrganizationMemberInvite,
  confirmOrganizationMember as confirmMember,
  insertOrganizationMemberInvites,
  findOrganizationMemberForActor,
  findOrganizationUserPublicKeyForActor,
  listOrganizationMembers as listMembers,
  listOrganizationMemberPublicKeys,
  reinviteOrganizationMember as reinviteMember,
  removeOrganizationMember as removeMember,
  revokeOrganizationMember as revokeMember,
  updateOrganizationMember as updateMember,
} from './repositories/organization-membership-repository'

export type OrganizationMembershipActor = {
  userId: string
  emailNormalized: string
}
export type OrganizationMembershipDelivery = {
  recipientEmail: string
  token: string
  organizationId: string
  membershipId: string
  expiresAt: string
}
export type OrganizationMembershipDeliveryAdapter = (
  delivery: OrganizationMembershipDelivery,
) => Promise<void>
export type OrganizationMembershipResult =
  | { status: 'success'; body?: Record<string, unknown> }
  | { status: 'delivery_unavailable'; membershipIds: string[] }
  | {
      status:
        'invalid_request' | 'unsupported_feature' | 'not_found' | 'conflict'
    }
type MembershipInput = {
  actor: OrganizationMembershipActor
  organizationId: string
  membershipId: string
  requestId: string
  now: string
}
type InvitationInput = MembershipInput & {
  inviteSecret: string
  delivery: OrganizationMembershipDeliveryAdapter
}

export async function inviteOrganizationMembers(
  database: D1Database,
  input: InvitationInput & { body: unknown },
): Promise<OrganizationMembershipResult> {
  const request = parseOrganizationMembershipInviteRequest(input.body)
  if (!request.ok) return { status: request.code }
  const expiresAt = organizationMembershipInviteExpiresAt(input.now)
  const deliveries: OrganizationMembershipDelivery[] = []
  const invites = await Promise.all(
    request.value.emailsNormalized.map(async (emailNormalized) => {
      const id = crypto.randomUUID()
      const token = generateOrganizationMembershipInviteToken()
      deliveries.push({
        recipientEmail: emailNormalized,
        token,
        organizationId: input.organizationId,
        membershipId: id,
        expiresAt,
      })
      return {
        id,
        emailNormalized,
        inviteExpiresAt: expiresAt,
        inviteTokenHash: await buildOrganizationMembershipInviteTokenHash({
          secret: input.inviteSecret,
          organizationId: input.organizationId,
          membershipId: id,
          emailNormalized,
          token,
        }),
      }
    }),
  )
  const result = await insertOrganizationMemberInvites(database, {
    organizationId: input.organizationId,
    actorUserId: input.actor.userId,
    now: input.now,
    type: request.value.type,
    collections: request.value.collections,
    invites,
    auditEvents: invites.map((invite) =>
      audit(input, 'organization.member.invite', invite.id, {
        type: request.value.type,
        toStatus: 0,
      }),
    ),
  })
  if (result.status !== 'success') return result
  // The database batch is atomic. External delivery cannot join that transaction;
  // any transport failure returns 503 while committed invites remain reinvitable.
  try {
    for (const delivery of deliveries) await input.delivery(delivery)
  } catch {
    return {
      status: 'delivery_unavailable',
      membershipIds: invites.map((invite) => invite.id),
    }
  }
  return { status: 'success' }
}

export async function reinviteOrganizationMember(
  database: D1Database,
  input: InvitationInput,
): Promise<OrganizationMembershipResult> {
  const row = await database
    .prepare(
      'SELECT email AS emailNormalized FROM organization_users WHERE id = ? AND organization_id = ? AND status = 0',
    )
    .bind(input.membershipId, input.organizationId)
    .first<{ emailNormalized: string }>()
  if (!row) return { status: 'not_found' }
  const token = generateOrganizationMembershipInviteToken()
  const expiresAt = organizationMembershipInviteExpiresAt(input.now)
  const inviteTokenHash = await buildOrganizationMembershipInviteTokenHash({
    secret: input.inviteSecret,
    organizationId: input.organizationId,
    membershipId: input.membershipId,
    emailNormalized: row.emailNormalized,
    token,
  })
  const result = await reinviteMember(database, {
    ...mutation(input),
    emailNormalized: row.emailNormalized,
    inviteTokenHash,
    inviteExpiresAt: expiresAt,
    auditEvent: audit(
      input,
      'organization.member.reinvite',
      input.membershipId,
      { toStatus: 0 },
    ),
  })
  if (result.status !== 'success') return result
  try {
    await input.delivery({
      recipientEmail: row.emailNormalized,
      token,
      organizationId: input.organizationId,
      membershipId: input.membershipId,
      expiresAt,
    })
  } catch {
    return {
      status: 'delivery_unavailable',
      membershipIds: [input.membershipId],
    }
  }
  return { status: 'success' }
}

export async function acceptOrganizationMember(
  database: D1Database,
  input: MembershipInput & { inviteSecret: string; body: unknown },
): Promise<OrganizationMembershipResult> {
  const request = parseOrganizationMembershipAcceptRequest(input.body)
  if (!request.ok) return { status: request.code }
  const inviteTokenHash = await buildOrganizationMembershipInviteTokenHash({
    secret: input.inviteSecret,
    organizationId: input.organizationId,
    membershipId: input.membershipId,
    emailNormalized: input.actor.emailNormalized,
    token: request.value.token,
  })
  return acceptOrganizationMemberInvite(database, {
    organizationId: input.organizationId,
    membershipId: input.membershipId,
    userId: input.actor.userId,
    emailNormalized: input.actor.emailNormalized,
    inviteTokenHash,
    now: input.now,
    auditEvent: audit(input, 'organization.member.accept', input.membershipId, {
      fromStatus: 0,
      toStatus: 1,
    }),
  })
}

export async function confirmOrganizationMember(
  database: D1Database,
  input: MembershipInput & { body: unknown },
): Promise<OrganizationMembershipResult> {
  const request = parseOrganizationMembershipConfirmRequest(input.body)
  if (!request.ok) return { status: request.code }
  return confirmMember(database, {
    ...mutation(input),
    keyEncrypted: request.value.keyEncrypted,
    auditEvent: audit(
      input,
      'organization.member.confirm',
      input.membershipId,
      { fromStatus: 1, toStatus: 2 },
    ),
  })
}

export async function updateOrganizationMember(
  database: D1Database,
  input: MembershipInput & { body: unknown },
): Promise<OrganizationMembershipResult> {
  const request = parseOrganizationMembershipUpdateRequest(input.body)
  if (!request.ok) return { status: request.code }
  return updateMember(database, {
    ...mutation(input),
    ...request.value,
    auditEvent: audit(input, 'organization.member.update', input.membershipId, {
      type: request.value.type,
      assignmentCount: request.value.collections.length,
    }),
  })
}

export async function revokeOrganizationMember(
  database: D1Database,
  input: MembershipInput,
): Promise<OrganizationMembershipResult> {
  return revokeMember(database, {
    ...mutation(input),
    auditEvent: audit(input, 'organization.member.revoke', input.membershipId, {
      toStatus: -1,
    }),
  })
}

export async function removeOrganizationMember(
  database: D1Database,
  input: MembershipInput,
): Promise<OrganizationMembershipResult> {
  return removeMember(database, {
    ...mutation(input),
    auditEvent: audit(input, 'organization.member.remove', input.membershipId),
  })
}

export async function listOrganizationMembers(
  database: D1Database,
  input: MembershipInput & { includeCollections: boolean },
): Promise<OrganizationMembershipResult> {
  const result = await listMembers(database, {
    organizationId: input.organizationId,
    actorUserId: input.actor.userId,
  })
  if (result.status !== 'success') return result
  return {
    status: 'success',
    body: list(
      result.members.map((member) =>
        projectOrganizationMembershipMember({
          ...member,
          collections: input.includeCollections ? member.collections : [],
        }),
      ),
    ),
  }
}

export async function readOrganizationMember(
  database: D1Database,
  input: MembershipInput,
): Promise<OrganizationMembershipResult> {
  const result = await findOrganizationMemberForActor(database, {
    organizationId: input.organizationId,
    membershipId: input.membershipId,
    actorUserId: input.actor.userId,
  })
  if (result.status !== 'success') return result
  return {
    status: 'success',
    body: {
      ...projectOrganizationMembershipMember(result.member),
      Object: 'organizationUserDetails',
    },
  }
}

export async function readOrganizationUserPublicKey(
  database: D1Database,
  input: { actor: OrganizationMembershipActor; userId: string },
): Promise<OrganizationMembershipResult> {
  const result = await findOrganizationUserPublicKeyForActor(database, {
    actorUserId: input.actor.userId,
    userId: input.userId,
  })
  if (result.status !== 'success') return result
  return {
    status: 'success',
    body: {
      Object: 'userKey',
      UserId: result.userId,
      PublicKey: result.publicKey,
    },
  }
}

export async function organizationMemberPublicKeys(
  database: D1Database,
  input: MembershipInput & { body: unknown },
): Promise<OrganizationMembershipResult> {
  const request = parseOrganizationMembershipIdsRequest(input.body)
  if (!request.ok) return { status: request.code }
  const result = await listOrganizationMemberPublicKeys(database, {
    organizationId: input.organizationId,
    actorUserId: input.actor.userId,
    ids: request.value.ids,
  })
  if (result.status !== 'success') return result
  return {
    status: 'success',
    body: list(result.publicKeys.map(projectOrganizationMembershipPublicKey)),
  }
}

export function createOrganizationMembershipMailerDelivery(
  mailer: Fetcher,
): OrganizationMembershipDeliveryAdapter {
  return async (delivery) => {
    let response: Response
    try {
      response = await mailer.fetch(
        'https://organization-membership-mailer.internal/deliver',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(delivery),
        },
      )
    } catch {
      throw new Error('Organization membership invitation delivery failed.')
    }
    await response.body?.cancel().catch(() => undefined)
    if (response.status !== 202)
      throw new Error('Organization membership invitation delivery failed.')
  }
}

function mutation(input: MembershipInput) {
  return {
    organizationId: input.organizationId,
    membershipId: input.membershipId,
    actorUserId: input.actor.userId,
    now: input.now,
  }
}

function audit(
  input: MembershipInput,
  name: AuditEventName,
  membershipId: string,
  context?: Record<string, number | boolean>,
) {
  return buildAuditEvent({
    name,
    outcome: 'success',
    requestId: input.requestId,
    occurredAt: input.now,
    actor: { userId: input.actor.userId },
    target: { type: 'organization_user', id: membershipId },
    context: { organizationId: input.organizationId, ...context },
  })
}

function list(data: unknown[]) {
  return { object: 'list', data, continuationToken: null }
}

import { buildAuditEvent, type AuditEvent } from './domain/audit'
import {
  buildEmergencyAccessEmailHash,
  buildEmergencyAccessInviteTokenHash,
  classifyEmergencyAccessDelivery,
  createRedactingInviteRecorder,
  emergencyAccessInviteExpiresAt,
  generateEmergencyAccessInviteToken,
  parseEmergencyAccessAcceptRequest,
  parseEmergencyAccessConfirmRequest,
  parseEmergencyAccessInviteRequest,
  parseEmergencyAccessUpdateRequest,
  projectEmergencyAccessContact,
  type EmergencyAccessContactView,
  type EmergencyAccessDeliveryAdapter,
  type EmergencyAccessDeliveryOutcome,
} from './domain/emergency-access'
import {
  acceptInvitedEmergencyAccess,
  confirmAcceptedEmergencyAccess,
  deleteEmergencyAccess,
  insertInvitedEmergencyAccess,
  listGrantedEmergencyAccess,
  listTrustedEmergencyAccess,
  reinviteEmergencyAccess,
  updateEmergencyAccess,
  type EmergencyAccessRow,
} from './repositories/emergency-access-repository'

export type EmergencyAccessTrustClock = {
  now: string
}

export type EmergencyAccessTrustActor = {
  userId: string
  emailNormalized: string
}

export type EmergencyAccessTrustSecrets = {
  inviteSecret: string
}

type TrustMutationBase = EmergencyAccessTrustClock &
  EmergencyAccessTrustSecrets & {
    requestId: string
    relationshipId: string
    randomBytes?: (bytes: Uint8Array) => Uint8Array
    delivery?: EmergencyAccessDeliveryAdapter
  }

export async function inviteEmergencyAccessTrust(
  database: D1Database,
  input: TrustMutationBase & {
    grantor: EmergencyAccessTrustActor
    body: unknown
  },
): Promise<
  | {
      status: 'invited'
      contact: EmergencyAccessContactView
      delivery: 'accepted' | 'failed'
    }
  | { status: 'invalid_request' }
  | { status: 'conflict' }
> {
  const request = parseEmergencyAccessInviteRequest(input.body, {
    grantorEmailNormalized: input.grantor.emailNormalized,
  })
  if (!request.ok) return { status: 'invalid_request' }

  const token = generateInviteToken(input.randomBytes)
  const inviteTokenHash = await buildEmergencyAccessInviteTokenHash({
    secret: input.inviteSecret,
    relationshipId: input.relationshipId,
    emailNormalized: request.value.emailNormalized,
    token,
  })
  const created = await insertInvitedEmergencyAccess(
    database,
    {
      id: input.relationshipId,
      grantorUserId: input.grantor.userId,
      emailNormalized: request.value.emailNormalized,
      type: request.value.type,
      waitTimeDays: request.value.waitTimeDays,
      inviteTokenHash,
      inviteExpiresAt: emergencyAccessInviteExpiresAt(input.now),
      createdAt: input.now,
    },
    emergencyAccessAudit(input, 'emergency.invite', input.grantor.userId, {
      toStatus: 0,
      type: request.value.type,
      waitTimeDays: request.value.waitTimeDays,
    }),
  )
  if (created.status === 'conflict') return { status: 'conflict' }

  const delivery = await deliverInviteNotice({
    adapter: input.delivery,
    inviteSecret: input.inviteSecret,
    relationshipId: input.relationshipId,
    emailNormalized: request.value.emailNormalized,
    token,
  })

  return {
    status: 'invited',
    contact: projectEmergencyAccessContact(created.contact),
    delivery,
  }
}

export async function reinviteEmergencyAccessTrust(
  database: D1Database,
  input: TrustMutationBase & {
    grantor: EmergencyAccessTrustActor
  },
): Promise<
  | {
      status: 'reinvited'
      contact: EmergencyAccessContactView
      delivery: 'accepted' | 'failed'
    }
  | { status: 'not_found' }
> {
  const token = generateInviteToken(input.randomBytes)
  const current = await findTrustedContactEmail(
    database,
    input.relationshipId,
    input.grantor.userId,
  )
  if (!current?.emailNormalized) return { status: 'not_found' }

  const inviteTokenHash = await buildEmergencyAccessInviteTokenHash({
    secret: input.inviteSecret,
    relationshipId: input.relationshipId,
    emailNormalized: current.emailNormalized,
    token,
  })
  const result = await reinviteEmergencyAccess(
    database,
    {
      id: input.relationshipId,
      grantorUserId: input.grantor.userId,
      inviteTokenHash,
      inviteExpiresAt: emergencyAccessInviteExpiresAt(input.now),
      now: input.now,
    },
    emergencyAccessAudit(input, 'emergency.reinvite', input.grantor.userId, {
      fromStatus: 0,
      toStatus: 0,
    }),
  )
  if (result.status === 'not_found') return { status: 'not_found' }

  const delivery = await deliverInviteNotice({
    adapter: input.delivery,
    inviteSecret: input.inviteSecret,
    relationshipId: input.relationshipId,
    emailNormalized: current.emailNormalized,
    token,
  })

  return {
    status: 'reinvited',
    contact: projectEmergencyAccessContact(result.contact),
    delivery,
  }
}

export async function acceptEmergencyAccessTrust(
  database: D1Database,
  input: EmergencyAccessTrustClock &
    EmergencyAccessTrustSecrets & {
      requestId: string
      relationshipId: string
      grantee: EmergencyAccessTrustActor
      body: unknown
    },
): Promise<
  | { status: 'accepted'; contact: EmergencyAccessContactView }
  | { status: 'invalid_request' }
  | { status: 'not_found' }
> {
  const request = parseEmergencyAccessAcceptRequest(input.body)
  if (!request.ok) return { status: 'invalid_request' }

  const inviteTokenHash = await buildEmergencyAccessInviteTokenHash({
    secret: input.inviteSecret,
    relationshipId: input.relationshipId,
    emailNormalized: input.grantee.emailNormalized,
    token: request.value.token,
  })
  const result = await acceptInvitedEmergencyAccess(
    database,
    {
      id: input.relationshipId,
      granteeUserId: input.grantee.userId,
      emailNormalized: input.grantee.emailNormalized,
      inviteTokenHash,
      now: input.now,
    },
    emergencyAccessAudit(input, 'emergency.accept', input.grantee.userId, {
      fromStatus: 0,
      toStatus: 1,
    }),
  )
  if (result.status === 'not_found') return { status: 'not_found' }

  return {
    status: 'accepted',
    contact: projectEmergencyAccessContact(result.contact),
  }
}

export async function confirmEmergencyAccessTrust(
  database: D1Database,
  input: EmergencyAccessTrustClock & {
    requestId: string
    relationshipId: string
    grantor: EmergencyAccessTrustActor
    body: unknown
    keyGeneration: number
  },
): Promise<
  | { status: 'confirmed'; contact: EmergencyAccessContactView }
  | { status: 'invalid_request' }
  | { status: 'not_found' }
> {
  const request = parseEmergencyAccessConfirmRequest(input.body)
  if (!request.ok) return { status: 'invalid_request' }

  const result = await confirmAcceptedEmergencyAccess(
    database,
    {
      id: input.relationshipId,
      grantorUserId: input.grantor.userId,
      keyEncrypted: request.value.keyEncrypted,
      keyGeneration: input.keyGeneration,
      now: input.now,
    },
    emergencyAccessAudit(input, 'emergency.confirm', input.grantor.userId, {
      fromStatus: 1,
      toStatus: 2,
    }),
  )
  if (result.status === 'not_found') return { status: 'not_found' }

  return {
    status: 'confirmed',
    contact: projectEmergencyAccessContact(result.contact),
  }
}

export async function updateEmergencyAccessTrust(
  database: D1Database,
  input: EmergencyAccessTrustClock & {
    requestId: string
    relationshipId: string
    grantor: EmergencyAccessTrustActor
    body: unknown
  },
): Promise<
  | { status: 'updated'; contact: EmergencyAccessContactView }
  | { status: 'invalid_request' }
  | { status: 'not_found' }
> {
  const request = parseEmergencyAccessUpdateRequest(input.body)
  if (!request.ok) return { status: 'invalid_request' }

  const result = await updateEmergencyAccess(
    database,
    {
      id: input.relationshipId,
      grantorUserId: input.grantor.userId,
      type: request.value.type,
      waitTimeDays: request.value.waitTimeDays,
      keyEncrypted: request.value.keyEncrypted,
      now: input.now,
    },
    emergencyAccessAudit(input, 'emergency.update', input.grantor.userId, {
      type: request.value.type,
      waitTimeDays: request.value.waitTimeDays,
    }),
  )
  if (result.status === 'not_found') return { status: 'not_found' }

  return {
    status: 'updated',
    contact: projectEmergencyAccessContact(result.contact),
  }
}

export async function cancelEmergencyAccessTrust(
  database: D1Database,
  input: EmergencyAccessTrustClock & {
    requestId: string
    relationshipId: string
    actor: EmergencyAccessTrustActor
    role: 'grantor' | 'grantee'
  },
): Promise<{ status: 'deleted' } | { status: 'not_found' }> {
  const result = await deleteEmergencyAccess(
    database,
    {
      id: input.relationshipId,
      actorUserId: input.actor.userId,
      role: input.role,
    },
    emergencyAccessAudit(input, 'emergency.delete', input.actor.userId, {
      role: input.role,
    }),
  )
  return result.status === 'deleted'
    ? { status: 'deleted' }
    : { status: 'not_found' }
}

export async function listTrustedEmergencyAccessContacts(
  database: D1Database,
  grantorUserId: string,
): Promise<EmergencyAccessContactView[]> {
  const rows = await listTrustedEmergencyAccess(database, grantorUserId)
  return rows.map(projectEmergencyAccessContact)
}

export async function listGrantedEmergencyAccessContacts(
  database: D1Database,
  granteeUserId: string,
): Promise<EmergencyAccessContactView[]> {
  const rows = await listGrantedEmergencyAccess(database, granteeUserId)
  return rows.map(projectEmergencyAccessContact)
}

async function findTrustedContactEmail(
  database: D1Database,
  relationshipId: string,
  grantorUserId: string,
): Promise<Pick<EmergencyAccessRow, 'emailNormalized'> | null> {
  const trusted = await listTrustedEmergencyAccess(database, grantorUserId)
  return trusted.find((row) => row.id === relationshipId) ?? null
}

async function deliverInviteNotice(input: {
  adapter: EmergencyAccessDeliveryAdapter | undefined
  inviteSecret: string
  relationshipId: string
  emailNormalized: string
  token: string
}): Promise<'accepted' | 'failed'> {
  const adapter = input.adapter ?? createRedactingInviteRecorder()
  const recipientEmailHash = await buildEmergencyAccessEmailHash(
    input.inviteSecret,
    input.emailNormalized,
  )
  let outcome: EmergencyAccessDeliveryOutcome
  try {
    outcome = await adapter.deliverInvite(
      {
        relationshipId: input.relationshipId,
        recipientEmailHash,
      },
      input.token,
    )
  } catch {
    outcome = 'failed'
  }

  return classifyEmergencyAccessDelivery(outcome)
}

function generateInviteToken(
  randomBytes?: (bytes: Uint8Array) => Uint8Array,
): string {
  return randomBytes
    ? generateEmergencyAccessInviteToken(randomBytes)
    : generateEmergencyAccessInviteToken()
}

function emergencyAccessAudit(
  input: { requestId: string; now: string; relationshipId: string },
  name:
    | 'emergency.accept'
    | 'emergency.confirm'
    | 'emergency.delete'
    | 'emergency.invite'
    | 'emergency.reinvite'
    | 'emergency.update',
  actorUserId: string,
  context: Record<string, string | number | boolean | null>,
): AuditEvent {
  return buildAuditEvent({
    name,
    outcome: 'success',
    requestId: input.requestId,
    occurredAt: input.now,
    actor: { userId: actorUserId },
    target: { type: 'emergency_access', id: input.relationshipId },
    context,
  })
}

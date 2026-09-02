import {
  assertTextSendLookupRootIndependent,
  canonicalizeTextSendInstant,
  createTextSendCapability,
  createTextSendPasswordVerifier,
  decryptTextSendCapability,
  nextTextSendRevisionDate,
  parseTextSendOwnerRequest,
  resolveTextSendEnvelopeSecret,
} from './domain/text-send'
import {
  createTextSend,
  deleteTextSend,
  getOwnerTextSend,
  getOwnerTextSendForMutation,
  listOwnerTextSends,
  removeTextSendAuth,
  updateTextSend,
  type TextSendRow,
} from './repositories/text-send-repository'

export type TextSendOwnerResponse = {
  Id: string
  AccessId: string
  Type: number
  AuthType: number
  Name: string
  Notes: string | null
  Text: { Text: string; Hidden: boolean }
  File: null
  Key: string
  MaxAccessCount: number | null
  AccessCount: number
  RevisionDate: string
  ExpirationDate: string | null
  DeletionDate: string
  Password: 'configured' | null
  Emails: null
  Disabled: boolean
  HideEmail: boolean
  Object: 'send'
}

const configuredPasswordMarker = 'configured' as const

type TextSendKeyring = {
  envelopeKeyId: string
  envelopeSecrets: Readonly<Record<string, string>>
  lookupKeyId: string
  lookupSecret: string
}

type CreateOwnerTextSendInput = TextSendKeyring & {
  ownerUserId: string
  body: unknown
  now: string
  sendId: string
  auditEventId: string
  requestId: string
  randomBytes?: (bytes: Uint8Array) => Uint8Array
}

type ReadOwnerTextSendInput = {
  ownerUserId: string
  envelopeSecrets: Readonly<Record<string, string>>
}

type UpdateOwnerTextSendInput = Pick<
  TextSendKeyring,
  'lookupKeyId' | 'lookupSecret'
> & {
  ownerUserId: string
  id: string
  body: unknown
  expectedRevisionDate: string
  now: string
  envelopeSecrets: Readonly<Record<string, string>>
}

export function projectTextSendOwnerResponse(
  row: TextSendRow,
  accessId: string,
): TextSendOwnerResponse {
  return {
    Id: row.id,
    AccessId: accessId,
    Type: row.type,
    AuthType: row.authType,
    Name: row.encryptedName,
    Notes: row.encryptedNotes,
    Text: { Text: row.encryptedText, Hidden: row.textHidden === 1 },
    File: null,
    Key: row.encryptedKey,
    MaxAccessCount: row.maxAccessCount,
    AccessCount: row.accessCount,
    RevisionDate: row.revisionDate,
    ExpirationDate: row.expirationAt,
    DeletionDate: row.deletionAt,
    Password: row.authType === 1 ? 'configured' : null,
    Emails: null,
    Disabled: row.disabled === 1,
    HideEmail: row.hideEmail === 1,
    Object: 'send',
  }
}

export async function createOwnerTextSend(
  database: D1Database,
  input: CreateOwnerTextSendInput,
): Promise<
  | { status: 'created'; send: TextSendOwnerResponse }
  | { status: 'invalid_request' }
> {
  const canonicalNow = canonicalizeTextSendInstant(input.now)
  if (canonicalNow === null) return { status: 'invalid_request' }
  const request = parseTextSendOwnerRequest(input.body, {
    now: canonicalNow,
    accessCount: 0,
  })
  if (!request.ok) return { status: 'invalid_request' }
  if (request.value.clientPasswordHash === configuredPasswordMarker) {
    return { status: 'invalid_request' }
  }

  const envelopeSecret = resolveTextSendEnvelopeSecret(
    input.envelopeKeyId,
    input.envelopeSecrets,
  )
  assertTextSendLookupRootIndependent(input.lookupSecret, input.envelopeSecrets)
  const capability = await createTextSendCapability({
    sendId: input.sendId,
    ownerUserId: input.ownerUserId,
    envelopeKeyId: input.envelopeKeyId,
    envelopeSecret,
    lookupKeyId: input.lookupKeyId,
    lookupSecret: input.lookupSecret,
    ...(input.randomBytes ? { randomBytes: input.randomBytes } : {}),
  })
  const passwordVerifier = request.value.clientPasswordHash
    ? await createTextSendPasswordVerifier({
        sendId: input.sendId,
        keyId: input.lookupKeyId,
        lookupSecret: input.lookupSecret,
        clientPasswordHash: request.value.clientPasswordHash,
      })
    : null

  const result = await createTextSend(database, {
    id: input.sendId,
    ownerUserId: input.ownerUserId,
    type: 0,
    authType: request.value.authType,
    lifecycleState: request.value.disabled ? 'disabled' : 'active',
    capabilityEnvelope: capability.capabilityEnvelope,
    capabilityEnvelopeKeyId: input.envelopeKeyId,
    capabilityVerifier: capability.capabilityVerifier,
    capabilityVerifierKeyId: input.lookupKeyId,
    accessGeneration: 1,
    encryptedName: request.value.encryptedName,
    encryptedNotes: request.value.encryptedNotes,
    encryptedKey: request.value.encryptedKey,
    encryptedText: request.value.encryptedText,
    textHidden: request.value.textHidden ? 1 : 0,
    passwordVerifier,
    passwordKeyId: passwordVerifier ? input.lookupKeyId : null,
    maxAccessCount: request.value.maxAccessCount,
    accessCount: 0,
    disabled: request.value.disabled ? 1 : 0,
    hideEmail: request.value.hideEmail ? 1 : 0,
    expirationAt: request.value.expirationDate,
    deletionAt: request.value.deletionDate,
    revisionDate: canonicalNow,
    createdAt: canonicalNow,
    updatedAt: canonicalNow,
    deletedAt: null,
    quarantinedAt: null,
    lastAccessedAt: null,
    auditEventId: input.auditEventId,
    requestId: input.requestId,
  })
  return {
    status: 'created',
    send: projectTextSendOwnerResponse(result.send, capability.accessId),
  }
}

export async function getOwnerTextSendResponse(
  database: D1Database,
  input: ReadOwnerTextSendInput & { id: string },
): Promise<
  { status: 'ok'; send: TextSendOwnerResponse } | { status: 'not_found' }
> {
  const row = await getOwnerTextSend(database, input)
  if (!row) return { status: 'not_found' }
  return {
    status: 'ok',
    send: await recoverTextSendOwnerResponse(row, input.envelopeSecrets),
  }
}

export async function listOwnerTextSendResponses(
  database: D1Database,
  input: ReadOwnerTextSendInput,
): Promise<TextSendOwnerResponse[]> {
  const rows = await listOwnerTextSends(database, input.ownerUserId)
  return Promise.all(
    rows.map((row) => recoverTextSendOwnerResponse(row, input.envelopeSecrets)),
  )
}

export async function updateOwnerTextSend(
  database: D1Database,
  input: UpdateOwnerTextSendInput,
): Promise<
  | { status: 'updated'; send: TextSendOwnerResponse }
  | { status: 'invalid_request' | 'not_found' | 'conflict' }
> {
  const canonicalNow = canonicalizeTextSendInstant(input.now)
  if (canonicalNow === null) return { status: 'invalid_request' }
  const current = await getOwnerTextSend(database, input)
  if (!current) return { status: 'not_found' }
  const request = parseTextSendOwnerRequest(input.body, {
    now: canonicalNow,
    accessCount: current.accessCount,
  })
  if (!request.ok) return { status: 'invalid_request' }
  const nextRevisionDate = nextTextSendRevisionDate(
    current.revisionDate,
    canonicalNow,
  )

  let passwordVerifier: string | null = null
  let passwordKeyId: string | null = null
  if (request.value.authType === 1) {
    const clientInput = request.value.clientPasswordHash
    if (!clientInput) return { status: 'invalid_request' }
    if (current.authType === 1) {
      if (clientInput !== configuredPasswordMarker) {
        return { status: 'invalid_request' }
      }
      passwordVerifier = current.passwordVerifier
      passwordKeyId = current.passwordKeyId
    } else {
      if (clientInput === configuredPasswordMarker) {
        return { status: 'invalid_request' }
      }
      assertTextSendLookupRootIndependent(
        input.lookupSecret,
        input.envelopeSecrets,
      )
      passwordVerifier = await createTextSendPasswordVerifier({
        sendId: current.id,
        keyId: input.lookupKeyId,
        lookupSecret: input.lookupSecret,
        clientPasswordHash: clientInput,
      })
      passwordKeyId = input.lookupKeyId
    }
  }

  const currentResponse = await recoverTextSendOwnerResponse(
    current,
    input.envelopeSecrets,
  )

  const result = await updateTextSend(database, {
    id: current.id,
    ownerUserId: input.ownerUserId,
    expectedRevisionDate: input.expectedRevisionDate,
    encryptedName: request.value.encryptedName,
    encryptedNotes: request.value.encryptedNotes,
    encryptedKey: request.value.encryptedKey,
    encryptedText: request.value.encryptedText,
    textHidden: request.value.textHidden,
    authType: request.value.authType,
    passwordVerifier,
    passwordKeyId,
    maxAccessCount: request.value.maxAccessCount,
    disabled: request.value.disabled,
    hideEmail: request.value.hideEmail,
    expirationAt: request.value.expirationDate,
    deletionAt: request.value.deletionDate,
    nextRevisionDate,
  })
  if (result.status === 'conflict') return result
  return {
    status: 'updated',
    send: projectTextSendOwnerResponse(result.send, currentResponse.AccessId),
  }
}

export async function removeOwnerTextSendAuth(
  database: D1Database,
  input: ReadOwnerTextSendInput & { id: string; now: string },
): Promise<
  | { status: 'updated'; send: TextSendOwnerResponse }
  | { status: 'invalid_request' | 'not_found' | 'conflict' }
> {
  const canonicalNow = canonicalizeTextSendInstant(input.now)
  if (canonicalNow === null) return { status: 'invalid_request' }
  const current = await getOwnerTextSend(database, input)
  if (!current) return { status: 'not_found' }
  if (
    current.quarantinedAt !== null ||
    (current.lifecycleState !== 'active' &&
      current.lifecycleState !== 'disabled' &&
      current.lifecycleState !== 'expired')
  ) {
    return { status: 'not_found' }
  }
  const currentResponse = await recoverTextSendOwnerResponse(
    current,
    input.envelopeSecrets,
  )
  const nextRevisionDate = nextTextSendRevisionDate(
    current.revisionDate,
    canonicalNow,
  )
  const result = await removeTextSendAuth(database, {
    ...input,
    now: nextRevisionDate,
  })
  if (result.status === 'not_found') return { status: 'conflict' }
  return {
    status: 'updated',
    send: projectTextSendOwnerResponse(result.send, currentResponse.AccessId),
  }
}

export async function deleteOwnerTextSend(
  database: D1Database,
  input: { id: string; ownerUserId: string; now: string },
): Promise<
  | { status: 'deleted' }
  | { status: 'invalid_request' | 'not_found' | 'conflict' }
> {
  const canonicalNow = canonicalizeTextSendInstant(input.now)
  if (canonicalNow === null) return { status: 'invalid_request' }
  const current = await getOwnerTextSendForMutation(database, input)
  if (!current) return { status: 'not_found' }
  const isCanonicalTombstone =
    current.deletedAt !== null &&
    current.lifecycleState === 'deleted' &&
    current.disabled === 1
  const isDeletableLiveRow =
    current.deletedAt === null &&
    (current.lifecycleState === 'active' ||
      current.lifecycleState === 'disabled' ||
      current.lifecycleState === 'expired' ||
      current.lifecycleState === 'quarantined')
  if (!isCanonicalTombstone && !isDeletableLiveRow) {
    return { status: 'not_found' }
  }
  const nextRevisionDate = nextTextSendRevisionDate(
    current.revisionDate,
    canonicalNow,
  )
  const result = await deleteTextSend(database, {
    ...input,
    now: nextRevisionDate,
  })
  return result.status === 'not_found' ? { status: 'conflict' } : result
}

export async function recoverTextSendOwnerResponse(
  row: TextSendRow,
  envelopeSecrets: Readonly<Record<string, string>>,
): Promise<TextSendOwnerResponse> {
  const envelopeSecret = resolveTextSendEnvelopeSecret(
    row.capabilityEnvelopeKeyId,
    envelopeSecrets,
  )
  const accessId = await decryptTextSendCapability({
    sendId: row.id,
    ownerUserId: row.ownerUserId,
    envelopeKeyId: row.capabilityEnvelopeKeyId,
    envelopeSecret,
    capabilityEnvelope: row.capabilityEnvelope,
  })
  return projectTextSendOwnerResponse(row, accessId)
}

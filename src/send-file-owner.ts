import {
  allocateSendFileObject,
  fileSendUploadDeadlineAt,
  parseFileSendOwnerRequest,
} from './domain/send-file'
import {
  assertTextSendLookupRootIndependent,
  canonicalizeTextSendInstant,
  createTextSendCapability,
  createTextSendPasswordVerifier,
  resolveTextSendEnvelopeSecret,
} from './domain/text-send'
import { createPendingFileSend } from './repositories/send-file-repository'

export type FileSendOwnerResponse = {
  Id: string
  AccessId: string
  Type: 1
  AuthType: number
  Name: string
  Notes: string | null
  Text: null
  File: { Id: string; FileName: string; Size: number }
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

type FileSendKeyring = {
  envelopeKeyId: string
  envelopeSecrets: Readonly<Record<string, string>>
  lookupKeyId: string
  lookupSecret: string
}

type CreateOwnerFileSendInput = FileSendKeyring & {
  ownerUserId: string
  body: unknown
  now: string
  sendId: string
  fileId: string
  auditEventId: string
  requestId: string
  randomBytes?: (bytes: Uint8Array) => Uint8Array
}

export async function createOwnerFileSend(
  database: D1Database,
  input: CreateOwnerFileSendInput,
): Promise<
  | { status: 'created'; send: FileSendOwnerResponse }
  | { status: 'invalid_request' }
> {
  const canonicalNow = canonicalizeTextSendInstant(input.now)
  if (canonicalNow === null) return { status: 'invalid_request' }
  const request = parseFileSendOwnerRequest(input.body, {
    now: canonicalNow,
    accessCount: 0,
  })
  if (!request.ok) return { status: 'invalid_request' }

  const uploadDeadlineAt = fileSendUploadDeadlineAt(canonicalNow)
  if (uploadDeadlineAt === null) return { status: 'invalid_request' }

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
  const object = allocateSendFileObject({
    sendId: input.sendId,
    fileId: input.fileId,
    objectGeneration: 1,
    ...(input.randomBytes ? { randomBytes: input.randomBytes } : {}),
  })

  await createPendingFileSend(database, {
    send: {
      id: input.sendId,
      ownerUserId: input.ownerUserId,
      type: 1,
      authType: request.value.authType,
      lifecycleState: 'pending_upload',
      capabilityEnvelope: capability.capabilityEnvelope,
      capabilityEnvelopeKeyId: input.envelopeKeyId,
      capabilityVerifier: capability.capabilityVerifier,
      capabilityVerifierKeyId: input.lookupKeyId,
      accessGeneration: 1,
      encryptedName: request.value.encryptedName,
      encryptedNotes: request.value.encryptedNotes,
      encryptedKey: request.value.encryptedKey,
      encryptedText: null,
      textHidden: 0,
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
    },
    file: {
      id: input.fileId,
      sendId: input.sendId,
      ownerUserId: input.ownerUserId,
      objectGeneration: object.objectGeneration,
      objectKey: object.objectKey,
      encryptedFileName: request.value.encryptedFileName,
      expectedSize: request.value.expectedSize,
      observedSize: null,
      objectEtag: null,
      lifecycleState: 'pending_upload',
      uploadDeadlineAt,
      validatedAt: null,
      cleanupLeaseUntil: null,
      cleanupAttempts: 0,
      lastFailureClass: null,
      deletedAt: null,
    },
    auditEventId: input.auditEventId,
    requestId: input.requestId,
  })

  return {
    status: 'created',
    send: {
      Id: input.sendId,
      AccessId: capability.accessId,
      Type: 1,
      AuthType: request.value.authType,
      Name: request.value.encryptedName,
      Notes: request.value.encryptedNotes,
      Text: null,
      File: {
        Id: input.fileId,
        FileName: request.value.encryptedFileName,
        Size: request.value.expectedSize,
      },
      Key: request.value.encryptedKey,
      MaxAccessCount: request.value.maxAccessCount,
      AccessCount: 0,
      RevisionDate: canonicalNow,
      ExpirationDate: request.value.expirationDate,
      DeletionDate: request.value.deletionDate,
      Password: request.value.authType === 1 ? 'configured' : null,
      Emails: null,
      Disabled: request.value.disabled,
      HideEmail: request.value.hideEmail,
      Object: 'send',
    },
  }
}

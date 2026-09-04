import { normalizeEmail } from './prelogin'

export const emergencyAccessPolicy = {
  inviteLifetimeDays: 5,
  inviteSecretMinBytes: 32,
  inviteTokenBytes: 32,
  maxEmailLength: 254,
  maxKeyEncryptedBytes: 65_536,
  maxTokenLength: 256,
  maxWaitTimeDays: 90,
  minWaitTimeDays: 1,
} as const

export const emergencyAccessStatus = {
  invited: 0,
  accepted: 1,
  confirmed: 2,
  recoveryInitiated: 3,
  recoveryApproved: 4,
} as const

export type EmergencyAccessStatus =
  (typeof emergencyAccessStatus)[keyof typeof emergencyAccessStatus]

export type EmergencyAccessType = 0 | 1

export type EmergencyAccessInviteRequest = {
  emailNormalized: string
  type: EmergencyAccessType
  waitTimeDays: number
}

export type EmergencyAccessAcceptRequest = {
  token: string
}

export type EmergencyAccessConfirmRequest = {
  keyEncrypted: string
}

export type EmergencyAccessUpdateRequest = {
  type: EmergencyAccessType
  waitTimeDays: number
  keyEncrypted: string | null
}

export type EmergencyAccessParseResult<T> =
  { ok: true; value: T } | { ok: false; code: 'invalid_request' }

export type EmergencyAccessDeliveryOutcome =
  'delivered' | 'failed' | 'ambiguous'

export type EmergencyAccessInviteNotice = {
  relationshipId: string
  recipientEmailHash: string
}

export type EmergencyAccessDeliveryAdapter = {
  deliverInvite: (
    notice: EmergencyAccessInviteNotice,
    token: string,
  ) => Promise<EmergencyAccessDeliveryOutcome>
}

export type EmergencyAccessContactRecord = {
  id: string
  grantorUserId: string
  granteeUserId: string | null
  emailNormalized: string | null
  type: EmergencyAccessType
  status: EmergencyAccessStatus
  waitTimeDays: number
  createdAt: string
  revisionDate: string
  keyEncrypted?: string | null
  inviteTokenHash?: string | null
}

export type EmergencyAccessContactView = {
  Id: string
  GrantorId: string
  GranteeId: string | null
  Email: string | null
  Type: EmergencyAccessType
  Status: EmergencyAccessStatus
  WaitTimeDays: number
  CreationDate: string
  RevisionDate: string
  Object: 'emergencyAccess'
}

type InviteTokenHashInput = {
  secret: string
  relationshipId: string
  emailNormalized: string
  token: string
}

const encoder = new TextEncoder()
const verifierPrefix = 'hmac-sha256:v1:'
const inviteTokenDomain = 'honowarden:emergency-access:invite:v1'
const emailHashDomain = 'honowarden:emergency-access:email:v1'

export function isEmergencyAccessRuntimeEnabled(
  value: string | undefined,
): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function parseEmergencyAccessInviteRequest(
  body: unknown,
  context: { grantorEmailNormalized: string },
): EmergencyAccessParseResult<EmergencyAccessInviteRequest> {
  const object = normalizeProtocolObject(body)
  if (!object) return invalidRequest()

  const emailNormalized = parseNormalizedEmail(object.get('email'))
  const type = parseAccessType(object.get('type'))
  const waitTimeDays = parseWaitTimeDays(object.get('waittimedays'))
  if (!emailNormalized || type === null || waitTimeDays === null) {
    return invalidRequest()
  }

  if (emailNormalized === context.grantorEmailNormalized) {
    return invalidRequest()
  }

  return { ok: true, value: { emailNormalized, type, waitTimeDays } }
}

export function parseEmergencyAccessAcceptRequest(
  body: unknown,
): EmergencyAccessParseResult<EmergencyAccessAcceptRequest> {
  const object = normalizeProtocolObject(body)
  const token = boundedString(
    object?.get('token'),
    1,
    emergencyAccessPolicy.maxTokenLength,
  )
  if (!token) return invalidRequest()
  return { ok: true, value: { token } }
}

export function parseEmergencyAccessConfirmRequest(
  body: unknown,
): EmergencyAccessParseResult<EmergencyAccessConfirmRequest> {
  const object = normalizeProtocolObject(body)
  const keyEncrypted = boundedString(
    object?.get('key'),
    1,
    emergencyAccessPolicy.maxKeyEncryptedBytes,
  )
  if (!keyEncrypted) return invalidRequest()
  return { ok: true, value: { keyEncrypted } }
}

export function parseEmergencyAccessUpdateRequest(
  body: unknown,
): EmergencyAccessParseResult<EmergencyAccessUpdateRequest> {
  const object = normalizeProtocolObject(body)
  if (!object) return invalidRequest()

  const type = parseAccessType(object.get('type'))
  const waitTimeDays = parseWaitTimeDays(object.get('waittimedays'))
  const key = object.get('key') ?? object.get('keyencrypted') ?? null
  const keyEncrypted =
    key === null
      ? null
      : boundedString(key, 1, emergencyAccessPolicy.maxKeyEncryptedBytes)
  if (type === null || waitTimeDays === null || keyEncrypted === undefined) {
    return invalidRequest()
  }

  return { ok: true, value: { type, waitTimeDays, keyEncrypted } }
}

export function canStartRecovery(status: EmergencyAccessStatus): boolean {
  return status === emergencyAccessStatus.confirmed
}

export function emergencyAccessInviteExpiresAt(now: string): string {
  const timestamp = Date.parse(now)
  if (!Number.isFinite(timestamp)) {
    throw new Error('Emergency Access invite clock is invalid.')
  }

  return new Date(
    timestamp + emergencyAccessPolicy.inviteLifetimeDays * 86_400_000,
  ).toISOString()
}

export function generateEmergencyAccessInviteToken(
  randomBytes: (bytes: Uint8Array) => Uint8Array = crypto.getRandomValues.bind(
    crypto,
  ),
): string {
  const entropy = new Uint8Array(emergencyAccessPolicy.inviteTokenBytes)
  const filled = randomBytes(entropy)
  if (filled !== entropy || filled.byteLength !== entropy.byteLength) {
    throw new Error('Emergency Access invite entropy source is invalid.')
  }

  return base64UrlEncode(entropy)
}

export async function buildEmergencyAccessInviteTokenHash(
  input: InviteTokenHashInput,
): Promise<string> {
  return buildVerifier(
    input.secret,
    `${inviteTokenDomain}\0${input.relationshipId}\0${input.emailNormalized}\0${input.token}`,
  )
}

export async function verifyEmergencyAccessInviteToken(
  input: InviteTokenHashInput & { storedHash: string },
): Promise<boolean> {
  const expected = await buildEmergencyAccessInviteTokenHash(input)
  return constantTimeEqual(expected, input.storedHash)
}

export async function buildEmergencyAccessEmailHash(
  secret: string,
  emailNormalized: string,
): Promise<string> {
  return buildVerifier(secret, `${emailHashDomain}\0${emailNormalized}`)
}

export function classifyEmergencyAccessDelivery(
  outcome: EmergencyAccessDeliveryOutcome,
): 'accepted' | 'failed' {
  return outcome === 'delivered' ? 'accepted' : 'failed'
}

export function createRedactingInviteRecorder(
  outcome: EmergencyAccessDeliveryOutcome = 'delivered',
): EmergencyAccessDeliveryAdapter & {
  attempts: Array<
    EmergencyAccessInviteNotice & { outcome: EmergencyAccessDeliveryOutcome }
  >
} {
  const attempts: Array<
    EmergencyAccessInviteNotice & { outcome: EmergencyAccessDeliveryOutcome }
  > = []

  return {
    attempts,
    async deliverInvite(notice) {
      attempts.push({ ...notice, outcome })
      return outcome
    },
  }
}

export function projectEmergencyAccessContact(
  record: EmergencyAccessContactRecord,
): EmergencyAccessContactView {
  return {
    Id: record.id,
    GrantorId: record.grantorUserId,
    GranteeId: record.granteeUserId,
    Email: record.emailNormalized,
    Type: record.type,
    Status: record.status,
    WaitTimeDays: record.waitTimeDays,
    CreationDate: record.createdAt,
    RevisionDate: record.revisionDate,
    Object: 'emergencyAccess',
  }
}

function parseNormalizedEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const emailNormalized = normalizeEmail(value)
  if (
    !emailNormalized ||
    encoder.encode(emailNormalized).byteLength >
      emergencyAccessPolicy.maxEmailLength
  ) {
    return null
  }

  return emailNormalized
}

function parseAccessType(value: unknown): EmergencyAccessType | null {
  return value === 0 || value === 1 ? value : null
}

function parseWaitTimeDays(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= emergencyAccessPolicy.minWaitTimeDays &&
    value <= emergencyAccessPolicy.maxWaitTimeDays
    ? value
    : null
}

function normalizeProtocolObject(value: unknown): Map<string, unknown> | null {
  if (!isPlainObject(value)) return null
  const normalized = new Map<string, unknown>()
  for (const [key, entry] of Object.entries(value)) {
    const canonical = key.toLowerCase()
    if (normalized.has(canonical)) return null
    normalized.set(canonical, entry)
  }
  return normalized
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedString(
  value: unknown,
  minimumLength: number,
  maximumBytes: number,
): string | null {
  return typeof value === 'string' &&
    value.length >= minimumLength &&
    encoder.encode(value).byteLength <= maximumBytes
    ? value
    : null
}

function invalidRequest<T>(): EmergencyAccessParseResult<T> {
  return { ok: false, code: 'invalid_request' }
}

async function buildVerifier(secret: string, value: string): Promise<string> {
  const encodedSecret = encoder.encode(secret)
  if (encodedSecret.byteLength < emergencyAccessPolicy.inviteSecretMinBytes) {
    throw new Error('Emergency Access invite secret must be at least 32 bytes.')
  }

  const key = await crypto.subtle.importKey(
    'raw',
    encodedSecret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return `${verifierPrefix}${base64UrlEncode(new Uint8Array(signature))}`
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  }
  return difference === 0
}

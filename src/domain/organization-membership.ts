import { normalizeEmail } from './prelogin'

export const organizationMembershipPolicy = {
  inviteLifetimeDays: 5,
  inviteSecretMinBytes: 32,
  inviteTokenBytes: 32,
  maxInvites: 20,
  maxCollections: 100,
  maxIds: 100,
  maxIdLength: 128,
  maxEmailLength: 254,
  maxKeyEncryptedBytes: 65_536,
} as const

export const organizationMembershipStatus = {
  invited: 0,
  accepted: 1,
  confirmed: 2,
  revoked: -1,
} as const

export type OrganizationMembershipRole = 0 | 1 | 2
export type OrganizationMembershipStatus =
  (typeof organizationMembershipStatus)[keyof typeof organizationMembershipStatus]

export type OrganizationMembershipCollectionGrant = {
  id: string
  readOnly: boolean
  hidePasswords: boolean
  manage: boolean
}

export type OrganizationMembershipInviteRequest = {
  emailsNormalized: string[]
  type: OrganizationMembershipRole
  collections: OrganizationMembershipCollectionGrant[]
}
export type OrganizationMembershipAcceptRequest = { token: string }
export type OrganizationMembershipConfirmRequest = { keyEncrypted: string }
export type OrganizationMembershipUpdateRequest = {
  type: OrganizationMembershipRole
  collections: OrganizationMembershipCollectionGrant[]
}
export type OrganizationMembershipIdsRequest = { ids: string[] }
export type OrganizationMembershipParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: 'invalid_request' | 'unsupported_feature' }

export type OrganizationMembershipMemberRecord = {
  id: string
  userId: string | null
  name?: string | null
  emailNormalized: string
  status: OrganizationMembershipStatus
  type: OrganizationMembershipRole
  collections: OrganizationMembershipCollectionGrant[]
}

type InviteTokenHashInput = {
  secret: string
  organizationId: string
  membershipId: string
  emailNormalized: string
  token: string
}

const encoder = new TextEncoder()
const verifierPrefix = 'hmac-sha256:v1:'
const inviteTokenDomain = 'honowarden:organization-membership:invite:v1'
const grantFields = new Set(['id', 'readonly', 'hidepasswords', 'manage'])
const authorityFields = [
  'type',
  'collections',
  'groups',
  'accessall',
  'accesssecretsmanager',
  'accesspam',
  'permissions',
]

export function parseOrganizationMembershipInviteRequest(
  body: unknown,
): OrganizationMembershipParseResult<OrganizationMembershipInviteRequest> {
  const object = normalizeProtocolObject(body)
  if (!object || !hasOnlyFields(object, [...authorityFields, 'emails'])) {
    return invalidRequest()
  }
  const authority = parseAuthority(object)
  if (!authority.ok) return authority

  const values = object.get('emails')
  if (
    !Array.isArray(values) ||
    values.length < 1 ||
    values.length > organizationMembershipPolicy.maxInvites
  ) {
    return invalidRequest()
  }
  const emailsNormalized: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const email = parseNormalizedEmail(value)
    if (!email || seen.has(email)) return invalidRequest()
    seen.add(email)
    emailsNormalized.push(email)
  }
  return { ok: true, value: { emailsNormalized, ...authority.value } }
}

export function parseOrganizationMembershipUpdateRequest(
  body: unknown,
): OrganizationMembershipParseResult<OrganizationMembershipUpdateRequest> {
  const object = normalizeProtocolObject(body)
  if (
    !object ||
    !object.has('collections') ||
    !hasOnlyFields(object, authorityFields)
  ) {
    return invalidRequest()
  }
  return parseAuthority(object)
}

export function parseOrganizationMembershipAcceptRequest(
  body: unknown,
): OrganizationMembershipParseResult<OrganizationMembershipAcceptRequest> {
  const object = normalizeProtocolObject(body)
  const token = object?.get('token')
  if (!object || !hasOnlyFields(object, ['token']) || !isInviteToken(token)) {
    return invalidRequest()
  }
  return { ok: true, value: { token } }
}

export function parseOrganizationMembershipConfirmRequest(
  body: unknown,
): OrganizationMembershipParseResult<OrganizationMembershipConfirmRequest> {
  const object = normalizeProtocolObject(body)
  const keyEncrypted = boundedString(
    object?.get('key'),
    organizationMembershipPolicy.maxKeyEncryptedBytes,
  )
  if (
    !object ||
    !hasOnlyFields(object, ['key', 'defaultusercollectionname']) ||
    !keyEncrypted
  ) {
    return invalidRequest()
  }
  const defaultName = object.get('defaultusercollectionname')
  if (
    object.has('defaultusercollectionname') &&
    defaultName !== null &&
    (typeof defaultName !== 'string' ||
      encoder.encode(defaultName).byteLength >
        organizationMembershipPolicy.maxKeyEncryptedBytes)
  )
    return invalidRequest()
  // My Items is always disabled: upstream skips this optional metadata in that mode.
  return { ok: true, value: { keyEncrypted } }
}

export function parseOrganizationMembershipIdsRequest(
  body: unknown,
): OrganizationMembershipParseResult<OrganizationMembershipIdsRequest> {
  const object = normalizeProtocolObject(body)
  const ids = object?.get('ids')
  if (
    !object ||
    !hasOnlyFields(object, ['ids']) ||
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > organizationMembershipPolicy.maxIds
  ) {
    return invalidRequest()
  }
  if (!ids.every(isIdentifier) || new Set(ids).size !== ids.length)
    return invalidRequest()
  return { ok: true, value: { ids: [...ids] } }
}

export function organizationMembershipInviteExpiresAt(now: string): string {
  const timestamp = Date.parse(now)
  if (!Number.isFinite(timestamp))
    throw new Error('Organization membership invite clock is invalid.')
  return new Date(
    timestamp + organizationMembershipPolicy.inviteLifetimeDays * 86_400_000,
  ).toISOString()
}

export function generateOrganizationMembershipInviteToken(
  randomBytes: (bytes: Uint8Array) => Uint8Array = crypto.getRandomValues.bind(
    crypto,
  ),
): string {
  const entropy = new Uint8Array(organizationMembershipPolicy.inviteTokenBytes)
  const filled = randomBytes(entropy)
  if (filled !== entropy || filled.byteLength !== entropy.byteLength) {
    throw new Error('Organization membership invite entropy source is invalid.')
  }
  return base64UrlEncode(entropy)
}

export async function buildOrganizationMembershipInviteTokenHash(
  input: InviteTokenHashInput,
): Promise<string> {
  const secret = encoder.encode(input.secret)
  if (secret.byteLength < organizationMembershipPolicy.inviteSecretMinBytes) {
    throw new Error(
      'Organization membership invite secret must be at least 32 bytes.',
    )
  }
  if (
    !isIdentifier(input.organizationId) ||
    !isIdentifier(input.membershipId) ||
    parseNormalizedEmail(input.emailNormalized) !== input.emailNormalized ||
    !isInviteToken(input.token)
  ) {
    throw new Error('Organization membership invite binding is invalid.')
  }
  const key = await crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const value = `${inviteTokenDomain}\0${input.organizationId}\0${input.membershipId}\0${input.emailNormalized}\0${input.token}`
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return `${verifierPrefix}${base64UrlEncode(new Uint8Array(signature))}`
}

export async function verifyOrganizationMembershipInviteToken(
  input: InviteTokenHashInput & { storedHash: string },
): Promise<boolean> {
  const expected = await buildOrganizationMembershipInviteTokenHash(input)
  return constantTimeEqual(expected, input.storedHash)
}

export function projectOrganizationMembershipMember(
  record: OrganizationMembershipMemberRecord,
) {
  return {
    Object: 'organizationUserUserDetails' as const,
    Id: record.id,
    UserId: record.userId,
    Name: record.name ?? null,
    Email: record.emailNormalized,
    Status: record.status,
    Type: record.type,
    AccessAll: false,
    Permissions: null,
    Groups: [],
    Collections: record.collections.map((grant) => ({
      Id: grant.id,
      ReadOnly: grant.readOnly,
      HidePasswords: grant.hidePasswords,
      Manage: grant.manage,
    })),
  }
}

export function projectOrganizationMembershipPublicKey(record: {
  id: string
  userId: string
  publicKey: string
}) {
  return {
    Object: 'organizationUserPublicKeyResponseModel' as const,
    Id: record.id,
    UserId: record.userId,
    Key: record.publicKey,
  }
}

function parseAuthority(
  object: Map<string, unknown>,
): OrganizationMembershipParseResult<OrganizationMembershipUpdateRequest> {
  const type = object.get('type')
  if (type === 4) return unsupportedFeature()
  if (type !== 0 && type !== 1 && type !== 2) return invalidRequest()

  for (const field of ['accessall', 'accesssecretsmanager', 'accesspam']) {
    if (!object.has(field)) continue
    const enabled = object.get(field)
    if (enabled === true) return unsupportedFeature()
    if (enabled !== false) return invalidRequest()
  }
  if (object.has('groups')) {
    const groups = object.get('groups')
    if (!Array.isArray(groups)) return invalidRequest()
    if (groups.length > 0) return unsupportedFeature()
  }
  if (object.has('permissions')) {
    const permissions = normalizeProtocolObject(object.get('permissions'))
    if (!permissions) return invalidRequest()
    // The current client's empty PermissionsApi serializes its BaseResponse field.
    if (
      permissions.size > 0 &&
      !(permissions.size === 1 && permissions.get('response') === null)
    )
      return unsupportedFeature()
  }

  const assignments = object.has('collections') ? object.get('collections') : []
  if (
    !Array.isArray(assignments) ||
    assignments.length > organizationMembershipPolicy.maxCollections
  )
    return invalidRequest()
  const collections: OrganizationMembershipCollectionGrant[] = []
  const seen = new Set<string>()
  for (const value of assignments) {
    const grant = normalizeProtocolObject(value)
    const id = grant?.get('id')
    if (
      !grant ||
      !hasOnlyFields(grant, grantFields) ||
      !isIdentifier(id) ||
      seen.has(id)
    )
      return invalidRequest()
    const readOnly = grant.has('readonly') ? grant.get('readonly') : false
    const hidePasswords = grant.has('hidepasswords')
      ? grant.get('hidepasswords')
      : false
    const manage = grant.has('manage') ? grant.get('manage') : false
    if (
      typeof readOnly !== 'boolean' ||
      typeof hidePasswords !== 'boolean' ||
      typeof manage !== 'boolean'
    )
      return invalidRequest()
    seen.add(id)
    collections.push({ id, readOnly, hidePasswords, manage })
  }
  return { ok: true, value: { type, collections } }
}

function parseNormalizedEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = normalizeEmail(value)
  if (
    !normalized ||
    !/^[^\s@]+@[^\s@]+$/u.test(normalized) ||
    [...normalized].some((character) => {
      const code = character.charCodeAt(0)
      return code < 32 || code === 127
    }) ||
    encoder.encode(normalized).byteLength >
      organizationMembershipPolicy.maxEmailLength
  )
    return null
  return normalized
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= organizationMembershipPolicy.maxIdLength &&
    /^[A-Za-z0-9_-]+$/u.test(value)
  )
}

function isInviteToken(value: unknown): value is string {
  // A 32-byte token has 43 base64url characters with two zero padding bits.
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u.test(value)
  )
}

function boundedString(value: unknown, maximumBytes: number): string | null {
  return typeof value === 'string' &&
    value.length > 0 &&
    encoder.encode(value).byteLength <= maximumBytes
    ? value
    : null
}

function normalizeProtocolObject(value: unknown): Map<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return null
  const normalized = new Map<string, unknown>()
  for (const [key, entry] of Object.entries(value)) {
    const canonical = key.toLowerCase()
    if (normalized.has(canonical)) return null
    normalized.set(canonical, entry)
  }
  return normalized
}

function hasOnlyFields(
  object: Map<string, unknown>,
  fields: Iterable<string>,
): boolean {
  const allowed = new Set(fields)
  return [...object.keys()].every((key) => allowed.has(key))
}

function invalidRequest<T>(): OrganizationMembershipParseResult<T> {
  return { ok: false, code: 'invalid_request' }
}
function unsupportedFeature<T>(): OrganizationMembershipParseResult<T> {
  return { ok: false, code: 'unsupported_feature' }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

function constantTimeEqual(left: string, right: string): boolean {
  let difference = left.length ^ right.length
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1)
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0)
  return difference === 0
}

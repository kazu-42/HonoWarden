export type TextSendOwnerRequest = {
  type: 0
  encryptedName: string
  encryptedNotes: string | null
  encryptedKey: string
  encryptedText: string
  textHidden: boolean
  authType: 1 | 2
  clientPasswordHash: string | null
  maxAccessCount: number | null
  expirationDate: string | null
  deletionDate: string
  disabled: boolean
  hideEmail: boolean
}

type TextSendParseResult =
  | { ok: true; value: TextSendOwnerRequest }
  | { ok: false; code: 'invalid_request' }

type TextSendCapabilityInput = {
  sendId: string
  ownerUserId: string
  envelopeKeyId: string
  envelopeSecret: string
  lookupKeyId: string
  lookupSecret: string
  randomBytes?: (bytes: Uint8Array) => Uint8Array
}

type TextSendCapabilityEnvelopeInput = Pick<
  TextSendCapabilityInput,
  'sendId' | 'ownerUserId' | 'envelopeKeyId' | 'envelopeSecret'
> & {
  capabilityEnvelope: string
}

type TextSendPasswordVerifierInput = {
  sendId: string
  keyId: string
  lookupSecret: string
  clientPasswordHash: string
}

type TextSendCapabilityVerifierInput = {
  keyId: string
  lookupSecret: string
  accessId: string
}

type VerifyTextSendPasswordInput = TextSendPasswordVerifierInput & {
  expectedVerifier: string
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
const capabilityEnvelopeDomain = 'honowarden:text-send:capability-envelope:v1'
const capabilityVerifierDomain = 'honowarden:text-send:capability-lookup:v1'
const passwordVerifierDomain = 'honowarden:text-send:password:v1'
const maximumDeletionWindowMilliseconds = 31 * 24 * 60 * 60 * 1000

const limits = {
  clientPasswordHash: 4096,
  encryptedKey: 32_768,
  encryptedName: 16_384,
  encryptedNotes: 32_768,
  encryptedText: 1_048_576,
  identifier: 128,
  keyId: 128,
} as const

export function parseTextSendOwnerRequest(
  body: unknown,
  context: { now: string; accessCount: number },
): TextSendParseResult {
  const object = normalizeProtocolObject(body)
  const now = parseIsoInstant(context.now)
  if (!object || now === null || !isCount(context.accessCount)) {
    return invalidRequest()
  }

  const type = object.get('type')
  const encryptedName = boundedString(object.get('name'), limits.encryptedName)
  const encryptedNotes = boundedNullableString(
    object.get('notes') ?? null,
    limits.encryptedNotes,
  )
  const encryptedKey = boundedString(object.get('key'), limits.encryptedKey)
  const text = normalizeProtocolObject(object.get('text'))
  const encryptedText = text
    ? boundedString(text.get('text'), limits.encryptedText)
    : null
  const textHidden = text?.get('hidden')
  const authType = object.get('authtype')
  const password = boundedNullableString(
    object.get('password') ?? null,
    limits.clientPasswordHash,
  )
  const emails = object.get('emails') ?? null
  const disabled = object.get('disabled')
  const hideEmail = object.get('hideemail')
  const maxAccessCount = object.get('maxaccesscount') ?? null
  const expirationDate = object.get('expirationdate') ?? null
  const deletionDate = object.get('deletiondate')
  const file = object.get('file')
  const fileLength = object.get('filelength')

  if (
    type !== 0 ||
    !encryptedName ||
    encryptedNotes === undefined ||
    !encryptedKey ||
    !text ||
    !encryptedText ||
    typeof textHidden !== 'boolean' ||
    (authType !== 1 && authType !== 2) ||
    password === undefined ||
    emails !== null ||
    typeof disabled !== 'boolean' ||
    typeof hideEmail !== 'boolean' ||
    (file !== undefined && file !== null) ||
    (fileLength !== undefined && fileLength !== null) ||
    !isNullableMaximum(maxAccessCount, context.accessCount) ||
    !isNullableDate(expirationDate) ||
    typeof deletionDate !== 'string'
  ) {
    return invalidRequest()
  }

  if ((authType === 1) !== (password !== null)) {
    return invalidRequest()
  }

  const deletionTimestamp = parseIsoInstant(deletionDate)
  const expirationTimestamp =
    expirationDate === null ? null : parseIsoInstant(expirationDate)
  if (
    deletionTimestamp === null ||
    deletionTimestamp <= now ||
    deletionTimestamp > now + maximumDeletionWindowMilliseconds ||
    (expirationDate !== null &&
      (expirationTimestamp === null ||
        expirationTimestamp <= now ||
        expirationTimestamp > deletionTimestamp))
  ) {
    return invalidRequest()
  }

  return {
    ok: true,
    value: {
      type: 0,
      encryptedName,
      encryptedNotes,
      encryptedKey,
      encryptedText,
      textHidden,
      authType,
      clientPasswordHash: password,
      maxAccessCount,
      expirationDate:
        expirationTimestamp === null
          ? null
          : new Date(expirationTimestamp).toISOString(),
      deletionDate: new Date(deletionTimestamp).toISOString(),
      disabled,
      hideEmail,
    },
  }
}

export function canonicalizeTextSendInstant(value: string): string | null {
  const timestamp = parseIsoInstant(value)
  return timestamp === null ? null : new Date(timestamp).toISOString()
}

export function resolveTextSendEnvelopeSecret(
  envelopeKeyId: string,
  envelopeSecrets: Readonly<Record<string, string>>,
): string {
  requireKeyId(envelopeKeyId)
  validateTextSendEnvelopeKeyring(envelopeSecrets)
  if (!Object.hasOwn(envelopeSecrets, envelopeKeyId)) {
    throw new Error('Text Send capability envelope key is unavailable.')
  }
  return envelopeSecrets[envelopeKeyId]!
}

export function nextTextSendRevisionDate(
  currentRevisionDate: string,
  candidateRevisionDate: string,
): string {
  const current = parseIsoInstant(currentRevisionDate)
  const candidate = parseIsoInstant(candidateRevisionDate)
  if (current === null || candidate === null) {
    throw new Error('Text Send revision dates must be valid.')
  }

  const next = new Date(Math.max(candidate, current + 1)).toISOString()
  if (parseIsoInstant(next) === null) {
    throw new Error('Text Send revision date cannot advance.')
  }
  return next
}

export function assertTextSendLookupRootIndependent(
  lookupSecret: string,
  envelopeSecrets: Readonly<Record<string, string>>,
): void {
  const entries = validateTextSendEnvelopeKeyring(envelopeSecrets)
  requireSecret(lookupSecret, 'Capability lookup secret')
  for (const [, envelopeSecret] of entries) {
    if (encodedValuesEqual(envelopeSecret, lookupSecret)) {
      throw new Error(
        'Text Send envelope and lookup roots must be independent.',
      )
    }
  }
}

export async function createTextSendCapability(
  input: TextSendCapabilityInput,
): Promise<{
  accessId: string
  capabilityEnvelope: string
  capabilityVerifier: string
  stored: {
    capabilityEnvelope: string
    capabilityEnvelopeKeyId: string
    capabilityVerifier: string
    capabilityVerifierKeyId: string
  }
}> {
  requireIdentifier(input.sendId, 'Send identifier')
  requireIdentifier(input.ownerUserId, 'Owner identifier')
  requireKeyId(input.envelopeKeyId)
  requireKeyId(input.lookupKeyId)
  requireSecret(input.envelopeSecret, 'Capability envelope secret')
  requireSecret(input.lookupSecret, 'Capability lookup secret')
  if (encodedValuesEqual(input.envelopeSecret, input.lookupSecret)) {
    throw new Error('Text Send envelope and lookup roots must be independent.')
  }

  const entropy = new Uint8Array(28)
  const filled = input.randomBytes
    ? input.randomBytes(entropy)
    : crypto.getRandomValues(entropy)
  if (filled !== entropy || filled.byteLength !== entropy.byteLength) {
    throw new Error('Text Send capability entropy source is invalid.')
  }

  const accessId = toBase64Url(entropy.slice(0, 16))
  const nonce = entropy.slice(16)
  const key = await deriveEnvelopeKey(input.envelopeSecret)
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      additionalData: envelopeAdditionalData(input),
      tagLength: 128,
    },
    key,
    encoder.encode(accessId),
  )
  const capabilityEnvelope = `v1.${toBase64Url(nonce)}.${toBase64Url(
    new Uint8Array(encrypted),
  )}`
  const capabilityVerifier = await createTextSendCapabilityVerifier({
    keyId: input.lookupKeyId,
    lookupSecret: input.lookupSecret,
    accessId,
  })

  return {
    accessId,
    capabilityEnvelope,
    capabilityVerifier,
    stored: {
      capabilityEnvelope,
      capabilityEnvelopeKeyId: input.envelopeKeyId,
      capabilityVerifier,
      capabilityVerifierKeyId: input.lookupKeyId,
    },
  }
}

export async function createTextSendCapabilityVerifier(
  input: TextSendCapabilityVerifierInput,
): Promise<string> {
  requireKeyId(input.keyId)
  requireSecret(input.lookupSecret, 'Send lookup secret')
  if (!/^[A-Za-z0-9_-]{22}$/u.test(input.accessId)) {
    throw new Error('Text Send access capability is invalid.')
  }
  return keyedVerifier(
    input.lookupSecret,
    capabilityVerifierDomain,
    input.keyId,
    input.accessId,
  )
}

export async function decryptTextSendCapability(
  input: TextSendCapabilityEnvelopeInput,
): Promise<string> {
  requireIdentifier(input.sendId, 'Send identifier')
  requireIdentifier(input.ownerUserId, 'Owner identifier')
  requireKeyId(input.envelopeKeyId)
  requireSecret(input.envelopeSecret, 'Capability envelope secret')

  const parts = input.capabilityEnvelope.split('.')
  if (
    parts.length !== 3 ||
    parts[0] !== 'v1' ||
    parts[1]?.length !== 16 ||
    parts[2]?.length !== 51
  ) {
    throw new Error('Text Send capability envelope is invalid.')
  }
  const nonce = fromBase64Url(parts[1] ?? '')
  const encrypted = fromBase64Url(parts[2] ?? '')
  if (
    nonce.byteLength !== 12 ||
    encrypted.byteLength !== 38 ||
    toBase64Url(nonce) !== parts[1] ||
    toBase64Url(encrypted) !== parts[2]
  ) {
    throw new Error('Text Send capability envelope is invalid.')
  }
  const key = await deriveEnvelopeKey(input.envelopeSecret)
  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      additionalData: envelopeAdditionalData(input),
      tagLength: 128,
    },
    key,
    encrypted,
  )
  const accessId = decoder.decode(decrypted)
  if (!/^[A-Za-z0-9_-]{22}$/u.test(accessId)) {
    throw new Error('Text Send capability value is invalid.')
  }
  return accessId
}

export async function createTextSendPasswordVerifier(
  input: TextSendPasswordVerifierInput,
): Promise<string> {
  requireIdentifier(input.sendId, 'Send identifier')
  requireKeyId(input.keyId)
  requireSecret(input.lookupSecret, 'Send lookup secret')
  if (!boundedString(input.clientPasswordHash, limits.clientPasswordHash)) {
    throw new Error('Text Send password input is invalid.')
  }
  return keyedVerifier(
    input.lookupSecret,
    passwordVerifierDomain,
    input.keyId,
    input.sendId,
    input.clientPasswordHash,
  )
}

export async function verifyTextSendPassword(
  input: VerifyTextSendPasswordInput,
): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/u.test(input.expectedVerifier)) {
    return false
  }
  const actual = await createTextSendPasswordVerifier(input)
  let mismatch = 0
  for (let index = 0; index < actual.length; index += 1) {
    mismatch |=
      actual.charCodeAt(index) ^ input.expectedVerifier.charCodeAt(index)
  }
  return mismatch === 0
}

function invalidRequest(): TextSendParseResult {
  return { ok: false, code: 'invalid_request' }
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

function boundedString(value: unknown, maximumBytes: number): string | null {
  return typeof value === 'string' &&
    value.length > 0 &&
    encoder.encode(value).byteLength <= maximumBytes
    ? value
    : null
}

function boundedNullableString(
  value: unknown,
  maximumBytes: number,
): string | null | undefined {
  if (value === null) return null
  return boundedString(value, maximumBytes) ?? undefined
}

function isCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function isNullableMaximum(
  value: unknown,
  accessCount: number,
): value is number | null {
  return (
    value === null ||
    (typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 1 &&
      value >= accessCount)
  )
}

function isNullableDate(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function parseIsoInstant(value: string): number | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    )
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const millisecond = Number((match[7] ?? '').padEnd(3, '0').slice(0, 3))
  const offsetHour = match[8] === 'Z' ? 0 : Number(match[10])
  const offsetMinute = match[8] === 'Z' ? 0 : Number(match[11])

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) {
    return null
  }

  const localCalendar = new Date(0)
  localCalendar.setUTCFullYear(year, month - 1, day)
  localCalendar.setUTCHours(hour, minute, second, millisecond)
  if (
    localCalendar.getUTCFullYear() !== year ||
    localCalendar.getUTCMonth() !== month - 1 ||
    localCalendar.getUTCDate() !== day ||
    localCalendar.getUTCHours() !== hour ||
    localCalendar.getUTCMinutes() !== minute ||
    localCalendar.getUTCSeconds() !== second ||
    localCalendar.getUTCMilliseconds() !== millisecond
  ) {
    return null
  }

  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function requireIdentifier(value: string, label: string): void {
  if (!boundedString(value, limits.identifier) || value.includes('\0')) {
    throw new Error(`${label} is invalid.`)
  }
}

function requireKeyId(value: string): void {
  if (!boundedString(value, limits.keyId) || value.includes('\0')) {
    throw new Error('Text Send key identifier is invalid.')
  }
}

function encodedValuesEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left)
  const rightBytes = encoder.encode(right)
  if (leftBytes.byteLength !== rightBytes.byteLength) return false
  let mismatch = 0
  for (let index = 0; index < leftBytes.byteLength; index += 1) {
    mismatch |= leftBytes[index]! ^ rightBytes[index]!
  }
  return mismatch === 0
}

function validateTextSendEnvelopeKeyring(
  envelopeSecrets: Readonly<Record<string, string>>,
): ReadonlyArray<readonly [string, string]> {
  const entries = Object.entries(envelopeSecrets)
  if (entries.length < 1 || entries.length > 3) {
    throw new Error('Text Send capability envelope keyring is invalid.')
  }
  for (const [keyId, envelopeSecret] of entries) {
    requireKeyId(keyId)
    requireSecret(envelopeSecret, 'Capability envelope secret')
  }
  return entries
}

function requireSecret(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || encoder.encode(value).byteLength < 32) {
    throw new Error(`${label} must be at least 32 bytes.`)
  }
}

async function deriveEnvelopeKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`${capabilityEnvelopeDomain}\0${secret}`),
  )
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
}

function envelopeAdditionalData(input: {
  sendId: string
  ownerUserId: string
  envelopeKeyId: string
}): Uint8Array {
  return encoder.encode(
    `${capabilityEnvelopeDomain}\0${input.envelopeKeyId}\0${input.ownerUserId}\0${input.sendId}`,
  )
}

async function keyedVerifier(
  secret: string,
  domain: string,
  ...values: string[]
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${domain}\0${values.join('\0')}`),
  )
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error('Text Send capability envelope is invalid.')
  }
  const padded = value.replaceAll('-', '+').replaceAll('_', '/')
  const withPadding = padded.padEnd(Math.ceil(padded.length / 4) * 4, '=')
  try {
    return Uint8Array.from(atob(withPadding), (character) =>
      character.charCodeAt(0),
    )
  } catch {
    throw new Error('Text Send capability envelope is invalid.')
  }
}

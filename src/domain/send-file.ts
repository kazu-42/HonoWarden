export type FileSendOwnerRequest = {
  type: 1
  encryptedName: string
  encryptedNotes: string | null
  encryptedKey: string
  encryptedFileName: string
  expectedSize: number
  authType: 1 | 2
  clientPasswordHash: string | null
  maxAccessCount: number | null
  expirationDate: string | null
  deletionDate: string
  disabled: boolean
  hideEmail: boolean
}

type FileSendParseResult =
  | { ok: true; value: FileSendOwnerRequest }
  | { ok: false; code: 'invalid_request' }

const encoder = new TextEncoder()
const maximumDeletionWindowMilliseconds = 31 * 24 * 60 * 60 * 1000
const objectEntropyBytes = 16
const downloadTicketEntropyBytes = 32
const downloadTicketVerifierDomain = 'honowarden:send-file:download-ticket:v1'
const uploadDeadlineMilliseconds = 20 * 60 * 1000
const limits = {
  clientPasswordHash: 4096,
  encryptedFileName: 16_384,
  encryptedKey: 32_768,
  encryptedName: 16_384,
  encryptedNotes: 32_768,
  expectedSize: 100 * 1024 * 1024,
  identifier: 128,
  keyId: 128,
} as const

export function parseFileSendOwnerRequest(
  body: unknown,
  context: { now: string; accessCount: number },
): FileSendParseResult {
  const object = normalizeProtocolObject(body)
  const now = parseIsoInstant(context.now)
  if (!object || now === null || !isCount(context.accessCount)) {
    return invalidRequest()
  }

  const file = normalizeProtocolObject(object.get('file'))
  const encryptedFileName = file
    ? boundedString(file.get('filename'), limits.encryptedFileName)
    : null
  const encryptedName = boundedString(object.get('name'), limits.encryptedName)
  const encryptedNotes = boundedNullableString(
    object.get('notes') ?? null,
    limits.encryptedNotes,
  )
  const encryptedKey = boundedString(object.get('key'), limits.encryptedKey)
  const expectedSize = object.get('filelength')
  const authType = object.get('authtype')
  const password = boundedNullableString(
    object.get('password') ?? null,
    limits.clientPasswordHash,
  )
  const deletionDate = object.get('deletiondate')
  const expirationDate = object.get('expirationdate') ?? null

  if (
    object.get('type') !== 1 ||
    !file ||
    !encryptedFileName ||
    file.get('objectkey') !== undefined ||
    object.get('text') !== undefined ||
    !encryptedName ||
    encryptedNotes === undefined ||
    !encryptedKey ||
    !isExpectedSize(expectedSize) ||
    (authType !== 1 && authType !== 2) ||
    password === undefined ||
    object.get('emails') !== null ||
    typeof object.get('disabled') !== 'boolean' ||
    typeof object.get('hideemail') !== 'boolean' ||
    !isNullableMaximum(
      object.get('maxaccesscount') ?? null,
      context.accessCount,
    ) ||
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
      type: 1,
      encryptedName,
      encryptedNotes,
      encryptedKey,
      encryptedFileName,
      expectedSize,
      authType,
      clientPasswordHash: password,
      maxAccessCount: (object.get('maxaccesscount') ?? null) as number | null,
      expirationDate:
        expirationTimestamp === null
          ? null
          : new Date(expirationTimestamp).toISOString(),
      deletionDate: new Date(deletionTimestamp).toISOString(),
      disabled: object.get('disabled') as boolean,
      hideEmail: object.get('hideemail') as boolean,
    },
  }
}

export function allocateSendFileObject(input: {
  sendId: string
  fileId: string
  objectGeneration: number
  randomBytes?: (bytes: Uint8Array) => Uint8Array
}): { objectKey: string; objectGeneration: number } {
  if (
    !boundedString(input.sendId, limits.identifier) ||
    input.sendId.includes('/') ||
    !boundedString(input.fileId, limits.identifier) ||
    input.fileId.includes('/') ||
    !Number.isSafeInteger(input.objectGeneration) ||
    input.objectGeneration < 1
  ) {
    throw new Error('File Send object allocation is invalid.')
  }

  const entropy = new Uint8Array(objectEntropyBytes)
  const fill = input.randomBytes ?? ((bytes) => crypto.getRandomValues(bytes))
  fill(entropy)
  const token = [...entropy]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return {
    objectGeneration: input.objectGeneration,
    objectKey: `sends/${input.sendId}/files/${input.fileId}/g${input.objectGeneration}/${token}`,
  }
}

export function fileSendUploadDeadlineAt(now: string): string | null {
  const timestamp = parseIsoInstant(now)
  return timestamp === null
    ? null
    : new Date(timestamp + uploadDeadlineMilliseconds).toISOString()
}

export async function createSendDownloadTicketMaterial(input: {
  keyId: string
  lookupSecret: string
  randomBytes?: (bytes: Uint8Array) => Uint8Array
}): Promise<{ ticketId: string; ticketVerifier: string }> {
  if (!boundedString(input.keyId, limits.keyId) || input.keyId.includes('\0')) {
    throw new Error('File Send download-ticket key identifier is invalid.')
  }
  if (encoder.encode(input.lookupSecret).byteLength < 32) {
    throw new Error(
      'File Send download-ticket lookup secret must be at least 32 bytes.',
    )
  }

  const entropy = new Uint8Array(downloadTicketEntropyBytes)
  const fill = input.randomBytes ?? ((bytes) => crypto.getRandomValues(bytes))
  const filled = fill(entropy)
  if (filled !== entropy || filled.byteLength !== entropy.byteLength) {
    throw new Error('File Send download-ticket entropy source is invalid.')
  }

  const ticketId = toBase64Url(entropy)
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(input.lookupSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(
      `${downloadTicketVerifierDomain}\0${input.keyId}\0${ticketId}`,
    ),
  )
  return {
    ticketId,
    ticketVerifier: [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join(''),
  }
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

function invalidRequest(): FileSendParseResult {
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

function isExpectedSize(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= limits.expectedSize
  )
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
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
    ? timestamp
    : null
}

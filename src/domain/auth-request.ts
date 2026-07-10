import { normalizeEmail } from './prelogin'

export const authRequestPolicy = {
  activeLifetimeSeconds: 15 * 60,
  maxAccessCodeLength: 512,
  maxDeviceIdentifierLength: 256,
  maxDeviceType: 1000,
  maxEmailLength: 254,
  maxEncryptedResponseKeyLength: 65_536,
  maxPublicKeyLength: 32_768,
  minAccessCodeLength: 16,
  terminalRetentionDays: 30,
} as const

export const authRequestQuotaPolicy = {
  blockSeconds: 15 * 60,
  createAccountLimit: 10,
  createDeviceLimit: 10,
  createNetworkLimit: 30,
  consumeAccountLimit: 20,
  consumeDeviceLimit: 20,
  consumeNetworkLimit: 60,
  pollAccountLimit: 120,
  pollDeviceLimit: 120,
  pollNetworkLimit: 300,
  windowSeconds: 15 * 60,
} as const

export type AuthRequestCreateInput = {
  emailNormalized: string
  requestPublicKey: string
  requestDeviceIdentifier: string
  requestDeviceType: number
  accessCode: string
  requestType: 0 | 1
}

export type AuthRequestResponseInput =
  | { requestApproved: true; encryptedResponseKey: string }
  | { requestApproved: false; encryptedResponseKey: null }

type ParseResult<T> = { ok: true; value: T } | { ok: false }

const verifierPrefix = 'hmac-sha256:'
const minimumSecretBytes = 32

export function isAuthRequestFeatureEnabled(
  value: string | undefined,
): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function parseAuthRequestCreateBody(
  body: unknown,
  fallbackDeviceType: number | null = null,
): ParseResult<AuthRequestCreateInput> {
  if (!isRecord(body)) {
    return { ok: false }
  }

  const email = readTrimmedString(body, 'email', 'Email')
  const requestPublicKey = readExactString(body, 'publicKey', 'PublicKey')
  const requestDeviceIdentifier = readTrimmedString(
    body,
    'deviceIdentifier',
    'DeviceIdentifier',
  )
  const bodyDeviceType = readNumber(body, 'deviceType', 'DeviceType')
  const requestDeviceType = Number.isNaN(bodyDeviceType)
    ? fallbackDeviceType
    : bodyDeviceType
  const accessCode = readExactString(body, 'accessCode', 'AccessCode')
  const requestType = readNumber(body, 'type', 'Type')
  const emailNormalized = email ? normalizeEmail(email) : null

  if (
    !emailNormalized ||
    emailNormalized.length > authRequestPolicy.maxEmailLength ||
    !isBoundedString(
      requestPublicKey,
      1,
      authRequestPolicy.maxPublicKeyLength,
    ) ||
    !isBoundedString(
      requestDeviceIdentifier,
      1,
      authRequestPolicy.maxDeviceIdentifierLength,
    ) ||
    requestDeviceType === null ||
    !Number.isInteger(requestDeviceType) ||
    requestDeviceType < 0 ||
    requestDeviceType > authRequestPolicy.maxDeviceType ||
    !isBoundedString(
      accessCode,
      authRequestPolicy.minAccessCodeLength,
      authRequestPolicy.maxAccessCodeLength,
    ) ||
    (requestType !== 0 && requestType !== 1)
  ) {
    return { ok: false }
  }

  return {
    ok: true,
    value: {
      emailNormalized,
      requestPublicKey,
      requestDeviceIdentifier,
      requestDeviceType,
      accessCode,
      requestType,
    },
  }
}

export function parseAuthRequestResponseBody(
  body: unknown,
): ParseResult<AuthRequestResponseInput> {
  if (!isRecord(body)) {
    return { ok: false }
  }

  const requestApproved = readBoolean(
    body,
    'requestApproved',
    'RequestApproved',
  )
  const encryptedResponseKey = readOptionalValue(body, 'key', 'Key')

  if (requestApproved === true) {
    if (
      !isBoundedString(
        encryptedResponseKey,
        1,
        authRequestPolicy.maxEncryptedResponseKeyLength,
      )
    ) {
      return { ok: false }
    }

    return {
      ok: true,
      value: { requestApproved: true, encryptedResponseKey },
    }
  }

  if (
    requestApproved === false &&
    (encryptedResponseKey === undefined || encryptedResponseKey === null)
  ) {
    return {
      ok: true,
      value: { requestApproved: false, encryptedResponseKey: null },
    }
  }

  return { ok: false }
}

export function buildAuthRequestTimestamps(createdAt: string): {
  createdAt: string
  expiresAt: string
  retentionDeleteAfter: string
} {
  const createdAtMs = Date.parse(createdAt)

  return {
    createdAt,
    expiresAt: new Date(
      createdAtMs + authRequestPolicy.activeLifetimeSeconds * 1000,
    ).toISOString(),
    retentionDeleteAfter: new Date(
      createdAtMs + authRequestPolicy.terminalRetentionDays * 86_400_000,
    ).toISOString(),
  }
}

export async function buildAuthRequestAccessCodeHash(
  secret: string,
  requestId: string,
  accessCode: string,
): Promise<string> {
  return buildVerifier(
    secret,
    `honowarden:auth-request:access-code:v1\0${requestId}\0${accessCode}`,
  )
}

export async function buildAuthRequestEmailHash(
  secret: string,
  normalizedEmail: string,
): Promise<string> {
  return buildVerifier(
    secret,
    `honowarden:auth-request:email:v1\0${normalizedEmail}`,
  )
}

export async function buildAuthRequestDeviceHash(
  secret: string,
  deviceIdentifier: string,
): Promise<string> {
  return buildVerifier(
    secret,
    `honowarden:auth-request:device:v1\0${deviceIdentifier}`,
  )
}

export async function verifyAuthRequestAccessCode(
  secret: string,
  requestId: string,
  accessCode: string,
  storedVerifier: string,
): Promise<boolean> {
  const signature = decodeVerifier(storedVerifier)
  if (!signature) {
    return false
  }

  const key = await importHmacKey(secret)

  return crypto.subtle.verify(
    'HMAC',
    key,
    signature,
    encode(
      `honowarden:auth-request:access-code:v1\0${requestId}\0${accessCode}`,
    ),
  )
}

async function buildVerifier(secret: string, value: string): Promise<string> {
  const key = await importHmacKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, encode(value))

  return `${verifierPrefix}${base64UrlEncode(new Uint8Array(signature))}`
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const encodedSecret = encode(secret)
  if (encodedSecret.byteLength < minimumSecretBytes) {
    throw new Error('Auth request secret must be at least 32 bytes.')
  }

  return crypto.subtle.importKey(
    'raw',
    encodedSecret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

function decodeVerifier(value: string): Uint8Array | null {
  if (!value.startsWith(verifierPrefix)) {
    return null
  }

  const encoded = value.slice(verifierPrefix.length)
  if (!/^[A-Za-z0-9_-]{43}$/.test(encoded)) {
    return null
  }

  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='
    const binary = atob(base64)

    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    return null
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readOptionalValue(
  body: Record<string, unknown>,
  ...keys: string[]
): unknown {
  for (const key of keys) {
    if (Object.hasOwn(body, key)) {
      return body[key]
    }
  }

  return undefined
}

function readExactString(
  body: Record<string, unknown>,
  ...keys: string[]
): string | null {
  const value = readOptionalValue(body, ...keys)

  return typeof value === 'string' ? value : null
}

function readTrimmedString(
  body: Record<string, unknown>,
  ...keys: string[]
): string | null {
  return readExactString(body, ...keys)?.trim() ?? null
}

function readNumber(body: Record<string, unknown>, ...keys: string[]): number {
  const value = readOptionalValue(body, ...keys)

  return typeof value === 'number' ? value : Number.NaN
}

function readBoolean(
  body: Record<string, unknown>,
  ...keys: string[]
): boolean | null {
  const value = readOptionalValue(body, ...keys)

  return typeof value === 'boolean' ? value : null
}

function isBoundedString(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.length >= minimumLength &&
    value.length <= maximumLength
  )
}

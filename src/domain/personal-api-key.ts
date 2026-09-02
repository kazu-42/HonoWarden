const personalClientIdPattern =
  /^user\.([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i
const organizationClientIdPattern =
  /^organization\.([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i
const verifierPrefix = 'hmac-sha256:v1:'

export const personalApiKeyPolicy = {
  maxClientIdLength: 128,
  maxDeviceIdentifierLength: 128,
  maxPresentedSecretLength: 256,
  secretBytes: 32,
  secretEncodedLength: 43,
  verifierSecretMinBytes: 32,
} as const

export type ApiKeyClientId =
  | { kind: 'user'; userId: string }
  | { kind: 'organization'; organizationId: string }

export function isPersonalApiKeyFeatureEnabled(
  value: string | undefined,
): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function buildPersonalApiKeyClientId(userId: string): string {
  return `user.${userId}`
}

export function parsePersonalApiKeyClientId(value: string): string | null {
  const parsed = parseApiKeyClientId(value)
  return parsed?.kind === 'user' ? parsed.userId : null
}

export function parseApiKeyClientId(value: string): ApiKeyClientId | null {
  if (value !== value.trim()) {
    return null
  }

  const personalMatch = personalClientIdPattern.exec(value)
  if (personalMatch?.[1]) {
    return { kind: 'user', userId: personalMatch[1].toLowerCase() }
  }

  const organizationMatch = organizationClientIdPattern.exec(value)
  if (organizationMatch?.[1]) {
    return {
      kind: 'organization',
      organizationId: organizationMatch[1].toLowerCase(),
    }
  }

  return null
}

export function generatePersonalApiKeySecret(): string {
  const bytes = new Uint8Array(personalApiKeyPolicy.secretBytes)
  crypto.getRandomValues(bytes)

  return base64UrlEncode(bytes)
}

export async function buildPersonalApiKeyVerifier(
  verifierSecret: string,
  userId: string,
  rawSecret: string,
): Promise<string> {
  const digest = await hmacSha256(
    verifierSecret,
    `honowarden:personal-api-key:v1:${userId}\u0000${rawSecret}`,
  )

  return `${verifierPrefix}${base64UrlEncode(digest)}`
}

export async function verifyPersonalApiKeySecret(
  verifierSecret: string,
  userId: string,
  presentedSecret: string,
  storedVerifier: string,
): Promise<boolean> {
  if (!storedVerifier.startsWith(verifierPrefix)) {
    return false
  }

  const expected = await buildPersonalApiKeyVerifier(
    verifierSecret,
    userId,
    presentedSecret,
  )

  return constantTimeEqual(expected, storedVerifier)
}

async function hmacSha256(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(value),
  )

  return new Uint8Array(signature)
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length)
  let difference = left.length ^ right.length

  for (let index = 0; index < maxLength; index += 1) {
    difference |= charCodeAt(left, index) ^ charCodeAt(right, index)
  }

  return difference === 0
}

function charCodeAt(value: string, index: number): number {
  return index < value.length ? value.charCodeAt(index) : 0
}

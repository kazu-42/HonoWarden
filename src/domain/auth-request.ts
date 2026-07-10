export const authRequestPolicy = {
  activeLifetimeSeconds: 15 * 60,
  terminalRetentionDays: 30,
} as const

const verifierPrefix = 'hmac-sha256:'
const minimumSecretBytes = 32

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

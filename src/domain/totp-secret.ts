const secretEnvelopeVersion = 'v1'
const secretEnvelopePurpose = 'honowarden:totp-secret:v1'
type SecretKeyUsage = 'encrypt' | 'decrypt'

export async function encryptTotpSecret(
  wrappingSecret: string,
  secretBase32: string,
): Promise<string> {
  const iv = new Uint8Array(12)
  crypto.getRandomValues(iv)

  const key = await importWrappingKey(wrappingSecret, ['encrypt'])
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode(secretEnvelopePurpose),
    },
    key,
    new TextEncoder().encode(secretBase32),
  )

  return [
    secretEnvelopeVersion,
    base64UrlEncodeBytes(iv),
    base64UrlEncodeBytes(new Uint8Array(ciphertext)),
  ].join('.')
}

export async function decryptTotpSecret(
  wrappingSecret: string,
  encryptedSecret: string,
): Promise<string | null> {
  const [version, encodedIv, encodedCiphertext] = encryptedSecret.split('.')
  if (
    version !== secretEnvelopeVersion ||
    !encodedIv ||
    !encodedCiphertext ||
    encryptedSecret.split('.').length !== 3
  ) {
    return null
  }

  try {
    const iv = base64UrlDecodeBytes(encodedIv)
    if (iv.length !== 12) {
      return null
    }

    const key = await importWrappingKey(wrappingSecret, ['decrypt'])
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: new TextEncoder().encode(secretEnvelopePurpose),
      },
      key,
      base64UrlDecodeBytes(encodedCiphertext),
    )

    return new TextDecoder().decode(plaintext)
  } catch {
    return null
  }
}

async function importWrappingKey(
  wrappingSecret: string,
  usages: SecretKeyUsage[],
): Promise<CryptoKey> {
  if (!wrappingSecret.trim()) {
    throw new Error('Missing TOTP wrapping secret.')
  }

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(wrappingSecret),
  )

  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, usages)
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecodeBytes(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

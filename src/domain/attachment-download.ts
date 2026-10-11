import type { AccessTokenSigner, AccessTokenVerifier } from './tokens'

const domain = 'honowarden:attachment-download:v1\0'
export const attachmentDownloadTtlSeconds = 120

export type AttachmentDownloadScope = {
  userId: string
  deviceIdentifier: string
  sessionId: string
  securityStamp: string
  cipherId: string
  attachmentId: string
  revisionDate: string
  origin: string
}

type Ticket = AttachmentDownloadScope & {
  kid: string | null
  iat: number
  exp: number
}

// This MAC domain cannot be used as vault authentication, even with the same
// rotating keyring. The URL authorizes only this object and live session.
export async function signAttachmentDownload(
  signer: AccessTokenSigner,
  scope: AttachmentDownloadScope,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const ticket: Ticket = {
    ...scope,
    kid: typeof signer === 'string' ? null : signer.id,
    iat: nowSeconds,
    exp: nowSeconds + attachmentDownloadTtlSeconds,
  }
  const payload = encode(new TextEncoder().encode(JSON.stringify(ticket)))
  const key = await importKey(
    typeof signer === 'string' ? signer : signer.secret,
  )
  const signature = await crypto.subtle.sign('HMAC', key, message(payload))
  return `${payload}.${encode(new Uint8Array(signature))}`
}

export async function verifyAttachmentDownload(
  verifier: AccessTokenVerifier,
  token: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<AttachmentDownloadScope | null> {
  if (token.length > 8192) return null
  try {
    const parts = token.split('.')
    if (parts.length !== 2) return null
    const [payload, signature] = parts
    if (!payload || !signature) return null
    const ticket: unknown = JSON.parse(
      new TextDecoder().decode(decode(payload)),
    )
    if (
      !isTicket(ticket) ||
      ticket.iat > nowSeconds ||
      ticket.exp <= nowSeconds ||
      ticket.exp - ticket.iat !== attachmentDownloadTtlSeconds
    )
      return null

    const candidates =
      typeof verifier === 'string'
        ? ticket.kid === null
          ? [verifier]
          : []
        : ticket.kid === null
          ? (verifier.legacySecrets ?? [])
          : [verifier.active, ...(verifier.previous ?? [])]
              .filter((key) => key.id === ticket.kid)
              .map((key) => key.secret)
    for (const secret of candidates) {
      if (
        await crypto.subtle.verify(
          'HMAC',
          await importKey(secret),
          decode(signature),
          message(payload),
        )
      ) {
        return ticket
      }
    }
  } catch {
    // Invalid encoding, JSON, or signature must never fall back to bearer auth.
  }
  return null
}

function isTicket(value: unknown): value is Ticket {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const ticket = value as Record<string, unknown>
  return (
    [
      'userId',
      'deviceIdentifier',
      'sessionId',
      'securityStamp',
      'cipherId',
      'attachmentId',
      'revisionDate',
      'origin',
    ].every(
      (key) =>
        typeof ticket[key] === 'string' &&
        ticket[key].length > 0 &&
        ticket[key].length <= 512,
    ) &&
    (ticket.kid === null || typeof ticket.kid === 'string') &&
    Number.isSafeInteger(ticket.iat) &&
    Number.isSafeInteger(ticket.exp)
  )
}

function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

function message(payload: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(`${domain}${payload}`))
}

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[\w-]+$/.test(value)) throw new Error('Invalid ticket encoding.')
  const bytes = Uint8Array.from(
    atob(value.replace(/-/g, '+').replace(/_/g, '/')),
    (char) => char.charCodeAt(0),
  )
  if (encode(bytes) !== value) throw new Error('Noncanonical ticket encoding.')
  return bytes
}

export const loginDefensePolicy = {
  accountFailureLimit: 5,
  accountFailureWindowSeconds: 15 * 60,
  accountLockoutSeconds: 15 * 60,
  ipFailureLimit: 20,
  ipFailureWindowSeconds: 60,
  ipRetryAfterSeconds: 60,
} as const

export type AccountFailureStateInput = {
  currentFailedCount: number
  lastFailedAt: string | null
  now: string
}

export type AccountFailureState = {
  failedCount: number
  failedAt: string
  lockedUntil: string | null
}

export function buildAccountFailureState(
  input: AccountFailureStateInput,
): AccountFailureState {
  const nowMs = Date.parse(input.now)
  const lastFailedAtMs = input.lastFailedAt ? Date.parse(input.lastFailedAt) : 0
  const insideFailureWindow =
    Number.isFinite(lastFailedAtMs) &&
    nowMs - lastFailedAtMs <=
      loginDefensePolicy.accountFailureWindowSeconds * 1000
  const failedCount = insideFailureWindow ? input.currentFailedCount + 1 : 1
  const lockedUntil =
    failedCount >= loginDefensePolicy.accountFailureLimit
      ? new Date(
          nowMs + loginDefensePolicy.accountLockoutSeconds * 1000,
        ).toISOString()
      : null

  return {
    failedCount,
    failedAt: input.now,
    lockedUntil,
  }
}

export function isAccountLocked(input: {
  lockedUntil: string | null
  now: string
}): boolean {
  if (!input.lockedUntil) {
    return false
  }

  return Date.parse(input.lockedUntil) > Date.parse(input.now)
}

export function extractClientAddress(headers: Headers): string {
  const directAddress = headers.get('CF-Connecting-IP')?.trim()
  if (directAddress) {
    return directAddress
  }

  const forwardedAddress = headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
  if (forwardedAddress) {
    return forwardedAddress
  }

  return 'unknown'
}

export async function buildAuthAttemptBucketKey(
  kind: 'account' | 'ip',
  value: string,
): Promise<string> {
  return `${kind}:${base64UrlEncodeBytes(await sha256(value))}`
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )

  return new Uint8Array(digest)
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

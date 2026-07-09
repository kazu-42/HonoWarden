export type RequestQuotaScope = 'anonymous' | 'authenticated'

export const requestQuotaPolicy = {
  anonymousLimit: 120,
  authenticatedLimit: 600,
  blockSeconds: 60,
  cleanupRetentionSeconds: 60 * 60,
  cleanupRowsPerSlice: 100,
  windowSeconds: 60,
} as const

export type RequestQuotaBucket = {
  bucketKey: string
  scope: RequestQuotaScope
  requestCount: number
  windowStartedAt: string
  blockedUntil: string | null
  updatedAt: string
}

export function isGlobalRequestQuotaEnabled(
  value: string | undefined,
): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function resolveRequestQuotaScope(headers: Headers): RequestQuotaScope {
  const authorization = headers.get('Authorization')?.trim() ?? ''

  return authorization.toLowerCase().startsWith('bearer ')
    ? 'authenticated'
    : 'anonymous'
}

export function requestQuotaLimitForScope(scope: RequestQuotaScope): number {
  return scope === 'authenticated'
    ? requestQuotaPolicy.authenticatedLimit
    : requestQuotaPolicy.anonymousLimit
}

export async function buildRequestQuotaBucketKey(
  scope: RequestQuotaScope,
  value: string,
): Promise<string> {
  return `request:${scope}:${base64UrlEncodeBytes(await sha256(value))}`
}

export function isRequestQuotaExceeded(
  bucket: RequestQuotaBucket,
  now: string,
): boolean {
  return Boolean(
    bucket.blockedUntil && Date.parse(bucket.blockedUntil) > Date.parse(now),
  )
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

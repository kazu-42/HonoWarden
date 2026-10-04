export const emailVerificationPolicy = {
  protocol: 'draft-hardt-email-verification-02',
  nonceBytes: 32,
  challengeTtlSeconds: 300,
  proofMaxAgeSeconds: 300,
  futureSkewSeconds: 30,
  maxBodyBytes: 16 * 1024,
  maxTokenBytes: 15 * 1024,
  maxDocumentBytes: 64 * 1024,
  maxKeys: 32,
  maxTrustedIssuers: 16,
  networkTimeoutMs: 5000,
  trustCacheTtlSeconds: 60,
  maxCacheEntries: 16,
  challengeLimit: 5,
  verifyLimit: 10,
  quotaWindowSeconds: 60,
} as const

export type EmailVerificationActor = {
  userId: string
  sessionId: string
  deviceIdentifier: string
  emailNormalized: string
  securityStamp: string
}
export type TrustedEmailIssuer = {
  emailDomain: string
  issuer: string
  jwksUri: string
}
export type EmailVerificationRuntimeBindings = {
  HONOWARDEN_EMAIL_VERIFICATION_ENABLED?: string
  HONOWARDEN_EMAIL_VERIFICATION_RP_ORIGIN?: string
  HONOWARDEN_EMAIL_VERIFICATION_ISSUERS?: string
}
export type EmailVerificationRuntimePolicy =
  | { status: 'disabled'; enabled: false }
  | { status: 'misconfigured'; enabled: false }
  | {
      status: 'ready'
      enabled: true
      audience: string
      issuers: readonly TrustedEmailIssuer[]
    }

type Algorithm = 'Ed25519' | 'ES256'
type JsonObject = Record<string, unknown>
type CompactJwt = {
  header: JsonObject
  payload: JsonObject
  signature: Uint8Array<ArrayBuffer>
  signingInput: string
  serialized: string
}
type Proof = { issuer: CompactJwt; binding: CompactJwt }

export function resolveEmailVerificationRuntimePolicy(
  bindings: EmailVerificationRuntimeBindings,
): EmailVerificationRuntimePolicy {
  const enabled = bindings.HONOWARDEN_EMAIL_VERIFICATION_ENABLED
  if (enabled === undefined || enabled === 'false')
    return { status: 'disabled', enabled: false }
  if (enabled !== 'true') return { status: 'misconfigured', enabled: false }
  const audience = bindings.HONOWARDEN_EMAIL_VERIFICATION_RP_ORIGIN ?? ''
  if (!isCanonicalHttpsOrigin(audience, false))
    return { status: 'misconfigured', enabled: false }
  const registry = parseUniqueJson(
    bindings.HONOWARDEN_EMAIL_VERIFICATION_ISSUERS ?? '',
  )
  if (
    !Array.isArray(registry) ||
    registry.length === 0 ||
    registry.length > emailVerificationPolicy.maxTrustedIssuers
  )
    return { status: 'misconfigured', enabled: false }
  const domains = new Set<string>()
  const issuers: TrustedEmailIssuer[] = []
  for (const value of registry) {
    if (
      !isObject(value) ||
      !exactKeys(value, ['emailDomain', 'issuer', 'jwksUri']) ||
      typeof value.emailDomain !== 'string' ||
      !isPublicDnsHostname(value.emailDomain) ||
      domains.has(value.emailDomain) ||
      typeof value.issuer !== 'string' ||
      !isCanonicalHttpsOrigin(value.issuer, true) ||
      typeof value.jwksUri !== 'string' ||
      !isTrustedHttpsResource(value.jwksUri)
    )
      return { status: 'misconfigured', enabled: false }
    domains.add(value.emailDomain)
    issuers.push({
      emailDomain: value.emailDomain,
      issuer: value.issuer,
      jwksUri: value.jwksUri,
    })
  }
  return { status: 'ready', enabled: true, audience, issuers }
}

export function generateEmailVerificationNonce(): string {
  return encodeBase64Url(
    crypto.getRandomValues(new Uint8Array(emailVerificationPolicy.nonceBytes)),
  )
}

export async function hashEmailVerificationNonce(
  nonce: string,
): Promise<string> {
  return encodeBase64Url(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(
          `honowarden-email-verification-nonce-v1\0${nonce}`,
        ),
      ),
    ),
  )
}

// These fields are untrusted until both signatures have been verified.
export function parseEmailVerificationProof(
  token: string,
): { issuer: string; email: string; nonce: string } | null {
  const proof = parseProof(token)
  return proof
    ? {
        issuer: proof.issuer.payload.iss as string,
        email: proof.issuer.payload.email as string,
        nonce: proof.binding.payload.nonce as string,
      }
    : null
}

export async function verifyEmailVerificationProof(
  token: string,
  expected: {
    issuer: string
    email: string
    audience: string
    nonceDigest: string
    nowUnixSeconds: number
    jwks: unknown
    allowedIssuerAlgorithms?: readonly string[]
  },
): Promise<{ ok: true } | { ok: false }> {
  const proof = parseProof(token)
  if (!proof || !Number.isFinite(expected.nowUnixSeconds)) return { ok: false }
  const evt = proof.issuer
  const kb = proof.binding
  if (
    expected.allowedIssuerAlgorithms !== undefined &&
    !expected.allowedIssuerAlgorithms.includes(evt.header.alg as string)
  )
    return { ok: false }
  if (
    evt.payload.iss !== expected.issuer ||
    evt.payload.email !== expected.email ||
    kb.payload.aud !== expected.audience ||
    !acceptableTime(evt.payload, expected.nowUnixSeconds) ||
    !acceptableTime(kb.payload, expected.nowUnixSeconds)
  )
    return { ok: false }
  const nonceDigest = await hashEmailVerificationNonce(
    kb.payload.nonce as string,
  )
  if (!equalDigest(nonceDigest, expected.nonceDigest)) return { ok: false }
  const sdHash = encodeBase64Url(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(`${evt.serialized}~`),
      ),
    ),
  )
  if (!equalDigest(sdHash, kb.payload.sd_hash as string)) return { ok: false }
  if (
    !isObject(expected.jwks) ||
    !Array.isArray(expected.jwks.keys) ||
    expected.jwks.keys.length === 0 ||
    expected.jwks.keys.length > emailVerificationPolicy.maxKeys
  )
    return { ok: false }
  const matching = expected.jwks.keys.filter(
    (key: unknown) => isObject(key) && key.kid === evt.header.kid,
  )
  if (matching.length !== 1 || !isObject(matching[0])) return { ok: false }
  const holder = (evt.payload.cnf as JsonObject).jwk as JsonObject
  if (holder.alg !== kb.header.alg) return { ok: false }
  const issuerVerified = await verifySignature(evt, matching[0], false)
  if (!issuerVerified || !(await verifySignature(kb, holder, true)))
    return { ok: false }
  return { ok: true }
}

function parseProof(token: string): Proof | null {
  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > emailVerificationPolicy.maxTokenBytes ||
    !/^[A-Za-z0-9_.~-]+$/.test(token)
  )
    return null
  const sections = token.split('~')
  if (sections.length !== 2 || !sections[0] || !sections[1]) return null
  const issuer = parseJwt(sections[0])
  const binding = parseJwt(sections[1])
  if (
    !issuer ||
    !binding ||
    !validHeader(issuer.header, 'evt+jwt') ||
    !validHeader(binding.header, 'kb+jwt')
  )
    return null
  const evt = issuer.payload
  const kb = binding.payload
  if (
    typeof evt.iss !== 'string' ||
    typeof evt.email !== 'string' ||
    evt.email.length === 0 ||
    evt.email.length > 320 ||
    evt.email_verified !== true ||
    !isObject(evt.cnf) ||
    !exactKeys(evt.cnf, ['jwk']) ||
    !isObject(evt.cnf.jwk) ||
    '_sd' in evt ||
    '_sd_alg' in evt ||
    'disclosures' in evt ||
    typeof kb.aud !== 'string' ||
    typeof kb.nonce !== 'string' ||
    decodeBase64Url(kb.nonce)?.length !== emailVerificationPolicy.nonceBytes ||
    typeof kb.sd_hash !== 'string' ||
    decodeBase64Url(kb.sd_hash)?.length !== 32 ||
    !finiteTimeClaims(evt) ||
    !finiteTimeClaims(kb) ||
    ('is_private_email' in evt && typeof evt.is_private_email !== 'boolean')
  )
    return null
  return { issuer, binding }
}

function parseJwt(serialized: string): CompactJwt | null {
  const parts = serialized.split('.')
  if (parts.length !== 3 || parts.some((part) => !part)) return null
  const headerBytes = decodeBase64Url(parts[0]!)
  const payloadBytes = decodeBase64Url(parts[1]!)
  const signature = decodeBase64Url(parts[2]!)
  if (
    !headerBytes ||
    headerBytes.length > 2048 ||
    !payloadBytes ||
    !signature ||
    signature.length !== 64
  )
    return null
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
    if (hasBom(headerBytes) || hasBom(payloadBytes)) return null
    const header = parseUniqueJson(decoder.decode(headerBytes))
    const payload = parseUniqueJson(decoder.decode(payloadBytes))
    if (!isObject(header) || !isObject(payload)) return null
    return {
      header,
      payload,
      signature,
      signingInput: `${parts[0]}.${parts[1]}`,
      serialized,
    }
  } catch {
    return null
  }
}

function validHeader(header: JsonObject, type: 'evt+jwt' | 'kb+jwt'): boolean {
  const required = type === 'evt+jwt' ? ['alg', 'kid', 'typ'] : ['alg', 'typ']
  return (
    exactKeys(header, required) &&
    header.typ === type &&
    isAlgorithm(header.alg) &&
    (type !== 'evt+jwt' ||
      (typeof header.kid === 'string' &&
        /^[\x21-\x7e]{1,128}$/.test(header.kid)))
  )
}

async function verifySignature(
  token: CompactJwt,
  key: JsonObject,
  holder: boolean,
): Promise<boolean> {
  const algorithm = token.header.alg
  if (
    !isAlgorithm(algorithm) ||
    ((holder || key.alg !== undefined) && key.alg !== algorithm) ||
    Object.keys(key).some((name) =>
      ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k', 'jku', 'x5u'].includes(
        name,
      ),
    ) ||
    (key.use !== undefined && key.use !== 'sig') ||
    (key.key_ops !== undefined &&
      (!Array.isArray(key.key_ops) ||
        key.key_ops.length !== 1 ||
        key.key_ops[0] !== 'verify'))
  )
    return false
  const x = typeof key.x === 'string' ? decodeBase64Url(key.x) : null
  if (!x || x.length !== 32) return false
  let projected: JsonWebKey
  if (algorithm === 'Ed25519') {
    if (key.kty !== 'OKP' || key.crv !== 'Ed25519' || key.y !== undefined)
      return false
    projected = { kty: 'OKP', crv: 'Ed25519', x: key.x as string }
  } else {
    const y = typeof key.y === 'string' ? decodeBase64Url(key.y) : null
    if (key.kty !== 'EC' || key.crv !== 'P-256' || !y || y.length !== 32)
      return false
    projected = {
      kty: 'EC',
      crv: 'P-256',
      x: key.x as string,
      y: key.y as string,
    }
  }
  try {
    // Validate the original wire alg above; some runtimes use older JOSE names when importing JWKs.
    const imported = await crypto.subtle.importKey(
      'jwk',
      projected,
      algorithm === 'Ed25519'
        ? { name: 'Ed25519' }
        : { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
    return await crypto.subtle.verify(
      algorithm === 'Ed25519' ? 'Ed25519' : { name: 'ECDSA', hash: 'SHA-256' },
      imported,
      token.signature,
      new TextEncoder().encode(token.signingInput),
    )
  } catch {
    return false
  }
}

function finiteTimeClaims(payload: JsonObject): boolean {
  return (
    typeof payload.iat === 'number' &&
    Number.isFinite(payload.iat) &&
    payload.iat >= 0 &&
    (payload.exp === undefined ||
      (typeof payload.exp === 'number' &&
        Number.isFinite(payload.exp) &&
        payload.exp > payload.iat))
  )
}
function acceptableTime(payload: JsonObject, now: number): boolean {
  const issued = payload.iat as number
  return (
    issued >= now - emailVerificationPolicy.proofMaxAgeSeconds &&
    issued <= now + emailVerificationPolicy.futureSkewSeconds &&
    (payload.exp === undefined || (payload.exp as number) > now)
  )
}
function isAlgorithm(value: unknown): value is Algorithm {
  return value === 'Ed25519' || value === 'ES256'
}
function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function exactKeys(value: JsonObject, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  )
}
function hasBom(bytes: Uint8Array): boolean {
  return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
}
function equalDigest(first: string, second: string): boolean {
  if (first.length !== second.length) return false
  let different = 0
  for (let index = 0; index < first.length; index += 1)
    different |= first.charCodeAt(index) ^ second.charCodeAt(index)
  return different === 0
}

export function isPublicDnsHostname(value: string): boolean {
  return (
    value.length <= 253 &&
    value === value.toLowerCase() &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(
      value,
    ) &&
    value.split('.').every((label) => label.length <= 63) &&
    /[a-z]/.test(value.split('.').at(-1) ?? '') &&
    !/(?:^|\.)(?:localhost|local|internal|home|lan)$/.test(value)
  )
}
export function isCanonicalHttpsOrigin(
  value: string,
  publicHost: boolean,
): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.origin === value &&
      url.username === '' &&
      url.password === '' &&
      url.port === '' &&
      (!publicHost || isPublicDnsHostname(url.hostname))
    )
  } catch {
    return false
  }
}
export function isTrustedHttpsResource(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      value.length <= 2048 &&
      url.href === value &&
      isCanonicalHttpsOrigin(url.origin, true) &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      /^\/[A-Za-z0-9/_.~-]*$/.test(url.pathname)
    )
  } catch {
    return false
  }
}

// Preserve JSON member ambiguity detection before JSON.parse discards duplicates.
export function parseUniqueJson(raw: string): unknown | null {
  try {
    const value: unknown = JSON.parse(raw)
    const tokens = raw.match(/"(?:\\.|[^"\\])*"|[{}[\]:,]/gu) ?? []
    const stack: Array<Set<string> | null> = []
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index]
      if (token === '{') stack.push(new Set())
      else if (token === '[') stack.push(null)
      else if (token === '}' || token === ']') stack.pop()
      else if (token?.startsWith('"') && tokens[index + 1] === ':') {
        const names = stack.at(-1)
        const name = JSON.parse(token) as string
        if (!names || names.has(name)) return null
        names.add(name)
      }
    }
    return value
  } catch {
    return null
  }
}

function encodeBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}
function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return null
  try {
    const bytes = Uint8Array.from(
      atob(value.replace(/-/g, '+').replace(/_/g, '/')),
      (character) => character.charCodeAt(0),
    )
    return encodeBase64Url(bytes) === value ? bytes : null
  } catch {
    return null
  }
}

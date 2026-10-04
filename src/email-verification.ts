import {
  emailVerificationPolicy,
  generateEmailVerificationNonce,
  hashEmailVerificationNonce,
  isCanonicalHttpsOrigin,
  isPublicDnsHostname,
  isTrustedHttpsResource,
  parseEmailVerificationProof,
  parseUniqueJson,
  verifyEmailVerificationProof,
  type EmailVerificationActor,
  type EmailVerificationRuntimePolicy,
  type TrustedEmailIssuer,
} from './domain/email-verification'
import {
  buildRequestQuotaBucketKey,
  isRequestQuotaExceeded,
} from './domain/request-quota'
import { recordRequestQuotaHit } from './repositories/request-quota-repository'
import {
  cleanupExpiredEmailVerificationChallenges,
  consumeEmailVerificationChallenge,
  createEmailVerificationChallengeRecord,
  findEmailVerificationChallenge,
} from './repositories/email-verification-repository'

type ReadyPolicy = Extract<EmailVerificationRuntimePolicy, { status: 'ready' }>
export type EmailIssuerResolver = {
  resolve: (
    issuer: TrustedEmailIssuer,
  ) => Promise<{ jwks: unknown; algorithms: readonly string[] }>
}
export type EmailVerificationResult =
  | { status: 'success'; body: Record<string, unknown> }
  | { status: 'invalid_request' | 'issuer_unsupported' }
  | { status: 'rate_limited'; retryAfter: number }

export class EmailVerificationUnavailable extends Error {
  readonly reason = 'issuer_unavailable'
  constructor() {
    super('Email verification issuer trust is unavailable.')
  }
}

export async function createEmailVerificationChallenge(
  database: D1Database,
  input: { actor: EmailVerificationActor; policy: ReadyPolicy; now: Date },
): Promise<EmailVerificationResult> {
  if (!trustedIssuerForEmail(input.policy, input.actor.emailNormalized))
    return { status: 'issuer_unsupported' }
  const now = input.now.toISOString()
  if (await overQuota(database, input.actor, 'challenge', now))
    return {
      status: 'rate_limited',
      retryAfter: emailVerificationPolicy.quotaWindowSeconds,
    }
  await cleanupExpiredEmailVerificationChallenges(database, now)
  const nonce = generateEmailVerificationNonce()
  const challengeId = crypto.randomUUID()
  const expiresAt = new Date(
    input.now.getTime() + emailVerificationPolicy.challengeTtlSeconds * 1000,
  ).toISOString()
  const created = await createEmailVerificationChallengeRecord(database, {
    actor: input.actor,
    id: challengeId,
    nonceDigest: await hashEmailVerificationNonce(nonce),
    audience: input.policy.audience,
    now,
    expiresAt,
  })
  if (!created) return { status: 'invalid_request' }
  return {
    status: 'success',
    body: {
      object: 'emailVerificationChallenge',
      challengeId,
      nonce,
      email: input.actor.emailNormalized,
      audience: input.policy.audience,
      expiresAt,
      protocol: emailVerificationPolicy.protocol,
    },
  }
}

export async function verifyEmailVerification(
  database: D1Database,
  input: {
    actor: EmailVerificationActor
    policy: ReadyPolicy
    challengeId: string
    token: string
    resolver: EmailIssuerResolver
    requestId: string
    now: () => Date
  },
): Promise<EmailVerificationResult> {
  const issuer = trustedIssuerForEmail(
    input.policy,
    input.actor.emailNormalized,
  )
  if (!issuer) return { status: 'issuer_unsupported' }
  if (
    await overQuota(database, input.actor, 'verify', input.now().toISOString())
  )
    return {
      status: 'rate_limited',
      retryAfter: emailVerificationPolicy.quotaWindowSeconds,
    }
  const challenge = await findEmailVerificationChallenge(database, {
    actor: input.actor,
    id: input.challengeId,
    audience: input.policy.audience,
    now: input.now().toISOString(),
  })
  const proof = parseEmailVerificationProof(input.token)
  if (
    !challenge ||
    !proof ||
    proof.email !== input.actor.emailNormalized ||
    proof.issuer !== issuer.issuer ||
    (await hashEmailVerificationNonce(proof.nonce)) !== challenge.nonceDigest
  )
    return { status: 'invalid_request' }
  const trust = await input.resolver.resolve(issuer)
  const now = input.now()
  const verified = await verifyEmailVerificationProof(input.token, {
    issuer: issuer.issuer,
    email: input.actor.emailNormalized,
    audience: input.policy.audience,
    nonceDigest: challenge.nonceDigest,
    nowUnixSeconds: now.getTime() / 1000,
    jwks: trust.jwks,
    allowedIssuerAlgorithms: trust.algorithms,
  })
  if (!verified.ok) return { status: 'invalid_request' }
  const committed = await consumeEmailVerificationChallenge(database, {
    actor: input.actor,
    id: input.challengeId,
    nonceDigest: challenge.nonceDigest,
    audience: input.policy.audience,
    now: input.now().toISOString(),
    mutationId: crypto.randomUUID(),
    requestId: input.requestId,
  })
  return committed
    ? {
        status: 'success',
        body: { object: 'emailVerification', verified: true, method: 'evp' },
      }
    : { status: 'invalid_request' }
}

async function overQuota(
  database: D1Database,
  actor: EmailVerificationActor,
  operation: 'challenge' | 'verify',
  now: string,
): Promise<boolean> {
  const bucket = await recordRequestQuotaHit(database, {
    bucketKey: await buildRequestQuotaBucketKey(
      'authenticated',
      `email-verification:${operation}:${actor.userId}`,
    ),
    scope: 'authenticated',
    limit:
      operation === 'challenge'
        ? emailVerificationPolicy.challengeLimit
        : emailVerificationPolicy.verifyLimit,
    windowSeconds: emailVerificationPolicy.quotaWindowSeconds,
    blockSeconds: emailVerificationPolicy.quotaWindowSeconds,
    now,
  })
  return isRequestQuotaExceeded(bucket, now)
}
function trustedIssuerForEmail(
  policy: ReadyPolicy,
  email: string,
): TrustedEmailIssuer | undefined {
  return policy.issuers.find(
    (entry) => entry.emailDomain === email.slice(email.lastIndexOf('@') + 1),
  )
}

export function createEmailIssuerResolver(
  fetcher: typeof fetch = fetch,
  clock: () => number = () => Date.now(),
): EmailIssuerResolver {
  const cache = new Map<
    string,
    { expiresAt: number; jwks: unknown; algorithms: readonly string[] }
  >()
  return {
    async resolve(entry) {
      if (
        !isPublicDnsHostname(entry.emailDomain) ||
        !isCanonicalHttpsOrigin(entry.issuer, true) ||
        !isTrustedHttpsResource(entry.jwksUri)
      )
        throw new EmailVerificationUnavailable()
      const key = JSON.stringify(entry)
      const cached = cache.get(key)
      if (cached && cached.expiresAt > clock())
        return { jwks: cached.jwks, algorithms: cached.algorithms }
      cache.delete(key)
      const deadline = clock() + emailVerificationPolicy.networkTimeoutMs
      const owner = `_email-verification.${entry.emailDomain}`
      const dns = await fetchDocument(
        fetcher,
        `https://cloudflare-dns.com/dns-query?name=${owner}&type=TXT`,
        deadline,
        clock,
      )
      const dnsReceivedAt = clock()
      const delegation = readDelegation(dns, owner)
      if (!delegation || `https://${delegation.host}` !== entry.issuer)
        throw new EmailVerificationUnavailable()
      const delegationExpiresAt = dnsReceivedAt + delegation.ttl * 1000
      const metadata = await fetchDocument(
        fetcher,
        `${entry.issuer}/.well-known/email-verification`,
        deadline,
        clock,
      )
      if (
        !isObject(metadata) ||
        metadata.issuer !== entry.issuer ||
        metadata.jwks_uri !== entry.jwksUri ||
        typeof metadata.issuance_endpoint !== 'string' ||
        !isTrustedHttpsResource(metadata.issuance_endpoint) ||
        !validAdvertisedAlgorithms(metadata.signing_alg_values_supported)
      )
        throw new EmailVerificationUnavailable()
      const jwks = await fetchDocument(fetcher, entry.jwksUri, deadline, clock)
      const algorithms = (metadata.signing_alg_values_supported ?? [
        'Ed25519',
      ]) as readonly string[]
      if (
        !isObject(jwks) ||
        !Array.isArray(jwks.keys) ||
        jwks.keys.length === 0 ||
        jwks.keys.length > emailVerificationPolicy.maxKeys ||
        jwks.keys.some((key) => !isObject(key)) ||
        clock() >= deadline
      )
        throw new EmailVerificationUnavailable()
      const completedAt = clock()
      const expiresAt = Math.min(
        delegationExpiresAt,
        completedAt + emailVerificationPolicy.trustCacheTtlSeconds * 1000,
      )
      if (expiresAt > completedAt) {
        if (cache.size >= emailVerificationPolicy.maxCacheEntries) {
          const first = cache.keys().next().value
          if (first !== undefined) cache.delete(first)
        }
        cache.set(key, { expiresAt, jwks, algorithms })
      }
      return { jwks, algorithms }
    },
  }
}

async function fetchDocument(
  fetcher: typeof fetch,
  url: string,
  deadline: number,
  clock: () => number,
): Promise<unknown> {
  const remaining = deadline - clock()
  if (!Number.isFinite(remaining) || remaining <= 0)
    throw new EmailVerificationUnavailable()
  const controller = new AbortController()
  let response: Response | undefined
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      if (activeReader) void activeReader.cancel().catch(() => undefined)
      else void response?.body?.cancel().catch(() => undefined)
      reject(new EmailVerificationUnavailable())
    }, remaining)
  })
  try {
    return await Promise.race([
      timeout,
      (async () => {
        response = await fetcher(url, {
          method: 'GET',
          headers: {
            Accept:
              'application/json, application/dns-json, application/jwk-set+json',
          },
          redirect: 'error',
          signal: controller.signal,
        })
        if (
          controller.signal.aborted ||
          response.status !== 200 ||
          !response.body ||
          !/^(?:application\/json|application\/dns-json|application\/jwk-set\+json)(?:;|$)/i.test(
            response.headers.get('Content-Type') ?? '',
          )
        )
          throw new EmailVerificationUnavailable()
        const contentLength = response.headers.get('Content-Length')
        if (
          contentLength !== null &&
          (!/^\d+$/.test(contentLength) ||
            !Number.isSafeInteger(Number(contentLength)) ||
            Number(contentLength) > emailVerificationPolicy.maxDocumentBytes)
        )
          throw new EmailVerificationUnavailable()
        const reader = response.body.getReader()
        activeReader = reader
        const chunks: string[] = []
        let bytes = 0
        const decoder = new TextDecoder('utf-8', {
          fatal: true,
          ignoreBOM: false,
        })
        try {
          while (true) {
            const chunk = await reader.read()
            if (chunk.done) break
            bytes += chunk.value.byteLength
            if (bytes > emailVerificationPolicy.maxDocumentBytes)
              throw new EmailVerificationUnavailable()
            chunks.push(decoder.decode(chunk.value, { stream: true }))
          }
          chunks.push(decoder.decode())
          const parsed = parseUniqueJson(chunks.join(''))
          if (parsed === null || clock() >= deadline)
            throw new EmailVerificationUnavailable()
          return parsed
        } finally {
          void reader.cancel().catch(() => undefined)
          reader.releaseLock()
          activeReader = undefined
        }
      })(),
    ])
  } catch {
    throw new EmailVerificationUnavailable()
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    controller.abort()
    if (activeReader) void activeReader.cancel().catch(() => undefined)
    else void response?.body?.cancel().catch(() => undefined)
  }
}

function readDelegation(
  value: unknown,
  owner: string,
): { host: string; ttl: number } | null {
  if (
    !isObject(value) ||
    value.Status !== 0 ||
    !Array.isArray(value.Question) ||
    value.Question.length !== 1 ||
    !isObject(value.Question[0]) ||
    !sameOwner(value.Question[0].name, owner) ||
    value.Question[0].type !== 16 ||
    !Array.isArray(value.Answer) ||
    value.Answer.length !== 1 ||
    !isObject(value.Answer[0])
  )
    return null
  const answer = value.Answer[0]
  if (
    !sameOwner(answer.name, owner) ||
    answer.type !== 16 ||
    typeof answer.data !== 'string'
  )
    return null
  const text = readTxtChunks(answer.data)
  if (!text?.startsWith('iss=')) return null
  const host = text.slice(4)
  if (!isPublicDnsHostname(host)) return null
  const ttl =
    typeof answer.TTL === 'number' &&
    Number.isFinite(answer.TTL) &&
    answer.TTL >= 0
      ? answer.TTL
      : 0
  return { host, ttl }
}
function sameOwner(value: unknown, owner: string): boolean {
  return value === owner || value === `${owner}.`
}
function readTxtChunks(raw: string): string | null {
  let cursor = 0,
    result = '',
    chunks = 0
  while (cursor < raw.length) {
    while (raw[cursor] === ' ' || raw[cursor] === '\t') cursor += 1
    if (cursor === raw.length) break
    if (raw[cursor] !== '"') return null
    cursor += 1
    chunks += 1
    while (cursor < raw.length && raw[cursor] !== '"') {
      let character = raw[cursor++]!
      if (character === '\\') {
        const escaped = raw[cursor++]
        if (escaped === '"' || escaped === '\\') character = escaped
        else if (
          escaped !== undefined &&
          /^\d$/.test(escaped) &&
          /^\d{2}$/.test(raw.slice(cursor, cursor + 2))
        ) {
          character = String.fromCharCode(
            Number(escaped + raw.slice(cursor, cursor + 2)),
          )
          cursor += 2
        } else return null
      }
      result += character
    }
    if (raw[cursor++] !== '"') return null
    if (cursor < raw.length && raw[cursor] !== ' ' && raw[cursor] !== '\t')
      return null
  }
  return chunks > 0 ? result : null
}
function validAdvertisedAlgorithms(value: unknown): boolean {
  if (value === undefined) return true
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 16 &&
    value.every(
      (algorithm) =>
        typeof algorithm === 'string' &&
        [
          'Ed25519',
          'Ed448',
          'ES256',
          'ES384',
          'ES512',
          'RS256',
          'RS384',
          'RS512',
          'PS256',
          'PS384',
          'PS512',
        ].includes(algorithm),
    )
  )
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

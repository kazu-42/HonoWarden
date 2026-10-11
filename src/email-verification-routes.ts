import type { Context, Env, Hono } from 'hono'
import {
  emailVerificationPolicy,
  parseUniqueJson,
  type EmailVerificationActor,
  type EmailVerificationRuntimePolicy,
} from './domain/email-verification'
import {
  createEmailIssuerResolver,
  createEmailVerificationChallenge,
  EmailVerificationUnavailable,
  verifyEmailVerification,
} from './email-verification'

type Operation = 'challenge' | 'verify'
export type EmailVerificationRouteDependencies<E extends Env> = {
  authenticate: (
    context: Context<E>,
  ) => Promise<
    | { ok: true; actor: EmailVerificationActor }
    | { ok: false; response: Response }
  >
  runtime: (context: Context<E>) => {
    database: D1Database
    policy: EmailVerificationRuntimePolicy
  }
  requestId: (context: Context<E>) => string
  reportFailure: (
    context: Context<E>,
    failure: {
      code: 'email_verification_unavailable'
      operation: Operation
      reason: 'configuration' | 'issuer_unavailable' | 'operation_failed'
    },
  ) => void | Promise<void>
  fetcher?: typeof fetch
}

export function registerEmailVerificationRoutes<E extends Env>(
  app: Hono<E>,
  dependencies: EmailVerificationRouteDependencies<E>,
): void {
  const resolver = createEmailIssuerResolver(dependencies.fetcher ?? fetch)
  const route =
    (operation: Operation) =>
    async (c: Context<E>): Promise<Response> => {
      c.header('Cache-Control', 'no-store')
      const error = (
        code: string,
        message: string,
        status: 400 | 429 | 501 | 503,
      ) =>
        c.json(
          { error: { code, message }, requestId: dependencies.requestId(c) },
          status,
        )
      try {
        const runtime = dependencies.runtime(c)
        if (runtime.policy.status === 'disabled')
          return error(
            'unsupported_feature',
            'Email Verification Protocol is unavailable on this server.',
            501,
          )
        if (runtime.policy.status === 'misconfigured') {
          await dependencies.reportFailure(c, {
            code: 'email_verification_unavailable',
            operation,
            reason: 'configuration',
          })
          return error(
            'server_misconfigured',
            'Email verification is not configured.',
            503,
          )
        }
        const auth = await dependencies.authenticate(c)
        if (!auth.ok) {
          const headers = new Headers(auth.response.headers)
          headers.set('Cache-Control', 'no-store')
          return new Response(auth.response.body, {
            status: auth.response.status,
            statusText: auth.response.statusText,
            headers,
          })
        }
        if (
          c.req.header('Origin') !== runtime.policy.audience ||
          Object.keys(c.req.queries()).length > 0
        )
          return error(
            'invalid_request',
            'Email verification origin or query is invalid.',
            400,
          )
        const body = await readBody(c.req.raw)
        if (body === null || typeof body !== 'object' || Array.isArray(body))
          return error(
            'invalid_request',
            'Email verification payload is invalid.',
            400,
          )
        const payload = body as Record<string, unknown>
        let result
        if (operation === 'challenge') {
          if (Object.keys(payload).length !== 0)
            return error(
              'invalid_request',
              'Email verification challenge payload is invalid.',
              400,
            )
          result = await createEmailVerificationChallenge(runtime.database, {
            actor: auth.actor,
            policy: runtime.policy,
            now: new Date(),
          })
        } else {
          if (
            Object.keys(payload).length !== 2 ||
            typeof payload.challengeId !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
              payload.challengeId,
            ) ||
            typeof payload.token !== 'string' ||
            payload.token.length === 0 ||
            new TextEncoder().encode(payload.token).byteLength >
              emailVerificationPolicy.maxTokenBytes
          )
            return error(
              'invalid_request',
              'Email verification proof payload is invalid.',
              400,
            )
          result = await verifyEmailVerification(runtime.database, {
            actor: auth.actor,
            policy: runtime.policy,
            challengeId: payload.challengeId,
            token: payload.token,
            resolver,
            requestId: dependencies.requestId(c),
            now: () => new Date(),
          })
        }
        if (result.status === 'success') return c.json(result.body)
        if (result.status === 'issuer_unsupported')
          return error(
            'unsupported_feature',
            'Email Verification Protocol is unavailable for this account.',
            501,
          )
        if (result.status === 'rate_limited') {
          c.header('Retry-After', String(result.retryAfter))
          return error(
            'rate_limited',
            'Email verification request limit exceeded.',
            429,
          )
        }
        return error(
          'invalid_request',
          'Email verification proof is invalid, expired, or already consumed.',
          400,
        )
      } catch (failure) {
        const issuerUnavailable =
          failure instanceof EmailVerificationUnavailable
        await dependencies.reportFailure(c, {
          code: 'email_verification_unavailable',
          operation,
          reason: issuerUnavailable ? 'issuer_unavailable' : 'operation_failed',
        })
        return error(
          issuerUnavailable
            ? 'email_verification_issuer_unavailable'
            : 'database_unavailable',
          'Email verification is temporarily unavailable.',
          503,
        )
      }
    }
  app.post(
    '/identity/accounts/email-verification/challenge',
    route('challenge'),
  )
  app.post('/identity/accounts/email-verification/verify', route('verify'))
}

async function readBody(request: Request): Promise<unknown | null> {
  if (
    !/^application\/json(?:;|$)/i.test(
      request.headers.get('Content-Type') ?? '',
    ) ||
    !request.body
  )
    return null
  const contentLength = request.headers.get('Content-Length')
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) ||
      !Number.isSafeInteger(Number(contentLength)) ||
      Number(contentLength) > emailVerificationPolicy.maxBodyBytes)
  ) {
    void request.body.cancel().catch(() => undefined)
    return null
  }
  const reader = request.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
  const chunks: string[] = []
  let bytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > emailVerificationPolicy.maxBodyBytes) return null
      chunks.push(decoder.decode(chunk.value, { stream: true }))
    }
    chunks.push(decoder.decode())
    return parseUniqueJson(chunks.join(''))
  } catch {
    return null
  } finally {
    void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

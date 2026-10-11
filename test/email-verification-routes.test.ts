import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerEmailVerificationRoutes } from '../src/email-verification-routes'
import * as service from '../src/email-verification'
import {
  resolveEmailVerificationRuntimePolicy,
  type EmailVerificationRuntimePolicy,
} from '../src/domain/email-verification'

const actor = {
  userId: 'owner',
  sessionId: 'family',
  deviceIdentifier: 'desktop',
  emailNormalized: 'owner@example.test',
  securityStamp: 'stamp',
}
const audience = 'https://vault.example.test'
const challengeId = '12345678-1234-4234-9234-123456789abc'
const database = {} as D1Database
const policy = resolveEmailVerificationRuntimePolicy({
  HONOWARDEN_EMAIL_VERIFICATION_ENABLED: 'true',
  HONOWARDEN_EMAIL_VERIFICATION_RP_ORIGIN: audience,
  HONOWARDEN_EMAIL_VERIFICATION_ISSUERS: JSON.stringify([
    {
      emailDomain: 'example.test',
      issuer: 'https://issuer.example.test',
      jwksUri: 'https://keys.example.test/keys',
    },
  ]),
})

beforeEach(() => {
  vi.spyOn(service, 'createEmailVerificationChallenge').mockResolvedValue({
    status: 'success',
    body: {
      object: 'emailVerificationChallenge',
      challengeId,
      nonce: 'synthetic-nonce',
      email: actor.emailNormalized,
      audience,
      expiresAt: '2026-10-04T00:05:00.000Z',
      protocol: 'draft-hardt-email-verification-02',
    },
  })
  vi.spyOn(service, 'verifyEmailVerification').mockResolvedValue({
    status: 'success',
    body: { object: 'emailVerification', verified: true, method: 'evp' },
  })
})
afterEach(() => vi.restoreAllMocks())

describe('authenticated EVP challenge and verify routes', () => {
  it('keeps the feature disabled before authentication, body, database, or network work', async () => {
    const fixture = application({ status: 'disabled', enabled: false })
    const response = await request(fixture.app, 'challenge', 'invalid')
    expect(response.status).toBe(501)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(fixture.authenticate).not.toHaveBeenCalled()
    expect(fixture.fetcher).not.toHaveBeenCalled()
    expect(service.createEmailVerificationChallenge).not.toHaveBeenCalled()
  })

  it('uses only the trusted authenticated actor and configured audience for challenge', async () => {
    const fixture = application()
    const response = await request(fixture.app, 'challenge', '{}')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      object: 'emailVerificationChallenge',
      challengeId,
      audience,
      email: actor.emailNormalized,
    })
    expect(service.createEmailVerificationChallenge).toHaveBeenCalledWith(
      database,
      expect.objectContaining({ actor, policy }),
    )
  })

  it('passes a bounded proof and exact family to verification without accepting caller identity fields', async () => {
    const fixture = application()
    const response = await request(
      fixture.app,
      'verify',
      JSON.stringify({ challengeId, token: 'synthetic-proof' }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({
      object: 'emailVerification',
      verified: true,
      method: 'evp',
    })
    expect(service.verifyEmailVerification).toHaveBeenCalledWith(
      database,
      expect.objectContaining({
        actor,
        policy,
        challengeId,
        token: 'synthetic-proof',
        requestId: 'request-id',
      }),
    )
  })

  it.each([
    ['challenge', '{"email":"other@example.test"}'],
    ['challenge', '{"x":0,"x":1}'],
    ['verify', `{"challengeId":"${challengeId}","token":"one","token":"two"}`],
    [
      'verify',
      `{"challengeId":"${challengeId}","token":"one","to\\u006ben":"two"}`,
    ],
    [
      'verify',
      JSON.stringify({
        challengeId,
        token: 'proof',
        email: 'other@example.test',
      }),
    ],
    [
      'verify',
      JSON.stringify({ challengeId, token: 'a'.repeat(15 * 1024 + 1) }),
    ],
    [
      'verify',
      JSON.stringify({
        challengeId,
        token: 'x',
        padding: 'x'.repeat(16 * 1024),
      }),
    ],
    ['verify', 'null'],
  ])(
    'rejects malformed, duplicate, overlong or identity-changing %s body',
    async (operation, body) => {
      const fixture = application()
      expect((await request(fixture.app, operation, body)).status).toBe(400)
      expect(service.createEmailVerificationChallenge).not.toHaveBeenCalled()
      expect(service.verifyEmailVerification).not.toHaveBeenCalled()
    },
  )

  it('rejects an observed Origin that differs from the configured canonical RP origin', async () => {
    const fixture = application()
    const response = await request(
      fixture.app,
      'challenge',
      '{}',
      'https://attacker.example.test',
    )
    expect(response.status).toBe(400)
    expect(service.createEmailVerificationChallenge).not.toHaveBeenCalled()
  })

  it('keeps an authentication rejection no-store without creating a challenge', async () => {
    const fixture = application()
    fixture.authenticate.mockResolvedValue({
      ok: false,
      response: new Response('unauthorized', { status: 401 }),
    })
    const response = await request(fixture.app, 'challenge', '{}')
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(service.createEmailVerificationChallenge).not.toHaveBeenCalled()
  })

  it('reports issuer outages explicitly without exposing thrown error details or a proof', async () => {
    const fixture = application()
    vi.mocked(service.verifyEmailVerification).mockRejectedValue(
      new service.EmailVerificationUnavailable(),
    )
    const response = await request(
      fixture.app,
      'verify',
      JSON.stringify({ challengeId, token: 'sensitive-proof' }),
    )
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      error: { code: 'email_verification_issuer_unavailable' },
    })
    expect(fixture.reportFailure).toHaveBeenCalledWith(expect.anything(), {
      code: 'email_verification_unavailable',
      operation: 'verify',
      reason: 'issuer_unavailable',
    })
    expect(JSON.stringify(fixture.reportFailure.mock.calls)).not.toContain(
      'sensitive-proof',
    )
  })

  it('projects account-bound quotas as an explicit retryable 429', async () => {
    const fixture = application()
    vi.mocked(service.createEmailVerificationChallenge).mockResolvedValue({
      status: 'rate_limited',
      retryAfter: 60,
    })
    const response = await request(fixture.app, 'challenge', '{}')
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
  })
})

function application(runtimePolicy: EmailVerificationRuntimePolicy = policy) {
  const app = new Hono()
  const authenticate = vi.fn(async () => ({
    ok: true as const,
    actor,
  })) as ReturnType<
    typeof vi.fn<
      (
        context: unknown,
      ) => Promise<
        { ok: true; actor: typeof actor } | { ok: false; response: Response }
      >
    >
  >
  const reportFailure = vi.fn()
  const fetcher = vi.fn<typeof fetch>()
  registerEmailVerificationRoutes(app, {
    authenticate,
    runtime: () => ({ database, policy: runtimePolicy }),
    requestId: () => 'request-id',
    reportFailure,
    fetcher,
  })
  return { app, authenticate, reportFailure, fetcher }
}
function request(
  app: Hono,
  operation: string,
  body: string,
  origin = audience,
) {
  return app.request(`/identity/accounts/email-verification/${operation}`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body,
  })
}

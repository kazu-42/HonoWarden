import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAdminClient } from '../admin/browser/admin-client'
import type { AdminClient } from '../admin/browser/contracts'
import type { CryptoCommand, CryptoPort } from '../admin/browser/crypto-client'

const email = 'person@example.test'
const code = 'a'.repeat(43)
const profile = {
  Id: 'person',
  Email: email,
  EmailVerified: false,
  Key: 'public-key',
  PrivateKey: 'public-private-key',
  AccountKeys: { publicKeyEncryptionKeyPair: { publicKey: 'public-spki' } },
  Organizations: [],
  TwoFactorEnabled: true,
}
const clients: AdminClient[] = []
afterEach(() => {
  clients.splice(0).forEach((client) => client.dispose())
  vi.useRealTimers()
})
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}
function fixture(
  handler?: (
    path: string,
    init: RequestInit,
  ) => Response | undefined | Promise<Response | undefined>,
  clock = () => Date.now(),
) {
  const calls: { path: string; init: RequestInit }[] = []
  const cryptoCalls: CryptoCommand[] = []
  let verified = false
  const client = createAdminClient({
    lifecycle: false,
    clock,
    crypto: (): CryptoPort => ({
      async call<T>(command: CryptoCommand) {
        cryptoCalls.push(command)
        return (command.action === 'derive' ? 'public-hash' : null) as T
      },
      dispose() {},
    }),
    async fetch(input, init = {}) {
      const path = String(input)
      calls.push({ path, init })
      const custom = await handler?.(path, init)
      if (custom) return custom
      if (path === '/identity/accounts/prelogin')
        return json({
          kdf: 0,
          kdfIterations: 5000,
          kdfMemory: null,
          kdfParallelism: null,
          salt: email,
        })
      if (path === '/identity/connect/token')
        return json({
          access_token: 'public-access',
          refresh_token: 'public-refresh',
          token_type: 'Bearer',
          expires_in: 3600,
          Kdf: 0,
          KdfIterations: 5000,
          KdfMemory: null,
          KdfParallelism: null,
        })
      if (path === '/api/accounts/profile')
        return json({ ...profile, EmailVerified: verified })
      if (path === '/identity/accounts/totp/assurance')
        return json({ object: 'totpSession', verified: false })
      if (path === '/api/accounts/verify-email-token') verified = true
      return new Response(null, { status: 200 })
    },
  })
  clients.push(client)
  return { client, calls, cryptoCalls }
}

describe('ordinary account email code verification', () => {
  it('sends only on an explicit request and publishes only canonical email verification, not MFA or keys', async () => {
    const { client, calls, cryptoCalls } = fixture()
    await client.login(email, 'Public password')
    const before = client.getSession()
    const cryptoBefore = cryptoCalls.length
    const attempt = client.prepareEmailCodeVerification()
    expect(
      calls.filter(({ path }) => path.includes('verify-email')),
    ).toHaveLength(0)
    await attempt.requestCode()
    expect(client.getSession()).toEqual(before)
    await expect(attempt.submit(' ' + code + '\n')).resolves.toEqual({
      status: 'verified',
    })
    expect(client.getSession()).toEqual({ ...before, emailVerified: true })
    expect(cryptoCalls).toHaveLength(cryptoBefore)
    const send = calls.find(
      ({ path }) => path === '/api/accounts/verify-email',
    )!
    expect(send.init).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      headers: { Authorization: 'Bearer public-access' },
    })
    expect(send.init.body).toBeUndefined()
    const confirmation = calls.find(
      ({ path }) => path === '/api/accounts/verify-email-token',
    )!
    expect(JSON.parse(confirmation.init.body as string)).toEqual({
      userId: 'person',
      token: code,
    })
    expect(
      calls.every(
        ({ path }) =>
          !path.includes(code) && !path.includes('email-verification/'),
      ),
    ).toBe(true)
    expect(JSON.stringify(client.getSession())).not.toContain(code)
    attempt.dispose()
  })

  it.each([
    '',
    '123456',
    'a'.repeat(44),
    'a'.repeat(42) + '/',
    'a'.repeat(20) + '\n' + 'a'.repeat(22),
  ])(
    'rejects an invalid code locally without a confirmation request %#',
    async (token) => {
      const { client, calls } = fixture()
      await client.login(email, 'Public password')
      const attempt = client.prepareEmailCodeVerification()
      await expect(attempt.submit(token)).rejects.toMatchObject({
        kind: 'validation',
        code: 'email_verification_code_invalid',
      })
      expect(
        calls.some(({ path }) => path === '/api/accounts/verify-email-token'),
      ).toBe(false)
    },
  )

  it.each(['lock', 'logout', 'dispose', 'close', 'replace'] as const)(
    'cancels a pending confirmation on %s and never reads or publishes a late success',
    async (action) => {
      const entered = deferred<void>()
      const waiting = deferred<Response>()
      let signal: AbortSignal | undefined
      const { client, calls } = fixture((path, init) => {
        if (path === '/api/accounts/verify-email-token') {
          signal = init.signal ?? undefined
          entered.resolve()
          return waiting.promise
        }
        return undefined
      })
      await client.login(email, 'Public password')
      const attempt = client.prepareEmailCodeVerification()
      const pending = attempt.submit(code)
      const rejected = expect(pending).rejects.toMatchObject({
        kind: 'cancelled',
      })
      await entered.promise
      if (action === 'close') attempt.dispose()
      else if (action === 'replace') client.prepareEmailCodeVerification()
      else await client[action]()
      expect(signal?.aborted).toBe(true)
      waiting.resolve(new Response(null, { status: 200 }))
      await rejected
      expect(client.getSession().emailVerified).not.toBe(true)
      expect(
        calls.filter(({ path }) => path === '/api/accounts/profile'),
      ).toHaveLength(1)
    },
  )

  it('cancels a pending send on modal close without claiming that a mail was delivered', async () => {
    const entered = deferred<void>()
    const waiting = deferred<Response>()
    const { client } = fixture((path) => {
      if (path === '/api/accounts/verify-email') {
        entered.resolve()
        return waiting.promise
      }
      return undefined
    })
    await client.login(email, 'Public password')
    const attempt = client.prepareEmailCodeVerification()
    const pending = attempt.requestCode()
    const rejected = expect(pending).rejects.toMatchObject({
      kind: 'cancelled',
    })
    await entered.promise
    attempt.dispose()
    waiting.resolve(new Response(null, { status: 200 }))
    await rejected
    expect(client.getSession().emailVerified).toBe(false)
  })

  it.each([200, 401, 503])(
    'ignores a late %s canonical readback after close without affecting the replacement attempt',
    async (status) => {
      const entered = deferred<void>()
      const waiting = deferred<Response>()
      let reads = 0
      const { client, calls } = fixture((path) => {
        if (path === '/api/accounts/profile' && ++reads === 2) {
          entered.resolve()
          return waiting.promise
        }
        return undefined
      })
      await client.login(email, 'Public password')
      const attempt = client.prepareEmailCodeVerification()
      const pending = attempt.submit(code)
      const rejected = expect(pending).rejects.toMatchObject({
        kind: 'cancelled',
      })
      await entered.promise
      attempt.dispose()
      const replacement = client.prepareEmailCodeVerification()
      const before = client.getSession()
      waiting.resolve(
        status === 200
          ? json({ ...profile, EmailVerified: true })
          : json({ error: { code: 'mfa_required' } }, status),
      )
      await rejected
      expect(client.getSession()).toEqual(before)
      await expect(replacement.requestCode()).resolves.toBeUndefined()
      expect(
        calls.filter(({ path }) => path === '/api/accounts/verify-email-token'),
      ).toHaveLength(1)
    },
  )

  it.each(['close', 'logout'] as const)(
    'does not send a code after %s while a shared token refresh is pending',
    async (action) => {
      const entered = deferred<void>()
      const waiting = deferred<Response>()
      let time = 0
      const { client, calls } = fixture(
        (path, init) => {
          if (
            path === '/identity/connect/token' &&
            String(init.body).includes('grant_type=refresh_token')
          ) {
            entered.resolve()
            return waiting.promise
          }
          return undefined
        },
        () => time,
      )
      await client.login(email, 'Public password')
      const attempt = client.prepareEmailCodeVerification()
      time = 3_590_000
      const pending = attempt.requestCode()
      const rejected = expect(pending).rejects.toMatchObject({
        kind: 'cancelled',
      })
      await entered.promise
      if (action === 'close') attempt.dispose()
      else await client.logout()
      waiting.resolve(
        json({
          access_token: 'refreshed-access',
          refresh_token: 'refreshed-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      )
      await rejected
      expect(
        calls.some(({ path }) => path === '/api/accounts/verify-email'),
      ).toBe(false)
      expect(client.getSession().phase).toBe(
        action === 'close' ? 'unlocked' : 'signedOut',
      )
    },
  )

  it.each([
    ['/api/accounts/verify-email', 501, 'unsupported_feature'],
    ['/api/accounts/verify-email-token', 400, 'invalid_request'],
  ] as const)(
    'keeps %s rejection distinct and does not retry or grant verification',
    async (endpoint, status, errorCode) => {
      const { client, calls } = fixture((path) =>
        path === endpoint
          ? json({ error: { code: errorCode, message: code } }, status)
          : undefined,
      )
      await client.login(email, 'Public password')
      const before = client.getSession()
      const attempt = client.prepareEmailCodeVerification()
      const failure = await (
        endpoint.endsWith('-token')
          ? attempt.submit(code)
          : attempt.requestCode()
      ).catch((error: unknown) => error)
      expect(failure).toMatchObject({ httpStatus: status, code: errorCode })
      expect(JSON.stringify(failure)).not.toContain(code)
      expect(client.getSession()).toEqual(before)
      expect(calls.filter(({ path }) => path === endpoint)).toHaveLength(1)
      expect(
        calls.filter(({ path }) => path === '/api/accounts/profile'),
      ).toHaveLength(1)
    },
  )

  it.each([
    { ...profile, Id: 'other-person' },
    { ...profile, Email: 'changed@example.test' },
  ])(
    'retires the originating attempt when sync changes canonical account identity %#',
    async (changed) => {
      let reads = 0
      const { client, calls } = fixture((path) =>
        path === '/api/accounts/profile'
          ? json(++reads === 1 ? profile : changed)
          : undefined,
      )
      await client.login(email, 'Public password')
      const attempt = client.prepareEmailCodeVerification()
      await client.sync()
      await expect(attempt.submit(code)).rejects.toMatchObject({
        kind: 'cancelled',
      })
      expect(
        calls.some(({ path }) => path === '/api/accounts/verify-email-token'),
      ).toBe(false)
    },
  )

  it.each([
    { ...profile, EmailVerified: false },
    { ...profile, Id: 'other', EmailVerified: true },
    { ...profile, Email: 'other@example.test', EmailVerified: true },
    { ...profile, EmailVerified: 'true' },
  ])(
    'does not claim success for missing or mismatched canonical readback %#',
    async (readback) => {
      let reads = 0
      const { client, calls } = fixture((path) =>
        path === '/api/accounts/profile'
          ? json(++reads === 1 ? profile : readback)
          : undefined,
      )
      await client.login(email, 'Public password')
      const attempt = client.prepareEmailCodeVerification()
      await expect(attempt.submit(code)).rejects.toMatchObject({
        kind: 'unavailable',
        code: 'mutation_readback_unavailable',
      })
      expect(client.getSession().emailVerified).toBe(false)
      expect(
        calls.filter(({ path }) => path === '/api/accounts/verify-email-token'),
      ).toHaveLength(1)
    },
  )

  it('keeps readback failure uncertain and redacts raw server messages', async () => {
    let reads = 0
    const { client } = fixture((path) =>
      path === '/api/accounts/profile' && ++reads > 1
        ? json(
            {
              error: { code: 'invalid_request', message: code },
              requestId: 'safe-request',
            },
            403,
          )
        : undefined,
    )
    await client.login(email, 'Public password')
    const failure = await client
      .prepareEmailCodeVerification()
      .submit(code)
      .catch((error: unknown) => error)
    expect(failure).toMatchObject({
      kind: 'unavailable',
      code: 'mutation_readback_unavailable',
      requestId: 'safe-request',
    })
    expect(JSON.stringify(failure)).not.toContain(code)
  })

  it('blocks simultaneous sends or confirmations and never automatically replays an uncertain write', async () => {
    const entered = deferred<void>()
    const waiting = deferred<Response>()
    const { client, calls } = fixture((path) => {
      if (path === '/api/accounts/verify-email-token') {
        entered.resolve()
        return waiting.promise
      }
      return undefined
    })
    await client.login(email, 'Public password')
    const attempt = client.prepareEmailCodeVerification()
    const pending = attempt.submit(code)
    const rejected = expect(pending).rejects.toMatchObject({
      kind: 'unavailable',
    })
    await entered.promise
    await expect(attempt.submit(code)).rejects.toMatchObject({
      code: 'operation_in_progress',
    })
    await expect(attempt.requestCode()).rejects.toMatchObject({
      code: 'operation_in_progress',
    })
    waiting.resolve(json({ error: { code: 'database_unavailable' } }, 503))
    await rejected
    await expect(attempt.readback()).resolves.toBe(false)
    expect(
      calls.filter(({ path }) => path === '/api/accounts/verify-email-token'),
    ).toHaveLength(1)
  })

  it.each(['/api/accounts/verify-email', '/api/accounts/verify-email-token'])(
    'treats a timeout of %s as uncertain and never resends automatically',
    async (endpoint) => {
      vi.useFakeTimers()
      const entered = deferred<void>()
      const { client, calls } = fixture((path, init) => {
        if (path !== endpoint) return undefined
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            'abort',
            () => reject(new Error('AbortError')),
            { once: true },
          )
          entered.resolve()
        })
      })
      await client.login(email, 'Public password')
      const before = client.getSession()
      const attempt = client.prepareEmailCodeVerification()
      const pending = endpoint.endsWith('-token')
        ? attempt.submit(code)
        : attempt.requestCode()
      const rejected = expect(pending).rejects.toMatchObject({
        kind: 'transport',
        code: 'request_timeout',
      })
      await entered.promise
      await vi.advanceTimersByTimeAsync(30_000)
      await rejected
      expect(client.getSession()).toEqual(before)
      expect(calls.filter(({ path }) => path === endpoint)).toHaveLength(1)
      await expect(attempt.readback()).resolves.toBe(false)
    },
  )

  it('preserves email-only verification when an older sync finishes later', async () => {
    const entered = deferred<void>()
    const waiting = deferred<Response>()
    let assurances = 0
    const { client } = fixture((path) => {
      if (path === '/identity/accounts/totp/assurance' && ++assurances === 2) {
        entered.resolve()
        return waiting.promise
      }
      return undefined
    })
    await client.login(email, 'Public password')
    const sync = client.sync()
    await entered.promise
    await client.prepareEmailCodeVerification().submit(code)
    waiting.resolve(json({ object: 'totpSession', verified: false }))
    await sync
    expect(client.getSession()).toMatchObject({
      emailVerified: true,
      mfaVerified: false,
    })
  })
})

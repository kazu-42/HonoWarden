import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAdminClient } from '../admin/browser/admin-client'
import type { AdminClient } from '../admin/browser/contracts'
import type { CryptoCommand, CryptoPort } from '../admin/browser/crypto-client'

const now = Date.UTC(2026, 9, 4, 9)
const email = 'person@example.test'
const nonce = 'AQEB'.repeat(10) + 'AQE'
const browserProof =
  'public-evt.public-payload.public-signature~public-kb.public-payload.public-signature'
const profile = {
  Id: 'person',
  Email: email,
  EmailVerified: false,
  Key: 'public-wrapped-user-key',
  PrivateKey: 'public-wrapped-private-key',
  AccountKeys: { publicKeyEncryptionKeyPair: { publicKey: 'public-spki' } },
  Organizations: [],
  TwoFactorEnabled: true,
}
const challenge = {
  object: 'emailVerificationChallenge',
  challengeId: '00000000-0000-4000-8000-000000000001',
  nonce,
  email,
  audience: 'https://vault.example.test',
  expiresAt: new Date(now + 300_000).toISOString(),
  protocol: 'draft-hardt-email-verification-02',
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
class Form extends EventTarget {
  isConnected = true
  ownerDocument = { location: { origin: 'https://vault.example.test' } }
}
class Input extends EventTarget {
  value = ''
  attributes = new Map<string, string>()
  constructor(
    readonly form: Form,
    readonly type: string,
    readonly autocomplete: string,
  ) {
    super()
    this.attributes.set('autocomplete', autocomplete)
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value)
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null
  }
  removeAttribute(name: string) {
    this.attributes.delete(name)
  }
}
function inputs() {
  const form = new Form()
  const emailInput = new Input(form, 'email', 'email')
  emailInput.value = email
  const proofInput = new Input(form, 'hidden', 'email-verification-token')
  return {
    form: form as unknown as HTMLFormElement,
    emailInput: emailInput as unknown as HTMLInputElement,
    proofInput: proofInput as unknown as HTMLInputElement,
  }
}
const clients = new Set<AdminClient>()
afterEach(() => {
  for (const client of clients) client.dispose()
  clients.clear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
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
  clock: () => number = () => now,
  lifecycle = false,
) {
  const calls: Array<{ path: string; init: RequestInit }> = []
  const cryptoCalls: CryptoCommand[] = []
  let verified = false
  const crypto = (): CryptoPort => ({
    async call<T>(command: CryptoCommand) {
      cryptoCalls.push(command)
      return (
        command.action === 'derive' ? 'public-derived-auth-hash' : null
      ) as T
    },
    dispose() {},
  })
  const client = createAdminClient({
    lifecycle,
    clock,
    crypto,
    async fetch(input, init = {}) {
      const path = String(input)
      calls.push({ path, init })
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
          access_token: 'public-access-token',
          refresh_token: 'public-refresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
          Kdf: 0,
          KdfIterations: 5000,
          KdfMemory: null,
          KdfParallelism: null,
        })
      if (handler) {
        const response = await handler(path, init)
        if (response) return response
      }
      if (path === '/identity/accounts/totp/assurance')
        return json({ object: 'totpSession', verified: false })
      if (path === '/api/accounts/profile')
        return json({ ...profile, EmailVerified: verified })
      if (path === '/identity/accounts/email-verification/challenge')
        return json(challenge)
      if (path === '/identity/accounts/email-verification/verify') {
        verified = true
        return json({
          object: 'emailVerification',
          verified: true,
          method: 'evp',
        })
      }
      return new Response(null, { status: 200 })
    },
  })
  clients.add(client)
  return { client, calls, cryptoCalls }
}

describe('browser Email Verification Protocol facade', () => {
  it('retires browser proof material when ordinary email code verification is opened', async () => {
    const elements = inputs()
    const { client, calls } = fixture()
    await client.login(email, 'Public password')
    const browserAttempt = await client.prepareEmailVerification(elements)
    elements.proofInput.value = browserProof
    const codeAttempt = client.prepareEmailCodeVerification()
    expect(elements.proofInput.value).toBe('')
    expect(elements.proofInput.getAttribute('nonce')).toBeNull()
    await expect(browserAttempt.submit()).rejects.toMatchObject({
      kind: 'cancelled',
    })
    expect(
      calls.some(
        ({ path }) => path === '/identity/accounts/email-verification/verify',
      ),
    ).toBe(false)
    await expect(codeAttempt.requestCode()).resolves.toBeUndefined()
  })

  it('retires an ordinary code attempt when browser proof preparation starts', async () => {
    const elements = inputs()
    const { client, calls } = fixture()
    await client.login(email, 'Public password')
    const codeAttempt = client.prepareEmailCodeVerification()
    const browserAttempt = await client.prepareEmailVerification(elements)
    await expect(codeAttempt.submit('a'.repeat(43))).rejects.toMatchObject({
      kind: 'cancelled',
    })
    expect(
      calls.some(({ path }) => path === '/api/accounts/verify-email-token'),
    ).toBe(false)
    elements.proofInput.value = browserProof
    await expect(browserAttempt.submit()).resolves.toEqual({
      status: 'verified',
    })
  })

  it('consumes the browser hidden value before network and reports success only after canonical profile readback', async () => {
    const elements = inputs()
    const { client, calls, cryptoCalls } = fixture((path) => {
      if (path === '/identity/accounts/email-verification/verify') {
        expect(elements.proofInput.value).toBe('')
        expect(elements.proofInput.getAttribute('nonce')).toBeNull()
      }
    })
    await client.login(email, 'Public password')
    expect(client.getSession().emailVerified).toBe(false)
    const attempt = await client.prepareEmailVerification(elements)
    expect(elements.proofInput.getAttribute('nonce')).toBe(nonce)
    elements.proofInput.value = browserProof
    const cryptoCount = cryptoCalls.length
    const submitted = attempt.submit()
    expect(elements.proofInput.value).toBe('')
    expect(elements.proofInput.getAttribute('nonce')).toBeNull()
    await expect(submitted).resolves.toEqual({ status: 'verified' })
    const write = calls.find((call) =>
      call.path.endsWith('/email-verification/verify'),
    )!
    expect(JSON.parse(write.init.body as string)).toEqual({
      challengeId: challenge.challengeId,
      token: browserProof,
    })
    expect(client.getSession()).toMatchObject({
      emailVerified: true,
      mfaVerified: false,
      totpEnabled: true,
      organizations: [],
    })
    expect(cryptoCalls).toHaveLength(cryptoCount)
    expect(JSON.stringify(client.getSession())).not.toMatch(
      /public-(?:access|refresh|challenge|evt|kb)|nonce/,
    )
    expect(
      calls.filter((call) => call.path === '/api/accounts/profile'),
    ).toHaveLength(2)
  })

  it('rejects a non-UUID challenge response before attaching a browser nonce', async () => {
    const elements = inputs()
    const { client, calls } = fixture((path) =>
      path.endsWith('/email-verification/challenge')
        ? json({ ...challenge, challengeId: 'public-challenge' })
        : undefined,
    )
    await client.login(email, 'Public password')
    await expect(
      client.prepareEmailVerification(elements),
    ).rejects.toMatchObject({ kind: 'unavailable', code: 'response_invalid' })
    expect(elements.proofInput.getAttribute('nonce')).toBeNull()
    expect(
      calls.filter((call) => call.path.endsWith('/email-verification/verify')),
    ).toHaveLength(0)
  })

  it('retires an empty browser proof without inferring a failure cause or sending verification', async () => {
    const elements = inputs()
    const { client, calls } = fixture()
    await client.login(email, 'Public password')
    const attempt = await client.prepareEmailVerification(elements)
    await expect(attempt.submit()).resolves.toEqual({
      status: 'proofUnavailable',
    })
    expect(elements.proofInput.value).toBe('')
    expect(elements.proofInput.getAttribute('nonce')).toBeNull()
    await expect(attempt.submit()).rejects.toMatchObject({ kind: 'cancelled' })
    expect(
      calls.filter((call) => call.path.endsWith('/email-verification/verify')),
    ).toHaveLength(0)
    expect(client.getSession().emailVerified).toBe(false)
  })

  it('clears prior proof on edits while keeping the acquisition nonce and accepts only canonical account input', async () => {
    const elements = inputs()
    const { client } = fixture()
    await client.login(email, 'Public password')
    const attempt = await client.prepareEmailVerification(elements)
    for (const event of ['input', 'change']) {
      elements.proofInput.value = browserProof
      elements.emailInput.value = ' PERSON@EXAMPLE.TEST '
      elements.emailInput.dispatchEvent(new Event(event))
      expect(elements.proofInput.value).toBe('')
      expect(elements.proofInput.getAttribute('nonce')).toBe(nonce)
    }
    elements.proofInput.value = browserProof
    await expect(attempt.submit()).resolves.toEqual({ status: 'verified' })
  })

  it.each([
    'person+other@example.test',
    'per.son@example.test',
    'other@example.test',
  ])(
    'rejects changed or aliased target %s and scrubs the proof',
    async (target) => {
      const elements = inputs()
      const { client, calls } = fixture()
      await client.login(email, 'Public password')
      const attempt = await client.prepareEmailVerification(elements)
      elements.emailInput.value = target
      elements.proofInput.value = browserProof
      await expect(attempt.submit()).rejects.toMatchObject({
        code: 'email_verification_email_mismatch',
      })
      expect(elements.proofInput.value).toBe('')
      expect(elements.proofInput.getAttribute('nonce')).toBeNull()
      expect(
        calls.filter((call) =>
          call.path.endsWith('/email-verification/verify'),
        ),
      ).toHaveLength(0)
    },
  )

  it.each(['lock', 'logout', 'dispose', 'pagehide'] as const)(
    'scrubs a live attempt on %s without proof submission',
    async (action) => {
      const browser = new EventTarget()
      Object.assign(browser, {
        location: { pathname: '/admin/', hash: '', search: '' },
        history: { replaceState() {} },
      })
      if (action === 'pagehide') vi.stubGlobal('window', browser)
      const elements = inputs()
      const { client, calls } = fixture(
        undefined,
        undefined,
        action === 'pagehide',
      )
      await client.login(email, 'Public password')
      const attempt = await client.prepareEmailVerification(elements)
      elements.proofInput.value = browserProof
      if (action === 'pagehide') browser.dispatchEvent(new Event('pagehide'))
      else await client[action]()
      expect(elements.proofInput.value).toBe('')
      expect(elements.proofInput.getAttribute('nonce')).toBeNull()
      await expect(attempt.submit()).rejects.toMatchObject({
        kind: 'cancelled',
      })
      expect(
        calls.filter((call) =>
          call.path.endsWith('/email-verification/verify'),
        ),
      ).toHaveLength(0)
    },
  )

  it('rejects an expired attempt before verification and expires DOM material without locking the session', async () => {
    vi.useFakeTimers()
    const elements = inputs()
    const { client, calls } = fixture((path) =>
      path.endsWith('/email-verification/challenge')
        ? json({ ...challenge, expiresAt: new Date(now + 1000).toISOString() })
        : undefined,
    )
    await client.login(email, 'Public password')
    const attempt = await client.prepareEmailVerification(elements)
    elements.proofInput.value = browserProof
    await vi.advanceTimersByTimeAsync(1000)
    expect(elements.proofInput.value).toBe('')
    expect(elements.proofInput.getAttribute('nonce')).toBeNull()
    expect(client.getSession().phase).toBe('unlocked')
    await expect(attempt.submit()).rejects.toMatchObject({ kind: 'cancelled' })
    expect(
      calls.filter((call) => call.path.endsWith('/email-verification/verify')),
    ).toHaveLength(0)
  })

  it('checks the clock again at submit even when the expiry timer has not fired', async () => {
    let currentTime = now
    const elements = inputs()
    const { client, calls } = fixture(undefined, () => currentTime)
    await client.login(email, 'Public password')
    const attempt = await client.prepareEmailVerification(elements)
    currentTime += 300_001
    elements.proofInput.value = browserProof
    await expect(attempt.submit()).rejects.toMatchObject({
      code: 'email_verification_expired',
    })
    expect(elements.proofInput.value).toBe('')
    expect(
      calls.filter((call) => call.path.endsWith('/email-verification/verify')),
    ).toHaveLength(0)
  })

  it('never installs a late challenge nonce after lock', async () => {
    const waiting = deferred<Response>()
    const entered = deferred<void>()
    const elements = inputs()
    const { client } = fixture((path) => {
      if (!path.endsWith('/email-verification/challenge')) return undefined
      entered.resolve()
      return waiting.promise
    })
    await client.login(email, 'Public password')
    const preparation = client.prepareEmailVerification(elements)
    const rejection = expect(preparation).rejects.toMatchObject({
      kind: 'cancelled',
    })
    await entered.promise
    client.lock()
    waiting.resolve(json(challenge))
    await rejection
    expect(elements.proofInput.getAttribute('nonce')).toBeNull()
    expect(client.getSession().phase).toBe('locked')
  })

  it('keeps a replacement attempt intact when a retired preparation returns late', async () => {
    const waiting = deferred<Response>()
    const entered = deferred<void>()
    let challenges = 0
    const elements = inputs()
    const { client } = fixture((path) => {
      if (
        path.endsWith('/email-verification/challenge') &&
        ++challenges === 1
      ) {
        entered.resolve()
        return waiting.promise
      }
      return undefined
    })
    await client.login(email, 'Public password')
    const older = client.prepareEmailVerification(elements)
    const rejection = expect(older).rejects.toMatchObject({ kind: 'cancelled' })
    await entered.promise
    const newer = await client.prepareEmailVerification(elements)
    elements.proofInput.value = browserProof
    waiting.resolve(json(challenge))
    await rejection
    expect(elements.proofInput.value).toBe(browserProof)
    expect(elements.proofInput.getAttribute('nonce')).toBe(nonce)
    await expect(newer.submit()).resolves.toEqual({ status: 'verified' })
  })

  it('allows an already sent verification to finish after modal disposal but never submits twice', async () => {
    const waiting = deferred<Response>()
    const entered = deferred<void>()
    let readbacks = 0
    const elements = inputs()
    const { client, calls } = fixture((path) => {
      if (path === '/api/accounts/profile')
        return json({ ...profile, EmailVerified: ++readbacks > 1 })
      if (path.endsWith('/email-verification/verify')) {
        entered.resolve()
        return waiting.promise
      }
      return undefined
    })
    await client.login(email, 'Public password')
    const attempt = await client.prepareEmailVerification(elements)
    elements.proofInput.value = browserProof
    const submission = attempt.submit()
    await entered.promise
    attempt.dispose()
    waiting.resolve(
      json({ object: 'emailVerification', verified: true, method: 'evp' }),
    )
    await expect(submission).resolves.toEqual({ status: 'verified' })
    await expect(attempt.submit()).rejects.toMatchObject({ kind: 'cancelled' })
    expect(
      calls.filter((call) => call.path.endsWith('/email-verification/verify')),
    ).toHaveLength(1)
  })

  it('suppresses a late verification response after lock and publishes no verified state', async () => {
    const waiting = deferred<Response>()
    const entered = deferred<void>()
    const elements = inputs()
    const { client, calls } = fixture((path) => {
      if (path.endsWith('/email-verification/verify')) {
        entered.resolve()
        return waiting.promise
      }
      return undefined
    })
    await client.login(email, 'Public password')
    const attempt = await client.prepareEmailVerification(elements)
    elements.proofInput.value = browserProof
    const submission = attempt.submit()
    const rejection = expect(submission).rejects.toMatchObject({
      kind: 'cancelled',
    })
    await entered.promise
    client.lock()
    waiting.resolve(
      json({ object: 'emailVerification', verified: true, method: 'evp' }),
    )
    await rejection
    expect(client.getSession().emailVerified).toBeUndefined()
    expect(
      calls.filter((call) => call.path === '/api/accounts/profile'),
    ).toHaveLength(1)
  })

  it.each([
    { ...profile, EmailVerified: false },
    { ...profile, Id: 'other-person', EmailVerified: true },
    { ...profile, Email: 'other@example.test', EmailVerified: true },
    { ...profile, Id: 'invalid id', EmailVerified: true },
  ])(
    'reports committed verification with inconsistent profile as unavailable, never rejected %#',
    async (readback) => {
      let reads = 0
      const elements = inputs()
      const { client, calls } = fixture((path) =>
        path === '/api/accounts/profile'
          ? json(++reads === 1 ? profile : readback)
          : undefined,
      )
      await client.login(email, 'Public password')
      const attempt = await client.prepareEmailVerification(elements)
      elements.proofInput.value = browserProof
      await expect(attempt.submit()).rejects.toMatchObject({
        kind: 'unavailable',
        code: 'mutation_readback_unavailable',
      })
      expect(client.getSession().emailVerified).toBe(false)
      expect(
        calls.filter((call) =>
          call.path.endsWith('/email-verification/verify'),
        ),
      ).toHaveLength(1)
    },
  )

  it('normalizes post-write readback rejection while retaining only the safe request ID', async () => {
    let reads = 0
    const elements = inputs()
    const { client } = fixture((path) =>
      path === '/api/accounts/profile' && ++reads > 1
        ? json(
            {
              error: { code: 'invalid_request', message: browserProof },
              requestId: 'public-request',
            },
            403,
          )
        : undefined,
    )
    await client.login(email, 'Public password')
    const attempt = await client.prepareEmailVerification(elements)
    elements.proofInput.value = browserProof
    const error = await attempt.submit().catch((failure: unknown) => failure)
    expect(error).toMatchObject({
      kind: 'unavailable',
      code: 'mutation_readback_unavailable',
      requestId: 'public-request',
    })
    expect(JSON.stringify(error)).not.toContain(browserProof)
  })

  it('reports malformed successful verify responses as unavailable without claiming success or replaying', async () => {
    const elements = inputs()
    const { client, calls } = fixture((path) =>
      path.endsWith('/email-verification/verify')
        ? json({ object: 'emailVerification', verified: false, method: 'evp' })
        : undefined,
    )
    await client.login(email, 'Public password')
    const attempt = await client.prepareEmailVerification(elements)
    elements.proofInput.value = browserProof
    await expect(attempt.submit()).rejects.toMatchObject({
      kind: 'unavailable',
      code: 'response_invalid',
    })
    expect(client.getSession().emailVerified).toBe(false)
    expect(
      calls.filter((call) => call.path.endsWith('/email-verification/verify')),
    ).toHaveLength(1)
  })

  it('preserves the later verified profile flag when an older sync finishes afterwards', async () => {
    const waiting = deferred<Response>()
    const entered = deferred<void>()
    let assurances = 0
    const elements = inputs()
    const { client } = fixture((path) => {
      if (path === '/identity/accounts/totp/assurance' && ++assurances === 2) {
        entered.resolve()
        return waiting.promise
      }
      return undefined
    })
    await client.login(email, 'Public password')
    const olderSync = client.sync()
    await entered.promise
    const attempt = await client.prepareEmailVerification(elements)
    elements.proofInput.value = browserProof
    await expect(attempt.submit()).resolves.toEqual({ status: 'verified' })
    waiting.resolve(json({ object: 'totpSession', verified: false }))
    await olderSync
    expect(client.getSession().emailVerified).toBe(true)
  })

  it('clears an attempt when fresh sync observes a changed account email', async () => {
    let reads = 0
    const elements = inputs()
    const { client, calls } = fixture((path) =>
      path === '/api/accounts/profile'
        ? json({
            ...profile,
            Email: ++reads > 1 ? 'changed@example.test' : email,
          })
        : undefined,
    )
    await client.login(email, 'Public password')
    const attempt = await client.prepareEmailVerification(elements)
    elements.proofInput.value = browserProof
    await client.sync()
    expect(elements.proofInput.value).toBe('')
    expect(elements.proofInput.getAttribute('nonce')).toBeNull()
    await expect(attempt.submit()).rejects.toMatchObject({ kind: 'cancelled' })
    expect(
      calls.filter((call) => call.path.endsWith('/email-verification/verify')),
    ).toHaveLength(0)
  })

  it('rejects malformed canonical profile state rather than silently showing unverified', async () => {
    const { client } = fixture((path) =>
      path === '/api/accounts/profile'
        ? json({ ...profile, EmailVerified: undefined })
        : undefined,
    )
    await expect(client.login(email, 'Public password')).rejects.toMatchObject({
      kind: 'unavailable',
      code: 'response_invalid',
    })
    expect(client.getSession().phase).toBe('signedOut')
  })

  it.each([
    { audience: 'https://other.example.test' },
    { audience: 'https://vault.example.test/' },
    { email: 'PERSON@EXAMPLE.TEST' },
    { nonce: 'not-a-valid-nonce' },
    { protocol: 'legacy-protocol' },
    { expiresAt: new Date(now + 600_000).toISOString() },
  ])(
    'rejects a malformed or mismatched challenge without installing sensitive DOM material %#',
    async (changes) => {
      const elements = inputs()
      const { client } = fixture((path) =>
        path.endsWith('/email-verification/challenge')
          ? json({ ...challenge, ...changes })
          : undefined,
      )
      await client.login(email, 'Public password')
      await expect(
        client.prepareEmailVerification(elements),
      ).rejects.toMatchObject({ kind: 'unavailable', code: 'response_invalid' })
      expect(elements.proofInput.value).toBe('')
      expect(elements.proofInput.getAttribute('nonce')).toBeNull()
    },
  )
})

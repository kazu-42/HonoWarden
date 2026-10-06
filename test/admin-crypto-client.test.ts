import { describe, expect, it, vi } from 'vitest'
import { createAdminClient } from '../admin/browser/admin-client'
import type { CryptoCommand, CryptoPort } from '../admin/browser/crypto-client'
import { consumeInvitation } from '../admin/browser/invitation'

const settings = {
  kdf: 0,
  kdfIterations: 5000,
  kdfMemory: null,
  kdfParallelism: null,
  salt: 'person@example.test',
}
const token = {
  access_token: 'public-test-access-token',
  refresh_token: 'public-test-refresh-token',
  token_type: 'Bearer',
  expires_in: 3600,
  Kdf: 0,
  KdfIterations: 5000,
  KdfMemory: null,
  KdfParallelism: null,
}
const profile = {
  Id: 'person',
  Email: 'person@example.test',
  EmailVerified: false,
  Key: 'public-wrapped-user-key',
  PrivateKey: 'public-wrapped-private-key',
  AccountKeys: { publicKeyEncryptionKeyPair: { publicKey: 'public-spki' } },
  Organizations: [
    {
      Id: 'org',
      Name: 'Public organization',
      Type: 0,
      Status: 2,
      Enabled: true,
      Key: 'public-wrapped-org-key',
    },
  ],
  UserDecryptionOptions: {
    MasterPasswordUnlock: {
      Salt: 'person@example.test',
      Kdf: { KdfType: 0, Iterations: 5000, Memory: null, Parallelism: null },
    },
  },
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

function fixture(
  handler?: (path: string, init: RequestInit) => Response | Promise<Response>,
  cryptoHandler?: (command: CryptoCommand) => unknown | Promise<unknown>,
  clock?: () => number,
  lifecycle = false,
) {
  const calls: { path: string; init: RequestInit }[] = []
  let disposed = 0
  let mfaVerified = false
  const crypto = (): CryptoPort => ({
    async call<T>(command: CryptoCommand) {
      return (
        cryptoHandler
          ? await cryptoHandler(command)
          : command.action === 'derive'
            ? 'public-derived-auth-hash'
            : command.action === 'encryptName'
              ? '2.public-encrypted-name'
              : command.action === 'decryptName'
                ? 'Public decrypted name'
                : null
      ) as T
    },
    dispose() {
      disposed++
    },
  })
  const client = createAdminClient({
    lifecycle,
    crypto,
    ...(clock ? { clock } : {}),
    async fetch(input, init = {}) {
      const path = String(input)
      calls.push({ path, init })
      if (
        path === '/identity/connect/token' &&
        new URLSearchParams(init.body as string).has('twoFactorCode')
      )
        mfaVerified = true
      if (path === '/identity/accounts/totp/assurance')
        return json({ object: 'totpSession', verified: mfaVerified })
      if (path === '/identity/accounts/prelogin') return json(settings)
      if (path === '/identity/connect/token' && !handler) return json(token)
      if (path === '/api/accounts/profile') return json(profile)
      return handler ? handler(path, init) : new Response(null, { status: 200 })
    },
  })
  return { client, calls, disposed: () => disposed }
}

describe('browser private session controller', () => {
  it('sends only derived password hash and exposes no tokens or wrapped keys', async () => {
    const { client, calls, disposed } = fixture()
    await client.login(' PERSON@EXAMPLE.TEST ', 'Public password with spaces ')
    const grant = new URLSearchParams(
      calls.find((call) => call.path === '/identity/connect/token')!.init
        .body as string,
    )
    expect(grant.get('password')).toBe('public-derived-auth-hash')
    expect(grant.get('deviceType')).toBe('2')
    expect(
      calls.every(
        (call) =>
          call.init.cache === 'no-store' &&
          call.init.credentials === 'omit' &&
          call.init.redirect === 'error',
      ),
    ).toBe(true)
    const view = client.getSession()
    expect(view.phase).toBe('unlocked')
    expect(JSON.stringify(view)).not.toMatch(
      /access-token|refresh-token|wrapped-|auth-hash|spki/,
    )
    view.organizations![0]!.name = 'mutation'
    expect(client.getSession().organizations![0]!.name).toBe(
      'Public organization',
    )
    client.lock()
    expect(client.getSession()).toMatchObject({ phase: 'locked' })
    expect(client.getSession().organizations).toBeUndefined()
    expect(disposed()).toBe(1)
    await client.unlock('Public password')
    expect(client.getSession().phase).toBe('unlocked')
    await client.logout()
    expect(client.getSession()).toEqual({ phase: 'signedOut' })
    client.dispose()
  })

  it('cancels a late KDF completion after sign-out and never sends the grant', async () => {
    let complete: ((value: string) => void) | undefined
    const { client, calls } = fixture(undefined, (command) =>
      command.action === 'derive'
        ? new Promise<string>((resolve) => {
            complete = resolve
          })
        : null,
    )
    const login = client.login('person@example.test', 'Public password')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(complete).toBeDefined()
    client.logout()
    complete!('public-derived-auth-hash')
    await expect(login).rejects.toMatchObject({ kind: 'cancelled' })
    expect(
      calls.filter((call) => call.path === '/identity/connect/token'),
    ).toHaveLength(0)
    expect(client.getSession().phase).toBe('signedOut')
    client.dispose()
  })

  it('returns a partial login to sign-in when visibility hides during Worker unlock and permits a fresh login', async () => {
    const documentEvents = new EventTarget()
    Object.defineProperty(documentEvents, 'visibilityState', {
      value: 'hidden',
    })
    vi.stubGlobal('document', documentEvents)
    let releaseUnlock: (() => void) | undefined
    let enteredUnlock: (() => void) | undefined
    let unlockCount = 0
    const unlocking = new Promise<void>((resolve) => {
      enteredUnlock = resolve
    })
    const { client, disposed } = fixture(
      undefined,
      (command) => {
        if (command.action === 'derive') return 'public-derived-auth-hash'
        if (command.action === 'unlock' && ++unlockCount === 1) {
          enteredUnlock!()
          return new Promise<void>((resolve) => {
            releaseUnlock = resolve
          })
        }
        return null
      },
      undefined,
      true,
    )
    try {
      const login = client.login('person@example.test', 'Public password')
      await unlocking
      const cancelled = expect(login).rejects.toMatchObject({
        kind: 'cancelled',
        code: 'operation_cancelled',
      })
      documentEvents.dispatchEvent(new Event('visibilitychange'))
      const interrupted = client.getSession()
      releaseUnlock!()
      await cancelled
      expect(interrupted).toEqual({ phase: 'signedOut' })
      expect(disposed()).toBe(1)
      expect(client.getSession()).toEqual({ phase: 'signedOut' })
      await client.login('person@example.test', 'Public password')
      expect(client.getSession().phase).toBe('unlocked')
    } finally {
      releaseUnlock?.()
      client.dispose()
      vi.unstubAllGlobals()
    }
  })

  it.each([
    { TwoFactorProviders: [0], TwoFactorProviders2: { '0': {} } },
    { TwoFactorProviders: [0] },
    { TwoFactorProviders2: { '0': {} } },
    { TwoFactorProviders2: { '0': null } },
    { TwoFactorProviders: [{ type: 'totp' }] },
  ])(
    'binds supported TOTP metadata %j to the original device without exposing the challenge',
    async (providers) => {
      let grants = 0
      const { client, calls } = fixture((path) =>
        path === '/identity/connect/token' && ++grants === 1
          ? json(
              {
                error: 'invalid_grant',
                TwoFactorToken: 'c'.repeat(43),
                ...providers,
              },
              400,
            )
          : json(token),
      )
      await client.login('person@example.test', 'Public password')
      expect(client.getSession().phase).toBe('totpRequired')
      expect(JSON.stringify(client.getSession())).not.toContain('c'.repeat(43))
      await client.verifyTotp('123456')
      const forms = calls
        .filter((call) => call.path === '/identity/connect/token')
        .map((call) => new URLSearchParams(call.init.body as string))
      expect(forms[1]!.get('deviceIdentifier')).toBe(
        forms[0]!.get('deviceIdentifier'),
      )
      expect(forms[1]!.get('twoFactorToken')).toBe('c'.repeat(43))
      expect(forms[1]!.get('twoFactorCode')).toBe('123456')
      expect(client.getSession().mfaVerified).toBe(true)
      client.dispose()
    },
  )

  it.each([
    { TwoFactorProviders: [{ type: 'email' }] },
    { TwoFactorProviders: [1], TwoFactorProviders2: { '1': {} } },
    { TwoFactorProviders: ['0'] },
    { TwoFactorProviders2: { '0': 'invalid' } },
  ])(
    'refuses unsupported second-factor metadata %j instead of mislabeling it TOTP',
    async (providers) => {
      const { client } = fixture(() =>
        json(
          {
            error: 'invalid_grant',
            TwoFactorToken: 'c'.repeat(43),
            ...providers,
          },
          400,
        ),
      )
      await expect(
        client.login('person@example.test', 'Public password'),
      ).rejects.toMatchObject({ code: 'second_factor_unsupported' })
      expect(client.getSession().phase).toBe('signedOut')
      client.dispose()
    },
  )

  it('preserves committed invite failure metadata without retrying the invitation batch', async () => {
    const { client, calls } = fixture((path) =>
      path === '/identity/connect/token'
        ? json(token)
        : json(
            {
              error: {
                code: 'invitation_delivery_unavailable',
                message: 'public-test-raw-error-must-not-escape',
              },
              persisted: true,
              membershipIds: ['member'],
              requestId: 'request',
            },
            503,
          ),
    )
    await client.login('person@example.test', 'Public password')
    await expect(
      client.inviteMembers('org', {
        emails: ['recipient@example.test'],
        type: 2,
        collections: [],
      }),
    ).rejects.toMatchObject({
      kind: 'unavailable',
      code: 'invitation_delivery_unavailable',
      persisted: true,
      membershipIds: ['member'],
      requestId: 'request',
    })
    expect(
      calls.filter((call) => call.path.endsWith('/users/invite')),
    ).toHaveLength(1)
    expect(client.getSession().phase).toBe('unlocked')
    client.dispose()
  })

  it.each([403, 404, 409])(
    'reports uncertain readback after a successful invite followed by HTTP %s rather than a rejected write',
    async (status) => {
      const { client, calls } = fixture((path) => {
        if (path === '/identity/connect/token') return json(token)
        if (path.endsWith('/users/invite'))
          return new Response(null, { status: 200 })
        return json(
          {
            error: {
              code: 'membership_conflict',
              message: 'Public untrusted failure detail',
            },
            requestId: 'readback-request',
          },
          status,
        )
      })
      await client.login('person@example.test', 'Public password')
      await expect(
        client.inviteMembers('org', {
          emails: ['recipient@example.test'],
          type: 2,
          collections: [],
        }),
      ).rejects.toMatchObject({
        kind: 'unavailable',
        code: 'mutation_readback_unavailable',
        requestId: 'readback-request',
      })
      expect(
        calls.filter((call) => call.path.endsWith('/users/invite')),
      ).toHaveLength(1)
      client.dispose()
    },
  )

  it('preserves a rejected mutation and never attempts its success readback', async () => {
    const { client, calls } = fixture((path) =>
      path === '/identity/connect/token'
        ? json(token)
        : json({ error: { code: 'membership_conflict' } }, 409),
    )
    await client.login('person@example.test', 'Public password')
    await expect(
      client.inviteMembers('org', {
        emails: ['recipient@example.test'],
        type: 2,
        collections: [],
      }),
    ).rejects.toMatchObject({ kind: 'conflict', code: 'membership_conflict' })
    expect(
      calls.some((call) =>
        call.path.endsWith('/users?includeCollections=true'),
      ),
    ).toBe(false)
    client.dispose()
  })

  it('encrypts collection names and preserves assignments by omitting selection fields', async () => {
    const { client, calls } = fixture((path) =>
      path === '/identity/connect/token'
        ? json(token)
        : json({
            Id: 'collection',
            OrganizationId: 'org',
            Name: '2.public-encrypted-name',
          }),
    )
    await client.login('person@example.test', 'Public password')
    const result = await client.updateCollection('org', 'collection', {
      name: 'Public plaintext name',
    })
    const write = calls.find((call) => call.init.method === 'PUT')!
    expect(JSON.parse(write.init.body as string)).toEqual({
      name: '2.public-encrypted-name',
    })
    expect(String(write.init.body)).not.toContain('Public plaintext name')
    expect(result.name).toEqual({
      status: 'decrypted',
      value: 'Public decrypted name',
    })
    client.dispose()
  })

  it('clears local session immediately even when current-family logout fails', async () => {
    const { client, calls } = fixture((path) =>
      path === '/identity/connect/token'
        ? json(token)
        : json({ error: { code: 'database_unavailable' } }, 503),
    )
    await client.login('person@example.test', 'Public password')
    const logout = client.logout()
    expect(client.getSession()).toEqual({ phase: 'signedOut' })
    await expect(logout).rejects.toMatchObject({ code: 'database_unavailable' })
    expect(
      calls.filter((call) => call.path === '/identity/accounts/logout'),
    ).toHaveLength(1)
    await expect(client.listMembers('org')).rejects.toMatchObject({
      code: 'locked',
    })
    client.dispose()
  })

  it('returns ephemeral enrollment display and rereads actual assurance after verification', async () => {
    const secret = 'ABCDEFGHIJKLMNOP'
    const { client, calls } = fixture((path) =>
      path === '/identity/connect/token'
        ? json(token)
        : path === '/identity/accounts/totp/setup'
          ? json({
              object: 'totpSetup',
              secret,
              uri: `otpauth://totp/HonoWarden?secret=${secret}`,
              enabled: false,
            })
          : json({ object: 'totp', enabled: true }),
    )
    await client.login('person@example.test', 'Public password')
    const setup = await client.startTotpSetup()
    expect(setup.secret).toBe(secret)
    expect(JSON.stringify(client.getSession())).not.toContain(secret)
    await client.verifyTotpSetup('123456')
    expect(
      JSON.parse(
        calls.find(
          (call) => call.path === '/identity/accounts/totp/setup/verify',
        )!.init.body as string,
      ),
    ).toEqual({ code: '123456' })
    expect(client.getSession().mfaVerified).toBe(false)
    client.dispose()
  })

  it('retains the loaded group revision and rejects concurrent edits without replay', async () => {
    const etag = '"group:2026-10-04T00:00:00.000Z"'
    const row = {
      Object: 'groupDetails',
      Id: 'group',
      OrganizationId: 'org',
      Name: 'Public Group',
      Collections: [],
    }
    const { client, calls } = fixture((path, init) => {
      if (path === '/identity/connect/token') return json(token)
      if (init.method === 'PUT')
        return json({ error: { code: 'group_conflict' } }, 409)
      return new Response(
        JSON.stringify(path.endsWith('/users') ? ['member'] : row),
        { headers: { 'Content-Type': 'application/json', ETag: etag } },
      )
    })
    await client.login('person@example.test', 'Public password')
    const edit = await client.getGroup('org', 'group')
    expect(edit.memberIds).toEqual(['member'])
    await expect(
      client.updateGroup('org', 'group', {
        name: 'Public edited Group',
        memberIds: edit.memberIds,
        collections: edit.collections,
        revision: edit.revision,
      }),
    ).rejects.toMatchObject({ kind: 'conflict', code: 'group_conflict' })
    const writes = calls.filter((call) => call.init.method === 'PUT')
    expect(writes).toHaveLength(1)
    expect(
      (writes[0]!.init.headers as Record<string, string>)['If-Match'],
    ).toBe(etag)
    expect(JSON.parse(writes[0]!.init.body as string)).toEqual({
      name: 'Public edited Group',
      users: ['member'],
      collections: [],
    })
    client.dispose()
  })

  it('scrubs invitation capability before parsing and never returns it in session view', () => {
    const replaced: string[] = []
    const invitation = consumeInvitation(
      {
        pathname: '/admin/accept/org/member',
        hash: `#token=${'i'.repeat(43)}`,
      },
      (path) => replaced.push(path),
    )!
    expect(replaced).toEqual(['/admin/accept/org/member'])
    const client = createAdminClient({ lifecycle: false, invitation })
    expect(client.getSession().pendingInvitation).toEqual({
      organizationId: 'org',
      membershipId: 'member',
    })
    expect(JSON.stringify(client.getSession())).not.toContain('i'.repeat(43))
    client.dispose()
    expect(() =>
      consumeInvitation(
        { pathname: '/admin/accept/org/member', hash: '#token=bad&token=bad' },
        (path) => replaced.push(path),
      ),
    ).toThrow()
    expect(replaced).toHaveLength(2)
  })

  it('preserves ordinary navigation fragments without treating them as invitations', () => {
    const replace = vi.fn()
    expect(
      consumeInvitation(
        { pathname: '/admin/', hash: '#main-content' },
        replace,
      ),
    ).toBeUndefined()
    expect(replace).not.toHaveBeenCalled()
  })

  it('rejects an invitation route with no capability fragment', () => {
    expect(() =>
      consumeInvitation(
        { pathname: '/admin/accept/org/member', hash: '' },
        vi.fn(),
      ),
    ).toThrow(expect.objectContaining({ code: 'invitation_invalid' }))
  })

  it('singleflights refresh rotation across simultaneous reads', async () => {
    let time = 0
    let release: ((response: Response) => void) | undefined
    let started: (() => void) | undefined
    const entered = new Promise<void>((resolve) => {
      started = resolve
    })
    const { client, calls } = fixture(
      (path, init) => {
        if (path !== '/identity/connect/token')
          return new Response(null, { status: 200 })
        const form = new URLSearchParams(init.body as string)
        if (form.get('grant_type') !== 'refresh_token')
          return json({ ...token, expires_in: 45 })
        started!()
        return new Promise<Response>((resolve) => {
          release = resolve
        })
      },
      undefined,
      () => time,
    )
    await client.login('person@example.test', 'Public password')
    time = 30_000
    const first = client.sync()
    const second = client.sync()
    await entered
    release!(json({ ...token, refresh_token: 'public-rotated-refresh-token' }))
    await Promise.all([first, second])
    expect(
      calls.filter(
        (call) =>
          call.path === '/identity/connect/token' &&
          new URLSearchParams(call.init.body as string).get('grant_type') ===
            'refresh_token',
      ),
    ).toHaveLength(1)
    client.dispose()
  })

  it('does not restore old organization keys or views when an earlier sync finishes after a newer revoked profile', async () => {
    let assuranceCount = 0
    let profileCount = 0
    let releaseOlder: ((response: Response) => void) | undefined
    let enteredOlder: (() => void) | undefined
    const olderWaiting = new Promise<void>((resolve) => {
      enteredOlder = resolve
    })
    const cryptoCommands: CryptoCommand[] = []
    let organizationKeys: { id: string; key: string }[] = []
    const client = createAdminClient({
      lifecycle: false,
      crypto: () => ({
        async call<T>(command: CryptoCommand): Promise<T> {
          cryptoCommands.push(structuredClone(command))
          if (command.action === 'unlock')
            organizationKeys = structuredClone(command.account.organizations)
          if (command.action === 'organizations')
            organizationKeys = structuredClone(command.organizations)
          return (
            command.action === 'derive' ? 'public-derived-auth-hash' : null
          ) as T
        },
        dispose() {
          organizationKeys = []
        },
      }),
      async fetch(input) {
        const path = String(input)
        if (path === '/identity/accounts/prelogin') return json(settings)
        if (path === '/identity/connect/token') return json(token)
        if (path === '/api/accounts/profile') {
          profileCount++
          return json(
            profileCount < 3 ? profile : { ...profile, Organizations: [] },
          )
        }
        if (path === '/identity/accounts/totp/assurance') {
          assuranceCount++
          if (assuranceCount === 2) {
            enteredOlder!()
            return new Promise<Response>((resolve) => {
              releaseOlder = resolve
            })
          }
          return json({ object: 'totpSession', verified: assuranceCount === 3 })
        }
        throw new Error('Unexpected synthetic endpoint')
      },
    })
    await client.login('person@example.test', 'Public password')
    expect(organizationKeys.map((entry) => entry.id)).toEqual(['org'])
    const older = client.sync()
    await olderWaiting
    await client.sync()
    expect(organizationKeys).toEqual([])
    expect(client.getSession()).toMatchObject({
      organizations: [],
      mfaVerified: true,
    })
    releaseOlder!(json({ object: 'totpSession', verified: false }))
    await older
    expect(organizationKeys).toEqual([])
    expect(client.getSession()).toMatchObject({
      organizations: [],
      mfaVerified: true,
    })
    expect(
      cryptoCommands.filter((command) => command.action === 'organizations'),
    ).toEqual([{ action: 'organizations', organizations: [] }])
    client.dispose()
  })

  it('requires a fresh login after ambiguous refresh failure and never reuses the old refresh token', async () => {
    let time = 0
    const { client, calls } = fixture(
      (path, init) => {
        if (path !== '/identity/connect/token')
          return new Response(null, { status: 200 })
        const form = new URLSearchParams(init.body as string)
        if (form.get('grant_type') === 'refresh_token')
          throw new Error('public untrusted transport error')
        return json({ ...token, expires_in: 45 })
      },
      undefined,
      () => time,
    )
    await client.login('person@example.test', 'Public password')
    time = 30_000
    await expect(client.sync()).rejects.toMatchObject({
      kind: 'transport',
      code: 'request_unavailable',
    })
    expect(client.getSession().phase).toBe('expired')
    await expect(client.sync()).rejects.toMatchObject({ code: 'locked' })
    expect(
      calls.filter(
        (call) =>
          call.path === '/identity/connect/token' &&
          new URLSearchParams(call.init.body as string).get('grant_type') ===
            'refresh_token',
      ),
    ).toHaveLength(1)
    client.dispose()
  })
})

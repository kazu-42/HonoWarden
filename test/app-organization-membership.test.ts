import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import { Hono } from 'hono'
import { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { registerOrganizationMembershipRoutes } from '../src/organization-membership-routes'
import { createOrganizationFoundation } from '../src/repositories/organization-repository'
import realApp from '../src/app'
import { signAccessToken } from '../src/domain/tokens'
import type { OrganizationMembershipDelivery } from '../src/organization-membership'
import {
  createOrganizationMembershipMailerDelivery,
  inviteOrganizationMembers,
} from '../src/organization-membership'

const instances: Miniflare[] = []
afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()))
})

const endpoints = [
  ['GET', '/api/organizations/org/users'],
  ['GET', '/api/organizations/org/users/member'],
  ['GET', '/api/users/member/public-key'],
  ['POST', '/api/organizations/org/users/invite'],
  ['POST', '/api/organizations/org/users/member/accept'],
  ['POST', '/api/organizations/org/users/member/confirm'],
  ['POST', '/api/organizations/org/users/member/reinvite'],
  ['POST', '/api/organizations/org/users/public-keys'],
  ['PUT', '/api/organizations/org/users/member'],
  ['PUT', '/api/organizations/org/users/member/revoke'],
  ['DELETE', '/api/organizations/org/users/member'],
] as const

describe('organization membership route gates', () => {
  it('mounts actual app routes before unsupported wildcards and keeps disabled requests D1-free under global quota', async () => {
    const prepare = vi.fn(() => {
      throw new Error('D1 must not be touched')
    })
    for (const [method, path] of [
      ...endpoints,
      ['HEAD', '/api/organizations/org/users'],
      ['HEAD', '/api/organizations/org/users/member'],
      ['HEAD', '/api/users/member/public-key'],
    ] as const) {
      const response = await realApp.request(
        path,
        { method },
        {
          DB: { prepare } as unknown as D1Database,
          HONOWARDEN_GLOBAL_REQUEST_QUOTA: 'true',
        },
      )
      expect(response.status, `${method} ${path}`).toBe(501)
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
    expect(prepare).not.toHaveBeenCalled()
  })

  it.each([
    ['/invite', undefined],
    ['/member/reinvite', undefined],
    ['/member/accept', undefined],
    ['/invite', 's'.repeat(32)],
    ['/member/reinvite', 's'.repeat(32)],
  ] as const)(
    'reports enabled misconfiguration with global quota before D1: %s',
    async (suffix, inviteSecret) => {
      const prepare = vi.fn(() => {
        throw new Error('D1 must not be touched')
      })
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const response = await realApp.request(
          `/api/organizations/org/users${suffix}`,
          { method: 'POST' },
          {
            DB: { prepare } as unknown as D1Database,
            HONOWARDEN_ORGANIZATION_MEMBERSHIP_ENABLED: 'true',
            HONOWARDEN_GLOBAL_REQUEST_QUOTA: 'true',
            ...(inviteSecret === undefined
              ? {}
              : { HONOWARDEN_ORGANIZATION_INVITE_SECRET: inviteSecret }),
          },
        )
        expect(response.status).toBe(503)
        expect(await response.json()).toMatchObject({
          error: { code: 'server_misconfigured' },
        })
        expect(log).toHaveBeenCalled()
        expect(prepare).not.toHaveBeenCalled()
      } finally {
        log.mockRestore()
      }
    },
  )

  it.each([false, true])(
    'bounds oversized JSON before D1 even when streamed=%s without Content-Length',
    async (streamed) => {
      const prepare = vi.fn(() => {
        throw new Error('D1 must not be touched')
      })
      const app = testApp({ prepare } as unknown as D1Database, [])
      const bytes = new TextEncoder().encode(
        JSON.stringify({ key: 'x'.repeat(140 * 1024) }),
      )
      const body = streamed
        ? new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes.subarray(0, 64 * 1024))
              controller.enqueue(bytes.subarray(64 * 1024))
              controller.close()
            },
          })
        : new TextDecoder().decode(bytes)
      const response = await app.request(
        new Request(
          'http://localhost/api/organizations/org/users/member/confirm',
          {
            method: 'POST',
            headers: {
              'test-user': 'owner',
              'content-type': 'application/json',
            },
            body,
            ...(streamed ? { duplex: 'half' } : {}),
          } as RequestInit,
        ),
      )
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        error: { code: 'invalid_request' },
      })
      expect(prepare).not.toHaveBeenCalled()
    },
  )
  it('keeps the entire surface default-off without authenticating or touching D1', async () => {
    const authenticate = vi.fn()
    const prepare = vi.fn(() => {
      throw new Error('D1 must not be touched')
    })
    const app = new Hono()
    registerOrganizationMembershipRoutes(app, {
      authenticate,
      runtime: () => ({
        enabled: false,
        database: { prepare } as unknown as D1Database,
      }),
      requestId: () => 'membership-test',
      reportFailure: vi.fn(),
    })
    for (const [method, path] of endpoints) {
      const response = await app.request(path, { method })
      expect(response.status, `${method} ${path}`).toBe(501)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.json()).toMatchObject({
        error: { code: 'unsupported_feature' },
      })
    }
    expect(
      (await app.request('/api/organizations/org/users', { method: 'HEAD' }))
        .status,
    ).toBe(501)
    expect(authenticate).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
  })

  it('reports missing invitation transport before authentication or any D1 write', async () => {
    const authenticate = vi.fn()
    const prepare = vi.fn(() => {
      throw new Error('D1 must not be touched')
    })
    const reportFailure = vi.fn()
    const app = new Hono()
    registerOrganizationMembershipRoutes(app, {
      authenticate,
      runtime: () => ({
        enabled: true,
        database: { prepare } as unknown as D1Database,
        inviteSecret: 's'.repeat(32),
      }),
      requestId: () => 'membership-test',
      reportFailure,
    })
    const response = await app.request('/api/organizations/org/users/invite', {
      method: 'POST',
    })
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      error: { code: 'server_misconfigured' },
    })
    expect(reportFailure).toHaveBeenCalledWith(expect.anything(), {
      code: 'server_misconfigured',
      operation: 'invite',
    })
    expect(authenticate).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
  })
})

describe('organization membership API on real local D1', () => {
  it.each([false, true])(
    'uses real bearer auth and decrypts recipient-specific shared keys with readOnly=%s',
    async (readOnly) => {
      const db = await database()
      const deliveries: OrganizationMembershipDelivery[] = []
      await db
        .prepare(
          'INSERT INTO devices (id, user_id, identifier, session_id) VALUES (?, ?, ?, ?)',
        )
        .bind(
          'owner-device',
          'owner',
          'membership-test-device',
          'membership-test-session',
        )
        .run()
      const token = await signAccessToken(
        'synthetic-membership-access-secret',
        {
          sub: 'owner',
          email: 'owner@example.test',
          device: 'membership-test-device',
          sessionId: 'membership-test-session',
          securityStamp: 'synthetic-stamp',
          iat: 1,
          exp: 4102444800,
        },
      )
      const environment = {
        DB: db,
        HONOWARDEN_TOKEN_SECRET: 'synthetic-membership-access-secret',
        HONOWARDEN_ORGANIZATION_MEMBERSHIP_ENABLED: 'true',
        HONOWARDEN_ORGANIZATION_INVITE_SECRET: 's'.repeat(32),
        ORGANIZATION_MEMBERSHIP_MAILER: {
          fetch: async (_request: unknown, init?: RequestInit) => {
            deliveries.push(
              JSON.parse(String(init?.body)) as OrganizationMembershipDelivery,
            )
            return new Response(null, { status: 202 })
          },
        } as unknown as Fetcher,
      }
      const headers = {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      }
      const invited = await realApp.request(
        '/api/organizations/org/users/invite',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            emails: ['member@example.test'],
            type: 2,
            accessSecretsManager: false,
            groups: [],
            permissions: { response: null },
            collections: [{ id: 'collection', readOnly, manage: false }],
          }),
        },
        environment,
      )
      expect(invited.status).toBe(200)
      expect(deliveries).toHaveLength(1)
      const response = await realApp.request(
        '/api/organizations/org/users',
        { headers },
        environment,
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        data: expect.arrayContaining([
          expect.objectContaining({
            Id: deliveries[0]!.membershipId,
            Status: 0,
            Type: 2,
          }),
        ]),
      })
      const memberId = deliveries[0]!.membershipId
      const ownerKeys = (await crypto.subtle.generateKey(
        {
          name: 'RSA-OAEP',
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256',
        },
        true,
        ['encrypt', 'decrypt'],
      )) as CryptoKeyPair
      const memberKeys = (await crypto.subtle.generateKey(
        {
          name: 'RSA-OAEP',
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256',
        },
        true,
        ['encrypt', 'decrypt'],
      )) as CryptoKeyPair
      const organizationKey = crypto.getRandomValues(new Uint8Array(64))
      // CLI 2026.9.0 EncryptionType maps RSA-OAEP SHA-256 to type 3, SHA-1 to type 4.
      const ownerWrappedKey = `3.${encode(new Uint8Array(await crypto.subtle.encrypt('RSA-OAEP', ownerKeys.publicKey, organizationKey)))}`
      const memberWrappedKey = `3.${encode(new Uint8Array(await crypto.subtle.encrypt('RSA-OAEP', memberKeys.publicKey, organizationKey)))}`
      await db
        .prepare('UPDATE organization_users SET org_key = ? WHERE id = ?')
        .bind(ownerWrappedKey, 'owner-membership')
        .run()
      await db
        .prepare('UPDATE users SET public_key = ? WHERE id = ?')
        .bind(
          encode(
            new Uint8Array(
              (await crypto.subtle.exportKey(
                'spki',
                memberKeys.publicKey,
              )) as ArrayBuffer,
            ),
          ),
          'member',
        )
        .run()
      await db
        .prepare(
          'INSERT INTO devices (id, user_id, identifier, session_id) VALUES (?, ?, ?, ?)',
        )
        .bind(
          'member-device',
          'member',
          'membership-test-device',
          'member-session',
        )
        .run()
      const memberToken = await signAccessToken(
        'synthetic-membership-access-secret',
        {
          sub: 'member',
          email: 'member@example.test',
          device: 'membership-test-device',
          sessionId: 'member-session',
          securityStamp: 'synthetic-stamp',
          iat: 1,
          exp: 4102444800,
        },
      )
      const memberHeaders = {
        authorization: `Bearer ${memberToken}`,
        'content-type': 'application/json',
      }
      const mutation = (
        path: string,
        actorHeaders: Record<string, string>,
        body: unknown,
        method = 'POST',
      ) =>
        realApp.request(
          path,
          { method, headers: actorHeaders, body: JSON.stringify(body) },
          environment,
        )
      expect(
        (
          await realApp.request(
            `/api/organizations/org/users/${memberId}/accept`,
            {
              method: 'POST',
              headers: memberHeaders,
              body: JSON.stringify({ token: deliveries[0]!.token }),
            },
            {
              DB: db,
              HONOWARDEN_TOKEN_SECRET: environment.HONOWARDEN_TOKEN_SECRET,
              HONOWARDEN_ORGANIZATION_MEMBERSHIP_ENABLED: 'true',
              HONOWARDEN_ORGANIZATION_INVITE_SECRET:
                environment.HONOWARDEN_ORGANIZATION_INVITE_SECRET,
            },
          )
        ).status,
      ).toBe(200)
      const before = await realApp.request(
        '/api/sync',
        { headers: memberHeaders },
        environment,
      )
      expect(before.status).toBe(200)
      expect(await before.json()).toMatchObject({
        profile: { organizations: [] },
        collections: [],
        ciphers: [],
      })
      const details = await realApp.request(
        `/api/organizations/org/users/${memberId}`,
        { headers },
        environment,
      )
      expect(details.status).toBe(200)
      expect(await details.json()).toMatchObject({
        Id: memberId,
        UserId: 'member',
        Status: 1,
        Type: 2,
      })
      const publicKeyRead = await realApp.request(
        '/api/users/member/public-key',
        { headers },
        environment,
      )
      expect(publicKeyRead.status).toBe(200)
      const recipientPublic = (await publicKeyRead.json()) as {
        UserId: string
        PublicKey: string
      }
      expect(recipientPublic.UserId).toBe('member')
      expect(recipientPublic.PublicKey).toBe(
        encode(
          new Uint8Array(
            (await crypto.subtle.exportKey(
              'spki',
              memberKeys.publicKey,
            )) as ArrayBuffer,
          ),
        ),
      )
      expect(
        (
          await realApp.request(
            '/api/users/owner/public-key',
            { headers: memberHeaders },
            environment,
          )
        ).status,
      ).toBe(404)
      const keyResponse = await mutation(
        '/api/organizations/org/users/public-keys',
        headers,
        { ids: [memberId] },
      )
      expect(keyResponse.status).toBe(200)
      expect(await keyResponse.json()).toMatchObject({
        data: [
          {
            Id: memberId,
            UserId: 'member',
            Key: encode(
              new Uint8Array(
                (await crypto.subtle.exportKey(
                  'spki',
                  memberKeys.publicKey,
                )) as ArrayBuffer,
              ),
            ),
          },
        ],
      })
      expect(
        (
          await mutation(
            `/api/organizations/org/users/${memberId}/confirm`,
            headers,
            {
              key: memberWrappedKey,
              defaultUserCollectionName: await encryptSymmetric(
                organizationKey,
                new TextEncoder().encode('My items'),
              ),
            },
          )
        ).status,
      ).toBe(200)
      expect(
        await db.prepare('SELECT COUNT(*) AS count FROM collections').first(),
      ).toEqual({ count: 1 })
      expect(
        (
          await mutation(
            `/api/organizations/org/users/${memberId}`,
            headers,
            {
              type: 2,
              accessSecretsManager: false,
              accessPam: false,
              permissions: { response: null },
              groups: [],
              collections: [
                {
                  id: 'collection',
                  readOnly,
                  hidePasswords: false,
                  manage: false,
                },
              ],
            },
            'PUT',
          )
        ).status,
      ).toBe(200)
      const cipherKey = crypto.getRandomValues(new Uint8Array(64))
      const wrappedCipherKey = await encryptSymmetric(
        organizationKey,
        cipherKey,
      )
      const encryptedName = await encryptSymmetric(
        cipherKey,
        new TextEncoder().encode('Synthetic shared credential'),
      )
      const creation = await mutation('/api/ciphers/create', headers, {
        cipher: {
          type: 1,
          folderId: null,
          organizationId: 'org',
          key: wrappedCipherKey,
          name: encryptedName,
          login: {
            username: await encryptSymmetric(
              cipherKey,
              new TextEncoder().encode('synthetic-user'),
            ),
            password: await encryptSymmetric(
              cipherKey,
              new TextEncoder().encode('synthetic-password'),
            ),
            uris: [],
          },
        },
        collectionIds: ['collection'],
      })
      expect(creation.status).toBe(200)
      const shared = (await creation.json()) as { id: string }
      const sync = await realApp.request(
        '/api/sync',
        { headers: memberHeaders },
        environment,
      )
      expect(sync.status).toBe(200)
      const synced = (await sync.json()) as {
        profile: { organizations: { Key: string }[] }
        ciphers: {
          id: string
          key: string
          name: string
          edit: boolean
          viewPassword: boolean
        }[]
      }
      expect(synced.profile.organizations).toHaveLength(1)
      expect(synced.profile.organizations[0]!.Key === memberWrappedKey).toBe(
        true,
      )
      expect(JSON.stringify(synced).includes(ownerWrappedKey)).toBe(false)
      const decryptedOrg = await decryptOrganizationKeySha256(
        memberKeys.privateKey,
        synced.profile.organizations[0]!.Key,
      )
      const cipher = synced.ciphers.find((cipher) => cipher.id === shared.id)!
      expect(cipher.edit).toBe(!readOnly)
      expect(cipher.viewPassword).toBe(true)
      const decryptedCipherKey = await decryptSymmetric(
        decryptedOrg,
        cipher.key,
      )
      expect(
        new TextDecoder().decode(
          await decryptSymmetric(decryptedCipherKey, cipher.name),
        ),
      ).toBe('Synthetic shared credential')
      expect(
        (
          await realApp.request(
            `/api/ciphers/${shared.id}`,
            { headers: memberHeaders },
            environment,
          )
        ).status,
      ).toBe(200)
      expect(
        (
          await mutation(
            `/api/organizations/org/users/${memberId}/revoke`,
            headers,
            undefined,
            'PUT',
          )
        ).status,
      ).toBe(200)
      const revokedSync = await realApp.request(
        '/api/sync',
        { headers: memberHeaders },
        environment,
      )
      expect(await revokedSync.json()).toMatchObject({
        profile: { organizations: [] },
        collections: [],
        ciphers: [],
      })
      expect(
        (
          await realApp.request(
            `/api/ciphers/${shared.id}`,
            { headers: memberHeaders },
            environment,
          )
        ).status,
      ).toBe(404)
    },
  )

  it('commits the entire batch before delivery and stops after a later recipient fails', async () => {
    const db = await database()
    const sent: OrganizationMembershipDelivery[] = []
    const app = testApp(db, [], async (delivery) => {
      sent.push(delivery)
      if (sent.length === 2)
        throw new Error('Synthetic ambiguous transport failure')
    })
    const response = await request(app, 'owner', 'POST', '/invite', {
      emails: [
        'member@example.test',
        'other@example.test',
        'third@example.test',
      ],
      type: 2,
    })
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      error: { code: 'invitation_delivery_unavailable' },
      persisted: true,
      membershipIds: expect.any(Array),
    })
    expect(sent).toHaveLength(2)
    expect(
      await db
        .prepare(
          'SELECT COUNT(*) AS count FROM organization_users WHERE status = 0',
        )
        .first(),
    ).toEqual({ count: 3 })
    expect(
      await db
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_events WHERE name = 'organization.member.invite'",
        )
        .first(),
    ).toEqual({ count: 3 })
  })
  it('commits service-level invitations on real D1', async () => {
    const db = await database()
    expect(
      await inviteOrganizationMembers(db, {
        actor: { userId: 'owner', emailNormalized: 'owner@example.test' },
        organizationId: 'org',
        membershipId: '',
        requestId: 'membership-test',
        now: new Date().toISOString(),
        inviteSecret: 's'.repeat(32),
        delivery: async () => {},
        body: {
          emails: ['member@example.test'],
          type: 2,
          collections: [{ id: 'collection', readOnly: true }],
        },
      }),
    ).toEqual({ status: 'success' })
  })
  it('returns a loud failure after ambiguous delivery and recovers through token-rotating reinvitation', async () => {
    const db = await database()
    const deliveries: OrganizationMembershipDelivery[] = []
    let failed = false
    const app = testApp(db, deliveries, async (delivery) => {
      deliveries.push(delivery)
      if (!failed) {
        failed = true
        throw new Error(`Transport included private token ${delivery.token}`)
      }
    })
    const invitation = await request(app, 'owner', 'POST', '/invite', {
      emails: ['member@example.test'],
      type: 2,
    })
    expect(invitation.status).toBe(503)
    const error = await invitation.text()
    expect(error).toContain('invitation_delivery_unavailable')
    expect(JSON.parse(error)).toMatchObject({
      persisted: true,
      membershipIds: [deliveries[0]!.membershipId],
    })
    expect(error).not.toContain(deliveries[0]!.token)
    const memberId = deliveries[0]!.membershipId
    expect(
      (await request(app, 'owner', 'POST', `/${memberId}/reinvite`)).status,
    ).toBe(200)
    expect(deliveries).toHaveLength(2)
    expect(deliveries[1]!.token).not.toBe(deliveries[0]!.token)
    expect(
      (
        await request(app, 'member', 'POST', `/${memberId}/accept`, {
          token: deliveries[0]!.token,
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await request(app, 'member', 'POST', `/${memberId}/accept`, {
          token: deliveries[1]!.token,
        })
      ).status,
    ).toBe(200)
    expect(
      (await request(app, 'owner', 'POST', `/${memberId}/reinvite`)).status,
    ).toBe(404)
  })

  it('rejects an all-or-none invitation conflict before delivering any token', async () => {
    const db = await database()
    const deliveries: OrganizationMembershipDelivery[] = []
    const app = testApp(db, deliveries)
    const result = await request(app, 'owner', 'POST', '/invite', {
      emails: ['member@example.test', 'owner@example.test'],
      type: 2,
    })
    expect(result.status).toBe(409)
    expect(deliveries).toEqual([])
    expect(
      await db
        .prepare('SELECT COUNT(*) AS count FROM organization_users')
        .first(),
    ).toEqual({ count: 1 })
    expect(
      await db.prepare('SELECT COUNT(*) AS count FROM audit_events').first(),
    ).toEqual({ count: 0 })
  })

  it('denies nonmanagers, rejects unsupported authority and preserves the last confirmed owner', async () => {
    const db = await database()
    const deliveries: OrganizationMembershipDelivery[] = []
    const app = testApp(db, deliveries)
    expect(
      (
        await request(app, 'outsider', 'POST', '/invite', {
          emails: ['member@example.test'],
          type: 2,
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await request(app, 'owner', 'POST', '/invite', {
          emails: ['member@example.test'],
          type: 4,
        })
      ).status,
    ).toBe(501)
    expect(
      (
        await request(app, 'owner', 'POST', '/invite', {
          emails: ['member@example.test'],
          type: 2,
          accessAll: true,
        })
      ).status,
    ).toBe(501)
    expect(
      (await request(app, 'owner', 'GET', '?includeGroups=true')).status,
    ).toBe(200)
    expect(
      (await request(app, 'owner', 'GET', '?includeCollections=unexpected'))
        .status,
    ).toBe(400)
    for (const [method, suffix, body] of [
      ['PUT', '/owner-membership', { type: 2, collections: [] }],
      ['PUT', '/owner-membership/revoke', undefined],
      ['DELETE', '/owner-membership', undefined],
    ] as const) {
      expect((await request(app, 'owner', method, suffix, body)).status).toBe(
        404,
      )
    }
    expect(
      await db
        .prepare('SELECT status, type FROM organization_users WHERE id = ?')
        .bind('owner-membership')
        .first(),
    ).toEqual({ status: 2, type: 0 })
    expect(deliveries).toEqual([])
  })

  it('runs a two-account invite, accept, public-key, confirm, assignment, revoke and remove loop without exposing tokens or wrapped keys', async () => {
    const db = await database()
    const deliveries: OrganizationMembershipDelivery[] = []
    const app = testApp(db, deliveries)
    const invited = await request(app, 'owner', 'POST', '/invite', {
      emails: ['Member@Example.test'],
      type: 2,
      collections: [{ id: 'collection', readOnly: true }],
    })
    expect(invited.status).toBe(200)
    expect(await invited.text()).toBe('')
    expect(deliveries).toHaveLength(1)
    const delivery = deliveries[0]!
    const list = await request(app, 'owner', 'GET', '?includeCollections=true')
    const listed = (await list.json()) as {
      data: { Id: string; Status: number; Collections: unknown[] }[]
    }
    expect(listed.data).toHaveLength(2)
    expect(JSON.stringify(listed)).not.toContain(delivery.token)
    expect(JSON.stringify(listed)).not.toContain('hmac-sha256')
    expect(JSON.stringify(listed)).not.toContain('owner-wrapped-key')
    const invite = listed.data.find(
      (member) => member.Id === delivery.membershipId,
    )!
    expect(invite.Status).toBe(0)
    expect(invite.Collections).toEqual([
      { Id: 'collection', ReadOnly: true, HidePasswords: false, Manage: false },
    ])
    expect(
      (
        await request(app, 'outsider', 'POST', `/${invite.Id}/accept`, {
          token: delivery.token,
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await request(app, 'member', 'POST', `/${invite.Id}/accept`, {
          token: delivery.token,
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await request(app, 'member', 'POST', `/${invite.Id}/accept`, {
          token: delivery.token,
        })
      ).status,
    ).toBe(404)
    const publicKeys = await request(app, 'owner', 'POST', '/public-keys', {
      ids: [invite.Id],
    })
    expect(publicKeys.status).toBe(200)
    expect(await publicKeys.json()).toMatchObject({
      data: [{ Id: invite.Id, UserId: 'member', Key: 'member-public-key' }],
    })
    expect(
      (
        await request(app, 'member', 'POST', `/${invite.Id}/confirm`, {
          key: 'member-wrapped-key',
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await request(app, 'owner', 'POST', `/${invite.Id}/confirm`, {
          key: 'member-wrapped-key',
        })
      ).status,
    ).toBe(200)
    expect(
      await db
        .prepare('SELECT org_key AS key FROM organization_users WHERE id = ?')
        .bind(invite.Id)
        .first(),
    ).toEqual({ key: 'member-wrapped-key' })
    expect((await request(app, 'member', 'GET', '')).status).toBe(404)
    expect(
      (
        await request(app, 'owner', 'PUT', `/${invite.Id}`, {
          type: 2,
          collections: [],
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await db
          .prepare(
            'SELECT * FROM collection_users WHERE organization_user_id = ?',
          )
          .bind(invite.Id)
          .all()
      ).results,
    ).toEqual([])
    expect(
      (await request(app, 'owner', 'PUT', `/${invite.Id}/revoke`)).status,
    ).toBe(200)
    expect(
      await db
        .prepare(
          'SELECT status, org_key AS key FROM organization_users WHERE id = ?',
        )
        .bind(invite.Id)
        .first(),
    ).toEqual({ status: -1, key: null })
    expect(
      (await request(app, 'owner', 'DELETE', `/${invite.Id}`)).status,
    ).toBe(200)
    const audit = await db
      .prepare(
        'SELECT name, context_json AS context FROM audit_events ORDER BY rowid',
      )
      .all()
    expect(audit.results.map((row) => row.name)).toEqual([
      'organization.member.invite',
      'organization.member.accept',
      'organization.member.confirm',
      'organization.member.update',
      'organization.member.revoke',
      'organization.member.remove',
    ])
    expect(JSON.stringify(audit.results)).not.toContain(delivery.token)
    expect(JSON.stringify(audit.results)).not.toContain('member-wrapped-key')
    expect(JSON.stringify(audit.results)).not.toContain('member@example.test')
  })
})

describe('organization membership transport', () => {
  const delivery: OrganizationMembershipDelivery = {
    recipientEmail: 'synthetic@example.test',
    token: 'A'.repeat(43),
    organizationId: 'org',
    membershipId: 'member',
    expiresAt: '2026-10-08T00:00:00.000Z',
  }
  it('uses a domain-specific service binding and accepts only an explicit 202', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 202 }))
    await createOrganizationMembershipMailerDelivery({
      fetch,
    } as unknown as Fetcher)(delivery)
    expect(fetch).toHaveBeenCalledWith(
      'https://organization-membership-mailer.internal/deliver',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(delivery),
      },
    )
  })
  it.each([200, 400, 500])(
    'fails loudly and redacts transport response %i',
    async (status) => {
      const fetch = vi.fn(async () => new Response(delivery.token, { status }))
      await expect(
        createOrganizationMembershipMailerDelivery({
          fetch,
        } as unknown as Fetcher)(delivery),
      ).rejects.toThrow('Organization membership invitation delivery failed.')
    },
  )
  it('redacts a thrown upstream exception', async () => {
    const fetch = vi.fn(async () => {
      throw new Error(delivery.token)
    })
    await expect(
      createOrganizationMembershipMailerDelivery({
        fetch,
      } as unknown as Fetcher)(delivery),
    ).rejects.toThrow('Organization membership invitation delivery failed.')
  })
})

function testApp(
  db: D1Database,
  deliveries: OrganizationMembershipDelivery[],
  deliver?: (delivery: OrganizationMembershipDelivery) => Promise<void>,
) {
  const app = new Hono()
  registerOrganizationMembershipRoutes(app, {
    authenticate: async (c) => {
      const userId = c.req.header('test-user') ?? 'outsider'
      return {
        ok: true,
        actor: { userId, emailNormalized: `${userId}@example.test` },
      }
    },
    runtime: () => ({
      enabled: true,
      database: db,
      inviteSecret: 's'.repeat(32),
      delivery:
        deliver ??
        (async (delivery) => {
          deliveries.push(delivery)
        }),
    }),
    requestId: () => 'membership-test',
    reportFailure: vi.fn(),
  })
  return app
}

function request(
  app: Hono,
  actor: string,
  method: string,
  suffix: string,
  body?: unknown,
) {
  return app.request(`/api/organizations/org/users${suffix}`, {
    method,
    headers: { 'test-user': actor, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}
function decode(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'))
}

async function decryptOrganizationKeySha256(
  privateKey: CryptoKey,
  wrapped: string,
): Promise<Uint8Array> {
  // Match the official SDK algorithm tag before invoking WebCrypto.
  expect(wrapped.split('.')[0]).toBe('3')
  expect(privateKey.algorithm).toMatchObject({
    name: 'RSA-OAEP',
    hash: { name: 'SHA-256' },
  })
  return new Uint8Array(
    await crypto.subtle.decrypt(
      'RSA-OAEP',
      privateKey,
      decode(wrapped.slice(2)),
    ),
  )
}
async function encryptSymmetric(
  key: Uint8Array,
  plaintext: Uint8Array,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(16))
  const cipherKey = await crypto.subtle.importKey(
    'raw',
    key.slice(0, 32),
    'AES-CBC',
    false,
    ['encrypt'],
  )
  const macKey = await crypto.subtle.importKey(
    'raw',
    key.slice(32),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, cipherKey, plaintext),
  )
  const signed = new Uint8Array([...iv, ...ciphertext])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', macKey, signed))
  return `2.${encode(iv)}|${encode(ciphertext)}|${encode(mac)}`
}
async function decryptSymmetric(
  key: Uint8Array,
  encrypted: string,
): Promise<Uint8Array> {
  expect(encrypted.split('.')[0]).toBe('2')
  const [ivText, ciphertextText, macText] = encrypted.slice(2).split('|')
  const iv = decode(ivText!),
    ciphertext = decode(ciphertextText!),
    mac = decode(macText!)
  const macKey = await crypto.subtle.importKey(
    'raw',
    key.slice(32),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  expect(
    await crypto.subtle.verify(
      'HMAC',
      macKey,
      mac,
      new Uint8Array([...iv, ...ciphertext]),
    ),
  ).toBe(true)
  const cipherKey = await crypto.subtle.importKey(
    'raw',
    key.slice(0, 32),
    'AES-CBC',
    false,
    ['decrypt'],
  )
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, cipherKey, ciphertext),
  )
}

async function database(): Promise<D1Database> {
  const instance = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: '2026-07-06',
    d1Databases: { DB: crypto.randomUUID() },
  })
  instances.push(instance)
  const db = (await instance.getD1Database('DB')) as unknown as D1Database
  const migrationRoot = fileURLToPath(new URL('../migrations', import.meta.url))
  for (const name of readdirSync(migrationRoot)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const lines: string[] = []
    let inTrigger = false
    for (const line of readFileSync(`${migrationRoot}/${name}`, 'utf8').split(
      '\n',
    )) {
      const trimmed = line.trim()
      if (lines.length === 0 && !trimmed) continue
      if (/^CREATE\s+TRIGGER\b/iu.test(trimmed)) inTrigger = true
      lines.push(line)
      if (inTrigger ? /^END;$/iu.test(trimmed) : trimmed.endsWith(';')) {
        await db.prepare(lines.join('\n')).run()
        lines.length = 0
        inTrigger = false
      }
    }
    if (lines.some((line) => line.trim()))
      throw new Error(`Incomplete migration: ${name}`)
  }
  const foundation: string[] = []
  for (const userId of ['owner', 'member', 'outsider']) {
    foundation.push(`INSERT INTO users (id, email, email_normalized, display_name, kdf_algorithm, kdf_iterations, master_password_hash, public_key, security_stamp, revision_date)
      VALUES ('${userId}', '${userId}@example.test', '${userId}@example.test', '${userId}', 'pbkdf2-sha256', 600000, 'synthetic-password-hash', '${userId}-public-key', 'synthetic-stamp', '2026-10-03T00:00:00.000Z')`)
  }
  await db.batch(foundation.map((sql) => db.prepare(sql)))
  await db
    .prepare(
      "UPDATE users SET user_key = '2.synthetic-user-key', private_key = '2.synthetic-private-key'",
    )
    .run()
  await createOrganizationFoundation(db, {
    organizationId: 'org',
    organizationUserId: 'owner-membership',
    collectionId: 'collection',
    userId: 'owner',
    email: 'owner@example.test',
    name: 'Synthetic organization',
    billingEmail: null,
    planType: 0,
    orgKey: 'owner-wrapped-key',
    publicKey: 'org-public-key',
    privateKey: 'org-encrypted-private-key',
    encryptedCollectionName: 'encrypted-collection-name',
    now: new Date().toISOString(),
  })
  return db
}

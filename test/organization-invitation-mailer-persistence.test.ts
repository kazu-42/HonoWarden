import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath, URL as NodeURL } from 'node:url'
import { Miniflare } from 'miniflare'
import { afterEach, expect, it, vi } from 'vitest'

// @ts-expect-error script helper intentionally ships as plain ESM.
import { migrationStatements } from '../scripts/honowarden-company-admin-smoke.mjs'
import {
  acceptOrganizationMember,
  createOrganizationMembershipMailerDelivery,
  inviteOrganizationMembers,
  reinviteOrganizationMember,
} from '../src/organization-membership'
import { createOrganizationInvitationMailer } from '../src/organization-invitation-mailer'
import { createOrganizationFoundation } from '../src/repositories/organization-repository'

const instances: Miniflare[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()))
})

it('keeps persisted invitations recoverable after ambiguous provider failure and consumes only the rotated token once', async () => {
  const db = await database()
  const now = '2026-10-06T00:00:00.000Z'
  const links: URL[] = []
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const receiver = createOrganizationInvitationMailer({
    adminOrigin: 'https://vault.example.test',
    senderEmail: 'invites@example.test',
    now: () => Date.parse(now),
    send: async (message) => {
      const link = new URL(message.text.match(/https:\/\/\S+/)![0])
      links.push(link)
      // The provider may have accepted the mail before the connection failed.
      if (links.length === 1) throw new Error(message.text)
      return 'accepted'
    },
  })
  const delivery = createOrganizationMembershipMailerDelivery({
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      receiver.fetch(new Request(input, init)),
  } as unknown as Fetcher)
  const common = {
    actor: { userId: 'owner', emailNormalized: 'owner@example.test' },
    organizationId: 'org',
    membershipId: '',
    requestId: 'synthetic-mail-test',
    now,
    inviteSecret: 's'.repeat(32),
    delivery,
  }
  const invitation = await inviteOrganizationMembers(db, {
    ...common,
    body: { emails: ['member@example.test'], type: 2 },
  })
  expect(invitation).toEqual({
    status: 'delivery_unavailable',
    membershipIds: [expect.any(String)],
  })
  if (invitation.status !== 'delivery_unavailable')
    throw new Error('Expected persisted delivery failure.')
  const membershipId = invitation.membershipIds[0]!
  const before = await db
    .prepare(
      'SELECT status, invite_token_hash AS verifier FROM organization_users WHERE id = ?',
    )
    .bind(membershipId)
    .first<{ status: number; verifier: string }>()
  expect(before?.status).toBe(0)
  const oldToken = new URLSearchParams(links[0]!.hash.slice(1)).get('token')!
  expect(before?.verifier).not.toContain(oldToken)

  expect(
    await reinviteOrganizationMember(db, { ...common, membershipId }),
  ).toEqual({ status: 'success' })
  expect(links).toHaveLength(2)
  const newToken = new URLSearchParams(links[1]!.hash.slice(1)).get('token')!
  expect(newToken).not.toBe(oldToken)
  const after = await db
    .prepare(
      'SELECT invite_token_hash AS verifier FROM organization_users WHERE id = ?',
    )
    .bind(membershipId)
    .first<{ verifier: string }>()
  expect(after?.verifier).not.toBe(before?.verifier)
  const recipient = {
    ...common,
    membershipId,
    actor: { userId: 'member', emailNormalized: 'member@example.test' },
  }
  expect(
    await acceptOrganizationMember(db, {
      ...recipient,
      body: { token: oldToken },
    }),
  ).toEqual({ status: 'not_found' })
  expect(
    await acceptOrganizationMember(db, {
      ...recipient,
      body: { token: newToken },
    }),
  ).toEqual({ status: 'success' })
  expect(
    await acceptOrganizationMember(db, {
      ...recipient,
      body: { token: newToken },
    }),
  ).toEqual({ status: 'not_found' })
  expect(
    await reinviteOrganizationMember(db, { ...common, membershipId }),
  ).toEqual({ status: 'not_found' })
  expect(links).toHaveLength(2)
  expect(
    await db
      .prepare(
        'SELECT status, invite_token_hash AS verifier, invite_expires_at AS expiry FROM organization_users WHERE id = ?',
      )
      .bind(membershipId)
      .first(),
  ).toEqual({ status: 1, verifier: null, expiry: null })
  expect(log).toHaveBeenCalledExactlyOnceWith(
    JSON.stringify({
      event: 'organization_invitation_delivery_failed',
      code: 'delivery_failed',
    }),
  )
})

async function database(): Promise<D1Database> {
  const instance = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: '2026-07-06',
    d1Databases: { DB: crypto.randomUUID() },
  })
  instances.push(instance)
  const db = (await instance.getD1Database('DB')) as unknown as D1Database
  const migrations = fileURLToPath(
    new NodeURL('../migrations', import.meta.url),
  )
  for (const name of readdirSync(migrations)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const statements: string[] = migrationStatements(
      readFileSync(`${migrations}/${name}`, 'utf8'),
    )
    for (const statement of statements) await db.prepare(statement).run()
  }
  for (const id of ['owner', 'member']) {
    await db
      .prepare(
        `INSERT INTO users (id, email, email_normalized, kdf_algorithm, kdf_iterations, master_password_hash, public_key, security_stamp, revision_date)
      VALUES (?, ?, ?, 'pbkdf2-sha256', 600000, 'synthetic-hash', 'synthetic-public-key', 'synthetic-stamp', '2026-10-06T00:00:00.000Z')`,
      )
      .bind(id, `${id}@example.test`, `${id}@example.test`)
      .run()
  }
  await createOrganizationFoundation(db, {
    organizationId: 'org',
    organizationUserId: 'owner-membership',
    collectionId: 'collection',
    userId: 'owner',
    email: 'owner@example.test',
    name: 'Synthetic organization',
    billingEmail: null,
    planType: 0,
    orgKey: 'synthetic-key',
    publicKey: 'synthetic-public-key',
    privateKey: 'synthetic-private-key',
    encryptedCollectionName: 'synthetic-collection',
    now: '2026-10-06T00:00:00.000Z',
  })
  return db
}

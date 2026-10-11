import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it } from 'vitest'
import app from '../../src/app'
import { buildOrganizationMembershipInviteTokenHash } from '../../src/domain/organization-membership'

const instances: Miniflare[] = []
const secret = 'public-test-invitation-secret-32-bytes'
const invitation = {
  organizationId: 'org',
  membershipId: 'member',
  token: 'A'.repeat(43),
}
const body = {
  email: 'new@example.test',
  displayName: 'New member',
  masterPasswordHash: Buffer.alloc(32, 1).toString('base64'),
  userKey: '2.public-user-key',
  publicKey: 'public-spki',
  privateKey: '2.public-private-key',
  invitation,
}
afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()))
})

async function fixture() {
  const instance = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: '2026-07-21',
    d1Databases: { DB: crypto.randomUUID() },
  })
  instances.push(instance)
  const DB = (await instance.getD1Database('DB')) as unknown as D1Database
  const root = fileURLToPath(
    new URL('../../migrations', import.meta.url).toString(),
  )
  for (const file of readdirSync(root)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const lines: string[] = []
    let trigger = false
    for (const line of readFileSync(`${root}/${file}`, 'utf8').split('\n')) {
      if (!lines.length && !line.trim()) continue
      if (/^CREATE\s+TRIGGER\b/iu.test(line.trim())) trigger = true
      lines.push(line)
      if (trigger ? /^END;$/iu.test(line.trim()) : line.trim().endsWith(';')) {
        await DB.prepare(lines.join('\n')).run()
        lines.length = 0
        trigger = false
      }
    }
    expect(lines.filter((line) => line.trim())).toEqual([])
  }
  await DB.prepare(
    "INSERT INTO organizations (id,name,revision_date) VALUES ('org','Public company',?)",
  )
    .bind(new Date().toISOString())
    .run()
  const hash = await buildOrganizationMembershipInviteTokenHash({
    secret,
    ...invitation,
    emailNormalized: body.email,
  })
  await DB.prepare(
    "INSERT INTO organization_users (id,organization_id,email,status,type,invite_token_hash,invite_expires_at) VALUES ('member','org',?,0,2,?,?)",
  )
    .bind(body.email, hash, new Date(Date.now() + 86400_000).toISOString())
    .run()
  const env = {
    DB,
    HONOWARDEN_INVITATION_REGISTRATION_ENABLED: 'true',
    HONOWARDEN_ORGANIZATION_MEMBERSHIP_ENABLED: 'true',
    HONOWARDEN_ORGANIZATION_INVITE_SECRET: secret,
  }
  return {
    DB,
    env,
    register: (payload: unknown = body) =>
      app.request(
        '/api/accounts/register-invited',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        env,
      ),
  }
}

describe('invited account registration on real D1', () => {
  it('creates only a personal account and preserves explicit acceptance and confirmation', async () => {
    const { DB, register } = await fixture()
    const response = await register()
    expect(
      await DB.prepare('SELECT COUNT(*) AS count FROM users').first(),
    ).toEqual({ count: 1 })
    expect(response.status).toBe(201)
    expect(
      await DB.prepare(
        "SELECT name,target_id AS targetId,context_json AS context FROM audit_events WHERE name='organization.member.registration'",
      ).first(),
    ).toEqual({
      name: 'organization.member.registration',
      targetId: 'member',
      context: JSON.stringify({ organizationId: 'org' }),
    })
    expect(
      await DB.prepare(
        'SELECT email_normalized AS email,kdf_iterations AS iterations,email_verified_at AS verified,master_password_hash AS hash,user_key AS wrapped FROM users',
      ).first(),
    ).toEqual({
      email: body.email,
      iterations: 600000,
      verified: null,
      hash: body.masterPasswordHash,
      wrapped: body.userKey,
    })
    expect(
      await DB.prepare(
        'SELECT user_id AS userId,status,org_key AS key FROM organization_users',
      ).first(),
    ).toEqual({ userId: null, status: 0, key: null })
    expect((await register()).status).toBe(403)
    expect(
      await DB.prepare('SELECT COUNT(*) AS count FROM users').first(),
    ).toEqual({ count: 1 })
  })
  it('rolls back account creation when the required organization audit is ignored', async () => {
    const { DB, register } = await fixture()
    await DB.prepare(
      `CREATE TRIGGER ignore_registration_audit BEFORE INSERT ON audit_events
      WHEN NEW.name = 'organization.member.registration' BEGIN SELECT RAISE(IGNORE); END;`,
    ).run()
    expect((await register()).status).toBe(503)
    expect(
      await DB.prepare('SELECT COUNT(*) AS count FROM users').first(),
    ).toEqual({ count: 0 })
  })
  it.each([
    'expired',
    'revoked',
    'accepted',
    'rotated token',
    'disabled organization',
    'removed invitation',
    'wrong email',
    'wrong token',
    'wrong membership',
  ])('rejects %s without creating an account', async (change) => {
    const { DB, register } = await fixture()
    const payload = structuredClone(body)
    if (change === 'expired')
      await DB.prepare(
        "UPDATE organization_users SET invite_expires_at = '2000-01-01T00:00:00.000Z'",
      ).run()
    if (change === 'revoked')
      await DB.prepare('UPDATE organization_users SET status = -1').run()
    if (change === 'accepted')
      await DB.prepare('UPDATE organization_users SET status = 1').run()
    if (change === 'rotated token')
      await DB.prepare(
        "UPDATE organization_users SET invite_token_hash = 'new-hash'",
      ).run()
    if (change === 'disabled organization')
      await DB.prepare('UPDATE organizations SET enabled = 0').run()
    if (change === 'removed invitation')
      await DB.prepare('DELETE FROM organization_users').run()
    if (change === 'wrong email') payload.email = 'other@example.test'
    if (change === 'wrong token')
      payload.invitation.token = 'B'.repeat(42) + 'A'
    if (change === 'wrong membership') payload.invitation.membershipId = 'other'
    expect((await register(payload)).status).toBe(403)
    expect(
      await DB.prepare('SELECT COUNT(*) AS count FROM users').first(),
    ).toEqual({ count: 0 })
  })
  it('serializes concurrent creation and never replaces existing credentials', async () => {
    const { DB, register } = await fixture()
    const responses = await Promise.all([
      register(),
      register({
        ...body,
        masterPasswordHash: Buffer.alloc(32, 2).toString('base64'),
      }),
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 403,
    ])
    const original = await DB.prepare(
      'SELECT master_password_hash AS hash FROM users',
    ).first()
    expect(
      (
        await register({
          ...body,
          masterPasswordHash: Buffer.alloc(32, 3).toString('base64'),
        })
      ).status,
    ).toBe(403)
    expect(
      await DB.prepare(
        'SELECT master_password_hash AS hash FROM users',
      ).first(),
    ).toEqual(original)
  })
  it('rejects raw passwords, extra authority, incomplete keys and malformed input', async () => {
    const { DB, register } = await fixture()
    for (const payload of [
      { ...body, password: 'raw' },
      { ...body, role: 0 },
      { ...body, userKey: null },
      { ...body, masterPasswordHash: 'plain-password' },
      { ...body, displayName: 'x'.repeat(101) },
      { ...body, invitation: null },
    ]) {
      expect((await register(payload)).status).toBe(400)
    }
    expect(
      await DB.prepare('SELECT COUNT(*) AS count FROM users').first(),
    ).toEqual({ count: 0 })
  })
  it('keeps registration default-off before consulting D1', async () => {
    const response = await app.request(
      '/api/accounts/register-invited',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      {},
    )
    expect(response.status).toBe(404)
  })
})

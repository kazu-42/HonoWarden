import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../../src/app'

const instances: Miniflare[] = []
const secret = 'public-initial-setup-authorization-32-bytes'
const body = {
  email: 'first@example.test',
  displayName: 'First account',
  masterPasswordHash: Buffer.alloc(32, 1).toString('base64'),
  userKey: '2.public-wrapped-user',
  publicKey: 'public-spki',
  privateKey: '2.public-wrapped-private',
}
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()))
})
async function fixture() {
  const instance = new Miniflare({
    modules: true,
    cf: false,
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
  const env = {
    DB,
    HONOWARDEN_INITIAL_SETUP_ENABLED: 'true',
    HONOWARDEN_BOOTSTRAP_TOKEN: secret,
  }
  const register = (payload: unknown = body, token = secret, suffix = '') =>
    app.request(
      `/api/accounts/initial-setup${suffix}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-HonoWarden-Bootstrap-Token': token,
        },
        body: JSON.stringify(payload),
      },
      env,
    )
  const counts = async () => ({
    users: await DB.prepare('SELECT COUNT(*) AS n FROM users').first('n'),
    receipts: await DB.prepare(
      'SELECT COUNT(*) AS n FROM initial_setup_receipt',
    ).first('n'),
    audits: await DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_events WHERE name='admin.initial_setup'",
    ).first('n'),
  })
  return { DB, register, counts }
}
describe('initial setup on real D1', () => {
  it('creates wrapped account material once without granting a session, verification or organization membership', async () => {
    const { DB, register, counts } = await fixture()
    const response = await register()
    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await response.json()).toEqual({
      object: 'accountRegistration',
      created: true,
    })
    expect(await counts()).toEqual({ users: 1, receipts: 1, audits: 1 })
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
      await DB.prepare('SELECT COUNT(*) AS n FROM organization_users').first(
        'n',
      ),
    ).toBe(0)
    expect(
      await DB.prepare('SELECT COUNT(*) AS n FROM devices').first('n'),
    ).toBe(0)
    expect(
      (await register({ ...body, email: 'second@example.test' })).status,
    ).toBe(403)
  })
  it('serializes different concurrent first accounts and never overwrites the winner', async () => {
    const { DB, register, counts } = await fixture()
    const responses = await Promise.all([
      register(),
      register({
        ...body,
        email: 'second@example.test',
        masterPasswordHash: Buffer.alloc(32, 2).toString('base64'),
      }),
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 403,
    ])
    const before = await DB.prepare('SELECT * FROM users').all()
    expect((await register()).status).toBe(403)
    expect((await DB.prepare('SELECT * FROM users').all()).results).toEqual(
      before.results,
    )
    expect(await counts()).toEqual({ users: 1, receipts: 1, audits: 1 })
  })
  it('does not reopen after the initial account is deleted', async () => {
    const { DB, register, counts } = await fixture()
    expect((await register()).status).toBe(201)
    await DB.prepare('DELETE FROM users').run()
    expect((await register()).status).toBe(403)
    expect(await counts()).toEqual({ users: 0, receipts: 1, audits: 1 })
  })
  it('refuses an existing database even when every account is disabled and no setup receipt exists', async () => {
    const { DB, register, counts } = await fixture()
    await DB.prepare(
      "INSERT INTO users (id,email,email_normalized,kdf_algorithm,kdf_iterations,master_password_hash,security_stamp,revision_date,disabled_at) VALUES ('existing','existing@example.test','existing@example.test','pbkdf2-sha256',600000,'public-hash','stamp','2026-10-11','2026-10-11')",
    ).run()
    expect((await register()).status).toBe(403)
    expect(await counts()).toEqual({ users: 1, receipts: 0, audits: 0 })
  })
  it.each(['users', 'audit_events'])(
    'rolls back the singleton claim when a required %s insert is ignored',
    async (table) => {
      const { DB, register, counts } = await fixture()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await DB.prepare(
        `CREATE TRIGGER ignore_required BEFORE INSERT ON ${table} BEGIN SELECT RAISE(IGNORE); END;`,
      ).run()
      expect((await register()).status).toBe(503)
      expect(await counts()).toEqual({ users: 0, receipts: 0, audits: 0 })
      await DB.prepare('DROP TRIGGER ignore_required').run()
      expect((await register()).status).toBe(201)
    },
  )
  it('rejects unauthorized, oversized and query-bearing requests without consuming setup', async () => {
    const { register, counts } = await fixture()
    expect((await register(body, 'wrong')).status).toBe(403)
    expect((await register({ ...body, password: 'plain' })).status).toBe(400)
    expect(
      (await register({ ...body, displayName: 'x'.repeat(99000) })).status,
    ).toBe(400)
    expect((await register(body, secret, '?token=public')).status).toBe(400)
    expect(await counts()).toEqual({ users: 0, receipts: 0, audits: 0 })
    expect((await register()).status).toBe(201)
  })
})

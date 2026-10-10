import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestCompanyTestMail } from '../../src/company-test-mail'
import {
  readCompanySettings,
  updateCompanySettings,
} from '../../src/company-settings'

const instances: Miniflare[] = []
const actor = {
  userId: 'owner',
  sessionId: 'family',
  deviceIdentifier: 'device',
}
const scope = { organizationId: 'org', actor }
const now = '2026-10-11T00:00:00.000Z'
const settings = {
  name: 'Updated company',
  defaultEmailDomain: 'example.test',
  expectedMemberCount: 20,
  mailTestRecipient: 'mail-test@example.test',
  revision: null,
}
const input = {
  ...scope,
  settings,
  now,
  requestId: 'public-company-settings-test',
}
afterEach(async () => {
  vi.restoreAllMocks()
  vi.useRealTimers()
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
  const db = (await instance.getD1Database('DB')) as unknown as D1Database
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
        await db.prepare(lines.join('\n')).run()
        lines.length = 0
        trigger = false
      }
    }
    expect(lines.filter((line) => line.trim())).toEqual([])
  }
  await db
    .prepare(
      `INSERT INTO users (id,email,email_normalized,kdf_algorithm,kdf_iterations,master_password_hash,security_stamp,revision_date)
    VALUES ('owner','owner@example.test','owner@example.test','pbkdf2-sha256',600000,'public-hash','stamp',?)`,
    )
    .bind(now)
    .run()
  await db
    .prepare(
      "INSERT INTO organizations (id,name,revision_date) VALUES ('org','Original',?)",
    )
    .bind(now)
    .run()
  await db
    .prepare(
      "INSERT INTO organization_users (id,organization_id,user_id,email,status,type,org_key) VALUES ('membership','org','owner','owner@example.test',2,0,'public-wrapped-key')",
    )
    .run()
  await db
    .prepare(
      "INSERT INTO devices (id,user_id,identifier,session_id) VALUES ('device-id','owner','device','family')",
    )
    .run()
  return db
}

describe('company settings on real D1', () => {
  async function mailFixture() {
    const db = await fixture()
    const saved = await updateCompanySettings(db, input)
    if (saved.status !== 'success') throw new Error('fixture_settings_failed')
    const fetch = vi.fn(async () => new Response(null, { status: 202 }))
    const mailer = { fetch } as unknown as Fetcher
    const request = {
      ...scope,
      now,
      requestId: 'test-mail-request',
      revision: saved.settings.revision!,
    }
    return { db, fetch, mailer, request }
  }
  it('atomically claims one concurrent test request, sends the saved address, and preserves the cooldown across settings changes', async () => {
    const { db, fetch, mailer, request } = await mailFixture()
    expect(
      (
        await Promise.all([
          requestCompanyTestMail(db, mailer, request),
          requestCompanyTestMail(db, mailer, request),
        ])
      ).sort(),
    ).toEqual(['accepted', 'rate_limited'])
    expect(fetch).toHaveBeenCalledOnce()
    const args = (fetch.mock.calls as unknown as [string, RequestInit][])[0]!
    expect(args[0]).toBe('https://organization-membership-mailer.internal/test')
    expect(JSON.parse(args[1].body as string)).toEqual({
      recipientEmail: settings.mailTestRecipient,
      testId: expect.stringMatching(/^[a-f0-9-]{36}$/),
    })
    const row = await db
      .prepare(
        "SELECT context_json FROM audit_events WHERE name='organization.mail_test.request'",
      )
      .first()
    expect(row?.context_json).toBe('{"organizationId":"org"}')
    const changed = await updateCompanySettings(db, {
      ...input,
      settings: {
        ...settings,
        revision: request.revision,
        mailTestRecipient: 'different@example.test',
      },
    })
    if (changed.status !== 'success') throw new Error('fixture_update_failed')
    expect(
      await requestCompanyTestMail(db, mailer, {
        ...request,
        revision: changed.settings.revision!,
      }),
    ).toBe('rate_limited')
    expect(
      await requestCompanyTestMail(db, mailer, {
        ...request,
        revision: changed.settings.revision!,
        now: '2026-10-11T00:05:00.000Z',
      }),
    ).toBe('accepted')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it.each([
    'admin',
    'revoked',
    'wrong-family',
    'disabled-account',
    'required-mfa',
    'stale-revision',
  ])('does not send mail for %s authority', async (change) => {
    const { db, fetch, mailer, request } = await mailFixture()
    if (change === 'admin')
      await db.prepare('UPDATE organization_users SET type=1').run()
    if (change === 'revoked')
      await db.prepare('UPDATE devices SET revoked_at=?').bind(now).run()
    if (change === 'disabled-account')
      await db.prepare('UPDATE users SET disabled_at=?').bind(now).run()
    if (change === 'wrong-family')
      request.actor = { ...actor, sessionId: 'another-family' }
    if (change === 'required-mfa')
      await db
        .prepare(
          "INSERT INTO organization_policies (id,organization_id,type,enabled,revision_date,created_at,updated_at) VALUES ('policy','org',0,1,?,?,?)",
        )
        .bind(now, now, now)
        .run()
    if (change === 'stale-revision') request.revision = 'stale'
    expect(await requestCompanyTestMail(db, mailer, request)).toBe(
      change === 'stale-revision' ? 'conflict' : 'not_found',
    )
    expect(fetch).not.toHaveBeenCalled()
    expect(
      (
        await db
          .prepare(
            "SELECT count(*) AS count FROM audit_events WHERE name='organization.mail_test.request'",
          )
          .first()
      )?.count,
    ).toBe(0)
  })
  it('never contacts the mailer when the required audit write is ignored', async () => {
    const { db, fetch, mailer, request } = await mailFixture()
    await db
      .prepare(
        'CREATE TRIGGER ignore_test BEFORE INSERT ON audit_events BEGIN SELECT RAISE(IGNORE); END',
      )
      .run()
    expect(await requestCompanyTestMail(db, mailer, request)).toBe(
      'rate_limited',
    )
    expect(fetch).not.toHaveBeenCalled()
  })
  it('requires a saved recipient and shares the cooldown across organizations owned by the same account', async () => {
    const { db, fetch, mailer, request } = await mailFixture()
    await db
      .prepare(
        "UPDATE organization_company_settings SET mail_test_recipient=NULL WHERE organization_id='org'",
      )
      .run()
    expect(await requestCompanyTestMail(db, mailer, request)).toBe(
      'recipient_required',
    )
    expect(fetch).not.toHaveBeenCalled()
    await db
      .prepare(
        "UPDATE organization_company_settings SET mail_test_recipient=? WHERE organization_id='org'",
      )
      .bind(settings.mailTestRecipient)
      .run()
    expect(await requestCompanyTestMail(db, mailer, request)).toBe('accepted')
    await db
      .prepare(
        "INSERT INTO organizations (id,name,revision_date) VALUES ('org2','Second',?)",
      )
      .bind(now)
      .run()
    await db
      .prepare(
        "INSERT INTO organization_users (id,organization_id,user_id,email,status,type,org_key) VALUES ('membership2','org2','owner','owner@example.test',2,0,'public-wrapped-key')",
      )
      .run()
    const saved = await updateCompanySettings(db, {
      ...input,
      organizationId: 'org2',
    })
    if (saved.status !== 'success') throw new Error('fixture_settings_failed')
    expect(
      await requestCompanyTestMail(db, mailer, {
        ...request,
        organizationId: 'org2',
        revision: saved.settings.revision!,
      }),
    ).toBe('rate_limited')
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('bounds a stalled service binding without retrying or clearing its durable claim', async () => {
    const { db, fetch, mailer, request } = await mailFixture()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    fetch.mockImplementation(() => {
      started()
      return new Promise(() => {})
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = requestCompanyTestMail(db, mailer, request)
    await ready
    await vi.advanceTimersByTimeAsync(12_000)
    expect(await pending).toBe('delivery_unknown')
    const args = (fetch.mock.calls as unknown as [string, RequestInit][])[0]!
    expect(args[1].signal?.aborted).toBe(true)
    vi.useRealTimers()
    expect(await requestCompanyTestMail(db, mailer, request)).toBe(
      'rate_limited',
    )
    expect(fetch).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledOnce()
  })
  it('keeps the durable cooldown and sanitized event when provider acceptance is ambiguous', async () => {
    const { db, fetch, mailer, request } = await mailFixture()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetch.mockRejectedValue(new Error('private provider credential'))
    expect(await requestCompanyTestMail(db, mailer, request)).toBe(
      'delivery_unknown',
    )
    expect(await requestCompanyTestMail(db, mailer, request)).toBe(
      'rate_limited',
    )
    expect(fetch).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({
        event: 'company_test_mail_delivery_unknown',
        requestId: request.requestId,
      }),
    )
  })
  it('reads defaults without a write, then persists settings and audit together', async () => {
    const db = await fixture()
    expect(await readCompanySettings(db, scope)).toMatchObject({
      name: 'Original',
      revision: null,
      expectedMemberCount: null,
      canEdit: true,
    })
    expect(
      (
        await db
          .prepare(
            'SELECT count(*) AS count FROM organization_company_settings',
          )
          .first()
      )?.count,
    ).toBe(0)
    const result = await updateCompanySettings(db, input)
    expect(result.status).toBe('success')
    const saved = await readCompanySettings(db, scope)
    expect(saved).toMatchObject({
      ...settings,
      revision: expect.any(String),
      canEdit: true,
    })
    const audit = await db
      .prepare(
        "SELECT name,context_json FROM audit_events WHERE name='organization.settings.update'",
      )
      .first()
    expect(audit).toEqual({
      name: 'organization.settings.update',
      context_json: '{"organizationId":"org"}',
    })
  })
  it('serializes stale and concurrent updates without silently overwriting another administrator', async () => {
    const db = await fixture()
    const results = await Promise.all([
      updateCompanySettings(db, input),
      updateCompanySettings(db, {
        ...input,
        settings: { ...settings, name: 'Second' },
      }),
    ])
    expect(results.map((row) => row.status).sort()).toEqual([
      'conflict',
      'success',
    ])
    expect((await updateCompanySettings(db, input)).status).toBe('conflict')
    expect(
      (await db.prepare('SELECT count(*) AS count FROM audit_events').first())
        ?.count,
    ).toBe(1)
    const saved = await readCompanySettings(db, scope)
    expect(
      (
        await updateCompanySettings(db, {
          ...input,
          settings: { ...settings, revision: saved!.revision },
        })
      ).status,
    ).toBe('success')
  })
  it.each([
    'admin',
    'member',
    'unconfirmed',
    'disabled-account',
    'disabled-org',
    'revoked-session',
    'wrong-family',
    'required-mfa',
  ])('refuses unauthorized %s writes inside SQL', async (change) => {
    const db = await fixture()
    if (change === 'admin')
      await db.prepare('UPDATE organization_users SET type=1').run()
    if (change === 'member')
      await db.prepare('UPDATE organization_users SET type=2').run()
    if (change === 'unconfirmed')
      await db.prepare('UPDATE organization_users SET status=1').run()
    if (change === 'disabled-account')
      await db.prepare('UPDATE users SET disabled_at=?').bind(now).run()
    if (change === 'disabled-org')
      await db.prepare('UPDATE organizations SET enabled=0').run()
    if (change === 'revoked-session')
      await db.prepare('UPDATE devices SET revoked_at=?').bind(now).run()
    if (change === 'wrong-family')
      await db.prepare("UPDATE devices SET session_id='other-family'").run()
    if (change === 'required-mfa')
      await db
        .prepare(
          "INSERT INTO organization_policies (id,organization_id,type,enabled,revision_date,created_at,updated_at) VALUES ('policy','org',0,1,?,?,?)",
        )
        .bind(now, now, now)
        .run()
    expect(await updateCompanySettings(db, input)).toEqual({
      status: 'not_found',
    })
    expect(
      (
        await db
          .prepare(
            'SELECT count(*) AS count FROM organization_company_settings',
          )
          .first()
      )?.count,
    ).toBe(0)
    expect(
      (await db.prepare('SELECT name FROM organizations').first())?.name,
    ).toBe('Original')
    expect(
      (await db.prepare('SELECT count(*) AS count FROM audit_events').first())
        ?.count,
    ).toBe(0)
  })
  it.each(['audit', 'organization-name'])(
    'rolls back the settings if the required %s write is ignored',
    async (target) => {
      const db = await fixture()
      await db
        .prepare(
          target === 'audit'
            ? 'CREATE TRIGGER ignore_required BEFORE INSERT ON audit_events BEGIN SELECT RAISE(IGNORE); END'
            : 'CREATE TRIGGER ignore_required BEFORE UPDATE ON organizations BEGIN SELECT RAISE(IGNORE); END',
        )
        .run()
      await expect(updateCompanySettings(db, input)).rejects.toThrow()
      expect(
        (
          await db
            .prepare(
              'SELECT count(*) AS count FROM organization_company_settings',
            )
            .first()
        )?.count,
      ).toBe(0)
      expect(
        (await db.prepare('SELECT name FROM organizations').first())?.name,
      ).toBe('Original')
      expect(
        (await db.prepare('SELECT count(*) AS count FROM audit_events').first())
          ?.count,
      ).toBe(0)
    },
  )
})

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it, vi } from 'vitest'

import app from '../../src/app'
import { encryptTotpSecret } from '../../src/domain/totp-secret'
import { hotp } from '../../src/domain/totp'
import { signAccessToken, verifyAccessToken } from '../../src/domain/tokens'
import { createPasswordGrantSession } from '../../src/repositories/auth-repository'
import { consumeAuthRequestWithSession } from '../../src/repositories/auth-request-repository'
import { findSessionTotpAssurance } from '../../src/repositories/mfa-session-repository'

const instances: Miniflare[] = []
const now = '2026-10-04T00:00:00.000Z'
const tokenSecret = 'synthetic-http-d1-token-secret-long'
const wrappingSecret = 'synthetic-http-d1-wrapping-secret'
const factor = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
const actor = {
  userId: 'owner',
  deviceIdentifier: 'desktop',
  sessionId: 'family',
}
const step = Date.parse(now) / 30_000

afterEach(async () => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()))
})

describe('central HTTP MFA integration on real local D1', () => {
  it('counts repeated wrong step-up codes and revokes the exact family after three', async () => {
    const db = await database()
    await createPasswordGrantSession(db, {
      userId: actor.userId,
      expectedMasterPasswordHash: 'synthetic-hash',
      expectedSecurityStamp: 'stamp',
      deviceIdentifier: actor.deviceIdentifier,
      deviceName: null,
      deviceType: null,
      refreshTokenId: actor.sessionId,
      refreshTokenHash: 'synthetic-refresh-hash',
      refreshTokenExpiresAt: '2100-01-01T00:00:00.000Z',
      now,
    })
    const bearer = await signAccessToken(tokenSecret, {
      sub: actor.userId,
      email: 'owner@example.test',
      device: actor.deviceIdentifier,
      sessionId: actor.sessionId,
      securityStamp: 'stamp',
      iat: Date.parse(now) / 1000,
      exp: Date.parse(now) / 1000 + 3600,
      authMethod: 'password',
    })
    const correct = await hotp(factor, step)
    const wrong = correct === '000000' ? '111111' : '000000'
    for (let index = 0; index < 3; index++) {
      expect(
        (
          await authenticated(
            db,
            '/identity/accounts/totp/step-up',
            bearer,
            'POST',
            JSON.stringify({ code: wrong }),
          )
        ).status,
      ).toBe(400)
    }
    expect(
      await db
        .prepare('SELECT login_failed_count AS count FROM users WHERE id=?')
        .bind(actor.userId)
        .first(),
    ).toEqual({ count: 3 })
    const device = await db
      .prepare(
        'SELECT revoked_at AS revokedAt FROM devices WHERE user_id=? AND identifier=?',
      )
      .bind(actor.userId, actor.deviceIdentifier)
      .first<{ revokedAt: string | null }>()
    expect(typeof device?.revokedAt).toBe('string')
    expect(
      (
        await authenticated(
          db,
          '/identity/accounts/totp/step-up',
          bearer,
          'POST',
          JSON.stringify({ code: correct }),
        )
      ).status,
    ).toBe(401)
  })

  it('refuses a correct step-up code while the account login lock is active', async () => {
    const db = await database()
    await createPasswordGrantSession(db, {
      userId: actor.userId,
      expectedMasterPasswordHash: 'synthetic-hash',
      expectedSecurityStamp: 'stamp',
      deviceIdentifier: actor.deviceIdentifier,
      deviceName: null,
      deviceType: null,
      refreshTokenId: actor.sessionId,
      refreshTokenHash: 'synthetic-refresh-hash',
      refreshTokenExpiresAt: '2100-01-01T00:00:00.000Z',
      now,
    })
    await db
      .prepare(
        "UPDATE users SET login_locked_until='2026-10-04T00:15:00.000Z' WHERE id='owner'",
      )
      .run()
    const bearer = await signAccessToken(tokenSecret, {
      sub: actor.userId,
      email: 'owner@example.test',
      device: actor.deviceIdentifier,
      sessionId: actor.sessionId,
      securityStamp: 'stamp',
      iat: Date.parse(now) / 1000,
      exp: Date.parse(now) / 1000 + 3600,
      authMethod: 'password',
    })
    expect(
      (
        await authenticated(
          db,
          '/identity/accounts/totp/step-up',
          bearer,
          'POST',
          JSON.stringify({ code: await hotp(factor, step) }),
        )
      ).status,
    ).toBe(400)
    expect(await findSessionTotpAssurance(db, actor)).toBe(false)
  })
  it('clears a verified device proof when an approved auth request starts a fresh family', async () => {
    const db = await database()
    await createPasswordGrantSession(db, {
      userId: actor.userId,
      expectedMasterPasswordHash: 'synthetic-hash',
      expectedSecurityStamp: 'stamp',
      deviceIdentifier: actor.deviceIdentifier,
      deviceName: null,
      deviceType: null,
      refreshTokenId: actor.sessionId,
      refreshTokenHash: 'original-refresh-hash',
      refreshTokenExpiresAt: '2100-01-01T00:00:00.000Z',
      totpVerification: {
        credentialGeneration: 'generation',
        acceptedStep: step,
      },
      now,
    })
    expect(await findSessionTotpAssurance(db, actor)).toBe(true)
    await db
      .prepare(
        `
      INSERT INTO auth_requests (
        id, user_id, email_hash, request_type, request_device_identifier,
        request_device_type, request_public_key, access_code_hash, status,
        request_approved, approving_device_identifier, encrypted_response_key,
        created_at, response_at, expires_at, retention_delete_after, updated_at
      ) VALUES (
        'approved-request', 'owner', 'synthetic-email-hash', 0, 'desktop',
        8, 'synthetic-public-key', 'synthetic-access-hash', 'approved',
        1, 'other-device', '2.synthetic-response-key', ?, ?, ?, ?, ?
      )
    `,
      )
      .bind(
        now,
        now,
        '2100-01-01T00:00:00.000Z',
        '2100-02-01T00:00:00.000Z',
        now,
      )
      .run()
    const freshActor = { ...actor, sessionId: 'auth-request-family' }
    expect(
      await consumeAuthRequestWithSession(db, {
        authRequestId: 'approved-request',
        accessCodeHash: 'synthetic-access-hash',
        userId: actor.userId,
        requestDeviceIdentifier: actor.deviceIdentifier,
        deviceId: 'owner:desktop',
        deviceName: null,
        deviceType: 8,
        refreshTokenId: freshActor.sessionId,
        refreshTokenHash: 'auth-request-refresh-hash',
        refreshTokenExpiresAt: '2100-01-01T00:00:00.000Z',
        now,
      }),
    ).toEqual({ status: 'consumed' })
    expect(await findSessionTotpAssurance(db, freshActor)).toBe(false)
    expect(await findSessionTotpAssurance(db, actor)).toBe(false)
    expect(
      await db
        .prepare(
          `
      SELECT session_id, mfa_totp_credential_generation, mfa_verified_at
      FROM devices WHERE user_id = 'owner' AND identifier = 'desktop'
    `,
        )
        .first(),
    ).toEqual({
      session_id: freshActor.sessionId,
      mfa_totp_credential_generation: null,
      mfa_verified_at: null,
    })
  })

  it('binds password TOTP evidence to its actual family through refresh and immediate logout', async () => {
    const db = await database()
    const grant = await tokenRequest(db, {
      grant_type: 'password',
      username: 'owner@example.test',
      password: 'synthetic-hash',
      twoFactorProvider: '0',
      twoFactorToken: await hotp(factor, step),
    })
    expect(grant.status).toBe(200)
    const initial = (await grant.json()) as {
      access_token: string
      refresh_token: string
    }
    const claims = await verifyAccessToken(tokenSecret, initial.access_token)
    expect(claims.ok).toBe(true)
    if (!claims.ok || !claims.claims.sessionId)
      throw new Error('Missing actual token family')
    const family = { ...actor, sessionId: claims.claims.sessionId }
    expect(await findSessionTotpAssurance(db, family)).toBe(true)
    expect(
      await (
        await authenticated(
          db,
          '/identity/accounts/totp/assurance',
          initial.access_token,
        )
      ).json(),
    ).toEqual({ object: 'totpSession', verified: true })
    const refreshed = await tokenRequest(db, {
      grant_type: 'refresh_token',
      refresh_token: initial.refresh_token,
    })
    expect(refreshed.status).toBe(200)
    const next = (await refreshed.json()) as { access_token: string }
    expect(await findSessionTotpAssurance(db, family)).toBe(true)
    expect(
      (
        await authenticated(
          db,
          '/identity/accounts/logout',
          next.access_token,
          'POST',
        )
      ).status,
    ).toBe(200)
    expect(await findSessionTotpAssurance(db, family)).toBe(false)
    expect(
      (
        await authenticated(
          db,
          '/identity/accounts/totp/assurance',
          next.access_token,
        )
      ).status,
    ).toBe(401)
  })

  it('steps up an unassured family using one code and atomically disables it with exactly one required audit', async () => {
    const db = await database()
    await createPasswordGrantSession(db, {
      userId: actor.userId,
      expectedMasterPasswordHash: 'synthetic-hash',
      expectedSecurityStamp: 'stamp',
      deviceIdentifier: actor.deviceIdentifier,
      deviceName: null,
      deviceType: null,
      refreshTokenId: actor.sessionId,
      refreshTokenHash: 'synthetic-refresh-hash',
      refreshTokenExpiresAt: '2100-01-01T00:00:00.000Z',
      now,
    })
    const bearer = await signAccessToken(tokenSecret, {
      sub: actor.userId,
      email: 'owner@example.test',
      device: actor.deviceIdentifier,
      sessionId: actor.sessionId,
      securityStamp: 'stamp',
      iat: Date.parse(now) / 1000,
      exp: Date.parse(now) / 1000 + 3600,
      authMethod: 'password',
    })
    expect(
      await (
        await authenticated(db, '/identity/accounts/totp/assurance', bearer)
      ).json(),
    ).toEqual({ object: 'totpSession', verified: false })
    const body = JSON.stringify({ code: await hotp(factor, step) })
    expect(
      (
        await authenticated(
          db,
          '/identity/accounts/totp/step-up',
          bearer,
          'POST',
          body,
        )
      ).status,
    ).toBe(200)
    expect(
      (
        await authenticated(
          db,
          '/identity/accounts/totp/step-up',
          bearer,
          'POST',
          body,
        )
      ).status,
    ).toBe(400)
    expect(await findSessionTotpAssurance(db, actor)).toBe(true)
    expect(
      (
        await authenticated(
          db,
          '/identity/accounts/totp/disable',
          bearer,
          'POST',
        )
      ).status,
    ).toBe(200)
    expect(await findSessionTotpAssurance(db, actor)).toBe(false)
    expect(
      await db
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_events WHERE name = 'totp.disable' AND outcome = 'success'",
        )
        .first(),
    ).toEqual({ count: 1 })
  })
})

function environment(DB: D1Database) {
  return {
    DB,
    HONOWARDEN_TOKEN_SECRET: tokenSecret,
    HONOWARDEN_TOTP_SECRET: wrappingSecret,
  }
}
function tokenRequest(db: D1Database, values: Record<string, string>) {
  return app.request(
    '/identity/connect/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Device-Identifier': actor.deviceIdentifier,
      },
      body: new URLSearchParams(values),
    },
    environment(db),
  )
}
function authenticated(
  db: D1Database,
  path: string,
  bearer: string,
  method = 'GET',
  body?: string,
) {
  return app.request(
    path,
    {
      method,
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body }),
    },
    environment(db),
  )
}
async function database(): Promise<D1Database> {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  const instance = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
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
    let inTrigger = false
    for (const line of readFileSync(`${root}/${file}`, 'utf8').split('\n')) {
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
      throw new Error(`Incomplete migration: ${file}`)
  }
  await db
    .prepare(
      "INSERT INTO users(id,email,email_normalized,kdf_algorithm,kdf_iterations,master_password_hash,user_key,security_stamp,revision_date) VALUES ('owner','owner@example.test','owner@example.test','pbkdf2-sha256',600000,'synthetic-hash','2.synthetic-wrapper','stamp',?)",
    )
    .bind(now)
    .run()
  await db
    .prepare(
      "INSERT INTO user_totp(user_id,encrypted_secret,enabled,verified_at,last_accepted_step,credential_generation) VALUES ('owner',?,1,?,?,'generation')",
    )
    .bind(await encryptTotpSecret(wrappingSecret, factor), now, step - 1)
    .run()
  return db
}

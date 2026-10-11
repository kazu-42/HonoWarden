import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createPasswordGrantSession,
  revokeCurrentDeviceSession,
  rotateRefreshToken,
} from '../../src/repositories/auth-repository'
import {
  consumeTotpSessionStepUp,
  createPendingTotpSetupForSession,
  disableTotpSetupForSession,
  enableTotpSetupForSession,
  findSessionTotpAssurance,
  promotePendingTotpChangeForSession,
  startPendingTotpChangeForSession,
} from '../../src/repositories/mfa-session-repository'
import {
  disableTotpSetup,
  startPendingTotpChange,
  upsertPendingTotpSetup,
} from '../../src/repositories/totp-repository'

const instances: Miniflare[] = []
const now = '2026-10-04T00:00:00.000Z'
const actor = {
  userId: 'owner',
  deviceIdentifier: 'desktop',
  sessionId: 'family',
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()))
})

describe('family-bound TOTP assurance on real local D1', () => {
  it('records proof only when password login consumes the current generation and a newer step', async () => {
    const db = await database()
    await enrolled(db)
    expect(
      await login(db, actor.sessionId, {
        credentialGeneration: 'generation',
        acceptedStep: 11,
      }),
    ).toEqual({ status: 'created' })
    expect(await findSessionTotpAssurance(db, actor)).toBe(true)
    expect(
      await login(db, 'replay-family', {
        credentialGeneration: 'generation',
        acceptedStep: 11,
      }),
    ).toEqual({ status: 'stale_generation' })
    expect(await findSessionTotpAssurance(db, actor)).toBe(true)
    expect(
      await findSessionTotpAssurance(db, {
        ...actor,
        sessionId: 'replay-family',
      }),
    ).toBe(false)
    expect(
      await login(db, 'wrong-generation', {
        credentialGeneration: 'stale',
        acceptedStep: 12,
      }),
    ).toEqual({ status: 'stale_generation' })
    expect(
      await db.prepare('SELECT last_accepted_step FROM user_totp').first(),
    ).toEqual({ last_accepted_step: 11 })
  })

  it('allows exactly one concurrent password family for the same TOTP step', async () => {
    const db = await database()
    await enrolled(db)
    const results = await Promise.all(
      ['first', 'second'].map((family) =>
        login(db, family, {
          credentialGeneration: 'generation',
          acceptedStep: 11,
        }),
      ),
    )
    expect(
      results.filter((result) => result.status === 'created'),
    ).toHaveLength(1)
    expect(
      await db.prepare('SELECT COUNT(*) AS count FROM refresh_tokens').first(),
    ).toEqual({ count: 1 })
  })

  it('rolls login replay consumption and its new device back when refresh persistence fails', async () => {
    const db = await database()
    await enrolled(db)
    await db
      .prepare(
        "CREATE TRIGGER reject_refresh BEFORE INSERT ON refresh_tokens BEGIN SELECT RAISE(ABORT, 'synthetic refresh failure'); END",
      )
      .run()
    await expect(
      login(db, actor.sessionId, {
        credentialGeneration: 'generation',
        acceptedStep: 11,
      }),
    ).rejects.toThrow('synthetic refresh failure')
    expect(
      await db.prepare('SELECT last_accepted_step FROM user_totp').first(),
    ).toEqual({ last_accepted_step: 10 })
    expect(
      await db.prepare('SELECT COUNT(*) AS count FROM devices').first(),
    ).toEqual({ count: 0 })
  })

  it('clears a previous family proof on every fresh non-TOTP grant on the same device', async () => {
    const db = await database()
    await enrolled(db)
    await login(db, actor.sessionId, {
      credentialGeneration: 'generation',
      acceptedStep: 11,
    })
    await login(db, 'api-key-or-auth-request-family')
    expect(await findSessionTotpAssurance(db, actor)).toBe(false)
    expect(
      await findSessionTotpAssurance(db, {
        ...actor,
        sessionId: 'api-key-or-auth-request-family',
      }),
    ).toBe(false)
    expect(
      await db
        .prepare(
          'SELECT mfa_totp_credential_generation, mfa_verified_at FROM devices',
        )
        .first(),
    ).toEqual({ mfa_totp_credential_generation: null, mfa_verified_at: null })
  })

  it('preserves proof on refresh of exactly the same immutable family', async () => {
    const db = await database()
    await enrolled(db)
    await login(db, actor.sessionId, {
      credentialGeneration: 'generation',
      acceptedStep: 11,
    })
    expect(
      await rotateRefreshToken(db, {
        currentTokenId: actor.sessionId,
        expectedSessionId: actor.sessionId,
        userId: actor.userId,
        deviceId: 'owner:desktop',
        expectedSecurityStamp: 'stamp',
        deviceIdentifier: actor.deviceIdentifier,
        deviceName: null,
        deviceType: null,
        nextRefreshTokenId: 'child-token',
        nextRefreshTokenHash: 'child-hash',
        nextRefreshTokenExpiresAt: '2100-01-01T00:00:00.000Z',
        now,
      }),
    ).toEqual({ status: 'rotated' })
    expect(await findSessionTotpAssurance(db, actor)).toBe(true)
    expect(
      await findSessionTotpAssurance(db, {
        ...actor,
        sessionId: 'child-token',
      }),
    ).toBe(false)
  })

  it('step-up atomically consumes replay state only for the exact active family', async () => {
    const db = await database()
    await enrolled(db)
    await login(db, actor.sessionId)
    expect(
      await consumeTotpSessionStepUp(db, {
        ...actor,
        sessionId: 'stale-family',
        credentialGeneration: 'generation',
        acceptedStep: 11,
        now,
      }),
    ).toBe(false)
    expect(
      await db.prepare('SELECT last_accepted_step FROM user_totp').first(),
    ).toEqual({ last_accepted_step: 10 })
    const results = await Promise.all(
      [1, 2].map(() =>
        consumeTotpSessionStepUp(db, {
          ...actor,
          credentialGeneration: 'generation',
          acceptedStep: 11,
          now,
        }),
      ),
    )
    expect(results.sort()).toEqual([false, true])
    expect(await findSessionTotpAssurance(db, actor)).toBe(true)
    expect(
      await consumeTotpSessionStepUp(db, {
        ...actor,
        credentialGeneration: 'stale',
        acceptedStep: 12,
        now,
      }),
    ).toBe(false)
  })

  it.each(['revoked-device', 'disabled-user'])(
    'rejects step-up after %s without consuming the code',
    async (condition) => {
      const db = await database()
      await enrolled(db)
      await login(db, actor.sessionId)
      await db
        .prepare(
          condition === 'revoked-device'
            ? 'UPDATE devices SET revoked_at = ?'
            : 'UPDATE users SET disabled_at = ?',
        )
        .bind(now)
        .run()
      expect(
        await consumeTotpSessionStepUp(db, {
          ...actor,
          credentialGeneration: 'generation',
          acceptedStep: 11,
          now,
        }),
      ).toBe(false)
      expect(
        await db.prepare('SELECT last_accepted_step FROM user_totp').first(),
      ).toEqual({ last_accepted_step: 10 })
      expect(await findSessionTotpAssurance(db, actor)).toBe(false)
    },
  )

  it('rolls the consumed replay step back when storing family proof fails', async () => {
    const db = await database()
    await enrolled(db)
    await login(db, actor.sessionId)
    await db
      .prepare(
        "CREATE TRIGGER reject_mfa BEFORE UPDATE OF mfa_verified_at ON devices BEGIN SELECT RAISE(ABORT, 'synthetic proof failure'); END",
      )
      .run()
    await expect(
      consumeTotpSessionStepUp(db, {
        ...actor,
        credentialGeneration: 'generation',
        acceptedStep: 11,
        now,
      }),
    ).rejects.toThrow('synthetic proof failure')
    expect(
      await db.prepare('SELECT last_accepted_step FROM user_totp').first(),
    ).toEqual({ last_accepted_step: 10 })
    expect(await findSessionTotpAssurance(db, actor)).toBe(false)
  })

  it('binds verified enrollment and promotion to the exact secret and current family', async () => {
    const db = await database()
    await login(db, actor.sessionId)
    await upsertPendingTotpSetup(db, {
      userId: 'owner',
      encryptedSecret: 'pending-secret',
      now,
    })
    expect(
      await enableTotpSetupForSession(db, {
        ...actor,
        expectedEncryptedSecret: 'old-secret',
        acceptedStep: 10,
        verifiedAt: now,
      }),
    ).toBe(false)
    expect(
      await enableTotpSetupForSession(db, {
        ...actor,
        expectedEncryptedSecret: 'pending-secret',
        acceptedStep: 10,
        verifiedAt: now,
      }),
    ).toBe(true)
    expect(await findSessionTotpAssurance(db, actor)).toBe(true)
    const setup = await db
      .prepare('SELECT credential_generation FROM user_totp')
      .first<{ credential_generation: string }>()
    expect(setup?.credential_generation).toBeTruthy()
    await upsertPendingTotpSetup(db, {
      userId: 'owner',
      encryptedSecret: 'must-not-overwrite-enabled',
      now,
    })
    expect(
      await db
        .prepare('SELECT encrypted_secret, enabled FROM user_totp')
        .first(),
    ).toEqual({ encrypted_secret: 'pending-secret', enabled: 1 })
    await login(
      db,
      'other-family',
      { credentialGeneration: setup!.credential_generation, acceptedStep: 11 },
      'other-device',
    )
    await startPendingTotpChange(db, {
      userId: 'owner',
      encryptedSecret: 'replacement-secret',
      now,
    })
    expect(
      await promotePendingTotpChangeForSession(db, {
        ...actor,
        expectedCredentialGeneration: setup!.credential_generation,
        expectedPendingEncryptedSecret: 'stale-secret',
        acceptedStep: 10,
        verifiedAt: now,
      }),
    ).toBe(false)
    expect(
      await promotePendingTotpChangeForSession(db, {
        ...actor,
        expectedCredentialGeneration: setup!.credential_generation,
        expectedPendingEncryptedSecret: 'replacement-secret',
        acceptedStep: 10,
        verifiedAt: now,
      }),
    ).toBe(true)
    expect(await findSessionTotpAssurance(db, actor)).toBe(true)
    expect(
      await findSessionTotpAssurance(db, {
        ...actor,
        deviceIdentifier: 'other-device',
        sessionId: 'other-family',
      }),
    ).toBe(false)
    expect(
      (
        await db
          .prepare('SELECT credential_generation FROM user_totp')
          .first<{ credential_generation: string }>()
      )?.credential_generation,
    ).not.toBe(setup!.credential_generation)
  })

  it('starts enrollment only in the active family without allowing a stale bearer to replace pending setup', async () => {
    const db = await database()
    await login(db, actor.sessionId)
    const input = { ...actor, encryptedSecret: 'pending-secret', now }
    expect(await createPendingTotpSetupForSession(db, input)).toBe(true)
    await login(db, 'replacement-family')
    expect(
      await createPendingTotpSetupForSession(db, {
        ...input,
        encryptedSecret: 'stale-bearer-secret',
      }),
    ).toBe(false)
    expect(
      await db
        .prepare('SELECT encrypted_secret, enabled FROM user_totp')
        .first(),
    ).toEqual({
      encrypted_secret: 'pending-secret',
      enabled: 0,
    })
    expect(
      await createPendingTotpSetupForSession(db, {
        ...input,
        sessionId: 'replacement-family',
        encryptedSecret: 'current-secret',
      }),
    ).toBe(true)
    expect(
      await enableTotpSetupForSession(db, {
        ...actor,
        sessionId: 'replacement-family',
        expectedEncryptedSecret: 'current-secret',
        acceptedStep: 10,
        verifiedAt: now,
      }),
    ).toBe(true)
    expect(
      await createPendingTotpSetupForSession(db, {
        ...input,
        sessionId: 'replacement-family',
        encryptedSecret: 'must-not-overwrite-enabled',
      }),
    ).toBe(false)
    expect(
      await findSessionTotpAssurance(db, {
        ...actor,
        sessionId: 'replacement-family',
      }),
    ).toBe(true)
  })

  it('starts a pending replacement only after consuming the current factor in the exact active family', async () => {
    const db = await database()
    await enrolled(db)
    await login(db, actor.sessionId)
    const input = {
      ...actor,
      credentialGeneration: 'generation',
      acceptedStep: 11,
      now,
      encryptedSecret: 'new-pending',
    }
    expect(
      await startPendingTotpChangeForSession(db, {
        ...input,
        sessionId: 'stale-family',
      }),
    ).toBe(false)
    expect(await startPendingTotpChangeForSession(db, input)).toBe(true)
    expect(
      await db
        .prepare(
          'SELECT encrypted_secret, pending_encrypted_secret, credential_generation FROM user_totp',
        )
        .first(),
    ).toEqual({
      encrypted_secret: 'opaque-secret',
      pending_encrypted_secret: 'new-pending',
      credential_generation: 'generation',
    })
    expect(await findSessionTotpAssurance(db, actor)).toBe(true)
    expect(
      await startPendingTotpChangeForSession(db, {
        ...input,
        encryptedSecret: 'replayed-pending',
      }),
    ).toBe(false)
    expect(
      await db
        .prepare('SELECT pending_encrypted_secret FROM user_totp')
        .first(),
    ).toEqual({ pending_encrypted_secret: 'new-pending' })
  })

  it('disabling TOTP invalidates all family proofs and prevents generation reuse', async () => {
    const db = await database()
    await enrolled(db)
    await login(db, actor.sessionId, {
      credentialGeneration: 'generation',
      acceptedStep: 11,
    })
    expect(await disableTotpSetup(db, { userId: 'owner' })).toBe(true)
    expect(await findSessionTotpAssurance(db, actor)).toBe(false)
    expect(
      await db
        .prepare(
          'SELECT mfa_totp_credential_generation, mfa_verified_at FROM devices',
        )
        .first(),
    ).toEqual({ mfa_totp_credential_generation: null, mfa_verified_at: null })
  })

  it('rejects disabling the last enrolled confirmed Owner under an enabled policy atomically', async () => {
    const db = await database()
    await enrolled(db)
    await db.batch([
      db
        .prepare(
          "INSERT INTO organizations(id,name,revision_date) VALUES ('org','Team',?)",
        )
        .bind(now),
      db.prepare(
        "INSERT INTO organization_users(id,organization_id,user_id,email,status,type) VALUES ('membership','org','owner','owner@example.test',2,0)",
      ),
      db
        .prepare(
          "INSERT INTO organization_policies(id,organization_id,type,enabled,revision_date,created_at,updated_at) VALUES ('policy','org',0,1,?,?,?)",
        )
        .bind(now, now, now),
    ])
    expect(await disableTotpSetup(db, { userId: 'owner' })).toBe(false)
    expect(
      await db
        .prepare('SELECT enabled, credential_generation FROM user_totp')
        .first(),
    ).toEqual({ enabled: 1, credential_generation: 'generation' })
  })

  it('keeps one enrolled Owner when both Owners concurrently try to disable TOTP', async () => {
    const db = await database()
    await enrolled(db)
    await policy(db)
    await db.batch([
      db
        .prepare(
          "INSERT INTO users(id,email,email_normalized,kdf_algorithm,kdf_iterations,master_password_hash,security_stamp,revision_date) VALUES ('second','second@example.test','second@example.test','pbkdf2-sha256',600000,'hash','stamp',?)",
        )
        .bind(now),
      db.prepare(
        "INSERT INTO organization_users(id,organization_id,user_id,email,status,type) VALUES ('second-membership','org','second','second@example.test',2,0)",
      ),
      db
        .prepare(
          "INSERT INTO user_totp(user_id,encrypted_secret,enabled,verified_at,credential_generation) VALUES ('second','opaque',1,?,'second-generation')",
        )
        .bind(now),
    ])
    const results = await Promise.all(
      ['owner', 'second'].map((userId) => disableTotpSetup(db, { userId })),
    )
    expect(results.sort()).toEqual([false, true])
    expect(
      await db
        .prepare('SELECT COUNT(*) AS count FROM user_totp WHERE enabled = 1')
        .first(),
    ).toEqual({ count: 1 })
  })

  it('requires the atomic disable audit and rolls factor, family evidence and revision back on audit failure', async () => {
    const db = await database()
    await enrolled(db)
    await login(db, actor.sessionId, {
      credentialGeneration: 'generation',
      acceptedStep: 11,
    })
    await db
      .prepare(
        "CREATE TRIGGER reject_totp_audit BEFORE INSERT ON audit_events WHEN NEW.name = 'totp.disable' BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END",
      )
      .run()
    const input = {
      ...actor,
      expectedCredentialGeneration: 'generation',
      now: '2026-10-04T00:00:01.000Z',
      auditId: 'audit',
      requestId: 'request',
    }
    await expect(disableTotpSetupForSession(db, input)).rejects.toThrow(
      'synthetic audit failure',
    )
    expect(await findSessionTotpAssurance(db, actor)).toBe(true)
    expect(await db.prepare('SELECT revision_date FROM users').first()).toEqual(
      { revision_date: now },
    )
    await db.prepare('DROP TRIGGER reject_totp_audit').run()
    expect(await disableTotpSetupForSession(db, input)).toBe(true)
    expect(await findSessionTotpAssurance(db, actor)).toBe(false)
    expect(await db.prepare('SELECT revision_date FROM users').first()).toEqual(
      { revision_date: input.now },
    )
    expect(
      await db
        .prepare(
          "SELECT name, outcome, actor_user_id FROM audit_events WHERE id = 'audit'",
        )
        .first(),
    ).toEqual({
      name: 'totp.disable',
      outcome: 'success',
      actor_user_id: 'owner',
    })
  })

  it('logs out only the requested current family and cannot revoke a replacement same-device login', async () => {
    const db = await database()
    await enrolled(db)
    await login(db, 'old-family', {
      credentialGeneration: 'generation',
      acceptedStep: 11,
    })
    await login(db, actor.sessionId, {
      credentialGeneration: 'generation',
      acceptedStep: 12,
    })
    expect(
      await revokeCurrentDeviceSession(db, {
        ...actor,
        sessionId: 'old-family',
        revokedAt: now,
      }),
    ).toEqual({ status: 'not_found' })
    expect(await findSessionTotpAssurance(db, actor)).toBe(true)
    expect(
      await revokeCurrentDeviceSession(db, { ...actor, revokedAt: now }),
    ).toEqual({ status: 'revoked', deviceId: 'owner:desktop', revokedAt: now })
    expect(await findSessionTotpAssurance(db, actor)).toBe(false)
    expect(
      await db
        .prepare('SELECT revoked_at FROM refresh_tokens WHERE id = ?')
        .bind(actor.sessionId)
        .first(),
    ).toEqual({ revoked_at: now })
  })

  it('backfills existing verified credentials with a random generation while leaving all legacy sessions unassured', async () => {
    const db = await database(true)
    await db
      .prepare(
        "INSERT INTO user_totp(user_id,encrypted_secret,enabled,verified_at) VALUES ('owner','opaque',1,?)",
      )
      .bind(now)
      .run()
    await db
      .prepare(
        "INSERT INTO devices(id,user_id,identifier,session_id) VALUES ('owner:desktop','owner','desktop','family')",
      )
      .run()
    await applyMigration(db, '0027_session_mfa_assurance.sql')
    expect(
      (
        await db
          .prepare('SELECT credential_generation FROM user_totp')
          .first<{ credential_generation: string }>()
      )?.credential_generation,
    ).toMatch(/^[a-f0-9]{32}$/)
    expect(await findSessionTotpAssurance(db, actor)).toBe(false)
  })
})

async function policy(db: D1Database) {
  await db.batch([
    db
      .prepare(
        "INSERT INTO organizations(id,name,revision_date) VALUES ('org','Team',?)",
      )
      .bind(now),
    db.prepare(
      "INSERT INTO organization_users(id,organization_id,user_id,email,status,type) VALUES ('membership','org','owner','owner@example.test',2,0)",
    ),
    db
      .prepare(
        "INSERT INTO organization_policies(id,organization_id,type,enabled,revision_date,created_at,updated_at) VALUES ('policy','org',0,1,?,?,?)",
      )
      .bind(now, now, now),
  ])
}

async function enrolled(db: D1Database) {
  await db
    .prepare(
      "INSERT INTO user_totp(user_id,encrypted_secret,enabled,verified_at,last_accepted_step,credential_generation) VALUES ('owner','opaque-secret',1,?,10,'generation')",
    )
    .bind(now)
    .run()
}

function login(
  db: D1Database,
  family: string,
  totpVerification?: { credentialGeneration: string; acceptedStep: number },
  deviceIdentifier = actor.deviceIdentifier,
) {
  return createPasswordGrantSession(db, {
    userId: actor.userId,
    expectedMasterPasswordHash: 'hash',
    expectedSecurityStamp: 'stamp',
    deviceIdentifier,
    deviceName: null,
    deviceType: null,
    refreshTokenId: family,
    refreshTokenHash: `hash-${family}`,
    refreshTokenExpiresAt: '2100-01-01T00:00:00.000Z',
    now,
    ...(totpVerification ? { totpVerification } : {}),
  })
}

async function database(beforeMfaMigration = false): Promise<D1Database> {
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
    if (beforeMfaMigration && file >= '0027') continue
    await applyMigration(db, file)
  }
  await db
    .prepare(
      "INSERT INTO users(id,email,email_normalized,kdf_algorithm,kdf_iterations,master_password_hash,security_stamp,revision_date) VALUES ('owner','owner@example.test','owner@example.test','pbkdf2-sha256',600000,'hash','stamp',?)",
    )
    .bind(now)
    .run()
  return db
}

async function applyMigration(db: D1Database, file: string) {
  const root = fileURLToPath(
    new URL('../../migrations', import.meta.url).toString(),
  )
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

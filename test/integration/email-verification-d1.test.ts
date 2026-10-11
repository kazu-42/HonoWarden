import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createPasswordGrantSession,
  revokeCurrentDeviceSession,
} from '../../src/repositories/auth-repository'
import { hashEmailVerificationNonce } from '../../src/domain/email-verification'
import {
  createEmailVerificationChallengeRecord,
  findEmailVerificationChallenge,
  consumeEmailVerificationChallenge,
} from '../../src/repositories/email-verification-repository'

const instances: Miniflare[] = []
const now = '2026-10-04T00:00:00.000Z'
const audience = 'https://vault.example.test'
const actor = {
  userId: 'owner',
  sessionId: 'family',
  deviceIdentifier: 'desktop',
  emailNormalized: 'owner@example.test',
  securityStamp: 'stamp',
}
const nonce = 'AQEB'.repeat(10) + 'AQE'
afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()))
})

describe('one-time account-family EVP persistence on real local D1', () => {
  it('marks only the current email verified, advances revision, consumes once, and records exactly one required audit', async () => {
    const db = await database()
    const input = await challenge(db)
    expect(await consume(db, input.id)).toBe(true)
    expect(await consume(db, input.id)).toBe(false)
    expect(
      await db
        .prepare(
          'SELECT email_verified_at AS verifiedAt,revision_date AS revision,security_stamp AS stamp,email_normalized AS email FROM users',
        )
        .first(),
    ).toEqual({
      verifiedAt: now,
      revision: '2026-10-04T00:00:00.001Z',
      stamp: actor.securityStamp,
      email: actor.emailNormalized,
    })
    expect(
      await db
        .prepare('SELECT COUNT(*) AS count FROM audit_events WHERE name = ?')
        .bind('account.email.verify')
        .first(),
    ).toEqual({ count: 1 })
    expect(
      await findEmailVerificationChallenge(db, {
        actor,
        id: input.id,
        audience,
        now,
      }),
    ).toBeNull()
    expect(
      await db
        .prepare(
          'SELECT mfa_totp_credential_generation AS generation,mfa_verified_at AS verifiedAt FROM devices',
        )
        .first(),
    ).toEqual({ generation: null, verifiedAt: null })
  })

  it('allows exactly one concurrent verified commit for one challenge', async () => {
    const db = await database()
    const input = await challenge(db)
    expect(
      (
        await Promise.all([consume(db, input.id), consume(db, input.id)])
      ).sort(),
    ).toEqual([false, true])
    expect(
      await db.prepare('SELECT COUNT(*) AS count FROM audit_events').first(),
    ).toEqual({ count: 1 })
  })

  it('replacing a challenge invalidates the old nonce and old challenge ID', async () => {
    const db = await database()
    const first = await challenge(db)
    const replacementNonce = 'AgIC'.repeat(10) + 'AgI'
    const second = await challenge(db, replacementNonce)
    expect(await consume(db, first.id)).toBe(false)
    expect(await consume(db, second.id)).toBe(false)
    expect(await consume(db, second.id, replacementNonce)).toBe(true)
  })

  it('serializes challenge replacement against old proof consumption with coherent account and audit state', async () => {
    const db = await database()
    const first = await challenge(db)
    const replacementNonce = 'AgIC'.repeat(10) + 'AgI'
    const replacement = {
      actor,
      id: crypto.randomUUID(),
      nonceDigest: await hashEmailVerificationNonce(replacementNonce),
      audience,
      now,
      expiresAt: '2026-10-04T00:05:00.000Z',
    }
    const [consumed, replaced] = await Promise.all([
      consume(db, first.id),
      createEmailVerificationChallengeRecord(db, replacement),
    ])
    expect(replaced).toBe(true)
    expect(
      await db
        .prepare(
          'SELECT id,nonce_digest AS nonceDigest,consumed_at AS consumedAt FROM email_verification_challenges',
        )
        .first(),
    ).toEqual({
      id: replacement.id,
      nonceDigest: replacement.nonceDigest,
      consumedAt: null,
    })
    expect(
      await db
        .prepare('SELECT email_verified_at AS verifiedAt FROM users')
        .first(),
    ).toEqual({ verifiedAt: consumed ? now : null })
    expect(
      await db.prepare('SELECT COUNT(*) AS count FROM audit_events').first(),
    ).toEqual({ count: consumed ? 1 : 0 })
    expect(await consume(db, replacement.id)).toBe(false)
    expect(await consume(db, replacement.id, replacementNonce)).toBe(true)
    expect(
      await db.prepare('SELECT COUNT(*) AS count FROM audit_events').first(),
    ).toEqual({ count: consumed ? 2 : 1 })
  })

  it.each([
    'logout',
    'replacement-family',
    'disabled-user',
    'email-change',
    'stamp-change',
  ] as const)(
    'refuses %s between preflight and commit without consuming proof',
    async (condition) => {
      const db = await database()
      const input = await challenge(db)
      expect(
        await findEmailVerificationChallenge(db, {
          actor,
          id: input.id,
          audience,
          now,
        }),
      ).not.toBeNull()
      switch (condition) {
        case 'logout':
          await revokeCurrentDeviceSession(db, {
            userId: actor.userId,
            deviceIdentifier: actor.deviceIdentifier,
            sessionId: actor.sessionId,
            revokedAt: now,
          })
          break
        case 'replacement-family':
          await login(db, 'replacement-family')
          break
        case 'disabled-user':
          await db.prepare('UPDATE users SET disabled_at = ?').bind(now).run()
          break
        case 'email-change':
          await db
            .prepare(
              "UPDATE users SET email_normalized = 'changed@example.test',email = 'changed@example.test'",
            )
            .run()
          break
        case 'stamp-change':
          await db
            .prepare("UPDATE users SET security_stamp = 'new-stamp'")
            .run()
          break
      }
      expect(await consume(db, input.id)).toBe(false)
      expect(
        await db
          .prepare(
            'SELECT consumed_at AS consumedAt FROM email_verification_challenges',
          )
          .first(),
      ).toEqual({ consumedAt: null })
      expect(
        await db
          .prepare('SELECT email_verified_at AS verifiedAt FROM users')
          .first(),
      ).toEqual({ verifiedAt: null })
      expect(
        await db.prepare('SELECT COUNT(*) AS count FROM audit_events').first(),
      ).toEqual({ count: 0 })
    },
  )

  it.each(['nonce', 'audience', 'family', 'expired'] as const)(
    'refuses a mismatched %s without consuming the challenge',
    async (condition) => {
      const db = await database()
      const input = await challenge(db)
      const value = {
        actor,
        id: input.id,
        nonceDigest: await hashEmailVerificationNonce(nonce),
        audience,
        now,
        mutationId: crypto.randomUUID(),
        requestId: 'request-id',
      }
      if (condition === 'nonce') value.nonceDigest = 'B'.repeat(43)
      if (condition === 'audience')
        value.audience = 'https://other.example.test'
      if (condition === 'family')
        value.actor = { ...actor, sessionId: 'other-family' }
      if (condition === 'expired') value.now = '2026-10-04T00:05:00.000Z'
      expect(await consumeEmailVerificationChallenge(db, value)).toBe(false)
      expect(
        await db
          .prepare(
            'SELECT consumed_at AS consumedAt FROM email_verification_challenges',
          )
          .first(),
      ).toEqual({ consumedAt: null })
    },
  )

  it('does not let a stale account family create or replace a pending challenge', async () => {
    const db = await database()
    const first = await challenge(db)
    await login(db, 'replacement-family')
    expect(
      await createEmailVerificationChallengeRecord(db, {
        actor,
        id: crypto.randomUUID(),
        nonceDigest: await hashEmailVerificationNonce(nonce),
        audience,
        now,
        expiresAt: '2026-10-04T00:05:00.000Z',
      }),
    ).toBe(false)
    expect(
      await db.prepare('SELECT id FROM email_verification_challenges').first(),
    ).toEqual({ id: first.id })
  })

  it.each(['ignored-user-write', 'ignored-audit', 'aborted-audit'] as const)(
    'rolls back consumption and verified state when the required commit has %s',
    async (condition) => {
      const db = await database()
      const input = await challenge(db)
      const trigger =
        condition === 'ignored-user-write'
          ? 'CREATE TRIGGER reject_verification BEFORE UPDATE OF email_verified_at ON users BEGIN SELECT RAISE(IGNORE); END'
          : `CREATE TRIGGER reject_verification BEFORE INSERT ON audit_events WHEN NEW.name = 'account.email.verify' BEGIN SELECT RAISE(${condition === 'ignored-audit' ? 'IGNORE' : "ABORT, 'synthetic audit failure'"}); END`
      await db.prepare(trigger).run()
      await expect(consume(db, input.id)).rejects.toThrow()
      expect(
        await db
          .prepare(
            'SELECT consumed_at AS consumedAt,verification_mutation_id AS mutationId FROM email_verification_challenges',
          )
          .first(),
      ).toEqual({ consumedAt: null, mutationId: null })
      expect(
        await db
          .prepare(
            'SELECT email_verified_at AS verifiedAt,revision_date AS revision FROM users',
          )
          .first(),
      ).toEqual({ verifiedAt: null, revision: now })
      expect(
        await db.prepare('SELECT COUNT(*) AS count FROM audit_events').first(),
      ).toEqual({ count: 0 })
      await db.prepare('DROP TRIGGER reject_verification').run()
      expect(await consume(db, input.id)).toBe(true)
    },
  )

  it('returns a mutation-free conflict when the consume write itself is ignored', async () => {
    const db = await database()
    const input = await challenge(db)
    await db
      .prepare(
        'CREATE TRIGGER ignore_consume BEFORE UPDATE ON email_verification_challenges BEGIN SELECT RAISE(IGNORE); END',
      )
      .run()
    expect(await consume(db, input.id)).toBe(false)
    expect(
      await db
        .prepare('SELECT email_verified_at AS verifiedAt FROM users')
        .first(),
    ).toEqual({ verifiedAt: null })
    expect(
      await db.prepare('SELECT COUNT(*) AS count FROM audit_events').first(),
    ).toEqual({ count: 0 })
  })
})

async function challenge(db: D1Database, challengeNonce = nonce) {
  const input = {
    actor,
    id: crypto.randomUUID(),
    audience,
    nonceDigest: await hashEmailVerificationNonce(challengeNonce),
    now,
    expiresAt: '2026-10-04T00:05:00.000Z',
  }
  expect(await createEmailVerificationChallengeRecord(db, input)).toBe(true)
  return input
}
async function consume(db: D1Database, id: string, challengeNonce = nonce) {
  return consumeEmailVerificationChallenge(db, {
    actor,
    id,
    audience,
    nonceDigest: await hashEmailVerificationNonce(challengeNonce),
    now,
    mutationId: crypto.randomUUID(),
    requestId: 'request-id',
  })
}
async function login(db: D1Database, family = actor.sessionId) {
  return createPasswordGrantSession(db, {
    userId: actor.userId,
    expectedMasterPasswordHash: 'synthetic-hash',
    expectedSecurityStamp: actor.securityStamp,
    deviceIdentifier: actor.deviceIdentifier,
    deviceName: null,
    deviceType: null,
    refreshTokenId: family,
    refreshTokenHash: `synthetic-${family}`,
    refreshTokenExpiresAt: '2100-01-01T00:00:00.000Z',
    now,
    requireTotpDisabled: true,
  })
}
async function database(): Promise<D1Database> {
  const instance = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: '2026-07-21',
    d1Databases: { DB: crypto.randomUUID() },
  })
  instances.push(instance)
  const db = (await instance.getD1Database('DB')) as unknown as D1Database
  const directory = fileURLToPath(
    new URL('../../migrations', import.meta.url).toString(),
  )
  for (const file of readdirSync(directory)
    .filter((file) => file.endsWith('.sql'))
    .sort()) {
    const lines: string[] = []
    let inTrigger = false
    for (const line of readFileSync(`${directory}/${file}`, 'utf8').split(
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
      throw new Error(`Incomplete migration: ${file}`)
  }
  await db
    .prepare(
      "INSERT INTO users(id,email,email_normalized,kdf_algorithm,kdf_iterations,master_password_hash,user_key,security_stamp,revision_date,email_verified_at) VALUES ('owner','owner@example.test','owner@example.test','pbkdf2-sha256',600000,'synthetic-hash','2.synthetic-wrapper','stamp',?,NULL)",
    )
    .bind(now)
    .run()
  await login(db)
  return db
}

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it } from 'vitest'

import { cleanupTransientAuthData } from '../../src/maintenance/retention-cleanup'
import {
  cleanupExpiredWebAuthnChallenges,
  consumeWebAuthnChallenge,
  createWebAuthnCredential,
  deleteWebAuthnCredential,
  findWebAuthnCredentialForOwner,
  issueWebAuthnChallenge,
  listWebAuthnCredentialsByUser,
  recordSuccessfulWebAuthnAssertion,
  renameWebAuthnCredential,
} from '../../src/repositories/webauthn-repository'
import type { WebAuthnCredentialRecord } from '../../src/repositories/webauthn-repository'

const instances: Miniflare[] = []
const ownerUserId = '11111111-1111-4111-8111-111111111111'
const foreignUserId = '22222222-2222-4222-8222-222222222222'
const now = '2026-07-06T00:00:00.000Z'

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()))
})

describe('WebAuthn persistence on real local D1', () => {
  it('isolates owner credentials and rejects a sixth registration', async () => {
    const database = await createDatabase()
    for (let index = 0; index < 5; index += 1) {
      await expect(
        createWebAuthnCredential(
          database,
          credentialFixture({
            id: `row-${index}`,
            credentialId: `credential-${index}`,
            name: `Key ${index}`,
          }),
        ),
      ).resolves.toEqual({ status: 'created', credential: expect.any(Object) })
    }

    await expect(
      createWebAuthnCredential(
        database,
        credentialFixture({
          id: 'row-5',
          credentialId: 'credential-5',
          name: 'Key 5',
        }),
      ),
    ).resolves.toEqual({ status: 'limit_reached' })

    const listed = await listWebAuthnCredentialsByUser(database, {
      userId: ownerUserId,
      limit: 5,
      cursor: null,
    })
    expect(listed.items).toHaveLength(5)
    expect(listed.hasMore).toBe(false)

    const foreign = await listWebAuthnCredentialsByUser(database, {
      userId: foreignUserId,
      limit: 5,
      cursor: null,
    })
    expect(foreign.items).toHaveLength(0)

    await expect(
      findWebAuthnCredentialForOwner(database, {
        id: 'row-0',
        userId: foreignUserId,
      }),
    ).resolves.toBeNull()
  })

  it('consumes a challenge with a single winner and leaves losers unchanged', async () => {
    const database = await createDatabase()
    await issueWebAuthnChallenge(database, {
      id: 'challenge-1',
      tokenHash: 'token-hash',
      challengeHash: 'challenge-hash',
      purpose: 'authentication',
      userId: null,
      credentialId: null,
      rpId: 'example.com',
      originPolicyVersion: 'origin-policy',
      expiresAt: '2026-07-06T00:07:00.000Z',
      consumedAt: null,
      createdAt: now,
      retentionDeleteAfter: '2026-07-07T00:07:00.000Z',
    })

    const attempts = await Promise.all(
      [ownerUserId, foreignUserId].map((userId, index) =>
        consumeWebAuthnChallenge(database, {
          tokenHash: 'token-hash',
          purpose: 'authentication',
          rpId: 'example.com',
          originPolicyVersion: 'origin-policy',
          userId,
          credentialId: null,
          consumedAt: `2026-07-06T00:01:0${index}.000Z`,
          now: '2026-07-06T00:01:00.000Z',
        }),
      ),
    )

    expect(
      attempts.filter((result) => result.status === 'consumed'),
    ).toHaveLength(1)
    expect(
      attempts.filter((result) => result.status === 'not_consumed'),
    ).toHaveLength(1)

    const row = await database
      .prepare(
        `SELECT user_id as userId, consumed_at as consumedAt
         FROM webauthn_challenges WHERE id = 'challenge-1'`,
      )
      .first<{ userId: string; consumedAt: string }>()
    expect(row?.consumedAt).toMatch(/^2026-07-06T00:01:0[01]\.000Z$/)
    expect([ownerUserId, foreignUserId]).toContain(row?.userId)
  })

  it('preserves a valid zero counter and writes nothing on regression', async () => {
    const database = await createDatabase()
    const credential = credentialFixture({ signCount: 0, backupState: false })
    await createWebAuthnCredential(database, credential)

    await expect(
      recordSuccessfulWebAuthnAssertion(database, {
        id: credential.id,
        userId: ownerUserId,
        nextSignCount: 0,
        backupEligible: true,
        backupState: true,
        now: '2026-07-06T00:01:00.000Z',
      }),
    ).resolves.toEqual({ status: 'updated' })

    const keptZero = await findWebAuthnCredentialForOwner(database, {
      id: credential.id,
      userId: ownerUserId,
    })
    expect(keptZero).toMatchObject({
      signCount: 0,
      backupState: true,
      lastUsedAt: '2026-07-06T00:01:00.000Z',
    })

    await expect(
      recordSuccessfulWebAuthnAssertion(database, {
        id: credential.id,
        userId: ownerUserId,
        nextSignCount: 4,
        backupEligible: true,
        backupState: true,
        now: '2026-07-06T00:02:00.000Z',
      }),
    ).resolves.toEqual({ status: 'updated' })

    const beforeRegression = await findWebAuthnCredentialForOwner(database, {
      id: credential.id,
      userId: ownerUserId,
    })
    await expect(
      recordSuccessfulWebAuthnAssertion(database, {
        id: credential.id,
        userId: ownerUserId,
        nextSignCount: 3,
        backupEligible: true,
        backupState: false,
        now: '2026-07-06T00:03:00.000Z',
      }),
    ).resolves.toEqual({ status: 'not_updated' })
    await expect(
      findWebAuthnCredentialForOwner(database, {
        id: credential.id,
        userId: ownerUserId,
      }),
    ).resolves.toEqual(beforeRegression)
  })

  it('renames, deletes, and cleans expired challenges without deleting credentials', async () => {
    const database = await createDatabase()
    const credential = credentialFixture()
    await createWebAuthnCredential(database, credential)
    await issueWebAuthnChallenge(database, {
      id: 'expired-challenge',
      tokenHash: 'expired-token',
      challengeHash: 'expired-challenge-hash',
      purpose: 'registration',
      userId: ownerUserId,
      credentialId: null,
      rpId: 'example.com',
      originPolicyVersion: 'origin-policy',
      expiresAt: '2026-07-06T00:07:00.000Z',
      consumedAt: null,
      createdAt: now,
      retentionDeleteAfter: '2026-07-06T00:30:00.000Z',
    })
    await issueWebAuthnChallenge(database, {
      id: 'live-challenge',
      tokenHash: 'live-token',
      challengeHash: 'live-challenge-hash',
      purpose: 'registration',
      userId: ownerUserId,
      credentialId: null,
      rpId: 'example.com',
      originPolicyVersion: 'origin-policy',
      expiresAt: '2026-07-06T00:17:00.000Z',
      consumedAt: null,
      createdAt: now,
      retentionDeleteAfter: '2026-07-07T00:17:00.000Z',
    })

    await expect(
      renameWebAuthnCredential(database, {
        id: credential.id,
        userId: ownerUserId,
        name: 'Laptop',
        revisionDate: '2026-07-06T00:02:00.000Z',
      }),
    ).resolves.toEqual({ status: 'updated' })
    await expect(
      renameWebAuthnCredential(database, {
        id: credential.id,
        userId: foreignUserId,
        name: 'Stolen',
        revisionDate: '2026-07-06T00:03:00.000Z',
      }),
    ).resolves.toEqual({ status: 'not_found' })

    await cleanupTransientAuthData(database, '2026-07-06T00:31:00.000Z')
    const remaining = await database
      .prepare('SELECT id FROM webauthn_challenges ORDER BY id')
      .all<{ id: string }>()
    expect(remaining.results.map((row) => row.id)).toEqual(['live-challenge'])
    await expect(
      findWebAuthnCredentialForOwner(database, {
        id: credential.id,
        userId: ownerUserId,
      }),
    ).resolves.toMatchObject({ name: 'Laptop' })

    await expect(
      cleanupExpiredWebAuthnChallenges(database, {
        expiredBefore: '2026-07-06T00:31:00.000Z',
        limit: 5,
      }),
    ).resolves.toEqual({ deletedExpiredChallenges: 0 })

    await expect(
      deleteWebAuthnCredential(database, {
        id: credential.id,
        userId: ownerUserId,
      }),
    ).resolves.toEqual({ status: 'deleted' })
    await expect(
      findWebAuthnCredentialForOwner(database, {
        id: credential.id,
        userId: ownerUserId,
      }),
    ).resolves.toBeNull()
  })
})

function credentialFixture(
  overrides: Partial<WebAuthnCredentialRecord> = {},
): WebAuthnCredentialRecord {
  return {
    id: 'row-1',
    userId: ownerUserId,
    credentialId: 'credential-1',
    publicKey: 'cHVibGljLWtleQ',
    userHandle: 'dXNlci1oYW5kbGU',
    signCount: 0,
    credentialType: 'public-key',
    transports: ['internal'],
    aaguid: '00000000-0000-0000-0000-000000000000',
    discoverable: true,
    backupEligible: true,
    backupState: false,
    prfSupported: false,
    encryptedUserKey: null,
    encryptedPublicKey: null,
    encryptedPrivateKey: null,
    name: 'Passkey',
    createdAt: now,
    revisionDate: now,
    lastUsedAt: null,
    ...overrides,
  }
}

async function createDatabase(): Promise<D1Database> {
  const instance = new Miniflare({
    compatibilityDate: '2026-07-21',
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: { DB: crypto.randomUUID() },
  })
  instances.push(instance)
  const database = await instance.getD1Database('DB')
  for (const migration of migrationFiles) {
    for (const statement of splitMigrationStatements(
      readMigration(migration),
    )) {
      await database.prepare(statement).run()
    }
  }
  for (const user of [
    { id: ownerUserId, email: 'owner@example.test' },
    { id: foreignUserId, email: 'foreign@example.test' },
  ]) {
    await database
      .prepare(
        `INSERT INTO users (
          id, email, email_normalized, kdf_algorithm, kdf_iterations,
          master_password_hash, security_stamp, revision_date
        ) VALUES (?, ?, ?, 'pbkdf2-sha256', 600000, 'hash', 'stamp', ?)`,
      )
      .bind(user.id, user.email, user.email, now)
      .run()
  }
  return database
}

const migrationsRoot = fileURLToPath(
  new URL('../../migrations', import.meta.url).toString(),
)
const migrationFiles = readdirSync(migrationsRoot)
  .filter((entry) => entry.endsWith('.sql'))
  .sort()

function splitMigrationStatements(sql: string): string[] {
  const statements: string[] = []
  let lines: string[] = []
  let inTrigger = false

  for (const line of sql.split('\n')) {
    const trimmed = line.trim()
    if (lines.length === 0 && trimmed.length === 0) continue
    if (!inTrigger && /^CREATE\s+TRIGGER\b/iu.test(trimmed)) inTrigger = true
    lines.push(line)
    const completesStatement = inTrigger
      ? /^END;$/iu.test(trimmed)
      : trimmed.endsWith(';')
    if (!completesStatement) continue
    statements.push(lines.join('\n').trim())
    lines = []
    inTrigger = false
  }

  if (lines.some((line) => line.trim().length > 0)) {
    throw new Error('Migration contains an incomplete SQL statement.')
  }
  return statements
}

function readMigration(name: string): string {
  return readFileSync(`${migrationsRoot}/${name}`, 'utf8')
}

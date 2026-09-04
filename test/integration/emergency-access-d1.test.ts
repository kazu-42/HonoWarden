import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it } from 'vitest'

import { canStartRecovery } from '../../src/domain/emergency-access'
import {
  acceptEmergencyAccessTrust,
  cancelEmergencyAccessTrust,
  confirmEmergencyAccessTrust,
  inviteEmergencyAccessTrust,
  listGrantedEmergencyAccessContacts,
  listTrustedEmergencyAccessContacts,
  reinviteEmergencyAccessTrust,
} from '../../src/emergency-access-trust'

const instances: Miniflare[] = []
const now = '2026-09-04T12:00:00.000Z'
const later = '2026-09-04T13:00:00.000Z'
const expired = '2026-09-10T12:00:00.000Z'
const inviteSecret = 'emergency-access-invite-secret-32b'
const grantor = {
  userId: '11111111-1111-4111-8111-111111111111',
  emailNormalized: 'grantor@example.test',
}
const grantee = {
  userId: '22222222-2222-4222-8222-222222222222',
  emailNormalized: 'grantee@example.test',
}
const stranger = {
  userId: '33333333-3333-4333-8333-333333333333',
  emailNormalized: 'stranger@example.test',
}

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()))
})

describe('emergency access invitation trust on real local D1', () => {
  it('invites, accepts, confirms, and cancels without persisting raw tokens or wrapped keys in lists', async () => {
    const database = await createDatabase()
    const captured = createTokenCapture()
    const invited = await inviteEmergencyAccessTrust(database, {
      grantor,
      body: { email: grantee.emailNormalized, type: 0, waitTimeDays: 7 },
      now,
      requestId: 'invite-request',
      relationshipId: 'relationship-1',
      inviteSecret,
      delivery: captured,
    })

    expect(invited.status).toBe('invited')
    if (invited.status !== 'invited') throw new Error('expected invite')
    expect(invited.delivery).toBe('accepted')
    expect(canStartRecovery(invited.contact.Status)).toBe(false)
    expect(captured.token.length).toBeGreaterThan(0)
    await expect(
      storedSecrets(database, 'relationship-1'),
    ).resolves.toMatchObject({
      inviteTokenHash: expect.stringMatching(/^hmac-sha256:v1:/u),
      keyEncrypted: null,
    })
    expect(
      JSON.stringify(await storedSecrets(database, 'relationship-1')),
    ).not.toContain(captured.token)

    await expect(
      acceptEmergencyAccessTrust(database, {
        grantee: stranger,
        body: { token: captured.token },
        now: later,
        requestId: 'wrong-recipient',
        relationshipId: 'relationship-1',
        inviteSecret,
      }),
    ).resolves.toEqual({ status: 'not_found' })

    const accepted = await acceptEmergencyAccessTrust(database, {
      grantee,
      body: { token: captured.token },
      now: later,
      requestId: 'accept-request',
      relationshipId: 'relationship-1',
      inviteSecret,
    })
    expect(accepted.status).toBe('accepted')
    if (accepted.status !== 'accepted') throw new Error('expected accept')
    expect(canStartRecovery(accepted.contact.Status)).toBe(false)
    await expect(
      acceptEmergencyAccessTrust(database, {
        grantee,
        body: { token: captured.token },
        now: later,
        requestId: 'replay-request',
        relationshipId: 'relationship-1',
        inviteSecret,
      }),
    ).resolves.toEqual({ status: 'not_found' })

    const confirmed = await confirmEmergencyAccessTrust(database, {
      grantor,
      body: { key: 'opaque-wrap-ciphertext' },
      now: '2026-09-04T14:00:00.000Z',
      requestId: 'confirm-request',
      relationshipId: 'relationship-1',
      keyGeneration: 1,
    })
    expect(confirmed.status).toBe('confirmed')
    if (confirmed.status !== 'confirmed') throw new Error('expected confirm')
    expect(canStartRecovery(confirmed.contact.Status)).toBe(true)
    await expect(
      storedSecrets(database, 'relationship-1'),
    ).resolves.toMatchObject({
      inviteTokenHash: null,
      keyEncrypted: 'opaque-wrap-ciphertext',
    })

    const trusted = await listTrustedEmergencyAccessContacts(
      database,
      grantor.userId,
    )
    const granted = await listGrantedEmergencyAccessContacts(
      database,
      grantee.userId,
    )
    expect(trusted).toEqual([
      expect.objectContaining({
        Id: 'relationship-1',
        Email: grantee.emailNormalized,
        Status: 2,
        GranteeId: grantee.userId,
      }),
    ])
    expect(granted).toEqual([
      expect.objectContaining({
        Id: 'relationship-1',
        GrantorId: grantor.userId,
        Status: 2,
      }),
    ])
    expect(JSON.stringify({ trusted, granted })).not.toContain(
      'opaque-wrap-ciphertext',
    )
    expect(JSON.stringify({ trusted, granted })).not.toContain(captured.token)

    await expect(
      cancelEmergencyAccessTrust(database, {
        actor: stranger,
        role: 'grantor',
        now: '2026-09-04T15:00:00.000Z',
        requestId: 'cross-user-delete',
        relationshipId: 'relationship-1',
      }),
    ).resolves.toEqual({ status: 'not_found' })
    await expect(
      cancelEmergencyAccessTrust(database, {
        actor: grantor,
        role: 'grantor',
        now: '2026-09-04T15:00:00.000Z',
        requestId: 'cancel-request',
        relationshipId: 'relationship-1',
      }),
    ).resolves.toEqual({ status: 'deleted' })
    await expect(
      listTrustedEmergencyAccessContacts(database, grantor.userId),
    ).resolves.toEqual([])
  })

  it('fails closed on self-invite, duplicates, expiry, and concurrent confirm/remove', async () => {
    const database = await createDatabase()
    await expect(
      inviteEmergencyAccessTrust(database, {
        grantor,
        body: { email: grantor.emailNormalized, type: 0, waitTimeDays: 7 },
        now,
        requestId: 'self-invite',
        relationshipId: 'self-relationship',
        inviteSecret,
      }),
    ).resolves.toEqual({ status: 'invalid_request' })

    const first = createTokenCapture()
    await expect(
      inviteEmergencyAccessTrust(database, {
        grantor,
        body: { email: grantee.emailNormalized, type: 1, waitTimeDays: 14 },
        now,
        requestId: 'first-invite',
        relationshipId: 'dup-relationship',
        inviteSecret,
        delivery: first,
      }),
    ).resolves.toMatchObject({ status: 'invited' })
    await expect(
      inviteEmergencyAccessTrust(database, {
        grantor,
        body: { email: grantee.emailNormalized, type: 0, waitTimeDays: 7 },
        now,
        requestId: 'duplicate-invite',
        relationshipId: 'dup-relationship-2',
        inviteSecret,
      }),
    ).resolves.toEqual({ status: 'conflict' })
    await expect(
      cancelEmergencyAccessTrust(database, {
        actor: grantor,
        role: 'grantor',
        now: later,
        requestId: 'clear-duplicate',
        relationshipId: 'dup-relationship',
      }),
    ).resolves.toEqual({ status: 'deleted' })

    const expiredCapture = createTokenCapture()
    await inviteEmergencyAccessTrust(database, {
      grantor,
      body: { email: stranger.emailNormalized, type: 0, waitTimeDays: 1 },
      now,
      requestId: 'expiring-invite',
      relationshipId: 'expired-relationship',
      inviteSecret,
      delivery: expiredCapture,
    })
    await expect(
      acceptEmergencyAccessTrust(database, {
        grantee: stranger,
        body: { token: expiredCapture.token },
        now: expired,
        requestId: 'expired-accept',
        relationshipId: 'expired-relationship',
        inviteSecret,
      }),
    ).resolves.toEqual({ status: 'not_found' })

    const acceptedCapture = createTokenCapture()
    await inviteEmergencyAccessTrust(database, {
      grantor,
      body: { email: grantee.emailNormalized, type: 0, waitTimeDays: 7 },
      now,
      requestId: 'race-invite',
      relationshipId: 'race-relationship',
      inviteSecret,
      delivery: acceptedCapture,
    })
    await acceptEmergencyAccessTrust(database, {
      grantee,
      body: { token: acceptedCapture.token },
      now: later,
      requestId: 'race-accept',
      relationshipId: 'race-relationship',
      inviteSecret,
    })
    const raced = await Promise.all([
      confirmEmergencyAccessTrust(database, {
        grantor,
        body: { key: 'opaque-wrap-ciphertext' },
        now: '2026-09-04T14:00:00.000Z',
        requestId: 'race-confirm',
        relationshipId: 'race-relationship',
        keyGeneration: 1,
      }),
      confirmEmergencyAccessTrust(database, {
        grantor,
        body: { key: 'second-opaque-wrap' },
        now: '2026-09-04T14:00:00.001Z',
        requestId: 'race-confirm-2',
        relationshipId: 'race-relationship',
        keyGeneration: 1,
      }),
      cancelEmergencyAccessTrust(database, {
        actor: grantor,
        role: 'grantor',
        now: '2026-09-04T14:00:00.000Z',
        requestId: 'race-delete',
        relationshipId: 'race-relationship',
      }),
    ])
    const confirmed = raced.filter((result) => result.status === 'confirmed')
    expect(confirmed.length).toBeLessThanOrEqual(1)
    const remaining = await storedSecrets(database, 'race-relationship')
    if (remaining) {
      expect(confirmed).toHaveLength(1)
      expect(remaining.inviteTokenHash).toBeNull()
      expect(['opaque-wrap-ciphertext', 'second-opaque-wrap']).toContain(
        remaining.keyEncrypted,
      )
    }
  })

  it('treats ambiguous invite delivery as failure without rolling back D1', async () => {
    const database = await createDatabase()
    const invited = await inviteEmergencyAccessTrust(database, {
      grantor,
      body: { email: grantee.emailNormalized, type: 0, waitTimeDays: 7 },
      now,
      requestId: 'ambiguous-invite',
      relationshipId: 'ambiguous-relationship',
      inviteSecret,
      delivery: {
        async deliverInvite() {
          return 'ambiguous'
        },
      },
    })

    expect(invited).toMatchObject({
      status: 'invited',
      delivery: 'failed',
    })
    await expect(
      listTrustedEmergencyAccessContacts(database, grantor.userId),
    ).resolves.toEqual([
      expect.objectContaining({
        Id: 'ambiguous-relationship',
        Status: 0,
      }),
    ])
    await expect(
      reinviteEmergencyAccessTrust(database, {
        grantor,
        now: later,
        requestId: 'reinvite-request',
        relationshipId: 'ambiguous-relationship',
        inviteSecret,
        delivery: {
          async deliverInvite() {
            return 'failed'
          },
        },
      }),
    ).resolves.toMatchObject({ status: 'reinvited', delivery: 'failed' })
  })
})

function createTokenCapture() {
  return {
    token: '',
    async deliverInvite(_notice: unknown, token: string) {
      this.token = token
      return 'delivered' as const
    },
  }
}

async function storedSecrets(database: D1Database, id: string) {
  return database
    .prepare(
      `SELECT invite_token_hash AS inviteTokenHash,
        key_encrypted AS keyEncrypted
      FROM emergency_access WHERE id = ?`,
    )
    .bind(id)
    .first<{ inviteTokenHash: string | null; keyEncrypted: string | null }>()
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
  for (const user of [grantor, grantee, stranger]) {
    await database
      .prepare(
        `INSERT INTO users (
          id, email, email_normalized, kdf_algorithm, kdf_iterations,
          master_password_hash, security_stamp, revision_date
        ) VALUES (?, ?, ?, 'pbkdf2-sha256', 600000, 'hash', 'stamp', ?)`,
      )
      .bind(user.userId, user.emailNormalized, user.emailNormalized, now)
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

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it } from 'vitest'
import { purgeRecoverableAccount } from '../../src/account-lifecycle-purge'
import { buildAuditEvent, type AuditEventName } from '../../src/domain/audit'
import {
  beginRecoverableAccountDeletion,
  finalizeAccountPurge,
  markAccountPurgeReady,
  planAccountDeletion,
  recoverAccountDeletion,
  startAccountPurge,
} from '../../src/repositories/account-lifecycle-repository'
import { removeOrganizationGroupMember } from '../../src/repositories/organization-groups-repository'

const instances: Miniflare[] = []
const now = '2026-10-04T00:00:00.000Z'
const duringRecovery = '2026-10-04T01:00:00.000Z'
const cutoff = '2026-10-05T00:00:00.000Z'
const generation = 'synthetic-totp-generation'

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()))
})

describe('company account lifecycle with every migration on real D1', () => {
  it.each([
    'unenrolled',
    'disabled-factor',
    'unverified-factor',
    'legacy-factor',
    'disabled-account',
    'accepted-owner',
    'revoked-owner',
    'admin',
    'member',
  ])(
    'protects the only enrolled Owner from deletion with a %s survivor',
    async (condition) => {
      const db = await database()
      await invalidateSurvivor(db, condition)
      const before = await snapshot(db)
      expect(
        await beginRecoverableAccountDeletion(db, deletion('owner-a')),
      ).toEqual({
        status: 'last_owner',
      })
      expect(await snapshot(db)).toEqual(before)
    },
  )

  it.each(['missing', 'disabled'])(
    'retains ordinary last-Owner behavior when the policy is %s',
    async (condition) => {
      const db = await database()
      await invalidateSurvivor(db, 'unenrolled')
      if (condition === 'missing')
        await db.prepare('DELETE FROM organization_policies').run()
      else
        await db.prepare('UPDATE organization_policies SET enabled = 0').run()
      expect(
        (await beginRecoverableAccountDeletion(db, deletion('owner-a'))).status,
      ).toBe('recoverable')
      expect(await activeEnrolledOwners(db)).toBe(0)
      expect(await rows(db, 'organization_group_users')).toHaveLength(2)
    },
  )

  it('counts an enrolled offline Owner and preserves group links through recovery', async () => {
    const db = await database()
    expect(await rows(db, 'devices')).toEqual([])
    const links = await rows(db, 'organization_group_users')
    expect(
      (await beginRecoverableAccountDeletion(db, deletion('owner-a'))).status,
    ).toBe('recoverable')
    expect(await activeEnrolledOwners(db)).toBe(1)
    expect(await rows(db, 'organization_group_users')).toEqual(links)
    expect(
      await recoverAccountDeletion(db, {
        userId: 'owner-a',
        lifecycleGeneration: 'delete-owner-a',
        expectedDisabledSecurityStamp: 'disabled-owner-a',
        nextSecurityStamp: 'recovered-owner-a',
        now: duringRecovery,
        auditEventId: 'recovery-audit',
        auditEvent: audit(
          'account.deletion.recover',
          'owner-a',
          duringRecovery,
        ),
      }),
    ).toEqual({ status: 'recovered' })
    expect(await activeEnrolledOwners(db)).toBe(2)
    expect(await rows(db, 'organization_group_users')).toEqual(links)
  })

  it('allows exactly one concurrent enrolled Owner deletion and keeps one active survivor', async () => {
    const db = await database()
    const outcomes = await Promise.all([
      beginRecoverableAccountDeletion(db, deletion('owner-a')),
      beginRecoverableAccountDeletion(db, deletion('owner-b')),
    ])
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([
      'last_owner',
      'recoverable',
    ])
    expect(await activeEnrolledOwners(db)).toBe(1)
    expect(await rows(db, 'account_deletions')).toHaveLength(1)
    expect(await rows(db, 'audit_events')).toHaveLength(1)
    expect(await rows(db, 'organization_group_users')).toHaveLength(2)
  })

  it.each(['unenrolled', 'disabled-account', 'legacy-factor'])(
    'rechecks a %s survivor when scheduling, starting and sealing a historical deletion',
    async (condition) => {
      const db = await database()
      await historicalDeletion(db)
      await invalidateSurvivor(db, condition)
      const before = await snapshot(db)
      expect(await planAccountDeletion(db, purgeScope())).toMatchObject({
        status: 'recoverable',
        purgeAllowed: false,
      })
      expect(
        await markAccountPurgeReady(db, {
          ...purgeScope(),
          expectedPersonalAttachmentCount: 0,
        }),
      ).toEqual({ status: 'conflict' })
      expect(await snapshot(db)).toEqual(before)
      await db
        .prepare("UPDATE account_deletions SET state = 'purge_ready'")
        .run()
      const ready = await snapshot(db)
      expect(await startAccountPurge(db, purgeScope())).toEqual({
        status: 'conflict',
      })
      expect(await snapshot(db)).toEqual(ready)
      await db
        .prepare(
          "UPDATE account_deletions SET state = 'purging_r2', purge_started_at = ?",
        )
        .bind(cutoff)
        .run()
      const purging = await snapshot(db)
      expect(await finalizeAccountPurge(db, finalization())).toEqual({
        status: 'conflict',
      })
      expect(await snapshot(db)).toEqual(purging)
    },
  )

  it('removes only the purged account group links and preserves shared definitions and ciphertext', async () => {
    const db = await database()
    const groups = await rows(db, 'organization_groups')
    const collectionGroups = await rows(db, 'collection_groups')
    const shared = await db
      .prepare("SELECT * FROM ciphers WHERE id = 'shared-cipher'")
      .first()
    await preparePurge(db)
    expect(await finalizeAccountPurge(db, finalization())).toEqual({
      status: 'tombstoned',
    })
    expect(await rows(db, 'organization_group_users')).toEqual([
      {
        group_id: 'group',
        organization_id: 'org',
        organization_user_id: 'member-owner-b',
      },
    ])
    expect(await rows(db, 'organization_groups')).toEqual(groups)
    expect(await rows(db, 'collection_groups')).toEqual(collectionGroups)
    expect(
      await db
        .prepare("SELECT * FROM ciphers WHERE id = 'shared-cipher'")
        .first(),
    ).toEqual(shared)
    expect(
      await db
        .prepare("SELECT * FROM ciphers WHERE id = 'personal-cipher'")
        .first(),
    ).toBeNull()
    expect(
      await db
        .prepare(
          "SELECT org_key FROM organization_users WHERE id = 'member-owner-a'",
        )
        .first(),
    ).toEqual({ org_key: null })
    expect(
      await db
        .prepare(
          "SELECT state FROM account_deletions WHERE user_id = 'owner-a'",
        )
        .first(),
    ).toEqual({ state: 'tombstoned' })
    expect(await rows(db, 'audit_events')).toHaveLength(2)
    expect(await activeEnrolledOwners(db)).toBe(1)
  })

  it('returns no R2 inventory or deletion when the remaining Owner loses enrollment', async () => {
    const db = await database()
    const bucket = (await instances[instances.length - 1]!.getR2Bucket(
      'VAULT',
    )) as unknown as R2Bucket
    await historicalDeletion(db)
    await db
      .prepare(
        `INSERT INTO cipher_attachments
      (id,user_id,cipher_id,object_key,file_name,attachment_key,size,revision_date)
      VALUES ('attachment','owner-a','personal-cipher','synthetic-owned-object','synthetic-name','synthetic-key',7,?)`,
      )
      .bind(now)
      .run()
    await db
      .prepare(
        "UPDATE account_deletions SET state = 'purge_ready', personal_r2_expected_count = 1",
      )
      .run()
    await bucket.put('synthetic-owned-object', 'payload')
    await invalidateSurvivor(db, 'unenrolled')
    const before = await snapshot(db)
    expect(
      await purgeRecoverableAccount(db, bucket, {
        ...purgeScope(),
        confirmedLifecycleGeneration: 'delete-owner-a',
        requestId: 'synthetic-denied-purge',
      }),
    ).toEqual({ status: 'conflict' })
    expect(await snapshot(db)).toEqual(before)
    expect(await (await bucket.get('synthetic-owned-object'))!.text()).toBe(
      'payload',
    )
    expect(await rows(db, 'cipher_attachments')).toHaveLength(1)
  })

  it('rolls group cleanup, personal deletion and tombstoning back when mandatory purge audit fails', async () => {
    const db = await database()
    await preparePurge(db)
    await db
      .prepare(
        `CREATE TRIGGER reject_purge_audit BEFORE INSERT ON audit_events
      WHEN NEW.name = 'account.deletion.purge'
      BEGIN SELECT RAISE(ABORT, 'synthetic mandatory purge audit failure'); END;`,
      )
      .run()
    const before = await snapshot(db)
    await expect(finalizeAccountPurge(db, finalization())).rejects.toThrow()
    expect(await snapshot(db)).toEqual(before)
  })

  it('commits final purge and another Owner group revocation without retaining stale links', async () => {
    const db = await database()
    await assureOwnerB(db)
    await preparePurge(db)
    const outcomes = await Promise.all([
      finalizeAccountPurge(db, finalization()),
      removeOrganizationGroupMember(db, {
        organizationId: 'org',
        groupId: 'group',
        membershipId: 'member-owner-b',
        actor: {
          userId: 'owner-b',
          sessionId: 'owner-b-session',
          deviceIdentifier: 'owner-b-device',
        },
        now: cutoff,
        auditEvent: audit(
          'organization.group.member.remove',
          'owner-b',
          cutoff,
        ),
      }),
    ])
    expect(outcomes).toEqual([{ status: 'tombstoned' }, { status: 'success' }])
    expect(await rows(db, 'organization_group_users')).toEqual([])
    expect(await rows(db, 'organization_groups')).toHaveLength(1)
    expect(await rows(db, 'collection_groups')).toHaveLength(1)
    expect(await activeEnrolledOwners(db)).toBe(1)
    expect(
      await db
        .prepare(
          "SELECT encrypted_json FROM ciphers WHERE id = 'shared-cipher'",
        )
        .first(),
    ).toEqual({ encrypted_json: 'synthetic-shared-payload' })
    expect(await rows(db, 'audit_events')).toHaveLength(3)
  })

  it('does not couple surviving Owner enrollment to a concurrently revoked group assignment', async () => {
    const db = await database()
    await assureOwnerB(db)
    const [deletionResult, revocationResult] = await Promise.all([
      beginRecoverableAccountDeletion(db, deletion('owner-a')),
      removeOrganizationGroupMember(db, {
        organizationId: 'org',
        groupId: 'group',
        membershipId: 'member-owner-b',
        actor: {
          userId: 'owner-b',
          sessionId: 'owner-b-session',
          deviceIdentifier: 'owner-b-device',
        },
        now,
        auditEvent: audit('organization.group.member.remove', 'owner-b', now),
      }),
    ])
    // Revision advancement can make deletion's account CAS stale; either safe outcome is valid.
    expect(['recoverable', 'conflict']).toContain(deletionResult.status)
    expect(revocationResult).toEqual({ status: 'success' })
    expect(
      await db
        .prepare(
          "SELECT * FROM organization_group_users WHERE organization_user_id = 'member-owner-b'",
        )
        .first(),
    ).toBeNull()
    expect(await activeEnrolledOwners(db)).toBeGreaterThanOrEqual(1)
    expect(
      await db
        .prepare("SELECT disabled_at FROM users WHERE id = 'owner-b'")
        .first(),
    ).toEqual({ disabled_at: null })
    expect(await rows(db, 'collection_groups')).toHaveLength(1)
  })
})

function audit(name: AuditEventName, userId: string, occurredAt: string) {
  return buildAuditEvent({
    name,
    outcome: 'success',
    requestId: `synthetic-${name}-${userId}`,
    occurredAt,
    actor: { userId },
    target: { type: 'account', id: userId },
  })
}

function deletion(userId: string) {
  return {
    userId,
    expectedMasterPasswordHash: 'synthetic-password',
    expectedSecurityStamp: `stamp-${userId}`,
    expectedRevisionDate: now,
    tokenDigest: null,
    lifecycleGeneration: `delete-${userId}`,
    nextSecurityStamp: `disabled-${userId}`,
    now,
    recoverUntil: cutoff,
    auditEventId: `deletion-audit-${userId}`,
    auditEvent: audit('account.deletion.request', userId, now),
  }
}

function purgeScope() {
  return {
    userId: 'owner-a',
    lifecycleGeneration: 'delete-owner-a',
    now: cutoff,
  }
}

function finalization() {
  return {
    ...purgeScope(),
    tombstoneEmail: 'purged-owner-a@example.test',
    tombstoneMasterPasswordHash: 'synthetic-tombstone-password',
    nextSecurityStamp: 'purged-owner-a',
    auditEventId: 'purge-audit',
    auditEvent: audit('account.deletion.purge', 'owner-a', cutoff),
  }
}

async function preparePurge(db: D1Database) {
  expect(
    (await beginRecoverableAccountDeletion(db, deletion('owner-a'))).status,
  ).toBe('recoverable')
  expect(
    await markAccountPurgeReady(db, {
      ...purgeScope(),
      expectedPersonalAttachmentCount: 0,
    }),
  ).toEqual({ status: 'purge_ready' })
  expect(await startAccountPurge(db, purgeScope())).toEqual({
    status: 'purging_r2',
    objectKeys: [],
    deletedCount: 0,
    expectedCount: 0,
  })
}

async function historicalDeletion(db: D1Database) {
  await db
    .prepare(
      "UPDATE users SET disabled_at = ?, security_stamp = 'disabled-owner-a' WHERE id = 'owner-a'",
    )
    .bind(now)
    .run()
  await db
    .prepare(
      `INSERT INTO account_deletions
    (user_id,lifecycle_generation,state,requested_at,recover_until,updated_at)
    VALUES ('owner-a','delete-owner-a','recoverable',?,?,?)`,
    )
    .bind(now, cutoff, now)
    .run()
}

async function invalidateSurvivor(db: D1Database, condition: string) {
  const statements: Record<string, string> = {
    unenrolled: "DELETE FROM user_totp WHERE user_id = 'owner-b'",
    'disabled-factor':
      "UPDATE user_totp SET enabled = 0 WHERE user_id = 'owner-b'",
    'unverified-factor':
      "UPDATE user_totp SET verified_at = NULL WHERE user_id = 'owner-b'",
    'legacy-factor':
      "UPDATE user_totp SET credential_generation = NULL WHERE user_id = 'owner-b'",
    'disabled-account':
      "UPDATE users SET disabled_at = '2026-10-04T00:00:00.000Z' WHERE id = 'owner-b'",
    'accepted-owner':
      "UPDATE organization_users SET status = 1 WHERE user_id = 'owner-b'",
    'revoked-owner':
      "UPDATE organization_users SET status = -1 WHERE user_id = 'owner-b'",
    admin: "UPDATE organization_users SET type = 1 WHERE user_id = 'owner-b'",
    member: "UPDATE organization_users SET type = 2 WHERE user_id = 'owner-b'",
  }
  await db.prepare(statements[condition]!).run()
}

async function activeEnrolledOwners(db: D1Database) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM organization_users member
    JOIN users account ON account.id = member.user_id AND account.disabled_at IS NULL
    JOIN user_totp factor ON factor.user_id = member.user_id AND factor.enabled = 1
      AND factor.verified_at IS NOT NULL AND factor.credential_generation IS NOT NULL
    WHERE member.organization_id = 'org' AND member.type = 0 AND member.status = 2`,
    )
    .first<{ count: number }>()
  return row!.count
}

async function rows(db: D1Database, table: string) {
  return (await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())
    .results
}

async function snapshot(db: D1Database) {
  const tables = [
    'users',
    'organization_users',
    'organization_groups',
    'organization_group_users',
    'collection_groups',
    'ciphers',
    'user_totp',
    'devices',
    'account_deletions',
    'audit_events',
  ]
  return Object.fromEntries(
    await Promise.all(
      tables.map(async (table) => [table, await rows(db, table)]),
    ),
  )
}

async function assureOwnerB(db: D1Database) {
  await db
    .prepare(
      `INSERT INTO devices
    (id,user_id,identifier,session_id,mfa_totp_credential_generation,mfa_verified_at)
    VALUES ('owner-b-device-id','owner-b','owner-b-device','owner-b-session',?,?)`,
    )
    .bind(generation, now)
    .run()
}

async function database(): Promise<D1Database> {
  const instance = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: '2026-07-21',
    d1Databases: { DB: crypto.randomUUID() },
    r2Buckets: { VAULT: crypto.randomUUID() },
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
  for (const userId of ['owner-a', 'owner-b']) {
    await db
      .prepare(
        `INSERT INTO users
      (id,email,email_normalized,kdf_algorithm,kdf_iterations,master_password_hash,security_stamp,revision_date)
      VALUES (?,?,?,'pbkdf2-sha256',600000,'synthetic-password',?,?)`,
      )
      .bind(
        userId,
        `${userId}@example.test`,
        `${userId}@example.test`,
        `stamp-${userId}`,
        now,
      )
      .run()
    await db
      .prepare(
        `INSERT INTO user_totp
      (user_id,encrypted_secret,enabled,verified_at,credential_generation)
      VALUES (?,'synthetic-factor',1,?,?)`,
      )
      .bind(userId, now, generation)
      .run()
  }
  await db
    .prepare(
      "INSERT INTO organizations (id,name,revision_date) VALUES ('org','Synthetic company',?)",
    )
    .bind(now)
    .run()
  await db
    .prepare(
      `INSERT INTO organization_policies (id,organization_id,type,enabled,revision_date,created_at,updated_at)
    VALUES ('policy','org',0,1,?,?,?)`,
    )
    .bind(now, now, now)
    .run()
  for (const userId of ['owner-a', 'owner-b'])
    await db
      .prepare(
        `INSERT INTO organization_users (id,organization_id,user_id,email,org_key,status,type)
      VALUES (?,'org',? ,?,'synthetic-org-key',2,0)`,
      )
      .bind(`member-${userId}`, userId, `${userId}@example.test`)
      .run()
  await db
    .prepare(
      `INSERT INTO organization_groups (id,organization_id,name,revision_date,last_mutation_id,created_at,updated_at)
    VALUES ('group','org','Synthetic group',?,'synthetic-seed-mutation',?,?)`,
    )
    .bind(now, now, now)
    .run()
  for (const userId of ['owner-a', 'owner-b'])
    await db
      .prepare(
        `INSERT INTO organization_group_users (group_id,organization_id,organization_user_id)
      VALUES ('group','org',?)`,
      )
      .bind(`member-${userId}`)
      .run()
  await db
    .prepare(
      "INSERT INTO collections (id,organization_id,encrypted_name,revision_date) VALUES ('collection','org','synthetic-name',?)",
    )
    .bind(now)
    .run()
  await db
    .prepare(
      "INSERT INTO collection_groups (group_id,organization_id,collection_id) VALUES ('group','org','collection')",
    )
    .run()
  await db
    .prepare(
      `INSERT INTO ciphers (id,user_id,type,encrypted_json,revision_date,organization_id,cipher_key)
    VALUES ('shared-cipher','owner-a',1,'synthetic-shared-payload',?,'org','synthetic-wrapped-key')`,
    )
    .bind(now)
    .run()
  await db
    .prepare(
      "INSERT INTO collection_ciphers (collection_id,cipher_id) VALUES ('collection','shared-cipher')",
    )
    .run()
  await db
    .prepare(
      `INSERT INTO ciphers (id,user_id,type,encrypted_json,revision_date)
    VALUES ('personal-cipher','owner-a',1,'synthetic-personal-payload',?)`,
    )
    .bind(now)
    .run()
  return db
}

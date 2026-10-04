import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it } from 'vitest'

import { buildAuditEvent } from '../../src/domain/audit'
import { createOrganizationFoundation } from '../../src/repositories/organization-repository'
import { listAccessibleCiphersByUser } from '../../src/repositories/cipher-repository'
import {
  revokeOrganizationMember,
  removeOrganizationMember,
  updateOrganizationMember,
} from '../../src/repositories/organization-membership-repository'
import { getAccountRevisionDate } from '../../src/repositories/user-repository'

const instances: Miniflare[] = []
const baseline = '2026-10-03T00:00:00.000Z'
const sharedRevision = '2026-10-03T00:10:00.000Z'
const mutationTime = '2026-10-03T00:00:01.000Z'

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()))
})

describe('organization revision polling on real migrated local D1', () => {
  it.each(
    [0, 1, 2].flatMap((type) => [0, 1].map((readOnly) => ({ type, readOnly }))),
  )(
    'includes assigned shared-cipher revisions for role $type readOnly $readOnly without manage rights',
    async ({ type, readOnly }) => {
      const db = await createDatabase()
      await db
        .prepare('UPDATE organization_users SET type = ? WHERE id = ?')
        .bind(type, 'member-membership')
        .run()
      await db
        .prepare(
          'UPDATE collection_users SET read_only = ? WHERE organization_user_id = ?',
        )
        .bind(readOnly, 'member-membership')
        .run()
      expect(await getAccountRevisionDate(db, 'member')).toBe(sharedRevision)
      await db
        .prepare('UPDATE ciphers SET revision_date = ? WHERE id = ?')
        .bind('2026-10-03T00:11:00.000Z', 'shared')
        .run()
      expect(await getAccountRevisionDate(db, 'member')).toBe(
        '2026-10-03T00:11:00.000Z',
      )
    },
  )

  it.each(['revoked', 'invited', 'accepted', 'disabled', 'cross-org'])(
    'excludes %s organization revisions and keeps foreign personal data private',
    async (condition) => {
      const db = await createDatabase()
      if (condition === 'revoked')
        await db
          .prepare('UPDATE organization_users SET status = -1 WHERE id = ?')
          .bind('member-membership')
          .run()
      if (condition === 'invited')
        await db
          .prepare('UPDATE organization_users SET status = 0 WHERE id = ?')
          .bind('member-membership')
          .run()
      if (condition === 'accepted')
        await db
          .prepare('UPDATE organization_users SET status = 1 WHERE id = ?')
          .bind('member-membership')
          .run()
      if (condition === 'disabled')
        await db
          .prepare(
            'UPDATE organizations SET enabled = 0, revision_date = ? WHERE id = ?',
          )
          .bind(sharedRevision, 'org')
          .run()
      if (condition === 'cross-org') {
        await db
          .prepare(
            'INSERT INTO organizations (id, name, revision_date) VALUES (?, ?, ?)',
          )
          .bind('foreign-org', 'Foreign', baseline)
          .run()
        await db
          .prepare('UPDATE collections SET organization_id = ? WHERE id = ?')
          .bind('foreign-org', 'collection')
          .run()
      }
      expect(await getAccountRevisionDate(db, 'member')).toBe(baseline)
      expect(await getAccountRevisionDate(db, 'outsider')).toBe(baseline)
    },
  )

  it.each([3, 4, 99])(
    'excludes unsupported role %s from polling despite confirmed collection assignment',
    async (type) => {
      const db = await createDatabase()
      await db
        .prepare('UPDATE organization_users SET type = ? WHERE id = ?')
        .bind(type, 'member-membership')
        .run()
      await db
        .prepare('UPDATE organizations SET revision_date = ? WHERE id = ?')
        .bind('2026-10-03T00:20:00.000Z', 'org')
        .run()
      expect(await listAccessibleCiphersByUser(db, 'member')).toEqual([])
      expect(await getAccountRevisionDate(db, 'member')).toBe(baseline)
    },
  )

  it.each(
    ['revoke', 'remove', 'unassign'].flatMap((operation) =>
      ['cipher', 'organization'].map((latest) => ({ operation, latest })),
    ),
  )(
    'advances polling after $operation even when the latest $latest revision exceeds the mutation clock',
    async ({ operation, latest }) => {
      const db = await createDatabase()
      const expectedBefore =
        latest === 'cipher' ? sharedRevision : '2026-10-03T00:20:00.000Z'
      if (latest === 'organization')
        await db
          .prepare('UPDATE organizations SET revision_date = ? WHERE id = ?')
          .bind(expectedBefore, 'org')
          .run()
      const before = await getAccountRevisionDate(db, 'member')
      expect(before).toBe(expectedBefore)
      expect(
        (await listAccessibleCiphersByUser(db, 'member')).map(
          (cipher) => cipher.id,
        ),
      ).toEqual(['shared'])
      const input = {
        organizationId: 'org',
        actorUserId: 'owner',
        membershipId: 'member-membership',
        now: mutationTime,
        auditEvent: buildAuditEvent({
          name:
            operation === 'revoke'
              ? 'organization.member.revoke'
              : operation === 'remove'
                ? 'organization.member.remove'
                : 'organization.member.update',
          outcome: 'success',
          requestId: `revision-${operation}`,
          occurredAt: mutationTime,
          actor: { userId: 'owner' },
          target: { type: 'organization_user', id: 'member-membership' },
        }),
      }
      const result =
        operation === 'revoke'
          ? await revokeOrganizationMember(db, input)
          : operation === 'remove'
            ? await removeOrganizationMember(db, input)
            : await updateOrganizationMember(db, {
                ...input,
                type: 2,
                collections: [],
              })
      expect(result).toEqual({ status: 'success' })
      const after = await getAccountRevisionDate(db, 'member')
      expect(after).not.toBeNull()
      expect(after! > before!).toBe(true)
      expect(await listAccessibleCiphersByUser(db, 'member')).toEqual([])
      expect(
        await db
          .prepare('SELECT revision_date FROM users WHERE id = ?')
          .bind('member')
          .first(),
      ).toEqual({ revision_date: after })
    },
  )
})

async function createDatabase(): Promise<D1Database> {
  const instance = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: '2026-07-06',
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
  for (const user of ['owner', 'member', 'outsider']) {
    await db
      .prepare(
        `INSERT INTO users (id, email, email_normalized, kdf_algorithm, kdf_iterations, master_password_hash, user_key, security_stamp, revision_date)
      VALUES (?, ?, ?, 'pbkdf2-sha256', 600000, 'synthetic-hash', '2.wrapper', 'stamp', ?)`,
      )
      .bind(user, `${user}@example.test`, `${user}@example.test`, baseline)
      .run()
  }
  await createOrganizationFoundation(db, {
    organizationId: 'org',
    organizationUserId: 'owner-membership',
    collectionId: 'collection',
    userId: 'owner',
    email: 'owner@example.test',
    name: 'Synthetic org',
    billingEmail: null,
    planType: 0,
    orgKey: '2.owner-key',
    publicKey: 'opaque-public-key',
    privateKey: '2.private-key',
    encryptedCollectionName: '2.collection',
    now: baseline,
  })
  await db.batch([
    db.prepare(
      `INSERT INTO organization_users (id, organization_id, user_id, email, org_key, status, type) VALUES ('member-membership', 'org', 'member', 'member@example.test', '2.member-key', 2, 2)`,
    ),
    db.prepare(
      `INSERT INTO collection_users (collection_id, organization_user_id, read_only, hide_passwords, manage) VALUES ('collection', 'member-membership', 1, 0, 0)`,
    ),
    db
      .prepare(
        `INSERT INTO ciphers (id, user_id, type, encrypted_json, revision_date, organization_id, cipher_key) VALUES ('shared', 'owner', 1, '{}', ?, 'org', '2.cipher-key')`,
      )
      .bind(sharedRevision),
    db.prepare(
      `INSERT INTO collection_ciphers (collection_id, cipher_id) VALUES ('collection', 'shared')`,
    ),
    db.prepare(
      `INSERT INTO ciphers (id, user_id, type, encrypted_json, revision_date) VALUES ('foreign-personal', 'owner', 1, '{}', '2026-10-03T01:00:00.000Z')`,
    ),
  ])
  return db
}

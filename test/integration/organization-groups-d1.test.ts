import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it } from 'vitest'
import { buildAuditEvent } from '../../src/domain/audit'
import { registerOrganizationGroupsRoutes } from '../../src/organization-groups-routes'
import {
  createOrganizationGroup,
  deleteOrganizationGroup,
  findOrganizationGroup,
  listOrganizationGroups,
  removeOrganizationGroupMember,
  updateOrganizationGroup,
} from '../../src/repositories/organization-groups-repository'

const instances: Miniflare[] = []
const now = '2026-10-04T00:00:00.000Z'
const actor = {
  userId: 'owner',
  sessionId: 'synthetic-session',
  deviceIdentifier: 'synthetic-device',
}
const grant = {
  id: 'collection',
  readOnly: true,
  hidePasswords: true,
  manage: false,
}
const request = {
  name: 'Engineering',
  collections: [grant],
  users: ['member-membership'],
}
const scope = { organizationId: 'org', actor }
const mutation = (groupId = 'group') => ({
  ...scope,
  groupId,
  now,
  auditEvent: buildAuditEvent({
    name: 'organization.group.update',
    outcome: 'success',
    requestId: crypto.randomUUID(),
    occurredAt: now,
    actor: { userId: actor.userId },
    target: { type: 'organization_group', id: groupId },
    context: { organizationId: 'org' },
  }),
})

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()))
})

describe('organization group authority and atomicity on real migrated D1', () => {
  it('creates and replaces complete same-org sets with one mandatory audit each', async () => {
    const db = await database()
    expect(await create(db)).toEqual({ status: 'success' })
    const group = await findOrganizationGroup(db, {
      ...scope,
      groupId: 'group',
    })
    expect(group).toMatchObject({
      ...request,
      id: 'group',
      organizationId: 'org',
    })
    expect(
      await updateOrganizationGroup(db, {
        ...mutation(),
        name: 'Operations',
        collections: [],
        users: ['other-membership'],
        expectedRevisionDate: group!.revisionDate,
      }),
    ).toEqual({ status: 'success' })
    expect(
      await findOrganizationGroup(db, { ...scope, groupId: 'group' }),
    ).toMatchObject({
      name: 'Operations',
      collections: [],
      users: ['other-membership'],
    })
    expect(await count(db, 'audit_events')).toBe(2)
    expect(await listOrganizationGroups(db, scope)).toMatchObject({
      status: 'success',
      groups: [{ name: 'Operations' }],
    })
  })

  it.each([
    'foreign-member',
    'foreign-collection',
    'revoked-member',
    'disabled-member',
    'unsupported-member',
  ])(
    'rejects %s before any partial set, audit or revision is committed',
    async (condition) => {
      const db = await database()
      await create(db)
      const replacement = {
        ...request,
        collections: [grant],
        users: [...request.users],
      }
      if (condition === 'foreign-member')
        replacement.users = ['foreign-membership']
      if (condition === 'foreign-collection')
        replacement.collections = [{ ...grant, id: 'foreign-collection' }]
      if (condition === 'revoked-member')
        await db
          .prepare(
            "UPDATE organization_users SET status=-1 WHERE id='member-membership'",
          )
          .run()
      if (condition === 'disabled-member')
        await db
          .prepare("UPDATE users SET disabled_at=? WHERE id='member'")
          .bind(now)
          .run()
      if (condition === 'unsupported-member')
        await db
          .prepare(
            "UPDATE organization_users SET type=4 WHERE id='member-membership'",
          )
          .run()
      const before = await snapshot(db)
      expect(
        await updateOrganizationGroup(db, { ...mutation(), ...replacement }),
      ).toEqual({ status: 'not_found' })
      expect(await snapshot(db)).toEqual(before)
    },
  )

  it('enforces same-org membership and collection relationships through composite foreign keys', async () => {
    const db = await database()
    await create(db)
    await expect(
      db
        .prepare(
          "INSERT INTO organization_group_users(group_id,organization_id,organization_user_id) VALUES('group','org','foreign-membership')",
        )
        .run(),
    ).rejects.toThrow(/FOREIGN KEY/i)
    await expect(
      db
        .prepare(
          "INSERT INTO collection_groups(group_id,organization_id,collection_id) VALUES('group','org','foreign-collection')",
        )
        .run(),
    ).rejects.toThrow(/FOREIGN KEY/i)
    await expect(
      db
        .prepare(
          "INSERT INTO collection_groups(group_id,organization_id,collection_id,read_only) VALUES('group','org','collection-2',2)",
        )
        .run(),
    ).rejects.toThrow(/CHECK/i)
  })

  it.each([
    'ordinary',
    'accepted',
    'revoked',
    'disabled-account',
    'disabled-org',
  ])('rechecks manager authority for %s', async (condition) => {
    const db = await database()
    await create(db)
    const input = mutation()
    if (condition === 'ordinary') input.actor = { ...actor, userId: 'member' }
    if (condition === 'accepted')
      await db
        .prepare(
          "UPDATE organization_users SET status=1 WHERE id='owner-membership'",
        )
        .run()
    if (condition === 'revoked')
      await db
        .prepare(
          "UPDATE organization_users SET status=-1 WHERE id='owner-membership'",
        )
        .run()
    if (condition === 'disabled-account')
      await db
        .prepare("UPDATE users SET disabled_at=? WHERE id='owner'")
        .bind(now)
        .run()
    if (condition === 'disabled-org')
      await db
        .prepare("UPDATE organizations SET enabled=0 WHERE id='org'")
        .run()
    const before = await snapshot(db)
    expect(await updateOrganizationGroup(db, { ...input, ...request })).toEqual(
      { status: 'not_found' },
    )
    expect(
      await findOrganizationGroup(db, {
        ...scope,
        actor: input.actor,
        groupId: 'group',
      }),
    ).toBeNull()
    expect(await snapshot(db)).toEqual(before)
  })

  it('allows Admin to manage User access and refuses current or requested higher-role membership', async () => {
    const db = await database()
    const admin = { ...actor, userId: 'admin' }
    expect(
      await createOrganizationGroup(db, {
        ...mutation(),
        actor: admin,
        ...request,
      }),
    ).toEqual({ status: 'success' })
    expect(
      await updateOrganizationGroup(db, {
        ...mutation(),
        actor: admin,
        ...request,
        name: 'Admin-managed',
      }),
    ).toEqual({ status: 'success' })
    const before = await snapshot(db)
    expect(
      await updateOrganizationGroup(db, {
        ...mutation(),
        actor: admin,
        ...request,
        users: ['owner-membership'],
      }),
    ).toEqual({ status: 'not_found' })
    expect(await snapshot(db)).toEqual(before)
    expect(
      await updateOrganizationGroup(db, {
        ...mutation(),
        ...request,
        users: ['owner-membership', 'member-membership'],
      }),
    ).toEqual({ status: 'success' })
    const withOwner = await snapshot(db)
    for (const operation of [
      updateOrganizationGroup(db, { ...mutation(), actor: admin, ...request }),
      deleteOrganizationGroup(db, { ...mutation(), actor: admin }),
      removeOrganizationGroupMember(db, {
        ...mutation(),
        actor: admin,
        membershipId: 'member-membership',
      }),
    ])
      expect(await operation).toEqual({ status: 'not_found' })
    expect(await snapshot(db)).toEqual(withOwner)
    expect(await deleteOrganizationGroup(db, mutation())).toEqual({
      status: 'success',
    })
  })

  it('refuses a formerly authorized manager after a role change inside the write boundary', async () => {
    const db = await database()
    await create(db)
    expect(
      await findOrganizationGroup(db, { ...scope, groupId: 'group' }),
    ).not.toBeNull()
    await db
      .prepare(
        "UPDATE organization_users SET type=2 WHERE id='owner-membership'",
      )
      .run()
    const before = await snapshot(db)
    expect(
      await updateOrganizationGroup(db, { ...mutation(), ...request }),
    ).toEqual({ status: 'not_found' })
    expect(await snapshot(db)).toEqual(before)
  })

  it.each([
    [
      'audit-abort',
      "CREATE TRIGGER synthetic_failure BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;",
    ],
    [
      'audit-ignore',
      'CREATE TRIGGER synthetic_failure BEFORE INSERT ON audit_events BEGIN SELECT RAISE(IGNORE); END;',
    ],
    [
      'users-ignore',
      'CREATE TRIGGER synthetic_failure BEFORE UPDATE ON users BEGIN SELECT RAISE(IGNORE); END;',
    ],
    [
      'org-revision-abort',
      "CREATE TRIGGER synthetic_failure BEFORE UPDATE ON organizations BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;",
    ],
    [
      'member-insert-abort',
      "CREATE TRIGGER synthetic_failure BEFORE INSERT ON organization_group_users BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;",
    ],
    [
      'member-delete-ignore',
      'CREATE TRIGGER synthetic_failure BEFORE DELETE ON organization_group_users BEGIN SELECT RAISE(IGNORE); END;',
    ],
    [
      'grant-insert-ignore',
      'CREATE TRIGGER synthetic_failure BEFORE INSERT ON collection_groups BEGIN SELECT RAISE(IGNORE); END;',
    ],
    [
      'grant-delete-ignore',
      'CREATE TRIGGER synthetic_failure BEFORE DELETE ON collection_groups BEGIN SELECT RAISE(IGNORE); END;',
    ],
  ])(
    'rolls back root, audit, sets and revisions when %s',
    async (_condition, trigger) => {
      const db = await database()
      await create(db)
      await db.prepare(trigger).run()
      const before = await snapshot(db)
      const replacement = _condition.endsWith('delete-ignore')
        ? { ...request, users: [], collections: [] }
        : { ...request, users: ['other-membership'] }
      await expect(
        updateOrganizationGroup(db, {
          ...mutation(),
          ...replacement,
          name: 'Must roll back',
        }),
      ).rejects.toThrow()
      expect(await snapshot(db)).toEqual(before)
      await db.prepare('DROP TRIGGER synthetic_failure').run()
      expect(
        await updateOrganizationGroup(db, { ...mutation(), ...replacement }),
      ).toEqual({ status: 'success' })
    },
  )

  it('rejects competing same-revision replacements with one winner and one audit', async () => {
    const db = await database()
    await create(db)
    const group = await findOrganizationGroup(db, {
      ...scope,
      groupId: 'group',
    })
    const results = await Promise.all([
      updateOrganizationGroup(db, {
        ...mutation(),
        ...request,
        name: 'First',
        expectedRevisionDate: group!.revisionDate,
      }),
      updateOrganizationGroup(db, {
        ...mutation(),
        ...request,
        name: 'Second',
        expectedRevisionDate: group!.revisionDate,
      }),
    ])
    expect(results.map((result) => result.status).sort()).toEqual([
      'conflict',
      'success',
    ])
    expect(await count(db, 'audit_events')).toBe(2)
    expect(
      (await findOrganizationGroup(db, { ...scope, groupId: 'group' }))?.users,
    ).toEqual(request.users)
  })

  it.each(['replace', 'remove-member', 'delete'] as const)(
    'advances recipient polling past future disappearing cipher revisions on %s with a backward clock',
    async (operation) => {
      const db = await database()
      await create(db)
      await db
        .prepare(
          "INSERT INTO ciphers(id,user_id,type,encrypted_json,revision_date,organization_id) VALUES('shared','owner',1,'{}','2027-01-01T00:00:00.000Z','org')",
        )
        .run()
      await db
        .prepare(
          "INSERT INTO collection_ciphers(collection_id,cipher_id) VALUES('collection','shared')",
        )
        .run()
      const previous = (await findOrganizationGroup(db, {
        ...scope,
        groupId: 'group',
      }))!.revisionDate
      const input = { ...mutation(), now: '2025-01-01T00:00:00.000Z' }
      const result =
        operation === 'replace'
          ? await updateOrganizationGroup(db, {
              ...input,
              ...request,
              collections: [],
              users: [],
            })
          : operation === 'remove-member'
            ? await removeOrganizationGroupMember(db, {
                ...input,
                membershipId: 'member-membership',
              })
            : await deleteOrganizationGroup(db, input)
      expect(result).toEqual({ status: 'success' })
      expect(
        await db
          .prepare(
            "SELECT revision_date AS revisionDate FROM users WHERE id='member'",
          )
          .first(),
      ).toEqual({ revisionDate: '2027-01-01T00:00:00.001Z' })
      const current = await findOrganizationGroup(db, {
        ...scope,
        groupId: 'group',
      })
      if (operation !== 'delete')
        expect(current!.revisionDate > previous).toBe(true)
      expect(await count(db, 'organization_group_users')).toBe(0)
      if (operation === 'delete')
        expect(await count(db, 'collection_groups')).toBe(0)
      expect(await count(db, 'audit_events')).toBe(2)
    },
  )

  it('returns pinned response shapes, raw membership IDs and guarded replacements through actual routes', async () => {
    const db = await database()
    const app = new Hono()
    registerOrganizationGroupsRoutes(app, {
      authenticate: async () => ({ ok: true, actor }),
      runtime: () => ({ enabled: true, database: db }),
      requestId: () => 'group-route-test',
      reportFailure: () => {},
    })
    const created = await app.request('/api/organizations/org/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    expect(created.status).toBe(200)
    const group = (await created.json()) as { Id: string; Object: string }
    expect(group).toMatchObject({
      Object: 'group',
      OrganizationId: 'org',
      Name: request.name,
      ExternalId: null,
    })
    expect(Object.keys(group).sort()).toEqual([
      'ExternalId',
      'Id',
      'Name',
      'Object',
      'OrganizationId',
    ])
    const path = `/api/organizations/org/groups/${group.Id}`
    const users = await app.request(`${path}/users`)
    expect(await users.json()).toEqual(['member-membership'])
    const details = await app.request(`${path}/details`)
    expect(await details.json()).toMatchObject({
      Object: 'groupDetails',
      Collections: [
        {
          Id: 'collection',
          ReadOnly: true,
          HidePasswords: true,
          Manage: false,
        },
      ],
    })
    const update = await app.request(path, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'if-match': created.headers.get('etag')!,
      },
      body: JSON.stringify({ ...request, users: [] }),
    })
    expect(update.status).toBe(200)
    expect(
      (
        await app.request(path, {
          method: 'DELETE',
          headers: { 'if-match': created.headers.get('etag')! },
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await app.request(path, {
          method: 'DELETE',
          headers: { 'if-match': update.headers.get('etag')! },
        })
      ).status,
    ).toBe(200)
    expect(await count(db, 'audit_events')).toBe(3)
  })

  it.each(['revoked', 'superseded'])(
    'rechecks a %s family after HTTP authentication with policy disabled',
    async (condition) => {
      const db = await database()
      await create(db)
      const app = new Hono()
      registerOrganizationGroupsRoutes(app, {
        authenticate: async () => {
          if (condition === 'revoked')
            await db
              .prepare("UPDATE devices SET revoked_at=? WHERE user_id='owner'")
              .bind(now)
              .run()
          else
            await db
              .prepare(
                "UPDATE devices SET session_id='replacement-family' WHERE user_id='owner'",
              )
              .run()
          return { ok: true, actor }
        },
        runtime: () => ({ enabled: true, database: db }),
        requestId: () => 'synthetic-request',
        reportFailure: () => undefined,
      })
      const before = await snapshot(db)
      const path = '/api/organizations/org/groups'
      expect(
        (
          await app.request(`${path}/group`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(request),
          })
        ).status,
      ).toBe(404)
      expect((await app.request(path)).status).toBe(404)
      expect(await listOrganizationGroups(db, scope)).toEqual({
        status: 'not_found',
      })
      expect(
        await updateOrganizationGroup(db, { ...mutation(), ...request }),
      ).toEqual({ status: 'not_found' })
      expect(await snapshot(db)).toEqual(before)
    },
  )

  it('denies an enrolled but unverified current-family session when required-TOTP policy is enabled', async () => {
    const db = await database()
    await create(db)
    await db
      .prepare(
        "INSERT INTO user_totp(user_id,encrypted_secret,enabled,verified_at,credential_generation) VALUES('owner','synthetic-encrypted-factor',1,?,'factor-generation')",
      )
      .bind(now)
      .run()
    await db
      .prepare(
        "INSERT INTO organization_policies(id,organization_id,type,enabled,revision_date,created_at,updated_at) VALUES('policy','org',0,1,?,?,?)",
      )
      .bind(now, now, now)
      .run()
    const before = await snapshot(db)
    expect(
      await findOrganizationGroup(db, { ...scope, groupId: 'group' }),
    ).toBeNull()
    expect(
      await updateOrganizationGroup(db, { ...mutation(), ...request }),
    ).toEqual({ status: 'not_found' })
    expect(await snapshot(db)).toEqual(before)
    await db
      .prepare(
        "UPDATE devices SET mfa_totp_credential_generation='factor-generation',mfa_verified_at=? WHERE id='owner-device'",
      )
      .bind(now)
      .run()
    expect(
      await findOrganizationGroup(db, { ...scope, groupId: 'group' }),
    ).not.toBeNull()
    expect(
      await findOrganizationGroup(db, {
        ...scope,
        actor: { ...actor, sessionId: 'stale-family' },
        groupId: 'group',
      }),
    ).toBeNull()
    await db
      .prepare(
        "UPDATE user_totp SET credential_generation='replacement-factor' WHERE user_id='owner'",
      )
      .run()
    expect(
      await findOrganizationGroup(db, { ...scope, groupId: 'group' }),
    ).toBeNull()
  })
})

async function create(db: D1Database) {
  return createOrganizationGroup(db, { ...mutation(), ...request })
}
async function count(db: D1Database, table: string) {
  return (await db
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .first<{ count: number }>())!.count
}
async function snapshot(db: D1Database) {
  const result = []
  for (const table of [
    'users',
    'organizations',
    'organization_users',
    'organization_groups',
    'organization_group_users',
    'collection_groups',
    'audit_events',
  ])
    result.push(
      (await db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results,
    )
  return result
}
async function database(): Promise<D1Database> {
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
  for (const user of ['owner', 'admin', 'member', 'other', 'outsider']) {
    await db
      .prepare(
        `INSERT INTO users(id,email,email_normalized,kdf_algorithm,kdf_iterations,master_password_hash,security_stamp,revision_date)
      VALUES(?,?,?,'pbkdf2-sha256',600000,'synthetic-hash','synthetic-stamp',?)`,
      )
      .bind(user, `${user}@example.test`, `${user}@example.test`, now)
      .run()
    await db
      .prepare(
        'INSERT INTO devices(id,user_id,identifier,session_id) VALUES(?,?,?,?)',
      )
      .bind(`${user}-device`, user, actor.deviceIdentifier, actor.sessionId)
      .run()
  }
  for (const organizationId of ['org', 'foreign'])
    await db
      .prepare('INSERT INTO organizations(id,name,revision_date) VALUES(?,?,?)')
      .bind(organizationId, 'Synthetic company', now)
      .run()
  for (const [id, organizationId, userId, type] of [
    ['owner-membership', 'org', 'owner', 0],
    ['admin-membership', 'org', 'admin', 1],
    ['member-membership', 'org', 'member', 2],
    ['other-membership', 'org', 'other', 2],
    ['foreign-membership', 'foreign', 'outsider', 2],
  ] as const)
    await db
      .prepare(
        'INSERT INTO organization_users(id,organization_id,user_id,email,status,type) VALUES(?,?,?,?,2,?)',
      )
      .bind(id, organizationId, userId, `${userId}@example.test`, type)
      .run()
  for (const [id, organizationId] of [
    ['collection', 'org'],
    ['collection-2', 'org'],
    ['foreign-collection', 'foreign'],
  ] as const)
    await db
      .prepare(
        'INSERT INTO collections(id,organization_id,encrypted_name,revision_date) VALUES(?,?,?,?)',
      )
      .bind(id, organizationId, '2.synthetic-name', now)
      .run()
  return db
}

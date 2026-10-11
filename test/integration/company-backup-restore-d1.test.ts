import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { Miniflare } from 'miniflare'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildAuditEvent } from '../../src/domain/audit'
import {
  findAccessibleCipherById,
  resolveCipherAccess,
} from '../../src/repositories/cipher-repository'
import { revokeOrganizationMember } from '../../src/repositories/organization-membership-repository'
import { createOrganizationGroup } from '../../src/repositories/organization-groups-repository'
import { updateOrganizationPolicy } from '../../src/repositories/organization-policy-repository'
import type { OrganizationPolicyActor } from '../../src/repositories/organization-policy-sql'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const migrationSnapshot = readdirSync(join(repoRoot, 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => ({
    file,
    contents: readFileSync(join(repoRoot, 'migrations', file), 'utf8'),
  }))
const backupScript = join(repoRoot, 'scripts/honowarden-backup.mjs')
const now = '2026-10-04T00:00:00.000Z'
const later = '2026-10-04T00:01:00.000Z'
const factorGeneration = 'synthetic-current-factor'
const objectKey = 'attachments/synthetic-company-restore'
const objectBody = 'synthetic-encrypted-attachment-bytes'
const instances = new Set<Miniflare>()
const runRoots: string[] = []
const environment = {
  ...process.env,
  PATH: `${dirname(process.execPath)}:${join(repoRoot, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
  WRANGLER_SEND_METRICS: 'false',
}

type Resource = {
  root: string
  config: string
  persist: string
  databaseId: string
  databaseName: string
  bucketName: string
}
type BackupManifest = {
  credentialGeneration: { manifestSha256: string; sourceStateSha256: string }
  d1: { sha256: string; restoreFile: string; restoreSha256: string }
  r2: { objects: Array<{ key: string; file: string; sha256: string }> }
}
type RoundTrip = {
  db: D1Database
  bucket: R2Bucket
  sourceSchema: unknown[]
  sourceRows: Record<string, unknown[]>
  manifest: BackupManifest
  backup: string
  manifestSha256: string
  target: Resource
  restore: {
    executed: boolean
    verification: {
      status: string
      r2ObjectCount: number
      sourceStateSha256: string
    }
  }
}
let current: RoundTrip

beforeAll(async () => {
  current = await roundTrip('post-offboard')
}, 120_000)

afterAll(async () => {
  await Promise.all([...instances].map((instance) => instance.dispose()))
  instances.clear()
  await Promise.all(
    runRoots.map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('company generation-bound backup and fresh restore on real D1/R2', () => {
  it('restores all tracked schema, company rows, audit nonce and R2 bytes after offboarding', async () => {
    expect(current.restore).toMatchObject({
      executed: true,
      verification: {
        status: 'passed',
        r2ObjectCount: 1,
        sourceStateSha256:
          current.manifest.credentialGeneration.sourceStateSha256,
      },
    })
    expect(await schema(current.db)).toEqual(current.sourceSchema)
    expect(await companyRows(current.db)).toEqual(current.sourceRows)
    const latestMigration = migrationSnapshot.at(-1)!.file.split('_')[0]
    expect(
      await current.db
        .prepare('SELECT version FROM schema_migrations WHERE version = ?')
        .bind(latestMigration)
        .first(),
    ).toEqual({ version: latestMigration })
    expect(
      await current.db.prepare('PRAGMA foreign_key_check').all(),
    ).toMatchObject({ results: [] })
    const member = await current.db
      .prepare(
        `SELECT status,org_key,last_membership_mutation_id
      FROM organization_users WHERE id = 'membership-member'`,
      )
      .first<{
        status: number
        org_key: string | null
        last_membership_mutation_id: string
      }>()
    expect(member).toMatchObject({
      status: -1,
      org_key: null,
      last_membership_mutation_id: expect.stringMatching(/^[a-f0-9-]{36}$/),
    })
    expect(
      await current.db
        .prepare('SELECT name FROM audit_events WHERE id = ?')
        .bind(member!.last_membership_mutation_id)
        .first(),
    ).toEqual({ name: 'organization.member.revoke' })
    const policy = await current.db
      .prepare('SELECT last_mutation_id FROM organization_policies')
      .first<{ last_mutation_id: string }>()
    expect(policy!.last_mutation_id).toMatch(/^[a-f0-9-]{36}$/)
    expect(
      await current.db
        .prepare('SELECT name FROM audit_events WHERE id = ?')
        .bind(policy!.last_mutation_id)
        .first(),
    ).toEqual({ name: 'organization.policy.update' })
    const group = await current.db
      .prepare('SELECT last_mutation_id FROM organization_groups')
      .first<{ last_mutation_id: string }>()
    expect(group!.last_mutation_id).toMatch(/^[a-f0-9-]{36}$/)
    expect(
      await current.db
        .prepare('SELECT name FROM audit_events WHERE id = ?')
        .bind(group!.last_mutation_id)
        .first(),
    ).toEqual({ name: 'organization.group.create' })
    expect(
      await current.db
        .prepare(
          "SELECT * FROM organization_group_users WHERE organization_user_id = 'membership-member'",
        )
        .first(),
    ).toBeNull()
    expect(current.manifest.d1.restoreFile).toBe('d1-restore.sql')
    expect(
      digest(
        await readFile(join(current.backup, current.manifest.d1.restoreFile)),
      ),
    ).toBe(current.manifest.d1.restoreSha256)
    const object = await current.bucket.get(objectKey)
    expect(object).not.toBeNull()
    expect(await object!.text()).toBe(objectBody)
    expect(current.manifest.r2.objects).toEqual([
      { key: objectKey, file: expect.any(String), sha256: digest(objectBody) },
    ])
  })

  it('preserves required policy and current-family authorization while denying revoked or proofless readers', async () => {
    expect(
      await current.db
        .prepare('SELECT type,enabled FROM organization_policies')
        .all(),
    ).toMatchObject({ results: [{ type: 0, enabled: 1 }] })
    expect(await access(current.db, actor('owner'))).toMatchObject({
      canRead: true,
      canEdit: true,
      canViewPassword: true,
    })
    expect(
      await findAccessibleCipherById(current.db, {
        id: 'shared-cipher',
        userId: 'owner',
        actor: actor('owner'),
      }),
    ).toMatchObject({
      organizationId: 'org',
      cipherKey: 'synthetic-shared-wrapper',
      collectionIds: ['collection'],
    })
    for (const requested of [
      actor('member'),
      actor('proofless'),
      {
        ...actor('owner'),
        sessionId: 'owner-stale-session',
        deviceIdentifier: 'owner-stale-device',
      },
      { ...actor('owner'), sessionId: 'foreign-session' },
    ]) {
      expect(await access(current.db, requested)).toMatchObject({
        canRead: false,
        canEdit: false,
        canViewPassword: false,
      })
      expect(
        await findAccessibleCipherById(current.db, {
          id: 'shared-cipher',
          userId: requested.userId,
          actor: requested,
        }),
      ).toBeNull()
    }
    // Enrollment survives restore even when an active family has no MFA assurance.
    expect(
      await current.db
        .prepare(
          "SELECT enabled,credential_generation FROM user_totp WHERE user_id = 'proofless'",
        )
        .first(),
    ).toEqual({ enabled: 1, credential_generation: factorGeneration })
    expect(
      await current.db
        .prepare(
          "SELECT mfa_totp_credential_generation,mfa_verified_at FROM devices WHERE id = 'device-proofless'",
        )
        .first(),
    ).toEqual({ mfa_totp_credential_generation: null, mfa_verified_at: null })
  })

  it('restores historical authorization exactly, so a pre-offboard snapshot requires reconciliation before use', async () => {
    const historical = await roundTrip('pre-offboard')
    expect(historical.restore.executed).toBe(true)
    expect(await companyRows(historical.db)).toEqual(historical.sourceRows)
    expect(await access(historical.db, actor('member'))).toMatchObject({
      canRead: true,
      canEdit: true,
    })
    expect(
      await historical.db
        .prepare(
          "SELECT status,org_key,last_membership_mutation_id FROM organization_users WHERE id = 'membership-member'",
        )
        .first(),
    ).toEqual({
      status: 2,
      org_key: 'synthetic-org-wrapper',
      last_membership_mutation_id: null,
    })
    expect(
      await historical.db
        .prepare(
          "SELECT * FROM organization_group_users WHERE organization_user_id = 'membership-member'",
        )
        .first(),
    ).not.toBeNull()
    expect(await access(current.db, actor('member'))).toMatchObject({
      canRead: false,
    })
    expect(historical.manifest.credentialGeneration.manifestSha256).not.toBe(
      current.manifest.credentialGeneration.manifestSha256,
    )

    // A current approval cannot accidentally authorize the obsolete artifact.
    const untouched = await prepareResource(
      join(dirname(historical.target.root), 'mismatched-target'),
      'mismatched',
    )
    await expect(
      runBackup(
        restoreArgs(historical.backup, untouched, {
          manifestSha256: historical.manifestSha256,
          generationSha256:
            current.manifest.credentialGeneration.manifestSha256,
        }),
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'Backup credential generation SHA-256 mismatch',
      ),
    })
    const { db, bucket } = await openResource(untouched)
    expect(
      await db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE name = 'organization_users'",
        )
        .first(),
    ).toBeNull()
    expect((await bucket.list()).objects).toEqual([])
  }, 120_000)
})

function actor(userId: string): OrganizationPolicyActor {
  return {
    userId,
    sessionId: `${userId}-session`,
    deviceIdentifier: `${userId}-device`,
  }
}

function access(db: D1Database, requested: OrganizationPolicyActor) {
  return resolveCipherAccess(db, requested.userId, 'shared-cipher', requested)
}

function digest(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

async function runBackup(args: string[]) {
  return execFileAsync(process.execPath, [backupScript, ...args], {
    cwd: repoRoot,
    env: environment,
    timeout: 90_000,
    maxBuffer: 16 * 1024 * 1024,
  })
}

function restoreArgs(
  backup: string,
  target: Resource,
  pins: { manifestSha256: string; generationSha256: string },
) {
  return [
    'restore',
    '--from',
    backup,
    '--mode',
    'local',
    '--database',
    target.databaseName,
    '--bucket',
    target.bucketName,
    '--config',
    target.config,
    '--persist-to',
    target.persist,
    '--expected-manifest-sha256',
    pins.manifestSha256,
    '--expected-generation-manifest-sha256',
    pins.generationSha256,
    '--execute',
    '--confirm-fresh-target',
  ]
}

async function roundTrip(
  stage: 'pre-offboard' | 'post-offboard',
): Promise<RoundTrip> {
  const temporary = join(repoRoot, 'test/.tmp')
  await mkdir(temporary, { recursive: true })
  const root = await mkdtemp(join(temporary, `company-backup-${stage}-`))
  runRoots.push(root)
  await chmod(root, 0o700)
  const source = await prepareResource(join(root, 'source'), 'source')
  const target = await prepareResource(join(root, 'target'), 'target')
  expect(source.databaseId).not.toBe(target.databaseId)
  expect(source.bucketName).not.toBe(target.bucketName)
  const opened = await openResource(source)
  await migrate(opened.instance)
  await seed(opened.db)
  await opened.bucket.put(objectKey, objectBody)
  if (stage === 'post-offboard') {
    expect(
      await revokeOrganizationMember(opened.db, {
        organizationId: 'org',
        actorUserId: 'owner',
        sessionId: 'owner-session',
        deviceIdentifier: 'owner-device',
        membershipId: 'membership-member',
        now: later,
        auditEvent: buildAuditEvent({
          name: 'organization.member.revoke',
          outcome: 'success',
          requestId: 'synthetic-company-offboard',
          occurredAt: later,
          actor: { userId: 'owner', deviceIdentifier: 'owner-device' },
          target: { type: 'organization_user', id: 'membership-member' },
          context: { organizationId: 'org' },
        }),
      }),
    ).toEqual({ status: 'success' })
  }
  const sourceSchema = await schema(opened.db)
  const sourceRows = await companyRows(opened.db)
  await opened.instance.dispose()
  instances.delete(opened.instance)
  const state = (await import(
    pathToFileURL(
      join(repoRoot, 'scripts/honowarden-credential-lifecycle-state.mjs'),
    ).href
  )) as {
    writeCredentialLifecycleCompletionAttestation: (
      path: string,
      digest: string,
    ) => Promise<unknown>
  }
  // This test attests only its synthetic completed fixture, using the existing operator helper.
  const migrations = migrationSnapshot.map(({ file, contents }) => ({
    file,
    sha256: digest(contents),
  }))
  const lifecycleDigest = digest(
    JSON.stringify({ scenario: 'company-backup-restore', stage, migrations }),
  )
  await state.writeCredentialLifecycleCompletionAttestation(
    source.persist,
    lifecycleDigest,
  )
  const inventory = join(root, 'objects.txt')
  await writeFile(inventory, `${objectKey}\n`, { mode: 0o600 })
  const backup = join(root, 'backup')
  const exported = await runBackup([
    'export',
    '--out',
    backup,
    '--database',
    source.databaseName,
    '--bucket',
    source.bucketName,
    '--mode',
    'local',
    '--config',
    source.config,
    '--persist-to',
    source.persist,
    '--generation-manifest-sha256',
    lifecycleDigest,
    '--r2-objects',
    inventory,
    '--execute',
  ])
  expect(JSON.parse(exported.stdout)).toMatchObject({ executed: true })
  const manifestBytes = await readFile(join(backup, 'backup-manifest.json'))
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as BackupManifest
  const manifestSha256 = digest(manifestBytes)
  const restored = await runBackup(
    restoreArgs(backup, target, {
      manifestSha256,
      generationSha256: manifest.credentialGeneration.manifestSha256,
    }),
  )
  const reopened = await openResource(target)
  return {
    db: reopened.db,
    bucket: reopened.bucket,
    sourceSchema,
    sourceRows,
    manifest,
    manifestSha256,
    backup,
    target,
    restore: JSON.parse(restored.stdout),
  }
}

async function prepareResource(root: string, label: string): Promise<Resource> {
  const config = join(root, 'wrangler.jsonc')
  const wrangler = join(root, '.wrangler')
  const persist = join(wrangler, 'state')
  for (const directory of [root, wrangler, persist]) {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700)
  }
  const databaseId = crypto.randomUUID()
  const databaseName = `synthetic-company-${label}`
  const bucketName = `synthetic-company-${label}-${crypto.randomUUID()}`
  await writeFile(
    config,
    JSON.stringify({
      name: `synthetic-company-${label}`,
      compatibility_date: '2026-07-21',
      d1_databases: [
        { binding: 'DB', database_name: databaseName, database_id: databaseId },
      ],
      r2_buckets: [{ binding: 'VAULT', bucket_name: bucketName }],
    }),
    { mode: 0o600 },
  )
  if (label === 'source')
    await writeFile(
      join(persist, '.honowarden-credential-lifecycle-owned'),
      '{"owner":"honowarden-credential-lifecycle"}\n',
      { mode: 0o600, flag: 'wx' },
    )
  return { root, config, persist, databaseId, databaseName, bucketName }
}

async function openResource(resource: Resource) {
  const instance = new Miniflare({
    modules: true,
    script: `export default {
      async fetch(request, env) {
        if (request.method !== 'POST') return new Response('ok');
        const migrations = await request.json();
        let applied = 0;
        for (const migration of migrations) {
          for (let index = 0; index < migration.statements.length; index++) {
            try {
              const result = await env.DB.prepare(migration.statements[index]).run();
              if (!result.success) throw new Error('Migration statement did not succeed.');
              applied++;
            } catch (error) {
              return Response.json({ file: migration.file, index, error: String(error) }, { status: 500 });
            }
          }
        }
        return Response.json({ applied });
      }
    }`,
    compatibilityDate: '2026-07-21',
    d1Databases: { DB: resource.databaseId },
    d1Persist: join(resource.persist, 'v3/d1'),
    r2Buckets: { VAULT: resource.bucketName },
    r2Persist: join(resource.persist, 'v3/r2'),
  })
  instances.add(instance)
  return {
    instance,
    db: (await instance.getD1Database('DB')) as unknown as D1Database,
    bucket: (await instance.getR2Bucket('VAULT')) as unknown as R2Bucket,
  }
}

async function migrate(instance: Miniflare) {
  const migrations: Array<{ file: string; statements: string[] }> = []
  for (const { file, contents } of migrationSnapshot) {
    const statements: string[] = []
    const lines: string[] = []
    let inTrigger = false
    for (const line of contents.split('\n')) {
      const trimmed = line.trim()
      if (lines.length === 0 && !trimmed) continue
      if (/^CREATE\s+TRIGGER\b/iu.test(trimmed)) inTrigger = true
      lines.push(line)
      if (inTrigger ? /^END;$/iu.test(trimmed) : trimmed.endsWith(';')) {
        statements.push(lines.join('\n'))
        lines.length = 0
        inTrigger = false
      }
    }
    if (lines.some((line) => line.trim()))
      throw new Error(`Incomplete migration: ${file}`)
    migrations.push({ file, statements })
  }
  // Native Worker calls preserve statement order without hundreds of Node proxy requests.
  const response = await instance.dispatchFetch('http://fixture.test/migrate', {
    method: 'POST',
    body: JSON.stringify(migrations),
  })
  const result = (await response.json()) as { applied?: number }
  if (
    !response.ok ||
    result.applied !==
      migrations.reduce(
        (count, migration) => count + migration.statements.length,
        0,
      )
  )
    throw new Error(
      `Company fixture migration bootstrap failed: ${JSON.stringify(result)}`,
    )
}

async function schema(db: D1Database) {
  return (
    await db
      .prepare(
        "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name",
      )
      .all()
  ).results
}

async function companyRows(db: D1Database) {
  const names = (
    await db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
      )
      .all<{ name: string }>()
  ).results
  const tables: Record<string, unknown[]> = {}
  for (const { name } of names)
    tables[name] = (
      await db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()
    ).results.sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right), 'en'),
    )
  return tables
}

async function seed(db: D1Database) {
  for (const userId of ['owner', 'member', 'proofless']) {
    await db
      .prepare(
        `INSERT INTO users (id,email,email_normalized,kdf_algorithm,kdf_iterations,master_password_hash,security_stamp,revision_date)
      VALUES (?,?,?,'pbkdf2-sha256',600000,'synthetic-password','synthetic-security-stamp',?)`,
      )
      .bind(userId, `${userId}@example.test`, `${userId}@example.test`, now)
      .run()
    await db
      .prepare(
        `INSERT INTO user_totp (user_id,encrypted_secret,enabled,verified_at,credential_generation)
      VALUES (?,'synthetic-encrypted-factor',1,?,?)`,
      )
      .bind(userId, now, factorGeneration)
      .run()
    await db
      .prepare(
        `INSERT INTO devices (id,user_id,identifier,session_id,mfa_totp_credential_generation,mfa_verified_at)
      VALUES (?,?,?,?,?,?)`,
      )
      .bind(
        `device-${userId}`,
        userId,
        `${userId}-device`,
        `${userId}-session`,
        userId === 'proofless' ? null : factorGeneration,
        userId === 'proofless' ? null : now,
      )
      .run()
  }
  await db
    .prepare(
      `INSERT INTO devices (id,user_id,identifier,session_id,mfa_totp_credential_generation,mfa_verified_at)
    VALUES ('device-owner-stale','owner','owner-stale-device','owner-stale-session','synthetic-obsolete-factor',?)`,
    )
    .bind(now)
    .run()
  await db
    .prepare(
      "INSERT INTO organizations (id,name,revision_date) VALUES ('org','Synthetic company',?)",
    )
    .bind(now)
    .run()
  for (const userId of ['owner', 'member', 'proofless'])
    await db
      .prepare(
        `INSERT INTO organization_users (id,organization_id,user_id,email,org_key,status,type)
      VALUES (?,'org',?,?,'synthetic-org-wrapper',2,?)`,
      )
      .bind(
        `membership-${userId}`,
        userId,
        `${userId}@example.test`,
        userId === 'owner' ? 0 : 2,
      )
      .run()
  await db
    .prepare(
      "INSERT INTO collections (id,organization_id,encrypted_name,revision_date) VALUES ('collection','org','synthetic-name',?)",
    )
    .bind(now)
    .run()
  await db
    .prepare(
      `INSERT INTO ciphers (id,user_id,type,encrypted_json,revision_date,organization_id,cipher_key)
    VALUES ('shared-cipher','owner',1,'synthetic-shared-payload',?,'org','synthetic-shared-wrapper')`,
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
      "INSERT INTO ciphers (id,user_id,type,encrypted_json,revision_date) VALUES ('personal-cipher','owner',1,'synthetic-personal-payload',?)",
    )
    .bind(now)
    .run()
  await db
    .prepare(
      `INSERT INTO cipher_attachments (id,user_id,cipher_id,object_key,file_name,attachment_key,size,revision_date)
    VALUES ('attachment','owner','personal-cipher',?,'synthetic-file-name','synthetic-attachment-key',?,?)`,
    )
    .bind(objectKey, Buffer.byteLength(objectBody), now)
    .run()
  expect(
    await updateOrganizationPolicy(db, {
      organizationId: 'org',
      actor: actor('owner'),
      enabled: true,
      now,
      requestId: 'synthetic-company-policy-enable',
    }),
  ).toMatchObject({ status: 'success', policy: { enabled: true } })
  expect(
    await createOrganizationGroup(db, {
      organizationId: 'org',
      groupId: 'group',
      actor: actor('owner'),
      now,
      name: 'Synthetic company group',
      users: ['membership-owner', 'membership-member', 'membership-proofless'],
      collections: [
        {
          id: 'collection',
          readOnly: false,
          hidePasswords: false,
          manage: false,
        },
      ],
      auditEvent: buildAuditEvent({
        name: 'organization.group.create',
        outcome: 'success',
        requestId: 'synthetic-company-group-create',
        occurredAt: now,
        actor: { userId: 'owner', deviceIdentifier: 'owner-device' },
        target: { type: 'organization_group', id: 'group' },
        context: { organizationId: 'org' },
      }),
    }),
  ).toEqual({ status: 'success' })
}

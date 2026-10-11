import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  mkdirSync,
  readdirSync,
  statSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { parse as parseJsonc } from 'jsonc-parser'

import { describe, expect, it } from 'vitest'

import {
  activeVersion,
  childEnvironment,
  parseArguments as parseReleaseArguments,
  expectedAccountSha256,
  readCredentialsFile,
  readModuleProof,
  release as releaseExecutor,
  validateSecretsFile,
} from '../../scripts/honowarden-release.mjs'

const sha = 'a'.repeat(40)
const oldVersion = '11111111-2222-4333-8444-555555555555'
const newVersion = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const migrationNames = readdirSync(join(process.cwd(), 'migrations'))
  .filter((name) => /^\d{4}[a-z]?_[a-z0-9_]+\.sql$/u.test(name))
  .sort()
const baselineNames = migrationNames.filter(
  (name) => name < '0014a_kdf_population.sql',
)
const accountId = 'a'.repeat(32)
const testAccountSha256 = createHash('sha256').update(accountId).digest('hex')
const parseArguments = (argv: string[]) => {
  const command = argv[0]
  const commit =
    ['backup-db', 'migrate-db', 'verify-db', 'activate', 'verify'].includes(
      command!,
    ) && !argv.includes('--commit')
      ? ['--commit', sha]
      : []
  const expectation =
    ['activate', 'verify'].includes(command!) &&
    !argv.includes('--expect-initial-setup')
      ? ['--expect-initial-setup', 'off']
      : []
  return parseReleaseArguments([
    ...argv,
    ...commit,
    ...expectation,
    '--credentials-file',
    '/synthetic/credentials.env',
  ])
}
const release = (
  argv: string[],
  deps: Parameters<typeof releaseExecutor>[1] & { root?: string },
) => {
  const command = argv[0]
  const commit =
    ['backup-db', 'migrate-db', 'verify-db', 'activate', 'verify'].includes(
      command!,
    ) && !argv.includes('--commit')
      ? ['--commit', sha]
      : []
  const expectation =
    ['activate', 'verify'].includes(command!) &&
    !argv.includes('--expect-initial-setup')
      ? ['--expect-initial-setup', 'off']
      : []
  const isMailer =
    argv.includes('wrangler.invitation-mailer.jsonc') ||
    argv.includes('wrangler.account-mailer.jsonc')
  const profile =
    ['activate', 'verify'].includes(command!) &&
    !isMailer &&
    !argv.includes('--profile')
      ? ['--profile', 'deploy/profiles/staging-company-launch.json']
      : []
  return releaseExecutor(
    [
      ...argv,
      ...commit,
      ...expectation,
      ...profile,
      '--credentials-file',
      join(deps?.root ?? '', 'credentials.env'),
    ],
    {
      ...deps,
      expectedAccountSha256: deps?.expectedAccountSha256 ?? testAccountSha256,
      fetch:
        deps.fetch ??
        ((input: RequestInfo | URL) => {
          if (String(input).endsWith('/workers/scripts'))
            return new Response(
              JSON.stringify({
                success: true,
                errors: [],
                result: [
                  {
                    id: argv.includes('production')
                      ? 'honowarden'
                      : 'honowarden-staging',
                    migration_tag: 'v1',
                  },
                ],
              }),
              { status: 200 },
            )
          throw new Error('unexpected synthetic Cloudflare GET')
        }),
    },
  )
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'honowarden-release-test-'))
  writeFileSync(
    join(root, 'credentials.env'),
    `CLOUDFLARE_HONOWARDEN_RELEASE_TOKEN=synthetic-token-marker\nCLOUDFLARE_ACCOUNT_ID=${accountId}\n`,
    { mode: 0o600 },
  )
  const calls: string[][] = []
  const events: string[] = []
  const runner = async (command: string, args: string[]) => {
    calls.push([command, ...args])
    events.push(`effect:${args.join(' ')}`)
    if (command === 'vite') {
      const outdir = args[args.indexOf('--outDir') + 1]!
      mkdirSync(outdir, { recursive: true })
      writeFileSync(join(outdir, 'index.html'), '<html>synthetic admin</html>')
      return { stdout: '', code: 0 }
    }
    if (command === 'git')
      return { stdout: args.includes('rev-parse') ? sha : '', code: 0 }
    if (args.includes('whoami'))
      return {
        stdout: JSON.stringify({
          loggedIn: true,
          authType: 'User API Token',
          accounts: [{ id: accountId }],
        }),
        code: 0,
      }
    if (args.includes('status'))
      return {
        stdout: JSON.stringify({
          versions: [{ version_id: oldVersion, percentage: 100 }],
        }),
        code: 0,
      }
    if (args.includes('list')) return { stdout: '[]', code: 0 }
    if (args.includes('view'))
      return {
        stdout: JSON.stringify({
          id: args.includes(oldVersion) ? oldVersion : newVersion,
          annotations: {
            'workers/tag': sha,
            'workers/message': `HonoWarden vault staging ${sha}`,
          },
          resources: {
            script_runtime: { compatibility_date: '2026-07-06' },
            bindings: args.includes(oldVersion) ? [] : vaultBindings(),
          },
        }),
        code: 0,
      }
    if (command === 'wrangler' && args.includes('execute'))
      return {
        stdout: JSON.stringify([
          { results: baselineNames.map((name) => ({ name })) },
        ]),
        code: 0,
      }
    return { stdout: '', code: 0 }
  }
  const env = {
    HOME: root,
    PATH: '/usr/bin',
    XDG_STATE_HOME: root,
    CLOUDFLARE_API_TOKEN: 'synthetic-token-marker',
    CLOUDFLARE_ACCOUNT_ID: 'b'.repeat(32),
    CLOUDFLARE_API_KEY: 'global-key-marker',
  }
  return { root, calls, events, runner, env, runId: 'test-run' }
}

function localSchemaRows() {
  const db = new DatabaseSync(':memory:')
  try {
    for (const name of migrationNames)
      db.exec(readFileSync(join(process.cwd(), 'migrations', name), 'utf8'))
    return db
      .prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT IN ('_cf_KV', 'd1_migrations') ORDER BY type, name",
      )
      .all()
  } finally {
    db.close()
  }
}

function baselineSchemaRows() {
  const db = new DatabaseSync(':memory:')
  try {
    for (const name of baselineNames)
      db.exec(readFileSync(join(process.cwd(), 'migrations', name), 'utf8'))
    return db
      .prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT IN ('_cf_KV', 'd1_migrations') ORDER BY type, name",
      )
      .all()
  } finally {
    db.close()
  }
}

function seedBackup(fx: ReturnType<typeof fixture>, complete = true) {
  const dir = join(fx.root, 'honowarden/release/staging/earlier-backup')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const backup = join(dir, 'backup.sql')
  writeFileSync(backup, 'synthetic SQL', { mode: 0o600 })
  const record = {
    at: new Date().toISOString(),
    kind: 'backup',
    commit: sha,
    bookmark: 'synthetic-bookmark',
    bytes: 13,
    sha256: createHash('sha256').update('synthetic SQL').digest('hex'),
  }
  const rows = [
    { at: record.at, kind: 'intent', operation: 'd1 export' },
    ...(complete
      ? [
          {
            at: record.at,
            kind: 'result',
            operation: 'd1 export',
            success: true,
          },
        ]
      : []),
    record,
  ]
  writeFileSync(
    join(dir, 'journal.jsonl'),
    rows.map((row) => JSON.stringify(row)).join('\n') + '\n',
    { mode: 0o600 },
  )
}

const moduleBytes = Buffer.from('export default {}')
const adminBytes = Buffer.from('<html>synthetic admin</html>')
function vaultBindings(setup = false) {
  const config = parseJsonc(
    readFileSync(join(process.cwd(), 'wrangler.jsonc'), 'utf8'),
  )
  const env = config.env.staging
  const profile = JSON.parse(
    readFileSync(
      join(process.cwd(), 'deploy/profiles/staging-company-launch.json'),
      'utf8',
    ),
  )
  return [
    ...Object.entries({
      ...env.vars,
      ...profile.vars,
      HONOWARDEN_INITIAL_SETUP_ENABLED: setup ? 'true' : 'false',
    }).map(([name, text]) => ({ name, type: 'plain_text', text })),
    ...env.d1_databases.map(
      (row: { binding: string; database_id: string }) => ({
        name: row.binding,
        type: 'd1',
        id: row.database_id,
      }),
    ),
    ...env.r2_buckets.map((row: { binding: string; bucket_name: string }) => ({
      name: row.binding,
      type: 'r2_bucket',
      bucket_name: row.bucket_name,
    })),
    ...env.services.map((row: { binding: string; service: string }) => ({
      name: row.binding,
      type: 'service',
      service: row.service,
    })),
    ...env.durable_objects.bindings.map(
      (row: { name: string; class_name: string }) => ({
        name: row.name,
        type: 'durable_object_namespace',
        class_name: row.class_name,
      }),
    ),
    { name: 'CF_VERSION_METADATA', type: 'version_metadata' },
    { name: 'ADMIN_ASSETS', type: 'assets' },
  ]
}
function seedVaultEvidence(fx: ReturnType<typeof fixture>, setup = false) {
  const dir = join(fx.root, 'honowarden/release/staging/earlier-upload')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const row = {
    at: new Date().toISOString(),
    kind: 'upload_verified',
    target: 'staging',
    version: newVersion,
    commit: sha,
    moduleSha256: createHash('sha256').update(moduleBytes).digest('hex'),
    assets: [
      {
        path: 'index.html',
        bytes: adminBytes.length,
        sha256: createHash('sha256').update(adminBytes).digest('hex'),
      },
    ],
    secretNames: [],
    profileSha256: createHash('sha256')
      .update(
        readFileSync(
          join(process.cwd(), 'deploy/profiles/staging-company-launch.json'),
        ),
      )
      .digest('hex'),
    initialSetupEnabled: setup,
    message: `HonoWarden vault staging ${sha}`,
  }
  writeFileSync(join(dir, 'journal.jsonl'), JSON.stringify(row) + '\n', {
    mode: 0o600,
  })
}
function vaultRead(input: RequestInfo | URL) {
  const url = String(input)
  let result: unknown
  if (url.includes('include=modules'))
    result = {
      id: newVersion,
      main_module: 'index.js',
      modules: [
        {
          name: 'index.js',
          content_type: 'application/javascript+module',
          content_base64: moduleBytes.toString('base64'),
        },
      ],
    }
  else if (url.endsWith('/workers/services/honowarden-staging'))
    result = { default_environment: { environment: 'production' } }
  else if (
    url.endsWith('/workers/services/honowarden-staging/environments/production')
  )
    result = { script: { migration_tag: 'v1' } }
  else if (url.endsWith('/workers/scripts'))
    result = [{ id: 'honowarden-staging', migration_tag: 'v1' }]
  else if (url.includes('/subdomain'))
    result = { enabled: false, previews_enabled: false }
  else if (url.includes('/routes?')) result = []
  else if (url.includes('/domains/records'))
    result = [{ hostname: 'vault-staging.honowarden.com' }]
  else if (url.includes('/schedules'))
    result = { schedules: [{ cron: '0 * * * *' }] }
  else if (url.includes('/script-settings'))
    result = {
      logpush: true,
      observability: { enabled: true, head_sampling_rate: 1 },
    }
  else throw Error('unexpected synthetic Cloudflare GET')
  return new Response(JSON.stringify({ success: true, result, errors: [] }), {
    status: 200,
  })
}

describe('Cloudflare release executor', () => {
  it('requires an explicit private credentials file and reviewed account pin', () => {
    expect(() =>
      parseReleaseArguments(['plan', '--target', 'staging', '--commit', sha]),
    ).toThrow('credentials_file_required')
    const source = readFileSync(
      join(process.cwd(), 'scripts/honowarden-release.mjs'),
      'utf8',
    )
    expect(source).toContain('REPLACE_WITH_ACCOUNT_SHA256')
    expect(source).toMatch(/accountIdSha256:/)
    expect(expectedAccountSha256('staging')).toMatch(/^[a-f0-9]{64}$/)
    expect(expectedAccountSha256('production')).toBe(
      expectedAccountSha256('staging'),
    )
  })

  it('recomputes migration and complete schema manifests from local SQLite', () => {
    const migrationManifest = JSON.parse(
      readFileSync(
        join(process.cwd(), 'deploy/migrations.manifest.json'),
        'utf8',
      ),
    )
    expect(migrationManifest).toEqual(
      Object.fromEntries(
        migrationNames.map((name) => [
          name,
          createHash('sha256')
            .update(readFileSync(join(process.cwd(), 'migrations', name)))
            .digest('hex'),
        ]),
      ),
    )
    const db = new DatabaseSync(':memory:')
    try {
      for (const name of migrationNames)
        db.exec(readFileSync(join(process.cwd(), 'migrations', name), 'utf8'))
      const objects = db
        .prepare(
          "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT IN ('_cf_KV', 'd1_migrations') ORDER BY type, name",
        )
        .all()
      const normalized = objects.map((row) => ({
        type: row.type,
        name: row.name,
        tbl_name: row.tbl_name,
        sqlSha256: createHash('sha256').update(String(row.sql)).digest('hex'),
      }))
      expect(
        JSON.parse(
          readFileSync(
            join(process.cwd(), 'deploy/schema.manifest.json'),
            'utf8',
          ),
        ),
      ).toEqual(normalized)
    } finally {
      db.close()
    }
  })

  it('recomputes the reviewed 0014 schema baseline including 0010a', () => {
    expect(baselineNames).toContain('0010a_inquiry_message_reconciliation.sql')
    const rows = baselineSchemaRows()
    expect(rows).toHaveLength(62)
    expect(
      JSON.parse(
        readFileSync(
          join(process.cwd(), 'deploy/schema-0014.manifest.json'),
          'utf8',
        ),
      ),
    ).toEqual(
      rows.map((row) => ({
        type: row.type,
        name: row.name,
        tbl_name: row.tbl_name,
        sqlSha256: createHash('sha256').update(String(row.sql)).digest('hex'),
      })),
    )
  })
  it('recomputes the reviewed complete schema from all 35 SQL files', () => {
    expect(migrationNames).toHaveLength(35)
    const db = new DatabaseSync(':memory:')
    try {
      for (const name of migrationNames)
        db.exec(readFileSync(join(process.cwd(), 'migrations', name), 'utf8'))
      expect(
        db
          .prepare(
            'SELECT count(*) AS n, max(version) AS version FROM schema_migrations',
          )
          .get(),
      ).toMatchObject({ n: 35, version: '0033' })
      expect(
        db
          .prepare(
            "SELECT type, count(*) AS n FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT IN ('_cf_KV', 'd1_migrations') GROUP BY type",
          )
          .all(),
      ).toMatchObject([
        { type: 'index', n: 61 },
        { type: 'table', n: 41 },
        { type: 'trigger', n: 6 },
      ])
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally {
      db.close()
    }
  })

  it('accepts a separate read-only verify-db command', () => {
    expect(
      parseArguments([
        'verify-db',
        '--target',
        'staging',
        '--expect-pending',
        '',
      ]).command,
    ).toBe('verify-db')
  })

  it('verifies complete remote D1 schema with fixed read-only SQL on DB and explicit env', async () => {
    const fx = fixture()
    const sql: string[] = []
    const runner = async (command: string, args: string[]) => {
      if (command === 'wrangler' && args.includes('execute')) {
        expect(args[args.indexOf('execute') + 1]).toBe('DB')
        expect(
          args.slice(args.indexOf('--env'), args.indexOf('--env') + 2),
        ).toEqual(['--env', 'staging'])
        const query = args[args.indexOf('--command') + 1]!
        sql.push(query)
        const results = query.includes('COUNT(*) AS n FROM d1_migrations')
          ? [{ n: 35 }]
          : query.includes('MAX(version)')
            ? [{ n: 35, version: '0033' }]
            : query.includes(
                  'SELECT type, name, tbl_name, sql FROM sqlite_master',
                )
              ? localSchemaRows()
              : query.includes('sqlite_master')
                ? [
                    { type: 'index', n: 61 },
                    { type: 'table', n: 41 },
                    { type: 'trigger', n: 6 },
                  ]
                : query.includes('foreign_key_check')
                  ? []
                  : migrationNames.map((name) => ({ name }))
        return { stdout: JSON.stringify([{ results }]), code: 0 }
      }
      return fx.runner(command, args)
    }
    await expect(
      release(['verify-db', '--target', 'staging', '--expect-pending', ''], {
        ...fx,
        runner,
        cwd: process.cwd(),
      }),
    ).resolves.toMatchObject({
      tables: 41,
      indexes: 61,
      triggers: 6,
      foreignKeyViolations: 0,
    })
    expect(sql).toHaveLength(6)
    expect(sql.at(-1)).toBe('PRAGMA foreign_key_check')
    expect(fx.calls.some((call) => call.includes('apply'))).toBe(false)
  })

  it('fails clearly when D1 rejects foreign_key_check', async () => {
    const fx = fixture()
    const runner = async (command: string, args: string[]) => {
      if (command !== 'wrangler' || !args.includes('execute'))
        return fx.runner(command, args)
      const query = args[args.indexOf('--command') + 1]!
      if (query === 'PRAGMA foreign_key_check')
        return { stdout: 'provider detail', code: 1 }
      const results = query.includes('COUNT(*) AS n FROM d1_migrations')
        ? [{ n: 35 }]
        : query.includes('MAX(version)')
          ? [{ n: 35, version: '0033' }]
          : query.includes(
                'SELECT type, name, tbl_name, sql FROM sqlite_master',
              )
            ? localSchemaRows()
            : query.includes('sqlite_master')
              ? [
                  { type: 'index', n: 61 },
                  { type: 'table', n: 41 },
                  { type: 'trigger', n: 6 },
                ]
              : migrationNames.map((name) => ({ name }))
      return { stdout: JSON.stringify([{ results }]), code: 0 }
    }
    await expect(
      release(['verify-db', '--target', 'staging', '--expect-pending', ''], {
        ...fx,
        runner,
        cwd: process.cwd(),
      }),
    ).rejects.toThrow('foreign_key_check_unavailable')
  })

  it('runs both post-deploy backfill checks through the sealed DB binding', async () => {
    const fx = fixture()
    const queries: string[] = []
    const runner = async (command: string, args: string[]) => {
      if (command !== 'wrangler' || !args.includes('execute'))
        return fx.runner(command, args)
      expect(args[args.indexOf('execute') + 1]).toBe('DB')
      expect(
        args.slice(args.indexOf('--env'), args.indexOf('--env') + 2),
      ).toEqual(['--env', 'staging'])
      const query = args[args.indexOf('--command') + 1]!
      queries.push(query)
      const results = query.includes('COUNT(*) AS n FROM d1_migrations')
        ? [{ n: 35 }]
        : query.includes('MAX(version)')
          ? [{ n: 35, version: '0033' }]
          : query.includes(
                'SELECT type, name, tbl_name, sql FROM sqlite_master',
              )
            ? localSchemaRows()
            : query.includes('sqlite_master')
              ? [
                  { type: 'index', n: 61 },
                  { type: 'table', n: 41 },
                  { type: 'trigger', n: 6 },
                ]
              : query.includes('foreign_key_check')
                ? []
                : query.includes('email_verified_at IS NULL')
                  ? [{ n: 1 }]
                  : query.includes('credential_generation IS NULL')
                    ? [{ n: 0 }]
                    : migrationNames.map((name) => ({ name }))
      return { stdout: JSON.stringify([{ results }]), code: 0 }
    }
    await expect(
      release(
        [
          'verify-db',
          '--target',
          'staging',
          '--expect-pending',
          '',
          '--post-deploy',
        ],
        { ...fx, runner, cwd: process.cwd() },
      ),
    ).rejects.toThrow('post_deploy_backfill_incomplete')
    expect(
      queries.some((query) => query.includes('email_verified_at IS NULL')),
    ).toBe(true)
    expect(
      queries.some((query) => query.includes('credential_generation IS NULL')),
    ).toBe(true)
    expect(fx.calls.some((call) => call.includes('apply'))).toBe(false)
  })

  it('rejects a changed migration manifest before touching D1', async () => {
    const fx = fixture()
    const cwd = join(fx.root, 'source')
    mkdirSync(cwd)
    mkdirSync(join(cwd, 'migrations'))
    mkdirSync(join(cwd, 'deploy'))
    writeFileSync(
      join(cwd, 'deploy/migrations.manifest.json'),
      readFileSync(join(process.cwd(), 'deploy/migrations.manifest.json')),
    )
    writeFileSync(
      join(cwd, 'wrangler.jsonc'),
      readFileSync(join(process.cwd(), 'wrangler.jsonc')),
    )
    for (const name of migrationNames)
      writeFileSync(join(cwd, 'migrations', name), '')
    writeFileSync(join(cwd, 'migrations', '0034_unreviewed.sql'), '')
    await expect(
      release(['verify-db', '--target', 'staging', '--expect-pending', ''], {
        ...fx,
        cwd,
      }),
    ).rejects.toThrow('migration_files_unreviewed')
    expect(fx.calls.some((call) => call.includes('execute'))).toBe(false)
  })

  it('rejects profile target, key and type mismatches before upload', async () => {
    const fx = fixture()
    const cwd = join(fx.root, 'source')
    mkdirSync(join(cwd, 'deploy/profiles'), { recursive: true })
    writeFileSync(
      join(cwd, 'wrangler.jsonc'),
      readFileSync(join(process.cwd(), 'wrangler.jsonc')),
    )
    const profile = join(cwd, 'deploy/profiles/test.json')
    const args = [
      'upload',
      '--target',
      'staging',
      '--commit',
      sha,
      '--expect-active',
      oldVersion,
      '--profile',
      'deploy/profiles/test.json',
      '--execute',
      '--confirm',
      'staging',
    ]
    for (const [value, reason] of [
      [{ target: 'production', vars: {} }, 'profile_target_or_shape_invalid'],
      [{ target: 'staging', vars: { UNKNOWN: 'true' } }, 'profile_var_invalid'],
      [
        { target: 'staging', vars: { HONOWARDEN_ADMIN_ENABLED: true } },
        'profile_var_invalid',
      ],
    ] as const) {
      writeFileSync(profile, JSON.stringify(value))
      await expect(release(args, { ...fx, cwd })).rejects.toThrow(reason)
    }
    expect(fx.calls).toHaveLength(0)
  })

  it('validates profile and setup flags at the argument boundary', () => {
    expect(
      parseArguments([
        'upload',
        '--target',
        'staging',
        '--commit',
        sha,
        '--expect-active',
        oldVersion,
        '--profile',
        'deploy/profiles/staging-company-launch.json',
        '--initial-setup-window',
      ]).profile,
    ).toBe('deploy/profiles/staging-company-launch.json')
    expect(() =>
      parseArguments([
        'upload',
        '--target',
        'production',
        '--commit',
        sha,
        '--expect-active',
        oldVersion,
        '--initial-setup-window',
      ]),
    ).toThrow('target_confirmation_required')
  })

  it('tracks an independently targeted production launch profile in the same source commit', () => {
    const staging = JSON.parse(
      readFileSync(
        join(process.cwd(), 'deploy/profiles/staging-company-launch.json'),
        'utf8',
      ),
    )
    const production = JSON.parse(
      readFileSync(
        join(process.cwd(), 'deploy/profiles/production-company-launch.json'),
        'utf8',
      ),
    )
    expect(production.target).toBe('production')
    expect(production.vars).toEqual(staging.vars)
    expect(production.vars.HONOWARDEN_AUTH_REQUESTS_ENABLED).toBe('false')
  })

  it('generates only absent private secrets without overwriting', async () => {
    const fx = fixture()
    const out = join(fx.root, 'generated.json')
    const result = await release(
      [
        'generate-secrets',
        '--target',
        'staging',
        '--out',
        out,
        '--execute',
        '--confirm',
        'staging',
      ],
      { ...fx, cwd: process.cwd() },
    )
    expect(result).toMatchObject({ path: out })
    expect(statSync(out).mode & 0o777).toBe(0o600)
    expect(validateSecretsFile(out, 'vault', 'staging').names).toHaveLength(5)
    const generated = JSON.parse(readFileSync(out, 'utf8'))
    expect(generated.target).toBe('staging')
    const visible =
      JSON.stringify(result) +
      readFileSync(
        join(fx.root, 'honowarden/release/staging/test-run/journal.jsonl'),
        'utf8',
      )
    for (const value of Object.values(generated.secrets) as string[]) {
      expect(value.length).toBeGreaterThanOrEqual(32)
      expect(visible).not.toContain(value)
    }
    expect(generated.secrets.HONOWARDEN_BOOTSTRAP_TOKEN).toMatch(
      /^[!-~]{32,512}$/,
    )
    await expect(
      release(
        [
          'generate-secrets',
          '--target',
          'staging',
          '--out',
          out,
          '--execute',
          '--confirm',
          'staging',
        ],
        { ...fx, runId: 'second-run', cwd: process.cwd() },
      ),
    ).rejects.toThrow('secret_output_exists_or_unwritable')
    expect(fx.calls.some((call) => call.includes('view'))).toBe(true)
  })

  it('generates a one-key account mail keyring with canonical unpadded base64url', async () => {
    const fx = fixture()
    const out = join(fx.root, 'account.json')
    await release(
      [
        'generate-secrets',
        '--target',
        'staging',
        '--config',
        'wrangler.account-mailer.jsonc',
        '--out',
        out,
        '--execute',
        '--confirm',
        'staging',
      ],
      {
        ...fx,
        cwd: process.cwd(),
        fetch: async () =>
          new Response(
            JSON.stringify({
              success: true,
              result: { id: 'synthetic' },
              errors: [],
            }),
            { status: 200 },
          ),
      },
    )
    expect(validateSecretsFile(out, 'account', 'staging').names).toEqual([
      'HONOWARDEN_ACCOUNT_MAIL_ENCRYPTION_KEYS',
    ])
    const keys = JSON.parse(
      JSON.parse(readFileSync(out, 'utf8')).secrets
        .HONOWARDEN_ACCOUNT_MAIL_ENCRYPTION_KEYS,
    )
    expect(Object.keys(keys)).toEqual(['account-mail-1'])
    expect(keys['account-mail-1']).toMatch(
      /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/,
    )
    expect(Buffer.from(keys['account-mail-1'], 'base64url')).toHaveLength(32)
  })

  it('accepts only two private credential entries and ignores the parent account', async () => {
    const fx = fixture()
    const file = join(fx.root, 'credentials.env')
    expect(readCredentialsFile(file).accountId).toBe(accountId)
    chmodSync(file, 0o644)
    expect(() => readCredentialsFile(file)).toThrow(
      'credentials_file_permissions',
    )
    chmodSync(file, 0o600)
    writeFileSync(
      file,
      `CLOUDFLARE_HONOWARDEN_RELEASE_TOKEN=synthetic-token-marker\nCLOUDFLARE_ACCOUNT_ID=${accountId}\nCLOUDFLARE_API_KEY=forbidden\n`,
    )
    expect(() => readCredentialsFile(file)).toThrow('credentials_file_shape')
    writeFileSync(
      file,
      `CLOUDFLARE_HONOWARDEN_RELEASE_TOKEN=synthetic-token-marker\nCLOUDFLARE_ACCOUNT_ID=${accountId}\n`,
    )
    const observed: Record<string, string>[] = []
    const runner = async (
      command: string,
      args: string[],
      opts: { env: Record<string, string> },
    ) => {
      if (command === 'wrangler') observed.push(opts.env)
      return fx.runner(command, args)
    }
    await release(['plan', '--target', 'staging', '--commit', sha], {
      ...fx,
      runner,
      cwd: process.cwd(),
    })
    expect(observed.length).toBeGreaterThan(0)
    for (const env of observed) {
      expect(env.CLOUDFLARE_ACCOUNT_ID).toBe(accountId)
      expect(env.CLOUDFLARE_API_TOKEN).toBe('synthetic-token-marker')
      expect(
        Object.keys(env)
          .filter((key) => /^(?:CF_|CLOUDFLARE_)/u.test(key))
          .sort(),
      ).toEqual([
        'CLOUDFLARE_ACCOUNT_ID',
        'CLOUDFLARE_API_TOKEN',
        'CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV',
      ])
    }
  })

  it('generates a missing mailer key before its first deploy after proving the Worker absent', async () => {
    const fx = fixture()
    const out = join(fx.root, 'first-account-mail.json')
    const runner = async (command: string, args: string[]) => {
      if (command === 'wrangler' && args.includes('status'))
        return { stdout: '', code: 1 }
      return fx.runner(command, args)
    }
    const fetcher = async (input: RequestInfo | URL) => {
      expect(String(input)).toContain(
        '/workers/scripts/honowarden-account-mailer-staging',
      )
      return new Response(
        JSON.stringify({ success: false, errors: [{ code: 10007 }] }),
        { status: 404 },
      )
    }
    await expect(
      release(
        [
          'generate-secrets',
          '--target',
          'staging',
          '--config',
          'wrangler.account-mailer.jsonc',
          '--out',
          out,
          '--execute',
          '--confirm',
          'staging',
        ],
        {
          ...fx,
          runner,
          fetch: fetcher,
          cwd: process.cwd(),
        },
      ),
    ).resolves.toMatchObject({
      names: ['HONOWARDEN_ACCOUNT_MAIL_ENCRYPTION_KEYS'],
    })
  })

  it('never regenerates existing vault signing or TOTP secrets', async () => {
    const fx = fixture()
    const out = join(fx.root, 'missing-vault.json')
    const runner = async (command: string, args: string[]) => {
      if (command === 'wrangler' && args.includes('view'))
        return {
          stdout: JSON.stringify({
            id: oldVersion,
            resources: {
              bindings: [
                'HONOWARDEN_TOKEN_SECRET',
                'HONOWARDEN_TOTP_SECRET',
                'HONOWARDEN_ACCESS_TOKEN_CURRENT',
              ].map((name) => ({ name, type: 'secret_text' })),
            },
          }),
          code: 0,
        }
      return fx.runner(command, args)
    }
    const result = (await release(
      [
        'generate-secrets',
        '--target',
        'staging',
        '--out',
        out,
        '--execute',
        '--confirm',
        'staging',
      ],
      { ...fx, runner, cwd: process.cwd() },
    )) as { names: string[] }
    expect(result.names).not.toContain('HONOWARDEN_TOKEN_SECRET')
    expect(result.names).not.toContain('HONOWARDEN_TOTP_SECRET')
    expect(Object.keys(JSON.parse(readFileSync(out, 'utf8')).secrets)).toEqual(
      result.names,
    )
  })

  it('refuses a multi-account token even when the pinned account is visible', async () => {
    const fx = fixture()
    const runner = async (command: string, args: string[]) =>
      args.includes('whoami')
        ? {
            stdout: JSON.stringify({
              loggedIn: true,
              authType: 'User API Token',
              accounts: [{ id: accountId }, { id: 'b'.repeat(32) }],
            }),
            code: 0,
          }
        : fx.runner(command, args)
    await expect(
      release(['plan', '--target', 'staging', '--commit', sha], {
        ...fx,
        runner,
        cwd: process.cwd(),
      }),
    ).rejects.toThrow('account_mismatch')
    expect(
      fx.calls.some(
        (call) => call[0] === 'wrangler' && call.includes('status'),
      ),
    ).toBe(false)
  })

  it('refuses an account hash mismatch before any provider read without printing the ID', async () => {
    const fx = fixture()
    await expect(
      release(['plan', '--target', 'staging', '--commit', sha], {
        ...fx,
        expectedAccountSha256: 'f'.repeat(64),
        cwd: process.cwd(),
      }),
    ).rejects.toThrow('account_pin_unconfigured_or_mismatch')
    expect(fx.calls).toHaveLength(0)
  })
  it('requires exact target confirmation for all mutations, including production', () => {
    expect(() =>
      parseArguments([
        'activate',
        '--target',
        'staging',
        '--version',
        newVersion,
        '--expect-active',
        oldVersion,
        '--execute',
      ]),
    ).toThrow()
    expect(() =>
      parseArguments([
        'activate',
        '--target',
        'production',
        '--version',
        newVersion,
        '--expect-active',
        oldVersion,
        '--execute',
        '--confirm',
        'staging',
      ]),
    ).toThrow()
    expect(
      parseArguments([
        'activate',
        '--target',
        'production',
        '--version',
        newVersion,
        '--expect-active',
        oldVersion,
        '--execute',
        '--confirm',
        'production',
      ]).target,
    ).toBe('production')
  })

  it('only permits a single 100 percent predecessor', () => {
    expect(
      activeVersion({
        versions: [{ version_id: oldVersion, percentage: 100 }],
      }),
    ).toBe(oldVersion)
    expect(() =>
      activeVersion({
        versions: [
          { version_id: oldVersion, percentage: 50 },
          { version_id: newVersion, percentage: 50 },
        ],
      }),
    ).toThrow()
  })

  it('does not pass break glass credentials or ambient dotenv controls to Wrangler', () => {
    const fx = fixture()
    const child = childEnvironment(fx.env, join(fx.root, 'output.jsonl'), {
      token: 'synthetic-token-marker',
      accountId,
    })
    expect(child).not.toHaveProperty('CLOUDFLARE_API_KEY')
    expect(child).not.toHaveProperty('CLOUDFLARE_GLOBAL_API_KEY')
    expect(child).not.toHaveProperty('CLOUDFLARE_EMAIL')
    expect(child).not.toHaveProperty('CLOUDFLARE_API_EMAIL')
    expect(child.CLOUDFLARE_API_TOKEN).toBe('synthetic-token-marker')
    expect(child.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV).toBe('false')
    expect(child.WRANGLER_WRITE_LOGS).toBe('false')
  })

  it('rejects secrets with broad mode or unknown names without returning their values', () => {
    const fx = fixture()
    const file = join(fx.root, 'synthetic.json')
    writeFileSync(
      file,
      JSON.stringify({
        target: 'staging',
        secrets: { HONOWARDEN_TOKEN_SECRET: 'private-marker' },
      }),
    )
    chmodSync(file, 0o644)
    expect(() => validateSecretsFile(file, 'vault', 'staging')).toThrow(
      'secret_file_mode',
    )
    chmodSync(file, 0o600)
    expect(validateSecretsFile(file, 'vault', 'staging').names).toEqual([
      'HONOWARDEN_TOKEN_SECRET',
    ])
    writeFileSync(
      file,
      JSON.stringify({
        target: 'staging',
        secrets: { UNKNOWN_SECRET: 'private-marker' },
      }),
    )
    expect(() => validateSecretsFile(file, 'vault', 'staging')).toThrow(
      'secret_name_not_allowed',
    )
    writeFileSync(
      file,
      '{"target":"staging","secrets":{"HONOWARDEN_TOKEN_SECRET":"one","HONOWARDEN_TOKEN_SECRET":"two"}}',
    )
    expect(() => validateSecretsFile(file, 'vault', 'staging')).toThrow(
      'secret_file_duplicate_name',
    )
  })

  it('binds secret input to the target and refuses predecessor reuse or TOTP rotation', async () => {
    const fx = fixture()
    const file = join(fx.root, 'synthetic.json')
    const marker = 'synthetic-secret-value'
    const runner = async (command: string, args: string[]) => {
      if (command === 'wrangler' && args.includes('view'))
        return {
          stdout: JSON.stringify({
            id: oldVersion,
            resources: {
              bindings: [
                { name: 'HONOWARDEN_TOTP_SECRET', type: 'secret_text' },
              ],
            },
          }),
          code: 0,
        }
      return fx.runner(command, args)
    }
    const base = [
      'upload',
      '--target',
      'staging',
      '--commit',
      sha,
      '--expect-active',
      oldVersion,
      '--secrets-file',
      file,
      '--execute',
      '--confirm',
      'staging',
    ]
    writeFileSync(
      file,
      JSON.stringify({
        target: 'production',
        secrets: { HONOWARDEN_TOTP_SECRET: marker },
      }),
      { mode: 0o600 },
    )
    await expect(
      release(base, { ...fx, runner, cwd: process.cwd() }),
    ).rejects.toThrow('secret_file_target_or_shape')
    writeFileSync(
      file,
      JSON.stringify({
        target: 'staging',
        secrets: { HONOWARDEN_TOTP_SECRET: marker },
      }),
    )
    await expect(
      release(base, { ...fx, runner, runId: 'second', cwd: process.cwd() }),
    ).rejects.toThrow('secret_already_present')
    await expect(
      release([...base, '--rotate', 'HONOWARDEN_TOTP_SECRET'], {
        ...fx,
        runner,
        runId: 'third',
        cwd: process.cwd(),
      }),
    ).rejects.toThrow('totp_rotation_requires_rewrap')
    expect(fx.calls.some((call) => call.includes('upload'))).toBe(false)
    for (const runId of ['test-run', 'second', 'third'])
      expect(
        readFileSync(
          join(fx.root, `honowarden/release/staging/${runId}/journal.jsonl`),
          'utf8',
        ),
      ).not.toContain(marker)
  })

  it('requires exact migration filenames in the expected list', () => {
    expect(() =>
      parseArguments([
        'migrate-db',
        '--target',
        'staging',
        '--expect-pending',
        '../bad.sql',
      ]),
    ).toThrow('expected_migrations_invalid')
  })

  it('refuses activation drift before a deploy call', async () => {
    const fx = fixture()
    await expect(
      release(
        [
          'activate',
          '--target',
          'staging',
          '--version',
          newVersion,
          '--expect-active',
          newVersion,
          '--execute',
          '--confirm',
          'staging',
        ],
        { ...fx, cwd: process.cwd() },
      ),
    ).rejects.toThrow('predecessor_drift')
    expect(fx.calls.some((call) => call.includes('deploy'))).toBe(false)
  })

  it('refuses account mismatch before any write', async () => {
    const fx = fixture()
    const runner = async (command: string, args: string[]) =>
      args.includes('whoami')
        ? {
            stdout: JSON.stringify({
              loggedIn: true,
              authType: 'Account API Token',
              accounts: [{ id: 'b'.repeat(32) }],
            }),
            code: 0,
          }
        : fx.runner(command, args)
    await expect(
      release(
        [
          'activate',
          '--target',
          'staging',
          '--version',
          newVersion,
          '--expect-active',
          oldVersion,
          '--execute',
          '--confirm',
          'staging',
        ],
        { ...fx, runner, cwd: process.cwd() },
      ),
    ).rejects.toThrow('account_mismatch')
    expect(fx.calls.some((call) => call.includes('deploy'))).toBe(false)
  })

  it('refuses dirty source and SHA mismatch before Wrangler upload', async () => {
    const args = [
      'upload',
      '--target',
      'staging',
      '--commit',
      sha,
      '--expect-active',
      oldVersion,
      '--execute',
      '--confirm',
      'staging',
    ]
    for (const gitResult of [' M src/index.ts', 'b'.repeat(40)]) {
      const fx = fixture()
      const runner = async (command: string, parts: string[]) =>
        command === 'git'
          ? {
              stdout: parts.includes('status')
                ? gitResult.startsWith(' M')
                  ? gitResult
                  : ''
                : gitResult,
              code: 0,
            }
          : fx.runner(command, parts)
      await expect(
        release(args, { ...fx, runner, cwd: process.cwd() }),
      ).rejects.toThrow(
        gitResult.startsWith(' M') ? 'worktree_dirty' : 'commit_mismatch',
      )
      expect(fx.calls.some((call) => call[0] === 'wrangler')).toBe(false)
    }
  })

  it('binds backup, migrate, and schema verification to a clean exact commit', async () => {
    for (const command of ['backup-db', 'migrate-db', 'verify-db']) {
      const fx = fixture()
      const runner = async (program: string, args: string[]) =>
        program === 'git'
          ? {
              stdout: args.includes('status')
                ? ' M migrations/0033_initial_setup.sql'
                : sha,
              code: 0,
            }
          : fx.runner(program, args)
      const args = [
        command,
        '--target',
        'staging',
        '--commit',
        sha,
        ...(command === 'backup-db' ? [] : ['--expect-pending', '']),
        ...(command === 'verify-db'
          ? []
          : ['--execute', '--confirm', 'staging']),
      ]
      await expect(
        release(args, { ...fx, runner, cwd: process.cwd() }),
      ).rejects.toThrow('worktree_dirty')
      expect(fx.calls.some((call) => call[0] === 'wrangler')).toBe(false)
    }
  })

  it('binds production upload to the staging accepted main-module digest', async () => {
    const fx = fixture()
    seedVaultEvidence(fx)
    const adminManifest = join(
      fx.root,
      'honowarden/release/staging/earlier-upload/journal.jsonl',
    )
    const runner = async (command: string, args: string[]) => {
      if (
        command === 'wrangler' &&
        args.includes('upload') &&
        args.includes('--dry-run')
      ) {
        const outdir = args[args.indexOf('--outdir') + 1]!
        mkdirSync(outdir)
        writeFileSync(
          join(outdir, 'index.js'),
          'export default { changed: true }',
        )
        return { stdout: '', code: 0 }
      }
      return fx.runner(command, args)
    }
    await expect(
      release(
        [
          'upload',
          '--target',
          'production',
          '--commit',
          sha,
          '--expect-active',
          oldVersion,
          '--expect-module-sha256',
          createHash('sha256').update(moduleBytes).digest('hex'),
          '--expect-admin-manifest',
          adminManifest,
          '--execute',
          '--confirm',
          'production',
        ],
        { ...fx, runner, cwd: process.cwd() },
      ),
    ).rejects.toThrow('production_module_digest_mismatch')
    expect(
      fx.calls.some(
        (call) => call.includes('upload') && !call.includes('--dry-run'),
      ),
    ).toBe(false)
  })

  it('requires matching staging admin bytes for production vault upload', async () => {
    const fx = fixture()
    seedVaultEvidence(fx)
    const adminManifest = join(
      fx.root,
      'honowarden/release/staging/earlier-upload/journal.jsonl',
    )
    const accepted = JSON.parse(readFileSync(adminManifest, 'utf8'))
    accepted.assets[0].sha256 = '0'.repeat(64)
    writeFileSync(adminManifest, JSON.stringify(accepted) + '\n', {
      mode: 0o600,
    })
    await expect(
      release(
        [
          'upload',
          '--target',
          'production',
          '--commit',
          sha,
          '--expect-active',
          oldVersion,
          '--expect-module-sha256',
          createHash('sha256').update(moduleBytes).digest('hex'),
          '--expect-admin-manifest',
          adminManifest,
          '--execute',
          '--confirm',
          'production',
        ],
        { ...fx, cwd: process.cwd() },
      ),
    ).rejects.toThrow('production_admin_manifest_mismatch')
    expect(fx.calls.some((call) => call.includes('upload'))).toBe(false)
    expect(() =>
      parseArguments([
        'first-deploy',
        '--target',
        'production',
        '--config',
        'wrangler.account-mailer.jsonc',
        '--commit',
        sha,
      ]),
    ).toThrow('expected_module_sha256_required')
  })

  it('refuses a vault upload before Wrangler can replay a changed DO migration', async () => {
    const fx = fixture()
    let writes = 0
    const runner = async (command: string, args: string[]) => {
      if (
        command === 'wrangler' &&
        args.includes('upload') &&
        !args.includes('--dry-run')
      )
        writes++
      return fx.runner(command, args)
    }
    const fetcher = (input: RequestInfo | URL) =>
      String(input).endsWith('/workers/scripts')
        ? new Response(
            JSON.stringify({
              success: true,
              errors: [],
              result: [{ id: 'honowarden-staging', migration_tag: 'v0' }],
            }),
            { status: 200 },
          )
        : vaultRead(input)
    await expect(
      release(
        [
          'upload',
          '--target',
          'staging',
          '--commit',
          sha,
          '--expect-active',
          oldVersion,
          '--execute',
          '--confirm',
          'staging',
        ],
        { ...fx, runner, fetch: fetcher, cwd: process.cwd() },
      ),
    ).rejects.toThrow('durable_object_migration_mismatch')
    expect(writes).toBe(0)
  })

  it.each(['upload', 'first-deploy'] as const)(
    'binds production account mailer %s to the staging bundle digest',
    async (commandName) => {
      const fx = fixture()
      const secretFile = join(fx.root, 'account-secret.json')
      writeFileSync(
        secretFile,
        JSON.stringify({
          target: 'production',
          secrets: {
            HONOWARDEN_ACCOUNT_MAIL_ENCRYPTION_KEYS: 'synthetic-private-marker',
          },
        }),
        { mode: 0o600 },
      )
      let writes = 0
      const runner = async (command: string, args: string[]) => {
        if (command === 'wrangler' && args.includes('--dry-run')) {
          const outdir = args[args.indexOf('--outdir') + 1]!
          mkdirSync(outdir)
          writeFileSync(join(outdir, 'index.js'), moduleBytes)
          return { stdout: '', code: 0 }
        }
        if (
          command === 'wrangler' &&
          args.includes('view') &&
          args.includes(oldVersion)
        )
          return {
            stdout: JSON.stringify({
              id: oldVersion,
              resources: {
                bindings: [
                  {
                    name: 'HONOWARDEN_ACCOUNT_MAIL_ENCRYPTION_KEYS',
                    type: 'secret_text',
                  },
                ],
              },
            }),
            code: 0,
          }
        if (
          command === 'wrangler' &&
          ((args[0] === 'deploy' && !args.includes('--dry-run')) ||
            (args.includes('upload') && !args.includes('--dry-run')))
        )
          writes++
        return fx.runner(command, args)
      }
      await expect(
        release(
          [
            commandName,
            '--target',
            'production',
            '--config',
            'wrangler.account-mailer.jsonc',
            '--commit',
            sha,
            ...(commandName === 'upload'
              ? ['--expect-active', oldVersion]
              : ['--secrets-file', secretFile]),
            '--expect-module-sha256',
            '0'.repeat(64),
            '--execute',
            '--confirm',
            'production',
          ],
          {
            ...fx,
            runner,
            cwd: process.cwd(),
            fetch: async () => new Response('', { status: 404 }),
          },
        ),
      ).rejects.toThrow('production_module_digest_mismatch')
      expect(writes).toBe(0)
    },
  )

  it('refuses target identity drift and missing mailer configuration before a read', async () => {
    const fx = fixture()
    const cwd = join(fx.root, 'source')
    mkdirSync(cwd)
    const original = readFileSync(join(process.cwd(), 'wrangler.jsonc'), 'utf8')
    writeFileSync(
      join(cwd, 'wrangler.jsonc'),
      original.replace('vault-staging.honowarden.com', 'wrong.example'),
    )
    await expect(
      release(['plan', '--target', 'staging', '--commit', sha], { ...fx, cwd }),
    ).rejects.toThrow('target_identity_mismatch')
    await expect(
      release(
        [
          'ensure-queues',
          '--target',
          'staging',
          '--config',
          'wrangler.account-mailer.jsonc',
          '--execute',
          '--confirm',
          'staging',
        ],
        { ...fx, cwd },
      ),
    ).rejects.toThrow('config_missing')
    expect(fx.calls).toHaveLength(0)
  })

  it('rejects a singular route on an effectively private mailer config', async () => {
    const fx = fixture()
    const cwd = join(fx.root, 'source')
    mkdirSync(cwd)
    const config = parseJsonc(
      readFileSync(
        join(process.cwd(), 'wrangler.account-mailer.jsonc'),
        'utf8',
      ),
    )
    config.route = 'public.example.test/*'
    writeFileSync(
      join(cwd, 'wrangler.account-mailer.jsonc'),
      JSON.stringify(config),
    )
    await expect(
      release(
        [
          'plan',
          '--target',
          'staging',
          '--commit',
          sha,
          '--config',
          'wrangler.account-mailer.jsonc',
        ],
        { ...fx, cwd },
      ),
    ).rejects.toThrow('mailer_effective_exposure')
  })

  it('refuses a vault config missing either reviewed mailer service binding', async () => {
    const fx = fixture()
    const cwd = join(fx.root, 'source')
    mkdirSync(cwd)
    const original = readFileSync(join(process.cwd(), 'wrangler.jsonc'), 'utf8')
    const config = parseJsonc(original)
    config.env.staging.services = config.env.staging.services.slice(0, 1)
    writeFileSync(join(cwd, 'wrangler.jsonc'), JSON.stringify(config))
    await expect(
      release(
        [
          'upload',
          '--target',
          'staging',
          '--commit',
          sha,
          '--expect-active',
          oldVersion,
          '--execute',
          '--confirm',
          'staging',
        ],
        { ...fx, cwd },
      ),
    ).rejects.toThrow('target_identity_mismatch')
    expect(fx.calls).toHaveLength(0)
  })

  it('keeps the effective mailer configs free of public and storage bindings', () => {
    for (const file of [
      'wrangler.invitation-mailer.jsonc',
      'wrangler.account-mailer.jsonc',
    ]) {
      const config = parseJsonc(readFileSync(join(process.cwd(), file), 'utf8'))
      for (const target of ['staging', 'production']) {
        const env = config.env[target]
        for (const field of [
          'routes',
          'assets',
          'triggers',
          'd1_databases',
          'r2_buckets',
          'kv_namespaces',
          'durable_objects',
        ]) {
          const effective = env[field] ?? config[field]
          expect(
            effective === undefined ||
              (Array.isArray(effective)
                ? effective.length === 0
                : Object.keys(effective).length === 0),
            `${file} ${target} ${field}`,
          ).toBe(true)
        }
      }
    }
  })

  it('refuses pending migration drift before apply', async () => {
    const fx = fixture()
    await expect(
      release(
        [
          'migrate-db',
          '--target',
          'staging',
          '--expect-pending',
          '0033_initial_setup.sql',
          '--execute',
          '--confirm',
          'staging',
        ],
        { ...fx, cwd: process.cwd() },
      ),
    ).rejects.toThrow('pending_migrations_drift')
    expect(fx.calls.some((call) => call.includes('apply'))).toBe(false)
    expect(
      fx.calls.some(
        (call) =>
          call.includes('execute') &&
          call.includes('--remote') &&
          call.includes('--json'),
      ),
    ).toBe(true)
  })

  it('requires a fresh verified backup before migration apply', async () => {
    const fx = fixture()
    const runner = async (command: string, args: string[]) => {
      if (command === 'wrangler' && args.includes('execute'))
        return {
          stdout: JSON.stringify([
            { results: baselineNames.map((name) => ({ name })) },
          ]),
          code: 0,
        }
      return fx.runner(command, args)
    }
    await expect(
      release(
        [
          'migrate-db',
          '--target',
          'staging',
          '--expect-pending',
          migrationNames.slice(baselineNames.length).join(','),
          '--execute',
          '--confirm',
          'staging',
        ],
        {
          ...fx,
          runner,
          cwd: process.cwd(),
        },
      ),
    ).rejects.toThrow('recent_verified_backup_required')
    expect(fx.calls.some((call) => call.includes('apply'))).toBe(false)
  })

  it('rejects a hashed backup file without a successful export result', async () => {
    const fx = fixture()
    seedBackup(fx, false)
    const runner = async (command: string, args: string[]) => {
      if (command === 'wrangler' && args.includes('execute'))
        return {
          stdout: JSON.stringify([
            { results: baselineNames.map((name) => ({ name })) },
          ]),
          code: 0,
        }
      return fx.runner(command, args)
    }
    await expect(
      release(
        [
          'migrate-db',
          '--target',
          'staging',
          '--expect-pending',
          migrationNames.slice(baselineNames.length).join(','),
          '--execute',
          '--confirm',
          'staging',
        ],
        {
          ...fx,
          runner,
          cwd: process.cwd(),
        },
      ),
    ).rejects.toThrow('recent_verified_backup_required')
  })

  it('rejects a remote object SQL mismatch even when schema counts match', async () => {
    const fx = fixture()
    const runner = async (command: string, args: string[]) => {
      if (command !== 'wrangler' || !args.includes('execute'))
        return fx.runner(command, args)
      const query = args[args.indexOf('--command') + 1]!
      const results = query.includes('COUNT(*) AS n FROM d1_migrations')
        ? [{ n: 35 }]
        : query.includes('MAX(version)')
          ? [{ n: 35, version: '0033' }]
          : query.includes(
                'SELECT type, name, tbl_name, sql FROM sqlite_master',
              )
            ? localSchemaRows().map((row, index) =>
                index === 0 ? { ...row, sql: `${row.sql} /* drift */` } : row,
              )
            : query.includes('sqlite_master')
              ? [
                  { type: 'index', n: 61 },
                  { type: 'table', n: 41 },
                  { type: 'trigger', n: 6 },
                ]
              : migrationNames.map((name) => ({ name }))
      return { stdout: JSON.stringify([{ results }]), code: 0 }
    }
    await expect(
      release(['verify-db', '--target', 'staging', '--expect-pending', ''], {
        ...fx,
        runner,
        cwd: process.cwd(),
      }),
    ).rejects.toThrow('schema_object_mismatch')
  })

  it('holds a per-target exclusive lock before commands run', async () => {
    const fx = fixture()
    const targetDir = join(fx.root, 'honowarden/release/staging')
    mkdirSync(targetDir, { recursive: true, mode: 0o700 })
    writeFileSync(join(targetDir, '.lock'), 'held')
    await expect(
      release(
        [
          'activate',
          '--target',
          'staging',
          '--version',
          newVersion,
          '--expect-active',
          oldVersion,
          '--execute',
          '--confirm',
          'staging',
        ],
        { ...fx, cwd: process.cwd() },
      ),
    ).rejects.toThrow('release_lock_held')
    expect(fx.calls).toHaveLength(0)
  })

  it('prints only a plan without confirmation and without contacting Wrangler', async () => {
    const fx = fixture()
    const result = await release(
      [
        'upload',
        '--target',
        'staging',
        '--commit',
        sha,
        '--expect-active',
        oldVersion,
      ],
      { ...fx, cwd: process.cwd() },
    )
    expect(result).toMatchObject({
      plan: { target: 'staging', worker: 'honowarden-staging' },
      execute: false,
    })
    expect(fx.calls).toHaveLength(0)
  })

  it('reads a clean exact-commit plan with scoped account, deployment and pending migrations', async () => {
    const fx = fixture()
    await expect(
      release(['plan', '--target', 'staging', '--commit', sha], {
        ...fx,
        cwd: process.cwd(),
      }),
    ).resolves.toMatchObject({
      worker: 'honowarden-staging',
      database: 'honowarden-staging',
      activeVersion: oldVersion,
      pendingMigrations: migrationNames.filter(
        (name) => !baselineNames.includes(name),
      ),
    })
    expect(
      fx.calls.some(
        (call) =>
          call.includes('deployments') &&
          call.includes('status') &&
          call.includes('--json'),
      ),
    ).toBe(true)
    expect(
      fx.calls.some(
        (call) =>
          call.includes('d1') &&
          call.includes('execute') &&
          call.includes('--remote'),
      ),
    ).toBe(true)
  })

  it('journals intent before activation and reads back once after an ambiguous failure', async () => {
    const fx = fixture()
    seedVaultEvidence(fx)
    let attempted = 0
    const runner = async (command: string, args: string[]) => {
      if (args.includes('deploy')) {
        const beforeEffect = readFileSync(
          join(fx.root, 'honowarden/release/staging/test-run/journal.jsonl'),
          'utf8',
        )
        expect(beforeEffect).toContain('"kind":"intent"')
        expect(beforeEffect).not.toContain('"kind":"result"')
        attempted++
        throw Error('synthetic timeout')
      }
      return fx.runner(command, args)
    }
    await expect(
      release(
        [
          'activate',
          '--target',
          'staging',
          '--version',
          newVersion,
          '--expect-active',
          oldVersion,
          '--execute',
          '--confirm',
          'staging',
        ],
        { ...fx, runner, fetch: vaultRead, cwd: process.cwd() },
      ),
    ).rejects.toThrow('previous_active')
    expect(attempted).toBe(1)
    const journal = readFileSync(
      join(
        fx.root,
        'honowarden/release/staging',
        fx.runId ?? 'test-run',
        'journal.jsonl',
      ),
      'utf8',
    )
    expect(journal.indexOf('"kind":"intent"')).toBeLessThan(
      journal.indexOf('"kind":"classification"'),
    )
    expect(journal).not.toContain('synthetic-token-marker')
    const runDir = join(fx.root, 'honowarden/release/staging/test-run')
    expect(statSync(runDir).mode & 0o777).toBe(0o700)
    expect(statSync(join(runDir, 'journal.jsonl')).mode & 0o777).toBe(0o600)
    expect(
      readdirSync(runDir).some((name) => name.startsWith('wrangler-')),
    ).toBe(false)
  })

  it('attempts an ambiguous upload once, then reads traffic without retrying', async () => {
    const fx = fixture()
    let uploads = 0
    const runner = async (command: string, args: string[]) => {
      if (
        command === 'wrangler' &&
        args.includes('upload') &&
        args.includes('--dry-run')
      ) {
        const outdir = args[args.indexOf('--outdir') + 1]!
        mkdirSync(outdir)
        writeFileSync(join(outdir, 'index.js'), 'export default {}')
        return { stdout: '', code: 0 }
      }
      if (command === 'wrangler' && args.includes('upload')) {
        uploads++
        return { stdout: 'sensitive-provider-output', code: 1 }
      }
      return fx.runner(command, args)
    }
    await expect(
      release(
        [
          'upload',
          '--target',
          'staging',
          '--commit',
          sha,
          '--expect-active',
          oldVersion,
          '--execute',
          '--confirm',
          'staging',
        ],
        { ...fx, runner, cwd: process.cwd() },
      ),
    ).rejects.toThrow('upload_ambiguous')
    expect(uploads).toBe(1)
    const journal = readFileSync(
      join(fx.root, 'honowarden/release/staging/test-run/journal.jsonl'),
      'utf8',
    )
    expect(journal).toContain('previous_active')
    expect(journal).toContain('strict_upload_refusal')
    expect(journal).toContain('"nonStrictRetryAllowed":false')
    expect(journal).not.toContain('sensitive-provider-output')
    expect(
      fx.calls.filter(
        (call) => call[0] === 'wrangler' && call.includes('status'),
      ),
    ).toHaveLength(2)
  })

  it('stops on uploaded version readback mismatch before activation', async () => {
    const fx = fixture()
    const calls: string[][] = []
    let uploaded = false
    const runner = async (
      command: string,
      args: string[],
      options: { env: Record<string, string> },
    ) => {
      calls.push([command, ...args])
      if (args.includes('list'))
        return {
          stdout: JSON.stringify(
            uploaded
              ? [
                  {
                    id: newVersion,
                    metadata: {
                      created_on: new Date(Date.now() + 1000).toISOString(),
                    },
                    annotations: {
                      'workers/tag': sha,
                      'workers/message': `HonoWarden vault staging ${sha}`,
                    },
                  },
                ]
              : [],
          ),
          code: 0,
        }
      if (
        command === 'wrangler' &&
        args.includes('upload') &&
        args.includes('--dry-run')
      ) {
        const outdir = args[args.indexOf('--outdir') + 1]!
        mkdirSync(outdir)
        writeFileSync(join(outdir, 'index.js'), 'export default {}')
        return { stdout: '', code: 0 }
      }
      if (command === 'wrangler' && args.includes('upload')) {
        uploaded = true
        expect(
          statSync(options.env.WRANGLER_OUTPUT_FILE_PATH!).mode & 0o777,
        ).toBe(0o600)
        writeFileSync(
          options.env.WRANGLER_OUTPUT_FILE_PATH!,
          `${JSON.stringify({ type: 'version-upload', version_id: newVersion })}\n`,
        )
        return { stdout: '', code: 0 }
      }
      if (args.includes('view') && args.includes(oldVersion))
        return {
          stdout: JSON.stringify({
            id: oldVersion,
            resources: { bindings: [] },
          }),
          code: 0,
        }
      if (args.includes('view'))
        return {
          stdout: JSON.stringify({
            id: newVersion,
            annotations: { 'workers/tag': 'b'.repeat(40) },
          }),
          code: 0,
        }
      return fx.runner(command, args)
    }
    await expect(
      release(
        [
          'upload',
          '--target',
          'staging',
          '--commit',
          sha,
          '--expect-active',
          oldVersion,
          '--execute',
          '--confirm',
          'staging',
        ],
        { ...fx, runner, cwd: process.cwd() },
      ),
    ).rejects.toThrow('version_provenance_mismatch')
    expect(calls.some((call) => call.includes('deploy'))).toBe(false)
    expect(
      calls.some(
        (call) =>
          call.includes('--tag') &&
          call.includes(sha) &&
          call.includes('--strict'),
      ),
    ).toBe(true)
  })

  it('uploads profile vars with setup on, then off, and requires exact plain var readback', async () => {
    const config = parseJsonc(
      readFileSync(join(process.cwd(), 'wrangler.jsonc'), 'utf8'),
    )
    const tracked = config.env.staging
    const profilePath = 'deploy/profiles/staging-company-launch.json'
    const profile = JSON.parse(
      readFileSync(join(process.cwd(), profilePath), 'utf8'),
    )
    const bytes = Buffer.from('export default {}')
    for (const [
      setup,
      mismatch,
      omitSecret,
      truncated,
      addedSecret,
      saturated,
    ] of [
      [true, false, false, false, false, false],
      [false, false, false, false, false, false],
      [true, true, false, false, false, false],
      [true, false, true, false, false, false],
      [true, false, false, true, false, false],
      [true, false, false, false, true, false],
      // A full ten-row page before upload must not block a release while
      // the post-upload page still overlaps it.
      [false, false, false, false, false, true],
      // A full page that loses continuity after upload must still stop.
      [false, false, false, true, false, true],
    ] as const) {
      const fx = fixture()
      const sourceSecretFile = join(fx.root, 'new-secret.json')
      const secretMarker = 'synthetic-secret-value'
      if (addedSecret)
        writeFileSync(
          sourceSecretFile,
          JSON.stringify({
            target: 'staging',
            secrets: { HONOWARDEN_BOOTSTRAP_TOKEN: secretMarker },
          }),
          { mode: 0o600 },
        )
      const uploadCalls: string[][] = []
      let copiedSecretFile: string | null = null
      let uploaded = false
      const expectedVars = {
        ...tracked.vars,
        ...profile.vars,
        HONOWARDEN_INITIAL_SETUP_ENABLED: setup ? 'true' : 'false',
      }
      const bindings = [
        ...Object.entries(expectedVars).map(([name, text]) => ({
          name,
          type: 'plain_text',
          text:
            mismatch && name === 'HONOWARDEN_ADMIN_ENABLED' ? 'false' : text,
        })),
        ...tracked.d1_databases.map(
          (row: { binding: string; database_id: string }) => ({
            name: row.binding,
            type: 'd1',
            id: row.database_id,
          }),
        ),
        ...tracked.r2_buckets.map(
          (row: { binding: string; bucket_name: string }) => ({
            name: row.binding,
            type: 'r2_bucket',
            bucket_name: row.bucket_name,
          }),
        ),
        ...tracked.durable_objects.bindings.map(
          (row: { name: string; class_name: string }) => ({
            name: row.name,
            type: 'durable_object_namespace',
            class_name: row.class_name,
          }),
        ),
        ...tracked.services.map(
          (row: { binding: string; service: string }) => ({
            name: row.binding,
            type: 'service',
            service: row.service,
          }),
        ),
        ...[
          'HONOWARDEN_TOTP_SECRET',
          'HONOWARDEN_BOOTSTRAP_TOKEN',
          'HONOWARDEN_ORGANIZATION_INVITE_SECRET',
          'HONOWARDEN_ACCOUNT_LIFECYCLE_TOKEN_SECRET',
          'HONOWARDEN_TOKEN_SECRET',
        ]
          .filter((name) => !omitSecret || name !== 'HONOWARDEN_TOKEN_SECRET')
          .map((name) => ({ name, type: 'secret_text' })),
        { name: 'CF_VERSION_METADATA', type: 'version_metadata' },
        { name: 'ADMIN_ASSETS', type: 'assets' },
      ]
      const runner = async (
        command: string,
        args: string[],
        options: { env: Record<string, string> },
      ) => {
        if (command === 'wrangler' && args.includes('upload'))
          uploadCalls.push(args)
        const olderPage = Array.from({ length: 10 }, (_, i) => ({
          id: `dddddddd-0000-4000-8000-${String(i).padStart(12, '0')}`,
          annotations: {
            'workers/tag': 'd'.repeat(40),
            'workers/message': 'older release',
          },
        }))
        if (args.includes('list'))
          return {
            stdout: JSON.stringify(
              uploaded
                ? [
                    {
                      id: newVersion,
                      metadata: {
                        // Provider timestamps may precede the operator clock.
                        created_on: '2000-01-01T00:00:00.000Z',
                      },
                      annotations: {
                        'workers/tag': sha,
                        'workers/message': `HonoWarden vault staging ${sha}`,
                      },
                    },
                    ...(truncated
                      ? Array.from({ length: 9 }, (_, i) => ({
                          id: `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, '0')}`,
                          metadata: {
                            created_on: new Date(
                              Date.now() + 1000,
                            ).toISOString(),
                          },
                          annotations: {
                            'workers/tag': 'b'.repeat(40),
                            'workers/message': 'other',
                          },
                        }))
                      : saturated
                        ? olderPage.slice(0, 9)
                        : []),
                  ]
                : saturated
                  ? olderPage
                  : [],
            ),
            code: 0,
          }
        if (
          command === 'wrangler' &&
          args.includes('upload') &&
          args.includes('--dry-run')
        ) {
          const outdir = args[args.indexOf('--outdir') + 1]!
          mkdirSync(outdir)
          writeFileSync(join(outdir, 'index.js'), bytes)
          return { stdout: '', code: 0 }
        }
        if (command === 'wrangler' && args.includes('upload')) {
          if (addedSecret && !args.includes('--dry-run')) {
            copiedSecretFile = args[args.indexOf('--secrets-file') + 1]!
            expect(copiedSecretFile).not.toBe(sourceSecretFile)
            expect(statSync(copiedSecretFile).mode & 0o777).toBe(0o600)
            expect(JSON.parse(readFileSync(copiedSecretFile, 'utf8'))).toEqual({
              HONOWARDEN_BOOTSTRAP_TOKEN: secretMarker,
            })
          }
          uploaded = true
          writeFileSync(
            options.env.WRANGLER_OUTPUT_FILE_PATH!,
            `${JSON.stringify({ type: 'version-upload', version_id: newVersion })}\n`,
          )
          return { stdout: '', code: 0 }
        }
        if (args.includes('view') && args.includes(oldVersion))
          return {
            stdout: JSON.stringify({
              id: oldVersion,
              resources: {
                bindings: [
                  'HONOWARDEN_TOTP_SECRET',
                  ...(addedSecret ? [] : ['HONOWARDEN_BOOTSTRAP_TOKEN']),
                  'HONOWARDEN_ORGANIZATION_INVITE_SECRET',
                  'HONOWARDEN_ACCOUNT_LIFECYCLE_TOKEN_SECRET',
                  'HONOWARDEN_TOKEN_SECRET',
                ].map((name) => ({ name, type: 'secret_text' })),
              },
            }),
            code: 0,
          }
        if (args.includes('view'))
          return {
            stdout: JSON.stringify({
              id: newVersion,
              annotations: {
                'workers/tag': sha,
                'workers/message': `HonoWarden vault staging ${sha}`,
              },
              resources: {
                script_runtime: {
                  compatibility_date: config.compatibility_date,
                },
                bindings,
              },
            }),
            code: 0,
          }
        return fx.runner(command, args)
      }
      const fetcher = async (input: RequestInfo | URL) =>
        String(input).endsWith('/workers/scripts')
          ? new Response(
              JSON.stringify({
                success: true,
                errors: [],
                result: [{ id: 'honowarden-staging', migration_tag: 'v1' }],
              }),
              { status: 200 },
            )
          : new Response(
              JSON.stringify({
                success: true,
                errors: [],
                result: {
                  id: newVersion,
                  main_module: 'index.js',
                  modules: [
                    {
                      name: 'index.js',
                      content_type: 'application/javascript+module',
                      content_base64: bytes.toString('base64'),
                    },
                  ],
                },
              }),
              { status: 200 },
            )
      const argv = [
        'upload',
        '--target',
        'staging',
        '--commit',
        sha,
        '--expect-active',
        oldVersion,
        '--profile',
        profilePath,
        ...(addedSecret ? ['--secrets-file', sourceSecretFile] : []),
        ...(setup ? ['--initial-setup-window'] : []),
        '--execute',
        '--confirm',
        'staging',
      ]
      const promise = release(argv, {
        ...fx,
        runner,
        fetch: fetcher,
        cwd: process.cwd(),
      })
      if (mismatch)
        await expect(promise).rejects.toThrow('version_vars_mismatch')
      else if (omitSecret)
        await expect(promise).rejects.toThrow('version_secret_names_mismatch')
      else if (truncated)
        await expect(promise).rejects.toThrow('version_history_truncated')
      else await expect(promise).resolves.toMatchObject({ version: newVersion })
      expect(uploadCalls).toHaveLength(2)
      for (const call of uploadCalls) {
        expect(call).toContain('HONOWARDEN_ADMIN_ENABLED:true')
        expect(call.includes('HONOWARDEN_INITIAL_SETUP_ENABLED:true')).toBe(
          setup,
        )
      }
      const journal = readFileSync(
        join(fx.root, 'honowarden/release/staging/test-run/journal.jsonl'),
        'utf8',
      )
      expect(journal).toContain(
        createHash('sha256')
          .update(readFileSync(join(process.cwd(), profilePath)))
          .digest('hex'),
      )
      expect(journal).not.toContain('secret_text')
      expect(journal).not.toContain(secretMarker)
      if (addedSecret)
        expect(copiedSecretFile).toContain(
          '/honowarden/release/staging/test-run/secrets-upload.json',
        )
      if (addedSecret) {
        expect(existsSync(copiedSecretFile!)).toBe(false)
        expect(journal).toContain('secret_copy_removed')
      }
    }
  })

  it.each(['failure', 'timeout', 'throw'] as const)(
    'erases the run-local upload secret copy after %s',
    async (outcome) => {
      const fx = fixture()
      const sourceFile = join(fx.root, 'new-secret.json')
      writeFileSync(
        sourceFile,
        JSON.stringify({
          target: 'staging',
          secrets: { HONOWARDEN_BOOTSTRAP_TOKEN: 'synthetic-private-marker' },
        }),
        { mode: 0o600 },
      )
      let copy: string | undefined
      let attempts = 0
      const runner = async (command: string, args: string[]) => {
        if (
          command === 'wrangler' &&
          args.includes('upload') &&
          args.includes('--dry-run')
        ) {
          const outdir = args[args.indexOf('--outdir') + 1]!
          mkdirSync(outdir)
          writeFileSync(join(outdir, 'index.js'), moduleBytes)
          return { stdout: '', code: 0 }
        }
        if (command === 'wrangler' && args.includes('upload')) {
          attempts++
          copy = args[args.indexOf('--secrets-file') + 1]
          expect(copy && existsSync(copy)).toBe(true)
          if (outcome === 'failure')
            return { stdout: 'provider marker', code: 1 }
          throw new Error(
            outcome === 'timeout' ? 'ETIMEDOUT' : 'synthetic thrown error',
          )
        }
        return fx.runner(command, args)
      }
      await expect(
        release(
          [
            'upload',
            '--target',
            'staging',
            '--commit',
            sha,
            '--expect-active',
            oldVersion,
            '--secrets-file',
            sourceFile,
            '--execute',
            '--confirm',
            'staging',
          ],
          { ...fx, runner, cwd: process.cwd() },
        ),
      ).rejects.toThrow('upload_ambiguous')
      expect(attempts).toBe(1)
      expect(copy && existsSync(copy)).toBe(false)
      const journal = readFileSync(
        join(fx.root, 'honowarden/release/staging/test-run/journal.jsonl'),
        'utf8',
      )
      expect(journal).toContain('secret_copy_removed')
      expect(journal).not.toContain('synthetic-private-marker')
      expect(journal).not.toContain('provider marker')
    },
  )

  it('records a private D1 bookmark and export digest with exact Wrangler arguments', async () => {
    const fx = fixture()
    const runner = async (command: string, args: string[]) => {
      if (args.includes('time-travel'))
        return {
          stdout: JSON.stringify({ bookmark: 'synthetic-bookmark' }),
          code: 0,
        }
      if (args.includes('export')) {
        writeFileSync(args[args.indexOf('--output') + 1]!, 'synthetic SQL')
        return { stdout: 'signed-url-marker', code: 0 }
      }
      return fx.runner(command, args)
    }
    const result = await release(
      ['backup-db', '--target', 'staging', '--execute', '--confirm', 'staging'],
      { ...fx, runner, cwd: process.cwd() },
    )
    expect(result).toMatchObject({ bookmark: 'synthetic-bookmark', bytes: 13 })
    const journal = readFileSync(
      join(fx.root, 'honowarden/release/staging/test-run/journal.jsonl'),
      'utf8',
    )
    expect(journal).toContain('"kind":"intent"')
    expect(journal).not.toContain('signed-url-marker')
    expect(
      fx.calls.some(
        (call) => call.includes('whoami') && call.includes('--json'),
      ),
    ).toBe(true)
  })

  it('applies exactly the expected D1 migrations once and checks zero pending', async () => {
    const fx = fixture()
    seedBackup(fx)
    let applied = 0
    const runner = async (command: string, args: string[]) => {
      if (command === 'wrangler' && args.includes('execute')) {
        const sql = args[args.indexOf('--command') + 1]
        const results = sql?.includes('COUNT(*) AS n FROM d1_migrations')
          ? [{ n: 35 }]
          : sql?.includes('MAX(version)')
            ? [{ n: 35, version: '0033' }]
            : sql?.includes(
                  'SELECT type, name, tbl_name, sql FROM sqlite_master',
                )
              ? applied
                ? localSchemaRows()
                : baselineSchemaRows()
              : sql?.includes('sqlite_master')
                ? [
                    { type: 'index', n: 61 },
                    { type: 'table', n: 41 },
                    { type: 'trigger', n: 6 },
                  ]
                : sql?.includes('foreign_key_check')
                  ? []
                  : (applied ? migrationNames : baselineNames).map((name) => ({
                      name,
                    }))
        return {
          stdout: JSON.stringify([{ results }]),
          code: 0,
        }
      }
      if (args.includes('time-travel'))
        return {
          stdout: JSON.stringify({ bookmark: 'synthetic-bookmark' }),
          code: 0,
        }
      if (args.includes('apply')) {
        applied++
        return { stdout: 'applied', code: 0 }
      }
      return fx.runner(command, args)
    }
    await expect(
      release(
        [
          'migrate-db',
          '--target',
          'staging',
          '--expect-pending',
          migrationNames.slice(baselineNames.length).join(','),
          '--execute',
          '--confirm',
          'staging',
        ],
        { ...fx, runner, cwd: process.cwd() },
      ),
    ).resolves.toMatchObject({
      applied: migrationNames.slice(baselineNames.length),
    })
    expect(applied).toBe(1)
  })

  it('refuses migration before apply when live 0014 object SQL drifts', async () => {
    const fx = fixture()
    seedBackup(fx)
    let applied = false
    const runner = async (command: string, args: string[]) => {
      if (command === 'wrangler' && args.includes('execute')) {
        const sql = args[args.indexOf('--command') + 1]
        const rows = sql?.includes('sqlite_master')
          ? baselineSchemaRows().map((row, index) =>
              index === 0
                ? { ...row, sql: 'CREATE INDEX changed ON users(id)' }
                : row,
            )
          : baselineNames.map((name) => ({ name }))
        return { stdout: JSON.stringify([{ results: rows }]), code: 0 }
      }
      if (args.includes('apply')) applied = true
      return fx.runner(command, args)
    }
    await expect(
      release(
        [
          'migrate-db',
          '--target',
          'staging',
          '--expect-pending',
          migrationNames.slice(baselineNames.length).join(','),
          '--execute',
          '--confirm',
          'staging',
        ],
        { ...fx, runner, cwd: process.cwd() },
      ),
    ).rejects.toThrow('schema_baseline_mismatch')
    expect(applied).toBe(false)
  })

  it.each([
    ['index', 'index_xinfo', 'structure_changed'],
    ['table', 'table_xinfo', 'structure_changed'],
    ['trigger', null, 'format_only'],
  ] as const)(
    'journals %s structural detail when the post-apply SQL hash differs',
    async (objectType, expectedPragma, expectedKind) => {
      const fx = fixture()
      seedBackup(fx)
      let applied = false
      const pragmaReads: string[] = []
      const runner = async (command: string, args: string[]) => {
        if (command === 'wrangler' && args.includes('execute')) {
          const sql = args[args.indexOf('--command') + 1] ?? ''
          let rows: unknown[]
          if (
            sql.includes('SELECT type, name, tbl_name, sql FROM sqlite_master')
          ) {
            const complete = applied ? localSchemaRows() : null
            const selectedName = complete?.find(
              (row) => row.type === objectType,
            )?.name
            rows = applied
              ? complete!.map((row) =>
                  row.name === selectedName
                    ? {
                        ...row,
                        sql:
                          objectType === 'trigger'
                            ? `${row.sql} -- harmless comment\n`
                            : `CREATE ${objectType.toUpperCase()} changed`,
                      }
                    : row,
                )
              : baselineSchemaRows()
          } else if (sql.includes('COUNT(*) AS n FROM d1_migrations'))
            rows = [{ n: 35 }]
          else if (sql.includes('MAX(version)'))
            rows = [{ n: 35, version: '0033' }]
          else if (sql.includes('GROUP BY type'))
            rows = [
              { type: 'index', n: 61 },
              { type: 'table', n: 41 },
              { type: 'trigger', n: 6 },
            ]
          else if (sql.startsWith('PRAGMA')) {
            pragmaReads.push(sql)
            rows = []
          } else
            rows = (applied ? migrationNames : baselineNames).map((name) => ({
              name,
            }))
          return { stdout: JSON.stringify([{ results: rows }]), code: 0 }
        }
        if (args.includes('time-travel'))
          return {
            stdout: JSON.stringify({ bookmark: 'synthetic-bookmark' }),
            code: 0,
          }
        if (args.includes('apply')) {
          applied = true
          return { stdout: '', code: 0 }
        }
        return fx.runner(command, args)
      }
      await expect(
        release(
          [
            'migrate-db',
            '--target',
            'staging',
            '--expect-pending',
            migrationNames.slice(baselineNames.length).join(','),
            '--execute',
            '--confirm',
            'staging',
          ],
          { ...fx, runner, cwd: process.cwd() },
        ),
      ).rejects.toThrow('migration_schema_unverified')
      const journal = readFileSync(
        join(fx.root, 'honowarden/release/staging/test-run/journal.jsonl'),
        'utf8',
      )
      expect(journal).toContain('"structural":[')
      expect(journal).toContain(expectedKind)
      expect(
        pragmaReads.some((query) => query.includes(expectedPragma ?? 'never')),
      ).toBe(expectedPragma !== null)
      expect(journal).not.toContain('CREATE INDEX changed')
    },
  )

  it('classifies partial migration failure with the applied subset and bookmark without retry', async () => {
    const fx = fixture()
    seedBackup(fx)
    let attempts = 0
    const runner = async (command: string, args: string[]) => {
      if (command === 'wrangler' && args.includes('execute')) {
        const sql = args[args.indexOf('--command') + 1]
        if (sql?.includes('sqlite_master'))
          return {
            stdout: JSON.stringify([{ results: baselineSchemaRows() }]),
            code: 0,
          }
        const applied = attempts
          ? [...baselineNames, migrationNames[baselineNames.length]!]
          : baselineNames
        return {
          stdout: JSON.stringify([
            { results: applied.map((name) => ({ name })) },
          ]),
          code: 0,
        }
      }
      if (args.includes('time-travel'))
        return {
          stdout: JSON.stringify({ bookmark: 'synthetic-bookmark' }),
          code: 0,
        }
      if (args.includes('apply')) {
        attempts++
        return { stdout: 'provider-payload-marker', code: 1 }
      }
      return fx.runner(command, args)
    }
    await expect(
      release(
        [
          'migrate-db',
          '--target',
          'staging',
          '--expect-pending',
          migrationNames.slice(baselineNames.length).join(','),
          '--execute',
          '--confirm',
          'staging',
        ],
        { ...fx, runner, cwd: process.cwd() },
      ),
    ).rejects.toThrow(
      `migration_ambiguous applied=${migrationNames[baselineNames.length]} bookmark=synthetic-bookmark`,
    )
    expect(attempts).toBe(1)
    const journal = readFileSync(
      join(fx.root, 'honowarden/release/staging/test-run/journal.jsonl'),
      'utf8',
    )
    expect(journal).not.toContain('provider-payload-marker')
  })

  it('creates only missing target queues with exact Wrangler arguments and readback', async () => {
    const fx = fixture()
    const cwd = join(fx.root, 'source')
    mkdirSync(cwd)
    writeFileSync(
      join(cwd, 'wrangler.account-mailer.jsonc'),
      JSON.stringify({
        compatibility_date: '2026-07-06',
        env: {
          staging: {
            name: 'honowarden-account-mailer-staging',
            workers_dev: false,
            preview_urls: false,
            queues: {
              consumers: [
                {
                  queue: 'honowarden-account-mail-staging',
                  dead_letter_queue: 'honowarden-account-mail-staging-dlq',
                },
              ],
            },
          },
        },
      }),
    )
    const created = new Set(['honowarden-account-mail-staging'])
    const retained = new Set<string>()
    const fetcher = async (input: RequestInfo | URL) => {
      const name = new URL(String(input)).searchParams.get('name') ?? ''
      return new Response(
        JSON.stringify({
          success: true,
          result: created.has(name)
            ? [
                {
                  queue_name: name,
                  settings: {
                    message_retention_period: retained.has(name) ? 86400 : 1200,
                  },
                },
              ]
            : [],
          errors: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    const runner = async (command: string, args: string[]) => {
      if (args.includes('create') || args.includes('update')) {
        const name =
          args[
            args.includes('create')
              ? args.indexOf('create') + 1
              : args.indexOf('update') + 1
          ]!
        created.add(name)
        retained.add(name)
        expect(args).toContain('--message-retention-period-secs')
        expect(args).toContain('86400')
        return { stdout: '', code: 0 }
      }
      return fx.runner(command, args)
    }
    await expect(
      release(
        [
          'ensure-queues',
          '--target',
          'staging',
          '--config',
          'wrangler.account-mailer.jsonc',
          '--execute',
          '--confirm',
          'staging',
        ],
        { ...fx, runner, fetch: fetcher, cwd },
      ),
    ).resolves.toMatchObject({
      queues: [
        'honowarden-account-mail-staging',
        'honowarden-account-mail-staging-dlq',
      ],
    })
    expect(created.size).toBe(2)
  })

  it('bounds and hashes the exact uploaded main module without retaining response data', async () => {
    const bytes = Buffer.from('export default {}')
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain(
        `/workers/workers/honowarden-staging/versions/${newVersion}?include=modules`,
      )
      expect(init?.redirect).toBe('manual')
      return new Response(
        JSON.stringify({
          success: true,
          errors: [],
          result: {
            id: newVersion,
            main_module: 'index.js',
            modules: [
              {
                name: 'index.js',
                content_type: 'application/javascript+module',
                content_base64: bytes.toString('base64'),
              },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    await expect(
      readModuleProof(
        'a'.repeat(32),
        'synthetic-token',
        'honowarden-staging',
        newVersion,
        fetcher,
      ),
    ).resolves.toEqual({
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
    })
    await expect(
      readModuleProof(
        'a'.repeat(32),
        'synthetic-token',
        'honowarden-staging',
        newVersion,
        async () =>
          new Response('{"success":true,"success":false}', { status: 200 }),
      ),
    ).rejects.toThrow('cloudflare_read_invalid')
  })

  it('first-deploys only an absent private invitation mailer without secrets', async () => {
    const fx = fixture()
    const cwd = join(fx.root, 'source')
    mkdirSync(cwd)
    writeFileSync(
      join(cwd, 'wrangler.invitation-mailer.jsonc'),
      JSON.stringify({
        compatibility_date: '2026-07-06',
        env: {
          staging: {
            name: 'honowarden-invitation-mailer-staging',
            workers_dev: false,
            preview_urls: false,
            vars: {},
            send_email: [
              {
                name: 'EMAIL',
                allowed_sender_addresses: ['mail@example.test'],
              },
            ],
          },
        },
      }),
    )
    const bytes = Buffer.from('export default {}')
    let deployed = false
    let writes = 0
    const runner = async (command: string, args: string[]) => {
      if (args.includes('--dry-run')) {
        const outdir = args[args.indexOf('--outdir') + 1]!
        mkdirSync(outdir)
        writeFileSync(join(outdir, 'index.js'), bytes)
        return { stdout: '', code: 0 }
      }
      if (command === 'wrangler' && args[0] === 'deploy') {
        deployed = true
        writes++
        expect(args).not.toContain('--secrets-file')
        expect(args).toContain('--no-experimental-auto-create')
        return { stdout: '', code: 0 }
      }
      if (command === 'wrangler' && args.includes('status'))
        return {
          stdout: JSON.stringify({
            versions: [
              {
                version_id: deployed ? newVersion : oldVersion,
                percentage: 100,
              },
            ],
          }),
          code: 0,
        }
      if (args.includes('view'))
        return {
          stdout: JSON.stringify({
            id: newVersion,
            annotations: {
              'workers/tag': sha,
              'workers/message': `HonoWarden invitation staging ${sha}`,
            },
            resources: {
              script_runtime: { compatibility_date: '2026-07-06' },
              bindings: [
                {
                  name: 'EMAIL',
                  type: 'send_email',
                  allowed_sender_addresses: ['mail@example.test'],
                },
              ],
            },
          }),
          code: 0,
        }
      return fx.runner(command, args)
    }
    const fetcher = async (input: RequestInfo | URL) => {
      const url = String(input)
      if (
        url.endsWith('/workers/services/honowarden-invitation-mailer-staging')
      )
        return new Response(
          JSON.stringify({
            success: true,
            result: { default_environment: { environment: 'production' } },
            errors: [],
          }),
          { status: 200 },
        )
      if (url.includes('/subdomain'))
        return new Response(
          JSON.stringify({
            success: true,
            result: { enabled: false, previews_enabled: false },
            errors: [],
          }),
          { status: 200 },
        )
      if (url.includes('/routes?') || url.includes('/domains/records'))
        return new Response(
          JSON.stringify({ success: true, result: [], errors: [] }),
          { status: 200 },
        )
      if (url.includes('/schedules'))
        return new Response(
          JSON.stringify({
            success: true,
            result: { schedules: [] },
            errors: [],
          }),
          { status: 200 },
        )
      if (url.includes('/script-settings'))
        return new Response(
          JSON.stringify({
            success: true,
            result: { logpush: false },
            errors: [],
          }),
          { status: 200 },
        )
      return url.includes('include=modules')
        ? new Response(
            JSON.stringify({
              success: true,
              result: {
                id: newVersion,
                main_module: 'index.js',
                modules: [
                  {
                    name: 'index.js',
                    content_type: 'application/javascript+module',
                    content_base64: bytes.toString('base64'),
                  },
                ],
              },
              errors: [],
            }),
            { status: 200 },
          )
        : new Response('', { status: 404 })
    }
    await expect(
      release(
        [
          'first-deploy',
          '--target',
          'staging',
          '--config',
          'wrangler.invitation-mailer.jsonc',
          '--commit',
          sha,
          '--execute',
          '--confirm',
          'staging',
        ],
        { ...fx, runner, fetch: fetcher, cwd },
      ),
    ).resolves.toMatchObject({ activeVersion: newVersion })
    expect(writes).toBe(1)
    const journal = readFileSync(
      join(fx.root, 'honowarden/release/staging/test-run/journal.jsonl'),
      'utf8',
    )
    expect(journal).not.toContain('synthetic-secret-value')
  })

  it('requires the account mailer key before a first serving deploy', async () => {
    const fx = fixture()
    let deployments = 0
    const runner = async (command: string, args: string[]) => {
      if (
        command === 'wrangler' &&
        args[0] === 'deploy' &&
        !args.includes('--dry-run')
      )
        deployments++
      return fx.runner(command, args)
    }
    await expect(
      release(
        [
          'first-deploy',
          '--target',
          'staging',
          '--config',
          'wrangler.account-mailer.jsonc',
          '--commit',
          sha,
          '--execute',
          '--confirm',
          'staging',
        ],
        { ...fx, runner, cwd: process.cwd() },
      ),
    ).rejects.toThrow('mandatory_secret_missing')
    expect(deployments).toBe(0)
  })

  it.each(['failure', 'timeout', 'throw'] as const)(
    'erases the run-local first-deploy secret copy after %s',
    async (outcome) => {
      const fx = fixture()
      const secretFile = join(fx.root, 'account-secret.json')
      writeFileSync(
        secretFile,
        JSON.stringify({
          target: 'staging',
          secrets: {
            HONOWARDEN_ACCOUNT_MAIL_ENCRYPTION_KEYS: 'synthetic-private-marker',
          },
        }),
        { mode: 0o600 },
      )
      let copy: string | undefined
      let attempts = 0
      const runner = async (command: string, args: string[]) => {
        if (
          command === 'wrangler' &&
          args[0] === 'deploy' &&
          args.includes('--dry-run')
        ) {
          const outdir = args[args.indexOf('--outdir') + 1]!
          mkdirSync(outdir)
          writeFileSync(join(outdir, 'index.js'), moduleBytes)
          return { stdout: '', code: 0 }
        }
        if (command === 'wrangler' && args[0] === 'deploy') {
          attempts++
          copy = args[args.indexOf('--secrets-file') + 1]
          expect(copy && existsSync(copy)).toBe(true)
          if (outcome === 'failure')
            return { stdout: 'provider marker', code: 1 }
          throw new Error(
            outcome === 'timeout' ? 'ETIMEDOUT' : 'synthetic thrown error',
          )
        }
        return fx.runner(command, args)
      }
      await expect(
        release(
          [
            'first-deploy',
            '--target',
            'staging',
            '--config',
            'wrangler.account-mailer.jsonc',
            '--commit',
            sha,
            '--secrets-file',
            secretFile,
            '--execute',
            '--confirm',
            'staging',
          ],
          {
            ...fx,
            runner,
            cwd: process.cwd(),
            fetch: async () => new Response('', { status: 404 }),
          },
        ),
      ).rejects.toThrow('first_deploy_ambiguous')
      expect(attempts).toBe(1)
      expect(copy && existsSync(copy)).toBe(false)
      const journal = readFileSync(
        join(fx.root, 'honowarden/release/staging/test-run/journal.jsonl'),
        'utf8',
      )
      expect(journal).toContain('secret_copy_removed')
      expect(journal).not.toContain('synthetic-private-marker')
    },
  )

  it('verifies account mailer queue consumer and DLQ after its first serving deploy', async () => {
    const config = parseJsonc(
      readFileSync(
        join(process.cwd(), 'wrangler.account-mailer.jsonc'),
        'utf8',
      ),
    )
    const env = config.env.staging
    const bytes = Buffer.from('export default {}')
    for (const badDlq of [false, true]) {
      const fx = fixture()
      let copiedSecretFile: string | undefined
      const secretFile = join(fx.root, 'account-secret.json')
      writeFileSync(
        secretFile,
        JSON.stringify({
          target: 'staging',
          secrets: {
            HONOWARDEN_ACCOUNT_MAIL_ENCRYPTION_KEYS: 'synthetic-secret-value',
          },
        }),
        { mode: 0o600 },
      )
      let deployed = false
      const runner = async (command: string, args: string[]) => {
        if (command === 'wrangler' && args.includes('--dry-run')) {
          const outdir = args[args.indexOf('--outdir') + 1]!
          mkdirSync(outdir)
          writeFileSync(join(outdir, 'index.js'), bytes)
          return { stdout: '', code: 0 }
        }
        if (command === 'wrangler' && args[0] === 'deploy') {
          deployed = true
          const copy = args[args.indexOf('--secrets-file') + 1]!
          copiedSecretFile = copy
          expect(copy).not.toBe(secretFile)
          expect(statSync(copy).mode & 0o777).toBe(0o600)
          expect(JSON.parse(readFileSync(copy, 'utf8'))).toEqual({
            HONOWARDEN_ACCOUNT_MAIL_ENCRYPTION_KEYS: 'synthetic-secret-value',
          })
          return { stdout: '', code: 0 }
        }
        if (command === 'wrangler' && args.includes('status'))
          return {
            stdout: JSON.stringify({
              versions: [
                {
                  version_id: deployed ? newVersion : oldVersion,
                  percentage: 100,
                },
              ],
            }),
            code: 0,
          }
        if (command === 'wrangler' && args.includes('view'))
          return {
            stdout: JSON.stringify({
              id: newVersion,
              annotations: {
                'workers/tag': sha,
                'workers/message': `HonoWarden account staging ${sha}`,
              },
              resources: {
                script_runtime: {
                  compatibility_date: config.compatibility_date,
                },
                bindings: [
                  ...Object.entries(env.vars).map(([name, text]) => ({
                    name,
                    type: 'plain_text',
                    text,
                  })),
                  ...env.queues.producers.map(
                    (row: { binding: string; queue: string }) => ({
                      name: row.binding,
                      type: 'queue',
                      queue_name: row.queue,
                    }),
                  ),
                  ...env.send_email.map(
                    (row: {
                      name: string
                      allowed_sender_addresses: string[]
                    }) => ({
                      name: row.name,
                      type: 'send_email',
                      allowed_sender_addresses: row.allowed_sender_addresses,
                    }),
                  ),
                  {
                    name: 'HONOWARDEN_ACCOUNT_MAIL_ENCRYPTION_KEYS',
                    type: 'secret_text',
                  },
                ],
              },
            }),
            code: 0,
          }
        return fx.runner(command, args)
      }
      const fetcher = async (input: RequestInfo | URL) => {
        const url = String(input)
        if (
          url.includes('/workers/scripts/honowarden-account-mailer-staging') &&
          !url.includes('/schedules') &&
          !url.includes('/script-settings')
        )
          return new Response('', { status: 404 })
        let result: unknown
        if (url.includes('include=modules'))
          result = {
            id: newVersion,
            main_module: 'index.js',
            modules: [
              {
                name: 'index.js',
                content_type: 'application/javascript+module',
                content_base64: bytes.toString('base64'),
              },
            ],
          }
        else if (
          url.endsWith('/workers/services/honowarden-account-mailer-staging')
        )
          result = { default_environment: { environment: 'production' } }
        else if (url.includes('/subdomain'))
          result = { enabled: false, previews_enabled: false }
        else if (url.includes('/routes?') || url.includes('/domains/records'))
          result = []
        else if (url.includes('/schedules')) result = { schedules: [] }
        else if (url.includes('/script-settings'))
          result = {
            logpush: false,
            observability: { enabled: true, head_sampling_rate: 1 },
          }
        else if (url.includes('/queues?'))
          result = [
            {
              queue_name: env.queues.consumers[0].queue,
              consumers: [
                {
                  script: env.name,
                  dead_letter_queue: badDlq
                    ? 'wrong-dlq'
                    : env.queues.consumers[0].dead_letter_queue,
                  settings: {
                    batch_size: 10,
                    max_retries: 3,
                    max_wait_time_ms: 1000,
                    retry_delay: 60,
                    max_concurrency: 1,
                  },
                },
              ],
            },
          ]
        else throw Error('unexpected synthetic GET')
        return new Response(
          JSON.stringify({ success: true, result, errors: [] }),
          { status: 200 },
        )
      }
      const promise = release(
        [
          'first-deploy',
          '--target',
          'staging',
          '--config',
          'wrangler.account-mailer.jsonc',
          '--commit',
          sha,
          '--secrets-file',
          secretFile,
          '--execute',
          '--confirm',
          'staging',
        ],
        { ...fx, runner, fetch: fetcher, cwd: process.cwd() },
      )
      if (badDlq) await expect(promise).rejects.toThrow('serving_unverified')
      else
        await expect(promise).resolves.toMatchObject({
          activeVersion: newVersion,
        })
      const journal = readFileSync(
        join(fx.root, 'honowarden/release/staging/test-run/journal.jsonl'),
        'utf8',
      )
      expect(journal).not.toContain('synthetic-secret-value')
      expect(copiedSecretFile && existsSync(copiedSecretFile)).toBe(false)
      expect(journal).toContain('secret_copy_removed')
      if (badDlq) expect(journal).toContain('serving_unverified')
    }
  })

  it('activates one exact version at 100 percent after predecessor readback', async () => {
    const fx = fixture()
    seedVaultEvidence(fx)
    let active = oldVersion
    const calls: string[][] = []
    const reads: string[] = []
    const runner = async (command: string, args: string[]) => {
      calls.push([command, ...args])
      if (command === 'wrangler' && args.includes('status'))
        return {
          stdout: JSON.stringify({
            versions: [{ version_id: active, percentage: 100 }],
          }),
          code: 0,
        }
      if (command === 'wrangler' && args.includes('deploy')) {
        active = newVersion
        return { stdout: '', code: 0 }
      }
      return fx.runner(command, args)
    }
    await expect(
      release(
        [
          'activate',
          '--target',
          'staging',
          '--version',
          newVersion,
          '--expect-active',
          oldVersion,
          '--execute',
          '--confirm',
          'staging',
        ],
        {
          ...fx,
          runner,
          fetch: async (input: RequestInfo | URL) => {
            reads.push(String(input))
            if (String(input).includes('/script-settings'))
              return new Response(
                JSON.stringify({
                  success: true,
                  errors: [],
                  result: { logpush: true, observability: { enabled: true } },
                }),
                { status: 200 },
              )
            return vaultRead(input)
          },
          cwd: process.cwd(),
        },
      ),
    ).resolves.toMatchObject({ activeVersion: newVersion })
    const deploy = calls.find((call) => call.includes('deploy')) ?? []
    expect(deploy).toContain(`${newVersion}@100%`)
    expect(deploy).toContain('--yes')
    expect(deploy).toContain('--env-file')
    expect(
      reads.some((url) => url.includes('/environments/production/subdomain')),
    ).toBe(true)
    expect(reads.some((url) => url.endsWith('/environments/production'))).toBe(
      true,
    )
  })

  it.each([
    ['subdomain', 'nonversioned_settings_mismatch'],
    ['migration', 'durable_object_migration_mismatch'],
  ] as const)(
    'verify refuses %s drift after candidate proof',
    async (kind, reason) => {
      const fx = fixture()
      seedVaultEvidence(fx)
      const runner = async (command: string, args: string[]) => {
        if (command === 'wrangler' && args.includes('status'))
          return {
            stdout: JSON.stringify({
              versions: [{ version_id: newVersion, percentage: 100 }],
            }),
            code: 0,
          }
        return fx.runner(command, args)
      }
      const fetcher = (input: RequestInfo | URL) => {
        const url = String(input)
        if (kind === 'subdomain' && url.includes('/subdomain'))
          return new Response(
            JSON.stringify({
              success: true,
              errors: [],
              result: { enabled: true, previews_enabled: false },
            }),
            { status: 200 },
          )
        if (kind === 'migration' && url.endsWith('/environments/production'))
          return new Response(
            JSON.stringify({
              success: true,
              errors: [],
              result: { script: { migration_tag: 'v0' } },
            }),
            { status: 200 },
          )
        return vaultRead(input)
      }
      await expect(
        release(['verify', '--target', 'staging', '--version', newVersion], {
          ...fx,
          runner,
          fetch: fetcher,
          cwd: process.cwd(),
        }),
      ).rejects.toThrow(reason)
    },
  )

  it('journals an omitted observability rate as unverified when config expects another value', async () => {
    const fx = fixture()
    seedVaultEvidence(fx)
    const cwd = join(fx.root, 'source')
    mkdirSync(cwd)
    const config = parseJsonc(
      readFileSync(join(process.cwd(), 'wrangler.jsonc'), 'utf8'),
    )
    config.env.staging.observability.head_sampling_rate = 0.5
    writeFileSync(join(cwd, 'wrangler.jsonc'), JSON.stringify(config))
    mkdirSync(join(cwd, 'deploy/profiles'), { recursive: true })
    writeFileSync(
      join(cwd, 'deploy/profiles/staging-company-launch.json'),
      readFileSync(
        join(process.cwd(), 'deploy/profiles/staging-company-launch.json'),
      ),
    )
    let active = oldVersion
    const runner = async (command: string, args: string[]) => {
      if (command === 'wrangler' && args.includes('status'))
        return {
          stdout: JSON.stringify({
            versions: [{ version_id: active, percentage: 100 }],
          }),
          code: 0,
        }
      if (command === 'wrangler' && args.includes('deploy')) {
        active = newVersion
        return { stdout: '', code: 0 }
      }
      return fx.runner(command, args)
    }
    const fetcher = (input: RequestInfo | URL) =>
      String(input).includes('/script-settings')
        ? new Response(
            JSON.stringify({
              success: true,
              errors: [],
              result: { logpush: true, observability: { enabled: true } },
            }),
            { status: 200 },
          )
        : vaultRead(input)
    await expect(
      release(
        [
          'activate',
          '--target',
          'staging',
          '--version',
          newVersion,
          '--expect-active',
          oldVersion,
          '--execute',
          '--confirm',
          'staging',
        ],
        { ...fx, runner, fetch: fetcher, cwd },
      ),
    ).rejects.toThrow('serving_unverified')
    const journal = readFileSync(
      join(fx.root, 'honowarden/release/staging/test-run/journal.jsonl'),
      'utf8',
    )
    expect(journal).toContain('observability_unverified')
  })

  it('classifies an active version with mismatched serving settings as serving_unverified', async () => {
    const fx = fixture()
    seedVaultEvidence(fx)
    let active = oldVersion
    const runner = async (command: string, args: string[]) => {
      if (command === 'wrangler' && args.includes('status'))
        return {
          stdout: JSON.stringify({
            versions: [{ version_id: active, percentage: 100 }],
          }),
          code: 0,
        }
      if (command === 'wrangler' && args.includes('deploy')) {
        active = newVersion
        return { stdout: '', code: 0 }
      }
      return fx.runner(command, args)
    }
    const fetcher = (input: RequestInfo | URL) => {
      if (String(input).includes('/subdomain'))
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              result: { enabled: true, previews_enabled: false },
              errors: [],
            }),
            { status: 200 },
          ),
        )
      return Promise.resolve(vaultRead(input))
    }
    await expect(
      release(
        [
          'activate',
          '--target',
          'staging',
          '--version',
          newVersion,
          '--expect-active',
          oldVersion,
          '--execute',
          '--confirm',
          'staging',
        ],
        {
          ...fx,
          runner,
          fetch: fetcher,
          cwd: process.cwd(),
        },
      ),
    ).rejects.toThrow('serving_unverified')
    const journal = readFileSync(
      join(fx.root, 'honowarden/release/staging/test-run/journal.jsonl'),
      'utf8',
    )
    expect(journal).toContain('serving_unverified')
  })

  it('verifies browser-facing health and exact source/version provenance with bounded reads', async () => {
    const fx = fixture()
    seedVaultEvidence(fx, true)
    const config = parseJsonc(
      readFileSync(join(process.cwd(), 'wrangler.jsonc'), 'utf8'),
    )
    const bindings = vaultBindings(true)
    const runner = async (command: string, args: string[]) => {
      if (command === 'wrangler' && args.includes('status'))
        return {
          stdout: JSON.stringify({
            versions: [{ version_id: newVersion, percentage: 100 }],
          }),
          code: 0,
        }
      if (args.includes('view'))
        return {
          stdout: JSON.stringify({
            id: newVersion,
            annotations: {
              'workers/tag': sha,
              'workers/message': `HonoWarden vault staging ${sha}`,
            },
            resources: {
              script_runtime: { compatibility_date: config.compatibility_date },
              bindings,
            },
          }),
          code: 0,
        }
      return fx.runner(command, args)
    }
    const requested: string[] = []
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('https://api.cloudflare.com/')) return vaultRead(input)
      requested.push(url)
      expect(init?.redirect).toBe('manual')
      expect(
        String((init?.headers as Record<string, string>)['User-Agent']),
      ).toContain('Mozilla/5.0')
      if (url.endsWith('/admin/index.html'))
        return new Response(adminBytes, {
          status: 200,
          headers: {
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
            'X-Content-Type-Options': 'nosniff',
            'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
            'Content-Security-Policy':
              "default-src 'none'; frame-ancestors 'none'",
          },
        })
      const data = url.endsWith('/health')
        ? { status: 'ok', build: { gitSha: sha, workerVersionId: newVersion } }
        : url.endsWith('/health/db')
          ? { status: 'ok' }
          : { gitHash: sha }
      return new Response(JSON.stringify(data), { status: 200 })
    }
    await expect(
      release(
        [
          'verify',
          '--target',
          'staging',
          '--version',
          newVersion,
          '--expect-initial-setup',
          'on',
        ],
        {
          ...fx,
          runner,
          fetch: fetcher,
          cwd: process.cwd(),
        },
      ),
    ).resolves.toMatchObject({
      activeVersion: newVersion,
      initialSetupEnabled: true,
    })
    expect(requested).toEqual([
      'https://vault-staging.honowarden.com/health',
      'https://vault-staging.honowarden.com/health/db',
      'https://vault-staging.honowarden.com/api/config',
      'https://vault-staging.honowarden.com/admin/index.html',
    ])
  })
})

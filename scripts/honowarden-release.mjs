#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { setTimeout } from 'node:timers'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

import { parse as parseJsonc, parseTree } from 'jsonc-parser'

const exec = promisify(execFile)
const shaPattern = /^[a-f0-9]{40}$/u
// Review gate: an identity still pinned to this all-zero value refuses every live command.
const REPLACE_WITH_ACCOUNT_SHA256 =
  '0000000000000000000000000000000000000000000000000000000000000000'
// SHA-256 of the approved HonoWarden Cloudflare account ID (gHive), pinned for both targets.
const HONOWARDEN_ACCOUNT_SHA256 =
  'eda2523850f958ea68a217fd58159ff49203364827b27933e3ae6e06f42b7cb3'
const versionPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u
const identity = Object.freeze({
  interx: {
    accountIdSha256:
      '3f641d358e0972f1644ced98730b4d808da031fb3d51285364a77af74f8865b5',
    vault: {
      name: 'honowarden-interx',
      host: 'honowarden.interx.co.jp',
      db: 'honowarden-interx',
      dbId: '6acc3d1a-0622-4cf8-9183-bb6e6142a220',
      inquiryDb: 'honowarden-interx-inquiry',
      inquiryDbId: '7ebaf8ce-4384-4f20-b0ba-7ea24443731a',
      r2: 'honowarden-interx-vault-objects',
    },
    invitation: { name: 'honowarden-interx-invitation-mailer' },
    account: {
      name: 'honowarden-interx-account-mailer',
      queues: [
        'honowarden-interx-account-mail',
        'honowarden-interx-account-mail-dlq',
      ],
    },
  },
  staging: {
    accountIdSha256: HONOWARDEN_ACCOUNT_SHA256,
    vault: {
      name: 'honowarden-staging',
      host: 'vault-staging.honowarden.com',
      db: 'honowarden-staging',
      dbId: '95cd44de-809f-473c-9972-f892fa32ceb8',
      inquiryDb: 'honowarden-inquiry-staging',
      inquiryDbId: '73912ec8-7da4-4e1e-85c8-09ce9c177f9f',
      r2: 'honowarden-staging-vault-objects',
    },
    invitation: { name: 'honowarden-invitation-mailer-staging' },
    account: {
      name: 'honowarden-account-mailer-staging',
      queues: [
        'honowarden-account-mail-staging',
        'honowarden-account-mail-staging-dlq',
      ],
    },
  },
  production: {
    accountIdSha256: HONOWARDEN_ACCOUNT_SHA256,
    vault: {
      name: 'honowarden',
      host: 'vault.honowarden.com',
      db: 'honowarden',
      dbId: '21ef7fa8-f26d-4024-82cb-c7b88ee02433',
      inquiryDb: 'honowarden-inquiry',
      inquiryDbId: '00aa46fa-057c-4409-b344-6fa3b61c00dc',
      r2: 'honowarden-vault-objects',
    },
    invitation: { name: 'honowarden-invitation-mailer' },
    account: {
      name: 'honowarden-account-mailer',
      queues: ['honowarden-account-mail', 'honowarden-account-mail-dlq'],
    },
  },
})
const secretNames = Object.freeze({
  vault: new Set([
    'HONOWARDEN_TOKEN_SECRET',
    'HONOWARDEN_TOTP_SECRET',
    'HONOWARDEN_ORGANIZATION_INVITE_SECRET',
    'HONOWARDEN_ACCOUNT_LIFECYCLE_TOKEN_SECRET',
    'HONOWARDEN_BOOTSTRAP_TOKEN',
  ]),
  invitation: new Set(),
  account: new Set(['HONOWARDEN_ACCOUNT_MAIL_ENCRYPTION_KEYS']),
})
const expectedMigrations = Object.freeze([
  '0001_initial_schema.sql',
  '0002_login_defenses.sql',
  '0003_totp_login.sql',
  '0004_totp_change.sql',
  '0005_device_keys.sql',
  '0006_cipher_attachments.sql',
  '0007_audit_events.sql',
  '0008_request_quotas.sql',
  '0009_inquiry_messages.sql',
  '0010_equivalent_domains.sql',
  '0010a_inquiry_message_reconciliation.sql',
  '0011_inquiry_inbox.sql',
  '0012_auth_requests.sql',
  '0013_auth_request_supersede.sql',
  '0014_organizations.sql',
  '0014a_kdf_population.sql',
  '0015_webauthn.sql',
  '0016_user_key_rotation_wrapper_history.sql',
  '0017_account_lifecycle.sql',
  '0018_text_sends.sql',
  '0019_send_files.sql',
  '0020_personal_api_keys.sql',
  '0021_emergency_access.sql',
  '0022_user_key_id.sql',
  '0023_device_session_binding.sql',
  '0024_organization_invitations.sql',
  '0025_organization_groups.sql',
  '0026_organization_policies.sql',
  '0027_session_mfa_assurance.sql',
  '0028_organization_audit_scope_index.sql',
  '0029_organization_membership_mutation_marker.sql',
  '0030_organization_policy_mutation_marker.sql',
  '0031_email_verification.sql',
  '0032_company_settings.sql',
  '0033_initial_setup.sql',
])
const mutable = new Set([
  'initialize-db',
  'backup-db',
  'migrate-db',
  'upload',
  'activate',
  'ensure-queues',
  'first-deploy',
  'generate-secrets',
])
const options = new Set([
  'credentials-file',
  'target',
  'commit',
  'expect-active',
  'expect-pending',
  'version',
  'config',
  'secrets-file',
  'confirm',
  'profile',
  'out',
  'rotate',
  'expect-module-sha256',
  'expect-admin-manifest',
  'expect-initial-setup',
])

const fail = (code) => {
  throw new Error(code)
}
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const validBookmark = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 512 &&
  /^[\x21-\x7e]+$/u.test(value)
function fileDigest(file) {
  const hash = createHash('sha256')
  const fd = fs.openSync(file, 'r')
  const chunk = Buffer.allocUnsafe(1024 * 1024)
  try {
    for (;;) {
      const bytes = fs.readSync(fd, chunk, 0, chunk.length, null)
      if (!bytes) break
      hash.update(chunk.subarray(0, bytes))
    }
    return hash.digest('hex')
  } finally {
    chunk.fill(0)
    fs.closeSync(fd)
  }
}

function migrationManifest(cwd) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(cwd, 'deploy/migrations.manifest.json'), 'utf8'),
  )
  const names = fs.readdirSync(path.join(cwd, 'migrations')).sort()
  if (
    JSON.stringify(names) !== JSON.stringify([...expectedMigrations].sort()) ||
    JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify(names)
  )
    fail('migration_files_unreviewed')
  for (const name of names)
    if (manifest[name] !== fileDigest(path.join(cwd, 'migrations', name)))
      fail('migration_content_unreviewed')
  return names
}

function schemaManifest(cwd, baseline = false) {
  const rows = JSON.parse(
    fs.readFileSync(
      path.join(
        cwd,
        baseline
          ? 'deploy/schema-0014.manifest.json'
          : 'deploy/schema.manifest.json',
      ),
      'utf8',
    ),
  )
  if (
    !Array.isArray(rows) ||
    rows.length !== (baseline ? 62 : 108) ||
    rows.some(
      (row) =>
        !['table', 'index', 'trigger'].includes(row.type) ||
        typeof row.name !== 'string' ||
        typeof row.tbl_name !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(row.sqlSha256 ?? ''),
    )
  )
    fail('schema_manifest_invalid')
  return rows
}

function schemaProof(rows) {
  return rows.map((row) => ({
    type: row.type,
    name: row.name,
    tbl_name: row.tbl_name,
    sqlSha256: typeof row.sql === 'string' ? digest(row.sql) : null,
  }))
}

function scrubSql(sql) {
  // Strip comments outside quoted SQL tokens before comparing trigger bodies.
  let out = ''
  let quote = null
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    const next = sql[i + 1]
    if (quote) {
      out += ch
      if (ch === quote) {
        if (next === quote) out += sql[++i]
        else quote = null
      }
    } else if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      out += ch
    } else if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      out += ' '
    } else if (ch === '/' && next === '*') {
      i += 2
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i++
      out += ' '
    } else out += ch
  }
  return out.replace(/\s+/gu, ' ').trim()
}

function writeSecretCopy(file, secrets) {
  const fd = fs.openSync(file, 'wx', 0o600)
  try {
    fs.fchmodSync(fd, 0o600)
    fs.writeFileSync(fd, JSON.stringify(secrets))
    fs.fsyncSync(fd)
  } catch (error) {
    fs.closeSync(fd)
    eraseSecretCopy(file)
    throw error
  }
  fs.closeSync(fd)
}

function eraseSecretCopy(file) {
  const fd = fs.openSync(file, 'r+')
  try {
    let remaining = fs.fstatSync(fd).size
    const zeros = Buffer.alloc(64 * 1024)
    let offset = 0
    while (remaining > 0) {
      const n = Math.min(remaining, zeros.length)
      fs.writeSync(fd, zeros, 0, n, offset)
      offset += n
      remaining -= n
    }
    fs.fsyncSync(fd)
  } finally {
    try {
      fs.closeSync(fd)
    } finally {
      fs.unlinkSync(file)
    }
  }
}

function readAdminManifest(file, commit, moduleSha256) {
  const stat = fs.lstatSync(file)
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid() ||
    (stat.mode & 0o777) !== 0o600 ||
    stat.size > 1024 * 1024
  )
    fail('admin_manifest_invalid')
  let assets
  try {
    const content = fs.readFileSync(file, 'utf8')
    if (!file.endsWith('.jsonl')) fail('admin_manifest_invalid')
    const rows = content
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const accepted = rows.filter(
      (row) =>
        row.kind === 'upload_verified' &&
        row.target === 'staging' &&
        row.commit === commit &&
        row.moduleSha256 === moduleSha256 &&
        Array.isArray(row.assets),
    )
    if (accepted.length !== 1) fail('admin_manifest_invalid')
    assets = accepted[0].assets
  } catch {
    fail('admin_manifest_invalid')
  }
  if (
    !Array.isArray(assets) ||
    !assets.length ||
    assets.some(
      (row) =>
        !/^[a-f0-9]{64}$/u.test(row.sha256 ?? '') ||
        typeof row.path !== 'string' ||
        row.path.startsWith('/') ||
        row.path.includes('..') ||
        !Number.isSafeInteger(row.bytes) ||
        row.bytes < 0,
    ) ||
    new Set(assets.map((row) => row.path)).size !== assets.length
  )
    fail('admin_manifest_invalid')
  return assets
}

function recentBackup(root, commit) {
  const now = Date.now()
  const candidates = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const directory = path.join(root, entry.name)
    const journal = path.join(directory, 'journal.jsonl')
    const backupFile = path.join(directory, 'backup.sql')
    try {
      const directoryStat = fs.lstatSync(directory)
      const stat = fs.lstatSync(journal)
      const exportStat = fs.lstatSync(backupFile)
      if (
        !directoryStat.isDirectory() ||
        directoryStat.isSymbolicLink() ||
        directoryStat.uid !== process.getuid() ||
        (directoryStat.mode & 0o777) !== 0o700 ||
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size > 1024 * 1024 ||
        !exportStat.isFile() ||
        exportStat.isSymbolicLink() ||
        (stat.mode & 0o777) !== 0o600 ||
        (exportStat.mode & 0o777) !== 0o600
      )
        continue
      let exportIntent = false
      let exportSuccess = false
      for (const line of fs
        .readFileSync(journal, 'utf8')
        .split('\n')
        .filter(Boolean)) {
        const record = JSON.parse(line)
        const time = Date.parse(record.at)
        if (record.kind === 'intent' && record.operation === 'd1 export') {
          exportIntent = true
          exportSuccess = false
        }
        if (record.kind === 'result' && record.operation === 'd1 export')
          exportSuccess = exportIntent && record.success === true
        if (
          record.kind === 'backup' &&
          exportSuccess &&
          record.commit === commit &&
          now >= time &&
          now - time <= 2 * 60 * 60 * 1000 &&
          validBookmark(record.bookmark) &&
          /^[a-f0-9]{64}$/u.test(record.sha256 ?? '') &&
          exportStat.size === record.bytes &&
          fileDigest(backupFile) === record.sha256
        )
          candidates.push({ ...record, time })
      }
    } catch {
      // A missing, malformed or changed backup is never an admission record.
    }
  }
  candidates.sort((a, b) => b.time - a.time)
  if (!candidates.length) fail('recent_verified_backup_required')
  return candidates[0]
}

function adminAssetHashes(directory) {
  const files = []
  const visit = (relative = '') => {
    for (const name of fs.readdirSync(path.join(directory, relative)).sort()) {
      const file = path.join(directory, relative, name)
      const stat = fs.lstatSync(file)
      if (stat.isSymbolicLink()) fail('admin_asset_symlink')
      if (stat.isDirectory()) {
        fs.chmodSync(file, 0o700)
        visit(path.join(relative, name))
        continue
      }
      if (!stat.isFile() || stat.size > 16 * 1024 * 1024 || files.length >= 256)
        fail('admin_asset_invalid')
      const asset = path.posix.join(relative.split(path.sep).join('/'), name)
      if (
        asset !== 'index.html' &&
        !/^assets\/[a-zA-Z0-9_.-]+\.(?:js|css|wasm)$/u.test(asset)
      )
        fail('admin_asset_path_unreviewed')
      fs.chmodSync(file, 0o600)
      files.push({ path: asset, bytes: stat.size, sha256: fileDigest(file) })
    }
  }
  visit()
  if (!files.some((row) => row.path === 'index.html'))
    fail('admin_index_missing')
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

function versionEvidence(root, version, commit) {
  const candidates = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    try {
      const file = path.join(root, entry.name, 'journal.jsonl')
      const stat = fs.lstatSync(file)
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size > 1024 * 1024 ||
        (stat.mode & 0o777) !== 0o600
      )
        continue
      for (const line of fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)) {
        const row = JSON.parse(line)
        if (
          row.kind === 'upload_verified' &&
          row.version === version &&
          row.commit === commit &&
          /^[a-f0-9]{64}$/u.test(row.moduleSha256 ?? '') &&
          Array.isArray(row.secretNames) &&
          Array.isArray(row.assets)
        )
          candidates.push(row)
      }
    } catch {
      /* invalid evidence is not an admission record */
    }
  }
  candidates.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  if (!candidates.length) fail('version_evidence_missing')
  return candidates[0]
}

export function parseArguments(argv) {
  const [command, ...tokens] = argv
  if (
    ![
      'plan',
      'initialize-db',
      'backup-db',
      'migrate-db',
      'upload',
      'activate',
      'verify',
      'ensure-queues',
      'first-deploy',
      'verify-db',
      'generate-secrets',
    ].includes(command)
  )
    fail('command_invalid')
  const args = { command, execute: false }
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === '--execute') {
      if (args.execute) fail('argument_duplicate')
      args.execute = true
      continue
    }
    if (token === '--initial-setup-window') {
      if (args['initial-setup-window']) fail('argument_duplicate')
      args['initial-setup-window'] = true
      continue
    }
    if (token === '--post-deploy') {
      if (args['post-deploy']) fail('argument_duplicate')
      args['post-deploy'] = true
      continue
    }
    const key = token?.startsWith('--') ? token.slice(2) : ''
    if (
      !options.has(key) ||
      Object.hasOwn(args, key) ||
      (tokens[i + 1] === '' && key !== 'expect-pending') ||
      tokens[i + 1] === undefined ||
      tokens[i + 1].startsWith('--')
    )
      fail('argument_invalid')
    args[key] = tokens[++i]
  }
  if (!Object.hasOwn(identity, args.target)) fail('target_invalid')
  if (command === 'initialize-db' && args.target !== 'interx')
    fail('initialization_target_not_supported')
  if (!args['credentials-file']) fail('credentials_file_required')
  if (args.execute && mutable.has(command) && args.confirm !== args.target)
    fail('target_confirmation_required')
  if (args.confirm && !args.execute) fail('execute_required')
  if (args['initial-setup-window'] && command !== 'upload')
    fail('setup_window_not_supported')
  if (
    args['initial-setup-window'] &&
    ['production', 'interx'].includes(args.target) &&
    args.confirm !== args.target
  )
    fail('target_confirmation_required')
  if (
    args.profile &&
    !['upload', 'first-deploy', 'activate', 'verify'].includes(command)
  )
    fail('profile_not_supported')
  if (command === 'generate-secrets' && !args.out)
    fail('secret_output_required')
  if (args.out && command !== 'generate-secrets') fail('output_not_supported')
  if (
    [
      'plan',
      'initialize-db',
      'upload',
      'first-deploy',
      'backup-db',
      'migrate-db',
      'verify-db',
      'activate',
      'verify',
    ].includes(command) &&
    !shaPattern.test(args.commit ?? '')
  )
    fail('commit_invalid')
  if (
    command === 'upload' &&
    ['production', 'interx'].includes(args.target) &&
    !/^[a-f0-9]{64}$/u.test(args['expect-module-sha256'] ?? '')
  )
    fail('expected_module_sha256_required')
  if (
    ['upload', 'first-deploy'].includes(command) &&
    ['production', 'interx'].includes(args.target) &&
    !args['expect-module-sha256']
  )
    fail('expected_module_sha256_required')
  if (
    args['expect-module-sha256'] &&
    !/^[a-f0-9]{64}$/u.test(args['expect-module-sha256'])
  )
    fail('expected_module_sha256_invalid')
  if (
    ['upload', 'first-deploy'].includes(command) &&
    ['production', 'interx'].includes(args.target) &&
    (!args.config || path.basename(args.config) === 'wrangler.jsonc') &&
    !args['expect-admin-manifest']
  )
    fail('expected_admin_manifest_required')
  if (
    args['expect-admin-manifest'] &&
    (!['upload', 'first-deploy'].includes(command) ||
      !['production', 'interx'].includes(args.target))
  )
    fail('expected_admin_manifest_not_supported')
  if (
    ['activate', 'verify'].includes(command) &&
    !['on', 'off'].includes(args['expect-initial-setup'])
  )
    fail('expected_initial_setup_required')
  if (
    ['upload', 'activate'].includes(command) &&
    !versionPattern.test(args['expect-active'] ?? '')
  )
    fail('predecessor_invalid')
  if (
    ['activate', 'verify'].includes(command) &&
    !versionPattern.test(args.version ?? '')
  )
    fail('version_invalid')
  if (
    ['migrate-db', 'verify-db'].includes(command) &&
    typeof args['expect-pending'] !== 'string'
  )
    fail('expected_migrations_required')
  if (
    ['migrate-db', 'verify-db'].includes(command) &&
    args['expect-pending'] !== '' &&
    !/^\d{4}[a-z]?_[a-z0-9_]+\.sql(?:,\d{4}[a-z]?_[a-z0-9_]+\.sql)*$/u.test(
      args['expect-pending'],
    )
  )
    fail('expected_migrations_invalid')
  if (args['secrets-file'] && !['upload', 'first-deploy'].includes(command))
    fail('secrets_file_not_supported')
  if (args.rotate && command !== 'upload') fail('rotation_not_supported')
  if (args['post-deploy'] && command !== 'verify-db')
    fail('post_deploy_not_supported')
  return args
}

export function expectedAccountSha256(target) {
  return identity[target]?.accountIdSha256
}

export function readCredentialsFile(file, target) {
  const stat = fs.lstatSync(file)
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid() ||
    (stat.mode & 0o777) !== 0o600 ||
    stat.size > 4096
  )
    fail('credentials_file_permissions')
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/u).filter(Boolean)
  const values = new Map()
  for (const line of lines) {
    const equal = line.indexOf('=')
    if (equal < 1 || line.startsWith('#')) fail('credentials_file_shape')
    const key = line.slice(0, equal)
    if (
      ![
        'CLOUDFLARE_HONOWARDEN_RELEASE_TOKEN',
        'CLOUDFLARE_ACCOUNT_ID',
        ...(target === 'interx'
          ? ['CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL']
          : []),
      ].includes(key) ||
      values.has(key)
    )
      fail('credentials_file_shape')
    values.set(key, line.slice(equal + 1))
  }
  const token = values.get('CLOUDFLARE_HONOWARDEN_RELEASE_TOKEN')
  const accountId = values.get('CLOUDFLARE_ACCOUNT_ID')
  if (target === 'interx' && values.has('CLOUDFLARE_API_KEY')) {
    const globalKey = values.get('CLOUDFLARE_API_KEY')
    const email = values.get('CLOUDFLARE_EMAIL')
    if (
      values.size !== 3 ||
      !/^[!-~]+$/u.test(globalKey ?? '') ||
      !/^[^\s@]+@[^\s@]+$/u.test(email ?? '') ||
      !/^[a-f0-9]{32}$/u.test(accountId ?? '')
    )
      fail('credentials_file_shape')
    return { token: { globalKey, email }, accountId }
  }
  if (
    values.size !== 2 ||
    !token ||
    !/^[!-~]+$/u.test(token) ||
    !/^[a-f0-9]{32}$/u.test(accountId ?? '')
  )
    fail('credentials_file_shape')
  return { token, accountId }
}

export function childEnvironment(parent, outputPath, credentials) {
  if (!credentials?.token || !credentials?.accountId)
    fail('scoped_credentials_required')
  // Wrangler's global CLI dotenv hook reads .env, .env.local, .env.<env> and
  // .env.<env>.local with override:true (wrangler-dist/cli.js, getDefaultEnvFiles).
  // --env-file points that hook at our empty private file; the switch below
  // also suppresses its secondary runtime dotenv lookup.
  return {
    PATH: parent.PATH ?? '',
    HOME: parent.HOME ?? os.homedir(),
    ...(typeof credentials.token === 'string'
      ? { CLOUDFLARE_API_TOKEN: credentials.token }
      : {
          CLOUDFLARE_API_KEY: credentials.token.globalKey,
          CLOUDFLARE_EMAIL: credentials.token.email,
        }),
    CLOUDFLARE_ACCOUNT_ID: credentials.accountId,
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    NO_COLOR: '1',
    WRANGLER_SEND_METRICS: 'false',
    // Wrangler 4.112.0 otherwise writes its diagnostic log below HOME.
    // Keep provider text out of persistent operator logs; machine output is
    // captured privately, reduced to an ID, then removed.
    WRANGLER_WRITE_LOGS: 'false',
    WRANGLER_LOG_SANITIZE: 'true',
    WRANGLER_OUTPUT_FILE_PATH: outputPath,
  }
}

export function validateSecretsFile(file, kind, target) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  let input
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile()) fail('secret_file_regular_required')
    if (stat.uid !== process.getuid()) fail('secret_file_owner')
    if ((stat.mode & 0o777) !== 0o600) fail('secret_file_mode')
    if (stat.size > 65536) fail('secret_file_size')
    input = fs.readFileSync(fd, 'utf8')
  } finally {
    fs.closeSync(fd)
  }
  // Only JSON is accepted: Wrangler's --secrets-file supports JSON and .env,
  // but JSON has an unambiguous key set and rejects duplicate names here.
  const errors = []
  const tree = parseTree(input, errors, { disallowComments: true })
  if (errors.length || tree?.type !== 'object') fail('secret_file_json_invalid')
  const duplicate = (node) => {
    if (node.type === 'object') {
      const names =
        node.children?.map((entry) => entry.children?.[0]?.value) ?? []
      if (new Set(names).size !== names.length) return true
    }
    return node.children?.some(duplicate) ?? false
  }
  if (duplicate(tree)) fail('secret_file_duplicate_name')
  let value
  try {
    value = JSON.parse(input)
  } catch {
    fail('secret_file_json_invalid')
  }
  if (!value || Array.isArray(value) || typeof value !== 'object')
    fail('secret_file_json_invalid')
  if (
    Object.keys(value).sort().join(',') !== 'secrets,target' ||
    value.target !== target ||
    !value.secrets ||
    Array.isArray(value.secrets) ||
    typeof value.secrets !== 'object'
  )
    fail('secret_file_target_or_shape')
  const keys = Object.keys(value.secrets)
  if (!keys.length || keys.some((key) => !secretNames[kind]?.has(key)))
    fail('secret_name_not_allowed')
  if (
    keys.some(
      (key) =>
        typeof value.secrets[key] !== 'string' ||
        value.secrets[key].length === 0,
    )
  )
    fail('secret_value_invalid')
  return { names: keys.sort(), secrets: value.secrets }
}

function releaseProfile(cwd, args, info) {
  if (!args.profile) return null
  if (info.kind !== 'vault') fail('profile_vault_only')
  const file = path.resolve(cwd, args.profile)
  const directory = path.join(cwd, 'deploy/profiles')
  if (path.dirname(file) !== directory || !file.endsWith('.json'))
    fail('profile_path_invalid')
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536)
    fail('profile_file_invalid')
  const input = fs.readFileSync(file, 'utf8')
  const errors = []
  const tree = parseTree(input, errors, { disallowComments: true })
  const hasDuplicates = (node) => {
    if (node.type === 'object') {
      const keys = node.children?.map((item) => item.children?.[0]?.value) ?? []
      if (new Set(keys).size !== keys.length) return true
    }
    return node.children?.some(hasDuplicates) ?? false
  }
  if (tree?.type !== 'object' || hasDuplicates(tree))
    fail('profile_file_invalid')
  const parsed = parseJsonc(input, errors, { disallowComments: true })
  if (
    errors.length ||
    !parsed ||
    Object.keys(parsed).sort().join(',') !== 'target,vars' ||
    parsed.target !== args.target ||
    !parsed.vars ||
    Array.isArray(parsed.vars) ||
    typeof parsed.vars !== 'object'
  )
    fail('profile_target_or_shape_invalid')
  for (const [key, value] of Object.entries(parsed.vars))
    if (
      !Object.hasOwn(info.env.vars ?? {}, key) ||
      typeof value !== 'string' ||
      key === 'HONOWARDEN_INITIAL_SETUP_ENABLED'
    )
      fail('profile_var_invalid')
  return { file, sha256: digest(input), vars: parsed.vars }
}

function generatedSecrets(kind, existing) {
  const random = () => randomBytes(48).toString('base64url')
  if (kind === 'invitation') fail('secrets_not_required_for_worker')
  const secrets = {}
  for (const name of secretNames[kind]) {
    if (existing.has(name)) continue
    secrets[name] =
      name === 'HONOWARDEN_ACCOUNT_MAIL_ENCRYPTION_KEYS'
        ? JSON.stringify({
            'account-mail-1': randomBytes(32).toString('base64url'),
          })
        : random()
  }
  return secrets
}

function versionSecretNames(view) {
  const bindings = view?.resources?.bindings
  if (!Array.isArray(bindings)) fail('version_bindings_unresolved')
  const names = bindings
    .filter((row) => row.type === 'secret_text')
    .map((row) => row.name)
  if (
    names.some((name) => typeof name !== 'string') ||
    new Set(names).size !== names.length
  )
    fail('version_secret_names_unresolved')
  return new Set(names)
}

export function activeVersion(status) {
  if (
    !status ||
    !Array.isArray(status.versions) ||
    status.versions.length !== 1
  )
    fail('deployment_distribution_invalid')
  const row = status.versions[0]
  if (!versionPattern.test(row.version_id ?? '') || row.percentage !== 100)
    fail('deployment_distribution_invalid')
  return row.version_id
}

function configIdentity(cwd, args) {
  const basename = args.config ? path.basename(args.config) : 'wrangler.jsonc'
  const kind =
    basename === 'wrangler.jsonc'
      ? 'vault'
      : basename === 'wrangler.invitation-mailer.jsonc'
        ? 'invitation'
        : basename === 'wrangler.account-mailer.jsonc'
          ? 'account'
          : null
  if (
    !kind ||
    (args.config && path.resolve(cwd, args.config) !== path.join(cwd, basename))
  )
    fail('config_path_invalid')
  const file = path.join(cwd, basename)
  if (!fs.existsSync(file)) fail('config_missing')
  const errors = []
  const config = parseJsonc(fs.readFileSync(file, 'utf8'), errors, {
    allowTrailingComma: true,
  })
  if (errors.length || !config || typeof config !== 'object')
    fail('config_invalid')
  const env = config.env?.[args.target]
  const expected = identity[args.target][kind]
  if (!env || env.name !== expected.name) fail('target_identity_mismatch')
  if (kind === 'vault') {
    if (
      env.routes?.length !== 1 ||
      env.routes[0].pattern !== expected.host ||
      env.routes[0].custom_domain !== true
    )
      fail('target_identity_mismatch')
    const db = env.d1_databases?.find((row) => row.binding === 'DB')
    const inquiry = env.d1_databases?.find(
      (row) => row.binding === 'INQUIRY_DB',
    )
    if (
      env.d1_databases?.length !== 2 ||
      db?.database_name !== expected.db ||
      db.database_id !== expected.dbId ||
      inquiry?.database_name !== expected.inquiryDb ||
      inquiry.database_id !== expected.inquiryDbId ||
      env.r2_buckets?.length !== 1 ||
      env.r2_buckets[0].binding !== 'VAULT_OBJECTS' ||
      env.r2_buckets[0].bucket_name !== expected.r2
    )
      fail('target_identity_mismatch')
    if (
      (db.migrations_dir && db.migrations_dir !== 'migrations') ||
      (db.migrations_table && db.migrations_table !== 'd1_migrations') ||
      (db.migrations_pattern && db.migrations_pattern !== 'migrations/*.sql')
    )
      fail('migration_config_unreviewed')
    if (
      env.assets?.binding !== 'ADMIN_ASSETS' ||
      env.version_metadata?.binding !== 'CF_VERSION_METADATA'
    )
      fail('target_identity_mismatch')
    const expectedServices = {
      ORGANIZATION_MEMBERSHIP_MAILER: identity[args.target].invitation.name,
      ACCOUNT_LIFECYCLE_MAILER: identity[args.target].account.name,
    }
    if (
      env.services?.length !== Object.keys(expectedServices).length ||
      new Set(env.services.map((service) => service.binding)).size !==
        env.services.length ||
      env.services.some(
        (service) => expectedServices[service.binding] !== service.service,
      )
    )
      fail('target_identity_mismatch')
  } else {
    // Conservative effective configuration: reject an exposure even if a
    // Wrangler field is currently non-inheritable across env boundaries.
    for (const field of [
      'route',
      'routes',
      'assets',
      'triggers',
      'd1_databases',
      'r2_buckets',
      'kv_namespaces',
      'durable_objects',
    ]) {
      const top = config[field]
      const selected = env[field]
      const exposed = (value) =>
        value &&
        (Array.isArray(value)
          ? value.length > 0
          : typeof value === 'object'
            ? Object.keys(value).length > 0
            : true)
      if (exposed(top) || exposed(selected)) {
        if (
          field !== 'routes' ||
          (top?.length ?? 0) > 0 ||
          (selected?.length ?? 0) > 0
        )
          fail('mailer_effective_exposure')
      }
    }
    if (
      (env.routes?.length ?? 0) !== 0 ||
      env.workers_dev !== false ||
      env.preview_urls !== false ||
      (env.d1_databases?.length ?? 0) !== 0 ||
      (env.r2_buckets?.length ?? 0) !== 0 ||
      env.assets
    )
      fail('target_identity_mismatch')
    if (kind === 'account') {
      const queueNames = [
        ...(env.queues?.producers ?? []).map((row) => row.queue),
        ...(env.queues?.consumers ?? []).flatMap((row) =>
          [row.queue, row.dead_letter_queue].filter(Boolean),
        ),
      ]
      if (
        !queueNames.includes(expected.queues[0]) ||
        !queueNames.includes(expected.queues[1]) ||
        queueNames.some((name) => !expected.queues.includes(name))
      )
        fail('target_identity_mismatch')
    }
  }
  return { basename, kind, config, env, expected }
}

async function defaultRunner(command, args, opts) {
  let executable = command
  if (command === 'wrangler') {
    requireReviewedWrangler(opts.cwd)
    executable = path.join(opts.cwd, 'node_modules/.bin/wrangler')
  }
  if (command === 'vite')
    executable = path.join(opts.cwd, 'node_modules/.bin/vite')
  try {
    const { stdout } = await exec(executable, args, {
      cwd: opts.cwd,
      env: opts.env,
      timeout: opts.timeout ?? 30000,
      maxBuffer: 4 * 1024 * 1024,
    })
    return { stdout, code: 0 }
  } catch (error) {
    // CLI text may contain bindings, provider data, or diagnostics. Never pass
    // stdout/stderr through our error or journal boundary.
    return { stdout: '', code: typeof error.code === 'number' ? error.code : 1 }
  }
}

function requireReviewedWrangler(cwd) {
  const packagePath = path.join(cwd, 'node_modules/wrangler/package.json')
  let installed
  try {
    installed = JSON.parse(fs.readFileSync(packagePath, 'utf8')).version
  } catch {
    fail('wrangler_install_missing')
  }
  if (installed !== '4.112.0') fail('wrangler_version_unreviewed')
}

export async function release(argv, deps = {}) {
  const args = parseArguments(argv)
  const cwd = deps.cwd ?? process.cwd()
  const credentials = readCredentialsFile(
    path.resolve(cwd, args['credentials-file']),
    args.target,
  )
  const pinnedAccountSha256 =
    deps.expectedAccountSha256 && deps.runner
      ? deps.expectedAccountSha256
      : expectedAccountSha256(args.target)
  if (
    pinnedAccountSha256 === REPLACE_WITH_ACCOUNT_SHA256 ||
    !/^[a-f0-9]{64}$/u.test(pinnedAccountSha256 ?? '') ||
    digest(credentials.accountId) !== pinnedAccountSha256
  )
    fail('account_pin_unconfigured_or_mismatch')
  if (args['secrets-file'])
    args['secrets-file'] = path.resolve(cwd, args['secrets-file'])
  if (args.out) args.out = path.resolve(cwd, args.out)
  const parent = deps.env ?? process.env
  const run = deps.runner ?? defaultRunner
  const info =
    args.command === 'generate-secrets'
      ? (() => {
          const basename = args.config
            ? path.basename(args.config)
            : 'wrangler.jsonc'
          const kind =
            basename === 'wrangler.jsonc'
              ? 'vault'
              : basename === 'wrangler.account-mailer.jsonc'
                ? 'account'
                : basename === 'wrangler.invitation-mailer.jsonc'
                  ? 'invitation'
                  : null
          if (
            !kind ||
            (args.config &&
              path.resolve(cwd, args.config) !== path.join(cwd, basename))
          )
            fail('config_path_invalid')
          return {
            basename,
            kind,
            expected: identity[args.target][kind],
            config: {},
            env: {},
          }
        })()
      : configIdentity(cwd, args)
  const profile = releaseProfile(cwd, args, info)
  if (args['expect-admin-manifest'] && info.kind !== 'vault')
    fail('expected_admin_manifest_not_supported')
  if (
    ['activate', 'verify'].includes(args.command) &&
    info.kind === 'vault' &&
    !profile
  )
    fail('profile_required')
  if (info.kind !== 'vault' && args['expect-initial-setup'] === 'on')
    fail('setup_window_vault_only')
  if (
    [info.config.account_id, info.env.account_id].some(
      (id) => id !== undefined && id !== credentials.accountId,
    )
  )
    fail('account_config_mismatch')
  const plan = {
    command: args.command,
    target: args.target,
    worker: info.expected.name,
    config: info.basename,
    host: info.expected.host ?? null,
    database:
      info.env.d1_databases?.find((db) => db.binding === 'DB')?.database_name ??
      null,
    routes: info.env.routes ?? [],
    services: info.env.services ?? [],
    d1Databases: info.env.d1_databases ?? [],
    r2Buckets: info.env.r2_buckets ?? [],
    queues: info.expected.queues ?? [],
    profile: profile ? { path: profile.file, sha256: profile.sha256 } : null,
  }
  if (mutable.has(args.command) && !args.execute)
    return { plan, execute: false }
  if (!deps.runner) requireReviewedWrangler(cwd)

  const root = path.join(
    parent.XDG_STATE_HOME ??
      path.join(parent.HOME ?? os.homedir(), '.local/state'),
    'honowarden/release',
    args.target,
  )
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  const rootStat = fs.lstatSync(root)
  if (
    !rootStat.isDirectory() ||
    rootStat.isSymbolicLink() ||
    rootStat.uid !== process.getuid() ||
    (rootStat.mode & 0o777) !== 0o700
  )
    fail('state_directory_permissions')
  const lock = path.join(root, '.lock')
  let lockFd
  try {
    lockFd = fs.openSync(lock, 'wx', 0o600)
  } catch (error) {
    if (error.code === 'EEXIST') fail('release_lock_held')
    throw error
  }
  const runId =
    deps.runId ??
    `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`
  const runDir = path.join(root, runId)
  const journalPath = path.join(runDir, 'journal.jsonl')
  const emptyEnv = path.join(runDir, 'empty.env')
  let journalFd
  try {
    fs.mkdirSync(runDir, { mode: 0o700 })
    journalFd = fs.openSync(journalPath, 'wx', 0o600)
    fs.writeFileSync(emptyEnv, '', { mode: 0o600, flag: 'wx' })
  } catch (error) {
    if (journalFd !== undefined) fs.closeSync(journalFd)
    fs.closeSync(lockFd)
    fs.unlinkSync(lock)
    throw error
  }
  const record = (kind, data = {}) => {
    fs.writeSync(
      journalFd,
      `${JSON.stringify({ at: new Date().toISOString(), kind, ...data })}\n`,
    )
    fs.fsyncSync(journalFd)
  }
  let sequence = 0
  const wrangler = async (parts, { effect = false, timeout = 30000 } = {}) => {
    const output = path.join(runDir, `wrangler-${++sequence}.jsonl`)
    fs.writeFileSync(output, '', { mode: 0o600, flag: 'wx' })
    const child = childEnvironment(parent, output, credentials)
    const commandArgs = [
      ...parts,
      '-c',
      info.basename,
      '--env',
      args.target,
      '--env-file',
      emptyEnv,
      '--no-experimental-provision',
    ]
    if (effect) record('intent', { operation: parts.slice(0, 2).join(' ') })
    let result
    try {
      result = await run('wrangler', commandArgs, { cwd, env: child, timeout })
    } catch {
      result = { stdout: '', code: 1 }
    }
    if (effect)
      record('result', {
        operation: parts.slice(0, 2).join(' '),
        success: result.code === 0,
      })
    let uploadIds = []
    try {
      if (
        result.code === 0 &&
        parts[0] === 'versions' &&
        parts[1] === 'upload' &&
        !parts.includes('--dry-run')
      ) {
        if (fs.statSync(output).size > 1024 * 1024)
          fail('wrangler_output_limit')
        const lines = fs
          .readFileSync(output, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
        uploadIds = lines
          .map((line) => JSON.parse(line))
          .filter((entry) => entry.type === 'version-upload')
          .map((entry) => entry.version_id)
      }
    } catch {
      fail('wrangler_output_invalid')
    } finally {
      fs.unlinkSync(output)
    }
    if (result.code !== 0)
      fail(effect ? 'effect_ambiguous' : 'wrangler_read_failed')
    return { stdout: result.stdout, uploadIds }
  }
  const json = async (parts) => {
    const { stdout } = await wrangler(parts)
    try {
      return JSON.parse(stdout)
    } catch {
      fail('wrangler_json_invalid')
    }
  }
  const status = async () =>
    activeVersion(await json(['deployments', 'status', '--json']))
  const authenticate = async () => {
    const who = await json(['whoami', '--json'])
    const globalAuth =
      args.target === 'interx' && typeof credentials.token === 'object'
    if (
      who.loggedIn !== true ||
      who.authType !== (globalAuth ? 'Global API Key' : 'User API Token') ||
      (!globalAuth && who.accounts?.length !== 1) ||
      who.accounts?.filter((account) => account.id === credentials.accountId)
        .length !== 1
    )
      fail('account_mismatch')
  }
  const source = async () => {
    const git = async (parts) => {
      const result = await run('git', parts, {
        cwd,
        env: { PATH: parent.PATH ?? '', HOME: parent.HOME ?? '' },
      })
      if (result.code !== 0) fail('git_read_failed')
      return result.stdout.trim()
    }
    if ((await git(['status', '--porcelain'])) !== '') fail('worktree_dirty')
    if ((await git(['rev-parse', 'HEAD'])) !== args.commit)
      fail('commit_mismatch')
  }
  const pending = async () => {
    const names = migrationManifest(cwd)
    // Wrangler 4.112.0 `d1 migrations list` calls initMigrationsTable(),
    // issuing CREATE TABLE IF NOT EXISTS even for a plan. Use its JSON D1
    // execute path with a fixed SELECT so this phase cannot create schema.
    const ledger = await json([
      'd1',
      'execute',
      'DB',
      '--remote',
      '--command',
      'SELECT name FROM d1_migrations ORDER BY id',
      '--json',
    ])
    const rows = ledger?.[0]?.results
    if (
      !Array.isArray(ledger) ||
      ledger.length !== 1 ||
      !Array.isArray(rows) ||
      rows.some((row) => typeof row.name !== 'string')
    )
      fail('migration_ledger_unresolved')
    const applied = rows.map((row) => row.name)
    const appliedSet = new Set(applied)
    if (
      !names.length ||
      appliedSet.size !== applied.length ||
      applied.some((name) => !names.includes(name))
    )
      fail('migration_ledger_drift')
    const highest = Math.max(-1, ...applied.map((name) => names.indexOf(name)))
    if (names.slice(0, highest + 1).some((name) => !appliedSet.has(name)))
      fail('migration_ledger_drift')
    return names.filter((name) => !appliedSet.has(name))
  }
  const readDbRows = async (command) => {
    const response = await json([
      'd1',
      'execute',
      'DB',
      '--remote',
      '--json',
      '--command',
      command,
    ])
    if (
      !Array.isArray(response) ||
      response.length !== 1 ||
      response[0]?.success === false ||
      !Array.isArray(response[0]?.results)
    )
      fail('schema_readback_unresolved')
    return response[0].results
  }
  const verifyDb = async () => {
    const ledger = await readDbRows('SELECT COUNT(*) AS n FROM d1_migrations')
    const versions = await readDbRows(
      'SELECT COUNT(*) AS n, MAX(version) AS version FROM schema_migrations',
    )
    const objects = await readDbRows(
      "SELECT type, COUNT(*) AS n FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT IN ('_cf_KV', 'd1_migrations') GROUP BY type",
    )
    const schemaObjects = await readDbRows(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT IN ('_cf_KV', 'd1_migrations') ORDER BY type, name",
    )
    const observedSchema = schemaProof(schemaObjects)
    if (JSON.stringify(observedSchema) !== JSON.stringify(schemaManifest(cwd)))
      fail('schema_object_mismatch')
    // Do not silently skip PRAGMA failures: this is the only full FK check.
    let foreignKeys
    try {
      foreignKeys = await readDbRows('PRAGMA foreign_key_check')
    } catch {
      fail('foreign_key_check_unavailable')
    }
    const counts = Object.fromEntries(objects.map((row) => [row.type, row.n]))
    if (
      ledger.length !== 1 ||
      ledger[0].n !== 35 ||
      versions.length !== 1 ||
      versions[0].n !== 35 ||
      versions[0].version !== '0033' ||
      Object.keys(counts).sort().join(',') !== 'index,table,trigger' ||
      counts.table !== 41 ||
      counts.index !== 61 ||
      counts.trigger !== 6 ||
      foreignKeys.length !== 0
    )
      fail('schema_verification_failed')
    const schema = {
      d1Migrations: 35,
      schemaMigrations: 35,
      maxVersion: '0033',
      tables: 41,
      indexes: 61,
      triggers: 6,
      foreignKeyViolations: 0,
    }
    record('schema_verified', schema)
    return schema
  }
  const readSchemaObjects = () =>
    readDbRows(
      "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT IN ('_cf_KV', 'd1_migrations') ORDER BY type, name",
    )
  const classifySchemaDrift = async () => {
    const remote = await readSchemaObjects()
    const expected = schemaManifest(cwd)
    const observed = schemaProof(remote)
    const changed = new Set([...expected, ...observed].map((row) => row.name))
    const mismatched = [...changed].filter(
      (name) =>
        JSON.stringify(expected.find((row) => row.name === name)) !==
        JSON.stringify(observed.find((row) => row.name === name)),
    )
    const db = new DatabaseSync(':memory:')
    try {
      for (const name of migrationManifest(cwd))
        db.exec(fs.readFileSync(path.join(cwd, 'migrations', name), 'utf8'))
      const detail = []
      for (const name of mismatched) {
        const local = db
          .prepare('SELECT type, sql FROM sqlite_master WHERE name = ?')
          .get(name)
        const live = remote.find((row) => row.name === name)
        if (!local || !live || local.type !== live.type) {
          detail.push({ name, kind: 'missing_or_type_changed' })
          continue
        }
        if (local.type === 'trigger') {
          detail.push({
            name,
            kind:
              scrubSql(local.sql) === scrubSql(live.sql)
                ? 'format_only'
                : 'trigger_body_changed',
          })
          continue
        }
        const pragma = local.type === 'table' ? 'table_xinfo' : 'index_xinfo'
        const quoted = `"${name.replaceAll('"', '""')}"`
        const localRows = db.prepare(`PRAGMA ${pragma}(${quoted})`).all()
        const remoteRows = await readDbRows(`PRAGMA ${pragma}(${quoted})`)
        const keys =
          local.type === 'table'
            ? ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk', 'hidden']
            : ['seqno', 'cid', 'name', 'desc', 'coll', 'key']
        const shape = (rows) =>
          rows.map((row) => keys.map((key) => row[key] ?? null))
        detail.push({
          name,
          kind:
            JSON.stringify(shape(localRows)) ===
            JSON.stringify(shape(remoteRows))
              ? 'sql_text_only'
              : 'structure_changed',
        })
      }
      return detail
    } finally {
      db.close()
    }
  }
  const predecessor = async () => {
    const observed = await status()
    if (observed !== args['expect-active']) fail('predecessor_drift')
    return observed
  }
  const listVersions = async () => {
    const rows = await json(['versions', 'list', '--json'])
    if (
      !Array.isArray(rows) ||
      rows.some((row) => !versionPattern.test(row.id ?? ''))
    )
      fail('version_list_unresolved')
    return rows
  }
  const verifyDurableObjectMigration = async () => {
    if (info.kind !== 'vault') return
    // Wrangler 4.112.0 getMigrationsToUpload() reads this script listing.
    // Require the already-created v1 tag before Wrangler can decide to send
    // the NotificationHub creation migration again.
    const scripts = await cloudflareRead(
      credentials.accountId,
      credentials.token,
      `/accounts/${credentials.accountId}/workers/scripts`,
      deps.fetch ?? globalThis.fetch,
    )
    const matches = Array.isArray(scripts)
      ? scripts.filter((row) => row.id === info.expected.name)
      : []
    if (
      matches.length !== 1 ||
      matches[0].migration_tag !== 'v1' ||
      JSON.stringify(info.config.migrations) !==
        JSON.stringify([{ tag: 'v1', new_sqlite_classes: ['NotificationHub'] }])
    )
      fail('durable_object_migration_mismatch')
    record('durable_object_migration_verified', { tag: 'v1' })
  }
  const candidateProof = async (version) => {
    const evidence = versionEvidence(root, version, args.commit)
    const setup = args['expect-initial-setup'] === 'on'
    if (
      evidence.profileSha256 !== (profile?.sha256 ?? null) ||
      evidence.initialSetupEnabled !== setup
    )
      fail('candidate_profile_or_setup_mismatch')
    const expectedVars = { ...(info.env.vars ?? {}), ...(profile?.vars ?? {}) }
    if (setup) expectedVars.HONOWARDEN_INITIAL_SETUP_ENABLED = 'true'
    const view = await json(['versions', 'view', version, '--json'])
    verifyVersion(
      view,
      version,
      args.commit,
      evidence.message,
      info,
      expectedVars,
    )
    verifySecretNames(view, new Set(evidence.secretNames))
    if (
      info.kind === 'account' &&
      !versionSecretNames(view).has('HONOWARDEN_ACCOUNT_MAIL_ENCRYPTION_KEYS')
    )
      fail('mandatory_secret_missing')
    const module = await readModuleProof(
      credentials.accountId,
      credentials.token,
      info.expected.name,
      version,
      deps.fetch ?? globalThis.fetch,
    )
    if (module.sha256 !== evidence.moduleSha256)
      fail('candidate_module_mismatch')
    return { evidence, view }
  }
  const verifyNonVersionedSettings = async () => {
    const account = credentials.accountId
    const worker = info.expected.name
    const read = (route) =>
      cloudflareRead(
        account,
        credentials.token,
        route,
        deps.fetch ?? globalThis.fetch,
      )
    // A named Wrangler env can be its own Worker service whose default API
    // environment is "production". Wrangler fetchWorkerConfig() resolves the
    // service metadata first; the CLI --env string is not the API environment.
    const metadata = await read(
      `/accounts/${account}/workers/services/${worker}`,
    )
    const serviceEnvironment = metadata?.default_environment?.environment
    if (
      serviceEnvironment !== 'production' &&
      serviceEnvironment !== args.target
    )
      fail('service_environment_unresolved')
    const base = `/accounts/${account}/workers/services/${worker}/environments/${serviceEnvironment}`
    const [subdomain, routes, domains, schedules, settings] = await Promise.all(
      [
        read(`${base}/subdomain`),
        read(`${base}/routes?show_zonename=true`),
        read(
          `/accounts/${account}/workers/domains/records?page=0&per_page=5&service=${worker}&environment=${serviceEnvironment}`,
        ),
        read(`/accounts/${account}/workers/scripts/${worker}/schedules`),
        read(`/accounts/${account}/workers/scripts/${worker}/script-settings`),
      ],
    )
    if (info.kind === 'vault') {
      // Wrangler 4.112.0 getMigrationsToUpload() reads migration_tag from
      // /workers/scripts; the service environment metadata exposes the same
      // current tag. Read it without submitting the v1 creation migration.
      const environment = await read(base)
      if (
        environment?.script?.migration_tag !== 'v1' ||
        JSON.stringify(info.config.migrations) !==
          JSON.stringify([
            { tag: 'v1', new_sqlite_classes: ['NotificationHub'] },
          ])
      )
        fail('durable_object_migration_mismatch')
    }
    const expectedDomains = info.kind === 'vault' ? [info.expected.host] : []
    const expectedCrons =
      (info.env.triggers ?? info.config.triggers)?.crons ?? []
    const observedCrons = schedules?.schedules?.map((row) => row.cron)
    if (
      subdomain?.enabled !== false ||
      subdomain?.previews_enabled !== false ||
      !Array.isArray(routes) ||
      routes.length !== 0 ||
      !Array.isArray(domains) ||
      JSON.stringify(domains.map((row) => row.hostname).sort()) !==
        JSON.stringify(expectedDomains) ||
      JSON.stringify(observedCrons?.sort()) !==
        JSON.stringify([...expectedCrons].sort()) ||
      Boolean(settings?.logpush) !==
        Boolean(info.env.logpush ?? info.config.logpush) ||
      settings?.observability?.enabled !==
        (info.env.observability ?? info.config.observability)?.enabled ||
      (settings?.observability?.head_sampling_rate !== undefined &&
        settings.observability.head_sampling_rate !==
          (info.env.observability ?? info.config.observability)
            ?.head_sampling_rate)
    )
      fail('nonversioned_settings_mismatch')
    const expectedSampling = (
      info.env.observability ?? info.config.observability
    )?.head_sampling_rate
    if (
      settings?.observability?.head_sampling_rate === undefined &&
      expectedSampling !== undefined
    ) {
      // Wrangler 4.112.0 normalizeObservability() sets the omitted value to
      // 1. A missing readback field is conclusive only when config expects 1.
      if (expectedSampling !== 1) {
        record('classification', { state: 'observability_unverified' })
        fail('observability_unverified')
      }
    }
    if (info.kind === 'account') {
      const consumer = info.env.queues?.consumers?.[0]
      const queues = await read(
        `/accounts/${account}/queues?page=1&name=${consumer.queue}`,
      )
      const observed = queues?.[0]?.consumers
      const matches = observed?.filter(
        (row) => row.script === worker || row.service === worker,
      )
      if (
        !Array.isArray(queues) ||
        queues.length !== 1 ||
        !Array.isArray(matches) ||
        matches.length !== 1 ||
        observed.length !== 1 ||
        matches[0].dead_letter_queue !== consumer.dead_letter_queue ||
        matches[0].settings?.batch_size !== consumer.max_batch_size ||
        matches[0].settings?.max_retries !== consumer.max_retries ||
        matches[0].settings?.max_wait_time_ms !==
          consumer.max_batch_timeout * 1000 ||
        matches[0].settings?.retry_delay !== consumer.retry_delay ||
        matches[0].settings?.max_concurrency !== consumer.max_concurrency
      )
        fail('queue_consumer_settings_mismatch')
    }
    record('nonversioned_settings_verified', { worker })
  }

  try {
    if (
      [
        'plan',
        'initialize-db',
        'upload',
        'first-deploy',
        'backup-db',
        'migrate-db',
        'verify-db',
        'activate',
        'verify',
      ].includes(args.command)
    )
      await source()
    await authenticate()
    if (args.command === 'initialize-db') {
      if (info.kind !== 'vault') fail('vault_only')
      const existing = await cloudflareRead(
        credentials.accountId,
        credentials.token,
        `/accounts/${credentials.accountId}/workers/scripts/${info.expected.name}`,
        deps.fetch ?? globalThis.fetch,
        true,
      )
      if (existing !== null) fail('worker_already_exists')
      // Include the migration ledger: a partially initialized database must
      // never be mistaken for a fresh one or retried automatically.
      const objects = await readDbRows(
        "SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name <> '_cf_KV' ORDER BY name",
      )
      if (objects.length !== 0) fail('initialization_requires_empty_database')
      const before = migrationManifest(cwd)
      record('empty_database_verified', { migrations: before })
      const bookmark = await json(['d1', 'time-travel', 'info', 'DB', '--json'])
      if (!validBookmark(bookmark.bookmark)) fail('bookmark_invalid')
      record('bookmark', { bookmark: bookmark.bookmark })
      try {
        await wrangler(['d1', 'migrations', 'apply', 'DB', '--remote'], {
          effect: true,
          timeout: 120000,
        })
        if ((await pending()).length) fail('schema_pending_migrations')
        const schema = await verifyDb()
        record('initialization_verified', { schema })
        return { schema, bookmark: bookmark.bookmark, journal: journalPath }
      } catch {
        record('classification', { state: 'initialization_unverified' })
        fail('initialization_unverified_inspect_before_retry')
      }
    }
    if (args.command === 'generate-secrets') {
      // A mailer can be absent before its first deploy. Prove that absence
      // through the exact Worker GET before treating its secret set as empty.
      const absentMailer =
        (info.kind !== 'vault' || args.target === 'interx') &&
        (await cloudflareRead(
          credentials.accountId,
          credentials.token,
          `/accounts/${credentials.accountId}/workers/scripts/${info.expected.name}`,
          deps.fetch ?? globalThis.fetch,
          true,
        )) === null
      let existing = new Set()
      if (!absentMailer) {
        const active = await status()
        const view = await json(['versions', 'view', active, '--json'])
        if (view.id !== active) fail('serving_version_unverified')
        existing = versionSecretNames(view)
      }
      const value = generatedSecrets(info.kind, existing)
      if (!Object.keys(value).length) fail('no_missing_secrets')
      const names = Object.keys(value)
      record('intent', { operation: 'generate-secrets', path: args.out, names })
      try {
        fs.writeFileSync(
          args.out,
          JSON.stringify({ target: args.target, secrets: value }) + '\n',
          {
            flag: 'wx',
            mode: 0o600,
          },
        )
      } catch {
        fail('secret_output_exists_or_unwritable')
      }
      record('result', {
        operation: 'generate-secrets',
        success: true,
        path: args.out,
        names,
      })
      return { path: args.out, names, journal: journalPath }
    }
    if (args.command === 'plan')
      return {
        ...plan,
        journal: journalPath,
        activeVersion: await status(),
        pendingMigrations: info.kind === 'vault' ? await pending() : [],
      }
    if (args.command === 'verify-db') {
      if (info.kind !== 'vault') fail('vault_only')
      const observed = await pending()
      if (observed.join(',') !== args['expect-pending'])
        fail('pending_migrations_drift')
      if (observed.length) fail('schema_pending_migrations')
      const schema = await verifyDb()
      let postDeploy = null
      if (args['post-deploy']) {
        const email = await readDbRows(
          'SELECT COUNT(*) AS n FROM users WHERE email_verified_at IS NULL',
        )
        const totp = await readDbRows(
          'SELECT COUNT(*) AS n FROM user_totp WHERE enabled = 1 AND verified_at IS NOT NULL AND credential_generation IS NULL',
        )
        if (
          [email, totp].some(
            (rows) =>
              rows.length !== 1 ||
              !Number.isSafeInteger(rows[0]?.n) ||
              rows[0].n < 0,
          )
        )
          fail('post_deploy_count_invalid')
        if (totp[0].n !== 0) fail('post_deploy_totp_generation_incomplete')
        // Migration 0017 backfills only users present when it runs. Current
        // unverified users are an observation, not proof of that legacy cohort.
        postDeploy = {
          usersWithoutVerifiedEmail: email[0].n,
          usersWithoutVerifiedEmailStatus: 'informational',
          emailLegacyBackfillStatus: 'not_verified',
          totpWithoutCredentialGeneration: totp[0].n,
        }
        record('post_deploy_verified', postDeploy)
      }
      return { ...schema, ...(postDeploy ?? {}), journal: journalPath }
    }
    if (args.command === 'backup-db') {
      if (info.kind !== 'vault') fail('vault_only')
      const bookmark = await json(['d1', 'time-travel', 'info', 'DB', '--json'])
      if (!validBookmark(bookmark.bookmark)) fail('bookmark_invalid')
      record('bookmark', { bookmark: bookmark.bookmark })
      const out = path.join(runDir, 'backup.sql')
      // Wrangler writes the downloaded export with fs.writeFile(); precreate
      // mode 0600 so its first byte never lands in a readable file.
      fs.writeFileSync(out, '', { mode: 0o600, flag: 'wx' })
      await wrangler(['d1', 'export', 'DB', '--remote', '--output', out], {
        effect: true,
        timeout: 120000,
      })
      const stat = fs.statSync(out)
      if (!stat.isFile() || stat.size === 0 || stat.size > 1024 * 1024 * 1024)
        fail('backup_invalid')
      fs.chmodSync(out, 0o600)
      const backup = {
        commit: args.commit,
        bookmark: bookmark.bookmark,
        bytes: stat.size,
        sha256: fileDigest(out),
      }
      record('backup', backup)
      return { ...backup, journal: journalPath }
    }
    if (args.command === 'migrate-db') {
      if (info.kind !== 'vault') fail('vault_only')
      const expected = args['expect-pending']
        ? args['expect-pending'].split(',')
        : []
      const before = await pending()
      if (JSON.stringify(before) !== JSON.stringify(expected))
        fail('pending_migrations_drift')
      const backup = recentBackup(root, args.commit)
      record('backup_precondition', {
        commit: args.commit,
        bookmark: backup.bookmark,
        sha256: backup.sha256,
      })
      if (
        JSON.stringify(schemaProof(await readSchemaObjects())) !==
        JSON.stringify(schemaManifest(cwd, true))
      )
        fail('schema_baseline_mismatch')
      const bookmark = await json(['d1', 'time-travel', 'info', 'DB', '--json'])
      if (!validBookmark(bookmark.bookmark)) fail('bookmark_invalid')
      record('bookmark', { bookmark: bookmark.bookmark })
      try {
        // Wrangler 4.112.0 migrations apply uses executeSql() internally but
        // only logs a human table; it emits no stable per-file statement counts.
        // The fixed schema reads below are the admission check instead.
        await wrangler(['d1', 'migrations', 'apply', 'DB', '--remote'], {
          effect: true,
          timeout: 120000,
        })
      } catch {
        let remaining = null
        try {
          remaining = await pending()
        } catch {
          /* unknown partial state */
        }
        const applied = remaining
          ? before.filter((name) => !remaining.includes(name))
          : null
        record('classification', {
          applied,
          remaining,
          bookmark: bookmark.bookmark,
        })
        fail(
          `migration_ambiguous applied=${applied?.join(',') ?? 'unknown'} bookmark=${bookmark.bookmark}`,
        )
      }
      let after
      try {
        after = await pending()
      } catch {
        record('classification', {
          applied: null,
          remaining: null,
          bookmark: bookmark.bookmark,
        })
        fail(`migration_readback_unknown bookmark=${bookmark.bookmark}`)
      }
      if (after.length) {
        const applied = before.filter((name) => !after.includes(name))
        record('classification', {
          applied,
          remaining: after,
          bookmark: bookmark.bookmark,
        })
        fail(
          `migration_incomplete applied=${applied.join(',')} bookmark=${bookmark.bookmark}`,
        )
      }
      let schema
      try {
        schema = await verifyDb()
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : 'schema_readback_unresolved'
        let structural = null
        if (reason === 'schema_object_mismatch') {
          try {
            structural = await classifySchemaDrift()
          } catch {
            structural = 'unresolved'
          }
        }
        record('classification', {
          applied: before,
          remaining: [],
          bookmark: bookmark.bookmark,
          schema: 'unverified',
          reason,
          structural,
        })
        fail(
          `migration_schema_unverified bookmark=${bookmark.bookmark} reason=${reason}`,
        )
      }
      return {
        applied: before,
        schema,
        bookmark: bookmark.bookmark,
        journal: journalPath,
      }
    }
    if (args.command === 'upload') {
      await predecessor()
      await verifyDurableObjectMigration()
      // Wrangler returns only the latest ten versions. A full page is not a
      // reason to refuse; continuity is proven after the upload instead.
      const previousList = await listVersions()
      const priorVersions = new Set(previousList.map((row) => row.id))
      const predecessorView = await json([
        'versions',
        'view',
        args['expect-active'],
        '--json',
      ])
      if (predecessorView.id !== args['expect-active'])
        fail('predecessor_version_unverified')
      const oldSecretNames = versionSecretNames(predecessorView)
      const classifyUpload = async (reason, version = null) => {
        let serving = null
        try {
          serving = await status()
        } catch {
          /* unknown */
        }
        record('classification', {
          version,
          traffic:
            serving === args['expect-active'] ? 'previous_active' : 'unknown',
          serving,
        })
        fail(reason)
      }
      let newSecrets = { names: [], secrets: {} }
      let secretCopy = null
      if (args['secrets-file']) {
        newSecrets = validateSecretsFile(
          args['secrets-file'],
          info.kind,
          args.target,
        )
        for (const name of newSecrets.names) {
          if (oldSecretNames.has(name) && args.rotate !== name)
            fail('secret_already_present')
        }
        if (args.rotate && !newSecrets.names.includes(args.rotate))
          fail('rotation_name_missing')
        if (args.rotate === 'HONOWARDEN_TOTP_SECRET')
          fail('totp_rotation_requires_rewrap')
        secretCopy = path.join(runDir, 'secrets-upload.json')
      } else if (args.rotate) fail('rotation_name_missing')
      const expectedSecretNames = new Set([
        ...oldSecretNames,
        ...newSecrets.names,
      ])
      if (
        info.kind === 'account' &&
        !expectedSecretNames.has('HONOWARDEN_ACCOUNT_MAIL_ENCRYPTION_KEYS')
      )
        fail('mandatory_secret_missing')
      const overrides = { ...(profile?.vars ?? {}) }
      if (args['initial-setup-window']) {
        if (info.kind !== 'vault') fail('setup_window_vault_only')
        overrides.HONOWARDEN_INITIAL_SETUP_ENABLED = 'true'
      }
      const varArgs = Object.entries(overrides)
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([name, value]) => ['--var', `${name}:${value}`])
      const expectedVars = { ...(info.env.vars ?? {}), ...overrides }
      if (profile)
        record('profile', { path: profile.file, sha256: profile.sha256 })
      let assets = []
      let assetsDir = null
      if (info.kind === 'vault') {
        assetsDir = path.join(runDir, 'admin')
        // vite.admin.config.ts has envDir:false; its CLI outDir override keeps
        // the normal admin build while avoiding ambient dotenv and dist/admin.
        record('intent', { operation: 'admin build' })
        const built = await run(
          'vite',
          ['build', '--config', 'vite.admin.config.ts', '--outDir', assetsDir],
          {
            cwd,
            env: {
              PATH: parent.PATH ?? '',
              HOME: parent.HOME ?? os.homedir(),
              NO_COLOR: '1',
            },
            timeout: 120000,
          },
        )
        record('result', {
          operation: 'admin build',
          success: built.code === 0,
        })
        if (built.code !== 0) fail('admin_build_failed')
        fs.chmodSync(assetsDir, 0o700)
        assets = adminAssetHashes(assetsDir)
        record('admin_assets_built', { assets })
        if (['production', 'interx'].includes(args.target)) {
          const expectedAssets = readAdminManifest(
            args['expect-admin-manifest'],
            args.commit,
            args['expect-module-sha256'],
          )
          if (JSON.stringify(assets) !== JSON.stringify(expectedAssets))
            fail('production_admin_manifest_mismatch')
        }
      }
      // Wrangler 4.112.0 validateAssetsOptions() spreads config.assets and
      // replaces only directory from --assets (wrangler-dist/cli.js). The
      // reviewed binding and routing options therefore stay in the config.
      const assetArgs = assetsDir ? ['--assets', assetsDir] : []
      const outdir = path.join(runDir, 'dry-run')
      await wrangler(
        [
          'versions',
          'upload',
          '--dry-run',
          '--outdir',
          outdir,
          '--no-experimental-auto-create',
          ...assetArgs,
          ...varArgs,
        ],
        {
          timeout: 120000,
        },
      )
      const files = fs
        .readdirSync(outdir)
        .filter((name) => name.endsWith('.js'))
      if (files.length !== 1) fail('dry_run_module_unresolved')
      const moduleSha256 = digest(fs.readFileSync(path.join(outdir, files[0])))
      if (
        ['production', 'interx'].includes(args.target) &&
        moduleSha256 !== args['expect-module-sha256']
      )
        fail('production_module_digest_mismatch')
      const message = `HonoWarden ${info.kind} ${args.target} ${args.commit}`
      // Wrangler 4.112.0 supports --secrets-file on versions upload and on
      // deploy (shared deploy args in wrangler-dist/cli.js). Never call
      // `wrangler secret put`: its single-secret path writes a new serving
      // version immediately, bypassing this non-serving admission step.
      const uploadArgs = [
        'versions',
        'upload',
        '--tag',
        args.commit,
        '--message',
        message,
        '--strict',
        '--no-experimental-auto-create',
        ...assetArgs,
        ...varArgs,
      ]
      if (secretCopy) uploadArgs.push('--secrets-file', secretCopy)
      let uploaded
      try {
        if (secretCopy) writeSecretCopy(secretCopy, newSecrets.secrets)
        try {
          uploaded = await wrangler(uploadArgs, {
            effect: true,
            timeout: 120000,
          })
        } finally {
          if (secretCopy && fs.existsSync(secretCopy)) {
            eraseSecretCopy(secretCopy)
            record('secret_copy_removed')
          }
        }
      } catch {
        let possibleVersionIds = null
        try {
          possibleVersionIds = (await listVersions())
            .filter(
              (row) =>
                !priorVersions.has(row.id) &&
                row.annotations?.['workers/tag'] === args.commit &&
                row.annotations?.['workers/message'] === message,
            )
            .map((row) => row.id)
        } catch {
          /* readback unknown */
        }
        record('strict_upload_refusal', {
          nonStrictRetryAllowed: false,
          possibleVersionIds,
        })
        await classifyUpload('upload_ambiguous')
      }
      // Wrangler 4.112.0 writeOutput() appends ND-JSON to
      // WRANGLER_OUTPUT_FILE_PATH. versionsUploadHandler emits type
      // version-upload with version_id, separately from the session entry.
      const ids = uploaded.uploadIds
      if (ids.length !== 1 || !versionPattern.test(ids[0]))
        await classifyUpload('upload_id_unresolved')
      // versionsUpload() may retry the POST internally. The machine output
      // ID alone cannot establish that exactly one candidate was created.
      const listed = await listVersions()
      // The set difference is independent of local and provider clocks. The
      // ten-row page still proves continuity while it keeps at least one
      // pre-upload version. Any other new version means another writer was
      // active, so internally retried duplicates could be hidden.
      const newRows = listed.filter((row) => !priorVersions.has(row.id))
      const foreignRows = newRows.filter(
        (row) =>
          row.annotations?.['workers/tag'] !== args.commit ||
          row.annotations?.['workers/message'] !== message,
      )
      if (
        (previousList.length > 0 && newRows.length === listed.length) ||
        foreignRows.length > 0
      ) {
        record('classification', {
          reason: 'version_history_truncated',
          versionIds: newRows.map((row) => row.id),
        })
        await classifyUpload('version_history_truncated', ids[0])
      }
      const matches = listed
        .filter(
          (row) =>
            !priorVersions.has(row.id) &&
            row.annotations?.['workers/tag'] === args.commit &&
            row.annotations?.['workers/message'] === message,
        )
        .map((row) => row.id)
      if (matches.length !== 1 || matches[0] !== ids[0]) {
        record('classification', {
          reason: 'upload_version_multiplicity',
          versionIds: matches,
        })
        await classifyUpload('upload_version_multiplicity', ids[0])
      }
      try {
        const view = await json(['versions', 'view', ids[0], '--json'])
        verifyVersion(view, ids[0], args.commit, message, info, expectedVars)
        verifySecretNames(view, expectedSecretNames)
        const moduleProof = await readModuleProof(
          credentials.accountId,
          credentials.token,
          info.expected.name,
          ids[0],
          deps.fetch ?? globalThis.fetch,
        )
        if (moduleProof.sha256 !== moduleSha256) fail('module_digest_mismatch')
      } catch (error) {
        await classifyUpload(
          error instanceof Error ? error.message : 'upload_readback_unverified',
          ids[0],
        )
      }
      let traffic
      try {
        traffic = await status()
      } catch {
        await classifyUpload('traffic_readback_unknown', ids[0])
      }
      if (traffic !== args['expect-active'])
        await classifyUpload('traffic_changed_after_upload', ids[0])
      record('upload_verified', {
        target: args.target,
        version: ids[0],
        commit: args.commit,
        moduleSha256,
        assets,
        secretNames: [...expectedSecretNames].sort(),
        profileSha256: profile?.sha256 ?? null,
        initialSetupEnabled: args['initial-setup-window'] === true,
        message,
      })
      return {
        version: ids[0],
        moduleSha256,
        traffic: args['expect-active'],
        journal: journalPath,
      }
    }
    if (args.command === 'activate') {
      await predecessor()
      await candidateProof(args.version)
      try {
        await wrangler(
          [
            'versions',
            'deploy',
            `${args.version}@100%`,
            '--message',
            `HonoWarden ${info.kind} ${args.target} ${args.version}`,
            '--yes',
          ],
          { effect: true, timeout: 120000 },
        )
      } catch {
        let observed = null
        try {
          observed = await status()
        } catch {
          /* classification stays unknown */
        }
        const classification =
          observed === args.version
            ? 'candidate_active'
            : observed === args['expect-active']
              ? 'previous_active'
              : 'unknown'
        record('classification', { classification, observed })
        fail(classification)
      }
      let lastObserved = null
      for (let i = 0; i < 5; i++) {
        try {
          lastObserved = await status()
        } catch {
          lastObserved = null
        }
        if (lastObserved === args.version) {
          try {
            await verifyNonVersionedSettings()
          } catch {
            record('classification', {
              state: 'serving_unverified',
              version: args.version,
            })
            fail('serving_unverified')
          }
          return { activeVersion: args.version, journal: journalPath }
        }
        if (i < 4) await new Promise((resolve) => setTimeout(resolve, 1000))
      }
      record('classification', {
        classification:
          lastObserved === args['expect-active']
            ? 'previous_active'
            : 'unknown',
        observed: lastObserved,
      })
      fail('activation_readback_unresolved')
    }
    if (args.command === 'verify') {
      if ((await status()) !== args.version) fail('verification_version_drift')
      const { evidence } = await candidateProof(args.version)
      await verifyNonVersionedSettings()
      const expectedSha = args.commit
      const initialSetupEnabled = args['expect-initial-setup'] === 'on'
      if (info.kind !== 'vault')
        return {
          activeVersion: args.version,
          worker: info.expected.name,
          gitSha: expectedSha,
          initialSetupEnabled,
          journal: journalPath,
        }
      const checked = await verifyHealth(
        info.expected.host,
        args.version,
        expectedSha,
        deps.fetch ?? globalThis.fetch,
      )
      await verifyAdminAssets(
        info.expected.host,
        evidence.assets,
        deps.fetch ?? globalThis.fetch,
      )
      record('verified', { version: args.version, paths: checked })
      return {
        activeVersion: args.version,
        paths: checked,
        initialSetupEnabled,
        journal: journalPath,
      }
    }
    if (args.command === 'ensure-queues') {
      if (info.kind !== 'account') fail('account_mailer_only')
      const list = async (name) => {
        const rows = await cloudflareRead(
          credentials.accountId,
          credentials.token,
          `/accounts/${credentials.accountId}/queues?page=1&name=${name}`,
          deps.fetch ?? globalThis.fetch,
        )
        if (
          !Array.isArray(rows) ||
          rows.length > 1 ||
          rows.some((row) => row.queue_name !== name)
        )
          fail('queue_list_unrecognized')
        return rows[0] ?? null
      }
      for (const name of info.expected.queues) {
        if (!(await list(name))) {
          try {
            // Wrangler 4.112.0 create/update maps this option to
            // settings.message_retention_period (queues/cli/commands/*).
            await wrangler(
              [
                'queues',
                'create',
                name,
                '--message-retention-period-secs',
                '86400',
              ],
              { effect: true },
            )
          } catch {
            let observed = null
            try {
              observed = await list(name)
            } catch {
              /* still ambiguous */
            }
            record('classification', {
              queue: name,
              state: 'ambiguous',
              present: observed === null ? null : true,
            })
            fail('queue_create_ambiguous')
          }
          try {
            if (!(await list(name))) fail('queue_readback_missing')
          } catch {
            record('classification', { queue: name, state: 'ambiguous' })
            fail('queue_create_readback_ambiguous')
          }
        }
        let observed = await list(name)
        if (observed.settings?.message_retention_period !== 86400) {
          try {
            await wrangler(
              [
                'queues',
                'update',
                name,
                '--message-retention-period-secs',
                '86400',
              ],
              { effect: true },
            )
          } catch {
            try {
              observed = await list(name)
            } catch {
              observed = null
            }
            record('classification', {
              queue: name,
              state: 'ambiguous',
              retention: observed?.settings?.message_retention_period ?? null,
            })
            fail('queue_update_ambiguous')
          }
          try {
            observed = await list(name)
          } catch {
            record('classification', { queue: name, state: 'ambiguous' })
            fail('queue_update_readback_ambiguous')
          }
        }
        if (observed?.settings?.message_retention_period !== 86400)
          fail('queue_retention_readback_mismatch')
      }
      return { queues: info.expected.queues, journal: journalPath }
    }
    if (args.command === 'first-deploy') {
      if (info.kind === 'vault' && args.target !== 'interx') fail('mailer_only')
      if (info.kind === 'vault' && !profile) fail('profile_required')
      let secretCopy = null
      let newSecrets = { names: [], secrets: {} }
      if (args['secrets-file']) {
        newSecrets = validateSecretsFile(
          args['secrets-file'],
          info.kind,
          args.target,
        )
        secretCopy = path.join(runDir, 'secrets-deploy.json')
      }
      if (
        info.kind === 'account' &&
        !newSecrets.names.includes('HONOWARDEN_ACCOUNT_MAIL_ENCRYPTION_KEYS')
      )
        fail('mandatory_secret_missing')
      if (
        info.kind === 'vault' &&
        [...secretNames.vault].some((name) => !newSecrets.names.includes(name))
      )
        fail('mandatory_secret_missing')
      const scriptPath = `/accounts/${credentials.accountId}/workers/scripts/${info.expected.name}`
      const existing = await cloudflareRead(
        credentials.accountId,
        credentials.token,
        scriptPath,
        deps.fetch ?? globalThis.fetch,
        true,
      )
      if (existing !== null) fail('worker_already_exists')
      let assets = []
      let assetArgs = []
      const varArgs = Object.entries(profile?.vars ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([name, value]) => ['--var', `${name}:${value}`])
      if (info.kind === 'vault') {
        if ((await pending()).length) fail('schema_pending_migrations')
        await verifyDb()
        if (info.env.vars.HONOWARDEN_INITIAL_SETUP_ENABLED !== 'false')
          fail('initial_setup_must_be_closed')
        const assetsDir = path.join(runDir, 'admin')
        record('intent', { operation: 'admin build' })
        const built = await run(
          'vite',
          ['build', '--config', 'vite.admin.config.ts', '--outDir', assetsDir],
          {
            cwd,
            env: {
              PATH: parent.PATH ?? '',
              HOME: parent.HOME ?? os.homedir(),
              NO_COLOR: '1',
            },
            timeout: 120000,
          },
        )
        record('result', {
          operation: 'admin build',
          success: built.code === 0,
        })
        if (built.code !== 0) fail('admin_build_failed')
        fs.chmodSync(assetsDir, 0o700)
        assets = adminAssetHashes(assetsDir)
        const expected = readAdminManifest(
          args['expect-admin-manifest'],
          args.commit,
          args['expect-module-sha256'],
        )
        if (JSON.stringify(assets) !== JSON.stringify(expected))
          fail('production_admin_manifest_mismatch')
        record('admin_assets_built', { assets })
        assetArgs = ['--assets', assetsDir]
      }
      const outdir = path.join(runDir, 'first-dry-run')
      await wrangler(
        [
          'deploy',
          '--dry-run',
          '--outdir',
          outdir,
          '--no-experimental-auto-create',
          ...assetArgs,
          ...varArgs,
        ],
        {
          timeout: 120000,
        },
      )
      const builtFiles = fs
        .readdirSync(outdir)
        .filter((name) => name.endsWith('.js'))
      if (builtFiles.length !== 1) fail('dry_run_module_unresolved')
      const builtSha256 = digest(
        fs.readFileSync(path.join(outdir, builtFiles[0])),
      )
      if (
        ['production', 'interx'].includes(args.target) &&
        builtSha256 !== args['expect-module-sha256']
      )
        fail('production_module_digest_mismatch')
      // First deploy is serving by definition. The new InterX vault requires
      // a complete schema, fresh secrets, staging build proof and closed setup.
      const deployArgs = [
        'deploy',
        '--tag',
        args.commit,
        '--message',
        `HonoWarden ${info.kind} ${args.target} ${args.commit}`,
        '--strict',
        '--no-experimental-auto-create',
        ...assetArgs,
        ...varArgs,
      ]
      if (secretCopy) deployArgs.push('--secrets-file', secretCopy)
      try {
        if (secretCopy) writeSecretCopy(secretCopy, newSecrets.secrets)
        try {
          await wrangler(deployArgs, { effect: true, timeout: 120000 })
        } finally {
          if (secretCopy && fs.existsSync(secretCopy)) {
            eraseSecretCopy(secretCopy)
            record('secret_copy_removed')
          }
        }
      } catch {
        let observed = 'unknown'
        try {
          observed = await status()
        } catch {
          /* unknown */
        }
        record('classification', { observed })
        fail('first_deploy_ambiguous')
      }
      try {
        const version = await status()
        const view = await json(['versions', 'view', version, '--json'])
        if (view.annotations?.['workers/tag'] !== args.commit)
          fail('first_deploy_tag_mismatch')
        verifyVersion(
          view,
          version,
          args.commit,
          `HonoWarden ${info.kind} ${args.target} ${args.commit}`,
          info,
          { ...(info.env.vars ?? {}), ...(profile?.vars ?? {}) },
        )
        verifySecretNames(view, new Set(newSecrets.names))
        const proof = await readModuleProof(
          credentials.accountId,
          credentials.token,
          info.expected.name,
          version,
          deps.fetch ?? globalThis.fetch,
        )
        if (proof.sha256 !== builtSha256) fail('first_deploy_module_mismatch')
        await verifyNonVersionedSettings()
        record('upload_verified', {
          version,
          commit: args.commit,
          moduleSha256: builtSha256,
          assets,
          secretNames: newSecrets.names,
          profileSha256: profile?.sha256 ?? null,
          initialSetupEnabled: false,
          message: `HonoWarden ${info.kind} ${args.target} ${args.commit}`,
        })
        return {
          activeVersion: version,
          moduleSha256: builtSha256,
          journal: journalPath,
        }
      } catch {
        record('classification', { state: 'serving_unverified' })
        fail('serving_unverified')
      }
    }
    fail('command_unhandled')
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'release_failed'
    const next = reason.startsWith('migration_ambiguous')
      ? 'Inspect applied migrations and bookmark; choose forward repair or Time Travel restore.'
      : reason.includes('upload_ambiguous')
        ? 'Read exact version history and traffic; do not retry an assumed failed upload.'
        : [
              'candidate_active',
              'previous_active',
              'unknown',
              'activation_readback_unresolved',
            ].includes(reason)
          ? 'Read exact traffic and health before another activation.'
          : reason.includes('queue_create_ambiguous') ||
              reason.includes('first_deploy_ambiguous')
            ? 'Read exact resource state before any retry.'
            : 'Inspect the journal and obtain a fresh target plan before another write.'
    // Provider and filesystem exceptions can contain raw response text; keep
    // only the sanitized reason, without attaching the original as `cause`.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(`${reason}; journal=${journalPath}; next=${next}`)
  } finally {
    fs.closeSync(journalFd)
    fs.closeSync(lockFd)
    fs.unlinkSync(lock)
  }
}

function verifySecretNames(view, expected) {
  const names = versionSecretNames(view)
  if (
    JSON.stringify([...names].sort()) !== JSON.stringify([...expected].sort())
  )
    fail('version_secret_names_mismatch')
}

function verifyVersion(
  view,
  id,
  sha,
  message,
  info,
  expectedVars = info.env.vars ?? {},
) {
  if (
    view?.id !== id ||
    view.annotations?.['workers/tag'] !== sha ||
    view.annotations?.['workers/message'] !== message
  )
    fail('version_provenance_mismatch')
  if (
    view.resources?.script_runtime?.compatibility_date !==
    info.config.compatibility_date
  )
    fail('version_compatibility_mismatch')
  const bindings = view.resources?.bindings
  if (!Array.isArray(bindings)) fail('version_bindings_unresolved')
  if (
    bindings.some(
      (row) => typeof row.name !== 'string' || typeof row.type !== 'string',
    ) ||
    new Set(bindings.map((row) => row.name)).size !== bindings.length
  )
    fail('version_bindings_unresolved')
  const vars = Object.fromEntries(
    bindings
      .filter((row) => row.type === 'plain_text')
      .map((row) => [row.name, row.text]),
  )
  if (
    JSON.stringify(Object.entries(vars).sort()) !==
    JSON.stringify(Object.entries(expectedVars).sort())
  )
    fail('version_vars_mismatch')
  const match = (name, type, test = () => true) => {
    const rows = bindings.filter((row) => row.name === name)
    if (rows.length !== 1 || rows[0].type !== type || !test(rows[0]))
      fail('version_binding_mismatch')
  }
  if (info.env.version_metadata?.binding)
    match(info.env.version_metadata.binding, 'version_metadata')
  for (const db of info.env.d1_databases ?? [])
    match(
      db.binding,
      'd1',
      (row) => row.id === db.database_id || row.database_id === db.database_id,
    )
  for (const bucket of info.env.r2_buckets ?? [])
    match(
      bucket.binding,
      'r2_bucket',
      (row) => row.bucket_name === bucket.bucket_name,
    )
  for (const service of info.env.services ?? [])
    match(
      service.binding,
      'service',
      (row) =>
        row.service === service.service &&
        (service.environment === undefined ||
          row.environment === service.environment),
    )
  for (const queue of info.env.queues?.producers ?? [])
    match(queue.binding, 'queue', (row) => row.queue_name === queue.queue)
  for (const email of info.env.send_email ?? [])
    match(
      email.name,
      'send_email',
      (row) =>
        row.destination_address === email.destination_address &&
        JSON.stringify(row.allowed_destination_addresses ?? []) ===
          JSON.stringify(email.allowed_destination_addresses ?? []) &&
        JSON.stringify(row.allowed_sender_addresses ?? []) ===
          JSON.stringify(email.allowed_sender_addresses ?? []),
    )
  for (const object of info.env.durable_objects?.bindings ?? [])
    match(
      object.name,
      'durable_object_namespace',
      (row) => row.class_name === object.class_name,
    )
  if (info.env.assets?.binding) {
    const row = bindings.find((item) => item.name === info.env.assets.binding)
    if (!row || !['assets', 'assets_binding'].includes(row.type))
      fail('version_assets_missing')
  }
  const expectedNames = new Set([
    ...Object.keys(expectedVars),
    info.env.version_metadata?.binding,
    info.env.assets?.binding,
    ...(info.env.d1_databases ?? []).map((row) => row.binding),
    ...(info.env.r2_buckets ?? []).map((row) => row.binding),
    ...(info.env.services ?? []).map((row) => row.binding),
    ...(info.env.queues?.producers ?? []).map((row) => row.binding),
    ...(info.env.send_email ?? []).map((row) => row.name),
    ...(info.env.durable_objects?.bindings ?? []).map((row) => row.name),
  ])
  for (const row of bindings)
    if (row.type !== 'secret_text' && !expectedNames.has(row.name))
      fail('version_binding_unexpected')
}

async function boundedJson(response, maxBytes = 4 * 1024 * 1024) {
  const length = response.headers.get('content-length')
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > maxBytes))
    fail('read_body_limit')
  if (!response.body) fail('read_body_missing')
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > maxBytes) fail('read_body_limit')
    chunks.push(Buffer.from(chunk))
  }
  try {
    const input = Buffer.concat(chunks, size).toString('utf8')
    const errors = []
    const tree = parseTree(input, errors, { disallowComments: true })
    const hasDuplicate = (node) => {
      if (node.type === 'object') {
        const keys =
          node.children?.map((property) => property.children?.[0]?.value) ?? []
        if (new Set(keys).size !== keys.length) return true
      }
      return node.children?.some(hasDuplicate) ?? false
    }
    if (errors.length || !tree || hasDuplicate(tree)) fail('read_json_invalid')
    return JSON.parse(input)
  } catch {
    fail('read_json_invalid')
  }
}

export async function readModuleProof(
  account,
  token,
  worker,
  version,
  fetcher,
) {
  if (
    !/^[a-f0-9]{32}$/u.test(account) ||
    !versionPattern.test(version) ||
    !Object.values(identity).some((targets) =>
      Object.values(targets).some((item) => item.name === worker),
    )
  )
    fail('module_read_target_invalid')
  // Adapted from the bounded cloudflare-reader/version-proof review packet:
  // fixed Cloudflare origin, exact target, no redirect, bounded response and
  // canonical base64 decode. The module contents remain in memory only.
  const result = await cloudflareRead(
    account,
    token,
    `/accounts/${account}/workers/workers/${worker}/versions/${version}?include=modules`,
    fetcher,
  )
  if (result?.id !== version) fail('module_read_invalid')
  const main = result.modules?.find((row) => row.name === result.main_module)
  if (
    !main ||
    main.content_type !== 'application/javascript+module' ||
    typeof main.content_base64 !== 'string' ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      main.content_base64,
    )
  )
    fail('module_read_invalid')
  const bytes = Buffer.from(main.content_base64, 'base64')
  try {
    if (!bytes.length || bytes.toString('base64') !== main.content_base64)
      fail('module_read_invalid')
    return { sha256: digest(bytes), bytes: bytes.length }
  } finally {
    bytes.fill(0)
  }
}

async function cloudflareRead(
  account,
  token,
  requestPath,
  fetcher,
  allowMissing = false,
) {
  if (
    !/^[a-f0-9]{32}$/u.test(account) ||
    !requestPath.startsWith(`/accounts/${account}/`) ||
    requestPath.includes('..')
  )
    fail('read_target_invalid')
  let response
  try {
    response = await fetcher(
      `https://api.cloudflare.com/client/v4${requestPath}`,
      {
        redirect: 'manual',
        signal: globalThis.AbortSignal.timeout(15000),
        headers: {
          ...(typeof token === 'string'
            ? { Authorization: `Bearer ${token}` }
            : { 'X-Auth-Key': token.globalKey, 'X-Auth-Email': token.email }),
          Accept: 'application/json',
          'Accept-Encoding': 'identity',
        },
      },
    )
  } catch {
    fail('cloudflare_read_failed')
  }
  if (allowMissing && response.status === 404) return null
  if (
    response.status !== 200 ||
    (response.headers.get('content-encoding') &&
      response.headers.get('content-encoding') !== 'identity')
  )
    fail('cloudflare_read_failed')
  let envelope
  try {
    envelope = await boundedJson(response)
  } catch {
    fail('cloudflare_read_invalid')
  }
  if (
    envelope?.success !== true ||
    !Object.hasOwn(envelope, 'result') ||
    envelope.errors?.length
  )
    fail('cloudflare_envelope_invalid')
  return envelope.result
}

async function verifyHealth(host, version, sha, fetcher) {
  const paths = ['/health', '/health/db', '/api/config']
  for (const route of paths) {
    let response
    try {
      response = await fetcher(`https://${host}${route}`, {
        redirect: 'manual',
        signal: globalThis.AbortSignal.timeout(10000),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
      })
    } catch {
      fail('health_transport_failed')
    }
    if (response.status !== 200) fail('health_http_failed')
    let value
    try {
      value = await boundedJson(response, 65536)
    } catch {
      fail('health_body_invalid')
    }
    if (
      route === '/health' &&
      (value.build?.workerVersionId !== version || value.build?.gitSha !== sha)
    )
      fail('health_provenance_mismatch')
    if (route === '/health/db' && value.status !== 'ok')
      fail('database_health_failed')
    if (route === '/api/config' && value.gitHash !== sha)
      fail('config_provenance_mismatch')
  }
  return paths
}

async function verifyAdminAssets(host, assets, fetcher) {
  if (!Array.isArray(assets) || !assets.length)
    fail('admin_asset_evidence_missing')
  for (const asset of assets) {
    if (
      !/^[a-f0-9]{64}$/u.test(asset.sha256 ?? '') ||
      (asset.path !== 'index.html' &&
        !/^assets\/[a-zA-Z0-9_.-]+\.(?:js|css|wasm)$/u.test(asset.path))
    )
      fail('admin_asset_evidence_invalid')
    let response
    try {
      response = await fetcher(`https://${host}/admin/${asset.path}`, {
        redirect: 'manual',
        signal: globalThis.AbortSignal.timeout(10000),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
          'Accept-Encoding': 'identity',
        },
      })
    } catch {
      fail('admin_asset_transport_failed')
    }
    if (
      response.status !== 200 ||
      response.headers.get('content-encoding') ||
      response.headers.get('cache-control') !== 'no-store' ||
      response.headers.get('referrer-policy') !== 'no-referrer' ||
      response.headers.get('x-content-type-options') !== 'nosniff' ||
      response.headers.get('permissions-policy') !==
        'camera=(), microphone=(), geolocation=()' ||
      !response.headers
        .get('content-security-policy')
        ?.includes("default-src 'none'") ||
      !response.headers
        .get('content-security-policy')
        ?.includes("frame-ancestors 'none'")
    )
      fail('admin_asset_response_invalid')
    if (!response.body) fail('admin_asset_body_missing')
    const hash = createHash('sha256')
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.byteLength
      if (size > 16 * 1024 * 1024 || size > asset.bytes)
        fail('admin_asset_body_limit')
      hash.update(chunk)
    }
    if (size !== asset.bytes || hash.digest('hex') !== asset.sha256)
      fail('admin_asset_digest_mismatch')
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  release(process.argv.slice(2)).then(
    (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
    (error) => {
      process.stderr.write(`${error.message}\n`)
      process.exitCode = 1
    },
  )
}

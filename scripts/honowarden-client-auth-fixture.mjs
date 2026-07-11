#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

import { parse } from 'jsonc-parser'

const schemaVersion = 1
const confirmation = 'staging-fixture'
const defaultDatabase = 'honowarden-staging'
const cloudflareApiOrigin = 'https://api.cloudflare.com'
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = join(repoRoot, 'test/.tmp')
const supportedActions = new Set(['seed', 'clipboard', 'status', 'cleanup'])

async function main(argv = process.argv.slice(2)) {
  const normalized = argv[0] === '--' ? argv.slice(1) : argv
  const [action, ...rest] = normalized
  if (!action || !supportedActions.has(action)) {
    throw new Error('action must be seed, clipboard, status, or cleanup')
  }

  const options = parseOptions(rest)
  validateTarget(options)
  const fixturePath = await validateFixturePath(options.fixture)
  const fixture = normalizeFixture(
    JSON.parse(await readFile(fixturePath, 'utf8')),
  )
  const packet = buildPacket(action, options, fixturePath, fixture)

  if (options.execute) {
    requireConfirmation(options)
    await executeAction(packet, fixture, options)
  }

  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`)
}

function buildPacket(action, options, fixturePath, fixture) {
  const field =
    action === 'clipboard' ? parseClipboardField(options.field) : null
  return {
    schemaVersion,
    action,
    generatedAt: parseTimestamp(options.at),
    environment: 'staging',
    database: defaultDatabase,
    executed: false,
    status: 'ready',
    targetTag: `sha256:${createHash('sha256')
      .update(fixture.account.email.toLowerCase())
      .digest('hex')}`,
    fixture: {
      file: basename(fixturePath),
      sourceValidated: true,
      containsRealData: false,
      cryptoRoundTripClaimsValidated: true,
      source: fixture.source,
    },
    ...(field ? { clipboardField: field } : {}),
    readback: null,
    next: {
      confirmation,
      command: `pnpm client:auth-fixture -- ${action} --fixture <ignored-path> --execute --confirm ${confirmation}`,
    },
    safety: {
      productionSupported: false,
      printsCredentials: false,
      printsKeyMaterial: false,
      pollingAuthoritative: true,
    },
  }
}

async function executeAction(packet, fixture, options) {
  switch (packet.action) {
    case 'seed': {
      await executeD1(seedSql(fixture, packet.generatedAt))
      packet.readback = await readStatus(fixture)
      packet.status = isReady(packet.readback) ? 'seeded' : 'not_ready'
      break
    }
    case 'clipboard': {
      const value =
        packet.clipboardField === 'email'
          ? fixture.account.email
          : fixture.account.password
      await writeClipboard(value)
      packet.status = 'copied'
      break
    }
    case 'status': {
      packet.readback = await readStatus(fixture)
      packet.status = isClean(packet.readback)
        ? 'clean'
        : isReady(packet.readback)
          ? 'ready'
          : 'not_ready'
      break
    }
    case 'cleanup': {
      let cleanupError = null
      try {
        await executeD1(cleanupSql(fixture))
      } catch (error) {
        cleanupError = error
      } finally {
        await writeClipboard('')
      }
      if (cleanupError) throw cleanupError
      packet.readback = await readStatus(fixture)
      packet.status = isClean(packet.readback) ? 'clean' : 'not_ready'
      break
    }
  }
  packet.executed = true
  delete packet.next.command
  void options
}

async function readStatus(fixture) {
  const result = await queryD1(statusSql(), [
    fixture.account.email.toLowerCase(),
  ])
  const row = result?.[0]?.results?.[0]
  if (!row || typeof row !== 'object') {
    throw new Error('fixture status readback was unavailable')
  }
  return {
    users: nonNegativeInteger(row.users, 'users'),
    devices: nonNegativeInteger(row.devices, 'devices'),
    refreshTokens: nonNegativeInteger(row.refresh_tokens, 'refresh_tokens'),
    authRequests: nonNegativeInteger(row.auth_requests, 'auth_requests'),
    orphanDevices: nonNegativeInteger(row.orphan_devices, 'orphan_devices'),
    foreignKeyViolations: nonNegativeInteger(
      row.foreign_key_violations,
      'foreign_key_violations',
    ),
  }
}

async function executeD1(sql) {
  const directory = await mkdtemp(join(tmpdir(), 'honowarden-auth-fixture-'))
  const sqlPath = join(directory, 'operation.sql')
  try {
    await writeFile(sqlPath, sql, { mode: 0o600 })
    const result = await runCommand('pnpm', [
      'exec',
      'wrangler',
      'd1',
      'execute',
      defaultDatabase,
      '--remote',
      '--env',
      'staging',
      '--file',
      sqlPath,
      '--yes',
    ])
    void result
  } catch {
    throw new Error('staging fixture D1 operation failed')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function queryD1(sql, params) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_HONOWARDEN_D1_R2_TOKEN
  if (!nonEmpty(accountId)) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID is required for status readback')
  }
  if (!nonEmpty(token)) {
    throw new Error(
      'CLOUDFLARE_HONOWARDEN_D1_R2_TOKEN is required for status readback',
    )
  }
  const databaseId = await stagingDatabaseId()
  try {
    const response = await globalThis.fetch(
      `${cloudflareApiOrigin}/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${databaseId}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql, params }),
      },
    )
    const payload = await response.json()
    if (
      !response.ok ||
      payload?.success !== true ||
      !Array.isArray(payload?.result) ||
      payload.result.some((entry) => entry?.success !== true)
    ) {
      throw new Error('query failed')
    }
    return payload.result
  } catch {
    throw new Error('staging fixture D1 status query failed')
  }
}

async function stagingDatabaseId() {
  const config = parse(await readFile(join(repoRoot, 'wrangler.jsonc'), 'utf8'))
  const database = config?.env?.staging?.d1_databases?.find(
    (candidate) => candidate?.database_name === defaultDatabase,
  )
  if (!/^[a-f0-9-]{36}$/i.test(database?.database_id ?? '')) {
    throw new Error('staging D1 database ID is not configured')
  }
  return database.database_id
}

function runCommand(command, args, input = null) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', () => undefined)
    child.on('error', rejectCommand)
    child.on('close', (code) => {
      if (code === 0) resolveCommand({ stdout })
      else rejectCommand(new Error(`${command} failed`))
    })
    if (input !== null) child.stdin.write(input)
    child.stdin.end()
  })
}

async function writeClipboard(value) {
  try {
    await runCommand('pbcopy', [], value)
  } catch {
    throw new Error('clipboard operation failed')
  }
}

function seedSql(fixture, at) {
  const account = fixture.account
  const payload = account.bootstrapPayload
  const emailNormalized = account.email.toLowerCase()
  return [
    `DELETE FROM users WHERE email_normalized = ${sqlLiteral(emailNormalized)};`,
    'INSERT INTO users',
    '(id, email, email_normalized, display_name, kdf_algorithm, kdf_iterations, master_password_hash, user_key, public_key, private_key, security_stamp, revision_date, created_at, updated_at)',
    `VALUES (${sqlLiteral(randomUUID())}, ${sqlLiteral(account.email)}, ${sqlLiteral(emailNormalized)}, ${sqlLiteral(account.displayName)}, 'pbkdf2-sha256', ${account.kdfIterations}, ${sqlLiteral(payload.masterPasswordHash)}, ${sqlLiteral(payload.userKey)}, ${sqlLiteral(payload.publicKey)}, ${sqlLiteral(payload.privateKey)}, ${sqlLiteral(randomUUID())}, ${sqlLiteral(at)}, ${sqlLiteral(at)}, ${sqlLiteral(at)});`,
  ].join(' ')
}

function cleanupSql(fixture) {
  return `DELETE FROM users WHERE email_normalized = ${sqlLiteral(fixture.account.email.toLowerCase())};`
}

function statusSql() {
  return [
    'WITH fixture_user AS (SELECT id FROM users WHERE email_normalized = ?)',
    'SELECT',
    '(SELECT COUNT(*) FROM fixture_user) AS users,',
    '(SELECT COUNT(*) FROM devices WHERE user_id IN (SELECT id FROM fixture_user)) AS devices,',
    '(SELECT COUNT(*) FROM refresh_tokens WHERE user_id IN (SELECT id FROM fixture_user)) AS refresh_tokens,',
    '(SELECT COUNT(*) FROM auth_requests WHERE user_id IN (SELECT id FROM fixture_user)) AS auth_requests,',
    '(SELECT COUNT(*) FROM devices WHERE user_id NOT IN (SELECT id FROM users)) AS orphan_devices,',
    '(SELECT COUNT(*) FROM pragma_foreign_key_check) AS foreign_key_violations;',
  ].join(' ')
}

async function validateFixturePath(value) {
  if (!value) throw new Error('--fixture is required')
  const candidate = isAbsolute(value) ? value : resolve(repoRoot, value)
  const relativePath = relative(fixtureRoot, candidate)
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('fixture must be inside test/.tmp')
  }
  const [resolvedRoot, resolvedFixture] = await Promise.all([
    realpath(fixtureRoot),
    realpath(candidate),
  ])
  const resolvedRelativePath = relative(resolvedRoot, resolvedFixture)
  if (
    resolvedRelativePath.startsWith('..') ||
    isAbsolute(resolvedRelativePath)
  ) {
    throw new Error('fixture must resolve inside test/.tmp')
  }
  const fixtureStat = await stat(resolvedFixture)
  if (!fixtureStat.isFile()) throw new Error('fixture must be a regular file')
  if ((fixtureStat.mode & 0o077) !== 0) {
    throw new Error('fixture permissions must be 0600 or stricter')
  }
  return resolvedFixture
}

function normalizeFixture(value) {
  const account = value?.account
  const payload = account?.bootstrapPayload
  const source = value?.source
  const verification = value?.verification
  if (
    !nonEmpty(value?.generatedAt) ||
    !validTimestamp(value.generatedAt) ||
    !nonEmpty(source?.cliReleaseTag) ||
    !/^[a-f0-9]{64}$/i.test(source?.cliNpmBuildSha256 ?? '') ||
    !nonEmpty(account?.email) ||
    !nonEmpty(account?.password) ||
    !nonEmpty(account?.displayName) ||
    !Number.isInteger(account?.kdf?.pBKDF2?.iterations) ||
    account.kdf.pBKDF2.iterations < 100_000 ||
    !nonEmpty(payload?.masterPasswordHash) ||
    !nonEmpty(payload?.userKey) ||
    !nonEmpty(payload?.publicKey) ||
    !nonEmpty(payload?.privateKey) ||
    payload?.email?.toLowerCase() !== account.email.toLowerCase() ||
    verification?.wrappedUserKeyDecryptsWithMasterPassword !== true ||
    verification?.wrappedPrivateKeyDecryptsWithUserKey !== true
  ) {
    throw new Error('fixture is missing verified synthetic account material')
  }
  if (!account.email.toLowerCase().endsWith('@example.test')) {
    throw new Error('fixture email must use example.test')
  }
  return {
    source: {
      cliReleaseTag: source.cliReleaseTag,
      cliNpmBuildSha256: source.cliNpmBuildSha256.toLowerCase(),
    },
    account: {
      email: account.email,
      password: account.password,
      displayName: account.displayName,
      kdfIterations: account.kdf.pBKDF2.iterations,
      bootstrapPayload: payload,
    },
  }
}

function validateTarget(options) {
  if ((options.env ?? 'staging') !== 'staging') {
    throw new Error('only staging is supported')
  }
  if ((options.database ?? defaultDatabase) !== defaultDatabase) {
    throw new Error(`database must be ${defaultDatabase}`)
  }
}

function requireConfirmation(options) {
  if (options.confirm !== confirmation) {
    throw new Error(`--confirm ${confirmation} is required before --execute`)
  }
}

function parseOptions(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--execute') {
      options.execute = true
      continue
    }
    if (
      arg === '--fixture' ||
      arg === '--field' ||
      arg === '--confirm' ||
      arg === '--env' ||
      arg === '--database' ||
      arg === '--at'
    ) {
      const value = args[index + 1]
      if (!value) throw new Error(`${arg} requires a value`)
      options[arg.slice(2)] = value
      index += 1
      continue
    }
    throw new Error(`Unknown option: ${arg}`)
  }
  return options
}

function parseClipboardField(value) {
  if (value === 'email' || value === 'password') return value
  throw new Error('--field must be email or password')
}

function parseTimestamp(value) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) throw new Error('--at must be ISO-8601')
  return date.toISOString()
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function nonNegativeInteger(value, field) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${field} count was invalid`)
  }
  return number
}

function nonEmpty(value) {
  return typeof value === 'string' && value.length > 0
}

function isClean(readback) {
  return Object.values(readback).every((value) => value === 0)
}

function isReady(readback) {
  return (
    readback.users === 1 &&
    readback.orphanDevices === 0 &&
    readback.foreignKeyViolations === 0
  )
}

function validTimestamp(value) {
  return !Number.isNaN(new Date(value).getTime())
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'fixture operation failed'}\n`,
  )
  process.exitCode = 1
})

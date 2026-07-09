#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { TextDecoder, TextEncoder } from 'node:util'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const schemaVersion = 1
const secretEnvelopeVersion = 'v1'
const secretEnvelopePurpose = 'honowarden:totp-secret:v1'
const defaultOldSecretEnv = 'HONOWARDEN_TOTP_OLD_SECRET'
const defaultNewSecretEnv = 'HONOWARDEN_TOTP_NEW_SECRET'

async function main(argv = process.argv.slice(2), env = process.env) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv
  const options = parseOptions(normalizedArgv)
  const packet = await buildPacket(options, env)

  if (options.strict && packet.status !== 'ready') {
    writeOutputPacket(packet)
    process.exitCode = 1
    return
  }

  if (options.execute) {
    requireExecutionConfirmation(packet.database, packet.strategy, options)
    if (packet.status !== 'ready') {
      throw new Error(
        `TOTP rotation is not ready: ${packet.blockingReason ?? 'unknown'}`,
      )
    }
    if (options.inputFile) {
      throw new Error('--execute cannot use --input-file')
    }

    prepareMutationPlans(packet, options)
    packet.executed = true
    packet.audit.event = 'totp.secret_rotation.executed'
    packet.executions = await executeMutationPlans(packet.mutationPlans)
    delete packet.mutationPlans
  }
  writeOutputPacket(packet)
}

async function buildPacket(options, env) {
  const database = requireValue(options.database, '--database')
  const reason = requireValue(options.reason, '--reason')
  const mode = parseMode(options.mode)
  rejectRemotePersistence(mode, options)

  const strategy = parseStrategy(options.strategy)
  const generatedAt = parseTimestamp(options.at)
  const secretConfig =
    strategy === 'rewrap' ? resolveRewrapSecrets(options, env) : null
  const readCommand = buildD1ExecuteCommand({
    database,
    mode,
    sql: selectTotpRowsSql(),
    json: true,
    yes: false,
    options,
  })
  const rows = await readTotpRows(options, readCommand)
  const rotationPlan = await buildRotationPlan({
    rows,
    strategy,
    generatedAt,
    oldSecret: secretConfig?.oldSecret ?? null,
    newSecret: secretConfig?.newSecret ?? null,
  })

  return {
    schemaVersion,
    action: 'totp_secret_rotation',
    generatedAt,
    status: rotationPlan.status,
    blockingReason: rotationPlan.blockingReason,
    executed: false,
    strategy,
    mode,
    database,
    source: {
      inputFile: options.inputFile ? true : false,
    },
    audit: {
      event: 'totp.secret_rotation.plan',
      reason,
      containsPlaintextSecrets: false,
      containsEncryptedSecrets: false,
    },
    summary: rotationPlan.summary,
    commands: options.inputFile ? [] : [readCommand],
    mutationPreview: {
      statements: rotationPlan.mutationPlans.length,
      sqlRedacted: true,
      printsEncryptedPayloads: false,
    },
    mutationPlans: rotationPlan.mutationPlans,
    limitations: [
      'Dry-run output contains counts and commands only; it does not print TOTP plaintext or encrypted envelopes.',
      'Rewrap execution updates user_totp rows only after the current encrypted value still matches.',
      'Force re-enrollment deletes user_totp rows and requires a separate operator/user communication plan.',
      'This CLI does not set Wrangler secrets, deploy Workers, or rotate HONOWARDEN_TOTP_SECRET by itself.',
    ],
  }
}

async function buildRotationPlan(input) {
  const summary = {
    totalRows: input.rows.length,
    enabledRows: 0,
    activeEncryptedRows: 0,
    pendingEncryptedRows: 0,
    decryptableActiveRows: 0,
    decryptablePendingRows: 0,
    corruptActiveRows: 0,
    corruptPendingRows: 0,
    plannedUpdates: 0,
    plannedForceReenrollments: 0,
  }
  const mutationPlans = []

  for (const row of input.rows) {
    if (row.enabled) {
      summary.enabledRows += 1
    }
    if (row.encryptedSecret) {
      summary.activeEncryptedRows += 1
    }
    if (row.pendingEncryptedSecret) {
      summary.pendingEncryptedRows += 1
    }

    if (input.strategy === 'force-reenrollment') {
      summary.plannedForceReenrollments += 1
      mutationPlans.push({
        type: 'force-reenrollment',
        userId: row.userId,
      })
      continue
    }

    const activePlaintext = await decryptTotpSecret(
      input.oldSecret,
      row.encryptedSecret,
    )
    if (!activePlaintext) {
      summary.corruptActiveRows += 1
      continue
    }
    summary.decryptableActiveRows += 1

    let nextPendingSecret = null
    if (row.pendingEncryptedSecret) {
      const pendingPlaintext = await decryptTotpSecret(
        input.oldSecret,
        row.pendingEncryptedSecret,
      )
      if (!pendingPlaintext) {
        summary.corruptPendingRows += 1
        continue
      }
      summary.decryptablePendingRows += 1
      nextPendingSecret = await encryptTotpSecret(
        input.newSecret,
        pendingPlaintext,
      )
    }

    mutationPlans.push({
      type: 'rewrap',
      userId: row.userId,
      previousEncryptedSecret: row.encryptedSecret,
      nextEncryptedSecret: await encryptTotpSecret(
        input.newSecret,
        activePlaintext,
      ),
      nextPendingEncryptedSecret: nextPendingSecret,
    })
    summary.plannedUpdates += 1
  }

  const corruptRows = summary.corruptActiveRows + summary.corruptPendingRows
  return {
    status: corruptRows > 0 ? 'not_ready' : 'ready',
    blockingReason: corruptRows > 0 ? 'corrupt_envelope' : null,
    summary,
    mutationPlans,
  }
}

function resolveRewrapSecrets(options, env) {
  const oldSecretEnv = options.oldSecretEnv ?? defaultOldSecretEnv
  const newSecretEnv = options.newSecretEnv ?? defaultNewSecretEnv
  const oldSecret = env[oldSecretEnv]
  const newSecret = env[newSecretEnv]

  if (!isNonEmptyString(oldSecret)) {
    throw new Error(`${oldSecretEnv} is required for rewrap`)
  }
  if (!isNonEmptyString(newSecret)) {
    throw new Error(`${newSecretEnv} is required for rewrap`)
  }
  if (oldSecret === newSecret) {
    throw new Error('old and new TOTP wrapping secrets must differ')
  }

  return { oldSecret, newSecret }
}

async function readTotpRows(options, readCommand) {
  if (options.inputFile) {
    const content = await readFile(options.inputFile, 'utf8')
    return normalizeRows(JSON.parse(content))
  }

  const result = await runCommand(readCommand)
  return normalizeRows(parseD1JsonRows(result.stdout))
}

function parseD1JsonRows(stdout) {
  const parsed = JSON.parse(stdout || '[]')

  if (Array.isArray(parsed)) {
    return parsed.flatMap((entry) => {
      if (Array.isArray(entry?.results)) {
        return entry.results
      }
      return []
    })
  }

  if (Array.isArray(parsed?.results)) {
    return parsed.results
  }

  return []
}

function normalizeRows(value) {
  if (!Array.isArray(value)) {
    throw new Error('TOTP row input must be an array')
  }

  return value.map((row, index) => normalizeRow(row, index))
}

function normalizeRow(row, index) {
  if (!isRecord(row)) {
    throw new Error(`TOTP row ${index + 1} must be an object`)
  }

  const userId = stringField(row.userId ?? row.user_id)
  const encryptedSecret = stringField(
    row.encryptedSecret ?? row.encrypted_secret,
  )
  const pendingEncryptedSecret = optionalStringField(
    row.pendingEncryptedSecret ?? row.pending_encrypted_secret,
  )

  if (!userId) {
    throw new Error(`TOTP row ${index + 1} is missing user_id`)
  }
  if (!encryptedSecret) {
    throw new Error(`TOTP row ${index + 1} is missing encrypted_secret`)
  }

  return {
    userId,
    encryptedSecret,
    pendingEncryptedSecret,
    enabled: row.enabled === 1 || row.enabled === true,
  }
}

async function executeMutationPlans(plans) {
  const executions = []

  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index]
    const command = buildD1ExecuteCommand({
      database: plan.database,
      mode: plan.mode,
      sql: plan.sql,
      json: false,
      yes: true,
      options: plan.options,
    })
    const result = await runCommand(command).catch(() => {
      throw new Error(
        `TOTP rotation mutation ${
          index + 1
        } failed; inspect local Wrangler logs without copying encrypted envelopes into shared evidence`,
      )
    })
    executions.push({
      exitCode: result.exitCode,
      command: redactMutationCommand(command),
    })
  }

  return executions
}

function buildD1ExecuteCommand({ database, mode, sql, json, yes, options }) {
  return [
    'wrangler',
    'd1',
    'execute',
    database,
    modeFlag(mode),
    '--command',
    sql,
    ...(json ? ['--json'] : []),
    ...(yes ? ['--yes'] : []),
    ...wranglerEnvFlags(options),
    ...localPersistenceFlags(mode, options),
  ]
}

function selectTotpRowsSql() {
  return [
    'SELECT',
    'user_id as userId,',
    'encrypted_secret as encryptedSecret,',
    'pending_encrypted_secret as pendingEncryptedSecret,',
    'enabled',
    'FROM user_totp',
    'ORDER BY user_id ASC;',
  ].join(' ')
}

function mutationSql(plan, at) {
  if (plan.type === 'force-reenrollment') {
    return `DELETE FROM user_totp WHERE user_id = ${sqlLiteral(plan.userId)};`
  }

  return [
    'UPDATE user_totp SET',
    `encrypted_secret = ${sqlLiteral(plan.nextEncryptedSecret)},`,
    `pending_encrypted_secret = ${sqlNullableLiteral(plan.nextPendingEncryptedSecret)},`,
    `updated_at = ${sqlLiteral(at)}`,
    `WHERE user_id = ${sqlLiteral(plan.userId)}`,
    `AND encrypted_secret = ${sqlLiteral(plan.previousEncryptedSecret)};`,
  ].join(' ')
}

function prepareMutationPlans(packet, options) {
  packet.mutationPlans = packet.mutationPlans.map((plan) => ({
    database: packet.database,
    mode: packet.mode,
    options,
    sql: mutationSql(plan, packet.generatedAt),
  }))
}

function requireExecutionConfirmation(database, strategy, options) {
  const expected = `${database}:${strategy}`
  if (options.confirm !== expected) {
    throw new Error(`--confirm ${expected} is required before --execute`)
  }
}

function parseOptions(args) {
  const options = {}

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    switch (arg) {
      case '--execute':
        options.execute = true
        break
      case '--strict':
        options.strict = true
        break
      case '--database':
      case '--mode':
      case '--env':
      case '--persist-to':
      case '--input-file':
      case '--strategy':
      case '--reason':
      case '--old-secret-env':
      case '--new-secret-env':
      case '--confirm':
      case '--at': {
        const value = args[index + 1]
        if (!value) {
          throw new Error(`${arg} requires a value`)
        }
        options[toCamelCase(arg.slice(2))] = value
        index += 1
        break
      }
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }

  return options
}

function parseMode(value = 'local') {
  if (value === 'local' || value === 'remote') {
    return value
  }

  throw new Error('--mode must be local or remote')
}

function parseStrategy(value = 'rewrap') {
  if (value === 'rewrap' || value === 'force-reenrollment') {
    return value
  }

  throw new Error('--strategy must be rewrap or force-reenrollment')
}

function rejectRemotePersistence(mode, options) {
  if (mode === 'remote' && options.persistTo) {
    throw new Error('--persist-to can only be used with --mode local')
  }
}

function parseTimestamp(value) {
  if (!value) {
    return new Date().toISOString()
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error('--at must be an ISO-8601 timestamp')
  }

  return date.toISOString()
}

async function runCommand(command) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command[0], command.slice(1), {
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', rejectCommand)
    child.on('exit', (code) => {
      const result = {
        exitCode: code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      }

      if (code === 0) {
        resolveCommand(result)
        return
      }

      rejectCommand(new Error(stderr.trim() || `exit code ${code}`))
    })
  })
}

function wranglerEnvFlags(options) {
  return options.env ? ['--env', options.env] : []
}

function localPersistenceFlags(mode, options) {
  return mode === 'local' && options.persistTo
    ? ['--persist-to', options.persistTo]
    : []
}

function modeFlag(mode) {
  return mode === 'remote' ? '--remote' : '--local'
}

function redactMutationCommand(command) {
  const redacted = [...command]
  const commandIndex = redacted.indexOf('--command')
  if (commandIndex !== -1) {
    redacted[commandIndex + 1] = '[redacted SQL]'
  }

  return redacted
}

async function encryptTotpSecret(wrappingSecret, secretBase32) {
  const iv = new Uint8Array(12)
  webcrypto.getRandomValues(iv)

  const key = await importWrappingKey(wrappingSecret, ['encrypt'])
  const ciphertext = await webcrypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: new TextEncoder().encode(secretEnvelopePurpose),
    },
    key,
    new TextEncoder().encode(secretBase32),
  )

  return [
    secretEnvelopeVersion,
    base64UrlEncodeBytes(iv),
    base64UrlEncodeBytes(new Uint8Array(ciphertext)),
  ].join('.')
}

async function decryptTotpSecret(wrappingSecret, encryptedSecret) {
  const [version, encodedIv, encodedCiphertext] = encryptedSecret.split('.')
  if (
    version !== secretEnvelopeVersion ||
    !encodedIv ||
    !encodedCiphertext ||
    encryptedSecret.split('.').length !== 3
  ) {
    return null
  }

  try {
    const iv = base64UrlDecodeBytes(encodedIv)
    if (iv.length !== 12) {
      return null
    }

    const key = await importWrappingKey(wrappingSecret, ['decrypt'])
    const plaintext = await webcrypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: new TextEncoder().encode(secretEnvelopePurpose),
      },
      key,
      base64UrlDecodeBytes(encodedCiphertext),
    )

    return new TextDecoder().decode(plaintext)
  } catch {
    return null
  }
}

async function importWrappingKey(wrappingSecret, usages) {
  if (!wrappingSecret.trim()) {
    throw new Error('Missing TOTP wrapping secret.')
  }

  const digest = await webcrypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(wrappingSecret),
  )

  return webcrypto.subtle.importKey('raw', digest, 'AES-GCM', false, usages)
}

function base64UrlEncodeBytes(bytes) {
  return Buffer.from(bytes).toString('base64url')
}

function base64UrlDecodeBytes(value) {
  return new Uint8Array(Buffer.from(value, 'base64url'))
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`
}

function sqlNullableLiteral(value) {
  return value === null ? 'NULL' : sqlLiteral(value)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringField(value) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function optionalStringField(value) {
  return value === null || value === undefined ? null : stringField(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function requireValue(value, flagName) {
  if (!value) {
    throw new Error(`${flagName} is required`)
  }

  return value
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase())
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function writeOutputPacket(packet) {
  const safePacket = { ...packet }
  delete safePacket.mutationPlans
  writeJson(safePacket)
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)

if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}

#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const schemaVersion = 2
const mutationOperations = new Set(['recover', 'prepare-purge', 'purge'])
const rpcMethods = {
  status: 'plan',
  recover: 'recover',
  'prepare-purge': 'preparePurge',
  purge: 'purge',
}

async function main(argv = process.argv.slice(2)) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv
  const [action, ...rest] = normalizedArgv
  if (action === 'disable' || action === 'enable') {
    throw new Error(
      'Direct disable/enable was removed because it bypasses the recoverable account lifecycle.',
    )
  }
  if (action !== 'plan') {
    printUsage()
    process.exitCode = 1
    return
  }

  const options = parseOptions(rest)
  const packet = buildPacket(options)
  if (options.execute) {
    if (packet.operation !== 'status') {
      throw new Error(
        '--execute is read-only; mutation RPC must run from a separately approved operator Worker binding.',
      )
    }
    requireReadbackConfirmation(packet, options)
    packet.executions = await runCommands(packet.commands)
    packet.executed = true
  }
  writeJson(packet)
}

function buildPacket(options) {
  const database = requireValue(options.database, '--database')
  const mode = parseMode(options.mode)
  rejectRemotePersistence(mode, options)
  const operation = parseOperation(options.operation)
  const userId = normalizeOperatorValue(options.userId, '--user-id', 128)
  const lifecycleGeneration = normalizeOperatorValue(
    options.generation,
    '--generation',
    128,
  )
  const reason = normalizeOperatorValue(options.reason, '--reason', 256)
  const requestId = normalizeOperatorValue(
    options.requestId,
    '--request-id',
    128,
  )
  const generatedAt = parseTimestamp(options.at)
  const readbackCommand = buildD1ExecuteCommand({
    database,
    mode,
    sql: lifecycleReadbackSql(userId, lifecycleGeneration),
    options,
  })
  const rpcInput = {
    userId,
    lifecycleGeneration,
    requestId,
    reason,
    ...(mutationOperations.has(operation)
      ? { confirmedLifecycleGeneration: lifecycleGeneration }
      : {}),
  }

  return {
    schemaVersion,
    action: 'plan',
    operation,
    generatedAt,
    executed: false,
    mode,
    database,
    target: {
      userId,
      lifecycleGeneration,
      targetHash: hashTarget(userId, lifecycleGeneration),
    },
    audit: {
      reason,
      requestId,
      containsVaultData: false,
    },
    commands: [readbackCommand],
    operatorRpc: {
      entrypoint: 'AccountLifecycleOperator',
      method: rpcMethods[operation],
      input: rpcInput,
      publiclyAccessible: false,
      executionIncluded: false,
    },
    limitations: [
      'This CLI executes read-only lifecycle readback only.',
      'Recovery and purge mutations require the AccountLifecycleOperator named WorkerEntrypoint through a separately approved service binding.',
      'The packet never includes token digests, R2 object keys, credentials, or encrypted vault payloads.',
    ],
  }
}

function lifecycleReadbackSql(userId, lifecycleGeneration) {
  return [
    'SELECT deletion.state, deletion.requested_at, deletion.recover_until,',
    'deletion.personal_r2_expected_count, deletion.personal_r2_deleted_count,',
    '(SELECT COUNT(*) FROM ciphers WHERE user_id = deletion.user_id AND organization_id IS NULL) AS personal_cipher_count,',
    '(SELECT COUNT(*) FROM ciphers WHERE user_id = deletion.user_id AND organization_id IS NOT NULL) AS organization_cipher_count,',
    '(SELECT COUNT(*) FROM cipher_attachments attachment JOIN ciphers cipher ON cipher.id = attachment.cipher_id',
    'WHERE cipher.user_id = deletion.user_id AND cipher.organization_id IS NULL) AS personal_attachment_count',
    'FROM account_deletions deletion',
    `WHERE deletion.user_id = ${sqlLiteral(userId)}`,
    `AND deletion.lifecycle_generation = ${sqlLiteral(lifecycleGeneration)};`,
  ].join(' ')
}

function buildD1ExecuteCommand({ database, mode, sql, options }) {
  return [
    'wrangler',
    'd1',
    'execute',
    database,
    mode === 'remote' ? '--remote' : '--local',
    '--command',
    sql,
    '--json',
    ...wranglerEnvFlags(options),
    ...localPersistenceFlags(mode, options),
  ]
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
      [
        '--operation',
        '--user-id',
        '--generation',
        '--database',
        '--mode',
        '--env',
        '--persist-to',
        '--reason',
        '--request-id',
        '--confirm',
        '--at',
      ].includes(arg)
    ) {
      const value = args[index + 1]
      if (!value) throw new Error(`${arg} requires a value`)
      options[toCamelCase(arg.slice(2))] = value
      index += 1
      continue
    }
    throw new Error(`Unknown option: ${arg}`)
  }
  return options
}

function parseOperation(value = 'status') {
  if (Object.hasOwn(rpcMethods, value)) return value
  throw new Error(
    '--operation must be status, recover, prepare-purge, or purge',
  )
}

function parseMode(value = 'local') {
  if (value === 'local' || value === 'remote') return value
  throw new Error('--mode must be local or remote')
}

function rejectRemotePersistence(mode, options) {
  if (mode === 'remote' && options.persistTo) {
    throw new Error('--persist-to can only be used with --mode local')
  }
}

function parseTimestamp(value) {
  if (!value) return new Date().toISOString()
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error('--at must be an ISO-8601 timestamp')
  }
  return date.toISOString()
}

function requireReadbackConfirmation(packet, options) {
  if (options.confirm !== packet.target.lifecycleGeneration) {
    throw new Error(
      `--confirm ${packet.target.lifecycleGeneration} is required before readback --execute`,
    )
  }
}

async function runCommands(commands) {
  const executions = []
  for (const command of commands) executions.push(await runCommand(command))
  return executions
}

function runCommand(command) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command[0], command.slice(1), {
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()))
    child.on('error', rejectCommand)
    child.on('exit', (code) => {
      const result = {
        command,
        exitCode: code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      }
      if (code === 0) resolveCommand(result)
      else rejectCommand(new Error(`Command failed: ${command.join(' ')}`))
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

function normalizeOperatorValue(value, flagName, maxLength) {
  const normalized = requireValue(value, flagName)
  if (
    normalized.length > maxLength ||
    normalized.trim() !== normalized ||
    [...normalized].some((character) => {
      const code = character.charCodeAt(0)
      return code <= 31 || code === 127
    })
  ) {
    throw new Error(`${flagName} is invalid`)
  }
  return normalized
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`
}

function hashTarget(userId, lifecycleGeneration) {
  return `sha256:${createHash('sha256')
    .update(`${userId}:${lifecycleGeneration}`)
    .digest('hex')}`
}

function requireValue(value, flagName) {
  if (!value) throw new Error(`${flagName} is required`)
  return value
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase())
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function printUsage() {
  process.stderr.write(`Usage:
  node scripts/honowarden-account-lifecycle.mjs plan --operation <status|recover|prepare-purge|purge> --user-id <id> --generation <generation> --database <name> --reason <reason> --request-id <id> [--mode local|remote]
`)
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}

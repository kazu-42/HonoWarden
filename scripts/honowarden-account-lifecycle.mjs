#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const schemaVersion = 1

async function main(argv = process.argv.slice(2)) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv
  const [action, ...rest] = normalizedArgv

  if (action !== 'disable' && action !== 'enable') {
    printUsage()
    process.exitCode = 1
    return
  }

  const options = parseOptions(rest)
  const packet = buildPacket(action, options)

  if (options.execute) {
    requireExecutionConfirmation(action, packet.selector, options)
    packet.executions = await runCommands(packet.commands)
    packet.audit.event = `account.${action}.executed`
  }

  writeJson(packet)
}

function buildPacket(action, options) {
  const database = requireValue(options.database, '--database')
  const mode = parseMode(options.mode)
  rejectRemotePersistence(mode, options)

  const selector = parseSelector(options)
  const at = parseTimestamp(options.at)
  const reason = requireValue(options.reason, '--reason')
  const readbackCommand = buildD1ExecuteCommand({
    database,
    mode,
    sql: readbackSql(selector.sqlWhere),
    json: true,
    yes: false,
    options,
  })
  const mutationCommand = buildD1ExecuteCommand({
    database,
    mode,
    sql: mutationSql(action, selector.sqlWhere, at),
    json: false,
    yes: true,
    options,
  })
  const rollbackCommand = buildD1ExecuteCommand({
    database,
    mode,
    sql: mutationSql(oppositeAction(action), selector.sqlWhere, at),
    json: false,
    yes: true,
    options,
  })

  return {
    schemaVersion,
    action,
    generatedAt: at,
    executed: Boolean(options.execute),
    mode,
    database,
    selector,
    audit: {
      event: `account.${action}.plan`,
      reason,
      targetHash: targetHash(selector),
      containsVaultData: false,
    },
    commands: [readbackCommand, mutationCommand, readbackCommand],
    rollbackCommand,
    limitations: [
      'The CLI mutates only the users.disabled_at lifecycle flag and account revision timestamp.',
      'The CLI does not inspect or print vault payloads, encryption keys, password hashes, or refresh token bodies.',
      'Use the post-operation readback counts and application smoke tests to verify disabled-user behavior.',
    ],
  }
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

function readbackSql(sqlWhere) {
  return [
    'SELECT COUNT(*) AS matched_users,',
    'SUM(CASE WHEN disabled_at IS NULL THEN 1 ELSE 0 END) AS active_users,',
    'SUM(CASE WHEN disabled_at IS NOT NULL THEN 1 ELSE 0 END) AS disabled_users',
    `FROM users WHERE ${sqlWhere};`,
  ].join(' ')
}

function mutationSql(action, sqlWhere, at) {
  if (action === 'disable') {
    return [
      `UPDATE users SET disabled_at = ${sqlLiteral(at)},`,
      `updated_at = ${sqlLiteral(at)},`,
      `revision_date = ${sqlLiteral(at)}`,
      `WHERE ${sqlWhere} AND disabled_at IS NULL;`,
    ].join(' ')
  }

  return [
    'UPDATE users SET disabled_at = NULL,',
    `updated_at = ${sqlLiteral(at)},`,
    `revision_date = ${sqlLiteral(at)}`,
    `WHERE ${sqlWhere} AND disabled_at IS NOT NULL;`,
  ].join(' ')
}

function parseSelector(options) {
  const hasEmail = Boolean(options.email)
  const hasUserId = Boolean(options.userId)

  if (hasEmail === hasUserId) {
    throw new Error('Exactly one of --email or --user-id is required')
  }

  if (hasEmail) {
    const normalizedValue = normalizeEmail(options.email)
    return {
      type: 'email',
      value: options.email,
      normalizedValue,
      sqlWhere: `email_normalized = ${sqlLiteral(normalizedValue)}`,
    }
  }

  const normalizedValue = normalizeIdentifier(options.userId, '--user-id')
  return {
    type: 'user_id',
    value: options.userId,
    normalizedValue,
    sqlWhere: `id = ${sqlLiteral(normalizedValue)}`,
  }
}

function normalizeEmail(value) {
  const normalized = normalizeIdentifier(value, '--email').toLowerCase()

  if (!normalized.includes('@')) {
    throw new Error('--email must include @')
  }

  return normalized
}

function normalizeIdentifier(value, flagName) {
  const normalized = requireValue(value, flagName).trim()

  if (!normalized || normalized.includes('\0')) {
    throw new Error(`${flagName} must not be empty`)
  }

  return normalized
}

function parseOptions(args) {
  const options = {}

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    switch (arg) {
      case '--execute':
        options.execute = true
        break
      case '--email':
      case '--user-id':
      case '--database':
      case '--mode':
      case '--env':
      case '--persist-to':
      case '--reason':
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

function requireExecutionConfirmation(action, selector, options) {
  if (options.confirm !== selector.normalizedValue) {
    throw new Error(
      `--confirm ${selector.normalizedValue} is required before ${action} --execute`,
    )
  }
}

async function runCommands(commands) {
  const executions = []

  for (const command of commands) {
    executions.push(await runCommand(command))
  }

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

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', rejectCommand)
    child.on('exit', (code) => {
      const result = {
        command,
        exitCode: code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      }

      if (code === 0) {
        resolveCommand(result)
        return
      }

      rejectCommand(
        new Error(
          `Command failed with exit code ${code}: ${command.join(' ')}`,
        ),
      )
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

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`
}

function targetHash(selector) {
  return `sha256:${createHash('sha256')
    .update(`${selector.type}:${selector.normalizedValue}`)
    .digest('hex')}`
}

function oppositeAction(action) {
  return action === 'disable' ? 'enable' : 'disable'
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

function printUsage() {
  process.stderr.write(`Usage:
  node scripts/honowarden-account-lifecycle.mjs disable --email <email> --database <name> --reason <reason> [--mode local|remote] [--execute --confirm <target>]
  node scripts/honowarden-account-lifecycle.mjs enable --user-id <id> --database <name> --reason <reason> [--mode local|remote] [--execute --confirm <target>]
`)
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)

if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}

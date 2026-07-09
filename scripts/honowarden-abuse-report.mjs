#!/usr/bin/env node

import process from 'node:process'

const allowedModes = new Set(['local', 'remote'])

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const queries = buildQueries(options.limit)
  const command = buildD1ExecuteCommand({
    database: options.database,
    mode: options.mode,
    sql: queries.map((query) => query.sql).join('\n'),
  })

  if (options.execute) {
    await runCommand(command)
  }

  writeJson({
    action: 'abuse-report',
    executed: options.execute,
    mode: options.mode,
    database: options.database,
    evidence: {
      plaintextClientAddresses: 'excluded',
      bucketIdentifier: 'hashed_prefix_only',
    },
    queries,
    commands: [command],
  })
}

function buildQueries(limit) {
  return [
    {
      id: 'request_quota_summary',
      sql: [
        'SELECT',
        '  scope,',
        '  COUNT(*) AS bucket_count,',
        "  SUM(CASE WHEN blocked_until IS NOT NULL AND blocked_until > strftime('%Y-%m-%dT%H:%M:%fZ', 'now') THEN 1 ELSE 0 END) AS active_blocked_buckets,",
        '  MAX(updated_at) AS latest_update_at',
        'FROM request_quota_buckets',
        'GROUP BY scope',
        'ORDER BY scope;',
      ].join('\n'),
    },
    {
      id: 'request_quota_top_buckets',
      sql: [
        'SELECT',
        '  scope,',
        '  substr(bucket_key, 1, 28) AS bucket_tag,',
        '  request_count,',
        '  window_started_at,',
        '  blocked_until,',
        '  updated_at',
        'FROM request_quota_buckets',
        'ORDER BY request_count DESC, updated_at DESC',
        `LIMIT ${limit};`,
      ].join('\n'),
    },
    {
      id: 'auth_failure_summary',
      sql: [
        'SELECT',
        "  substr(bucket_key, 1, instr(bucket_key, ':') - 1) AS bucket_scope,",
        '  COUNT(*) AS bucket_count,',
        "  SUM(CASE WHEN locked_until IS NOT NULL AND locked_until > strftime('%Y-%m-%dT%H:%M:%fZ', 'now') THEN 1 ELSE 0 END) AS active_locked_buckets,",
        '  MAX(updated_at) AS latest_update_at',
        'FROM auth_failure_buckets',
        'GROUP BY bucket_scope',
        'ORDER BY bucket_scope;',
      ].join('\n'),
    },
    {
      id: 'auth_failure_top_buckets',
      sql: [
        'SELECT',
        '  substr(bucket_key, 1, 18) AS bucket_tag,',
        '  failed_count,',
        '  window_started_at,',
        '  locked_until,',
        '  updated_at',
        'FROM auth_failure_buckets',
        'ORDER BY failed_count DESC, updated_at DESC',
        `LIMIT ${limit};`,
      ].join('\n'),
    },
  ]
}

function buildD1ExecuteCommand({ database, mode, sql }) {
  return [
    'wrangler',
    'd1',
    'execute',
    database,
    mode === 'remote' ? '--remote' : '--local',
    '--command',
    sql,
  ]
}

async function runCommand(command) {
  const { spawn } = await import('node:child_process')
  await new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`command failed with exit code ${code}`))
    })
  })
}

function parseArgs(args) {
  const options = {
    database: null,
    execute: false,
    limit: 10,
    mode: 'local',
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    switch (arg) {
      case '--database':
        options.database = requireValue(args, (index += 1), arg)
        break
      case '--execute':
        options.execute = true
        break
      case '--limit':
        options.limit = parseLimit(requireValue(args, (index += 1), arg))
        break
      case '--mode':
        options.mode = requireValue(args, (index += 1), arg)
        if (!allowedModes.has(options.mode)) {
          throw new Error('--mode must be local or remote')
        }
        break
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }

  if (!options.database) {
    throw new Error('--database is required')
  }

  return options
}

function requireValue(args, index, flag) {
  const value = args[index]
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`)
  }

  return value
}

function parseLimit(value) {
  const limit = Number(value)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('--limit must be an integer from 1 to 100')
  }

  return limit
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
  process.exitCode = 1
})

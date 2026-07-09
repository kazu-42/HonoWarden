#!/usr/bin/env node

import process from 'node:process'

const allowedModes = new Set(['local', 'remote'])

const retention = {
  authDefenseCleanupWindowSeconds: 15 * 60,
  auditEventRetentionDays: 365,
  requestQuotaCleanupRetentionSeconds: 60 * 60,
  rowsPerCleanupSlice: 100,
}

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
      operatorIdentities: 'excluded',
      vaultPayloads: 'excluded',
    },
    retention,
    queries,
    alerts: buildAlerts(),
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
    {
      id: 'auth_attempt_cleanup_candidates',
      sql: [
        'SELECT',
        '  COUNT(*) AS candidate_rows,',
        '  MIN(occurred_at) AS oldest_candidate_at,',
        '  MAX(occurred_at) AS newest_candidate_at',
        'FROM auth_attempts',
        `WHERE occurred_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${retention.authDefenseCleanupWindowSeconds} seconds');`,
      ].join('\n'),
    },
    {
      id: 'auth_failure_cleanup_candidates',
      sql: [
        'SELECT',
        '  COUNT(*) AS candidate_rows,',
        '  MIN(updated_at) AS oldest_candidate_at,',
        '  MAX(updated_at) AS newest_candidate_at',
        'FROM auth_failure_buckets',
        `WHERE updated_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${retention.authDefenseCleanupWindowSeconds} seconds')`,
        "  AND (locked_until IS NULL OR locked_until <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));",
      ].join('\n'),
    },
    {
      id: 'totp_challenge_cleanup_candidates',
      sql: [
        'SELECT',
        '  COUNT(*) AS candidate_rows,',
        '  MIN(expires_at) AS oldest_candidate_at,',
        '  MAX(expires_at) AS newest_candidate_at',
        'FROM totp_challenges',
        "WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
        '  OR consumed_at IS NOT NULL;',
      ].join('\n'),
    },
    {
      id: 'audit_event_cleanup_candidates',
      sql: [
        'SELECT',
        '  COUNT(*) AS candidate_rows,',
        '  MIN(occurred_at) AS oldest_candidate_at,',
        '  MAX(occurred_at) AS newest_candidate_at',
        'FROM audit_events',
        `WHERE occurred_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${retention.auditEventRetentionDays} days');`,
      ].join('\n'),
    },
    {
      id: 'request_quota_cleanup_candidates',
      sql: [
        'SELECT',
        '  COUNT(*) AS candidate_rows,',
        '  MIN(updated_at) AS oldest_candidate_at,',
        '  MAX(updated_at) AS newest_candidate_at',
        'FROM request_quota_buckets',
        `WHERE updated_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${retention.requestQuotaCleanupRetentionSeconds} seconds')`,
        "  AND (blocked_until IS NULL OR blocked_until <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));",
      ].join('\n'),
    },
  ]
}

function buildAlerts() {
  return [
    {
      id: 'request_quota_active_blocked_buckets',
      metric: 'request_quota_summary.active_blocked_buckets',
      levels: {
        warn: 10,
        critical: 50,
      },
      firstResponse: [
        'Separate anonymous from authenticated scope before deciding whether the signal is attack traffic or client retry pressure.',
        'Preserve only aggregate counts, hashed bucket tags, timestamps, and response decisions in the incident record.',
        'Leave HONOWARDEN_GLOBAL_REQUEST_QUOTA disabled unless the target D1 database has migration 0008 and the normal traffic baseline is understood.',
      ],
    },
    {
      id: 'auth_failure_active_locked_buckets',
      metric: 'auth_failure_summary.active_locked_buckets',
      levels: {
        warn: 5,
        critical: 20,
      },
      firstResponse: [
        'Check whether locks are concentrated in account or client-address bucket scope before raising customer-impact severity.',
        'Use existing password-grant logs and audit events to correlate outcomes without publishing bucket source values.',
      ],
    },
    {
      id: 'cleanup_candidate_rows',
      metric: 'cleanup candidate query row counts',
      levels: {
        warn: 1000,
        critical: 5000,
      },
      firstResponse: [
        'Run pnpm abuse:report against the affected environment and keep only aggregate counts, hashed bucket tags, and timestamps in the incident record.',
        'If candidate rows continue to rise after the next hourly Cron Trigger, inspect Worker Cron Event failures before increasing cleanup limits.',
      ],
    },
    {
      id: 'scheduled_cleanup_failure',
      metric: 'Cloudflare Cron Event failure for the hourly cleanup handler',
      levels: {
        warn: 1,
        critical: 3,
      },
      firstResponse: [
        'Treat repeated scheduled cleanup failures as infrastructure drift until schema version, bindings, and Wrangler deploy version are read back.',
        'Disable only the affected Cron Trigger if repeated cleanup failures create hot-path pressure; do not delete D1 rows manually without a reviewed SQL packet.',
      ],
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

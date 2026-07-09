#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const schemaVersion = 1

const defaults = {
  workflowPath: '.github/workflows/remote-backup.yml',
  cron: '17 19 * * *',
  database: 'honowarden',
  bucket: 'honowarden-vault-objects',
  env: 'production',
  r2Prefix: 'attachments/',
  encryptedArtifactRetentionDays: 7,
  operatorArchiveRetentionDays: 35,
}

async function main(argv = process.argv.slice(2)) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv
  const [command = 'plan', ...rest] = normalizedArgv

  if (command !== 'plan') {
    printUsage()
    process.exitCode = 1
    return
  }

  const options = parseOptions(rest)
  const packet = buildPacket(options)

  if (options.out) {
    const outPath = resolve(options.out)
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, `${JSON.stringify(packet, null, 2)}\n`)
  }

  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`)
}

function buildPacket(options) {
  const config = {
    workflowPath: options.workflow ?? defaults.workflowPath,
    cron: options.cron ?? defaults.cron,
    database: options.database ?? defaults.database,
    bucket: options.bucket ?? defaults.bucket,
    env: options.env ?? defaults.env,
    r2Prefix: options.r2Prefix ?? defaults.r2Prefix,
    encryptedArtifactRetentionDays: parsePositiveInteger(
      options.encryptedArtifactRetentionDays,
      defaults.encryptedArtifactRetentionDays,
      '--encrypted-artifact-retention-days',
    ),
    operatorArchiveRetentionDays: parsePositiveInteger(
      options.operatorArchiveRetentionDays,
      defaults.operatorArchiveRetentionDays,
      '--operator-archive-retention-days',
    ),
  }

  return {
    schemaVersion,
    action: 'scheduled_remote_backup_plan',
    status: 'ready',
    generatedAt: new Date().toISOString(),
    schedule: {
      provider: 'github_actions',
      workflowPath: config.workflowPath,
      cron: config.cron,
      timezone: 'UTC',
      purpose: 'daily remote D1 and R2 backup',
    },
    commandPlan: {
      exportCommand: [
        'pnpm',
        'backup:export',
        '--',
        '--out',
        '$BACKUP_OUT',
        '--database',
        config.database,
        '--bucket',
        config.bucket,
        '--mode',
        'remote',
        '--env',
        config.env,
        '--r2-list',
        '--r2-prefix',
        config.r2Prefix,
        '--execute',
      ],
      evidenceCommand: [
        'pnpm',
        'backup:evidence',
        '--',
        '--from',
        '$BACKUP_OUT',
        '--out',
        '$BACKUP_EVIDENCE_OUT',
      ],
      restoreDrillCommand: [
        'pnpm',
        'backup:restore',
        '--',
        '--from',
        '$BACKUP_OUT',
        '--database',
        'honowarden-restore',
        '--bucket',
        'honowarden-restore-vault-objects',
        '--mode',
        'local',
        '--execute',
        '--confirm-fresh-target',
      ],
    },
    requiredSecrets: [
      'CLOUDFLARE_HONOWARDEN_D1_R2_TOKEN',
      'CLOUDFLARE_ACCOUNT_ID',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'HONOWARDEN_BACKUP_ARCHIVE_PASSPHRASE',
    ],
    retention: {
      encryptedArtifactRetentionDays: config.encryptedArtifactRetentionDays,
      operatorArchiveRetentionDays: config.operatorArchiveRetentionDays,
      unencryptedRunnerWorkspace:
        'deleted before job exit on an ephemeral runner',
    },
    encryption: {
      required: true,
      archiveAlgorithm: 'openssl aes-256-cbc pbkdf2',
      passphraseSecret: 'HONOWARDEN_BACKUP_ARCHIVE_PASSPHRASE',
      plaintextPolicy:
        'backup directories are sensitive and must not be committed or uploaded unencrypted',
    },
    failureHandling: {
      alertSources: [
        'GitHub Actions failed scheduled workflow notification',
        'manual Linear checkpoint for repeated backup failure',
        'external alert sink after HON-49 is completed',
      ],
      retryPolicy:
        'manual rerun after confirming credentials, Cloudflare account, D1 export, and R2 listing health',
      rollbackPolicy:
        'restore only into a fresh target; discard partial restore targets instead of mutating production in place',
    },
    evidencePolicy: {
      safeFields: [
        'manifestId',
        'D1 SQL sha256',
        'D1 SQL byte size',
        'R2 object count',
        'R2 object digest id',
        'R2 total byte size',
        'workflow run URL',
      ],
      forbiddenFields: [
        'database names in audit packets',
        'bucket names in audit packets',
        'object keys',
        'object bodies',
        'SQL contents',
        'secret values',
      ],
    },
  }
}

function parseOptions(args) {
  const options = {}

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    switch (arg) {
      case '--out':
      case '--workflow':
      case '--cron':
      case '--database':
      case '--bucket':
      case '--env':
      case '--r2-prefix':
      case '--encrypted-artifact-retention-days':
      case '--operator-archive-retention-days': {
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

function parsePositiveInteger(value, fallback, flagName) {
  if (value === undefined) {
    return fallback
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flagName} must be a positive integer`)
  }

  return parsed
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase())
}

function printUsage() {
  process.stderr.write(`Usage:
  node scripts/honowarden-scheduled-backup-packet.mjs plan [--out <file>] [--workflow <path>] [--cron <expr>] [--database <name>] [--bucket <name>] [--env <name>] [--r2-prefix <prefix>]
`)
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)

if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}

#!/usr/bin/env node

import { relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  assertSecretSafePacket,
  executeCredentialRestoreLifecycle,
} from './honowarden-credential-restore-lifecycle.mjs'

const schemaVersion = 1
const confirmation = 'credential-forward-recovery'
const repoRoot = fileURLToPath(new globalThis.URL('..', import.meta.url))
const fixtureRoot = resolve(repoRoot, 'test/.tmp')
const defaultHarnessRoot = 'test/.tmp/hon-207-official-client'
const defaultRunRoot = 'test/.tmp/hon-226-forward-recovery'

async function main(argv = process.argv.slice(2)) {
  const normalized = argv[0] === '--' ? argv.slice(1) : argv
  const [action, ...rest] = normalized
  if (action !== 'plan' && action !== 'run') {
    throw new Error('action must be plan or run')
  }
  const options = parseOptions(rest)
  if (action === 'run' && !options.execute) {
    throw new Error('run requires --execute')
  }
  if (options.execute && action !== 'run') {
    throw new Error('--execute is only allowed for run')
  }
  if (options.execute && options.confirm !== confirmation) {
    throw new Error(`--confirm ${confirmation} is required before --execute`)
  }
  if (action === 'run' && !options.runRoot) {
    throw new Error('run requires an explicit --run-root')
  }

  const generatedAt = parseTimestamp(options.at)
  const runRoot = resolveRunRoot(options.runRoot ?? defaultRunRoot)
  const packet = buildPacket({ action, generatedAt, options, runRoot })
  if (options.execute) {
    packet.readback = await executeCredentialRestoreLifecycle({
      forwardRecovery: true,
      generatedAt,
      harnessRoot: options.harnessRoot ?? defaultHarnessRoot,
      runRoot: runRoot.relative,
      timeoutMs: options.timeoutMs ?? '120000',
    })
    packet.executed = true
    packet.status = packet.readback.status
    delete packet.next.command
  }
  assertSecretSafePacket(packet)
  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`)
}

function buildPacket({ action, generatedAt, options, runRoot }) {
  return {
    schemaVersion,
    action,
    generatedAt,
    executed: false,
    status: 'planned',
    mode: 'wrangler-local-restored-target-forward-recovery-official-cli-synthetic',
    runRoot: runRoot.relative,
    sequence: [
      'complete_generation_bound_fresh_restore',
      'capture_canonical_d1_r2_identity',
      'reject_four_disabled_writers_before_auth_or_d1',
      'compare_identity_after_every_disabled_request',
      'reenable_same_target_without_reset',
      'commit_exactly_one_forward_password_generation',
      'reject_retry_and_all_prior_generations',
      'verify_official_cli_decrypt_after_restart',
      'bounded_cleanup',
    ],
    readback: null,
    next: {
      confirmation,
      command: buildExecutionCommand({ generatedAt, options, runRoot }),
    },
    safety: {
      localSyntheticOnly: true,
      sameRestoredTargetRequired: true,
      canonicalIdentityRequired: true,
      remoteResourcesAllowed: false,
      realCredentialsAllowed: false,
      deploymentAllowed: false,
      printsSecrets: false,
      trackedSecretEvidenceAllowed: false,
    },
  }
}

function parseOptions(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--') continue
    if (arg === '--execute') {
      options.execute = true
      continue
    }
    if (
      [
        '--at',
        '--confirm',
        '--harness-root',
        '--run-root',
        '--timeout-ms',
      ].includes(arg)
    ) {
      const value = args[index + 1]
      if (!value) throw new Error(`${arg} requires a value`)
      options[toCamelCase(arg.slice(2))] = value
      index += 1
      continue
    }
    throw new Error('unknown credential forward-recovery option')
  }
  return options
}

function buildExecutionCommand({ generatedAt, options, runRoot }) {
  return [
    'pnpm account:credential-forward-recovery -- run',
    `--run-root ${shellQuote(runRoot.relative)}`,
    `--harness-root ${shellQuote(options.harnessRoot ?? defaultHarnessRoot)}`,
    `--at ${shellQuote(generatedAt)}`,
    `--timeout-ms ${shellQuote(options.timeoutMs ?? '120000')}`,
    `--execute --confirm ${confirmation}`,
  ].join(' ')
}

function resolveRunRoot(value) {
  const absolute = resolve(repoRoot, requireValue(value, '--run-root'))
  const inside = relative(fixtureRoot, absolute)
  if (
    inside.length === 0 ||
    inside === '..' ||
    inside.startsWith(`..${sep}`) ||
    inside.includes(sep)
  ) {
    throw new Error('--run-root must be one direct child of test/.tmp')
  }
  return { absolute, relative: relative(repoRoot, absolute) }
}

function parseTimestamp(value) {
  const timestamp = value ?? new Date().toISOString()
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    throw new Error('--at must be an exact ISO timestamp')
  }
  return timestamp
}

function requireValue(value, flag) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${flag} is required`)
  }
  return value
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
}

function shellQuote(value) {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'credential forward-recovery failed'}\n`,
    )
    process.exitCode = 1
  })
}

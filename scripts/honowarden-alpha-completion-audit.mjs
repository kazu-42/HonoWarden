#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'

const repoRoot = fileURLToPath(new URL('..', import.meta.url).toString())
const targetTag = 'v0.1.0-alpha'
const targetVersion = '0.1.0-alpha'
const defaultRemote = 'origin'

function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv)
  const report = buildCompletionAudit(options)

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

  if (options.strict && report.completion !== 'complete') {
    process.stderr.write(
      `alpha completion audit is incomplete: ${report.blockingReason}\n`,
    )
    process.exitCode = 1
  }
}

function buildCompletionAudit(options) {
  const releaseGate = runJsonCommand([
    process.execPath,
    repoPath('scripts/honowarden-release-gate.mjs'),
    '--strict',
  ])
  const statusPacket = runJsonCommand([
    process.execPath,
    repoPath('scripts/honowarden-release-status-packet.mjs'),
    '--remote',
    options.remote,
    ...(options.expectedCommit
      ? ['--expected-commit', options.expectedCommit]
      : []),
    ...(options.tagWorkflowRunId
      ? ['--tag-workflow-run-id', options.tagWorkflowRunId]
      : []),
    ...(options.tagWorkflowUrl
      ? ['--tag-workflow-url', options.tagWorkflowUrl]
      : []),
  ])
  const releaseGateReady =
    releaseGate.exitCode === 0 && releaseGate.report?.overall === 'ready'
  const statusReady =
    statusPacket.exitCode === 0 && statusPacket.report?.status === 'ready'
  const phase = statusPacket.report?.phase ?? 'unknown'
  const publishedVerified = statusReady && phase === 'published_verified'
  const completion =
    releaseGateReady && publishedVerified ? 'complete' : 'incomplete'

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    targetTag,
    targetVersion,
    targetCommit: statusPacket.report?.targetCommit ?? options.expectedCommit,
    completion,
    blockingReason:
      completion === 'complete'
        ? null
        : resolveBlockingReason({
            releaseGateReady,
            statusReady,
            phase,
          }),
    releaseGate: {
      status: releaseGateReady ? 'ready' : 'not_ready',
      exitCode: releaseGate.exitCode,
      failedChecks: failedGateChecks(releaseGate.report),
      error: releaseGate.error,
    },
    releaseStatus: {
      status: statusPacket.report?.status ?? 'not_ready',
      phase,
      exitCode: statusPacket.exitCode,
      existingRelease: statusPacket.report?.existingRelease ?? null,
      nextAction: statusPacket.report?.nextAction ?? null,
      approvalText: statusPacket.report?.approvalText ?? null,
      commands: statusPacket.report?.commands ?? null,
      error: statusPacket.error,
    },
    requirements: [
      {
        id: 'release_gate_ready',
        status: releaseGateReady ? 'pass' : 'fail',
        evidence:
          releaseGate.report?.overall === 'ready'
            ? ['release gate overall ready']
            : failedGateChecks(releaseGate.report),
      },
      {
        id: 'release_status_ready',
        status: statusReady ? 'pass' : 'fail',
        evidence: [`phase: ${phase}`],
      },
      {
        id: 'published_prerelease_verified',
        status: publishedVerified ? 'pass' : 'fail',
        evidence: [`phase: ${phase}`],
      },
    ],
    limitations: [
      'This audit does not publish, update, or delete a GitHub release.',
      'This audit does not create, move, delete, or push a Git tag.',
      'This audit does not deploy from the release.',
      'Strict mode only succeeds after published prerelease verification passes.',
    ],
  }
}

function resolveBlockingReason({ releaseGateReady, statusReady, phase }) {
  if (!releaseGateReady) {
    return 'release_gate_not_ready'
  }

  switch (phase) {
    case 'draft_ready_for_publication':
      return 'release_publication_approval_required'
    case 'published_not_verified':
      return 'post_publication_verification_failed'
    case 'not_ready_for_publication':
      return 'release_publication_not_ready'
    default:
      if (!statusReady) {
        return 'release_status_not_ready'
      }

      return 'unknown_release_phase'
  }
}

function failedGateChecks(report) {
  if (!Array.isArray(report?.checks)) {
    return []
  }

  return report.checks
    .filter((check) => check.status !== 'pass')
    .map((check) => check.id)
}

function runJsonCommand(command) {
  const result = runCommand(command)

  if (result.status !== 0) {
    return {
      report: parseJsonOrNull(result.stdout),
      exitCode: result.status,
      error: firstOutputLine(result) ?? `command failed: ${command.join(' ')}`,
    }
  }

  return {
    report: parseJsonOrNull(result.stdout),
    exitCode: 0,
    error: null,
  }
}

function parseJsonOrNull(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function firstOutputLine(result) {
  return `${result.stderr}\n${result.stdout}`
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
}

function runCommand(command) {
  const result = spawnSync(command[0], command.slice(1), {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.error) {
    throw result.error
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function repoPath(...parts) {
  return join(repoRoot, ...parts)
}

function parseOptions(args) {
  const options = {
    expectedCommit: null,
    remote: defaultRemote,
    strict: false,
    tagWorkflowRunId: null,
    tagWorkflowUrl: null,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    switch (arg) {
      case '--':
        break
      case '--expected-commit': {
        const value = args[index + 1]
        if (!value) {
          throw new Error('--expected-commit requires a value')
        }
        options.expectedCommit = value
        index += 1
        break
      }
      case '--remote': {
        const value = args[index + 1]
        if (!value) {
          throw new Error('--remote requires a value')
        }
        options.remote = value
        index += 1
        break
      }
      case '--strict':
        options.strict = true
        break
      case '--tag-workflow-run-id': {
        const value = args[index + 1]
        if (!value) {
          throw new Error('--tag-workflow-run-id requires a value')
        }
        options.tagWorkflowRunId = value
        index += 1
        break
      }
      case '--tag-workflow-url': {
        const value = args[index + 1]
        if (!value) {
          throw new Error('--tag-workflow-url requires a value')
        }
        options.tagWorkflowUrl = value
        index += 1
        break
      }
      case '--help':
        printUsage()
        process.exit(0)
        break
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }

  return options
}

function printUsage() {
  process.stderr.write(`Usage:
  node scripts/honowarden-alpha-completion-audit.mjs [--strict] [--remote <remote>] [--expected-commit <sha>] [--tag-workflow-run-id <id>] [--tag-workflow-url <url>]
`)
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)

if (isMain) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}

#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'

import { resolveTagWorkflowEvidenceOptions } from './honowarden-tag-workflow-evidence.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url).toString())
const targetTag = 'v0.1.0-alpha'
const targetRepository = 'kazu-42/HonoWarden'
const targetVersion = '0.1.0-alpha'
const defaultRemote = 'origin'

function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv)
  const report = buildStatusPacket(options)

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

  if (options.strict && report.status !== 'ready') {
    process.stderr.write(
      `release status packet is not ready: phase=${report.phase}\n`,
    )
    process.exitCode = 1
  }
}

function buildStatusPacket(options) {
  const publishPacket = runReleasePacket(
    'scripts/honowarden-release-publish-packet.mjs',
    options,
  )
  const publishedPacket = runReleasePacket(
    'scripts/honowarden-release-published-packet.mjs',
    options,
  )
  const publishReport = publishPacket.report
  const publishedReport = publishedPacket.report
  const existingRelease =
    publishReport?.existingRelease ?? publishedReport?.existingRelease ?? null
  const targetCommit =
    publishReport?.targetCommit ??
    publishedReport?.targetCommit ??
    options.expectedCommit ??
    null
  const phase = resolvePhase({
    existingRelease,
    publishReady: publishReport?.status === 'ready',
    publishedReady: publishedReport?.status === 'ready',
  })
  const ready =
    phase === 'draft_ready_for_publication' || phase === 'published_verified'

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: ready ? 'ready' : 'not_ready',
    phase,
    targetTag,
    targetVersion,
    targetCommit,
    remote: options.remote,
    existingRelease,
    packets: {
      publish: summarizePacket(publishPacket),
      published: summarizePacket(publishedPacket),
    },
    nextAction: resolveNextAction({
      phase,
      publishReport,
      publishedReport,
    }),
    approvalText:
      phase === 'draft_ready_for_publication'
        ? (publishReport?.publishApprovalText ?? null)
        : null,
    commands: {
      publishRelease:
        phase === 'draft_ready_for_publication'
          ? (publishReport?.commands?.publishRelease ?? null)
          : null,
      verifyPublished: buildPublishedVerificationCommand(options),
      viewRelease:
        publishReport?.commands?.viewRelease ??
        publishedReport?.commands?.viewRelease ??
        `gh release view ${targetTag} --repo ${targetRepository}`,
    },
    limitations: [
      'This packet does not publish, update, or delete a GitHub release.',
      'This packet does not create, move, delete, or push a Git tag.',
      'This packet does not deploy from the release.',
      'Run external write commands only after explicit operator approval.',
    ],
  }
}

function resolvePhase({ existingRelease, publishReady, publishedReady }) {
  if (publishedReady) {
    return 'published_verified'
  }

  if (existingRelease?.isDraft === false) {
    return 'published_not_verified'
  }

  if (publishReady) {
    return 'draft_ready_for_publication'
  }

  return 'not_ready_for_publication'
}

function resolveNextAction({ phase, publishReport, publishedReport }) {
  switch (phase) {
    case 'published_verified':
      return {
        id: 'record_publication_and_prepare_deployment_gate',
        requiresExternalApproval: true,
        detail:
          'Release is published and verified. Deployment remains a separate approval gate.',
        verificationText: publishedReport?.publishedVerificationText ?? null,
      }
    case 'published_not_verified':
      return {
        id: 'inspect_published_release_verification',
        requiresExternalApproval: false,
        detail:
          'Release is no longer a draft, but published verification is not ready. Inspect failed published packet checks.',
        failedChecks: failedCheckIds(publishedReport),
      }
    case 'draft_ready_for_publication':
      return {
        id: 'request_publication_approval',
        requiresExternalApproval: true,
        detail:
          'Release draft is ready for publication. Use approvalText before running the publish command.',
        postPublicationPendingChecks: failedCheckIds(publishedReport),
      }
    default:
      return {
        id: 'resolve_publication_blockers',
        requiresExternalApproval: false,
        detail:
          'Release is not ready for publication. Resolve failed publish packet checks first.',
        failedChecks: failedCheckIds(publishReport),
      }
  }
}

function summarizePacket(packet) {
  if (!packet.report) {
    return {
      status: 'not_ready',
      exitCode: packet.exitCode,
      error: packet.error,
      failedChecks: [],
    }
  }

  return {
    status: packet.report.status,
    exitCode: packet.exitCode,
    failedChecks: failedCheckIds(packet.report),
  }
}

function failedCheckIds(report) {
  if (!Array.isArray(report?.checks)) {
    return []
  }

  return report.checks
    .filter((check) => check.status !== 'pass')
    .map((check) => check.id)
}

function runReleasePacket(scriptPath, options) {
  const command = [
    process.execPath,
    repoPath(scriptPath),
    '--remote',
    options.remote,
    ...(options.expectedCommit
      ? ['--expected-commit', options.expectedCommit]
      : []),
    ...(options.defaultTagWorkflowEvidence === false
      ? ['--no-default-tag-workflow-evidence']
      : []),
    ...(options.tagWorkflowRunId
      ? ['--tag-workflow-run-id', options.tagWorkflowRunId]
      : []),
    ...(options.tagWorkflowUrl
      ? ['--tag-workflow-url', options.tagWorkflowUrl]
      : []),
  ]
  const result = runCommand(command)

  if (result.status !== 0) {
    return {
      report: null,
      exitCode: result.status,
      error: firstOutputLine(result) || `command failed: ${command.join(' ')}`,
    }
  }

  try {
    return {
      report: JSON.parse(result.stdout),
      exitCode: 0,
      error: null,
    }
  } catch (error) {
    return {
      report: null,
      exitCode: 1,
      error: `failed to parse packet JSON: ${error.message}`,
    }
  }
}

function buildPublishedVerificationCommand(options) {
  const args = [
    'pnpm release:published:packet -- --strict',
    `--tag-workflow-run-id ${options.tagWorkflowRunId ?? '<run-id>'}`,
    `--tag-workflow-url ${options.tagWorkflowUrl ?? '<run-url>'}`,
  ]

  return args.join(' ')
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
    defaultTagWorkflowEvidence: true,
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
      case '--no-default-tag-workflow-evidence':
        options.defaultTagWorkflowEvidence = false
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

  return resolveTagWorkflowEvidenceOptions(options, repoRoot)
}

function printUsage() {
  process.stderr.write(`Usage:
  node scripts/honowarden-release-status-packet.mjs [--strict] [--remote <remote>] [--expected-commit <sha>] [--tag-workflow-run-id <id>] [--tag-workflow-url <url>] [--no-default-tag-workflow-evidence]
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

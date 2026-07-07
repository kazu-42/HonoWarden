#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { isAbsolute, join, relative } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'

const repoRoot = fileURLToPath(new URL('..', import.meta.url).toString())
const targetTag = 'v0.1.0-alpha'
const targetVersion = '0.1.0-alpha'
const defaultRemote = 'origin'

function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv)
  const report = buildOpsReadinessPacket(options)

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

  if (options.strict && report.status !== 'ready') {
    process.stderr.write(
      `ops readiness packet is not ready: ${report.blockingReason}\n`,
    )
    process.exitCode = 1
  }
}

function buildOpsReadinessPacket(options) {
  const releaseAudit = runJsonCommand([
    process.execPath,
    repoPath('scripts/honowarden-alpha-completion-audit.mjs'),
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
  const emailPreflight = runJsonCommand([
    process.execPath,
    repoPath('scripts/honowarden-email-preflight.mjs'),
  ])
  const evidence = resolveEvidence(options)
  const requirements = buildRequirements({
    releaseAudit,
    emailPreflight,
    evidence,
  })
  const ready = requirements.every(
    (requirement) => requirement.status === 'pass',
  )

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    targetTag,
    targetVersion,
    status: ready ? 'ready' : 'not_ready',
    blockingReason: ready ? null : firstBlockingReason(requirements),
    release: {
      completion: releaseAudit.report?.completion ?? 'unknown',
      blockingReason: releaseAudit.report?.blockingReason ?? null,
      statusPhase: releaseAudit.report?.releaseStatus?.phase ?? 'unknown',
      targetCommit: releaseAudit.report?.targetCommit ?? options.expectedCommit,
      exitCode: releaseAudit.exitCode,
      error: releaseAudit.error,
    },
    email: {
      localPreflightStatus: emailPreflight.report?.status ?? 'not_ready',
      configuredRoutes: configuredEmailRoutes(emailPreflight.report),
      requiredRoutes: emailPreflight.report?.routes?.length ?? 0,
      exitCode: emailPreflight.exitCode,
      error: emailPreflight.error,
    },
    evidence,
    requirements,
    nextActions: nextActions(requirements),
    commands: {
      releaseCompletionAudit: [
        'pnpm release:completion:audit',
        ...(options.expectedCommit
          ? ['-- --expected-commit', options.expectedCommit]
          : ['--']),
        ...(options.tagWorkflowRunId
          ? ['--tag-workflow-run-id', options.tagWorkflowRunId]
          : []),
        ...(options.tagWorkflowUrl
          ? ['--tag-workflow-url', options.tagWorkflowUrl]
          : []),
      ].join(' '),
      emailPreflight: 'pnpm email:preflight -- --strict',
      publishedVerification: buildPublishedVerificationCommand(options),
    },
    limitations: [
      'This packet does not publish, update, or delete a GitHub release.',
      'This packet does not create, move, delete, or push a Git tag.',
      'This packet does not deploy Workers, change DNS, configure Email Routing, or send email.',
      'Documentation-only website status is not treated as live operational evidence.',
      'Email local preflight proves required inputs are present but not that Cloudflare Email Routing is enabled.',
    ],
  }
}

function buildPublishedVerificationCommand(options) {
  return [
    'pnpm release:published:packet',
    '--',
    '--strict',
    ...(options.expectedCommit
      ? ['--expected-commit', options.expectedCommit]
      : []),
    '--tag-workflow-run-id',
    options.tagWorkflowRunId ?? '<run-id>',
    '--tag-workflow-url',
    options.tagWorkflowUrl ?? '<run-url>',
  ].join(' ')
}

function buildRequirements({ releaseAudit, emailPreflight, evidence }) {
  const releaseComplete = releaseAudit.report?.completion === 'complete'
  const emailInputsReady = emailPreflight.report?.status === 'ready'

  return [
    requirement({
      id: 'release_published_verified',
      passed: releaseComplete,
      blocker: releaseAudit.report?.blockingReason ?? 'release_not_complete',
      evidence: [
        `completion: ${releaseAudit.report?.completion ?? 'unknown'}`,
        `phase: ${releaseAudit.report?.releaseStatus?.phase ?? 'unknown'}`,
      ],
      nextAction:
        'Publish the draft prerelease only after explicit publication approval, then run published verification.',
    }),
    requirement({
      id: 'cloudflare_resources_recorded',
      passed: evidence.cloudflareResourcesRecorded,
      blocker: 'cloudflare_resource_evidence_missing',
      evidence: [evidence.cloudflareResourceEvidencePath],
      nextAction:
        'Record non-secret Cloudflare D1/R2 resource evidence before deploy approval.',
    }),
    requirement({
      id: 'staging_dry_run_recorded',
      passed: evidence.stagingDryRunRecorded,
      blocker: 'staging_dry_run_evidence_missing',
      evidence: [evidence.stagingDryRunEvidencePath],
      nextAction:
        'Run and record the staging deploy dry-run before live Worker deployment.',
    }),
    requirement({
      id: 'worker_live_smoke_recorded',
      passed: evidence.workerLiveSmokeRecorded,
      blocker: 'worker_live_smoke_evidence_missing',
      evidence: [evidence.workerLiveSmokeEvidencePath],
      nextAction:
        'After deploy approval, record redacted Worker health and API smoke evidence.',
    }),
    requirement({
      id: 'website_live_evidence_recorded',
      passed: evidence.websiteLiveEvidenceRecorded,
      blocker: 'website_live_evidence_missing',
      evidence: [evidence.websiteLiveEvidencePath],
      nextAction:
        'Record website deployment, domain route, health check, and rollback evidence.',
    }),
    requirement({
      id: 'email_local_inputs_ready',
      passed: emailInputsReady,
      blocker: 'email_local_inputs_missing',
      evidence: [
        `email preflight: ${emailPreflight.report?.status ?? 'not_ready'}`,
        `configured routes: ${configuredEmailRoutes(emailPreflight.report)}/${
          emailPreflight.report?.routes?.length ?? 0
        }`,
      ],
      nextAction:
        'Populate local Cloudflare and forwarding-destination inputs without committing secrets.',
    }),
    requirement({
      id: 'email_routing_live_evidence_recorded',
      passed: evidence.emailRoutingEvidenceRecorded,
      blocker: 'email_routing_evidence_missing',
      evidence: [evidence.emailRoutingEvidencePath],
      nextAction:
        'After Email Routing approval, record route configuration and inbound test evidence without message content.',
    }),
    requirement({
      id: 'ops_rollback_evidence_recorded',
      passed: evidence.rollbackEvidenceRecorded,
      blocker: 'ops_rollback_evidence_missing',
      evidence: [evidence.rollbackEvidencePath],
      nextAction:
        'Record rollback handles for Worker deploy, website route, and email routing changes.',
    }),
  ]
}

function requirement({ id, passed, blocker, evidence, nextAction }) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    blocker: passed ? null : blocker,
    evidence,
    nextAction: passed ? null : nextAction,
  }
}

function resolveEvidence(options) {
  const cloudflareResourceEvidencePath =
    'docs/release/cloudflare-resource-evidence.md'
  const stagingDryRunEvidencePath = 'docs/release/staging-deploy-evidence.md'
  const workerLiveSmokeEvidencePath =
    options.workerLiveSmokeEvidencePath ??
    'docs/release/worker-live-smoke-evidence.md'
  const websiteLiveEvidencePath =
    options.websiteLiveEvidencePath ?? 'docs/release/website-live-evidence.md'
  const emailRoutingEvidencePath =
    options.emailRoutingEvidencePath ?? 'docs/release/email-routing-evidence.md'
  const rollbackEvidencePath =
    options.rollbackEvidencePath ?? 'docs/release/ops-rollback-evidence.md'

  return {
    cloudflareResourceEvidencePath,
    cloudflareResourcesRecorded: documentRecordsStatusPassed(
      cloudflareResourceEvidencePath,
    ),
    stagingDryRunEvidencePath,
    stagingDryRunRecorded: documentRecordsStatusPassed(
      stagingDryRunEvidencePath,
    ),
    workerLiveSmokeEvidencePath,
    workerLiveSmokeRecorded: documentRecordsStatusPassed(
      workerLiveSmokeEvidencePath,
    ),
    websiteLiveEvidencePath,
    websiteLiveEvidenceRecorded: documentRecordsStatusPassed(
      websiteLiveEvidencePath,
    ),
    emailRoutingEvidencePath,
    emailRoutingEvidenceRecorded: documentRecordsStatusPassed(
      emailRoutingEvidencePath,
    ),
    rollbackEvidencePath,
    rollbackEvidenceRecorded: documentRecordsStatusPassed(rollbackEvidencePath),
  }
}

function documentRecordsStatusPassed(path) {
  const fullPath = evidenceFullPath(path)
  if (!existsSync(fullPath)) {
    return false
  }

  const content = readFileSync(fullPath, 'utf8')
  return /^Status:\s*passed\.?\s*$/im.test(content)
}

function configuredEmailRoutes(report) {
  if (!Array.isArray(report?.routes)) {
    return 0
  }

  return report.routes.filter((route) => route.destinationConfigured).length
}

function firstBlockingReason(requirements) {
  return (
    requirements.find((requirement) => requirement.status === 'fail')
      ?.blocker ?? 'unknown'
  )
}

function nextActions(requirements) {
  return requirements
    .filter((requirement) => requirement.status === 'fail')
    .map((requirement) => ({
      id: requirement.id,
      blocker: requirement.blocker,
      action: requirement.nextAction,
    }))
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

function evidenceFullPath(path) {
  return isAbsolute(path) ? path : repoPath(path)
}

function normalizeEvidencePath(path) {
  const fullPath = evidenceFullPath(path)
  const relativePath = relative(repoRoot, fullPath).replaceAll('\\', '/')

  if (relativePath === '' || relativePath.startsWith('..')) {
    return path
  }

  return relativePath
}

function parseOptions(args) {
  const options = {
    expectedCommit: null,
    remote: defaultRemote,
    strict: false,
    tagWorkflowRunId: null,
    tagWorkflowUrl: null,
    workerLiveSmokeEvidencePath: null,
    websiteLiveEvidencePath: null,
    emailRoutingEvidencePath: null,
    rollbackEvidencePath: null,
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
      case '--worker-live-smoke-evidence': {
        options.workerLiveSmokeEvidencePath = evidencePathValue(
          arg,
          args[index + 1],
        )
        index += 1
        break
      }
      case '--website-live-evidence': {
        options.websiteLiveEvidencePath = evidencePathValue(
          arg,
          args[index + 1],
        )
        index += 1
        break
      }
      case '--email-routing-evidence': {
        options.emailRoutingEvidencePath = evidencePathValue(
          arg,
          args[index + 1],
        )
        index += 1
        break
      }
      case '--rollback-evidence': {
        options.rollbackEvidencePath = evidencePathValue(arg, args[index + 1])
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

  options.workerLiveSmokeEvidencePath =
    options.workerLiveSmokeEvidencePath &&
    normalizeEvidencePath(options.workerLiveSmokeEvidencePath)
  options.websiteLiveEvidencePath =
    options.websiteLiveEvidencePath &&
    normalizeEvidencePath(options.websiteLiveEvidencePath)
  options.emailRoutingEvidencePath =
    options.emailRoutingEvidencePath &&
    normalizeEvidencePath(options.emailRoutingEvidencePath)
  options.rollbackEvidencePath =
    options.rollbackEvidencePath &&
    normalizeEvidencePath(options.rollbackEvidencePath)

  return options
}

function evidencePathValue(option, value) {
  if (!value) {
    throw new Error(`${option} requires a value`)
  }

  return value
}

function printUsage() {
  process.stdout.write(`Usage:
  node scripts/honowarden-ops-readiness-packet.mjs [--strict] [--remote <remote>] [--expected-commit <sha>] [--tag-workflow-run-id <id>] [--tag-workflow-url <url>]

Read-only post-alpha operations readiness packet.
`)
}

main()

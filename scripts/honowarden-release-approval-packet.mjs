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
  const report = buildApprovalPacket(options)

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

  if (options.strict && report.status !== 'ready') {
    process.stderr.write(
      `release approval packet is not ready: ${failedCount(report)} failed check(s)\n`,
    )
    process.exitCode = 1
  }
}

function buildApprovalPacket(options) {
  const targetCommit = commandText(['git', 'rev-parse', 'HEAD'])
  const ciEvidence = resolveCiEvidence(options, targetCommit)
  const releaseGate = runJson([
    process.execPath,
    repoPath('scripts/honowarden-release-gate.mjs'),
    '--strict',
  ])
  const tagPreflight = runJson([
    process.execPath,
    repoPath('scripts/honowarden-alpha-tag-preflight.mjs'),
    '--strict',
    '--check-remote',
    '--remote',
    options.remote,
    ...(options.allowDirty ? ['--allow-dirty'] : []),
  ])
  const githubReleasePlan = runJson([
    process.execPath,
    repoPath('scripts/honowarden-github-release-plan.mjs'),
    '--allow-missing-tag',
    '--allow-missing-remote-tag',
    '--check-remote',
    '--remote',
    options.remote,
  ])
  const checks = [
    check(
      'release_gate_ready',
      releaseGate.overall === 'ready',
      `release gate overall is ${releaseGate.overall}`,
    ),
    check(
      'tag_preflight_ready',
      tagPreflight.status === 'ready',
      `tag preflight status is ${tagPreflight.status}`,
    ),
    check(
      'github_release_plan_ready',
      githubReleasePlan.status === 'ready',
      `github release plan status is ${githubReleasePlan.status}`,
    ),
    ciEvidence.check,
    check(
      'commit_alignment',
      tagPreflight.sourceCommit === targetCommit &&
        githubReleasePlan.targetCommit === targetCommit,
      `head=${targetCommit}; tagPreflight=${tagPreflight.sourceCommit}; githubReleasePlan=${githubReleasePlan.targetCommit}`,
    ),
  ]
  const ready = checks.every((item) => item.status === 'pass')

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: ready ? 'ready' : 'not_ready',
    targetTag,
    targetVersion,
    targetCommit,
    remote: options.remote,
    ci: {
      runId: options.ciRunId,
      url: options.ciUrl,
      missingAllowed: options.allowMissingCi,
      verifiedRun: ciEvidence.run,
    },
    checks,
    commands: {
      createTag: tagPreflight.commands?.createTag ?? null,
      pushTag: tagPreflight.commands?.pushTag ?? null,
      createDraft: githubReleasePlan.commands?.createDraft ?? null,
      viewRelease: githubReleasePlan.commands?.viewRelease ?? null,
    },
    approvalText: `${targetCommit} に ${targetTag} を作成して push してよい`,
    limitations: [
      'This packet does not create or push a Git tag.',
      'This packet does not create, update, publish, or delete a GitHub release.',
      'Run the tag commands only after explicit operator approval.',
      'Run the draft release command only after tag verification CI passes.',
    ],
  }
}

function resolveCiEvidence(options, targetCommit) {
  const hasRunId = typeof options.ciRunId === 'string' && options.ciRunId !== ''

  if (!hasRunId) {
    return {
      run: null,
      check: check(
        'ci_evidence',
        options.allowMissingCi,
        options.allowMissingCi
          ? 'CI run evidence is missing but allowed by --allow-missing-ci'
          : 'CI run evidence is missing',
      ),
    }
  }

  const result = runCommand([
    'gh',
    'run',
    'view',
    options.ciRunId,
    '--json',
    'databaseId,headSha,status,conclusion,url,workflowName',
  ])

  if (result.status !== 0) {
    return {
      run: null,
      check: check(
        'ci_evidence',
        false,
        firstOutputLine(result) ||
          `failed to verify GitHub Actions CI run ${options.ciRunId}`,
      ),
    }
  }

  let run
  try {
    run = JSON.parse(result.stdout)
  } catch (error) {
    return {
      run: null,
      check: check(
        'ci_evidence',
        false,
        `failed to parse GitHub Actions CI run ${options.ciRunId}: ${error.message}`,
      ),
    }
  }

  const normalizedRun = {
    databaseId: run.databaseId ?? null,
    workflowName: run.workflowName ?? null,
    headSha: run.headSha ?? null,
    status: run.status ?? null,
    conclusion: run.conclusion ?? null,
    url: run.url ?? null,
  }
  const failures = []

  if (String(normalizedRun.databaseId) !== String(options.ciRunId)) {
    failures.push(
      `databaseId=${normalizedRun.databaseId}; expected ${options.ciRunId}`,
    )
  }
  if (normalizedRun.headSha !== targetCommit) {
    failures.push(`headSha=${normalizedRun.headSha}; expected ${targetCommit}`)
  }
  if (normalizedRun.status !== 'completed') {
    failures.push(`status=${normalizedRun.status}; expected completed`)
  }
  if (normalizedRun.conclusion !== 'success') {
    failures.push(`conclusion=${normalizedRun.conclusion}; expected success`)
  }
  if (options.ciUrl && normalizedRun.url !== options.ciUrl) {
    failures.push(`url=${normalizedRun.url}; expected ${options.ciUrl}`)
  }

  return {
    run: normalizedRun,
    check: check(
      'ci_evidence',
      failures.length === 0,
      failures.length === 0
        ? `GitHub Actions ${normalizedRun.workflowName ?? 'CI'} run ${options.ciRunId} completed successfully for ${targetCommit}`
        : failures.join('; '),
    ),
  }
}

function check(id, passed, detail) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    detail,
  }
}

function failedCount(report) {
  return report.checks.filter((check) => check.status === 'fail').length
}

function runJson(command) {
  const result = runCommand(command)

  if (result.status !== 0) {
    return {
      status: 'not_ready',
      error: firstOutputLine(result) || `command failed: ${command.join(' ')}`,
    }
  }

  return JSON.parse(result.stdout)
}

function firstOutputLine(result) {
  return `${result.stderr}\n${result.stdout}`
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
}

function commandText(command) {
  const result = runCommand(command)

  if (result.status !== 0) {
    throw new Error(
      `Command failed with exit code ${result.status}: ${command.join(' ')}`,
    )
  }

  return result.stdout.trim()
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
    allowDirty: false,
    allowMissingCi: false,
    ciRunId: null,
    ciUrl: null,
    remote: defaultRemote,
    strict: false,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    switch (arg) {
      case '--':
        break
      case '--allow-dirty':
        options.allowDirty = true
        break
      case '--allow-missing-ci':
        options.allowMissingCi = true
        break
      case '--ci-run-id': {
        const value = args[index + 1]
        if (!value) {
          throw new Error('--ci-run-id requires a value')
        }
        options.ciRunId = value
        index += 1
        break
      }
      case '--ci-url': {
        const value = args[index + 1]
        if (!value) {
          throw new Error('--ci-url requires a value')
        }
        options.ciUrl = value
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
  node scripts/honowarden-release-approval-packet.mjs [--strict] [--remote <remote>] [--allow-dirty] [--ci-run-id <id>] [--ci-url <url>] [--allow-missing-ci]
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

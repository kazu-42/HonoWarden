#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'

const repoRoot = fileURLToPath(new URL('..', import.meta.url).toString())
const targetTag = 'v0.1.0-alpha'
const targetVersion = '0.1.0-alpha'
const targetWorkflowName = 'Release Tag Verification'
const defaultRemote = 'origin'

function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv)
  const report = buildPostTagPacket(options)

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

  if (options.strict && report.status !== 'ready') {
    process.stderr.write(
      `post-tag release packet is not ready: ${failedCount(report)} failed check(s)\n`,
    )
    process.exitCode = 1
  }
}

function buildPostTagPacket(options) {
  const targetCommit =
    options.expectedCommit ?? commandText(['git', 'rev-parse', 'HEAD'])
  const releasePlan = runJson([
    process.execPath,
    repoPath('scripts/honowarden-github-release-plan.mjs'),
    '--strict',
    '--check-remote',
    '--remote',
    options.remote,
    '--expected-commit',
    targetCommit,
    ...(options.allowMissingTag ? ['--allow-missing-tag'] : []),
    ...(options.allowMissingRemoteTag ? ['--allow-missing-remote-tag'] : []),
  ])
  const releaseState = resolveReleaseState(targetCommit)
  const tagWorkflow = resolveTagWorkflow(options, targetCommit)
  const checks = [
    checkLocalTag(options, targetCommit),
    checkRemoteTag(options, targetCommit),
    tagWorkflow.check,
    check(
      'github_release_plan_ready',
      releasePlan.status === 'ready',
      `github release plan status is ${releasePlan.status}`,
    ),
    releaseState.check,
  ]
  const ready = checks.every((item) => item.status === 'pass')
  const canApproveDraft =
    ready &&
    !options.allowMissingTag &&
    !options.allowMissingRemoteTag &&
    !options.allowMissingTagWorkflow

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: ready ? 'ready' : 'not_ready',
    targetTag,
    targetVersion,
    targetCommit,
    remote: options.remote,
    tagWorkflow: {
      runId: options.tagWorkflowRunId,
      url: options.tagWorkflowUrl,
      missingAllowed: options.allowMissingTagWorkflow,
      verifiedRun: tagWorkflow.run,
    },
    existingRelease: releaseState.release,
    checks,
    commands: {
      createDraft: releasePlan.commands?.createDraft ?? null,
      viewRelease: releasePlan.commands?.viewRelease ?? null,
    },
    draftApprovalText: canApproveDraft
      ? `${targetCommit} の ${targetTag} tag verification が成功したので GitHub release draft を作成してよい`
      : null,
    limitations: [
      'This packet does not create, update, publish, or delete a GitHub release.',
      'This packet does not create, move, delete, or push a Git tag.',
      'Run the draft release command only after explicit operator approval.',
      'Publishing a release or deploying from a release requires a separate approval gate.',
    ],
  }
}

function checkLocalTag(options, targetCommit) {
  const result = runCommand([
    'git',
    'rev-parse',
    '-q',
    '--verify',
    `refs/tags/${targetTag}`,
  ])

  if (result.status !== 0) {
    return check(
      'local_tag_context',
      options.allowMissingTag,
      options.allowMissingTag
        ? 'local tag is missing but allowed by --allow-missing-tag'
        : 'local tag is missing',
    )
  }

  const tagCommit = commandText(['git', 'rev-list', '-n', '1', targetTag])

  return check(
    'local_tag_context',
    tagCommit === targetCommit,
    tagCommit === targetCommit
      ? `local tag points at ${targetCommit}`
      : `local tag points at ${tagCommit}; expected ${targetCommit}`,
  )
}

function checkRemoteTag(options, targetCommit) {
  const result = runCommand([
    'git',
    'ls-remote',
    '--tags',
    options.remote,
    targetTag,
  ])

  if (result.status !== 0) {
    return check(
      'remote_tag_context',
      false,
      firstOutputLine(result) ||
        `remote tag check failed for ${options.remote}`,
    )
  }

  const remoteCommit = parseRemoteTagCommit(result.stdout)

  if (!remoteCommit) {
    return check(
      'remote_tag_context',
      options.allowMissingRemoteTag,
      options.allowMissingRemoteTag
        ? `remote tag is missing on ${options.remote} but allowed by --allow-missing-remote-tag`
        : `remote tag is missing on ${options.remote}`,
    )
  }

  return check(
    'remote_tag_context',
    remoteCommit === targetCommit,
    remoteCommit === targetCommit
      ? `remote tag on ${options.remote} points at ${targetCommit}`
      : `remote tag on ${options.remote} points at ${remoteCommit}; expected ${targetCommit}`,
  )
}

function parseRemoteTagCommit(stdout) {
  const lines = stdout
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const peeled = lines.find((line) =>
    line.endsWith(`refs/tags/${targetTag}^{}`),
  )
  const exact = lines.find((line) => line.endsWith(`refs/tags/${targetTag}`))
  const selected = peeled ?? exact

  return selected?.split(/\s+/)[0] ?? null
}

function resolveTagWorkflow(options, targetCommit) {
  const hasRunId =
    typeof options.tagWorkflowRunId === 'string' &&
    options.tagWorkflowRunId !== ''

  if (!hasRunId) {
    return {
      run: null,
      check: check(
        'tag_workflow_ci',
        options.allowMissingTagWorkflow,
        options.allowMissingTagWorkflow
          ? 'tag workflow run evidence is missing but allowed by --allow-missing-tag-workflow'
          : 'tag workflow run evidence is missing',
      ),
    }
  }

  const result = runCommand([
    'gh',
    'run',
    'view',
    options.tagWorkflowRunId,
    '--json',
    'databaseId,headSha,status,conclusion,url,workflowName,event',
  ])

  if (result.status !== 0) {
    return {
      run: null,
      check: check(
        'tag_workflow_ci',
        false,
        firstOutputLine(result) ||
          `failed to verify tag workflow run ${options.tagWorkflowRunId}`,
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
        'tag_workflow_ci',
        false,
        `failed to parse tag workflow run ${options.tagWorkflowRunId}: ${error.message}`,
      ),
    }
  }

  const normalizedRun = {
    databaseId: run.databaseId ?? null,
    workflowName: run.workflowName ?? null,
    event: run.event ?? null,
    headSha: run.headSha ?? null,
    status: run.status ?? null,
    conclusion: run.conclusion ?? null,
    url: run.url ?? null,
  }
  const failures = []

  if (String(normalizedRun.databaseId) !== String(options.tagWorkflowRunId)) {
    failures.push(
      `databaseId=${normalizedRun.databaseId}; expected ${options.tagWorkflowRunId}`,
    )
  }
  if (normalizedRun.workflowName !== targetWorkflowName) {
    failures.push(
      `workflowName=${normalizedRun.workflowName}; expected ${targetWorkflowName}`,
    )
  }
  if (normalizedRun.event !== 'push') {
    failures.push(`event=${normalizedRun.event}; expected push`)
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
  if (options.tagWorkflowUrl && normalizedRun.url !== options.tagWorkflowUrl) {
    failures.push(
      `url=${normalizedRun.url}; expected ${options.tagWorkflowUrl}`,
    )
  }

  return {
    run: normalizedRun,
    check: check(
      'tag_workflow_ci',
      failures.length === 0,
      failures.length === 0
        ? `${targetWorkflowName} run ${options.tagWorkflowRunId} completed successfully for ${targetCommit}`
        : failures.join('; '),
    ),
  }
}

function resolveReleaseState(targetCommit) {
  const result = runCommand([
    'gh',
    'release',
    'view',
    targetTag,
    '--json',
    'tagName,isDraft,isPrerelease,targetCommitish,url',
  ])

  if (result.status !== 0) {
    const detail = firstOutputLine(result)
    const releaseMissing = /\bnot found\b|could not resolve/i.test(detail ?? '')

    return {
      release: null,
      check: check(
        'release_state',
        releaseMissing,
        releaseMissing
          ? detail || 'release does not exist yet'
          : detail || 'release state check failed',
      ),
    }
  }

  let release
  try {
    release = JSON.parse(result.stdout)
  } catch (error) {
    return {
      release: null,
      check: check(
        'release_state',
        false,
        `failed to parse existing release state: ${error.message}`,
      ),
    }
  }

  const normalizedRelease = {
    tagName: release.tagName ?? null,
    isDraft: release.isDraft ?? null,
    isPrerelease: release.isPrerelease ?? null,
    targetCommitish: release.targetCommitish ?? null,
    url: release.url ?? null,
  }
  const targetMatches =
    normalizedRelease.targetCommitish === targetCommit ||
    normalizedRelease.targetCommitish === targetTag
  const failures = []

  if (normalizedRelease.tagName !== targetTag) {
    failures.push(`tagName=${normalizedRelease.tagName}; expected ${targetTag}`)
  }
  if (normalizedRelease.isDraft !== true) {
    failures.push(`isDraft=${normalizedRelease.isDraft}; expected true`)
  }
  if (normalizedRelease.isPrerelease !== true) {
    failures.push(
      `isPrerelease=${normalizedRelease.isPrerelease}; expected true`,
    )
  }
  if (!targetMatches) {
    failures.push(
      `targetCommitish=${normalizedRelease.targetCommitish}; expected ${targetCommit} or ${targetTag}`,
    )
  }

  return {
    release: normalizedRelease,
    check: check(
      'release_state',
      failures.length === 0,
      failures.length === 0
        ? 'existing release is a draft prerelease for the target tag'
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
    allowMissingRemoteTag: false,
    allowMissingTag: false,
    allowMissingTagWorkflow: false,
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
      case '--allow-missing-remote-tag':
        options.allowMissingRemoteTag = true
        break
      case '--allow-missing-tag':
        options.allowMissingTag = true
        break
      case '--allow-missing-tag-workflow':
        options.allowMissingTagWorkflow = true
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
  node scripts/honowarden-post-tag-release-packet.mjs [--strict] [--remote <remote>] [--expected-commit <sha>] [--tag-workflow-run-id <id>] [--tag-workflow-url <url>] [--allow-missing-tag] [--allow-missing-remote-tag] [--allow-missing-tag-workflow]
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

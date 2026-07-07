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
const requiredReleaseBodyFragments = [
  '# v0.1.0-alpha Release Notes',
  'HonoWarden is pre-alpha',
  '## Scope',
  '## Not Included',
  '## Compatibility',
  '## Operations',
  '## Known Risks',
  '## Release Gate',
]

function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv)
  const report = buildPublishedPacket(options)

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

  if (options.strict && report.status !== 'ready') {
    process.stderr.write(
      `release published packet is not ready: ${failedCount(report)} failed check(s)\n`,
    )
    process.exitCode = 1
  }
}

function buildPublishedPacket(options) {
  const targetCommit =
    options.expectedCommit ??
    commandText(['git', 'rev-list', '-n', '1', targetTag])
  const releaseGate = runJson([
    process.execPath,
    repoPath('scripts/honowarden-release-gate.mjs'),
    '--strict',
  ])
  const release = resolveReleaseState(targetCommit)
  const tagWorkflow = resolveTagWorkflow(options, targetCommit)
  const checks = [
    checkLocalTag(targetCommit),
    checkRemoteTag(options.remote, targetCommit),
    tagWorkflow.check,
    check(
      'release_gate_ready',
      releaseGate.overall === 'ready',
      `release gate overall is ${releaseGate.overall}`,
    ),
    release.stateCheck,
    release.bodyCheck,
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
    tagWorkflow: {
      runId: options.tagWorkflowRunId,
      url: options.tagWorkflowUrl,
      verifiedRun: tagWorkflow.run,
    },
    existingRelease: release.release,
    checks,
    commands: {
      viewRelease: `gh release view ${targetTag}`,
    },
    publishedVerificationText:
      ready && release.release
        ? `${targetCommit} の ${targetTag} published prerelease verification が成功した`
        : null,
    limitations: [
      'This packet does not publish, update, or delete a GitHub release.',
      'This packet does not create, move, delete, or push a Git tag.',
      'This packet does not deploy from the release.',
      'Deployment from a published release requires a separate approval gate.',
    ],
  }
}

function checkLocalTag(targetCommit) {
  const result = runCommand([
    'git',
    'rev-parse',
    '-q',
    '--verify',
    `refs/tags/${targetTag}`,
  ])

  if (result.status !== 0) {
    return check('local_tag_context', false, 'local tag is missing')
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

function checkRemoteTag(remote, targetCommit) {
  const result = runCommand([
    'git',
    'ls-remote',
    '--tags',
    remote,
    targetTag,
    `${targetTag}^{}`,
  ])

  if (result.status !== 0) {
    return check(
      'remote_tag_context',
      false,
      firstOutputLine(result) || `remote tag check failed for ${remote}`,
    )
  }

  const remoteCommit = parseRemoteTagCommit(result.stdout)

  return check(
    'remote_tag_context',
    remoteCommit === targetCommit,
    remoteCommit === targetCommit
      ? `remote tag on ${remote} points at ${targetCommit}`
      : `remote tag on ${remote} points at ${remoteCommit ?? '<missing>'}; expected ${targetCommit}`,
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
        false,
        'tag workflow run evidence is missing',
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
    'tagName,name,isDraft,isPrerelease,targetCommitish,url,body',
  ])

  if (result.status !== 0) {
    return {
      release: null,
      stateCheck: check(
        'release_state',
        false,
        firstOutputLine(result) || 'release not found',
      ),
      bodyCheck: check('release_body', false, 'release body is missing'),
    }
  }

  let release
  try {
    release = JSON.parse(result.stdout)
  } catch (error) {
    return {
      release: null,
      stateCheck: check(
        'release_state',
        false,
        `failed to parse release: ${error.message}`,
      ),
      bodyCheck: check(
        'release_body',
        false,
        'release body could not be parsed',
      ),
    }
  }

  const normalizedRelease = {
    tagName: release.tagName ?? null,
    name: release.name ?? null,
    isDraft: release.isDraft ?? null,
    isPrerelease: release.isPrerelease ?? null,
    targetCommitish: release.targetCommitish ?? null,
    url: release.url ?? null,
  }
  const stateFailures = []

  if (normalizedRelease.tagName !== targetTag) {
    stateFailures.push(
      `tagName=${normalizedRelease.tagName}; expected ${targetTag}`,
    )
  }
  if (normalizedRelease.isDraft !== false) {
    stateFailures.push(`isDraft=${normalizedRelease.isDraft}; expected false`)
  }
  if (normalizedRelease.isPrerelease !== true) {
    stateFailures.push(
      `isPrerelease=${normalizedRelease.isPrerelease}; expected true`,
    )
  }
  if (normalizedRelease.targetCommitish !== targetCommit) {
    stateFailures.push(
      `targetCommitish=${normalizedRelease.targetCommitish}; expected ${targetCommit}`,
    )
  }

  const body = release.body ?? ''
  const missingFragments = requiredReleaseBodyFragments.filter(
    (fragment) => !body.includes(fragment),
  )

  return {
    release: normalizedRelease,
    stateCheck: check(
      'release_state',
      stateFailures.length === 0,
      stateFailures.length === 0
        ? 'existing release is a published prerelease for the target commit'
        : stateFailures.join('; '),
    ),
    bodyCheck: check(
      'release_body',
      missingFragments.length === 0,
      missingFragments.length === 0
        ? 'release body contains required sections'
        : `missing release body fragments: ${missingFragments.join(', ')}`,
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
      overall: 'not_ready',
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
  node scripts/honowarden-release-published-packet.mjs [--strict] [--remote <remote>] [--expected-commit <sha>] [--tag-workflow-run-id <id>] [--tag-workflow-url <url>]
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

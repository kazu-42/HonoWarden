#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'

const repoRoot = fileURLToPath(new URL('..', import.meta.url).toString())
const targetTag = 'v0.1.0-alpha'
const targetVersion = '0.1.0-alpha'
const targetWorkflowName = 'Release Tag Verification'
const defaultRemote = 'origin'

function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv)
  const report = buildRecoveryPacket(options)

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

  if (options.strict && report.status !== 'ready') {
    process.stderr.write(
      `release tag recovery packet is not ready: ${failedCount(report)} failed check(s)\n`,
    )
    process.exitCode = 1
  }
}

function buildRecoveryPacket(options) {
  const recoveryCommit =
    options.recoveryCommit ?? commandText(['git', 'rev-parse', 'HEAD'])
  const workingTree = commandText(['git', 'status', '--porcelain'])
  const localTag = resolveLocalTag()
  const remoteMain = resolveRemoteMain(options.remote)
  const remoteTag = resolveRemoteTag(options.remote)
  const currentTagCommit =
    options.expectedCurrentCommit ??
    remoteTag.peeledCommit ??
    localTag.commit ??
    null
  const mainCi = resolveRunEvidence({
    runId: options.mainCiRunId,
    url: options.mainCiUrl,
    expectedCommit: recoveryCommit,
    expectedConclusion: 'success',
    expectedWorkflowName: 'CI',
    id: 'main_ci',
    missingDetail: 'main CI run evidence is missing',
    successDetail: 'main CI',
  })
  const failedTagWorkflow = resolveRunEvidence({
    runId: options.failedTagWorkflowRunId,
    url: options.failedTagWorkflowUrl,
    expectedCommit: currentTagCommit,
    expectedConclusion: 'failure',
    expectedEvent: 'push',
    expectedWorkflowName: targetWorkflowName,
    id: 'failed_tag_workflow',
    missingDetail: 'failed tag workflow run evidence is missing',
    successDetail: 'failed tag workflow',
  })
  const releaseState = resolveReleaseState()
  const checks = [
    check(
      'working_tree_clean',
      workingTree.length === 0,
      workingTree.length === 0 ? 'working tree clean' : 'working tree dirty',
    ),
    check(
      'recovery_commit_head',
      recoveryCommit === commandText(['git', 'rev-parse', 'HEAD']),
      `recoveryCommit=${recoveryCommit}`,
    ),
    check(
      'remote_main_context',
      remoteMain === recoveryCommit,
      remoteMain === recoveryCommit
        ? `remote main points at ${recoveryCommit}`
        : `remote main points at ${remoteMain ?? '<missing>'}; expected ${recoveryCommit}`,
    ),
    checkLocalTag(localTag, currentTagCommit, recoveryCommit),
    checkRemoteTag(
      remoteTag,
      currentTagCommit,
      recoveryCommit,
      options.expectedRemoteTagObject,
    ),
    mainCi.check,
    failedTagWorkflow.check,
    releaseState.check,
  ]
  const ready = checks.every((item) => item.status === 'pass')
  const moveLocalTagCommand = `git tag -f -a ${targetTag} ${recoveryCommit} -m "${targetTag}"`
  const pushTagWithLeaseCommand = remoteTag.objectSha
    ? `git push --force-with-lease=refs/tags/${targetTag}:${remoteTag.objectSha} ${options.remote} refs/tags/${targetTag}`
    : null

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: ready ? 'ready' : 'not_ready',
    targetTag,
    targetVersion,
    expectedCurrentCommit: options.expectedCurrentCommit,
    currentTagCommit,
    recoveryCommit,
    remote: options.remote,
    localTag,
    remoteMain,
    remoteTag,
    mainCi: {
      runId: options.mainCiRunId,
      url: options.mainCiUrl,
      verifiedRun: mainCi.run,
    },
    failedTagWorkflow: {
      runId: options.failedTagWorkflowRunId,
      url: options.failedTagWorkflowUrl,
      verifiedRun: failedTagWorkflow.run,
    },
    existingRelease: releaseState.release,
    checks,
    commands: {
      moveLocalTag: moveLocalTagCommand,
      pushTagWithLease: pushTagWithLeaseCommand,
    },
    approvalText:
      ready && currentTagCommit
        ? `${targetTag} を ${currentTagCommit} から ${recoveryCommit} に lease 付きで移動して push してよい`
        : null,
    limitations: [
      'This packet does not create, move, delete, or push a Git tag.',
      'This packet does not create, update, publish, or delete a GitHub release.',
      'The push command uses --force-with-lease and must only run after explicit operator approval.',
      'Publishing a release or deploying from a release requires a separate approval gate.',
    ],
  }
}

function resolveLocalTag() {
  const objectResult = runCommand([
    'git',
    'rev-parse',
    '-q',
    '--verify',
    `refs/tags/${targetTag}`,
  ])

  if (objectResult.status !== 0) {
    return {
      objectSha: null,
      commit: null,
    }
  }

  const commitResult = runCommand(['git', 'rev-list', '-n', '1', targetTag])

  return {
    objectSha: objectResult.stdout.trim() || null,
    commit: commitResult.status === 0 ? commitResult.stdout.trim() : null,
  }
}

function resolveRemoteMain(remote) {
  const result = runCommand(['git', 'ls-remote', remote, 'refs/heads/main'])

  if (result.status !== 0) {
    return null
  }

  return firstSha(result.stdout)
}

function resolveRemoteTag(remote) {
  const exact = runCommand(['git', 'ls-remote', '--tags', remote, targetTag])
  const peeled = runCommand([
    'git',
    'ls-remote',
    '--tags',
    remote,
    `${targetTag}^{}`,
  ])

  return {
    objectSha: exact.status === 0 ? firstSha(exact.stdout) : null,
    peeledCommit: peeled.status === 0 ? firstSha(peeled.stdout) : null,
  }
}

function checkLocalTag(localTag, currentTagCommit, recoveryCommit) {
  if (!localTag.commit) {
    return check('local_tag_context', false, 'local tag is missing')
  }

  const failures = []
  if (!currentTagCommit) {
    failures.push('current tag commit is missing')
  } else if (localTag.commit !== currentTagCommit) {
    failures.push(
      `local tag points at ${localTag.commit}; expected ${currentTagCommit}`,
    )
  }
  if (localTag.commit === recoveryCommit) {
    failures.push('local tag already points at the recovery commit')
  }

  return check(
    'local_tag_context',
    failures.length === 0,
    failures.length === 0
      ? `local tag points at ${currentTagCommit}`
      : failures.join('; '),
  )
}

function checkRemoteTag(
  remoteTag,
  currentTagCommit,
  recoveryCommit,
  expectedRemoteTagObject,
) {
  const failures = []

  if (!remoteTag.objectSha) {
    failures.push('remote tag object is missing')
  }
  if (!remoteTag.peeledCommit) {
    failures.push('remote tag peeled commit is missing')
  }
  if (
    expectedRemoteTagObject &&
    remoteTag.objectSha !== expectedRemoteTagObject
  ) {
    failures.push(
      `remote tag object is ${remoteTag.objectSha ?? '<missing>'}; expected ${expectedRemoteTagObject}`,
    )
  }
  if (!currentTagCommit) {
    failures.push('current tag commit is missing')
  } else if (remoteTag.peeledCommit !== currentTagCommit) {
    failures.push(
      `remote tag points at ${remoteTag.peeledCommit ?? '<missing>'}; expected ${currentTagCommit}`,
    )
  }
  if (remoteTag.peeledCommit === recoveryCommit) {
    failures.push('remote tag already points at the recovery commit')
  }

  return check(
    'remote_tag_context',
    failures.length === 0,
    failures.length === 0
      ? `remote tag object ${remoteTag.objectSha} peels to ${currentTagCommit}`
      : failures.join('; '),
  )
}

function resolveRunEvidence(options) {
  if (!options.runId) {
    return {
      run: null,
      check: check(options.id, false, options.missingDetail),
    }
  }

  const result = runCommand([
    'gh',
    'run',
    'view',
    options.runId,
    '--json',
    'databaseId,headSha,status,conclusion,url,workflowName,event',
  ])

  if (result.status !== 0) {
    return {
      run: null,
      check: check(
        options.id,
        false,
        firstOutputLine(result) || `failed to verify run ${options.runId}`,
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
        options.id,
        false,
        `failed to parse run ${options.runId}: ${error.message}`,
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

  if (String(normalizedRun.databaseId) !== String(options.runId)) {
    failures.push(
      `databaseId=${normalizedRun.databaseId}; expected ${options.runId}`,
    )
  }
  if (normalizedRun.workflowName !== options.expectedWorkflowName) {
    failures.push(
      `workflowName=${normalizedRun.workflowName}; expected ${options.expectedWorkflowName}`,
    )
  }
  if (options.expectedEvent && normalizedRun.event !== options.expectedEvent) {
    failures.push(
      `event=${normalizedRun.event}; expected ${options.expectedEvent}`,
    )
  }
  if (normalizedRun.headSha !== options.expectedCommit) {
    failures.push(
      `headSha=${normalizedRun.headSha}; expected ${options.expectedCommit}`,
    )
  }
  if (normalizedRun.status !== 'completed') {
    failures.push(`status=${normalizedRun.status}; expected completed`)
  }
  if (normalizedRun.conclusion !== options.expectedConclusion) {
    failures.push(
      `conclusion=${normalizedRun.conclusion}; expected ${options.expectedConclusion}`,
    )
  }
  if (options.url && normalizedRun.url !== options.url) {
    failures.push(`url=${normalizedRun.url}; expected ${options.url}`)
  }

  return {
    run: normalizedRun,
    check: check(
      options.id,
      failures.length === 0,
      failures.length === 0
        ? `${options.successDetail} run ${options.runId} matched expected evidence`
        : failures.join('; '),
    ),
  }
}

function resolveReleaseState() {
  const result = runCommand([
    'gh',
    'release',
    'view',
    targetTag,
    '--json',
    'tagName,isDraft,isPrerelease,targetCommitish,url',
  ])

  if (result.status !== 0) {
    return {
      release: null,
      check: check('release_state', true, 'release not found'),
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
        `failed to parse existing release: ${error.message}`,
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

  return {
    release: normalizedRelease,
    check: check(
      'release_state',
      false,
      `existing release found at ${normalizedRelease.url ?? '<unknown url>'}`,
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
  return report.checks.filter((item) => item.status === 'fail').length
}

function firstSha(stdout) {
  return (
    stdout
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)[0]
      ?.split(/\s+/)[0] ?? null
  )
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

function parseOptions(args) {
  const options = {
    expectedCurrentCommit: null,
    expectedRemoteTagObject: null,
    failedTagWorkflowRunId: null,
    failedTagWorkflowUrl: null,
    mainCiRunId: null,
    mainCiUrl: null,
    recoveryCommit: null,
    remote: defaultRemote,
    strict: false,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    switch (arg) {
      case '--':
        break
      case '--expected-current-commit': {
        const value = args[index + 1]
        if (!value) {
          throw new Error('--expected-current-commit requires a value')
        }
        options.expectedCurrentCommit = value
        index += 1
        break
      }
      case '--expected-remote-tag-object': {
        const value = args[index + 1]
        if (!value) {
          throw new Error('--expected-remote-tag-object requires a value')
        }
        options.expectedRemoteTagObject = value
        index += 1
        break
      }
      case '--failed-tag-workflow-run-id': {
        const value = args[index + 1]
        if (!value) {
          throw new Error('--failed-tag-workflow-run-id requires a value')
        }
        options.failedTagWorkflowRunId = value
        index += 1
        break
      }
      case '--failed-tag-workflow-url': {
        const value = args[index + 1]
        if (!value) {
          throw new Error('--failed-tag-workflow-url requires a value')
        }
        options.failedTagWorkflowUrl = value
        index += 1
        break
      }
      case '--main-ci-run-id': {
        const value = args[index + 1]
        if (!value) {
          throw new Error('--main-ci-run-id requires a value')
        }
        options.mainCiRunId = value
        index += 1
        break
      }
      case '--main-ci-url': {
        const value = args[index + 1]
        if (!value) {
          throw new Error('--main-ci-url requires a value')
        }
        options.mainCiUrl = value
        index += 1
        break
      }
      case '--recovery-commit': {
        const value = args[index + 1]
        if (!value) {
          throw new Error('--recovery-commit requires a value')
        }
        options.recoveryCommit = value
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
  node scripts/honowarden-release-tag-recovery-packet.mjs [--strict] [--remote <remote>] [--expected-current-commit <sha>] [--recovery-commit <sha>] [--expected-remote-tag-object <sha>] [--main-ci-run-id <id>] [--main-ci-url <url>] [--failed-tag-workflow-run-id <id>] [--failed-tag-workflow-url <url>]
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

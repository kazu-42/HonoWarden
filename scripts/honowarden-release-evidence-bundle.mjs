#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'

const repoRoot = fileURLToPath(new URL('..', import.meta.url).toString())
const targetTag = 'v0.1.0-alpha'
const targetVersion = '0.1.0-alpha'
const defaultRemote = 'origin'

function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv)
  const report = buildEvidenceBundle(options)
  const serialized = `${JSON.stringify(report, null, 2)}\n`

  process.stdout.write(serialized)

  if (options.outputPath) {
    writeOutput(options, serialized)
  }

  if (options.strict && report.status !== 'ready') {
    process.stderr.write(
      `release evidence bundle is not ready: ${failedCount(report)} failed check(s)\n`,
    )
    process.exitCode = 1
  }
}

function buildEvidenceBundle(options) {
  const targetCommit = commandText(['git', 'rev-parse', 'HEAD'])
  const headSummary = commandText(['git', 'log', '-1', '--oneline'])
  const workingTree = commandText(['git', 'status', '--porcelain'])
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
  const approvalPacket = runJson([
    process.execPath,
    repoPath('scripts/honowarden-release-approval-packet.mjs'),
    '--remote',
    options.remote,
    ...(options.allowDirty ? ['--allow-dirty'] : []),
    ...(options.allowMissingCi ? ['--allow-missing-ci'] : []),
    ...(options.ciRunId ? ['--ci-run-id', options.ciRunId] : []),
    ...(options.ciUrl ? ['--ci-url', options.ciUrl] : []),
  ])
  const postTagPreview = runJson([
    process.execPath,
    repoPath('scripts/honowarden-post-tag-release-packet.mjs'),
    '--remote',
    options.remote,
    '--allow-missing-tag',
    '--allow-missing-remote-tag',
    '--allow-missing-tag-workflow',
  ])
  const brandScan = runBrandScan()
  const checks = [
    check(
      'working_tree_clean',
      workingTree.length === 0 || options.allowDirty,
      workingTree.length === 0
        ? 'working tree clean'
        : options.allowDirty
          ? 'working tree dirty but allowed by --allow-dirty'
          : 'working tree dirty',
    ),
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
      'approval_packet_ready',
      approvalPacket.status === 'ready',
      `approval packet status is ${approvalPacket.status}`,
    ),
    check(
      'post_tag_preview_ready',
      postTagPreview.status === 'ready' &&
        postTagPreview.draftApprovalText === null,
      `post-tag preview status is ${postTagPreview.status}; draftApprovalText=${postTagPreview.draftApprovalText}`,
    ),
    check('brand_scan_clean', brandScan.status === 'pass', brandScan.detail),
    check(
      'commit_alignment',
      tagPreflight.sourceCommit === targetCommit &&
        approvalPacket.targetCommit === targetCommit &&
        postTagPreview.targetCommit === targetCommit,
      `head=${targetCommit}; tagPreflight=${tagPreflight.sourceCommit}; approvalPacket=${approvalPacket.targetCommit}; postTagPreview=${postTagPreview.targetCommit}`,
    ),
  ]
  const ready = checks.every((item) => item.status === 'pass')

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: ready ? 'ready' : 'not_ready',
    phase: 'pre_tag',
    targetTag,
    targetVersion,
    targetCommit,
    headSummary,
    remote: options.remote,
    ci: {
      runId: options.ciRunId,
      url: options.ciUrl,
      missingAllowed: options.allowMissingCi,
    },
    checks,
    evidence: {
      releaseGate,
      tagPreflight,
      approvalPacket,
      postTagPreview,
      brandScan,
    },
    commands: {
      createTag: approvalPacket.commands?.createTag ?? null,
      pushTag: approvalPacket.commands?.pushTag ?? null,
      createDraftAfterTagVerification:
        approvalPacket.commands?.createDraft ?? null,
      viewRelease: approvalPacket.commands?.viewRelease ?? null,
    },
    approvalText:
      ready && !options.allowMissingCi ? approvalPacket.approvalText : null,
    limitations: [
      'This bundle does not create, move, delete, or push a Git tag.',
      'This bundle does not create, update, publish, or delete a GitHub release.',
      'This bundle does not deploy.',
      'Use the approval text only after strict evidence is ready for the exact commit.',
      'Run the release draft command only after tag verification CI passes and a separate operator approval is recorded.',
    ],
  }
}

function runBrandScan() {
  const pattern = [
    '[Bb]it',
    'warden|BIT',
    'WARDEN|Bit',
    'warden|bit',
    'warden',
  ].join('')
  const result = runCommand([
    'rg',
    '-n',
    pattern,
    '--glob',
    '!node_modules/**',
    '--glob',
    '!pnpm-lock.yaml',
    '--glob',
    '!LICENSE',
    '--glob',
    '!dist/**',
    '--glob',
    '!coverage/**',
    '--glob',
    '!test/.tmp/**',
    '.',
  ])

  if (result.status === 1 && result.stdout.trim().length === 0) {
    return {
      status: 'pass',
      detail: 'repository brand scan returned no content or path hits',
      matches: [],
    }
  }

  if (result.status === 0) {
    return {
      status: 'fail',
      detail: 'repository brand scan found blocked content or path hits',
      matches: result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    }
  }

  return {
    status: 'fail',
    detail: firstOutputLine(result) || 'repository brand scan failed',
    matches: [],
  }
}

function writeOutput(options, serialized) {
  const outputPath = isAbsolute(options.outputPath)
    ? options.outputPath
    : resolve(repoRoot, options.outputPath)
  const exists = runCommand(['test', '-e', outputPath]).status === 0

  if (exists && !options.overwrite) {
    throw new Error(
      `${outputPath} already exists; pass --overwrite to replace it`,
    )
  }

  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, serialized)
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
    outputPath: null,
    overwrite: false,
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
      case '--output': {
        const value = args[index + 1]
        if (!value) {
          throw new Error('--output requires a value')
        }
        options.outputPath = value
        index += 1
        break
      }
      case '--overwrite':
        options.overwrite = true
        break
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
  node scripts/honowarden-release-evidence-bundle.mjs [--strict] [--remote <remote>] [--allow-dirty] [--ci-run-id <id>] [--ci-url <url>] [--allow-missing-ci] [--output <path>] [--overwrite]
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

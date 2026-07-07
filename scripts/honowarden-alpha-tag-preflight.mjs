#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'

const repoRoot = fileURLToPath(new URL('..', import.meta.url).toString())
const targetTag = 'v0.1.0-alpha'
const defaultExpectedVersion = '0.1.0-alpha'

function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv)
  const report = buildPreflightReport(options)

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

  if (options.strict && report.status !== 'ready') {
    process.stderr.write(
      `alpha tag preflight is not ready: ${failedCount(report)} failed check(s)\n`,
    )
    process.exitCode = 1
  }
}

function buildPreflightReport(options) {
  const targetVersion = options.expectedVersion ?? defaultExpectedVersion
  const sourceCommit = commandText(['git', 'rev-parse', 'HEAD'])
  const checks = [
    checkPackageVersion(targetVersion),
    checkReleaseGate(),
    checkWorkingTree(options),
    checkLocalTag(options),
  ]
  const ready = checks.every((check) => check.status === 'pass')

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: ready ? 'ready' : 'not_ready',
    targetTag,
    targetVersion,
    sourceCommit,
    checks,
    commands: {
      createTag: `git tag -a ${targetTag} ${sourceCommit} -m "${targetTag}"`,
      pushTag: `git push origin ${targetTag}`,
    },
    limitations: [
      'This preflight does not create or push a Git tag.',
      'Remote tag absence and GitHub release publication are not verified.',
      'GitHub Actions CI must pass on the exact release commit before pushing the tag.',
    ],
  }
}

function checkPackageVersion(expectedVersion) {
  const packageJson = readJson('package.json')
  const actualVersion = packageJson.version

  return check(
    'package_version',
    actualVersion === expectedVersion,
    actualVersion === expectedVersion
      ? `package.json version is ${actualVersion}`
      : `package.json version is ${actualVersion ?? '<missing>'}; expected ${expectedVersion}`,
  )
}

function checkReleaseGate() {
  const result = runCommand([
    process.execPath,
    repoPath('scripts/honowarden-release-gate.mjs'),
    '--strict',
  ])

  return check(
    'release_gate',
    result.status === 0,
    result.status === 0
      ? 'release gate strict passed'
      : firstOutputLine(result) || 'release gate strict failed',
  )
}

function checkWorkingTree(options) {
  const status = commandText(['git', 'status', '--porcelain'])
  const isClean = status.length === 0

  return check(
    'working_tree',
    isClean || options.allowDirty,
    isClean
      ? 'working tree clean'
      : options.allowDirty
        ? 'working tree dirty but allowed by --allow-dirty'
        : 'working tree dirty',
  )
}

function checkLocalTag(options) {
  const result = runCommand([
    'git',
    'rev-parse',
    '-q',
    '--verify',
    `refs/tags/${targetTag}`,
  ])
  const tagAbsent = result.status !== 0

  return check(
    'local_tag_absent',
    tagAbsent || options.allowExistingTag,
    tagAbsent
      ? 'local tag does not exist'
      : options.allowExistingTag
        ? 'local tag exists but allowed by --allow-existing-tag'
        : 'local tag already exists',
  )
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

function readJson(path) {
  return JSON.parse(readFileSync(repoPath(path), 'utf8'))
}

function repoPath(...parts) {
  return join(repoRoot, ...parts)
}

function parseOptions(args) {
  const options = {
    allowDirty: false,
    allowExistingTag: false,
    strict: false,
    expectedVersion: defaultExpectedVersion,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    switch (arg) {
      case '--':
        break
      case '--allow-dirty':
        options.allowDirty = true
        break
      case '--allow-existing-tag':
        options.allowExistingTag = true
        break
      case '--strict':
        options.strict = true
        break
      case '--expected-version': {
        const value = args[index + 1]
        if (!value) {
          throw new Error('--expected-version requires a value')
        }
        options.expectedVersion = value
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
  node scripts/honowarden-alpha-tag-preflight.mjs [--strict] [--allow-dirty] [--allow-existing-tag] [--expected-version <version>]
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

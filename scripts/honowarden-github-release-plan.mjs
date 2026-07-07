#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'

const repoRoot = fileURLToPath(new URL('..', import.meta.url).toString())
const targetTag = 'v0.1.0-alpha'
const defaultExpectedVersion = '0.1.0-alpha'
const defaultNotesFile = 'docs/release/v0.1.0-alpha-release-notes.md'
const defaultRemote = 'origin'

function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv)
  const report = buildReleasePlan(options)

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

  if (options.strict && report.status !== 'ready') {
    process.stderr.write(
      `github release plan is not ready: ${failedCount(report)} failed check(s)\n`,
    )
    process.exitCode = 1
  }
}

function buildReleasePlan(options) {
  const targetVersion = options.expectedVersion ?? defaultExpectedVersion
  const targetCommit =
    options.expectedCommit ?? commandText(['git', 'rev-parse', 'HEAD'])
  const notesFile = options.notesFile ?? defaultNotesFile
  const checks = [
    checkPackageVersion(targetVersion),
    checkReleaseNotes(notesFile),
    checkLocalTagContext(options, targetCommit),
    ...(options.checkRemote ? [checkRemoteTagContext(options)] : []),
  ]
  const ready = checks.every((check) => check.status === 'pass')

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: ready ? 'ready' : 'not_ready',
    targetTag,
    targetVersion,
    targetCommit,
    notesFile,
    checks,
    commands: {
      createDraft: commandString([
        'gh',
        'release',
        'create',
        targetTag,
        '--title',
        targetTag,
        '--notes-file',
        notesFile,
        '--target',
        targetCommit,
        '--draft',
        '--prerelease',
        '--verify-tag',
      ]),
      viewRelease: commandString(['gh', 'release', 'view', targetTag]),
    },
    limitations: buildLimitations(options),
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

function checkReleaseNotes(notesFile) {
  const fullPath = repoPath(notesFile)

  if (!existsSync(fullPath)) {
    return check('release_notes', false, `${notesFile} is missing`)
  }

  const notes = readFileSync(fullPath, 'utf8')
  const requiredFragments = [
    '# v0.1.0-alpha Release Notes',
    'HonoWarden is pre-alpha',
    '## Scope',
    '## Not Included',
    '## Compatibility',
    '## Operations',
    '## Known Risks',
    '## Release Gate',
  ]
  const missing = requiredFragments.filter(
    (fragment) => !notes.includes(fragment),
  )

  return check(
    'release_notes',
    missing.length === 0,
    missing.length === 0
      ? `${notesFile} contains required release sections`
      : `missing release note fragments: ${missing.join(', ')}`,
  )
}

function checkLocalTagContext(options, targetCommit) {
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

function checkRemoteTagContext(options) {
  const remote = options.remote ?? defaultRemote
  const result = runCommand(['git', 'ls-remote', '--tags', remote, targetTag])

  if (result.status !== 0) {
    return check(
      'remote_tag_context',
      false,
      firstOutputLine(result) || `remote tag check failed for ${remote}`,
    )
  }

  const remoteHasTag = result.stdout.trim().length > 0

  return check(
    'remote_tag_context',
    remoteHasTag || options.allowMissingRemoteTag,
    remoteHasTag
      ? `remote tag exists on ${remote}`
      : options.allowMissingRemoteTag
        ? `remote tag is missing on ${remote} but allowed by --allow-missing-remote-tag`
        : `remote tag is missing on ${remote}`,
  )
}

function buildLimitations(options) {
  return [
    'This plan does not create, update, publish, or delete a GitHub release.',
    'Run the createDraft command only after tag push and release tag verification CI have passed.',
    options.checkRemote
      ? 'Remote tag context was checked read-only.'
      : 'Remote tag context was not checked.',
  ]
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

function commandString(args) {
  return args.map(shellQuote).join(' ')
}

function shellQuote(value) {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`
}

function parseOptions(args) {
  const options = {
    allowMissingRemoteTag: false,
    allowMissingTag: false,
    checkRemote: false,
    expectedCommit: null,
    expectedVersion: defaultExpectedVersion,
    notesFile: defaultNotesFile,
    remote: defaultRemote,
    strict: false,
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
      case '--check-remote':
        options.checkRemote = true
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
      case '--expected-version': {
        const value = args[index + 1]
        if (!value) {
          throw new Error('--expected-version requires a value')
        }
        options.expectedVersion = value
        index += 1
        break
      }
      case '--notes-file': {
        const value = args[index + 1]
        if (!value) {
          throw new Error('--notes-file requires a value')
        }
        options.notesFile = value
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
  node scripts/honowarden-github-release-plan.mjs [--strict] [--allow-missing-tag] [--check-remote] [--allow-missing-remote-tag] [--remote <remote>] [--expected-commit <sha>] [--expected-version <version>] [--notes-file <path>]
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

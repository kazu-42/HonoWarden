#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

const manifestFileName = 'backup-manifest.json'
const d1ExportFileName = 'd1.sql'
const r2DirectoryName = 'r2'
const manifestSchemaVersion = 1

async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv

  if (command === 'export') {
    const options = parseOptions(rest)
    await runExport(options)
    return
  }

  if (command === 'restore') {
    const options = parseOptions(rest)
    await runRestore(options)
    return
  }

  printUsage()
  process.exitCode = 1
}

async function runExport(options) {
  const outDir = resolveRequiredPath(options.out, '--out')
  const database = requireValue(options.database, '--database')
  const bucket = requireValue(options.bucket, '--bucket')
  const mode = parseMode(options.mode)
  rejectRemotePersistence(mode, options)
  const execute = Boolean(options.execute)
  const objectKeys = options.r2Objects
    ? await readObjectList(options.r2Objects)
    : []
  const d1File = join(outDir, d1ExportFileName)
  const r2Dir = join(outDir, r2DirectoryName)
  const objects = objectKeys.map((key) => ({
    key,
    file: `${r2DirectoryName}/${objectFileName(key)}`,
  }))
  const commands = [
    buildD1ExportCommand({ database, d1File, mode, options }),
    ...objects.map((object) =>
      buildR2GetCommand({
        bucket,
        key: object.key,
        file: join(outDir, object.file),
        mode,
        options,
      }),
    ),
  ]
  const manifest = {
    schemaVersion: manifestSchemaVersion,
    createdAt: new Date().toISOString(),
    mode,
    database,
    bucket,
    d1: {
      file: d1ExportFileName,
    },
    r2: {
      objectListRequired: true,
      objects,
    },
    restore: {
      command: 'node scripts/honowarden-backup.mjs restore',
    },
    commands,
  }

  await mkdir(r2Dir, { recursive: true })
  await writeManifest(outDir, manifest)

  if (execute) {
    await runCommands(commands)
    await addManifestHashes(outDir, manifest)
    await writeManifest(outDir, manifest)
  }

  writeJson({
    action: 'export',
    executed: execute,
    manifest: join(outDir, manifestFileName),
    commands,
  })
}

async function runRestore(options) {
  const fromDir = resolveRequiredPath(options.from, '--from')
  const manifest = await readManifest(fromDir)
  const database = options.database ?? manifest.database
  const bucket = options.bucket ?? manifest.bucket
  const mode = parseMode(options.mode ?? manifest.mode)
  rejectRemotePersistence(mode, options)
  const execute = Boolean(options.execute)
  const d1File = join(fromDir, manifest.d1.file)
  const commands = [
    buildD1ImportCommand({ database, d1File, mode, options }),
    ...manifest.r2.objects.map((object) =>
      buildR2PutCommand({
        bucket,
        key: object.key,
        file: join(fromDir, object.file),
        mode,
        options,
      }),
    ),
  ]

  if (execute) {
    requireFreshTargetConfirmation(options)
    await verifyBackupFiles(fromDir, manifest)
    await runCommands(commands)
  }

  writeJson({
    action: 'restore',
    executed: execute,
    manifest: join(fromDir, manifestFileName),
    commands,
  })
}

function buildD1ExportCommand({ database, d1File, mode, options }) {
  return [
    'wrangler',
    'd1',
    'export',
    database,
    modeFlag(mode),
    '--output',
    d1File,
    '--skip-confirmation',
    ...wranglerEnvFlags(options),
  ]
}

function buildD1ImportCommand({ database, d1File, mode, options }) {
  return [
    'wrangler',
    'd1',
    'execute',
    database,
    modeFlag(mode),
    '--file',
    d1File,
    '--yes',
    ...wranglerEnvFlags(options),
    ...localPersistenceFlags(options),
  ]
}

function buildR2GetCommand({ bucket, key, file, mode, options }) {
  return [
    'wrangler',
    'r2',
    'object',
    'get',
    `${bucket}/${key}`,
    modeFlag(mode),
    '--file',
    file,
    ...wranglerEnvFlags(options),
    ...localPersistenceFlags(options),
  ]
}

function buildR2PutCommand({ bucket, key, file, mode, options }) {
  return [
    'wrangler',
    'r2',
    'object',
    'put',
    `${bucket}/${key}`,
    modeFlag(mode),
    '--file',
    file,
    ...wranglerEnvFlags(options),
    ...localPersistenceFlags(options),
  ]
}

function wranglerEnvFlags(options) {
  const flags = []

  if (options.env) {
    flags.push('--env', options.env)
  }

  return flags
}

function localPersistenceFlags(options) {
  const flags = []

  if (options.persistTo) {
    flags.push('--persist-to', options.persistTo)
  }

  return flags
}

async function runCommands(commands) {
  for (const command of commands) {
    await runCommand(command)
  }
}

function runCommand(command) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command[0], command.slice(1), {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })

    child.on('exit', (code) => {
      if (code === 0) {
        resolveCommand()
        return
      }

      rejectCommand(
        new Error(
          `Command failed with exit code ${code}: ${command.join(' ')}`,
        ),
      )
    })

    child.on('error', rejectCommand)
  })
}

async function readObjectList(path) {
  const contents = await readFile(path, 'utf8')
  const keys = contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))

  for (const key of keys) {
    validateObjectKey(key)
  }

  return [...new Set(keys)]
}

async function writeManifest(outDir, manifest) {
  const manifestPath = join(outDir, manifestFileName)
  await mkdir(dirname(manifestPath), { recursive: true })
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

async function readManifest(fromDir) {
  const manifestPath = join(fromDir, manifestFileName)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

  if (
    manifest?.schemaVersion !== manifestSchemaVersion ||
    typeof manifest.database !== 'string' ||
    typeof manifest.bucket !== 'string' ||
    typeof manifest.d1?.file !== 'string' ||
    !Array.isArray(manifest.r2?.objects) ||
    manifest.r2.objectListRequired !== true
  ) {
    throw new Error(`Invalid backup manifest: ${manifestPath}`)
  }

  assertSafeManifestPath(manifest.d1.file, 'd1.file')

  for (const [index, object] of manifest.r2.objects.entries()) {
    if (typeof object?.key !== 'string' || typeof object?.file !== 'string') {
      throw new Error(`Invalid backup manifest: ${manifestPath}`)
    }

    validateObjectKey(object.key)
    assertSafeManifestPath(
      object.file,
      `r2.objects[${index}].file`,
      `${r2DirectoryName}/`,
    )
  }

  return manifest
}

function objectFileName(key) {
  return Buffer.from(key, 'utf8').toString('base64url')
}

function parseOptions(args) {
  const options = {}

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    switch (arg) {
      case '--execute':
        options.execute = true
        break
      case '--confirm-fresh-target':
        options.confirmFreshTarget = true
        break
      case '--out':
      case '--from':
      case '--database':
      case '--bucket':
      case '--mode':
      case '--r2-objects':
      case '--env':
      case '--persist-to': {
        const value = args[index + 1]
        if (!value) {
          throw new Error(`${arg} requires a value`)
        }
        options[toCamelCase(arg.slice(2))] = value
        index += 1
        break
      }
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }

  return options
}

function parseMode(value = 'local') {
  if (value === 'local' || value === 'remote') {
    return value
  }

  throw new Error('--mode must be local or remote')
}

function rejectRemotePersistence(mode, options) {
  if (mode === 'remote' && options.persistTo) {
    throw new Error('--persist-to can only be used with --mode local')
  }
}

function requireFreshTargetConfirmation(options) {
  if (!options.confirmFreshTarget) {
    throw new Error(
      '--confirm-fresh-target is required before restore --execute',
    )
  }
}

function modeFlag(mode) {
  return mode === 'remote' ? '--remote' : '--local'
}

function resolveRequiredPath(value, flagName) {
  return resolve(requireValue(value, flagName))
}

function requireValue(value, flagName) {
  if (!value) {
    throw new Error(`${flagName} is required`)
  }

  return value
}

function validateObjectKey(key) {
  if (!key || key.startsWith('/') || key.includes('\0')) {
    throw new Error(`Invalid R2 object key: ${key}`)
  }
}

function assertSafeManifestPath(value, fieldName, requiredPrefix) {
  if (
    !value ||
    typeof value !== 'string' ||
    value.includes('\\') ||
    value.startsWith('/') ||
    value.split('/').some((segment) => segment === '..' || segment === '')
  ) {
    throw new Error(`Invalid backup manifest path: ${fieldName}`)
  }

  if (requiredPrefix && !value.startsWith(requiredPrefix)) {
    throw new Error(`Invalid backup manifest path: ${fieldName}`)
  }
}

async function addManifestHashes(outDir, manifest) {
  manifest.d1.sha256 = await sha256File(join(outDir, manifest.d1.file))

  for (const object of manifest.r2.objects) {
    object.sha256 = await sha256File(join(outDir, object.file))
  }
}

async function verifyBackupFiles(fromDir, manifest) {
  await verifyManifestFileHash({
    path: join(fromDir, manifest.d1.file),
    expected: manifest.d1.sha256,
    fieldName: 'd1.sha256',
  })

  for (const [index, object] of manifest.r2.objects.entries()) {
    await verifyManifestFileHash({
      path: join(fromDir, object.file),
      expected: object.sha256,
      fieldName: `r2.objects[${index}].sha256`,
    })
  }
}

async function verifyManifestFileHash({ path, expected, fieldName }) {
  if (!isSha256(expected)) {
    throw new Error(`Backup manifest missing checksum: ${fieldName}`)
  }

  const actual = await sha256File(path)

  if (actual !== expected) {
    throw new Error(`Backup file checksum mismatch: ${path}`)
  }
}

async function sha256File(path) {
  const contents = await readFile(path)
  return createHash('sha256').update(contents).digest('hex')
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase())
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function printUsage() {
  process.stderr.write(`Usage:
  node scripts/honowarden-backup.mjs export --out <dir> --database <name> --bucket <name> [--r2-objects <file>] [--mode local|remote] [--execute]
  node scripts/honowarden-backup.mjs restore --from <dir> [--database <name>] [--bucket <name>] [--mode local|remote] [--execute --confirm-fresh-target]
`)
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)

if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}

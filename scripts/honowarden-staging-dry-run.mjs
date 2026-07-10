#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'

import { parse } from 'jsonc-parser'

const repoRoot = fileURLToPath(new URL('..', import.meta.url).toString())
const defaultOutDir = 'test/.tmp/staging-dry-run'
const expectedStaging = {
  workerName: 'honowarden-staging',
  environment: 'staging',
  d1: {
    binding: 'DB',
    databaseName: 'honowarden-staging',
  },
  r2: {
    binding: 'VAULT_OBJECTS',
    bucketName: 'honowarden-staging-vault-objects',
  },
  vars: {
    HONOWARDEN_AUDIT_LOGS: 'false',
    HONOWARDEN_AUTH_REQUESTS_ENABLED: 'true',
    HONOWARDEN_BOOTSTRAP_ENABLED: 'false',
    HONOWARDEN_ENV: 'staging',
  },
}
const placeholderDatabaseId = '00000000-0000-0000-0000-000000000000'

async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv)
  const report = await runStagingDryRun(options)

  if (options.json) {
    const jsonPath = resolve(repoRoot, options.json)
    await mkdir(dirname(jsonPath), { recursive: true })
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

async function runStagingDryRun(options) {
  const outDir = resolve(repoRoot, options.out ?? defaultOutDir)
  await prepareOutDir(outDir)

  const wranglerVersion = await commandText(['pnpm', 'wrangler', '--version'])
  const sourceCommit = await commandText(['git', 'rev-parse', 'HEAD'])
  const gitStatus = await commandText(['git', 'status', '--short'])
  const workingTreeClean = gitStatus.trim().length === 0

  if (options.requireClean && !workingTreeClean) {
    throw new Error(
      '--require-clean needs a clean working tree before recording evidence',
    )
  }

  const config = await readWranglerConfig()
  const configChecks = validateStagingConfig(config)
  const command = [
    'pnpm',
    'wrangler',
    'deploy',
    '--env',
    'staging',
    '--dry-run',
    '--outdir',
    relativeRepoPath(outDir),
  ]
  const dryRun = await runCommand(command)
  const outputChecks = validateDryRunOutput(dryRun.stdout)
  const bundle = await inspectBundle(outDir)
  const checks = [
    ...configChecks,
    ...outputChecks,
    {
      id: 'bundle_entry_generated',
      status: bundle.bytes > 0 ? 'pass' : 'fail',
      detail: `${bundle.path} ${bundle.bytes} bytes`,
    },
  ]
  const status = checks.every((check) => check.status === 'pass')
    ? 'passed'
    : 'failed'

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status,
    mode: 'staging deploy dry-run',
    sourceCommit,
    workingTreeClean,
    wranglerVersion,
    command: command.join(' '),
    outDir: relativeRepoPath(outDir),
    worker: {
      name: config.env.staging.name,
      environment: config.env.staging.vars.HONOWARDEN_ENV,
      databaseIdPlaceholder:
        config.env.staging.d1_databases[0]?.database_id ===
        placeholderDatabaseId,
    },
    bindings: {
      d1: {
        binding: config.env.staging.d1_databases[0]?.binding,
        databaseName: config.env.staging.d1_databases[0]?.database_name,
      },
      r2: {
        binding: config.env.staging.r2_buckets[0]?.binding,
        bucketName: config.env.staging.r2_buckets[0]?.bucket_name,
      },
    },
    bundle,
    checks,
    limitations: [
      'Remote Cloudflare deploy was not performed.',
      reportResourceIdLimitation(config.env.staging.d1_databases[0]),
      'HTTP health routes were not exercised against a deployed Worker.',
    ],
  }
}

function reportResourceIdLimitation(stagingD1) {
  return stagingD1?.database_id === placeholderDatabaseId
    ? 'Staging database_id remains a placeholder until resource evidence is recorded.'
    : 'Staging database_id is configured; resource creation evidence is recorded separately.'
}

async function prepareOutDir(outDir) {
  if (!existsSync(outDir)) {
    await mkdir(outDir, { recursive: true })
    return
  }

  const entries = await readdir(outDir)
  if (entries.length > 0) {
    throw new Error(
      `Output directory is not empty: ${relativeRepoPath(outDir)}`,
    )
  }
}

async function readWranglerConfig() {
  return parse(await readFile(join(repoRoot, 'wrangler.jsonc'), 'utf8'))
}

function validateStagingConfig(config) {
  const staging = config?.env?.staging
  const production = config?.env?.production
  const d1 = staging?.d1_databases?.[0]
  const r2 = staging?.r2_buckets?.[0]

  return [
    check(
      'staging_worker_name',
      staging?.name === expectedStaging.workerName,
      staging?.name,
    ),
    check(
      'staging_environment_var',
      staging?.vars?.HONOWARDEN_ENV === expectedStaging.environment,
      staging?.vars?.HONOWARDEN_ENV,
    ),
    check(
      'staging_bootstrap_fail_closed',
      staging?.vars?.HONOWARDEN_BOOTSTRAP_ENABLED ===
        expectedStaging.vars.HONOWARDEN_BOOTSTRAP_ENABLED,
      staging?.vars?.HONOWARDEN_BOOTSTRAP_ENABLED,
    ),
    check(
      'staging_audit_logs_fail_closed',
      staging?.vars?.HONOWARDEN_AUDIT_LOGS ===
        expectedStaging.vars.HONOWARDEN_AUDIT_LOGS,
      staging?.vars?.HONOWARDEN_AUDIT_LOGS,
    ),
    check(
      'staging_auth_requests_enabled',
      staging?.vars?.HONOWARDEN_AUTH_REQUESTS_ENABLED ===
        expectedStaging.vars.HONOWARDEN_AUTH_REQUESTS_ENABLED,
      staging?.vars?.HONOWARDEN_AUTH_REQUESTS_ENABLED,
    ),
    check(
      'production_auth_requests_fail_closed',
      production?.vars?.HONOWARDEN_AUTH_REQUESTS_ENABLED === 'false',
      production?.vars?.HONOWARDEN_AUTH_REQUESTS_ENABLED,
    ),
    check(
      'staging_d1_binding',
      d1?.binding === expectedStaging.d1.binding &&
        d1?.database_name === expectedStaging.d1.databaseName,
      `${d1?.binding ?? '<missing>'} -> ${d1?.database_name ?? '<missing>'}`,
    ),
    check(
      'staging_r2_binding',
      r2?.binding === expectedStaging.r2.binding &&
        r2?.bucket_name === expectedStaging.r2.bucketName,
      `${r2?.binding ?? '<missing>'} -> ${r2?.bucket_name ?? '<missing>'}`,
    ),
    check(
      'staging_production_worker_separation',
      staging?.name && production?.name && staging.name !== production.name,
      `${staging?.name ?? '<missing>'} != ${production?.name ?? '<missing>'}`,
    ),
    check(
      'staging_production_storage_separation',
      d1?.database_name &&
        production?.d1_databases?.[0]?.database_name &&
        d1.database_name !== production.d1_databases[0].database_name &&
        r2?.bucket_name &&
        production?.r2_buckets?.[0]?.bucket_name &&
        r2.bucket_name !== production.r2_buckets[0].bucket_name,
      'staging and production storage names differ',
    ),
  ]
}

function validateDryRunOutput(stdout) {
  const requiredFragments = [
    '--dry-run: exiting now.',
    'env.DB (honowarden-staging)',
    'env.VAULT_OBJECTS (honowarden-staging-vault-objects)',
    'env.HONOWARDEN_ENV ("staging")',
  ]

  return requiredFragments.map((fragment) =>
    check(
      `dry_run_output_${slug(fragment)}`,
      stdout.includes(fragment),
      fragment,
    ),
  )
}

async function inspectBundle(outDir) {
  const bundlePath = join(outDir, 'index.js')
  const bundleStat = await stat(bundlePath)
  const contents = await readFile(bundlePath)

  return {
    path: relativeRepoPath(bundlePath),
    bytes: bundleStat.size,
    sha256: createHash('sha256').update(contents).digest('hex'),
  }
}

function check(id, condition, detail) {
  return {
    id,
    status: condition ? 'pass' : 'fail',
    detail: String(detail ?? ''),
  }
}

async function commandText(command) {
  const result = await runCommand(command)
  return result.stdout.trim()
}

function runCommand(command) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: repoRoot,
      env: process.env,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', rejectCommand)
    child.on('exit', (code) => {
      if (code === 0) {
        resolveCommand({ stdout, stderr })
        return
      }

      rejectCommand(
        new Error(
          `Command failed with exit code ${code}: ${command.join(' ')}\n${stderr}`,
        ),
      )
    })
  })
}

function parseOptions(args) {
  const options = {}

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    switch (arg) {
      case '--out':
      case '--json': {
        const value = args[index + 1]
        if (!value) {
          throw new Error(`${arg} requires a value`)
        }
        options[arg.slice(2)] = value
        index += 1
        break
      }
      case '--require-clean':
        options.requireClean = true
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

function relativeRepoPath(path) {
  const repoRelative = relative(repoRoot, path)
  return repoRelative && !repoRelative.startsWith('..') ? repoRelative : path
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function printUsage() {
  process.stderr.write(`Usage:
  node scripts/honowarden-staging-dry-run.mjs [--out <dir>] [--json <file>] [--require-clean]
`)
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)

if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}

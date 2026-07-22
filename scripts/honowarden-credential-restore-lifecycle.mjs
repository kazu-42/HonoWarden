#!/usr/bin/env node

import { createHash } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parse as parseJsonc } from 'jsonc-parser'

import {
  executeCredentialLifecycleForRecovery,
  verifyCredentialForwardRecovery,
  verifyRestoredCredentialGeneration,
} from './honowarden-credential-lifecycle.mjs'
import { assertCredentialLifecycleCompletionAttestation } from './honowarden-credential-lifecycle-state.mjs'
import {
  createIdempotentCleanup,
  installSignalCleanup,
  runBoundedCommand,
  runCleanupSteps,
  stopTrackedProcesses,
} from './honowarden-signal-cleanup.mjs'

const schemaVersion = 1
const confirmation = 'credential-restore-lifecycle'
const repoRoot = fileURLToPath(new globalThis.URL('..', import.meta.url))
const fixtureRoot = join(repoRoot, 'test/.tmp')
const backupScript = join(repoRoot, 'scripts/honowarden-backup.mjs')
const rootWranglerConfig = join(repoRoot, 'wrangler.jsonc')
const defaultHarnessRoot = 'test/.tmp/hon-207-official-client'
const runOwnershipMarker = '.honowarden-credential-restore-owned'
const runOwnershipMarkerBody =
  '{"owner":"honowarden-credential-restore-lifecycle"}\n'
const databaseName = 'honowarden'
const bucketName = 'honowarden-vault-objects'
const r2ObjectKey = 'attachments/hon220-immutable-ciphertext'
const allowedEnvironmentKeys = Object.freeze([
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOGNAME',
  'PATH',
  'SHELL',
  'SSL_CERT_FILE',
  'TEMP',
  'TMP',
  'TMPDIR',
  'TZ',
  'USER',
])

async function main(argv = process.argv.slice(2)) {
  const normalized = argv[0] === '--' ? argv.slice(1) : argv
  const [action, ...rest] = normalized
  if (action !== 'plan' && action !== 'run') {
    throw new Error('action must be plan or run')
  }
  const options = parseOptions(rest)
  if (action === 'run' && !options.execute) {
    throw new Error('run requires --execute')
  }
  if (options.execute && action !== 'run') {
    throw new Error('--execute is only allowed for run')
  }
  if (options.execute && options.confirm !== confirmation) {
    throw new Error(`--confirm ${confirmation} is required before --execute`)
  }
  if (action === 'run' && !options.runRoot) {
    throw new Error('run requires an explicit --run-root')
  }

  const generatedAt = parseTimestamp(options.at)
  const runRoot = resolveRunRoot(
    options.runRoot ?? 'test/.tmp/hon-225-fresh-restore',
  )
  const packet = buildPacket({ action, generatedAt, options, runRoot })
  if (options.execute) {
    packet.readback = await executeRestoreLifecycle({
      generatedAt,
      options,
      runRoot,
    })
    packet.executed = true
    packet.status = packet.readback.status
    delete packet.next.command
  }
  assertSecretSafePacket(packet)
  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`)
}

function buildPacket({ action, generatedAt, options, runRoot }) {
  return {
    schemaVersion,
    action,
    generatedAt,
    executed: false,
    status: 'planned',
    mode: 'wrangler-local-generation-bound-fresh-restore-official-cli-synthetic',
    runRoot: runRoot.relative,
    sequence: [
      'complete_source_generation',
      'attest_source_state',
      'export_generation_bound_backup',
      'claim_fresh_target',
      'restore_and_compare_d1_r2',
      'reject_stale_generations',
      'verify_current_official_client',
      'restart_and_repeat',
      'bounded_cleanup',
    ],
    readback: null,
    next: {
      confirmation,
      command: buildExecutionCommand({ generatedAt, options, runRoot }),
    },
    safety: {
      localSyntheticOnly: true,
      verifiedFreshTargetRequired: true,
      generationApprovalPinsRequired: true,
      sourceTargetSeparationRequired: true,
      remoteResourcesAllowed: false,
      realCredentialsAllowed: false,
      deploymentAllowed: false,
      printsSecrets: false,
      trackedSecretEvidenceAllowed: false,
    },
  }
}

export async function executeCredentialRestoreLifecycle({
  generatedAt,
  harnessRoot = defaultHarnessRoot,
  runRoot,
  timeoutMs = '120000',
  forwardRecovery = false,
}) {
  if (typeof forwardRecovery !== 'boolean') {
    throw new TypeError('forward recovery selection was invalid')
  }
  return executeRestoreLifecycle({
    generatedAt: parseTimestamp(generatedAt),
    options: { harnessRoot, timeoutMs },
    runRoot: resolveRunRoot(requireValue(runRoot, '--run-root')),
    forwardRecovery,
  })
}

async function executeRestoreLifecycle({
  generatedAt,
  options,
  runRoot,
  forwardRecovery = false,
}) {
  await prepareRunRoot(runRoot.absolute)
  const activeProcesses = new Set()
  const cleanup = createIdempotentCleanup(async () => {
    await runCleanupSteps(
      [
        () =>
          stopTrackedProcesses(
            activeProcesses,
            'credential restore command cleanup',
          ),
        () => cleanupRunRoot(runRoot.absolute),
      ],
      'credential restore lifecycle cleanup',
    )
  })
  const removeSignalCleanup = installSignalCleanup(cleanup)
  let lifecycle
  try {
    const source = await preparePersistenceRoot(
      join(runRoot.absolute, 'source'),
    )
    const wranglerConfig = buildLocalResourceConfig(
      await readFile(rootWranglerConfig, 'utf8'),
    )
    await writePrivateFile(source.config, wranglerConfig)
    const backupRoot = join(runRoot.absolute, 'backup')
    const objectList = join(runRoot.absolute, 'r2-objects.txt')
    await writePrivateFile(objectList, `${r2ObjectKey}\n`)
    lifecycle = await executeCredentialLifecycleForRecovery({
      generatedAt,
      options: {
        harnessRoot: options.harnessRoot ?? defaultHarnessRoot,
        persistTo: source.persistTo,
        timeoutMs: options.timeoutMs ?? '120000',
      },
      onCompletedState: async ({ persistTo, readback, recoveryContext }) => {
        const completionBefore =
          await assertCredentialLifecycleCompletionAttestation(
            persistTo,
            readback.generationManifestSha256,
          )
        const exportPacket = await runBackupCommand(
          [
            'export',
            '--out',
            backupRoot,
            '--database',
            databaseName,
            '--bucket',
            bucketName,
            '--mode',
            'local',
            '--config',
            source.config,
            '--persist-to',
            source.persistTo,
            '--generation-manifest-sha256',
            readback.generationManifestSha256,
            '--r2-objects',
            objectList,
            '--execute',
          ],
          {
            activeProcesses,
            label: 'generation-bound credential backup',
            timeoutMs: parseTimeout(options.timeoutMs ?? '120000'),
          },
        )
        const completionAfter =
          await assertCredentialLifecycleCompletionAttestation(
            persistTo,
            readback.generationManifestSha256,
          )
        if (
          completionBefore.stateTreeSha256 !== completionAfter.stateTreeSha256
        ) {
          throw new Error(
            'generation-bound export changed source lifecycle state',
          )
        }

        const manifestPath = join(backupRoot, 'backup-manifest.json')
        const manifestBytes = await readFile(manifestPath)
        const manifest = JSON.parse(manifestBytes.toString('utf8'))
        assertGenerationBoundExportPacket(
          exportPacket,
          manifest,
          readback.generationManifestSha256,
        )
        const manifestSha256 = sha256(manifestBytes)
        const target = await preparePersistenceRoot(
          join(runRoot.absolute, 'target'),
        )
        await writePrivateFile(target.config, wranglerConfig)
        const restorePacket = await runBackupCommand(
          [
            'restore',
            '--from',
            backupRoot,
            '--database',
            databaseName,
            '--bucket',
            bucketName,
            '--mode',
            'local',
            '--config',
            target.config,
            '--persist-to',
            target.persistTo,
            '--expected-manifest-sha256',
            manifestSha256,
            '--expected-generation-manifest-sha256',
            manifest.credentialGeneration.manifestSha256,
            '--execute',
            '--confirm-fresh-target',
          ],
          {
            activeProcesses,
            label: 'generation-bound credential restore',
            timeoutMs: parseTimeout(options.timeoutMs ?? '120000'),
          },
        )
        assertRestoreEqualityPacket(restorePacket, manifest)
        const credential = await verifyRestoredCredentialGeneration({
          persistTo: target.persistTo,
          harnessRoot: options.harnessRoot ?? defaultHarnessRoot,
          recoveryContext,
          timeoutMs: options.timeoutMs ?? '120000',
        })
        let forward = null
        if (forwardRecovery) {
          let identityIndex = 0
          forward = await verifyCredentialForwardRecovery({
            persistTo: target.persistTo,
            harnessRoot: options.harnessRoot ?? defaultHarnessRoot,
            recoveryContext,
            timeoutMs: options.timeoutMs ?? '120000',
            readPersistenceIdentity: async (label) => {
              const identity = await readCanonicalPersistenceIdentity({
                activeProcesses,
                config: target.config,
                index: identityIndex,
                label,
                objectList,
                persistTo: target.persistTo,
                runRoot: runRoot.absolute,
                timeoutMs: parseTimeout(options.timeoutMs ?? '120000'),
              })
              identityIndex += 1
              return identity
            },
          })
        }
        const recovery = {
          status: 'passed',
          backup: {
            manifestSha256,
            lifecycleManifestSha256: readback.generationManifestSha256,
            generationBindingSha256:
              manifest.credentialGeneration.manifestSha256,
            generationManifestSha256:
              manifest.credentialGeneration.manifestSha256,
            sourceStateSha256: manifest.credentialGeneration.sourceStateSha256,
            d1Sha256: manifest.d1.sha256,
            r2ObjectCount: manifest.r2.objects.length,
            sourceStateUnchanged: true,
          },
          restore: restorePacket.verification,
          credential,
          ...(forward ? { forwardRecovery: forward } : {}),
          checks: [
            { name: 'source_completion_remained_attested', status: 'pass' },
            { name: 'restored_d1_r2_content_matches_source', status: 'pass' },
            { name: 'stale_generations_remain_rejected', status: 'pass' },
            { name: 'current_official_client_decrypts', status: 'pass' },
            { name: 'restart_preserves_restore_contract', status: 'pass' },
            ...(forward
              ? [
                  {
                    name: 'same_target_forward_recovery_passed',
                    status: 'pass',
                  },
                ]
              : []),
          ],
        }
        assertRecoveryContextAbsent(recovery, recoveryContext)
        return recovery
      },
    })

    const readback = {
      status: 'passed',
      source: {
        status: lifecycle.status,
        generationManifestSha256: lifecycle.generationManifestSha256,
        rejectionCounts: lifecycle.generationManifest.rejectionCounts,
        restartRejectionCounts:
          lifecycle.generationManifest.restartRejectionCounts,
        checks: lifecycle.checks,
      },
      recovery: lifecycle.recovery,
      cleanup: {
        runRootRemoved: true,
        retainedSecretFiles: 0,
      },
    }
    assertSecretSafePacket(readback)
    return readback
  } finally {
    try {
      await cleanup()
    } finally {
      removeSignalCleanup()
    }
  }
}

async function readCanonicalPersistenceIdentity({
  activeProcesses,
  config,
  index,
  label,
  objectList,
  persistTo,
  runRoot,
  timeoutMs,
}) {
  if (!Number.isInteger(index) || index < 0 || !/^[a-z0-9_]+$/.test(label)) {
    throw new Error('canonical persistence identity coordinate was invalid')
  }
  const identityRoot = join(
    runRoot,
    `identity-${String(index).padStart(2, '0')}-${label}`,
  )
  const packet = await runBackupCommand(
    [
      'export',
      '--out',
      identityRoot,
      '--database',
      databaseName,
      '--bucket',
      bucketName,
      '--mode',
      'local',
      '--config',
      config,
      '--persist-to',
      persistTo,
      '--r2-objects',
      objectList,
      '--execute',
    ],
    {
      activeProcesses,
      label: `canonical persistence identity ${label}`,
      timeoutMs,
    },
  )
  const manifest = JSON.parse(
    await readFile(join(identityRoot, 'backup-manifest.json'), 'utf8'),
  )
  const objects = Array.isArray(manifest?.r2?.objects)
    ? manifest.r2.objects
        .map((object) => ({ key: object?.key, sha256: object?.sha256 }))
        .sort((left, right) =>
          String(left.key).localeCompare(String(right.key)),
        )
    : []
  if (
    packet?.action !== 'export' ||
    packet?.executed !== true ||
    packet?.audit?.resultStatus !== 'executed' ||
    !isSha256(manifest?.d1?.sha256) ||
    objects.length !== 1 ||
    objects[0]?.key !== r2ObjectKey ||
    !isSha256(objects[0]?.sha256)
  ) {
    throw new Error('canonical persistence identity export was incomplete')
  }
  const r2Sha256 = sha256(JSON.stringify(objects))
  return {
    d1Sha256: manifest.d1.sha256,
    r2Sha256,
    combinedSha256: sha256(`${manifest.d1.sha256}\n${r2Sha256}`),
  }
}

async function runBackupCommand(args, { activeProcesses, label, timeoutMs }) {
  let result
  try {
    result = await runBoundedCommand(
      process.execPath,
      [backupScript, ...args],
      {
        activeProcesses,
        cwd: repoRoot,
        env: isolatedEnvironment(),
        label,
        outputLimit: 200_000,
        timeoutMs,
      },
    )
  } catch (error) {
    const detail = boundedDiagnostic(error?.stderr)
    throw new Error(detail ? `${error.message}: ${detail}` : error.message, {
      cause: error,
    })
  }
  let packet
  try {
    packet = JSON.parse(result.stdout)
  } catch {
    throw new Error(`${label} did not return JSON`)
  }
  return packet
}

function boundedDiagnostic(value) {
  if (typeof value !== 'string') return ''
  return [...value]
    .filter((character) => {
      const codePoint = character.codePointAt(0)
      return (
        codePoint === 9 ||
        codePoint === 10 ||
        codePoint === 13 ||
        (codePoint >= 32 && codePoint !== 127)
      )
    })
    .join('')
    .trim()
    .slice(-4000)
}

export function assertGenerationBoundExportPacket(
  packet,
  manifest,
  expectedLifecycleManifestSha256,
) {
  if (
    packet?.action !== 'export' ||
    packet?.executed !== true ||
    packet?.audit?.resultStatus !== 'executed' ||
    !isSha256(expectedLifecycleManifestSha256) ||
    !isSha256(manifest?.credentialGeneration?.lifecycleManifestSha256) ||
    !isSha256(manifest?.credentialGeneration?.manifestSha256) ||
    !isSha256(manifest?.credentialGeneration?.sourceStateSha256) ||
    !isSha256(manifest?.d1?.sha256) ||
    !Array.isArray(manifest?.r2?.objects) ||
    manifest.r2.objects.some((object) => !isSha256(object?.sha256))
  ) {
    throw new Error('generation-bound export readback was incomplete')
  }
  if (
    manifest.credentialGeneration.lifecycleManifestSha256 !==
    expectedLifecycleManifestSha256
  ) {
    throw new Error('generation-bound export lifecycle digest mismatch')
  }
}

function assertRestoreEqualityPacket(packet, manifest) {
  if (
    packet?.action !== 'restore' ||
    packet?.executed !== true ||
    packet?.audit?.resultStatus !== 'executed' ||
    packet?.verification?.status !== 'passed' ||
    packet.verification.sourceStateSha256 !==
      manifest.credentialGeneration.sourceStateSha256 ||
    packet.verification.d1Sha256 !== manifest.d1.sha256 ||
    packet.verification.r2ObjectCount !== manifest.r2.objects.length
  ) {
    throw new Error('generation-bound restore equality readback was incomplete')
  }
}

async function preparePersistenceRoot(root) {
  const wranglerRoot = join(root, '.wrangler')
  const persistTo = join(wranglerRoot, 'state')
  const config = join(root, 'wrangler.jsonc')
  for (const directory of [root, wranglerRoot, persistTo]) {
    await mkdir(directory, { recursive: false, mode: 0o700 })
    await chmod(directory, 0o700)
  }
  return { root, config, persistTo }
}

async function prepareRunRoot(root) {
  await prepareCredentialRestoreFixtureRoot(fixtureRoot, repoRoot)
  await mkdir(root, { recursive: false, mode: 0o700 })
  await chmod(root, 0o700)
  const info = await lstat(root)
  if (!info.isDirectory() || !isOwnedByCurrentUser(info)) {
    throw new Error('credential restore run root was not owned')
  }
  await writeFile(join(root, runOwnershipMarker), runOwnershipMarkerBody, {
    flag: 'wx',
    mode: 0o600,
  })
}

export async function prepareCredentialRestoreFixtureRoot(
  candidateFixtureRoot = fixtureRoot,
  candidateRepoRoot = repoRoot,
) {
  await mkdir(candidateFixtureRoot, { recursive: true, mode: 0o700 })
  const fixtureInfo = await lstat(candidateFixtureRoot)
  if (fixtureInfo.isSymbolicLink()) {
    throw new Error('test/.tmp must not be a symlink')
  }
  if (
    !fixtureInfo.isDirectory() ||
    !isOwnedByCurrentUser(fixtureInfo) ||
    (fixtureInfo.mode & 0o777) !== 0o700
  ) {
    throw new Error('test/.tmp must be an owned directory with mode 0700')
  }
  const [canonicalRepo, canonicalFixtureRoot] = await Promise.all([
    realpath(candidateRepoRoot),
    realpath(candidateFixtureRoot),
  ])
  if (canonicalFixtureRoot !== join(canonicalRepo, 'test/.tmp')) {
    throw new Error('test/.tmp must not be a symlink')
  }
}

async function cleanupRunRoot(root) {
  const markerPath = join(root, runOwnershipMarker)
  const [rootInfo, markerInfo, markerBody] = await Promise.all([
    lstat(root),
    lstat(markerPath),
    readFile(markerPath, 'utf8'),
  ])
  if (
    rootInfo.isSymbolicLink() ||
    !rootInfo.isDirectory() ||
    !isOwnedByCurrentUser(rootInfo) ||
    (rootInfo.mode & 0o777) !== 0o700 ||
    markerInfo.isSymbolicLink() ||
    !markerInfo.isFile() ||
    !isOwnedByCurrentUser(markerInfo) ||
    (markerInfo.mode & 0o777) !== 0o600 ||
    markerBody !== runOwnershipMarkerBody
  ) {
    throw new Error('credential restore cleanup ownership proof was invalid')
  }
  await rm(root, { recursive: true, force: true })
}

function resolveRunRoot(value) {
  const absolute = resolve(repoRoot, requireValue(value, '--run-root'))
  const inside = relative(fixtureRoot, absolute)
  if (
    inside.length === 0 ||
    inside === '..' ||
    inside.startsWith(`..${sep}`) ||
    inside.includes(sep)
  ) {
    throw new Error('--run-root must be one direct child of test/.tmp')
  }
  return { absolute, relative: relative(repoRoot, absolute) }
}

function parseOptions(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--') continue
    if (arg === '--execute') {
      options.execute = true
      continue
    }
    if (
      [
        '--at',
        '--confirm',
        '--harness-root',
        '--run-root',
        '--timeout-ms',
      ].includes(arg)
    ) {
      const value = args[index + 1]
      if (!value) throw new Error(`${arg} requires a value`)
      options[toCamelCase(arg.slice(2))] = value
      index += 1
      continue
    }
    throw new Error(`unknown credential restore option: ${arg}`)
  }
  return options
}

function buildExecutionCommand({ generatedAt, options, runRoot }) {
  return [
    'pnpm account:credential-restore:lifecycle -- run',
    `--run-root ${shellQuote(runRoot.relative)}`,
    `--harness-root ${shellQuote(options.harnessRoot ?? defaultHarnessRoot)}`,
    `--at ${shellQuote(generatedAt)}`,
    `--timeout-ms ${shellQuote(options.timeoutMs ?? '120000')}`,
    `--execute --confirm ${confirmation}`,
  ].join(' ')
}

function isolatedEnvironment() {
  const env = {}
  for (const key of allowedEnvironmentKeys) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  env.PATH = `${join(repoRoot, 'node_modules/.bin')}:${env.PATH ?? ''}`
  env.pnpm_config_verify_deps_before_run = 'false'
  return env
}

function buildLocalResourceConfig(contents) {
  const errors = []
  const config = parseJsonc(contents, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  })
  const databases = config?.d1_databases?.filter(
    (database) => database?.database_name === databaseName,
  )
  const buckets = config?.r2_buckets?.filter(
    (bucket) => bucket?.bucket_name === bucketName,
  )
  if (
    errors.length !== 0 ||
    databases?.length !== 1 ||
    buckets?.length !== 1 ||
    typeof config?.compatibility_date !== 'string'
  ) {
    throw new Error('local credential restore resource config was invalid')
  }
  return `${JSON.stringify(
    {
      name: 'honowarden-credential-restore',
      compatibility_date: config.compatibility_date,
      d1_databases: databases,
      r2_buckets: buckets,
    },
    null,
    2,
  )}\n`
}

function assertRecoveryContextAbsent(value, recoveryContext) {
  const serialized = JSON.stringify(value)
  const secretValues = privateRecoveryValues(recoveryContext)
  for (const candidate of secretValues) {
    if (candidate.length >= 16 && serialized.includes(candidate)) {
      throw new Error('credential restore readback contained private material')
    }
  }
}

function privateRecoveryValues(context) {
  const output = new Set()
  collectPrivateStrings(context.material.email, output)
  collectPrivateStrings(context.material.plaintext, output)
  for (const stage of Object.values(context.material.stages)) {
    collectPrivateStrings(stage.password, output)
    collectPrivateStrings(stage.masterPasswordAuthenticationHash, output)
    collectPrivateStrings(stage.masterKeyEncryptedUserKey, output)
    collectPrivateStrings(stage.accountKeys, output)
    collectPrivateStrings(stage.vault, output)
  }
  collectPrivateStrings(context.current.tokens, output)
  for (const stale of context.stale) {
    collectPrivateStrings(stale.tokens, output)
    collectPrivateStrings(stale.session, output)
  }
  return output
}

function collectPrivateStrings(value, output) {
  if (typeof value === 'string') {
    output.add(value)
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectPrivateStrings(entry, output)
    return
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) {
      collectPrivateStrings(entry, output)
    }
  }
}

export function assertSecretSafePacket(value) {
  const serialized = JSON.stringify(value)
  const forbidden = [
    'masterPasswordAuthenticationHash',
    'masterKeyEncryptedUserKey',
    'access_token',
    'refresh_token',
    'BW_PASSWORD',
    'BW_SESSION',
  ]
  if (forbidden.some((entry) => serialized.includes(entry))) {
    throw new Error('credential restore packet contained a secret field')
  }
}

function parseTimestamp(value) {
  const timestamp = value ?? new Date().toISOString()
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    throw new Error('--at must be an exact ISO timestamp')
  }
  return timestamp
}

function parseTimeout(value) {
  const timeout = Number.parseInt(value, 10)
  if (!Number.isInteger(timeout) || timeout < 10_000 || timeout > 300_000) {
    throw new Error('--timeout-ms must be between 10000 and 300000')
  }
  return timeout
}

function requireValue(value, flag) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${flag} is required`)
  }
  return value
}

function writePrivateFile(path, contents) {
  return writeFile(path, contents, { flag: 'wx', mode: 0o600 })
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function isOwnedByCurrentUser(info) {
  return typeof process.getuid !== 'function' || info.uid === process.getuid()
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
}

function shellQuote(value) {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'credential restore lifecycle failed'}\n`,
    )
    process.exitCode = 1
  })
}

#!/usr/bin/env node

import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  chmod,
  cp,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import process from 'node:process'
import { clearTimeout, setTimeout } from 'node:timers'
import { fileURLToPath } from 'node:url'

import { installSignalCleanup } from './honowarden-signal-cleanup.mjs'

const schemaVersion = 1
const confirmation = 'official-client-harness'
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = join(repoRoot, 'test/.tmp')
const defaultRoot = 'test/.tmp/hon-207-official-client'
const supportedActions = new Set([
  'plan',
  'prepare',
  'crypto-roundtrip',
  'credential-fixture',
  'cli-run',
  'status',
  'cleanup',
])
const upstreamCliNpmAssetName = `${['bit', 'warden'].join('')}-cli-2026.6.0-npm-build.zip`
const cliAppDataEnvironment = ['BIT', 'WARDENCLI_APPDATA_DIR'].join('')
const officialCliServiceOverrides = Object.freeze([
  'api',
  'identity',
  'webVault',
  'icons',
  'notifications',
  'events',
  'keyConnector',
  'scim',
  'send',
])
const officialCliProfileConfigurationError =
  'official CLI profile server configuration violated the loopback-only contract'

export const officialClientPins = Object.freeze({
  server: Object.freeze({
    repository: 'github:46755185',
    tag: 'v2026.6.1',
    commit: 'a09c7edb03ae6d4fdece784f1250c67be73d5fe0',
  }),
  web: Object.freeze({
    repository: 'github:53538899',
    tag: 'web-v2026.6.1',
    commit: '39f07436ca60e3f25eac47777671754f288a98f1',
  }),
  browser: Object.freeze({
    repository: 'github:53538899',
    tag: 'browser-v2026.6.1',
    commit: '723c075bf8b9f45c901e56195be8e94e43ed75a2',
  }),
  cli: Object.freeze({
    repository: 'github:53538899',
    tag: 'cli-v2026.6.0',
    commit: 'e6293ff2bc85123e9baaa998cf1543030ec5d9f0',
  }),
})

export const officialClientAssets = Object.freeze({
  cliNpm: Object.freeze({
    repository: 'github:53538899',
    repositoryId: 53_538_899,
    tag: 'cli-v2026.6.0',
    publishedAt: '2026-06-25T18:32:52Z',
    id: 457_887_277,
    name: upstreamCliNpmAssetName,
    size: 4_402_383,
    sha256: '31765936eef9beca89298ffb554a658138932d505deebc6b65e02baa065c0660',
    url: 'https://api.github.com/repositories/53538899/releases/assets/457887277',
  }),
  cliMacArm64: Object.freeze({
    repository: 'github:53538899',
    repositoryId: 53_538_899,
    tag: 'cli-v2026.6.0',
    publishedAt: '2026-06-25T18:32:52Z',
    id: 457_887_093,
    name: 'bw-macos-arm64-2026.6.0.zip',
    size: 41_121_808,
    sha256: '57d1e60d7748c6efed96559833ce0423a5c825cbf1356d952970c87a497a64d4',
    url: 'https://api.github.com/repositories/53538899/releases/assets/457887093',
  }),
  browserChrome: Object.freeze({
    repository: 'github:53538899',
    repositoryId: 53_538_899,
    tag: 'browser-v2026.6.1',
    publishedAt: '2026-06-30T17:07:46Z',
    id: 462_351_736,
    name: 'dist-chrome-2026.6.1.zip',
    size: 21_593_500,
    sha256: 'fcd29c5971d9b218ad9159717a19c38cca5150f2a0aa909ddf805bd7695d097e',
    url: 'https://api.github.com/repositories/53538899/releases/assets/462351736',
  }),
})

const webpackBootstrap = '/******/ (() => { // webpackBootstrap'
const asyncWebpackBootstrap = '/******/ (async () => { // webpackBootstrap'
const webpackExportBoundary = 'var __webpack_exports__ = {};'
const cryptoBridgeEnvironment = 'HONOWARDEN_OFFICIAL_CRYPTO_BRIDGE'
const mutableHarnessDirectories = Object.freeze([
  'profile',
  'home',
  'tmp',
  'requests',
  'responses',
  'output',
])
const officialRuntimeFileManifest = Object.freeze({
  'crypto/locales/en/messages.json': Object.freeze({
    archive: 'cliNpm',
    entry: 'locales/en/messages.json',
    bytes: 8_110,
    sha256: '243dc5c464ea90be277067577e7959a7f9b14f77cfae9fe2e970804802e16d98',
    mode: 0o600,
  }),
  'crypto/344.js': Object.freeze({
    archive: 'cliNpm',
    entry: '344.js',
    bytes: 20_295,
    sha256: '1c3f0190ae329a496dcc23a9715830180a0e9c00ed7c1bcba04ac38cb32403bf',
    mode: 0o600,
  }),
  'crypto/344.js.map': Object.freeze({
    archive: 'cliNpm',
    entry: '344.js.map',
    bytes: 23_563,
    sha256: '31e2c81e8ee0a8baa2cf87300b9ca5f920326845eaf8b1da274cf09f19274e3a',
    mode: 0o600,
  }),
  'crypto/685.js': Object.freeze({
    archive: 'cliNpm',
    entry: '685.js',
    bytes: 31_808,
    sha256: 'dbf8794437fd9ededa7292539b1bd637db853556b291bcdd6f93cebad27fa699',
    mode: 0o600,
  }),
  'crypto/869d87bc3b0a55e0e213.module.wasm': Object.freeze({
    archive: 'cliNpm',
    entry: '869d87bc3b0a55e0e213.module.wasm',
    bytes: 7_120_361,
    sha256: '3c4db255dafaaac228fd4e8e8fff75ce561a5abd1c0cb8f1fd30fe5cdd82a6fb',
    mode: 0o600,
  }),
  'crypto/bw.js': Object.freeze({
    archive: 'cliNpm',
    entry: 'bw.js',
    bytes: 3_719_029,
    sha256: '3e2628815b22b70adf74cd4a936af98b4da772777c8e966e60687f36dd4be1e3',
    mode: 0o600,
  }),
  'crypto/bw.js.map': Object.freeze({
    archive: 'cliNpm',
    entry: 'bw.js.map',
    bytes: 5_972_605,
    sha256: '08e6c0f2ebf874f4fd6db996795749158ab531c99b2e9484a6de99ab728c9e42',
    mode: 0o600,
  }),
  'crypto/honowarden-bridge.cjs': Object.freeze({
    archive: null,
    entry: null,
    bytes: 3_731_743,
    sha256: '1a38398906d268c61ad40b79310d4810125f25d056052404fb0b8dfc23cd6601',
    mode: 0o700,
  }),
  'crypto/package.json': Object.freeze({
    archive: null,
    entry: null,
    bytes: 20,
    sha256: 'dbf8353f77358bc12169b7bb7301e1978d5b503e002ee927229a8993672818fc',
    mode: 0o600,
  }),
  'native/bw': Object.freeze({
    archive: 'cliMacArm64',
    entry: 'bw',
    bytes: 130_181_616,
    sha256: '379916ab23114a3a04be6987aadb4570983b31d8982a0c1e6f931effedf8063e',
    mode: 0o700,
  }),
})

async function main(argv = process.argv.slice(2)) {
  const normalized = argv[0] === '--' ? argv.slice(1) : argv
  const [action, ...rest] = normalized
  if (!action || !supportedActions.has(action)) {
    throw new Error(
      'action must be plan, prepare, crypto-roundtrip, credential-fixture, cli-run, status, or cleanup',
    )
  }

  const options = parseOptions(rest)
  const root = resolveHarnessRoot(options.root ?? defaultRoot)
  if (options.execute) {
    requireConfirmation(options)
  }
  if (action === 'cli-run') {
    validateOfficialCliArgs(options.passthrough)
    validateLoopbackOrigin(options.origin)
    validateOfficialProfileName(options.profile)
  } else {
    if (options.origin !== undefined) {
      throw new Error('--origin is only allowed for cli-run')
    }
    if (options.profile !== undefined) {
      throw new Error('--profile is only allowed for cli-run')
    }
    if (options.passthrough.length > 0) {
      throw new Error('arguments after -- are only allowed for cli-run')
    }
  }
  const packet = buildPacket(action, options, root)

  if (options.execute) {
    await executeAction(packet, options, root)
  }

  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`)
}

function buildPacket(action, options, root) {
  const generatedAt = parseTimestamp(options.at)
  const timeoutMs =
    options.timeoutMs === undefined
      ? undefined
      : parseTimeout(options.timeoutMs, 60_000)
  return {
    schemaVersion,
    action,
    generatedAt,
    executed: false,
    status: 'planned',
    root: root.relative,
    pins: officialClientPins,
    assets: officialClientAssets,
    paths: {
      npmAsset: join(root.relative, 'assets', officialClientAssets.cliNpm.name),
      nativeAsset: join(
        root.relative,
        'assets',
        officialClientAssets.cliMacArm64.name,
      ),
      bridge: join(root.relative, 'crypto', 'honowarden-bridge.cjs'),
      bridgePackage: join(root.relative, 'crypto', 'package.json'),
      nativeCli: join(root.relative, 'native', 'bw'),
      profile: join(root.relative, 'profile'),
      home: join(root.relative, 'home'),
      temporary: join(root.relative, 'tmp'),
      requests: join(root.relative, 'requests'),
      responses: join(root.relative, 'responses'),
      output: join(root.relative, 'output'),
      state: join(root.relative, 'state.json'),
    },
    readback: null,
    next: {
      confirmation,
      command: buildExecutionCommand(
        action,
        options,
        root,
        generatedAt,
        timeoutMs,
      ),
    },
    safety: {
      officialImplementation: true,
      productionSupported: false,
      realCredentialsAllowed: false,
      printsSecrets: false,
      ignoredStorageRequired: true,
      isolatedProcessGroup: true,
      downloadedAssetsTracked: false,
    },
  }
}

async function executeAction(packet, options, root) {
  switch (packet.action) {
    case 'plan':
      packet.status = 'planned'
      break
    case 'prepare':
      packet.readback = await prepareHarness(root, packet.generatedAt)
      packet.status = 'prepared'
      break
    case 'crypto-roundtrip':
      packet.readback = await runCryptoRoundtrip(root, options)
      packet.status = 'verified'
      break
    case 'credential-fixture': {
      const fixture = await generateOfficialCredentialFixture(root, options)
      packet.readback = fixture.readback
      packet.status = 'generated'
      break
    }
    case 'cli-run':
      packet.readback = await runOfficialCli(root, options)
      packet.status =
        packet.readback.exitCode === 0 ? 'completed' : 'command_failed'
      if (packet.readback.exitCode !== 0 || packet.readback.timedOut) {
        throw new Error('official CLI command failed; inspect ignored output')
      }
      break
    case 'status':
      packet.readback = await readHarnessStatus(root)
      packet.status = packet.readback.rootExists
        ? packet.readback.valid
          ? 'prepared'
          : 'invalid'
        : 'not_prepared'
      break
    case 'cleanup':
      packet.readback = await cleanupHarness(root)
      packet.status = packet.readback.rootExists ? 'not_clean' : 'clean'
      break
  }
  packet.executed = true
  delete packet.next.command
}

async function prepareHarness(root, preparedAt) {
  requireSupportedNativePlatform()
  await validateHarnessRoot(root)
  if (await exists(root.absolute)) {
    throw new Error('harness root already exists; run cleanup first')
  }

  let created = false
  try {
    await mkdir(root.absolute, { recursive: true, mode: 0o700 })
    created = true
    for (const directory of [
      'assets',
      'crypto',
      'native',
      'profile',
      'home',
      'tmp',
      'requests',
      'responses',
      'output',
    ]) {
      await mkdir(join(root.absolute, directory), { mode: 0o700 })
    }

    const npmBytes = await downloadPinnedAsset(officialClientAssets.cliNpm)
    const nativeBytes = await downloadPinnedAsset(
      officialClientAssets.cliMacArm64,
    )
    const npmReadback = verifyPinnedAsset(npmBytes, officialClientAssets.cliNpm)
    const nativeReadback = verifyPinnedAsset(
      nativeBytes,
      officialClientAssets.cliMacArm64,
    )

    const npmAssetPath = join(
      root.absolute,
      'assets',
      officialClientAssets.cliNpm.name,
    )
    const nativeAssetPath = join(
      root.absolute,
      'assets',
      officialClientAssets.cliMacArm64.name,
    )
    await writeFile(npmAssetPath, npmBytes, { mode: 0o600, flag: 'wx' })
    await writeFile(nativeAssetPath, nativeBytes, {
      mode: 0o600,
      flag: 'wx',
    })

    const cryptoDirectory = join(root.absolute, 'crypto')
    const nativeDirectory = join(root.absolute, 'native')
    await validatePinnedArchiveEntries(npmAssetPath, 'cliNpm')
    await validatePinnedArchiveEntries(nativeAssetPath, 'cliMacArm64')
    await extractPinnedArchive(npmAssetPath, cryptoDirectory)
    await extractPinnedArchive(nativeAssetPath, nativeDirectory)
    await validateExtractedFile(join(cryptoDirectory, 'bw.js'))
    const nativeCli = join(nativeDirectory, 'bw')
    await validateExtractedFile(nativeCli)

    const source = await readFile(join(cryptoDirectory, 'bw.js'), 'utf8')
    const bridge = renderOfficialCryptoBridge(source)
    const bridgePath = join(cryptoDirectory, 'honowarden-bridge.cjs')
    await writeFile(
      join(cryptoDirectory, 'package.json'),
      '{"type":"commonjs"}\n',
      { mode: 0o600, flag: 'wx' },
    )
    await writeFile(bridgePath, bridge, { mode: 0o700, flag: 'wx' })
    await normalizeRuntimeFileModes(root.absolute, officialRuntimeFileManifest)
    const runtimeIntegrity = await validateRuntimeFileManifest(
      root.absolute,
      officialRuntimeFileManifest,
    )

    const versionRun = await runCapturedProcess(nativeCli, ['--version'], {
      cwd: root.absolute,
      env: isolatedClientEnvironment(root),
      outputDirectory: join(root.absolute, 'output'),
      timeoutMs: 10_000,
      label: 'native-version',
    })
    if (versionRun.exitCode !== 0 || versionRun.timedOut) {
      throw new Error('official CLI version readback failed')
    }
    const nativeVersion = (
      await readFile(
        join(root.absolute, 'output', 'native-version.stdout.log'),
        'utf8',
      )
    ).trim()
    if (nativeVersion !== '2026.6.0') {
      throw new Error('official CLI version did not match the pin')
    }
    await rm(join(root.absolute, 'profile'), {
      recursive: true,
      force: false,
    })
    await mkdir(join(root.absolute, 'profile'), { mode: 0o700 })

    const state = {
      schemaVersion,
      preparedAt,
      pins: officialClientPins,
      assets: {
        cliNpm: npmReadback,
        cliMacArm64: nativeReadback,
      },
      bridge: {
        sourceAssetSha256: officialClientAssets.cliNpm.sha256,
        sha256: sha256(bridge),
        environment: cryptoBridgeEnvironment,
      },
      nativeCli: {
        version: nativeVersion,
        assetSha256: officialClientAssets.cliMacArm64.sha256,
      },
      runtimeManifestSha256: runtimeIntegrity.manifestSha256,
      safety: {
        syntheticOnly: true,
        productionSupported: false,
        normalBrowserProfileUsed: false,
      },
    }
    await writeFile(
      join(root.absolute, 'state.json'),
      `${JSON.stringify(state, null, 2)}\n`,
      { mode: 0o600, flag: 'wx' },
    )

    return {
      rootExists: true,
      valid: true,
      rootMode: await readMode(root.absolute),
      npmAsset: npmReadback,
      nativeAsset: nativeReadback,
      bridgeSha256: state.bridge.sha256,
      runtimeManifestSha256: runtimeIntegrity.manifestSha256,
      nativeVersion,
      profileEntries: 0,
      officialCryptoExecuted: false,
    }
  } catch (error) {
    if (created) {
      await rm(root.absolute, { recursive: true, force: true })
    }
    throw error
  }
}

async function runCryptoRoundtrip(root, options) {
  let status = await readHarnessStatus(root)
  if (!status.rootExists || !status.valid) {
    throw new Error('prepare a valid harness before crypto-roundtrip')
  }

  const cases = [
    {
      id: 'pbkdf2',
      kdf: { pBKDF2: { iterations: 600_000 } },
    },
    {
      id: 'argon2id',
      kdf: {
        argon2id: { iterations: 3, memory: 64, parallelism: 4 },
      },
    },
  ]
  const readbacks = []
  const runId = randomUUID()
  for (const fixtureCase of cases) {
    const requestPath = join(
      root.absolute,
      'requests',
      `${fixtureCase.id}-${runId}.json`,
    )
    const responsePath = join(
      root.absolute,
      'responses',
      `${fixtureCase.id}-${runId}.json`,
    )
    const request = {
      schemaVersion,
      operation: 'roundtrip',
      fixture: {
        email: `honowarden-${randomUUID()}@example.invalid`,
        password: randomBytes(32).toString('base64url'),
        plaintext: `honowarden-${randomBytes(32).toString('hex')}`,
        kdf: fixtureCase.kdf,
      },
    }
    await writeFile(requestPath, `${JSON.stringify(request)}\n`, {
      mode: 0o600,
      flag: 'wx',
    })

    status = await readHarnessStatus(root)
    if (!status.valid) {
      throw new Error(
        'prepared harness changed before official crypto execution',
      )
    }
    const run = await runCapturedProcess(
      process.execPath,
      [
        join(root.absolute, 'crypto', 'honowarden-bridge.cjs'),
        requestPath,
        responsePath,
      ],
      {
        cwd: join(root.absolute, 'crypto'),
        env: {
          ...isolatedClientEnvironment(root),
          [cryptoBridgeEnvironment]: '1',
        },
        outputDirectory: join(root.absolute, 'output'),
        timeoutMs: parseTimeout(options.timeoutMs, 60_000),
        label: `crypto-${fixtureCase.id}-${runId}`,
      },
    )
    if (run.exitCode !== 0 || run.timedOut) {
      throw new Error(
        `official crypto ${fixtureCase.id} failed; inspect ignored output`,
      )
    }
    if (run.stdout.bytes !== 0 || run.stderr.bytes !== 0) {
      throw new Error('official crypto bridge emitted unexpected output')
    }

    const responseBytes = await readFile(responsePath)
    const response = JSON.parse(responseBytes.toString('utf8'))
    validateCryptoResponse(response, fixtureCase.id)
    readbacks.push({
      id: fixtureCase.id,
      kdf: response.readback.kdf,
      implementation: response.implementation,
      userKeyBytes: response.readback.userKeyBytes,
      wrappedUserKeyType: response.readback.wrappedUserKeyType,
      encryptedItemType: response.readback.encryptedItemType,
      privateKeyType: response.readback.privateKeyType,
      responseBytes: responseBytes.length,
      responseSha256: sha256(responseBytes),
      stdout: run.stdout,
      stderr: run.stderr,
    })
  }

  return {
    implementation: 'upstream-cli-sdk-wasm',
    sourceAssetSha256: officialClientAssets.cliNpm.sha256,
    bridgeSha256: status.bridgeSha256,
    cases: readbacks,
    secretsPrinted: false,
    outputFilesMode: '0600',
  }
}

export async function generateOfficialCredentialFixture(root, options = {}) {
  const status = await readHarnessStatus(root)
  if (!status.rootExists || !status.valid) {
    throw new Error('prepare a valid harness before credential-fixture')
  }

  const runId = randomUUID()
  const requestPath = join(
    root.absolute,
    'requests',
    `credential-fixture-${runId}.json`,
  )
  const responsePath = join(
    root.absolute,
    'responses',
    `credential-fixture-${runId}.json`,
  )
  const request = {
    schemaVersion,
    operation: 'credential-fixture',
    fixture: {
      email: `hon220-${randomUUID()}@example.invalid`,
      passwords: {
        baseline: randomBytes(32).toString('base64url'),
        passwordChange: randomBytes(32).toString('base64url'),
        userKeyRotation: randomBytes(32).toString('base64url'),
      },
      plaintext: {
        folderName: `HON-220 ${randomBytes(12).toString('hex')}`,
        itemName: `HON-220 item ${randomBytes(12).toString('hex')}`,
        itemUsername: `hon220-user-${randomBytes(12).toString('hex')}`,
        itemPassword: randomBytes(32).toString('base64url'),
        itemUri: `https://hon220-${randomBytes(12).toString('hex')}.example.invalid`,
        itemNotes: `HON-220 notes ${randomBytes(24).toString('hex')}`,
        attachmentFileName: `hon220-${randomBytes(12).toString('hex')}.bin`,
        attachmentKey: randomBytes(64).toString('base64url'),
      },
    },
  }
  await writeFile(requestPath, `${JSON.stringify(request)}\n`, {
    mode: 0o600,
    flag: 'wx',
  })

  const commandStatus = await readHarnessStatus(root)
  if (!commandStatus.valid) {
    throw new Error(
      'prepared harness changed before official credential generation',
    )
  }
  const run = await runCapturedProcess(
    process.execPath,
    [
      join(root.absolute, 'crypto', 'honowarden-bridge.cjs'),
      requestPath,
      responsePath,
    ],
    {
      cwd: join(root.absolute, 'crypto'),
      env: {
        ...isolatedClientEnvironment(root),
        [cryptoBridgeEnvironment]: '1',
      },
      outputDirectory: join(root.absolute, 'output'),
      timeoutMs: parseTimeout(options.timeoutMs, 120_000),
      label: `credential-fixture-${runId}`,
    },
  )
  if (run.exitCode !== 0 || run.timedOut) {
    throw new Error(
      'official credential fixture failed; inspect ignored output',
    )
  }
  if (run.stdout.bytes !== 0 || run.stderr.bytes !== 0) {
    throw new Error('official credential bridge emitted unexpected output')
  }

  const responseBytes = await readFile(responsePath)
  const response = JSON.parse(responseBytes.toString('utf8'))
  validateCredentialFixtureResponse(response)
  return {
    material: response.material,
    responsePath,
    readback: {
      implementation: response.implementation,
      sourceAssetSha256: officialClientAssets.cliNpm.sha256,
      bridgeSha256: status.bridgeSha256,
      response: {
        file: basename(responsePath),
        bytes: responseBytes.length,
        sha256: sha256(responseBytes),
      },
      stages: response.readback.stages,
      sameAccount: response.readback.sameAccount,
      sharedInitialUserKey: response.readback.sharedInitialUserKey,
      rotatedUserKeyDistinct: response.readback.rotatedUserKeyDistinct,
      secretsPrinted: false,
      outputFilesMode: '0600',
      stdout: run.stdout,
      stderr: run.stderr,
    },
  }
}

export async function runOfficialCli(root, options) {
  requireSupportedNativePlatform()
  const status = await readHarnessStatus(root)
  if (!status.rootExists || !status.valid) {
    throw new Error('prepare a valid harness before cli-run')
  }
  validateOfficialCliArgs(options.passthrough)
  const origin = validateLoopbackOrigin(options.origin)

  const profile = validateOfficialProfileName(options.profile)
  await ensureOfficialProfileDirectories(root, profile)
  const environment = isolatedClientEnvironment(
    root,
    options.sourceEnvironment ?? process.env,
    profile,
  )
  const nativeCli = join(root.absolute, 'native', 'bw')
  const outputDirectory = join(root.absolute, 'output')
  const timeoutMs = parseTimeout(options.timeoutMs, 30_000)
  const configRead = await runCapturedProcess(nativeCli, ['config', 'server'], {
    cwd: root.absolute,
    env: environment,
    outputDirectory,
    timeoutMs,
    label: `cli-config-read-${randomUUID()}`,
  })
  if (
    configRead.exitCode !== 0 ||
    configRead.timedOut ||
    configRead.stderr.bytes !== 0
  ) {
    throw new Error('official CLI server configuration read failed')
  }
  const configuredServer = await readCapturedFile(
    outputDirectory,
    configRead.stdout,
  )
  let configWrite = null
  if (
    requiresOfficialCliServerUpdate(configuredServer.toString('utf8'), origin)
  ) {
    configWrite = await runCapturedProcess(
      nativeCli,
      ['config', 'server', origin],
      {
        cwd: root.absolute,
        env: environment,
        outputDirectory,
        timeoutMs,
        label: `cli-config-write-${randomUUID()}`,
      },
    )
    if (
      configWrite.exitCode !== 0 ||
      configWrite.timedOut ||
      configWrite.stderr.bytes !== 0
    ) {
      throw new Error('official CLI local-server configuration failed')
    }
  }

  const commandStatus = await readHarnessStatus(root)
  if (!commandStatus.valid) {
    throw new Error('prepared harness changed before official CLI execution')
  }
  const profileEnvironment = await readOfficialCliProfileEnvironment(
    root,
    origin,
    profile,
  )
  const commandRun = await runCapturedProcess(nativeCli, options.passthrough, {
    cwd: root.absolute,
    env: environment,
    outputDirectory,
    timeoutMs: parseTimeout(options.timeoutMs, 60_000),
    label: `cli-command-${randomUUID()}`,
  })
  return {
    origin,
    profile: profile ?? 'default',
    serverConfigured: true,
    serverConfigurationChanged: configWrite !== null,
    configuration: {
      read: configRead,
      write: configWrite,
      effectiveEnvironment: profileEnvironment,
    },
    ...commandRun,
  }
}

async function readHarnessStatus(root) {
  await validateHarnessRoot(root)
  if (!(await exists(root.absolute))) {
    return {
      rootExists: false,
      valid: false,
    }
  }
  await rejectSymlink(root.absolute)
  await validateHarnessDirectories(root)

  const statePath = join(root.absolute, 'state.json')
  await validateExtractedFile(statePath)
  await requireMode(statePath, 0o600, 'harness state')
  const npmAssetPath = join(
    root.absolute,
    'assets',
    officialClientAssets.cliNpm.name,
  )
  const nativeAssetPath = join(
    root.absolute,
    'assets',
    officialClientAssets.cliMacArm64.name,
  )
  await validateExtractedFile(npmAssetPath)
  await validateExtractedFile(nativeAssetPath)
  await requireMode(npmAssetPath, 0o600, 'CLI npm asset')
  await requireMode(nativeAssetPath, 0o600, 'native CLI asset')
  const state = JSON.parse(await readFile(statePath, 'utf8'))
  const npmBytes = await readFile(npmAssetPath)
  const nativeBytes = await readFile(nativeAssetPath)
  const npmAsset = verifyPinnedAsset(npmBytes, officialClientAssets.cliNpm)
  const nativeAsset = verifyPinnedAsset(
    nativeBytes,
    officialClientAssets.cliMacArm64,
  )
  await validatePinnedArchiveEntries(npmAssetPath, 'cliNpm')
  await validatePinnedArchiveEntries(nativeAssetPath, 'cliMacArm64')
  const runtimeIntegrity = await validateRuntimeFileManifest(
    root.absolute,
    officialRuntimeFileManifest,
  )
  const bridgeSha256 =
    officialRuntimeFileManifest['crypto/honowarden-bridge.cjs'].sha256
  const rootMode = await readMode(root.absolute)
  const valid =
    state?.schemaVersion === schemaVersion &&
    state?.pins?.server?.commit === officialClientPins.server.commit &&
    state?.pins?.web?.commit === officialClientPins.web.commit &&
    state?.pins?.browser?.commit === officialClientPins.browser.commit &&
    state?.pins?.cli?.commit === officialClientPins.cli.commit &&
    state?.bridge?.sourceAssetSha256 === officialClientAssets.cliNpm.sha256 &&
    state?.bridge?.sha256 === bridgeSha256 &&
    state?.nativeCli?.version === '2026.6.0' &&
    state?.nativeCli?.assetSha256 === officialClientAssets.cliMacArm64.sha256 &&
    state?.runtimeManifestSha256 === runtimeIntegrity.manifestSha256 &&
    rootMode === '0700'

  return {
    rootExists: true,
    valid,
    rootMode,
    npmAsset,
    nativeAsset,
    bridgeSha256,
    runtimeManifestSha256: runtimeIntegrity.manifestSha256,
    nativeVersion: state?.nativeCli?.version ?? null,
    profileEntries: await countDirectoryEntries(join(root.absolute, 'profile')),
  }
}

async function cleanupHarness(root) {
  await validateHarnessRoot(root)
  if (await exists(root.absolute)) {
    await rejectSymlink(root.absolute)
    await rm(root.absolute, { recursive: true, force: false })
  }
  await clearClipboard()
  return {
    rootExists: await exists(root.absolute),
    clipboardCleared: true,
  }
}

export function verifyPinnedAsset(bytes, metadata) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    throw new Error('asset bytes were invalid')
  }
  if (bytes.length !== metadata.size) {
    throw new Error(`${metadata.name} asset size mismatch`)
  }
  const digest = sha256(bytes)
  if (digest !== metadata.sha256) {
    throw new Error(`${metadata.name} asset digest mismatch`)
  }
  return {
    name: metadata.name,
    size: bytes.length,
    sha256: digest,
  }
}

export function renderOfficialCryptoBridge(source) {
  if (countOccurrences(source, webpackBootstrap) !== 1) {
    throw new Error('webpack bootstrap boundary did not match exactly once')
  }
  if (countOccurrences(source, webpackExportBoundary) !== 1) {
    throw new Error('webpack export boundary did not match exactly once')
  }
  const asyncSource = source.replace(webpackBootstrap, asyncWebpackBootstrap)
  return asyncSource.replace(
    webpackExportBoundary,
    `${webpackExportBoundary}\n${officialCryptoBridgeSource()}`,
  )
}

function officialCryptoBridgeSource() {
  return String.raw`if (process.env.HONOWARDEN_OFFICIAL_CRYPTO_BRIDGE === "1") {
  const fs = require("node:fs");
  const crypto = require("node:crypto");
  const requestPath = process.argv[2];
  const responsePath = process.argv[3];
  if (!requestPath || !responsePath) {
    throw new Error("official crypto bridge requires request and response paths");
  }
  const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
  const fixture = request?.fixture;
  if (request?.schemaVersion !== 1 || typeof fixture !== "object" || fixture === null) {
    throw new Error("official crypto bridge request was invalid");
  }

  await __webpack_require__.e(685);
  const sdk = __webpack_require__(431);
  const wasm = await __webpack_require__(685);
  sdk.lIU(wasm);
  sdk.Geh(sdk.$bb.Error, sdk.$bb.Error, 0);

  const source = {
    tag: "cli-v2026.6.0",
    commit: "e6293ff2bc85123e9baaa998cf1543030ec5d9f0",
    assetSha256:
      "31765936eef9beca89298ffb554a658138932d505deebc6b65e02baa065c0660",
  };
  const sha256 = (value) =>
    crypto.createHash("sha256").update(value).digest("hex");
  const parseKdf = (kdf) => {
    const kdfKeys = Object.keys(kdf ?? {});
    let kdfId;
    if (
      kdfKeys.length === 1 &&
      kdfKeys[0] === "pBKDF2" &&
      kdf.pBKDF2?.iterations === 600000
    ) {
      kdfId = "pbkdf2";
    } else if (
      kdfKeys.length === 1 &&
      kdfKeys[0] === "argon2id" &&
      kdf.argon2id?.iterations === 3 &&
      kdf.argon2id?.memory === 64 &&
      kdf.argon2id?.parallelism === 4
    ) {
      kdfId = "argon2id";
    } else {
      throw new Error("official crypto bridge KDF was invalid");
    }
    return kdfId;
  };

  if (request.operation === "roundtrip") {
    if (
      typeof fixture.email !== "string" ||
      !fixture.email.endsWith("@example.invalid") ||
      typeof fixture.password !== "string" ||
      fixture.password.length < 24 ||
      typeof fixture.plaintext !== "string" ||
      fixture.plaintext.length < 24
    ) {
      throw new Error("official crypto bridge request was invalid");
    }
    const kdfId = parseKdf(fixture.kdf);
    const userKey = sdk.IEs.make_user_key_aes256_cbc_hmac();
    const wrappedUserKey = sdk.IEs.encrypt_user_key_with_master_password(
      userKey,
      fixture.password,
      fixture.email,
      fixture.kdf,
    );
    const decryptedUserKey = sdk.IEs.decrypt_user_key_with_master_password(
      wrappedUserKey,
      fixture.password,
      fixture.email,
      fixture.kdf,
    );
    const encryptedItem = sdk.IEs.symmetric_encrypt_string(
      fixture.plaintext,
      userKey,
    );
    const decryptedItem = sdk.IEs.symmetric_decrypt_string(
      encryptedItem,
      userKey,
    );
    const client = new sdk.cPU(
      { get_access_token: async () => undefined },
      null,
    );
    const cryptoClient = client.crypto();
    const keyPair = cryptoClient.make_key_pair(
      Buffer.from(userKey).toString("base64"),
    );
    const privateKey = sdk.IEs.unwrap_decapsulation_key(
      keyPair.userKeyEncryptedPrivateKey,
      userKey,
    );

    const userKeyRoundTrips =
      Buffer.compare(Buffer.from(userKey), Buffer.from(decryptedUserKey)) === 0;
    const itemRoundTrips = decryptedItem === fixture.plaintext;
    const privateKeyRoundTrips =
      privateKey instanceof Uint8Array && privateKey.length > 0;
    const response = {
      schemaVersion: 1,
      implementation: "upstream-cli-sdk-wasm",
      source,
      material: {
        userKey: Buffer.from(userKey).toString("base64"),
        wrappedUserKey,
        encryptedItem,
        userPublicKey: keyPair.userPublicKey,
        userKeyEncryptedPrivateKey: keyPair.userKeyEncryptedPrivateKey,
      },
      readback: {
        kdf: kdfId,
        userKeyBytes: userKey.length,
        wrappedUserKeyType: wrappedUserKey.split(".")[0],
        encryptedItemType: encryptedItem.split(".")[0],
        privateKeyType: keyPair.userKeyEncryptedPrivateKey.split(".")[0],
        userKeyRoundTrips,
        itemRoundTrips,
        privateKeyRoundTrips,
      },
      digests: {
        userKey: sha256(Buffer.from(userKey)),
        encryptedItem: sha256(encryptedItem),
        publicKey: sha256(keyPair.userPublicKey),
      },
    };
    cryptoClient.free();
    client.free();
    fs.writeFileSync(responsePath, JSON.stringify(response), {
      mode: 0o600,
      flag: "wx",
    });
    return;
  }

  if (request.operation !== "credential-fixture") {
    throw new Error("official crypto bridge request was invalid");
  }
  const email = fixture.email?.trim().toLowerCase();
  const passwords = fixture.passwords;
  const plaintext = fixture.plaintext;
  const plaintextFields = [
    "folderName",
    "itemName",
    "itemUsername",
    "itemPassword",
    "itemUri",
    "itemNotes",
    "attachmentFileName",
    "attachmentKey",
  ];
  if (
    typeof email !== "string" ||
    !email.endsWith("@example.invalid") ||
    !passwords ||
    !["baseline", "passwordChange", "userKeyRotation"].every(
      (key) => typeof passwords[key] === "string" && passwords[key].length >= 24,
    ) ||
    new Set(Object.values(passwords)).size !== 3 ||
    !plaintext ||
    !plaintextFields.every(
      (key) => typeof plaintext[key] === "string" && plaintext[key].length >= 8,
    )
  ) {
    throw new Error("official credential fixture request was invalid");
  }
  const attachmentKey = Buffer.from(plaintext.attachmentKey, "base64url");
  if (
    attachmentKey.length !== 64 ||
    attachmentKey.toString("base64url") !== plaintext.attachmentKey
  ) {
    throw new Error("official attachment key was invalid");
  }

  const pbkdf2 = { pBKDF2: { iterations: 600000 } };
  const argon2id = {
    argon2id: { iterations: 3, memory: 64, parallelism: 4 },
  };
  const initialUserKey = sdk.IEs.make_user_key_aes256_cbc_hmac();
  const rotatedUserKey = sdk.IEs.make_user_key_aes256_cbc_hmac();
  const client = new sdk.cPU(
    { get_access_token: async () => undefined },
    null,
  );
  const cryptoClient = client.crypto();
  const makeAccountKeys = (userKey) => {
    const pair = cryptoClient.make_key_pair(
      Buffer.from(userKey).toString("base64"),
    );
    const privateKey = sdk.IEs.unwrap_decapsulation_key(
      pair.userKeyEncryptedPrivateKey,
      userKey,
    );
    if (!(privateKey instanceof Uint8Array) || privateKey.length === 0) {
      throw new Error("official account key round trip failed");
    }
    return {
      accountKeys: {
        accountPublicKey: pair.userPublicKey,
        userKeyEncryptedAccountPrivateKey: pair.userKeyEncryptedPrivateKey,
      },
      privateKey,
    };
  };
  const encryptVault = (userKey) => {
    const encrypt = (value) => {
      const encrypted = sdk.IEs.symmetric_encrypt_string(value, userKey);
      if (sdk.IEs.symmetric_decrypt_string(encrypted, userKey) !== value) {
        throw new Error("official vault field round trip failed");
      }
      return encrypted;
    };
    const wrappedAttachmentKey = sdk.IEs.wrap_symmetric_key(
      attachmentKey,
      userKey,
    );
    const unwrappedAttachmentKey = sdk.IEs.unwrap_symmetric_key(
      wrappedAttachmentKey,
      userKey,
    );
    if (
      Buffer.compare(
        Buffer.from(attachmentKey),
        Buffer.from(unwrappedAttachmentKey),
      ) !== 0
    ) {
      throw new Error("official attachment key round trip failed");
    }
    return {
      folderName: encrypt(plaintext.folderName),
      cipher: {
        name: encrypt(plaintext.itemName),
        username: encrypt(plaintext.itemUsername),
        password: encrypt(plaintext.itemPassword),
        uri: encrypt(plaintext.itemUri),
        notes: encrypt(plaintext.itemNotes),
      },
      attachment: {
        fileName: encrypt(plaintext.attachmentFileName),
        key: wrappedAttachmentKey,
      },
    };
  };
  const initialPair = makeAccountKeys(initialUserKey);
  const initialAccountKeys = initialPair.accountKeys;
  const rotatedWrappedPrivateKey = sdk.IEs.wrap_decapsulation_key(
    initialPair.privateKey,
    rotatedUserKey,
  );
  const rotatedPrivateKey = sdk.IEs.unwrap_decapsulation_key(
    rotatedWrappedPrivateKey,
    rotatedUserKey,
  );
  if (
    Buffer.compare(
      Buffer.from(initialPair.privateKey),
      Buffer.from(rotatedPrivateKey),
    ) !== 0
  ) {
    throw new Error("official rotated account key round trip failed");
  }
  const rotatedAccountKeys = {
    accountPublicKey: initialAccountKeys.accountPublicKey,
    userKeyEncryptedAccountPrivateKey: rotatedWrappedPrivateKey,
  };
  const initialVault = encryptVault(initialUserKey);
  const rotatedVault = encryptVault(rotatedUserKey);
  const makeCredentialStage = ({
    id,
    password,
    kdf,
    userKey,
    accountKeys,
    vault,
    userKeyGeneration,
  }) => {
    const kdfId = parseKdf(kdf);
    const masterKey = sdk.IEs.derive_kdf_material(
      Buffer.from(password, "utf8"),
      Buffer.from(email, "utf8"),
      kdf,
    );
    const masterPasswordAuthenticationHash = crypto
      .pbkdf2Sync(
        Buffer.from(masterKey),
        Buffer.from(password, "utf8"),
        1,
        32,
        "sha256",
      )
      .toString("base64");
    const masterKeyEncryptedUserKey =
      sdk.IEs.encrypt_user_key_with_master_password(
        userKey,
        password,
        email,
        kdf,
      );
    const unwrapped = sdk.IEs.decrypt_user_key_with_master_password(
      masterKeyEncryptedUserKey,
      password,
      email,
      kdf,
    );
    if (Buffer.compare(Buffer.from(userKey), Buffer.from(unwrapped)) !== 0) {
      throw new Error("official credential user key round trip failed");
    }
    const userKeyDigest = sha256(Buffer.from(userKey));
    const vaultDigest = sha256(JSON.stringify(vault));
    return {
      id,
      password,
      kdf,
      kdfId,
      userKeyGeneration,
      masterPasswordAuthenticationHash,
      masterKeyEncryptedUserKey,
      accountKeys,
      vault,
      digests: {
        userKey: userKeyDigest,
        wrappedUserKey: sha256(masterKeyEncryptedUserKey),
        accountKeys: sha256(JSON.stringify(accountKeys)),
        vault: vaultDigest,
        credential: sha256(
          [
            masterPasswordAuthenticationHash,
            masterKeyEncryptedUserKey,
            accountKeys.accountPublicKey,
            accountKeys.userKeyEncryptedAccountPrivateKey,
          ].join("\n"),
        ),
      },
    };
  };
  const credentialStages = [
    makeCredentialStage({
      id: "baseline",
      password: passwords.baseline,
      kdf: pbkdf2,
      userKey: initialUserKey,
      accountKeys: initialAccountKeys,
      vault: initialVault,
      userKeyGeneration: 1,
    }),
    makeCredentialStage({
      id: "password_change",
      password: passwords.passwordChange,
      kdf: pbkdf2,
      userKey: initialUserKey,
      accountKeys: initialAccountKeys,
      vault: initialVault,
      userKeyGeneration: 1,
    }),
    makeCredentialStage({
      id: "argon2id",
      password: passwords.passwordChange,
      kdf: argon2id,
      userKey: initialUserKey,
      accountKeys: initialAccountKeys,
      vault: initialVault,
      userKeyGeneration: 1,
    }),
    makeCredentialStage({
      id: "pbkdf2_return",
      password: passwords.passwordChange,
      kdf: pbkdf2,
      userKey: initialUserKey,
      accountKeys: initialAccountKeys,
      vault: initialVault,
      userKeyGeneration: 1,
    }),
    makeCredentialStage({
      id: "user_key_rotation",
      password: passwords.userKeyRotation,
      kdf: pbkdf2,
      userKey: rotatedUserKey,
      accountKeys: rotatedAccountKeys,
      vault: rotatedVault,
      userKeyGeneration: 2,
    }),
  ];
  const response = {
    schemaVersion: 1,
    operation: "credential-fixture",
    implementation: "upstream-cli-sdk-wasm",
    source,
    material: {
      email,
      plaintext,
      credentialStages,
    },
    readback: {
      sameAccount: true,
      stages: credentialStages.map((stage) => ({
        id: stage.id,
        kdf: stage.kdfId,
        userKeyGeneration: stage.userKeyGeneration,
        credentialDigest: stage.digests.credential,
        wrappedUserKeyDigest: stage.digests.wrappedUserKey,
        vaultDigest: stage.digests.vault,
      })),
      sharedInitialUserKey: credentialStages
        .slice(0, 4)
        .every(
          (stage) =>
            stage.digests.userKey === credentialStages[0].digests.userKey,
        ),
      rotatedUserKeyDistinct:
        credentialStages[4].digests.userKey !==
        credentialStages[0].digests.userKey,
    },
  };
  cryptoClient.free();
  client.free();
  fs.writeFileSync(responsePath, JSON.stringify(response), {
    mode: 0o600,
    flag: "wx",
  });
  return;
}`
}

function validateCryptoResponse(response, id) {
  const kdfId =
    id === 'pbkdf2' ? 'pbkdf2' : id === 'argon2id' ? 'argon2id' : null
  if (
    !kdfId ||
    response?.schemaVersion !== schemaVersion ||
    response?.implementation !== 'upstream-cli-sdk-wasm' ||
    response?.source?.tag !== officialClientPins.cli.tag ||
    response?.source?.commit !== officialClientPins.cli.commit ||
    response?.source?.assetSha256 !== officialClientAssets.cliNpm.sha256 ||
    response?.readback?.kdf !== kdfId ||
    response?.readback?.userKeyBytes !== 64 ||
    response?.readback?.wrappedUserKeyType !== '2' ||
    response?.readback?.encryptedItemType !== '2' ||
    response?.readback?.privateKeyType !== '2' ||
    response?.readback?.userKeyRoundTrips !== true ||
    response?.readback?.itemRoundTrips !== true ||
    response?.readback?.privateKeyRoundTrips !== true ||
    !isSha256(response?.digests?.userKey) ||
    !isSha256(response?.digests?.encryptedItem) ||
    !isSha256(response?.digests?.publicKey)
  ) {
    throw new Error(`official crypto ${id} response was invalid`)
  }
  for (const value of Object.values(response.material ?? {})) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`official crypto ${id} material was invalid`)
    }
  }
}

function validateCredentialFixtureResponse(response) {
  const stages = response?.material?.credentialStages
  const readbackStages = response?.readback?.stages
  const expectedStages = [
    ['baseline', 'pbkdf2', 1],
    ['password_change', 'pbkdf2', 1],
    ['argon2id', 'argon2id', 1],
    ['pbkdf2_return', 'pbkdf2', 1],
    ['user_key_rotation', 'pbkdf2', 2],
  ]
  if (
    response?.schemaVersion !== schemaVersion ||
    response?.operation !== 'credential-fixture' ||
    response?.implementation !== 'upstream-cli-sdk-wasm' ||
    response?.source?.tag !== officialClientPins.cli.tag ||
    response?.source?.commit !== officialClientPins.cli.commit ||
    response?.source?.assetSha256 !== officialClientAssets.cliNpm.sha256 ||
    typeof response?.material?.email !== 'string' ||
    !response.material.email.endsWith('@example.invalid') ||
    !Array.isArray(stages) ||
    stages.length !== expectedStages.length ||
    !Array.isArray(readbackStages) ||
    readbackStages.length !== expectedStages.length ||
    response?.readback?.sameAccount !== true ||
    response?.readback?.sharedInitialUserKey !== true ||
    response?.readback?.rotatedUserKeyDistinct !== true
  ) {
    throw new Error('official credential fixture response was invalid')
  }
  for (let index = 0; index < expectedStages.length; index += 1) {
    const [id, kdf, userKeyGeneration] = expectedStages[index]
    const stage = stages[index]
    const stageReadback = readbackStages[index]
    if (
      stage?.id !== id ||
      stage?.kdfId !== kdf ||
      stage?.userKeyGeneration !== userKeyGeneration ||
      stageReadback?.id !== id ||
      stageReadback?.kdf !== kdf ||
      stageReadback?.userKeyGeneration !== userKeyGeneration ||
      typeof stage?.password !== 'string' ||
      stage.password.length < 24 ||
      typeof stage?.masterPasswordAuthenticationHash !== 'string' ||
      stage.masterPasswordAuthenticationHash.length === 0 ||
      typeof stage?.masterKeyEncryptedUserKey !== 'string' ||
      !stage.masterKeyEncryptedUserKey.startsWith('2.') ||
      typeof stage?.accountKeys?.accountPublicKey !== 'string' ||
      typeof stage?.accountKeys?.userKeyEncryptedAccountPrivateKey !==
        'string' ||
      !stage.accountKeys.userKeyEncryptedAccountPrivateKey.startsWith('2.') ||
      !credentialVaultIsValid(stage.vault) ||
      Object.values(stage?.digests ?? {}).some((digest) => !isSha256(digest)) ||
      !isSha256(stageReadback?.credentialDigest) ||
      !isSha256(stageReadback?.wrappedUserKeyDigest) ||
      !isSha256(stageReadback?.vaultDigest)
    ) {
      throw new Error('official credential fixture stage was invalid')
    }
  }
  const plaintext = response.material.plaintext
  for (const key of [
    'folderName',
    'itemName',
    'itemUsername',
    'itemPassword',
    'itemUri',
    'itemNotes',
    'attachmentFileName',
    'attachmentKey',
  ]) {
    if (typeof plaintext?.[key] !== 'string' || plaintext[key].length < 8) {
      throw new Error('official credential fixture plaintext was invalid')
    }
  }
  if (
    stages[0].password === stages[1].password ||
    stages[1].password !== stages[2].password ||
    stages[2].password !== stages[3].password ||
    stages[3].password === stages[4].password ||
    stages
      .slice(0, 4)
      .some(
        (stage) =>
          stage.digests.userKey !== stages[0].digests.userKey ||
          stage.digests.vault !== stages[0].digests.vault,
      ) ||
    stages[4].digests.userKey === stages[0].digests.userKey ||
    stages[4].digests.vault === stages[0].digests.vault ||
    stages[4].accountKeys.accountPublicKey !==
      stages[0].accountKeys.accountPublicKey ||
    stages[4].accountKeys.userKeyEncryptedAccountPrivateKey ===
      stages[0].accountKeys.userKeyEncryptedAccountPrivateKey
  ) {
    throw new Error('official credential fixture generation chain was invalid')
  }
}

function credentialVaultIsValid(vault) {
  return [
    vault?.folderName,
    vault?.cipher?.name,
    vault?.cipher?.username,
    vault?.cipher?.password,
    vault?.cipher?.uri,
    vault?.cipher?.notes,
    vault?.attachment?.fileName,
    vault?.attachment?.key,
  ].every((value) => typeof value === 'string' && value.startsWith('2.'))
}

export async function runCapturedProcess(
  command,
  args,
  { cwd, env, outputDirectory, timeoutMs, label },
) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300_000) {
    throw new Error('captured process timeout was invalid')
  }
  if (!/^[A-Za-z0-9._-]+$/.test(label)) {
    throw new Error('captured process label was invalid')
  }
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 })
  const stdoutPath = join(outputDirectory, `${label}.stdout.log`)
  const stderrPath = join(outputDirectory, `${label}.stderr.log`)
  const stdoutHandle = await open(stdoutPath, 'wx', 0o600)
  let stderrHandle
  try {
    stderrHandle = await open(stderrPath, 'wx', 0o600)
  } catch (error) {
    await stdoutHandle.close()
    throw error
  }

  let timeoutTimer = null
  let removeSignalCleanup = () => undefined
  let result
  try {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      stdio: ['ignore', stdoutHandle.fd, stderrHandle.fd],
    })
    const closePromise = new Promise((resolveRun, rejectRun) => {
      child.once('error', rejectRun)
      child.once('close', (exitCode, signal) => {
        resolveRun({ exitCode, signal })
      })
    })
    removeSignalCleanup = installSignalCleanup(async () => {
      await terminateProcessGroup(child.pid)
      await closePromise.catch(() => undefined)
    })
    const timeoutPromise = new Promise((resolveTimeout) => {
      timeoutTimer = setTimeout(() => {
        resolveTimeout({ timedOut: true })
      }, timeoutMs)
      timeoutTimer.unref()
    })
    const first = await Promise.race([
      closePromise.then((closed) => ({ closed })),
      timeoutPromise,
    ])
    if ('timedOut' in first) {
      await terminateProcessGroup(child.pid)
      const closed = await closePromise
      result = { ...closed, timedOut: true }
    } else {
      result = { ...first.closed, timedOut: false }
      if (await processGroupExists(child.pid)) {
        await terminateProcessGroup(child.pid)
      }
    }
  } finally {
    removeSignalCleanup()
    if (timeoutTimer) clearTimeout(timeoutTimer)
    await Promise.all([stdoutHandle.close(), stderrHandle.close()])
  }

  return {
    ...result,
    stdout: await capturedFileSummary(stdoutPath),
    stderr: await capturedFileSummary(stderrPath),
  }
}

async function terminateProcessGroup(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return
  signalProcessGroup(pid, 'SIGTERM')
  if (await waitForProcessGroupExit(pid, 1_000)) return
  signalProcessGroup(pid, 'SIGKILL')
  if (!(await waitForProcessGroupExit(pid, 2_000))) {
    throw new Error('captured process group did not terminate')
  }
}

async function waitForProcessGroupExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await processGroupExists(pid))) return true
    await delay(50)
  }
  return !(await processGroupExists(pid))
}

async function processGroupExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    if (error?.code === 'EPERM') return true
    throw error
  }
}

function signalProcessGroup(pid, signal) {
  if (!Number.isInteger(pid) || pid <= 0) return
  try {
    process.kill(-pid, signal)
  } catch (error) {
    if (!['EPERM', 'ESRCH'].includes(error?.code)) throw error
  }
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds)
  })
}

async function capturedFileSummary(path) {
  const bytes = await readFile(path)
  return {
    file: basename(path),
    bytes: bytes.length,
    sha256: sha256(bytes),
  }
}

async function readCapturedFile(outputDirectory, summary) {
  const bytes = await readFile(join(outputDirectory, summary.file))
  if (bytes.length !== summary.bytes || sha256(bytes) !== summary.sha256) {
    throw new Error('captured process output changed before readback')
  }
  return bytes
}

export function resolveHarnessRoot(value) {
  const absolute = isAbsolute(value) ? resolve(value) : resolve(repoRoot, value)
  const insideFixtureRoot = relative(fixtureRoot, absolute)
  if (
    insideFixtureRoot.length === 0 ||
    insideFixtureRoot === '..' ||
    insideFixtureRoot.startsWith(`..${sep}`) ||
    isAbsolute(insideFixtureRoot)
  ) {
    throw new Error('root must be inside test/.tmp')
  }
  return {
    absolute,
    relative: relative(repoRoot, absolute),
    insideFixtureRoot,
  }
}

export async function validateHarnessRoot(root) {
  await mkdir(fixtureRoot, { recursive: true, mode: 0o700 })
  const [resolvedRepo, resolvedFixtureRoot] = await Promise.all([
    realpath(repoRoot),
    realpath(fixtureRoot),
  ])
  if (resolvedFixtureRoot !== join(resolvedRepo, 'test/.tmp')) {
    throw new Error('test/.tmp must not be a symlink')
  }

  let current = resolvedFixtureRoot
  for (const component of root.insideFixtureRoot.split(sep)) {
    current = join(current, component)
    if (!(await exists(current))) continue
    await rejectSymlink(current, 'harness root must not contain symlinks')
  }
}

export async function validateHarnessDirectories(root) {
  const resolvedRoot = await realpath(root.absolute)
  for (const directory of [
    'assets',
    'crypto',
    'native',
    'profile',
    'home',
    'tmp',
    'requests',
    'responses',
    'output',
  ]) {
    const path = join(root.absolute, directory)
    await rejectSymlink(
      path,
      `harness ${directory} directory must not be a symlink`,
    )
    const info = await lstat(path)
    if (!info.isDirectory()) {
      throw new Error(`harness ${directory} path must be a directory`)
    }
    if ((info.mode & 0o777) !== 0o700) {
      throw new Error(`harness ${directory} directory permissions must be 0700`)
    }
    const resolvedPath = await realpath(path)
    const pathFromRoot = relative(resolvedRoot, resolvedPath)
    if (
      pathFromRoot === '..' ||
      pathFromRoot.startsWith(`..${sep}`) ||
      isAbsolute(pathFromRoot)
    ) {
      throw new Error(`harness ${directory} directory escaped the root`)
    }
    if (mutableHarnessDirectories.includes(directory)) {
      await validateMutableHarnessTree(path, directory)
    }
  }
}

async function validateMutableHarnessTree(directory, name) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const info = await lstat(path)
    if (info.isSymbolicLink()) {
      throw new Error(`harness ${name} tree must not contain symlinks`)
    }
    if (info.isDirectory()) {
      if ((info.mode & 0o777) !== 0o700) {
        throw new Error(
          `harness ${name} nested directory permissions must be 0700`,
        )
      }
      await validateMutableHarnessTree(path, name)
      continue
    }
    if (!info.isFile()) {
      throw new Error(`harness ${name} tree contained a special file`)
    }
    if ((info.mode & 0o777) !== 0o600) {
      throw new Error(`harness ${name} file permissions must be 0600`)
    }
  }
}

async function downloadPinnedAsset(asset) {
  let response
  try {
    response = await globalThis.fetch(asset.url, {
      redirect: 'follow',
      headers: {
        Accept: 'application/octet-stream',
        'User-Agent': 'HonoWarden-official-client-harness',
      },
      signal: globalThis.AbortSignal.timeout(120_000),
    })
  } catch {
    throw new Error(`${asset.name} official asset download failed`)
  }
  if (!response.ok) {
    throw new Error(`${asset.name} official asset download failed`)
  }
  return Buffer.from(await response.arrayBuffer())
}

async function validatePinnedArchiveEntries(archivePath, archiveKey) {
  const expected = Object.values(officialRuntimeFileManifest)
    .filter((metadata) => metadata.archive === archiveKey)
    .map((metadata) => metadata.entry)
    .sort()
  const actual = (await listArchiveEntries(archivePath)).sort()
  if (
    expected.length === 0 ||
    actual.length !== expected.length ||
    actual.some((entry, index) => entry !== expected[index])
  ) {
    throw new Error(
      'official archive entries did not match the pinned manifest',
    )
  }
}

async function extractPinnedArchive(archivePath, destination) {
  const entries = await listArchiveEntries(archivePath)
  if (entries.length === 0) throw new Error('official archive was empty')
  for (const entry of entries) {
    if (
      entry.startsWith('/') ||
      entry.includes('\\') ||
      entry.split('/').some((component) => component === '..')
    ) {
      throw new Error('official archive contained an unsafe path')
    }
  }
  const ditto = '/usr/bin/ditto'
  if (await exists(ditto)) {
    await runTextCommand(ditto, ['-x', '-k', archivePath, destination])
    return
  }
  await runTextCommand('unzip', ['-q', archivePath, '-d', destination])
}

async function listArchiveEntries(archivePath) {
  const result = await runTextCommand('unzip', ['-Z1', archivePath])
  return result.stdout.split('\n').filter(Boolean)
}

async function normalizeRuntimeFileModes(rootAbsolute, manifest) {
  for (const [relativePath, metadata] of Object.entries(manifest)) {
    const components = validateManifestPath(relativePath)
    let parent = rootAbsolute
    for (const component of components.slice(0, -1)) {
      parent = join(parent, component)
      await rejectSymlink(
        parent,
        'prepared runtime directory must not be a symlink',
      )
      const info = await lstat(parent)
      if (!info.isDirectory()) {
        throw new Error('prepared runtime parent was not a directory')
      }
      await chmod(parent, 0o700)
    }
    const path = join(rootAbsolute, ...components)
    await validateExtractedFile(path)
    await chmod(path, metadata.mode)
  }
}

export async function validateRuntimeFileManifest(rootAbsolute, manifest) {
  const expectedEntries = Object.entries(manifest)
    .map(([relativePath, metadata]) => {
      validateManifestPath(relativePath)
      if (
        !Number.isInteger(metadata?.bytes) ||
        metadata.bytes < 0 ||
        !isSha256(metadata?.sha256) ||
        ![0o600, 0o700].includes(metadata?.mode)
      ) {
        throw new Error('prepared runtime manifest was invalid')
      }
      return [relativePath, metadata]
    })
    .sort(([left], [right]) => left.localeCompare(right))
  if (expectedEntries.length === 0) {
    throw new Error('prepared runtime manifest was empty')
  }

  const expectedPaths = new Set(expectedEntries.map(([path]) => path))
  const roots = [
    ...new Set(expectedEntries.map(([path]) => path.split('/')[0])),
  ].sort()
  const actualPaths = []
  for (const rootName of roots) {
    await collectRuntimeFiles(
      rootAbsolute,
      rootName,
      join(rootAbsolute, rootName),
      actualPaths,
    )
  }
  actualPaths.sort()
  if (
    actualPaths.length !== expectedPaths.size ||
    actualPaths.some((path) => !expectedPaths.has(path))
  ) {
    throw new Error('prepared runtime file set did not match its manifest')
  }

  const canonicalEntries = []
  for (const [relativePath, metadata] of expectedEntries) {
    const path = join(rootAbsolute, ...relativePath.split('/'))
    await rejectSymlink(path, 'prepared runtime file must not be a symlink')
    const info = await lstat(path)
    const bytes = await readFile(path)
    const mode = info.mode & 0o777
    const digest = sha256(bytes)
    if (
      !info.isFile() ||
      info.size !== metadata.bytes ||
      bytes.length !== metadata.bytes ||
      digest !== metadata.sha256 ||
      mode !== metadata.mode
    ) {
      throw new Error('prepared runtime file did not match its pinned archive')
    }
    canonicalEntries.push({
      path: relativePath,
      bytes: metadata.bytes,
      sha256: metadata.sha256,
      mode: metadata.mode,
    })
  }

  return {
    files: canonicalEntries.length,
    manifestSha256: sha256(JSON.stringify(canonicalEntries)),
  }
}

function validateManifestPath(relativePath) {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    isAbsolute(relativePath)
  ) {
    throw new Error('prepared runtime manifest path was invalid')
  }
  const components = relativePath.split('/')
  if (
    components.length < 2 ||
    components.some(
      (component) =>
        component.length === 0 || component === '.' || component === '..',
    )
  ) {
    throw new Error('prepared runtime manifest path was invalid')
  }
  return components
}

async function collectRuntimeFiles(rootAbsolute, rootName, directory, paths) {
  await rejectSymlink(
    directory,
    'prepared runtime directory must not be a symlink',
  )
  const directoryInfo = await lstat(directory)
  if (!directoryInfo.isDirectory() || (directoryInfo.mode & 0o777) !== 0o700) {
    throw new Error('prepared runtime directory permissions must be 0700')
  }

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const info = await lstat(path)
    if (info.isSymbolicLink()) {
      throw new Error('prepared runtime tree must not contain symlinks')
    }
    if (info.isDirectory()) {
      await collectRuntimeFiles(rootAbsolute, rootName, path, paths)
      continue
    }
    if (!info.isFile()) {
      throw new Error('prepared runtime tree contained a special file')
    }
    const relativePath = relative(rootAbsolute, path).split(sep).join('/')
    if (!relativePath.startsWith(`${rootName}/`)) {
      throw new Error('prepared runtime file escaped its root')
    }
    paths.push(relativePath)
  }
}

function runTextCommand(command, args) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', () => undefined)
    child.once('error', rejectCommand)
    child.once('close', (code) => {
      if (code === 0) resolveCommand({ stdout })
      else rejectCommand(new Error(`${basename(command)} failed`))
    })
  })
}

async function validateExtractedFile(path) {
  await rejectSymlink(path, 'official asset entry must not be a symlink')
  const info = await lstat(path)
  if (!info.isFile()) throw new Error('official asset entry was not a file')
}

function requireSupportedNativePlatform() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('the pinned native CLI runner requires macOS arm64')
  }
}

export function isolatedClientEnvironment(
  root,
  sourceEnvironment = process.env,
  profile = null,
) {
  const profileName = validateOfficialProfileName(profile)
  const profilePath = profileName
    ? join(root.absolute, 'profile', profileName)
    : join(root.absolute, 'profile')
  const homePath = profileName
    ? join(root.absolute, 'home', profileName)
    : join(root.absolute, 'home')
  const temporaryPath = profileName
    ? join(root.absolute, 'tmp', profileName)
    : join(root.absolute, 'tmp')
  const environment = {}
  for (const key of [
    'LANG',
    'LC_ALL',
    'NODE_EXTRA_CA_CERTS',
    'PATH',
    'SSL_CERT_FILE',
  ]) {
    if (sourceEnvironment[key] !== undefined) {
      environment[key] = sourceEnvironment[key]
    }
  }
  for (const [source, target] of [
    ['HONOWARDEN_SYNTHETIC_BW_PASSWORD', 'BW_PASSWORD'],
    ['HONOWARDEN_SYNTHETIC_BW_SESSION', 'BW_SESSION'],
  ]) {
    if (sourceEnvironment[source] !== undefined) {
      environment[target] = sourceEnvironment[source]
    }
  }
  environment.BW_NOINTERACTION = 'true'
  environment.HOME = homePath
  environment.TMPDIR = temporaryPath
  environment[cliAppDataEnvironment] = profilePath
  return environment
}

export function validateOfficialProfileName(value) {
  if (value === undefined || value === null) return null
  if (
    typeof value !== 'string' ||
    !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(value)
  ) {
    throw new Error('official CLI profile name was invalid')
  }
  return value
}

export async function ensureOfficialProfileDirectories(root, profile) {
  const profileName = validateOfficialProfileName(profile)
  await validateHarnessRoot(root)
  const resolvedRoot = await realpath(root.absolute)
  for (const directory of ['profile', 'home', 'tmp']) {
    const basePath = join(root.absolute, directory)
    await mkdir(basePath, { mode: 0o700 }).catch((error) => {
      if (error?.code !== 'EEXIST') throw error
    })
    await validatePrivateProfileDirectory(
      basePath,
      resolvedRoot,
      `official CLI ${directory} directory`,
    )
    if (!profileName) continue

    const profileDirectoryPath = join(basePath, profileName)
    await mkdir(profileDirectoryPath, { mode: 0o700 }).catch((error) => {
      if (error?.code !== 'EEXIST') throw error
    })
    await validatePrivateProfileDirectory(
      profileDirectoryPath,
      resolvedRoot,
      `official CLI ${directory} profile directory`,
    )
  }
  const profilePath = officialCliProfileDataPath(root, profileName)
  try {
    await writeFile(profilePath, '{}\n', {
      flag: 'wx',
      mode: 0o600,
    })
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
  }
  await rejectSymlink(profilePath, officialCliProfileConfigurationError)
  const info = await lstat(profilePath)
  if (!info.isFile() || (info.mode & 0o777) !== 0o600) {
    throw new Error(officialCliProfileConfigurationError)
  }
}

export async function cloneOfficialProfile(root, sourceProfile, targetProfile) {
  const sourceName = validateOfficialProfileName(sourceProfile)
  const targetName = validateOfficialProfileName(targetProfile)
  if (!sourceName || !targetName || sourceName === targetName) {
    throw new Error('official CLI clone profiles were invalid')
  }

  await ensureOfficialProfileDirectories(root, sourceName)
  const resolvedRoot = await realpath(root.absolute)
  const directories = ['profile', 'home', 'tmp']
  const sourcePaths = directories.map((directory) => ({
    directory,
    path: join(root.absolute, directory, sourceName),
  }))
  const targetPaths = directories.map((directory) => ({
    directory,
    path: join(root.absolute, directory, targetName),
  }))

  for (const source of sourcePaths) {
    await validatePrivateProfileDirectory(
      source.path,
      resolvedRoot,
      `official CLI ${source.directory} clone source`,
    )
    await validateMutableHarnessTree(source.path, source.directory)
  }
  if (
    (await Promise.all(targetPaths.map((target) => exists(target.path)))).some(
      Boolean,
    )
  ) {
    throw new Error('official CLI clone target already exists')
  }

  try {
    for (const directory of ['profile', 'home']) {
      await cp(
        join(root.absolute, directory, sourceName),
        join(root.absolute, directory, targetName),
        { errorOnExist: true, force: false, recursive: true },
      )
    }
    await mkdir(join(root.absolute, 'tmp', targetName), { mode: 0o700 })

    for (const target of targetPaths) {
      await validatePrivateProfileDirectory(
        target.path,
        resolvedRoot,
        `official CLI ${target.directory} clone target`,
      )
      await validateMutableHarnessTree(target.path, target.directory)
    }
  } catch (error) {
    const cleanup = await Promise.allSettled(
      targetPaths.map((target) =>
        rm(target.path, { recursive: true, force: true }),
      ),
    )
    const cleanupErrors = cleanup
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason)
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        'official CLI profile clone cleanup failed',
        { cause: error },
      )
    }
    throw error
  }
}

async function validatePrivateProfileDirectory(path, resolvedRoot, label) {
  const info = await lstat(path)
  if (info.isSymbolicLink()) {
    throw new Error(`${label} must not be a symlink`)
  }
  if (!info.isDirectory()) {
    throw new Error(`${label} must be a directory`)
  }
  if ((info.mode & 0o777) !== 0o700) {
    throw new Error(`${label} permissions must be 0700`)
  }
  const resolvedPath = await realpath(path)
  const insideRoot = relative(resolvedRoot, resolvedPath)
  if (
    insideRoot === '..' ||
    insideRoot.startsWith(`..${sep}`) ||
    isAbsolute(insideRoot)
  ) {
    throw new Error(`${label} escaped the harness root`)
  }
}

export function validateOfficialCliArgs(args) {
  if (!Array.isArray(args) || args.length === 0) {
    throw new Error('cli-run requires arguments after --')
  }
  if (
    args.some(
      (arg) =>
        typeof arg !== 'string' ||
        arg.length === 0 ||
        [...arg].some((character) => {
          const codePoint = character.codePointAt(0)
          return codePoint <= 0x1f || codePoint === 0x7f
        }),
    )
  ) {
    throw new Error(
      'official CLI arguments violate the synthetic-only harness contract',
    )
  }
  const allowedCommands = new Set([
    '--version',
    'get',
    'list',
    'lock',
    'login',
    'logout',
    'status',
    'sync',
    'unlock',
  ])
  if (!allowedCommands.has(args[0])) {
    throw new Error('official CLI command is not allowed by the harness')
  }
  const secretFlags = new Set([
    '--apikey',
    '--clientsecret',
    '--password',
    '--session',
  ])
  for (const arg of args) {
    const flag = arg.split('=', 1)[0].toLowerCase()
    if (secretFlags.has(flag)) {
      throw new Error(
        'pass official CLI secrets through HONOWARDEN_SYNTHETIC_BW_* environment variables',
      )
    }
  }

  const command = args[0]
  let valid = false
  switch (command) {
    case '--version':
    case 'lock':
    case 'logout':
    case 'status':
      valid = args.length === 1
      break
    case 'login':
      valid = validatePasswordEnvironmentArgs(args.slice(1), true)
      break
    case 'unlock':
      valid =
        (args.length === 2 && args[1] === '--check') ||
        validatePasswordEnvironmentArgs(args.slice(1), false)
      break
    case 'get':
      valid =
        args.length === 3 &&
        args[1] === 'item' &&
        (/^fixture-[A-Za-z0-9._:-]{1,192}$/.test(args[2]) ||
          /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
            args[2],
          ))
      break
    case 'list':
      valid = args.length === 2 && args[1] === 'items'
      break
    case 'sync':
      valid =
        args.length === 1 ||
        (args.length === 2 && ['--force', '--last'].includes(args[1]))
      break
  }
  if (!valid) {
    throw new Error(
      'official CLI arguments violate the synthetic-only harness contract',
    )
  }
}

function validatePasswordEnvironmentArgs(args, requiresEmail) {
  let emailSeen = false
  let passwordEnvironmentSeen = false
  const switches = new Set()
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--passwordenv') {
      if (passwordEnvironmentSeen || args[index + 1] !== 'BW_PASSWORD') {
        return false
      }
      passwordEnvironmentSeen = true
      index += 1
      continue
    }
    if (arg === '--raw' || arg === '--nointeraction') {
      if (switches.has(arg)) return false
      switches.add(arg)
      continue
    }
    if (
      requiresEmail &&
      !emailSeen &&
      /^[^@\s]+@example\.invalid$/i.test(arg)
    ) {
      emailSeen = true
      continue
    }
    return false
  }
  return passwordEnvironmentSeen && (!requiresEmail || emailSeen)
}

export function validateLoopbackOrigin(value) {
  if (!value) {
    throw new Error('cli-run requires --origin with a loopback URL')
  }
  let origin
  try {
    origin = new globalThis.URL(value)
  } catch {
    throw new Error('--origin must be a valid loopback URL')
  }
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    !['127.0.0.1', '::1', '[::1]', 'localhost'].includes(origin.hostname) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  ) {
    throw new Error('--origin must be an origin-only loopback URL')
  }
  return origin.origin
}

export function requiresOfficialCliServerUpdate(currentValue, requestedValue) {
  const requestedOrigin = validateLoopbackOrigin(requestedValue)
  const current = currentValue.trim()
  if (!current) return true

  let currentOrigin
  try {
    currentOrigin = new globalThis.URL(current)
  } catch {
    throw new Error('official CLI returned an invalid server configuration')
  }
  if (
    !['http:', 'https:'].includes(currentOrigin.protocol) ||
    currentOrigin.username ||
    currentOrigin.password ||
    currentOrigin.pathname !== '/' ||
    currentOrigin.search ||
    currentOrigin.hash
  ) {
    throw new Error('official CLI returned an invalid server configuration')
  }
  return currentOrigin.origin !== requestedOrigin
}

export function validateOfficialCliProfileEnvironment(profile, requestedValue) {
  const requestedOrigin = validateLoopbackOrigin(requestedValue)
  if (!isObjectRecord(profile)) {
    throw new Error(officialCliProfileConfigurationError)
  }

  const environments = [
    profile.global_environment_environment,
    ...Object.entries(profile)
      .filter(
        ([key]) =>
          key.startsWith('user_') && key.endsWith('_environment_environment'),
      )
      .map(([, environment]) => environment),
  ]
  if (
    environments.some((environment) => {
      if (
        !isObjectRecord(environment) ||
        environment.region !== 'Self-hosted'
      ) {
        return true
      }
      const urls = environment.urls
      return (
        !isObjectRecord(urls) ||
        urls.base !== requestedOrigin ||
        officialCliServiceOverrides.some((key) => urls[key] != null)
      )
    })
  ) {
    throw new Error(officialCliProfileConfigurationError)
  }

  return {
    baseMatches: true,
    customEndpoints: false,
  }
}

async function readOfficialCliProfileEnvironment(
  root,
  requestedOrigin,
  profile,
) {
  const profilePath = officialCliProfileDataPath(root, profile)
  try {
    await rejectSymlink(profilePath, officialCliProfileConfigurationError)
    const info = await lstat(profilePath)
    if (!info.isFile() || (info.mode & 0o777) !== 0o600) {
      throw new Error(officialCliProfileConfigurationError)
    }
    const profile = JSON.parse(await readFile(profilePath, 'utf8'))
    return validateOfficialCliProfileEnvironment(profile, requestedOrigin)
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === officialCliProfileConfigurationError
    ) {
      throw error
    }
    throw new Error(officialCliProfileConfigurationError, { cause: error })
  }
}

function officialCliProfileDataPath(root, profile) {
  return profile
    ? join(root.absolute, 'profile', profile, 'data.json')
    : join(root.absolute, 'profile', 'data.json')
}

async function clearClipboard() {
  if (process.platform !== 'darwin') return
  await new Promise((resolveClipboard, rejectClipboard) => {
    const child = spawn('pbcopy', [], {
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    child.once('error', rejectClipboard)
    child.once('close', (code) => {
      if (code === 0) resolveClipboard()
      else rejectClipboard(new Error('clipboard cleanup failed'))
    })
    child.stdin.end()
  })
}

function parseOptions(args) {
  const options = { passthrough: [] }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--') {
      options.passthrough = args.slice(index + 1)
      break
    }
    if (arg === '--execute') {
      options.execute = true
      continue
    }
    if (
      arg === '--root' ||
      arg === '--confirm' ||
      arg === '--at' ||
      arg === '--origin' ||
      arg === '--profile' ||
      arg === '--timeout-ms'
    ) {
      const value = args[index + 1]
      if (!value) throw new Error(`${arg} requires a value`)
      const key = arg === '--timeout-ms' ? 'timeoutMs' : arg.slice(2)
      options[key] = value
      index += 1
      continue
    }
    throw new Error('unknown harness option')
  }
  return options
}

function buildExecutionCommand(action, options, root, generatedAt, timeoutMs) {
  const timestamp = ` --at ${shellQuote(generatedAt)}`
  const timeout =
    timeoutMs === undefined ? '' : ` --timeout-ms ${String(timeoutMs)}`
  const origin = options.origin ? ` --origin ${shellQuote(options.origin)}` : ''
  const profile = options.profile
    ? ` --profile ${shellQuote(options.profile)}`
    : ''
  const passthrough =
    options.passthrough.length > 0
      ? ` -- ${options.passthrough.map(shellQuote).join(' ')}`
      : ''
  return `pnpm client:official-harness -- ${action} --root ${shellQuote(root.relative)}${timestamp}${timeout}${origin}${profile} --execute --confirm ${confirmation}${passthrough}`
}

function requireConfirmation(options) {
  if (options.confirm !== confirmation) {
    throw new Error(`--confirm ${confirmation} is required before --execute`)
  }
}

function parseTimestamp(value) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) throw new Error('--at must be ISO-8601')
  return date.toISOString()
}

function parseTimeout(value, defaultValue) {
  if (value === undefined) return defaultValue
  if (!/^[0-9]+$/.test(value))
    throw new Error('--timeout-ms must be an integer')
  const parsed = Number(value)
  if (parsed < 100 || parsed > 300_000) {
    throw new Error('--timeout-ms must be between 100 and 300000')
  }
  return parsed
}

function shellQuote(value) {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`
}

function countOccurrences(value, needle) {
  return value.split(needle).length - 1
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function isObjectRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function readMode(path) {
  return ((await stat(path)).mode & 0o777).toString(8).padStart(4, '0')
}

async function requireMode(path, expected, label) {
  const actual = (await stat(path)).mode & 0o777
  if (actual !== expected) {
    throw new Error(
      `${label} permissions must be ${expected.toString(8).padStart(4, '0')}`,
    )
  }
}

async function countDirectoryEntries(path) {
  const { readdir } = await import('node:fs/promises')
  return (await readdir(path)).length
}

async function rejectSymlink(path, message = 'path must not be a symlink') {
  const info = await lstat(path)
  if (info.isSymbolicLink()) throw new Error(message)
}

async function exists(path) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'official client harness failed'}\n`,
    )
    process.exitCode = 1
  })
}

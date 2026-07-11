#!/usr/bin/env node

import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const schemaVersion = 1
const confirmation = 'clean-browser-profile'
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = join(repoRoot, 'test/.tmp')
const defaultRoot = 'test/.tmp/hon-94-browser-profile'
const defaultBraveExecutable =
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
const supportedActions = new Set(['prepare', 'status', 'cleanup'])
const release = Object.freeze({
  repository: 'github:53538899',
  repositoryId: 53_538_899,
  tag: 'browser-v2026.6.1',
  publishedAt: '2026-06-30T17:07:46Z',
  asset: 'dist-chrome-2026.6.1.zip',
  assetId: 462_351_736,
  url: 'https://api.github.com/repositories/53538899/releases/assets/462351736',
  sha256: 'fcd29c5971d9b218ad9159717a19c38cca5150f2a0aa909ddf805bd7695d097e',
  size: 21_593_500,
  manifestVersion: '2026.6.1',
  manifestFormat: 3,
})

async function main(argv = process.argv.slice(2)) {
  const normalized = argv[0] === '--' ? argv.slice(1) : argv
  const [action, ...rest] = normalized
  if (!action || !supportedActions.has(action)) {
    throw new Error('action must be prepare, status, or cleanup')
  }

  const options = parseOptions(rest)
  const root = resolveRoot(options.root ?? defaultRoot)
  const packet = buildPacket(action, options, root)

  if (options.execute) {
    requireConfirmation(options)
    await executeAction(packet, root)
  }

  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`)
}

function buildPacket(action, options, root) {
  const braveExecutable =
    process.env.HONOWARDEN_BRAVE_EXECUTABLE ?? defaultBraveExecutable
  return {
    schemaVersion,
    action,
    generatedAt: parseTimestamp(options.at),
    executed: false,
    status: 'planned',
    root: root.relative,
    release,
    paths: {
      asset: join(root.relative, 'assets', release.asset),
      extension: join(root.relative, 'extension'),
      profile: join(root.relative, 'profile'),
      state: join(root.relative, 'profile-state.json'),
    },
    launch: {
      browser: 'Brave Browser',
      executable: braveExecutable,
      remoteDebuggingAddress: '127.0.0.1',
      remoteDebuggingPort: 9224,
      args: [
        `--user-data-dir=${join(root.relative, 'profile')}`,
        `--disable-extensions-except=${join(root.relative, 'extension')}`,
        `--load-extension=${join(root.relative, 'extension')}`,
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=9224',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    },
    readback: null,
    next: {
      confirmation,
      command: `pnpm client:browser-profile -- ${action} --root ${root.relative} --execute --confirm ${confirmation}`,
    },
    safety: {
      freshProfileRequired: true,
      productionDataAllowed: false,
      printsCredentials: false,
      profileInsideIgnoredStorage: true,
      cleanupClearsClipboard: true,
    },
  }
}

async function executeAction(packet, root) {
  switch (packet.action) {
    case 'prepare': {
      packet.readback = await prepareProfile(root, packet.generatedAt)
      packet.status = 'prepared'
      break
    }
    case 'status': {
      packet.readback = await readStatus(root)
      packet.status = packet.readback.rootExists
        ? packet.readback.profileUntouched
          ? 'prepared'
          : 'used'
        : 'not_prepared'
      break
    }
    case 'cleanup': {
      packet.readback = await cleanupProfile(root)
      packet.status = packet.readback.rootExists ? 'not_ready' : 'clean'
      break
    }
  }
  packet.executed = true
  delete packet.next.command
}

async function prepareProfile(root, preparedAt) {
  await validateRootBoundary(root)
  if (await exists(root.absolute)) {
    throw new Error('browser profile root already exists; run cleanup first')
  }

  let created = false
  try {
    await mkdir(join(root.absolute, 'assets'), { recursive: true, mode: 0o700 })
    await mkdir(join(root.absolute, 'extension'), { mode: 0o700 })
    await mkdir(join(root.absolute, 'profile'), { mode: 0o700 })
    created = true

    const assetPath = join(root.absolute, 'assets', release.asset)
    const bytes = await downloadAsset()
    const digest = sha256(bytes)
    if (digest !== release.sha256) {
      throw new Error('browser asset digest mismatch')
    }
    if (bytes.length !== release.size) {
      throw new Error('browser asset size mismatch')
    }
    await writeFile(assetPath, bytes, { mode: 0o600 })

    const extensionPath = join(root.absolute, 'extension')
    await runCommand('/usr/bin/ditto', ['-x', '-k', assetPath, extensionPath])
    const manifest = await validatedManifest(extensionPath)
    const profileEntries = await readdir(join(root.absolute, 'profile'))
    if (profileEntries.length !== 0) {
      throw new Error('fresh browser profile was not empty')
    }

    const braveExecutable =
      process.env.HONOWARDEN_BRAVE_EXECUTABLE ?? defaultBraveExecutable
    await access(braveExecutable)
    const brave = await runCommand(braveExecutable, ['--version'])
    const braveVersion = brave.stdout.trim()
    if (!braveVersion.startsWith('Brave Browser ')) {
      throw new Error('Brave Browser version readback was invalid')
    }

    const state = {
      schemaVersion,
      preparedAt,
      release,
      browser: {
        name: 'Brave Browser',
        version: braveVersion,
      },
      manifest: {
        version: manifest.version,
        manifestVersion: manifest.manifest_version,
        backgroundServiceWorker: manifest.background.service_worker,
      },
      profile: {
        initiallyEmpty: true,
        containsCredentials: false,
        stagingEndpoint: 'https://honowarden-staging.ghive42.workers.dev',
      },
    }
    const statePath = join(root.absolute, 'profile-state.json')
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
    })
    await chmod(statePath, 0o600)

    return {
      rootExists: true,
      assetSha256: digest,
      assetSize: bytes.length,
      manifestVersion: manifest.version,
      manifestFormat: manifest.manifest_version,
      backgroundServiceWorker: manifest.background.service_worker,
      browserVersion: braveVersion,
      profileEntries: 0,
      profileUntouched: true,
      containsCredentials: false,
      stateFileMode: '0600',
    }
  } catch (error) {
    if (created) await rm(root.absolute, { recursive: true, force: true })
    throw error
  }
}

async function readStatus(root) {
  await validateRootBoundary(root)
  if (!(await exists(root.absolute))) {
    return {
      rootExists: false,
      profileUntouched: false,
      containsCredentials: null,
    }
  }
  await rejectSymlink(root.absolute)

  const assetPath = join(root.absolute, 'assets', release.asset)
  const asset = await readFile(assetPath)
  const digest = sha256(asset)
  const manifest = await validatedManifest(join(root.absolute, 'extension'))
  const statePath = join(root.absolute, 'profile-state.json')
  const state = JSON.parse(await readFile(statePath, 'utf8'))
  const profileEntries = await readdir(join(root.absolute, 'profile'))
  const valid =
    digest === release.sha256 &&
    asset.length === release.size &&
    state?.release?.sha256 === release.sha256 &&
    state?.manifest?.version === release.manifestVersion
  if (!valid) throw new Error('browser profile state did not match the pin')

  return {
    rootExists: true,
    assetSha256: digest,
    assetSize: asset.length,
    manifestVersion: manifest.version,
    manifestFormat: manifest.manifest_version,
    browserVersion: state.browser?.version ?? null,
    profileEntries: profileEntries.length,
    profileUntouched: profileEntries.length === 0,
    containsCredentials: profileEntries.length === 0 ? false : null,
  }
}

async function cleanupProfile(root) {
  await validateRootBoundary(root)
  let cleanupError = null
  try {
    if (await exists(root.absolute)) {
      await rejectSymlink(root.absolute)
      if (await profileInUse(join(root.absolute, 'profile'))) {
        throw new Error('browser profile is still in use; close Brave first')
      }
      await rm(root.absolute, { recursive: true, force: false })
    }
  } catch (error) {
    cleanupError = error
  } finally {
    await writeClipboard('')
  }
  if (cleanupError) throw cleanupError
  return {
    rootExists: await exists(root.absolute),
    clipboardCleared: true,
  }
}

async function downloadAsset() {
  try {
    const response = await globalThis.fetch(release.url, {
      redirect: 'follow',
      headers: {
        Accept: 'application/octet-stream',
        'User-Agent': 'HonoWarden-official-client-evidence',
      },
    })
    if (!response.ok) throw new Error('download failed')
    return Buffer.from(await response.arrayBuffer())
  } catch {
    throw new Error('official browser asset download failed')
  }
}

async function validatedManifest(extensionPath) {
  const manifest = JSON.parse(
    await readFile(join(extensionPath, 'manifest.json'), 'utf8'),
  )
  if (
    manifest?.version !== release.manifestVersion ||
    manifest?.manifest_version !== release.manifestFormat ||
    typeof manifest?.background?.service_worker !== 'string' ||
    manifest.background.service_worker.length === 0
  ) {
    throw new Error('browser extension manifest did not match the pin')
  }
  return manifest
}

function resolveRoot(value) {
  const absolute = isAbsolute(value) ? resolve(value) : resolve(repoRoot, value)
  const relativePath = relative(fixtureRoot, absolute)
  if (
    relativePath.length === 0 ||
    relativePath.startsWith(`..${sep}`) ||
    relativePath === '..' ||
    isAbsolute(relativePath)
  ) {
    throw new Error('root must be inside test/.tmp')
  }
  return {
    absolute,
    relative: relative(repoRoot, absolute),
    insideFixtureRoot: relativePath,
  }
}

async function validateRootBoundary(root) {
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
    await rejectSymlink(current)
  }
}

async function rejectSymlink(path) {
  const info = await lstat(path)
  if (info.isSymbolicLink()) throw new Error('root must not be a symlink')
}

async function profileInUse(profilePath) {
  if (!(await exists(profilePath))) return false
  const result = await runCommand('/usr/sbin/lsof', ['+D', profilePath], [0, 1])
  return result.code === 0 && result.stdout.trim().length > 0
}

async function writeClipboard(value) {
  try {
    await runCommand('pbcopy', [], [0], value)
  } catch {
    throw new Error('clipboard cleanup failed')
  }
}

function runCommand(command, args, acceptedCodes = [0], input = null) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', () => undefined)
    child.on('error', rejectCommand)
    child.on('close', (code) => {
      if (acceptedCodes.includes(code)) resolveCommand({ code, stdout })
      else rejectCommand(new Error(`${command} failed`))
    })
    if (input !== null) child.stdin.write(input)
    child.stdin.end()
  })
}

function parseOptions(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--execute') {
      options.execute = true
      continue
    }
    if (arg === '--root' || arg === '--confirm' || arg === '--at') {
      const value = args[index + 1]
      if (!value) throw new Error(`${arg} requires a value`)
      options[arg.slice(2)] = value
      index += 1
      continue
    }
    throw new Error(`Unknown option: ${arg}`)
  }
  return options
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

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
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

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'browser profile operation failed'}\n`,
  )
  process.exitCode = 1
})

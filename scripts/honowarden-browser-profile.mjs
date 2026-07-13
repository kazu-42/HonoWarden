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
import { homedir } from 'node:os'
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
const defaultBrowserId = 'brave'
const browserHosts = Object.freeze({
  brave: Object.freeze({
    id: 'brave',
    name: 'Brave Browser',
    defaultExecutable: defaultBraveExecutable,
    versionPrefix: 'Brave Browser ',
    launchArgs: Object.freeze([]),
  }),
  'chrome-for-testing': Object.freeze({
    id: 'chrome-for-testing',
    name: 'Chrome for Testing',
    defaultExecutable: null,
    versionPrefix: 'Google Chrome for Testing ',
    launchArgs: Object.freeze(['--enable-unsafe-extension-debugging']),
  }),
})
const normalBrowserProfileDirectories = Object.freeze([
  Object.freeze([
    'Library',
    'Application Support',
    'BraveSoftware',
    'Brave-Browser',
  ]),
  Object.freeze(['Library', 'Application Support', 'Google', 'Chrome']),
  Object.freeze([
    'Library',
    'Application Support',
    'Google',
    'Chrome for Testing',
  ]),
  Object.freeze(['.config', 'BraveSoftware', 'Brave-Browser']),
  Object.freeze(['.config', 'google-chrome']),
  Object.freeze(['.config', 'google-chrome-for-testing']),
])
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
  const browser = selectBrowser(options)
  if (action === 'prepare') {
    await validateBrowserExecutablePath(
      browser,
      browser.id === 'chrome-for-testing' || Boolean(options.browserExecutable),
    )
  }
  const root = resolveRoot(options.root ?? defaultRoot)
  const packet = buildPacket(action, options, root, browser)

  if (options.execute) {
    requireConfirmation(options)
    await executeAction(packet, root, browser)
  }

  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`)
}

function buildPacket(action, options, root, browser) {
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
    launch: buildLaunch(root, browser),
    readback: null,
    next: {
      confirmation,
      command: buildExecutionCommand(action, options, root, browser),
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

function buildLaunch(root, browser, version = null) {
  return {
    browser: browser.name,
    version,
    executable: browser.executable,
    remoteDebuggingAddress: '127.0.0.1',
    remoteDebuggingPort: 9224,
    args: [
      `--user-data-dir=${join(root.relative, 'profile')}`,
      `--disable-extensions-except=${join(root.relative, 'extension')}`,
      `--load-extension=${join(root.relative, 'extension')}`,
      ...browser.launchArgs,
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=9224',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  }
}

async function executeAction(packet, root, browser) {
  switch (packet.action) {
    case 'prepare': {
      packet.readback = await prepareProfile(root, packet.generatedAt, browser)
      packet.launch.version = packet.readback.browserVersion
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
      applyBrowserReadbackToLaunch(packet, root, browser)
      break
    }
    case 'cleanup': {
      packet.readback = await cleanupProfile(root, browser)
      applyBrowserReadbackToLaunch(packet, root, browser)
      packet.status = packet.readback.rootExists ? 'not_ready' : 'clean'
      break
    }
  }
  packet.executed = true
  delete packet.next.command
}

async function prepareProfile(root, preparedAt, browser) {
  await validateRootBoundary(root)
  if (await exists(root.absolute)) {
    throw new Error('browser profile root already exists; run cleanup first')
  }
  await validateBrowserExecutablePath(browser, true)

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

    const browserVersion = await readBrowserVersion(browser)

    const state = {
      schemaVersion,
      preparedAt,
      release,
      browser: {
        id: browser.id,
        name: browser.name,
        version: browserVersion,
        executable: browser.executable,
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
      browserVersion,
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
  const preparedBrowser = parsePreparedBrowser(state?.browser)
  if (preparedBrowser?.executable) {
    const host = browserHosts[preparedBrowser.id]
    await validateBrowserExecutablePath(
      { ...host, executable: preparedBrowser.executable },
      false,
    )
  }
  const profileEntries = await readdir(join(root.absolute, 'profile'))
  const valid =
    digest === release.sha256 &&
    asset.length === release.size &&
    state?.release?.sha256 === release.sha256 &&
    state?.manifest?.version === release.manifestVersion &&
    preparedBrowser !== null
  if (!valid) throw new Error('browser profile state did not match the pin')

  return {
    rootExists: true,
    assetSha256: digest,
    assetSize: asset.length,
    manifestVersion: manifest.version,
    manifestFormat: manifest.manifest_version,
    browserId: preparedBrowser.id,
    browserName: preparedBrowser.name,
    browserVersion: preparedBrowser.version,
    browserExecutable: preparedBrowser.executable,
    profileEntries: profileEntries.length,
    profileUntouched: profileEntries.length === 0,
    containsCredentials: profileEntries.length === 0 ? false : null,
  }
}

async function cleanupProfile(root, fallbackBrowser) {
  await validateRootBoundary(root)
  let cleanupError = null
  let preparedBrowser = null
  try {
    if (await exists(root.absolute)) {
      await rejectSymlink(root.absolute)
      preparedBrowser = await readPreparedBrowser(root)
      if (await profileInUse(join(root.absolute, 'profile'))) {
        const browserName = preparedBrowser?.name ?? fallbackBrowser.name
        throw new Error(
          `browser profile is still in use; close ${browserName} first`,
        )
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
    browserId: preparedBrowser?.id ?? null,
    browserName: preparedBrowser?.name ?? null,
    browserVersion: preparedBrowser?.version ?? null,
    browserExecutable: preparedBrowser?.executable ?? null,
  }
}

async function readPreparedBrowser(root) {
  try {
    const statePath = join(root.absolute, 'profile-state.json')
    await rejectSymlink(
      statePath,
      'browser profile state must not be a symlink',
    )
    const state = JSON.parse(await readFile(statePath, 'utf8'))
    const preparedBrowser = parsePreparedBrowser(state?.browser)
    if (preparedBrowser?.executable) {
      const host = browserHosts[preparedBrowser.id]
      try {
        await validateBrowserExecutablePath(
          { ...host, executable: preparedBrowser.executable },
          false,
        )
      } catch {
        preparedBrowser.executable = null
      }
    }
    return preparedBrowser
  } catch {
    return null
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

function selectBrowser(options) {
  const id = options.browser ?? defaultBrowserId
  const host = Object.hasOwn(browserHosts, id) ? browserHosts[id] : null
  if (!host) {
    throw new Error(
      `unsupported --browser ${JSON.stringify(id)}; expected brave or chrome-for-testing`,
    )
  }

  const executable =
    options.browserExecutable ??
    (id === 'brave' ? process.env.HONOWARDEN_BRAVE_EXECUTABLE : undefined) ??
    host.defaultExecutable
  if (!executable) {
    throw new Error(`${host.name} requires --browser-executable <path>`)
  }

  return { ...host, executable }
}

async function validateBrowserExecutablePath(browser, requireExisting) {
  if (await isInsideNormalBrowserProfile(browser.executable)) {
    throw new Error(
      `${browser.name} executable must not point into a normal browser profile directory`,
    )
  }

  if (!(await exists(browser.executable))) {
    if (requireExisting) {
      throw new Error(`${browser.name} executable was not accessible`)
    }
    return
  }

  await rejectSymlink(
    browser.executable,
    `${browser.name} executable must not be a symlink`,
  )
  const info = await lstat(browser.executable)
  if (!info.isFile()) {
    throw new Error(`${browser.name} executable must be a regular file`)
  }
  let resolvedExecutable
  try {
    resolvedExecutable = await realpath(browser.executable)
  } catch {
    throw new Error(`${browser.name} executable was not accessible`)
  }
  if (await isInsideNormalBrowserProfile(resolvedExecutable)) {
    throw new Error(
      `${browser.name} executable must not point into a normal browser profile directory`,
    )
  }
  if (requireExisting) {
    try {
      await access(browser.executable)
    } catch {
      throw new Error(`${browser.name} executable was not accessible`)
    }
  }
}

function parsePreparedBrowser(value) {
  if (!value || typeof value !== 'object') return null

  let host
  if (value.id !== undefined) {
    if (
      typeof value.id !== 'string' ||
      !Object.hasOwn(browserHosts, value.id)
    ) {
      return null
    }
    host = browserHosts[value.id]
  } else {
    host = Object.values(browserHosts).find(
      (candidate) => candidate.name === value.name,
    )
  }
  if (
    !host ||
    value.name !== host.name ||
    typeof value.version !== 'string' ||
    !value.version.startsWith(host.versionPrefix)
  ) {
    return null
  }

  const executable = value.executable ?? null
  if (
    executable !== null &&
    (typeof executable !== 'string' || executable.length === 0)
  ) {
    return null
  }
  return {
    id: host.id,
    name: host.name,
    version: value.version,
    executable,
  }
}

function applyBrowserReadbackToLaunch(packet, root, fallbackBrowser) {
  if (
    !packet.readback?.browserId ||
    !Object.hasOwn(browserHosts, packet.readback.browserId)
  ) {
    return
  }

  const host = browserHosts[packet.readback.browserId]
  const executable =
    packet.readback.browserExecutable ??
    (fallbackBrowser.id === host.id
      ? fallbackBrowser.executable
      : host.defaultExecutable)
  packet.launch = buildLaunch(
    root,
    { ...host, executable: executable ?? null },
    packet.readback.browserVersion,
  )
}

async function isInsideNormalBrowserProfile(executable) {
  const candidate = resolve(executable)
  for (const components of normalBrowserProfileDirectories) {
    const profileRoot = join(homedir(), ...components)
    const roots = [profileRoot]
    try {
      roots.push(await realpath(profileRoot))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    for (const root of roots) {
      const pathFromRoot = relative(root, candidate)
      if (
        pathFromRoot.length === 0 ||
        (!pathFromRoot.startsWith(`..${sep}`) &&
          pathFromRoot !== '..' &&
          !isAbsolute(pathFromRoot))
      ) {
        return true
      }
    }
  }
  return false
}

async function readBrowserVersion(browser) {
  try {
    const result = await runCommand(browser.executable, ['--version'])
    const version = result.stdout.trim()
    if (!version.startsWith(browser.versionPrefix)) throw new Error()
    return version
  } catch {
    throw new Error(`${browser.name} version readback was invalid`)
  }
}

function buildExecutionCommand(action, options, root, browser) {
  const hostOptions = []
  if (browser.id !== defaultBrowserId) {
    hostOptions.push(`--browser ${browser.id}`)
  }
  if (options.browserExecutable) {
    hostOptions.push(
      `--browser-executable ${shellQuote(options.browserExecutable)}`,
    )
  }
  const selectedHost = hostOptions.length > 0 ? ` ${hostOptions.join(' ')}` : ''
  return `pnpm client:browser-profile -- ${action} --root ${shellQuote(root.relative)}${selectedHost} --execute --confirm ${confirmation}`
}

function shellQuote(value) {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`
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

async function rejectSymlink(path, message = 'root must not be a symlink') {
  const info = await lstat(path)
  if (info.isSymbolicLink()) throw new Error(message)
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
    if (
      arg === '--root' ||
      arg === '--confirm' ||
      arg === '--at' ||
      arg === '--browser' ||
      arg === '--browser-executable'
    ) {
      const value = args[index + 1]
      if (!value) throw new Error(`${arg} requires a value`)
      const key =
        arg === '--browser-executable' ? 'browserExecutable' : arg.slice(2)
      options[key] = value
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

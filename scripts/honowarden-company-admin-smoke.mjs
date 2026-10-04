#!/usr/bin/env node

import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  generateKeyPairSync,
  pbkdf2Sync,
  privateDecrypt,
  randomBytes,
  randomUUID,
  constants,
} from 'node:crypto'
import { createServer } from 'node:https'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises'
import { fileURLToPath, pathToFileURL, URL, URLSearchParams } from 'node:url'
import { clearTimeout, setTimeout } from 'node:timers'
import process from 'node:process'
import {
  createIdempotentCleanup,
  installSignalCleanup,
  runCleanupSteps,
  stopDetachedProcessTree,
  stopTrackedProcesses,
} from './honowarden-signal-cleanup.mjs'
import { isolatedClientEnvironment } from './honowarden-official-client-harness.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { Response } = globalThis
const defaultPlaywright =
  '/Users/hackhike/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs'
const defaultBrowser =
  '/Users/hackhike/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
const defaultNative =
  '/var/folders/l0/dmzc_tl14k9bnzn6q1l7p8d80000gn/T/honowarden-company-client-assets-20261004-rp0fms5n/bw-2026.9.1'
const nativePins = new Map([
  [
    '154d93f794a5006dc1ec69df330d8c6e7e1635a2faa0a576abe7159b3825c96c',
    '2026.9.1',
  ],
  [
    'b40c0f110cf88c41954c7be67d15139beb7202cfff8f384af5260f654e94db57',
    '2026.9.0',
  ],
])
const confirmation = 'company-admin-smoke'
const activeProcesses = new Set()
const runDeadlineMs = 600000
const cleanupDeadlineMs = 20000

export async function beforeDeadline(
  promise,
  timeoutMs,
  code,
  onTimeout = () => {},
) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = globalThis.setTimeout(() => {
          onTimeout()
          reject(new SmokeFailure(code))
        }, timeoutMs)
      }),
    ])
  } finally {
    globalThis.clearTimeout(timer)
  }
}
const mimeTypes = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
}

class SmokeFailure extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

function invariant(condition, code) {
  if (!condition) throw new SmokeFailure(code)
}

export async function verifyEnrollmentAssurance(page, readAssurance) {
  invariant(
    (await page.locator('.setup-secret').count()) === 0,
    'setup_seed_dom_retained',
  )
  const assurance = await readAssurance()
  invariant(assurance.verified === true, 'enrollment_family_not_assured')
  return { enrollmentAssured: true, explicitStepUp: false }
}

export function assertDistinctBrowserFamilies(firstToken, secondToken) {
  // Compare only run-observed Worker tokens; this does not authenticate tokens.
  const claims = (token) => {
    try {
      invariant(
        typeof token === 'string' && token.length <= 16384,
        'browser_family_claims_invalid',
      )
      const parts = token.split('.')
      invariant(parts.length === 3, 'browser_family_claims_invalid')
      const value = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
      invariant(
        ['sub', 'device', 'sessionId'].every(
          (key) => typeof value[key] === 'string' && value[key].length > 0,
        ),
        'browser_family_claims_invalid',
      )
      return value
    } catch {
      throw new SmokeFailure('browser_family_claims_invalid')
    }
  }
  const first = claims(firstToken)
  const second = claims(secondToken)
  invariant(first.sub === second.sub, 'browser_family_account_mismatch')
  invariant(
    first.device !== second.device && first.sessionId !== second.sessionId,
    'browser_families_not_distinct',
  )
  return true
}

export async function completeDistinctFamilyStepUpUi({
  page,
  refreshPage,
  readProfile,
  readAssurance,
  getFreshCode,
  closeDialog,
}) {
  await refreshPage(page)
  const profile = await readProfile()
  invariant(profile.TwoFactorEnabled === true, 'stepup_family_not_enrolled')
  const before = await readAssurance()
  invariant(before.verified === false, 'stepup_family_was_already_assured')
  await page
    .getByRole('button', { name: 'アカウントのセキュリティ', exact: true })
    .click()
  const accountDialog = page.getByRole('dialog', {
    name: 'アカウントのセキュリティ',
    exact: true,
  })
  await accountDialog
    .getByRole('button', { name: '認証コードで本人確認', exact: true })
    .click()
  const dialog = page.getByRole('dialog', {
    name: '現在のセッションを本人確認',
    exact: true,
  })
  await dialog
    .getByLabel('認証アプリの6桁コード', { exact: true })
    .fill(await getFreshCode())
  await dialog
    .getByRole('button', { name: '本人確認する', exact: true })
    .click()
  await closeDialog(page)
  const after = await readAssurance()
  invariant(after.verified === true, 'stepup_family_not_assured')
  return {
    enrolled: true,
    unassuredBefore: true,
    explicitStepUp: true,
    verifiedAfter: true,
  }
}

export function safeErrorClassification(error) {
  const message = typeof error?.message === 'string' ? error.message : ''
  const operations = [
    'page.goto',
    'locator.fill',
    'locator.click',
    'locator.waitFor',
    'browser.close',
    'browserType.launchServer',
    'browserType.connect',
  ]
  const operation =
    operations.find((value) => message.startsWith(value + ':')) ??
    'unclassified'
  const network = [
    'ERR_NAME_NOT_RESOLVED',
    'ERR_PROXY_CONNECTION_FAILED',
    'ERR_CONNECTION_REFUSED',
    'ERR_CONNECTION_CLOSED',
    'ERR_CERT_AUTHORITY_INVALID',
    'ERR_HTTP_RESPONSE_CODE_FAILURE',
    'ERR_ABORTED',
  ].find((value) => message.includes('net::' + value))
  const kind = network
    ? 'browser_network'
    : message.includes('strict mode violation')
      ? 'ambiguous_locator'
      : error?.name === 'TimeoutError'
        ? 'browser_timeout'
        : message.includes('Target page, context or browser has been closed')
          ? 'browser_closed'
          : 'unclassified'
  return { kind, operation, ...(network ? { network } : {}) }
}

export function parseOptions(args) {
  const [action = 'plan', ...rest] = args
  invariant(['plan', 'run'].includes(action), 'invalid_action')
  const options = {
    action,
    runRoot: 'test/.tmp/company-admin-' + randomUUID(),
    playwrightModule: defaultPlaywright,
    browserExecutable: defaultBrowser,
    nativeCli: defaultNative,
  }
  const values = new Map([
    ['--run-root', 'runRoot'],
    ['--playwright-module', 'playwrightModule'],
    ['--browser-executable', 'browserExecutable'],
    ['--native-cli', 'nativeCli'],
    ['--source-sha256', 'sourceSha256'],
    ['--confirm', 'confirm'],
  ])
  for (let index = 0; index < rest.length; index++) {
    const name = rest[index]
    if (name === '--execute') options.execute = true
    else if (name === '--without-native') options.nativeCli = undefined
    else {
      invariant(
        values.has(name) && typeof rest[index + 1] === 'string',
        'invalid_option',
      )
      invariant(!rest[index + 1].startsWith('--'), 'invalid_option')
      options[values.get(name)] = rest[++index]
    }
  }
  invariant(action !== 'plan' || !options.execute, 'plan_cannot_execute')
  if (action === 'run') {
    invariant(
      options.execute === true && options.confirm === confirmation,
      'execution_confirmation_required',
    )
    invariant(
      /^[a-f0-9]{64}$/.test(options.sourceSha256 ?? ''),
      'source_pin_required',
    )
  }
  return options
}

export function ownedRunPath(value, root = repoRoot) {
  const absolute = resolve(root, value)
  const parent = resolve(root, 'test/.tmp')
  invariant(dirname(absolute) === parent, 'run_root_must_be_new_direct_child')
  invariant(
    /^[A-Za-z0-9_-]{1,128}$/.test(relative(parent, absolute)),
    'invalid_run_root',
  )
  return absolute
}

export async function writeSupervisorProof(root, ownershipNonce, proof) {
  if (typeof ownershipNonce !== 'string')
    return { saved: false, reason: 'run_root_not_owned' }
  const directory = await lstat(root)
  const markerPath = join(root, 'ownership.json')
  invariant(
    directory.isDirectory() &&
      !directory.isSymbolicLink() &&
      directory.uid === process.getuid() &&
      (directory.mode & 0o777) === 0o700 &&
      (await realpath(root)) === root,
    'supervisor_run_ownership_invalid',
  )
  const marker = await lstat(markerPath)
  invariant(
    marker.isFile() &&
      !marker.isSymbolicLink() &&
      marker.uid === process.getuid() &&
      (marker.mode & 0o777) === 0o600,
    'supervisor_run_ownership_invalid',
  )
  const ownership = JSON.parse(await readFile(markerPath, 'utf8'))
  invariant(
    ownership.uid === process.getuid() && ownership.nonce === ownershipNonce,
    'supervisor_run_ownership_invalid',
  )
  await writeFile(
    join(root, 'supervisor.json'),
    JSON.stringify(proof, null, 2),
    { mode: 0o600, flag: 'wx' },
  )
  return { saved: true }
}

export function childEnvironment(root, certificate, source = process.env) {
  return {
    ...isolatedClientEnvironment(
      { absolute: join(root, 'native') },
      {
        PATH: source.PATH ?? '/usr/bin:/bin',
        LANG: 'en_US.UTF-8',
        ...(certificate ? { NODE_EXTRA_CA_CERTS: certificate } : {}),
      },
    ),
    BW_NOCOLOR: 'true',
    BW_NO_INTERACTION: 'true',
    WRANGLER_SEND_METRICS: 'false',
  }
}

export function safePath(path) {
  return path
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ':id',
    )
    .replace(/\/assets\/[^/]+$/, '/assets/:file')
}

export function migrationStatements(sql) {
  const result = []
  const lines = []
  let trigger = false
  for (const line of sql.split('\n')) {
    const trimmed = line.trim()
    if (!lines.length && !trimmed) continue
    if (/^CREATE\s+TRIGGER\b/i.test(trimmed)) trigger = true
    lines.push(line)
    if (trigger ? /^END;$/i.test(trimmed) : trimmed.endsWith(';')) {
      result.push(lines.splice(0).join('\n'))
      trigger = false
    }
  }
  invariant(!lines.some((line) => line.trim()), 'incomplete_migration')
  return result
}

async function regularFile(path) {
  const stat = await lstat(path)
  invariant(
    stat.isFile() && !stat.isSymbolicLink(),
    'input_must_be_regular_file',
  )
  return stat
}

async function sourceFingerprint() {
  const files = []
  async function visit(path) {
    for (const entry of await readdir(join(repoRoot, path), {
      withFileTypes: true,
    })) {
      const name = path + '/' + entry.name
      if (entry.isDirectory()) await visit(name)
      else {
        invariant(
          entry.isFile() && !entry.isSymbolicLink(),
          'source_contains_symlink',
        )
        files.push(name)
      }
    }
  }
  for (const path of ['src', 'migrations', 'admin', 'dist/admin'])
    await visit(path)
  files.push(
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'wrangler.jsonc',
    'vite.admin.config.ts',
    'scripts/honowarden-company-admin-smoke.mjs',
    'scripts/honowarden-signal-cleanup.mjs',
    'scripts/honowarden-official-client-harness.mjs',
  )
  const hash = createHash('sha256')
  for (const name of files.sort()) {
    const bytes = await readFile(join(repoRoot, name))
    hash.update(name + '\0' + bytes.length + '\0').update(bytes)
  }
  return { sha256: hash.digest('hex'), fileCount: files.length }
}

async function preparation(options) {
  const runRoot = ownedRunPath(options.runRoot)
  await regularFile(options.playwrightModule)
  await regularFile(options.browserExecutable)
  await regularFile('/usr/bin/openssl')
  const esbuildPath = require.resolve('esbuild', {
    paths: [dirname(require.resolve('wrangler/package.json'))],
  })
  const miniflarePath = require.resolve('miniflare')
  const miniflareRequire = createRequire(miniflarePath)
  const workerdPath = miniflareRequire('workerd').default
  await regularFile(workerdPath)
  const runtime = {
    esbuildVersion: JSON.parse(
      await readFile(resolve(dirname(esbuildPath), '../package.json'), 'utf8'),
    ).version,
    miniflareVersion: JSON.parse(
      await readFile(
        resolve(dirname(miniflarePath), '../../package.json'),
        'utf8',
      ),
    ).version,
    workerdVersion: JSON.parse(
      await readFile(miniflareRequire.resolve('workerd/package.json'), 'utf8'),
    ).version,
    workerdSha256: createHash('sha256')
      .update(await readFile(workerdPath))
      .digest('hex'),
  }
  const source = await sourceFingerprint()
  const inputs = {
    playwrightEntrySha256: createHash('sha256')
      .update(await readFile(options.playwrightModule))
      .digest('hex'),
    browserExecutableSha256: createHash('sha256')
      .update(await readFile(options.browserExecutable))
      .digest('hex'),
  }
  let native
  if (options.nativeCli) {
    await regularFile(options.nativeCli)
    const bytes = await readFile(options.nativeCli)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    invariant(nativePins.has(sha256), 'native_cli_digest_mismatch')
    native = { version: nativePins.get(sha256), sha256 }
  }
  return {
    schemaVersion: 1,
    status: 'planned',
    executed: false,
    syntheticOnly: true,
    loopbackOnly: true,
    downloads: false,
    installs: false,
    remoteWrites: false,
    runDeadlineMs,
    cleanupDeadlineMs,
    runRoot: relative(repoRoot, runRoot),
    source,
    inputs,
    playwrightModule: options.playwrightModule,
    browserExecutable: options.browserExecutable,
    native,
    modules: { esbuildPath, miniflarePath },
    runtime,
  }
}

function encrypt(key, value) {
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-cbc', key.subarray(0, 32), iv)
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.isBuffer(value) ? value : Buffer.from(value)),
    cipher.final(),
  ])
  const mac = createHmac('sha256', key.subarray(32))
    .update(Buffer.concat([iv, ciphertext]))
    .digest()
  return (
    '2.' +
    [iv, ciphertext, mac].map((bytes) => bytes.toString('base64')).join('|')
  )
}

function decrypt(key, value) {
  invariant(
    typeof value === 'string' && value.startsWith('2.'),
    'invalid_type2_fixture',
  )
  const parts = value
    .slice(2)
    .split('|')
    .map((part) => Buffer.from(part, 'base64'))
  invariant(parts.length === 3, 'invalid_type2_fixture')
  const [iv, ciphertext, mac] = parts
  invariant(
    createHmac('sha256', key.subarray(32))
      .update(Buffer.concat([iv, ciphertext]))
      .digest()
      .equals(mac),
    'fixture_mac_mismatch',
  )
  const cipher = createDecipheriv('aes-256-cbc', key.subarray(0, 32), iv)
  return Buffer.concat([cipher.update(ciphertext), cipher.final()])
}

function unwrap(privateKey, value) {
  invariant(/^[34]\./.test(value), 'invalid_rsa_fixture')
  return privateDecrypt(
    {
      key: privateKey,
      format: 'der',
      type: 'pkcs8',
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: value[0] === '3' ? 'sha256' : 'sha1',
    },
    Buffer.from(value.slice(2), 'base64'),
  )
}

function accountFixture(label, nonce) {
  const email = label + '-' + nonce + '@example.invalid'
  const password = 'Synthetic-only-' + randomBytes(24).toString('base64url')
  const master = pbkdf2Sync(password, email, 600000, 32, 'sha256')
  const stretched = Buffer.concat(
    ['enc', 'mac'].map((label) =>
      createHmac('sha256', master)
        .update(Buffer.from(label + '\x01'))
        .digest(),
    ),
  )
  const userKey = randomBytes(64)
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicExponent: 65537,
  })
  const privateKey = pair.privateKey.export({ format: 'der', type: 'pkcs8' })
  return {
    label,
    email,
    password,
    userKey,
    privateKey,
    hash: pbkdf2Sync(master, password, 1, 32, 'sha256').toString('base64'),
    wrappedUserKey: encrypt(stretched, userKey),
    publicKey: pair.publicKey
      .export({ format: 'der', type: 'spki' })
      .toString('base64'),
    wrappedPrivateKey: encrypt(userKey, privateKey),
  }
}

function cipherFixture(key, label, organizationId) {
  const itemKey = randomBytes(64)
  const expected = {
    name: 'Synthetic ' + label,
    notes: 'Synthetic notes ' + label,
    username: 'synthetic-' + label,
    password: 'Synthetic item value ' + randomBytes(16).toString('hex'),
    uri: 'https://' + label + '.example.invalid',
  }
  return {
    expected,
    payload: {
      type: 1,
      folderId: null,
      organizationId: organizationId ?? null,
      favorite: false,
      reprompt: 0,
      key: encrypt(key, itemKey),
      name: encrypt(itemKey, expected.name),
      notes: encrypt(itemKey, expected.notes),
      login: {
        username: encrypt(itemKey, expected.username),
        password: encrypt(itemKey, expected.password),
        totp: null,
        uris: [
          {
            uri: encrypt(itemKey, expected.uri),
            uriChecksum: encrypt(
              itemKey,
              createHash('sha256').update(expected.uri).digest('base64'),
            ),
            match: null,
          },
        ],
      },
    },
  }
}

function assertDecryptedCipher(cipher, key, expected) {
  const itemKey = decrypt(key, cipher.key)
  const observed = {
    name: decrypt(itemKey, cipher.name).toString(),
    notes: decrypt(itemKey, cipher.notes).toString(),
    username: decrypt(itemKey, cipher.login.username).toString(),
    password: decrypt(itemKey, cipher.login.password).toString(),
    uri: decrypt(itemKey, cipher.login.uris[0].uri).toString(),
  }
  invariant(
    Object.keys(expected).every((field) => observed[field] === expected[field]),
    'decrypted_cipher_equality_failed',
  )
}

function totp(secret, step) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let value = 0
  let bits = 0
  const bytes = []
  for (const character of secret) {
    invariant(alphabet.includes(character), 'invalid_synthetic_totp_seed')
    value = (value << 5) | alphabet.indexOf(character)
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((value >>> bits) & 255)
    }
  }
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest()
  const offset = digest[digest.length - 1] & 15
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    '0',
  )
}

export async function refreshWorkspaceFromUi(page) {
  const refresh = page.getByRole('button', { name: '再取得', exact: true })
  await refresh.click()
  await waitFor(
    async () =>
      (await refresh.isEnabled()) &&
      (await page
        .getByRole('status')
        .filter({ hasText: '最新の状態を取得しています' })
        .count()) === 0,
    'ui_refresh_timeout',
  )
}

export function nativeCommandAction(args) {
  if (args[0] === '--version') return 'version'
  if (args[0] === 'config' && args[1] === 'server') return 'configure_server'
  if (args[0] === 'sync' && args[1] === '--force') return 'forced_sync'
  if (args[0] === 'list' && args[1] === 'items') return 'list_items'
  if (args[0] === 'login') return 'login'
  if (args[0] === 'logout') return 'logout'
  return 'unsupported'
}

export function classifyNativeStderr(stderr, dataFile, initialVersion) {
  if (stderr.length === 0) return 'empty'
  const bootstrap = Buffer.from(
    'Could not find data file, "' + dataFile + '"; creating it instead.\n',
  )
  return initialVersion && stderr.equals(bootstrap)
    ? 'official_cli_first_profile_bootstrap'
    : 'unexpected_stderr'
}

export async function verifyNativeBootstrapFile(dataFile) {
  const stat = await lstat(dataFile)
  invariant(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.uid === process.getuid() &&
      (stat.mode & 0o777) === 0o600,
    'native_bootstrap_file_not_private',
  )
}

export async function closeOwnedBrowserServer(browserServer, options = {}) {
  if (!browserServer) return { graceful: true, processGroupAbsent: true }
  const child = browserServer.process()
  invariant(
    Number.isSafeInteger(child?.pid) && child.pid > 0,
    'browser_pid_invalid',
  )
  let graceful = false
  let publicKillCompleted = false
  try {
    await beforeDeadline(
      browserServer.close(),
      options.gracefulMs ?? 5000,
      'browser_graceful_close_deadline',
    )
    graceful = true
  } catch {
    try {
      await beforeDeadline(
        browserServer.kill(),
        options.forceMs ?? 2000,
        'browser_force_close_deadline',
      )
      publicKillCompleted = true
    } catch {
      // Owned process-group termination below remains mandatory.
    }
  }
  const processKill =
    options.processKill ?? ((pid, signal) => process.kill(pid, signal))
  await stopDetachedProcessTree(child, {
    processKill,
    gracefulTimeoutMilliseconds: 250,
    forceTimeoutMilliseconds: 1000,
  })
  let processGroupAbsent = false
  try {
    processKill(-child.pid, 0)
  } catch (error) {
    processGroupAbsent = error?.code === 'ESRCH'
  }
  invariant(processGroupAbsent, 'browser_owned_process_still_present')
  return { graceful, publicKillCompleted, processGroupAbsent }
}

async function waitFor(condition, code, timeout = 20000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new SmokeFailure(code)
}

async function boundedCommand(executable, args, environment, timeout = 30000) {
  const child = spawn(executable, args, {
    cwd: repoRoot,
    env: environment,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  activeProcesses.add(child)
  process.send?.({ type: 'owned_process', pid: child.pid })
  const stdout = []
  const stderr = []
  let stdoutBytes = 0
  let stderrBytes = 0
  let overflow = false
  child.stdout.on('data', (chunk) => {
    stdoutBytes += chunk.length
    if (stdoutBytes + stderrBytes >= 2 * 1024 * 1024) overflow = true
    if (!overflow) stdout.push(chunk)
  })
  child.stderr.on('data', (chunk) => {
    stderrBytes += chunk.length
    if (stdoutBytes + stderrBytes >= 2 * 1024 * 1024) overflow = true
    if (!overflow) stderr.push(chunk)
  })
  let timer
  try {
    const outcome = await Promise.race([
      new Promise((resolve) => {
        child.once('error', () => resolve('start_failed'))
        child.once('close', (code) => resolve(code === 0 ? 'passed' : 'failed'))
      }),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeout)
      }),
    ])
    invariant(outcome === 'passed', 'local_command_' + outcome)
    invariant(!overflow, 'local_command_output_limit')
    const stderrBuffer = Buffer.concat(stderr)
    for (const chunk of stderr) chunk.fill(0)
    stderr.length = 0
    return {
      stdout: Buffer.concat(stdout).toString(),
      stderr: stderrBuffer,
      stderrBytes,
    }
  } finally {
    clearTimeout(timer)
    await stopDetachedProcessTree(child)
    activeProcesses.delete(child)
    process.send?.({ type: 'owned_process_done', pid: child.pid })
  }
}

async function execute(options, packet) {
  invariant(
    packet.source.sha256 === options.sourceSha256,
    'source_pin_mismatch',
  )
  const root = ownedRunPath(options.runRoot)
  const parent = dirname(root)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  invariant((await realpath(parent)) === parent, 'run_parent_symlink')
  await mkdir(root, { mode: 0o700 })
  const ownerStat = await lstat(root)
  invariant(
    ownerStat.uid === process.getuid() && (ownerStat.mode & 0o777) === 0o700,
    'run_owner_invalid',
  )
  for (const directory of [
    'state',
    'native',
    'native/home',
    'native/tmp',
    'native/profile',
  ])
    await mkdir(join(root, directory), { mode: 0o700 })
  const ownershipNonce = randomUUID()
  await writeFile(
    join(root, 'ownership.json'),
    JSON.stringify({ uid: process.getuid(), nonce: ownershipNonce }),
    { mode: 0o600, flag: 'wx' },
  )
  process.send?.({ type: 'owned_root', nonce: ownershipNonce })
  const nonce = randomBytes(6).toString('hex')
  const owner = accountFixture('owner', nonce)
  const recipient = accountFixture('recipient', nonce)
  const outsider = accountFixture('outsider', nonce)
  const accounts = [owner, recipient, outsider]
  const secrets = {
    token: randomBytes(48).toString('base64url'),
    totp: randomBytes(48).toString('base64url'),
    invite: randomBytes(48).toString('base64url'),
    cursor: randomBytes(48).toString('base64url'),
    apiKey: randomBytes(48).toString('base64url'),
    bootstrap: randomBytes(48).toString('base64url'),
  }
  await writeFile(
    join(root, 'fixtures.private.json'),
    JSON.stringify(
      accounts.map((account) => ({
        label: account.label,
        email: account.email,
        password: account.password,
      })),
    ),
    { mode: 0o600 },
  )
  const report = {
    schemaVersion: 1,
    status: 'running',
    mode: 'local_actual_worker_d1_admin_browser',
    startedAt: new Date().toISOString(),
    sourceBefore: packet.source,
    inputs: packet.inputs,
    runtime: packet.runtime,
    syntheticOnly: true,
    remoteWrites: false,
    downloads: false,
    checks: [],
    http: [],
    mfa: { observations: [] },
    browser: {
      consoleErrorCount: 0,
      pageErrorCount: 0,
      externalRequestCount: 0,
    },
    native: packet.native
      ? { ...packet.native, checks: [] }
      : { status: 'not_run' },
    mail: {
      transport: 'run_owned_service_binding',
      acknowledgedCount: 0,
      actualMailboxReceipt: false,
      productionTemplateVerified: false,
    },
    exclusions: [
      'official Browser extension',
      'official Desktop',
      'actual email delivery',
      'staging',
      'backup/restore',
      'real-secret admission',
    ],
    privateRunRoot: relative(repoRoot, root),
    cleanup: {
      browserClosed: false,
      workerDisposed: false,
      proxyClosed: false,
      invitationRamCleared: false,
      ownedChildrenStopped: false,
    },
  }
  let phase = 'preparation'
  let worker
  let browser
  let browserServer
  let server
  let origin
  let database
  let nativeSession
  let ownerStepUp
  const deliveries = []
  const pendingResponses = new Set()
  const lastOtpSteps = new Map()
  const persistReport = async () =>
    writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2), {
      mode: 0o600,
    })
  const cleanupStep = (stage, action) => async () => {
    report.cleanup.activeStage = stage
    await persistReport()
    const deadlines = {
      owned_children: 4500,
      browser: 9000,
      proxy: 1500,
      worker: 3000,
      private_ram: 1000,
    }
    try {
      await beforeDeadline(
        action(),
        deadlines[stage],
        'cleanup_step_' + stage + '_deadline',
      )
    } catch (error) {
      report.cleanup.stepFailures ??= []
      report.cleanup.stepFailures.push(stage)
      throw error
    } finally {
      await persistReport()
    }
  }
  const cleanup = createIdempotentCleanup(async () => {
    await runCleanupSteps([
      cleanupStep('owned_children', async () => {
        await stopTrackedProcesses(activeProcesses)
        report.cleanup.ownedChildrenStopped = true
      }),
      cleanupStep('browser', async () => {
        const browserPid = browserServer?.process()?.pid
        const closed = await closeOwnedBrowserServer(browserServer)
        report.cleanup.browserCloseGraceful = closed.graceful
        report.cleanup.browserPublicKillCompleted = closed.publicKillCompleted
        report.cleanup.browserProcessGroupAbsent = closed.processGroupAbsent
        process.send?.({
          type: 'owned_process_done',
          pid: browserPid,
        })
        report.cleanup.browserClosed = true
        if (!closed.graceful) throw new SmokeFailure('browser_close_escalated')
      }),
      cleanupStep('proxy', async () => {
        if (server) {
          server.closeAllConnections()
          await new Promise((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          )
        }
        report.cleanup.proxyClosed = true
      }),
      cleanupStep('worker', async () => {
        if (worker) await worker.dispose()
        report.cleanup.workerDisposed = true
      }),
      cleanupStep('private_ram', async () => {
        deliveries.length = 0
        nativeSession = undefined
        for (const account of accounts) {
          account.token = undefined
          account.refresh = undefined
          account.factor = undefined
          account.userKey.fill(0)
          account.privateKey.fill(0)
        }
        report.cleanup.invitationRamCleared = deliveries.length === 0
      }),
    ])
    report.cleanup.activeStage = 'complete'
  })
  const boundedCleanup = async () => {
    await beforeDeadline(
      cleanup(),
      cleanupDeadlineMs,
      'cleanup_deadline_exceeded',
      () => {
        report.cleanupDeadlineExceeded = true
        process.send?.({ type: 'cleanup_timeout' })
      },
    )
  }
  const disposeSignalCleanup = installSignalCleanup(async () => {
    report.status = 'failed'
    report.failure = { phase, code: 'interrupted' }
    try {
      await boundedCleanup()
    } finally {
      report.finishedAt = new Date().toISOString()
      await writeFile(
        join(root, 'report.json'),
        JSON.stringify(report, null, 2),
        {
          mode: 0o600,
        },
      )
    }
  })
  const progress = (name) => {
    phase = name
    process.stdout.write(
      JSON.stringify({ status: 'running', phase: name }) + '\n',
    )
  }
  const check = async (name, action, surface = 'local_admin_ui') => {
    progress(name)
    await action()
    report.checks.push({ flow: name, surface, passed: true })
  }
  const api = async (path, method = 'GET', body, token, expected = 200) => {
    const headers = { ...(token ? { authorization: 'Bearer ' + token } : {}) }
    if (body !== undefined)
      headers['content-type'] =
        body instanceof URLSearchParams
          ? 'application/x-www-form-urlencoded'
          : 'application/json'
    const response = await worker.dispatchFetch(origin + path, {
      method,
      headers,
      ...(body === undefined
        ? {}
        : {
            body:
              body instanceof URLSearchParams
                ? body.toString()
                : JSON.stringify(body),
          }),
      redirect: 'manual',
    })
    report.http.push({
      surface: 'api_driver',
      method,
      path: safePath(new URL(origin + path).pathname),
      status: response.status,
    })
    invariant(
      (Array.isArray(expected) ? expected : [expected]).includes(
        response.status,
      ),
      'api_status_mismatch',
    )
    const text = await response.text()
    return text ? JSON.parse(text) : undefined
  }
  const freshOtp = async (account) => {
    invariant(typeof account.factor === 'string', 'totp_not_enrolled')
    const previous = lastOtpSteps.get(account.label) ?? -1
    await waitFor(
      () => Math.floor(Date.now() / 30000) > previous,
      'fresh_totp_timeout',
      35000,
    )
    const step = Math.floor(Date.now() / 30000)
    lastOtpSteps.set(account.label, step)
    return totp(account.factor, step)
  }
  const sync = async (account) =>
    api('/api/sync', 'GET', undefined, account.token)
  const organizationRows = (value) =>
    value.profile.Organizations ?? value.profile.organizations
  const navigateView = async (page, label) => {
    await page.getByRole('button', { name: label, exact: true }).first().click()
    await page.getByRole('heading', { name: label, exact: true }).waitFor()
  }
  const closeDialog = async (page) => {
    await waitFor(
      () =>
        page
          .locator('dialog[open]')
          .count()
          .then((count) => count === 0),
      'dialog_not_closed',
    )
  }
  const refreshPage = refreshWorkspaceFromUi
  const enroll = async (account) => {
    const page = account.page
    report.browser.lastAction = {
      actor: account.label,
      action: 'open_enrollment_security',
    }
    await page
      .getByRole('button', { name: 'アカウントのセキュリティ', exact: true })
      .click()
    await page
      .getByRole('button', { name: '認証アプリを登録', exact: true })
      .click()
    const dialog = page.getByRole('dialog', {
      name: '認証アプリを登録',
      exact: true,
    })
    report.browser.lastAction.action = 'start_totp_setup'
    await dialog
      .getByRole('button', { name: 'セットアップを開始', exact: true })
      .click()
    await dialog.locator('.setup-secret').waitFor({ state: 'visible' })
    account.factor = (
      await dialog.locator('.setup-secret').textContent()
    ).trim()
    invariant(
      /^[A-Z2-7]{16,128}$/.test(account.factor),
      'setup_seed_shape_invalid',
    )
    await dialog
      .getByLabel('新しい認証アプリの6桁コード', { exact: true })
      .fill(await freshOtp(account))
    report.browser.lastAction.action = 'verify_totp_setup'
    await dialog
      .getByRole('button', { name: '認証アプリを確認して保存', exact: true })
      .click()
    await closeDialog(page)
    report.browser.lastAction.action = 'assert_enrollment_family_assurance'
    const observation = await verifyEnrollmentAssurance(page, () =>
      api('/identity/accounts/totp/assurance', 'GET', undefined, account.token),
    )
    report.mfa.observations.push({
      actor: account.label,
      flow: 'ui_enrollment_assures_current_family',
      ...observation,
      passed: true,
    })
  }
  const safeScreenshot = async (page, name) => {
    invariant(
      (await page.locator('.setup-secret').count()) === 0 &&
        (await page.locator('dialog[open]').count()) === 0,
      'secret_dialog_screenshot_refused',
    )
    const masks = accounts.map((account) =>
      page.getByText(account.email, { exact: false }),
    )
    masks.push(page.locator('input'))
    await page.screenshot({
      path: join(root, name + '.masked.png'),
      fullPage: true,
      mask: masks,
    })
    await chmod(join(root, name + '.masked.png'), 0o600)
  }
  const native = async (args, environment = {}) => {
    const action = nativeCommandAction(args)
    invariant(action !== 'unsupported', 'native_action_unsupported')
    report.native.lastCommand = { action, status: 'running' }
    const dataFile = join(root, 'native/profile/data.json')
    let dataFileAbsent = false
    if (action === 'version') {
      try {
        await lstat(dataFile)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
        dataFileAbsent = true
      }
    }
    const result = await boundedCommand(
      options.nativeCli,
      args,
      {
        ...childEnvironment(root, join(root, 'certificate.pem')),
        ...environment,
      },
      45000,
    )
    try {
      const classification = classifyNativeStderr(
        result.stderr,
        dataFile,
        action === 'version' && dataFileAbsent,
      )
      report.native.lastCommand = {
        action,
        status: 'validating',
        exit: 'passed',
        stderrBytes: result.stderrBytes,
        stderrClassification: classification,
      }
      invariant(classification !== 'unexpected_stderr', 'native_stderr')
      if (classification === 'official_cli_first_profile_bootstrap')
        await verifyNativeBootstrapFile(dataFile)
      report.native.lastCommand.status = 'completed'
      return result.stdout.trim()
    } catch (error) {
      report.native.lastCommand.status = 'failed'
      throw error
    } finally {
      report.native.commandObservations ??= []
      report.native.commandObservations.push({ ...report.native.lastCommand })
      result.stderr.fill(0)
    }
  }
  const nativeReadback = async (account, shared, personal, expectShared) => {
    await native(['sync', '--force'], { BW_SESSION: nativeSession })
    const items = JSON.parse(
      await native(['list', 'items'], { BW_SESSION: nativeSession }),
    )
    invariant(
      items.some((item) => item.id === personal.id),
      'native_personal_missing',
    )
    const personalItem = items.find((item) => item.id === personal.id)
    invariant(
      personalItem.name === personal.expected.name &&
        personalItem.notes === personal.expected.notes &&
        personalItem.login.username === personal.expected.username &&
        personalItem.login.password === personal.expected.password &&
        personalItem.login.uris[0].uri === personal.expected.uri,
      'native_personal_decrypt_failed',
    )
    const sharedItem = items.find((item) => item.id === shared.id)
    invariant(
      Boolean(sharedItem) === expectShared,
      'native_shared_presence_failed',
    )
    if (expectShared)
      invariant(
        sharedItem.name === shared.expected.name &&
          sharedItem.notes === shared.expected.notes &&
          sharedItem.login.username === shared.expected.username &&
          sharedItem.login.password === shared.expected.password &&
          sharedItem.login.uris[0].uri === shared.expected.uri,
        'native_shared_decrypt_failed',
      )
    report.native.checks.push({
      flow: expectShared
        ? 'shared_and_personal_five_fields_decrypted'
        : 'shared_removed_personal_five_fields_retained',
      passed: true,
    })
  }
  try {
    const { build } = await import(
      pathToFileURL(packet.modules.esbuildPath).href
    )
    const { Miniflare, Log, LogLevel } = await import(
      pathToFileURL(packet.modules.miniflarePath).href
    )
    const bundle = join(root, 'worker.mjs')
    await build({
      entryPoints: [join(repoRoot, 'src/index.ts')],
      outfile: bundle,
      bundle: true,
      platform: 'browser',
      format: 'esm',
      target: 'es2022',
      external: ['cloudflare:workers', 'node:*'],
      logLevel: 'silent',
    })
    await chmod(bundle, 0o600)
    report.workerBundleSha256 = createHash('sha256')
      .update(await readFile(bundle))
      .digest('hex')
    worker = new Miniflare({
      modules: true,
      scriptPath: bundle,
      compatibilityDate: '2026-07-21',
      compatibilityFlags: ['nodejs_compat'],
      host: '127.0.0.1',
      port: 0,
      d1Databases: { DB: randomUUID() },
      r2Buckets: { VAULT_OBJECTS: randomUUID() },
      d1Persist: join(root, 'state', 'd1'),
      r2Persist: join(root, 'state', 'r2'),
      log: new Log(LogLevel.NONE),
      handleRuntimeStdio: (stdout, stderr) => {
        stdout.resume()
        stderr.resume()
      },
      bindings: {
        HONOWARDEN_ENV: 'development',
        HONOWARDEN_TOKEN_SECRET: secrets.token,
        HONOWARDEN_ADMIN_ENABLED: 'true',
        HONOWARDEN_BOOTSTRAP_ENABLED: 'true',
        HONOWARDEN_BOOTSTRAP_TOKEN: secrets.bootstrap,
        HONOWARDEN_ALLOWED_EMAILS: accounts
          .map((account) => account.email)
          .join(','),
        HONOWARDEN_USER_KEY_ID_ENABLED: 'true',
        HONOWARDEN_PREMIUM_FEATURES_ENABLED: 'true',
        HONOWARDEN_TOTP_SECRET: secrets.totp,
        HONOWARDEN_ORGANIZATION_INVITE_SECRET: secrets.invite,
        HONOWARDEN_ORGANIZATION_MEMBERSHIP_ENABLED: 'true',
        HONOWARDEN_ORGANIZATION_GROUPS_ENABLED: 'true',
        HONOWARDEN_ORGANIZATION_POLICIES_ENABLED: 'true',
        HONOWARDEN_ORGANIZATION_AUDIT_ENABLED: 'true',
        HONOWARDEN_ORGANIZATION_AUDIT_CURSOR_SECRET: secrets.cursor,
        HONOWARDEN_PERSONAL_API_KEYS_ENABLED: 'true',
        HONOWARDEN_API_KEY_SECRET: secrets.apiKey,
        HONOWARDEN_AUDIT_LOGS: 'false',
        HONOWARDEN_DURABLE_NOTIFICATIONS_ENABLED: 'false',
      },
      serviceBindings: {
        ADMIN_ASSETS: async (request) => {
          const path = new URL(request.url).pathname
          const name =
            path === '/index.html'
              ? 'index.html'
              : /^\/assets\/[A-Za-z0-9_.-]{1,200}\.(js|css|wasm)$/.test(path)
                ? path.slice(1)
                : undefined
          if (!name) return new Response(null, { status: 404 })
          const type =
            name === 'index.html'
              ? 'text/html'
              : mimeTypes[name.slice(name.lastIndexOf('.'))]
          return new Response(
            await readFile(join(repoRoot, 'dist/admin', name)),
            { headers: { 'content-type': type } },
          )
        },
        ORGANIZATION_MEMBERSHIP_MAILER: async (request) => {
          invariant(
            request.url ===
              'https://organization-membership-mailer.internal/deliver' &&
              request.method === 'POST',
            'unexpected_mailer_request',
          )
          const delivery = await request.json()
          invariant(
            delivery.recipientEmail === recipient.email &&
              /^[A-Za-z0-9_-]{43}$/.test(delivery.token),
            'unexpected_synthetic_recipient',
          )
          invariant(deliveries.length === 0, 'unexpected_duplicate_delivery')
          deliveries.push(delivery)
          report.mail.acknowledgedCount++
          return new Response(null, { status: 202 })
        },
      },
      outboundService: async () => {
        throw new SmokeFailure('worker_external_fetch_refused')
      },
    })
    await worker.ready
    database = await worker.getD1Database('DB')
    const migrations = (await readdir(join(repoRoot, 'migrations')))
      .filter((name) => name.endsWith('.sql'))
      .sort()
    invariant(
      migrations.some((name) => name.startsWith('0029_')),
      'migration_0029_required',
    )
    invariant(
      migrations.some((name) => name.startsWith('0030_')),
      'migration_0030_required',
    )
    for (const name of migrations)
      for (const sql of migrationStatements(
        await readFile(join(repoRoot, 'migrations', name), 'utf8'),
      ))
        await database.prepare(sql).run()
    report.migrations = {
      fileCount: migrations.length,
      through: migrations.at(-1).slice(0, 4),
      schemaRows: (
        await database
          .prepare('SELECT version FROM schema_migrations ORDER BY version')
          .all()
      ).results.length,
    }
    const openssl =
      '[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n[dn]\nCN=127.0.0.1\n[v3]\nsubjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=critical,CA:true\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\n'
    await writeFile(join(root, 'openssl.cnf'), openssl, { mode: 0o600 })
    await boundedCommand(
      '/usr/bin/openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-sha256',
        '-days',
        '1',
        '-nodes',
        '-keyout',
        join(root, 'private-key.pem'),
        '-out',
        join(root, 'certificate.pem'),
        '-config',
        join(root, 'openssl.cnf'),
      ],
      childEnvironment(root, undefined),
    )
    await chmod(join(root, 'private-key.pem'), 0o600)
    await chmod(join(root, 'certificate.pem'), 0o600)
    server = createServer(
      {
        key: await readFile(join(root, 'private-key.pem')),
        cert: await readFile(join(root, 'certificate.pem')),
      },
      async (request, response) => {
        try {
          const chunks = []
          let bytes = 0
          for await (const chunk of request) {
            bytes += chunk.length
            invariant(bytes <= 1024 * 1024, 'proxy_body_too_large')
            chunks.push(chunk)
          }
          const result = await worker.dispatchFetch(origin + request.url, {
            method: request.method,
            headers: request.headers,
            ...(['GET', 'HEAD'].includes(request.method)
              ? {}
              : { body: Buffer.concat(chunks) }),
            redirect: 'manual',
          })
          response.writeHead(result.status, Object.fromEntries(result.headers))
          response.end(Buffer.from(await result.arrayBuffer()))
        } catch {
          response
            .writeHead(503, { 'content-type': 'application/json' })
            .end('{"error":{"code":"synthetic_proxy_unavailable"}}')
        }
      },
    )
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    origin = 'https://127.0.0.1:' + server.address().port
    for (const account of accounts) {
      const response = await worker.dispatchFetch(
        origin + '/api/accounts/bootstrap',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-honowarden-bootstrap-token': secrets.bootstrap,
          },
          body: JSON.stringify({
            email: account.email,
            displayName: 'Synthetic ' + account.label,
            masterPasswordHash: account.hash,
            userKey: account.wrappedUserKey,
            publicKey: account.publicKey,
            privateKey: account.wrappedPrivateKey,
          }),
        },
      )
      invariant(response.status === 201, 'bootstrap_failed')
      account.id = (await response.json()).id
    }
    ownerStepUp = {
      ...owner,
      label: 'owner_stepup',
      userKey: Buffer.from(owner.userKey),
      privateKey: Buffer.from(owner.privateKey),
    }
    accounts.push(ownerStepUp)
    const { chromium } = await import(
      pathToFileURL(options.playwrightModule).href
    )
    browserServer = await chromium.launchServer({
      executablePath: options.browserExecutable,
      headless: true,
      timeout: 20000,
      args: [
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
        '--proxy-server=http://127.0.0.1:9',
        '--proxy-bypass-list=localhost;127.0.0.1;[::1]',
      ],
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: root,
        TMPDIR: join(root, 'native/tmp'),
        LANG: 'en_US.UTF-8',
      },
    })
    process.send?.({ type: 'owned_process', pid: browserServer.process()?.pid })
    browser = await chromium.connect(browserServer.wsEndpoint(), {
      timeout: 20000,
    })
    report.browser.tlsVerification = 'run_owned_context_exception'
    report.native.tlsVerification = 'strict_run_owned_certificate_authority'
    report.browser.hostVersion = browser.version()
    report.browser.playwrightVersion = JSON.parse(
      await readFile(
        join(dirname(options.playwrightModule), 'package.json'),
        'utf8',
      ),
    ).version
    for (const account of [owner, recipient, ownerStepUp]) {
      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        acceptDownloads: true,
        viewport: { width: 1440, height: 1000 },
      })
      await context.route('**/*', async (route) => {
        if (new URL(route.request().url()).origin === origin)
          await route.continue()
        else {
          report.browser.externalRequestCount++
          await route.abort('blockedbyclient')
        }
      })
      account.page = await context.newPage()
      account.page.setDefaultTimeout(20000)
      account.page.on('console', (message) => {
        if (message.type() === 'error') report.browser.consoleErrorCount++
      })
      account.page.on('pageerror', () => {
        report.browser.pageErrorCount++
      })
      account.page.on('response', (response) => {
        const path = new URL(response.url()).pathname
        report.http.push({
          surface: account.label + '_admin_browser',
          method: response.request().method(),
          path: safePath(path),
          status: response.status(),
        })
        if (path === '/identity/connect/token' && response.status() === 200) {
          const capture = response
            .json()
            .then((value) => {
              account.token = value.access_token
              account.refresh = value.refresh_token
            })
            .catch(() => {
              report.browser.tokenCaptureFailureCount =
                (report.browser.tokenCaptureFailureCount ?? 0) + 1
            })
          pendingResponses.add(capture)
          capture.finally(() => pendingResponses.delete(capture))
        }
      })
    }
    const login = async (account, path = '/admin/') => {
      report.browser.lastAction = {
        actor: account.label,
        action: 'navigate_login',
      }
      await account.page.goto(origin + path)
      report.browser.lastAction.action = 'fill_login_email'
      await account.page
        .getByLabel('メールアドレス', { exact: true })
        .fill(account.email)
      report.browser.lastAction.action = 'fill_login_password'
      await account.page
        .getByLabel('マスターパスワード', { exact: true })
        .fill(account.password)
      report.browser.lastAction.action = 'submit_login'
      await account.page
        .getByRole('button', { name: 'サインイン', exact: true })
        .click()
      report.browser.lastAction.action = 'await_authenticated_ui'
      await account.page
        .getByRole('button', { name: 'サインアウト', exact: true })
        .waitFor()
      await Promise.all(pendingResponses)
      invariant(
        typeof account.token === 'string' && account.token.length > 0,
        'browser_token_not_observed',
      )
    }
    await companyFlow({
      owner,
      ownerStepUp,
      recipient,
      outsider,
      api,
      sync,
      organizationRows,
      check,
      navigateView,
      closeDialog,
      refreshPage,
      enroll,
      safeScreenshot,
      native,
      nativeReadback,
      freshOtp,
      login,
      root,
      database,
      report,
      deliveries,
      options,
      origin,
      setNativeSession: (session) => {
        nativeSession = session
      },
    })
    invariant(
      report.browser.externalRequestCount === 0 &&
        report.browser.pageErrorCount === 0,
      'browser_unexpected_failure',
    )
    report.status = 'flow_passed_cleanup_pending'
  } catch (error) {
    report.status = 'failed'
    report.failure = {
      phase,
      code: error instanceof SmokeFailure ? error.code : 'runtime_failure',
      errorType: [
        'Error',
        'TimeoutError',
        'TypeError',
        'RangeError',
        'SmokeFailure',
      ].includes(error?.name)
        ? error.name
        : 'OtherError',
      classification: safeErrorClassification(error),
    }
    await writeFile(
      join(root, 'failure.private.json'),
      JSON.stringify(report.failure),
      { mode: 0o600 },
    )
    await writeFile(
      join(root, 'report.json'),
      JSON.stringify(report, null, 2),
      { mode: 0o600 },
    )
    try {
      await beforeDeadline(
        (async () => {
          report.browser.failureDom = []
          for (const account of [owner, recipient, ownerStepUp].filter(
            Boolean,
          )) {
            if (!account.page) continue
            report.browser.failureDom.push({
              actor: account.label,
              path: safePath(new URL(account.page.url()).pathname),
              loginEmailFields: await account.page
                .getByLabel('メールアドレス', { exact: true })
                .count(),
              loginPasswordFields: await account.page
                .getByLabel('マスターパスワード', { exact: true })
                .count(),
              logoutButtons: await account.page
                .getByRole('button', { name: 'サインアウト', exact: true })
                .count(),
              openDialogCount: await account.page
                .locator('dialog[open]')
                .count(),
              secretSetupPresent:
                (await account.page.locator('.setup-secret').count()) > 0,
            })
          }
          await writeFile(
            join(root, 'report.json'),
            JSON.stringify(report, null, 2),
            { mode: 0o600 },
          )
        })(),
        5000,
        'failure_diagnostics_deadline',
      )
    } catch {
      report.browser.failureDiagnosticsUnavailable = true
    }
  } finally {
    try {
      await boundedCleanup()
    } catch {
      report.status = 'failed'
      report.cleanupFailed = true
    }
    disposeSignalCleanup()
    try {
      report.sourceAfter = await beforeDeadline(
        sourceFingerprint(),
        5000,
        'source_readback_deadline',
      )
      report.sourceUnchanged =
        report.sourceBefore.sha256 === report.sourceAfter.sha256
    } catch {
      report.sourceUnchanged = false
      report.sourceReadbackFailure = 'source_readback_failed'
    }
    if (!report.sourceUnchanged) report.status = 'failed'
    if (report.status === 'flow_passed_cleanup_pending')
      report.status = 'passed'
    report.finishedAt = new Date().toISOString()
    await writeFile(
      join(root, 'report.json'),
      JSON.stringify(report, null, 2),
      { mode: 0o600 },
    )
  }
  return report
}

async function companyFlow(context) {
  const {
    owner,
    ownerStepUp,
    recipient,
    outsider,
    api,
    sync,
    organizationRows,
    check,
    navigateView,
    closeDialog,
    refreshPage,
    enroll,
    safeScreenshot,
    native,
    nativeReadback,
    freshOtp,
    login,
    root,
    database,
    report,
    deliveries,
    options,
    origin,
    setNativeSession,
  } = context
  const orgName = 'Synthetic company acceptance'
  const collectionName = 'Synthetic shared collection'
  const additionalName = 'Synthetic second collection'
  let orgId
  let collectionId
  let recipientMembershipId
  let organizationKey
  let shared
  let personal
  let currentCipher
  const ownerPage = owner.page
  const recipientPage = recipient.page
  const loadRecipientCollections = async () => {
    await refreshPage(recipientPage)
    await navigateView(recipientPage, 'コレクション')
    await recipientPage.getByText(collectionName, { exact: true }).waitFor()
  }
  const changeDirectGrant = async (mode) => {
    await navigateView(ownerPage, 'メンバー')
    await ownerPage
      .getByRole('button', {
        name: recipient.email + 'の詳細とアクセスを確認',
        exact: true,
      })
      .click()
    const dialog = ownerPage.getByRole('dialog', {
      name: 'メンバーのアクセス',
      exact: true,
    })
    if (mode === 'writable')
      await dialog
        .getByLabel(collectionName + ': 閲覧のみ', { exact: true })
        .uncheck()
    else
      await dialog
        .getByLabel(collectionName + 'にアクセスを割り当てる', { exact: true })
        .uncheck()
    await dialog
      .getByRole('button', { name: '変更を保存', exact: true })
      .click()
    if (mode === 'remove') {
      await dialog
        .getByText('直接の割当をすべて取り除きます', { exact: true })
        .waitFor()
      await dialog
        .getByRole('button', { name: '変更を保存', exact: true })
        .click()
    }
    await closeDialog(ownerPage)
  }
  await check('owner_password_login_and_unlock', async () => {
    await login(owner)
    const initial = await sync(owner)
    invariant(organizationRows(initial).length === 0, 'organization_was_seeded')
    await login(ownerStepUp)
    report.mfa.distinctOwnerFamilies = assertDistinctBrowserFamilies(
      owner.token,
      ownerStepUp.token,
    )
    for (const account of [owner, ownerStepUp]) {
      const assurance = await api(
        '/identity/accounts/totp/assurance',
        'GET',
        undefined,
        account.token,
      )
      invariant(assurance.verified === false, 'pre_enrollment_family_assured')
    }
  })
  await check(
    'browser_creates_organization_and_encrypted_collection',
    async () => {
      await ownerPage
        .getByRole('button', { name: '組織を作成', exact: true })
        .click()
      const dialog = ownerPage.getByRole('dialog', {
        name: '組織を作成',
        exact: true,
      })
      await dialog.getByLabel('組織名', { exact: true }).fill(orgName)
      await dialog
        .getByLabel('最初のコレクション名', { exact: true })
        .fill(collectionName)
      await dialog
        .getByRole('button', { name: '組織を作成', exact: true })
        .click()
      await closeDialog(ownerPage)
      const rows = await database.prepare('SELECT id FROM organizations').all()
      invariant(
        rows.results.length === 1,
        'ui_organization_create_not_persisted',
      )
      orgId = rows.results[0].id
      const membership = await database
        .prepare(
          'SELECT org_key FROM organization_users WHERE organization_id = ? AND user_id = ?',
        )
        .bind(orgId, owner.id)
        .first()
      organizationKey = unwrap(owner.privateKey, membership.org_key)
      invariant(organizationKey.length === 64, 'browser_owner_key_invalid')
      const collections = await database
        .prepare(
          'SELECT id, encrypted_name FROM collections WHERE organization_id = ?',
        )
        .bind(orgId)
        .all()
      invariant(
        collections.results.length === 1 &&
          collections.results[0].encrypted_name !== collectionName,
        'collection_name_not_encrypted',
      )
      collectionId = collections.results[0].id
      invariant(
        decrypt(
          organizationKey,
          collections.results[0].encrypted_name,
        ).toString() === collectionName,
        'browser_collection_decrypt_failed',
      )
      await navigateView(ownerPage, 'コレクション')
      await ownerPage.getByText(collectionName, { exact: true }).waitFor()
      await ownerPage
        .getByRole('button', { name: 'コレクションを作成', exact: true })
        .click()
      const collectionDialog = ownerPage.getByRole('dialog', {
        name: 'コレクションを作成',
        exact: true,
      })
      await collectionDialog
        .getByLabel('コレクション名', { exact: true })
        .fill(additionalName)
      await collectionDialog
        .getByRole('button', { name: '作成する', exact: true })
        .click()
      await closeDialog(ownerPage)
      const persisted = await database
        .prepare(
          'SELECT encrypted_name FROM collections WHERE organization_id = ?',
        )
        .bind(orgId)
        .all()
      invariant(
        persisted.results.length === 2 &&
          persisted.results.every((row) => row.encrypted_name.startsWith('2.')),
        'additional_collection_not_encrypted',
      )
      invariant(
        persisted.results.some(
          (row) =>
            decrypt(organizationKey, row.encrypted_name).toString() ===
            additionalName,
        ),
        'additional_collection_decrypt_failed',
      )
      await safeScreenshot(ownerPage, 'collections')
    },
  )
  await check(
    'ui_invite_delivery_capture_and_authenticated_acceptance',
    async () => {
      await navigateView(ownerPage, 'メンバー')
      await ownerPage
        .getByRole('button', { name: 'メンバーを招待', exact: true })
        .click()
      const dialog = ownerPage.getByRole('dialog', {
        name: 'メンバーを招待',
        exact: true,
      })
      await dialog
        .getByLabel('メールアドレス（20名まで）', { exact: true })
        .fill(recipient.email)
      await dialog
        .getByLabel(collectionName + 'にアクセスを割り当てる', { exact: true })
        .check()
      await dialog
        .getByRole('button', { name: '招待を作成', exact: true })
        .click()
      await closeDialog(ownerPage)
      invariant(
        deliveries.length === 1 && report.mail.acknowledgedCount === 1,
        'invitation_ack_missing',
      )
      const delivery = deliveries[0]
      recipientMembershipId = delivery.membershipId
      const invited = await database
        .prepare('SELECT status, org_key FROM organization_users WHERE id = ?')
        .bind(recipientMembershipId)
        .first()
      invariant(
        invited.status === 0 && invited.org_key === null,
        'invited_state_invalid',
      )
      await login(
        recipient,
        '/admin/accept/' +
          orgId +
          '/' +
          recipientMembershipId +
          '#token=' +
          delivery.token,
      )
      invariant(
        new URL(recipientPage.url()).hash === '',
        'invitation_fragment_not_consumed',
      )
      await recipientPage
        .getByRole('button', { name: '招待を承諾する', exact: true })
        .click()
      await recipientPage
        .getByText('招待を承諾しました', { exact: true })
        .waitFor()
      const accepted = await database
        .prepare(
          'SELECT status, org_key, invite_token_hash, invite_expires_at FROM organization_users WHERE id = ?',
        )
        .bind(recipientMembershipId)
        .first()
      invariant(
        accepted.status === 1 &&
          accepted.org_key === null &&
          accepted.invite_token_hash === null &&
          accepted.invite_expires_at === null,
        'accepted_state_invalid',
      )
      const before = await sync(recipient)
      invariant(
        organizationRows(before).length === 0 &&
          before.collections.length === 0,
        'unconfirmed_shared_access',
      )
      report.mail.invitationFragmentConsumed = true
    },
  )
  await check(
    'owner_browser_wraps_recipient_key_and_recipient_ui_decrypts',
    async () => {
      await refreshPage(ownerPage)
      await ownerPage
        .getByRole('button', {
          name: recipient.email + 'の参加を確認',
          exact: true,
        })
        .click()
      const dialog = ownerPage.getByRole('dialog', {
        name: '参加を確認',
        exact: true,
      })
      await dialog
        .getByRole('button', { name: '参加を確認', exact: true })
        .click()
      await closeDialog(ownerPage)
      const confirmed = await database
        .prepare('SELECT status, org_key FROM organization_users WHERE id = ?')
        .bind(recipientMembershipId)
        .first()
      invariant(
        confirmed.status === 2 &&
          unwrap(recipient.privateKey, confirmed.org_key).equals(
            organizationKey,
          ),
        'recipient_browser_key_confirm_failed',
      )
      await loadRecipientCollections()
      const observed = await sync(recipient)
      invariant(
        organizationRows(observed).length === 1 &&
          observed.collections.some(
            (row) => (row.id ?? row.Id) === collectionId,
          ),
        'confirmed_collection_missing',
      )
    },
  )
  await check(
    'actual_cipher_api_readonly_denial_and_ui_writable_grant',
    async () => {
      personal = cipherFixture(recipient.userKey, 'personal-canary')
      personal.id = (
        await api(
          '/api/ciphers',
          'POST',
          personal.payload,
          recipient.token,
          201,
        )
      ).id
      shared = cipherFixture(organizationKey, 'shared-canary', orgId)
      currentCipher = await api(
        '/api/ciphers/create',
        'POST',
        { cipher: shared.payload, collectionIds: [collectionId] },
        owner.token,
      )
      shared.id = currentCipher.id
      const readonly = await api(
        '/api/ciphers/' + shared.id,
        'GET',
        undefined,
        recipient.token,
      )
      invariant(
        readonly.edit === false && readonly.viewPassword === true,
        'readonly_projection_invalid',
      )
      assertDecryptedCipher(readonly, organizationKey, shared.expected)
      await api(
        '/api/ciphers/' + shared.id,
        'PUT',
        {
          ...shared.payload,
          favorite: true,
          edit: true,
          lastKnownRevisionDate: currentCipher.revisionDate,
        },
        recipient.token,
        404,
      )
      await changeDirectGrant('writable')
      currentCipher = await api(
        '/api/ciphers/' + shared.id,
        'PUT',
        {
          ...shared.payload,
          favorite: true,
          lastKnownRevisionDate: currentCipher.revisionDate,
        },
        recipient.token,
      )
      invariant(
        currentCipher.favorite === true && currentCipher.edit === true,
        'writable_member_mutation_failed',
      )
      assertDecryptedCipher(currentCipher, organizationKey, shared.expected)
    },
    'local_admin_ui_and_api',
  )
  await check(
    'ui_group_grants_replace_direct_grants',
    async () => {
      await navigateView(ownerPage, 'グループ')
      await ownerPage
        .getByRole('button', { name: 'グループを作成', exact: true })
        .click()
      const dialog = ownerPage.getByRole('dialog', {
        name: 'グループを作成',
        exact: true,
      })
      await dialog
        .getByLabel('グループ名', { exact: true })
        .fill('Synthetic company group')
      await dialog
        .getByLabel(recipient.email + 'をグループに含める', { exact: true })
        .check()
      await dialog
        .getByLabel(collectionName + 'にアクセスを割り当てる', { exact: true })
        .check()
      await dialog
        .getByLabel(collectionName + ': 閲覧のみ', { exact: true })
        .uncheck()
      await dialog
        .getByRole('button', { name: '作成する', exact: true })
        .click()
      await closeDialog(ownerPage)
      await changeDirectGrant('remove')
      const direct = await database
        .prepare(
          'SELECT collection_id FROM collection_users WHERE organization_user_id = ?',
        )
        .bind(recipientMembershipId)
        .all()
      invariant(direct.results.length === 0, 'direct_grant_was_not_removed')
      const groups = await database
        .prepare(
          'SELECT group_id FROM organization_group_users WHERE organization_user_id = ?',
        )
        .bind(recipientMembershipId)
        .all()
      invariant(groups.results.length === 1, 'group_membership_not_persisted')
      await loadRecipientCollections()
      currentCipher = await api(
        '/api/ciphers/' + shared.id,
        'PUT',
        {
          ...shared.payload,
          favorite: false,
          lastKnownRevisionDate: currentCipher.revisionDate,
        },
        recipient.token,
      )
      invariant(
        currentCipher.favorite === false && currentCipher.edit === true,
        'group_only_write_failed',
      )
      assertDecryptedCipher(currentCipher, organizationKey, shared.expected)
      await navigateView(ownerPage, 'グループ')
      await safeScreenshot(ownerPage, 'groups')
    },
    'local_admin_ui_and_api',
  )
  if (options.nativeCli)
    await check(
      'pinned_native_cli_decrypts_browser_created_shared_keys',
      async () => {
        invariant(
          (await native(['--version'])) === report.native.version,
          'native_version_mismatch',
        )
        await native(['config', 'server', origin])
        setNativeSession(
          await native(
            [
              'login',
              recipient.email,
              '--passwordenv',
              'BW_PASSWORD',
              '--raw',
              '--nointeraction',
            ],
            { BW_PASSWORD: recipient.password },
          ),
        )
        await nativeReadback(recipient, shared, personal, true)
      },
      'local_official_client',
    )
  await check(
    'owner_ui_totp_enrollment_stepup_and_required_policy',
    async () => {
      await enroll(owner)
      report.browser.lastAction = {
        actor: 'owner_stepup',
        action: 'perform_distinct_family_ui_stepup',
      }
      const observation = await completeDistinctFamilyStepUpUi({
        page: ownerStepUp.page,
        refreshPage,
        readProfile: () =>
          api('/api/accounts/profile', 'GET', undefined, ownerStepUp.token),
        readAssurance: () =>
          api(
            '/identity/accounts/totp/assurance',
            'GET',
            undefined,
            ownerStepUp.token,
          ),
        getFreshCode: () => freshOtp(owner),
        closeDialog,
      })
      invariant(
        report.http.some(
          (entry) =>
            entry.surface === 'owner_stepup_admin_browser' &&
            entry.method === 'POST' &&
            entry.path === '/identity/accounts/totp/step-up' &&
            entry.status === 200,
        ),
        'owner_stepup_http_not_observed',
      )
      report.mfa.observations.push({
        actor: 'owner_stepup',
        flow: 'ui_stepup_assures_distinct_owner_family',
        ...observation,
        passed: true,
      })
      await navigateView(ownerPage, 'セキュリティ')
      await ownerPage
        .getByRole('button', { name: '認証アプリを必須にする', exact: true })
        .click()
      const dialog = ownerPage.getByRole('dialog', {
        name: '認証アプリを必須にする',
        exact: true,
      })
      await dialog
        .getByRole('button', { name: '必須にする', exact: true })
        .click()
      await closeDialog(ownerPage)
      const policies = await database
        .prepare(
          'SELECT enabled FROM organization_policies WHERE organization_id = ?',
        )
        .bind(orgId)
        .all()
      invariant(
        policies.results.length === 1 && policies.results[0].enabled === 1,
        'required_policy_not_persisted',
      )
      await safeScreenshot(ownerPage, 'policy')
    },
  )
  await check(
    'policy_denies_old_browser_refresh_and_api_key_families',
    async () => {
      const blocked = await sync(recipient)
      invariant(
        organizationRows(blocked).length === 0 &&
          blocked.collections.length === 0 &&
          !blocked.ciphers.some((cipher) => cipher.id === shared.id),
        'old_browser_family_retained_shared_access',
      )
      await api(
        '/api/ciphers/' + shared.id,
        'GET',
        undefined,
        recipient.token,
        404,
      )
      const refresh = await api(
        '/identity/connect/token',
        'POST',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: recipient.refresh,
        }),
      )
      recipient.token = refresh.access_token
      recipient.refresh = refresh.refresh_token
      const refreshed = await sync(recipient)
      invariant(
        organizationRows(refreshed).length === 0 &&
          !refreshed.ciphers.some((cipher) => cipher.id === shared.id),
        'unassured_refresh_gained_shared_access',
      )
      const key = await api(
        '/api/accounts/api-key',
        'POST',
        { masterPasswordHash: owner.hash },
        owner.token,
      )
      const grant = await api(
        '/identity/connect/token',
        'POST',
        new URLSearchParams({
          grant_type: 'client_credentials',
          scope: 'api',
          client_id: key.clientId,
          client_secret: key.apiKey,
          deviceIdentifier: randomUUID(),
          deviceType: '8',
          deviceName: 'Synthetic API-only family',
        }),
      )
      const assurance = await api(
        '/identity/accounts/totp/assurance',
        'GET',
        undefined,
        grant.access_token,
      )
      invariant(assurance.verified === false, 'api_key_family_was_assured')
      const result = await api(
        '/api/sync',
        'GET',
        undefined,
        grant.access_token,
      )
      invariant(
        organizationRows(result).length === 0 &&
          !result.ciphers.some((cipher) => cipher.id === shared.id),
        'api_key_family_gained_shared_access',
      )
      await api(
        '/api/organizations/' + orgId + '/audit-events',
        'GET',
        undefined,
        grant.access_token,
        404,
      )
      report.policy = {
        oldFamilyDenied: true,
        unassuredRefreshDenied: true,
        compliantAccountApiKeyFamilyDenied: true,
      }
      if (options.nativeCli)
        await nativeReadback(recipient, shared, personal, false)
    },
    'local_api_and_official_client',
  )
  await check(
    'recipient_ui_totp_remediation_restores_only_assured_family',
    async () => {
      await refreshPage(recipientPage)
      await enroll(recipient)
      // The UI still owns its original family; the deliberately rotated test family
      // has the same immutable session ID and must observe the same assurance.
      const value = await sync(recipient)
      invariant(
        organizationRows(value).length === 1 &&
          value.ciphers.some((cipher) => cipher.id === shared.id),
        'remediated_family_missing_shared_access',
      )
      await loadRecipientCollections()
      const fresh = await api(
        '/identity/connect/token',
        'POST',
        new URLSearchParams({
          grant_type: 'password',
          username: outsider.email,
          password: outsider.hash,
          scope: 'api offline_access',
          deviceIdentifier: randomUUID(),
          deviceType: '8',
          deviceName: 'Synthetic outsider',
        }),
      )
      await api(
        '/api/organizations/' + orgId + '/users',
        'GET',
        undefined,
        fresh.access_token,
        404,
      )
      await api(
        '/api/ciphers/' + shared.id,
        'GET',
        undefined,
        fresh.access_token,
        404,
      )
    },
    'local_admin_ui_and_api',
  )
  if (options.nativeCli)
    await check(
      'native_totp_login_restores_shared_decryption',
      async () => {
        await native(['logout'])
        setNativeSession(
          await native(
            [
              'login',
              recipient.email,
              '--passwordenv',
              'BW_PASSWORD',
              '--method',
              '0',
              '--code',
              await freshOtp(recipient),
              '--raw',
              '--nointeraction',
            ],
            { BW_PASSWORD: recipient.password },
          ),
        )
        await nativeReadback(recipient, shared, personal, true)
      },
      'local_official_client',
    )
  await check(
    'ui_offboarding_removes_shared_access_preserves_personal',
    async () => {
      await navigateView(ownerPage, 'メンバー')
      await ownerPage
        .getByRole('button', {
          name: recipient.email + 'の詳細とアクセスを確認',
          exact: true,
        })
        .click()
      await ownerPage
        .getByRole('button', { name: 'アクセスを取り消す', exact: true })
        .click()
      const dialog = ownerPage.getByRole('dialog', {
        name: 'アクセスを取り消す',
        exact: true,
      })
      await dialog
        .getByRole('button', { name: 'アクセスを取り消す', exact: true })
        .click()
      await closeDialog(ownerPage)
      const revoked = await database
        .prepare(
          'SELECT status, org_key, invite_token_hash, invite_expires_at FROM organization_users WHERE id = ?',
        )
        .bind(recipientMembershipId)
        .first()
      invariant(
        revoked.status === -1 &&
          revoked.org_key === null &&
          revoked.invite_token_hash === null &&
          revoked.invite_expires_at === null,
        'revoked_state_invalid',
      )
      const value = await sync(recipient)
      invariant(
        organizationRows(value).length === 0 &&
          value.collections.length === 0 &&
          !value.ciphers.some((cipher) => cipher.id === shared.id),
        'revoked_shared_projection_retained',
      )
      const personalCipher = value.ciphers.find(
        (cipher) => cipher.id === personal.id,
      )
      invariant(Boolean(personalCipher), 'personal_cipher_lost_on_revoke')
      assertDecryptedCipher(
        personalCipher,
        recipient.userKey,
        personal.expected,
      )
      await api(
        '/api/ciphers/' + shared.id,
        'GET',
        undefined,
        recipient.token,
        404,
      )
      await api(
        '/api/ciphers/' + shared.id,
        'PUT',
        {
          ...shared.payload,
          lastKnownRevisionDate: currentCipher.revisionDate,
        },
        recipient.token,
        404,
      )
      await refreshPage(recipientPage)
      if (options.nativeCli)
        await nativeReadback(recipient, shared, personal, false)
    },
    'local_admin_ui_api_and_official_client',
  )
  await check(
    'ui_scoped_audit_query_and_actual_csv_export',
    async () => {
      await navigateView(ownerPage, '監査')
      await ownerPage.getByRole('button', { name: '検索', exact: true }).click()
      await ownerPage.getByText('認証ポリシーを変更', { exact: true }).waitFor()
      const downloadPromise = ownerPage.waitForEvent('download')
      await ownerPage
        .getByRole('button', { name: '検索範囲をCSV出力', exact: true })
        .click()
      const download = await downloadPromise
      const output = join(root, 'audit.private.csv')
      await download.saveAs(output)
      await chmod(output, 0o600)
      const csv = await readFile(output, 'utf8')
      const expected = [
        'organization.member.invite',
        'organization.member.accept',
        'organization.member.confirm',
        'organization.member.update',
        'organization.member.revoke',
        'organization.group.create',
        'organization.policy.update',
      ]
      invariant(
        expected.every((name) => csv.includes('"' + name + '"')),
        'audit_expected_events_missing',
      )
      for (const sensitive of [
        owner.password,
        recipient.password,
        owner.hash,
        recipient.hash,
        organizationKey.toString('base64'),
        ...deliveries.map((delivery) => delivery.token),
      ])
        invariant(!csv.includes(sensitive), 'audit_csv_contains_secret')
      const rows = await database
        .prepare(
          "SELECT name, COUNT(*) AS count FROM audit_events WHERE json_extract(context_json, '$.organizationId') = ? GROUP BY name",
        )
        .bind(orgId)
        .all()
      const counts = Object.fromEntries(
        rows.results.map((row) => [row.name, row.count]),
      )
      for (const name of expected.filter(
        (name) => name !== 'organization.member.update',
      ))
        invariant(counts[name] === 1, 'audit_event_not_exactly_once')
      invariant(
        counts['organization.member.update'] === 2,
        'audit_grant_update_count_invalid',
      )
      await api(
        '/api/organizations/' + orgId + '/audit-events',
        'GET',
        undefined,
        recipient.token,
        404,
      )
      report.audit = {
        scopedEventCounts: counts,
        csvHasExpectedEvents: true,
        csvSecretExcluded: true,
      }
      await safeScreenshot(ownerPage, 'audit')
    },
    'local_admin_ui_and_api',
  )
  await check('browser_lock_unlock_and_owned_session_logout', async () => {
    await ownerPage.getByRole('button', { name: 'ロック', exact: true }).click()
    await ownerPage
      .getByRole('heading', { name: 'ロックを解除', exact: true })
      .waitFor()
    await ownerPage
      .getByLabel('マスターパスワード', { exact: true })
      .fill(owner.password)
    await ownerPage
      .getByRole('button', { name: 'ロックを解除', exact: true })
      .click()
    await ownerPage
      .getByRole('button', { name: 'サインアウト', exact: true })
      .waitFor()
    const previous = owner.token
    await ownerPage
      .getByRole('button', { name: 'サインアウト', exact: true })
      .click()
    await ownerPage
      .getByRole('heading', { name: '組織管理にサインイン', exact: true })
      .waitFor()
    await api('/api/accounts/profile', 'GET', undefined, previous, 401)
    const previousStepUp = ownerStepUp.token
    await ownerStepUp.page
      .getByRole('button', { name: 'サインアウト', exact: true })
      .click()
    await ownerStepUp.page
      .getByRole('heading', { name: '組織管理にサインイン', exact: true })
      .waitFor()
    await api('/api/accounts/profile', 'GET', undefined, previousStepUp, 401)
    report.mfa.ownerStepUpFamilyLoggedOut = true
    if (options.nativeCli) {
      await native(['logout'])
      report.native.status = 'passed'
    }
  })
}

async function main(args) {
  const options = parseOptions(args)
  const packet = await preparation(options)
  if (options.action === 'plan') {
    packet.next = {
      confirmation,
      arguments: [
        'run',
        '--run-root',
        options.runRoot,
        '--source-sha256',
        packet.source.sha256,
        '--playwright-module',
        options.playwrightModule,
        '--browser-executable',
        options.browserExecutable,
        ...(options.nativeCli
          ? ['--native-cli', options.nativeCli]
          : ['--without-native']),
        '--execute',
        '--confirm',
        confirmation,
      ],
    }
    process.stdout.write(JSON.stringify(packet, null, 2) + '\n')
    return
  }
  if (typeof process.send !== 'function') {
    await supervise(args, options)
    return
  }
  const report = await execute(options, packet)
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  if (report.status !== 'passed') process.exitCode = 1
}

async function supervise(args, options) {
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), ...args],
    {
      cwd: repoRoot,
      detached: true,
      env: childEnvironment(ownedRunPath(options.runRoot), undefined),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  )
  const groups = new Map([[child.pid, child]])
  let ownershipNonce
  let resolveCleanupDeadline
  const cleanupDeadline = new Promise((resolve) => {
    resolveCleanupDeadline = resolve
  })
  const cleanup = createIdempotentCleanup(async () => {
    const outcomes = await Promise.allSettled(
      [...groups.values()].map((owned) => stopDetachedProcessTree(owned)),
    )
    invariant(
      outcomes.every((result) => result.status === 'fulfilled'),
      'supervisor_cleanup_failed',
    )
  })
  const disposeSignals = installSignalCleanup(cleanup)
  child.on('message', (message) => {
    if (
      message?.type === 'owned_root' &&
      /^[0-9a-f-]{36}$/.test(message.nonce ?? '') &&
      ownershipNonce === undefined
    ) {
      ownershipNonce = message.nonce
      return
    }
    if (message?.type === 'cleanup_timeout') {
      resolveCleanupDeadline({ cleanupTimeout: true })
      return
    }
    const pid = message?.pid
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) return
    if (message.type === 'owned_process' && groups.size < 16) {
      groups.set(pid, {
        pid,
        exitCode: null,
        signalCode: null,
        kill: (signal) => {
          try {
            process.kill(pid, signal)
            return true
          } catch (error) {
            if (error?.code === 'ESRCH') return false
            throw error
          }
        },
      })
    } else if (message.type === 'owned_process_done') groups.delete(pid)
  })
  let stdoutBytes = 0
  let stderrBytes = 0
  child.stdout.on('data', (bytes) => {
    stdoutBytes += bytes.length
    if (stdoutBytes <= 1024 * 1024) process.stdout.write(bytes)
  })
  child.stderr.on('data', (bytes) => {
    stderrBytes += bytes.length
  })
  const completed = new Promise((resolve) => {
    child.once('error', () => resolve({ code: null, startFailed: true }))
    child.once('close', (code) => resolve({ code }))
  })
  let watchdog
  let escalation
  let terminalCode = 'running'
  try {
    const outcome = await Promise.race([
      completed,
      cleanupDeadline,
      new Promise((resolve) => {
        watchdog = setTimeout(() => resolve({ timeout: true }), runDeadlineMs)
      }),
    ])
    const timedOut = outcome.timeout === true || outcome.cleanupTimeout === true
    terminalCode = outcome.cleanupTimeout
      ? 'cleanup_deadline_exceeded'
      : outcome.timeout
        ? 'overall_run_deadline'
        : outcome.startFailed
          ? 'supervisor_start_failed'
          : outcome.code === 0
            ? 'completed'
            : 'owned_run_failed'
    if (outcome.timeout === true) {
      child.kill('SIGTERM')
      await Promise.race([
        completed,
        new Promise((resolve) => {
          escalation = setTimeout(resolve, cleanupDeadlineMs)
        }),
      ])
    }
    process.exitCode =
      outcome.code === 0 && !timedOut && stdoutBytes <= 1024 * 1024 ? 0 : 1
    if (process.exitCode !== 0) {
      process.stderr.write(
        JSON.stringify({
          status: 'failed',
          code: outcome.cleanupTimeout
            ? 'cleanup_deadline_exceeded'
            : timedOut
              ? 'overall_run_deadline'
              : outcome.startFailed
                ? 'supervisor_start_failed'
                : 'owned_run_failed',
          stderrBytes,
          stdoutWithinLimit: stdoutBytes <= 1024 * 1024,
        }) + '\n',
      )
    }
  } finally {
    clearTimeout(watchdog)
    clearTimeout(escalation)
    await cleanup()
    disposeSignals()
    const supervisor = {
      schemaVersion: 1,
      terminalCode,
      ownedProcessGroupsTerminated: true,
      runDeadlineMs,
      cleanupDeadlineMs,
      sourcePin: options.sourceSha256,
      stderrBytes,
      stdoutWithinLimit: stdoutBytes <= 1024 * 1024,
      finishedAt: new Date().toISOString(),
    }
    let artifact = { saved: false }
    try {
      artifact = await writeSupervisorProof(
        ownedRunPath(options.runRoot),
        ownershipNonce,
        supervisor,
      )
    } finally {
      process.stdout.write(
        JSON.stringify({
          status: 'supervisor_complete',
          terminalCode,
          ownedProcessGroupsTerminated: true,
          supervisorArtifactSaved: artifact.saved,
        }) + '\n',
      )
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      JSON.stringify({
        status: 'failed',
        code: error instanceof SmokeFailure ? error.code : 'preparation_failed',
      }) + '\n',
    )
    process.exitCode = 1
  })
}

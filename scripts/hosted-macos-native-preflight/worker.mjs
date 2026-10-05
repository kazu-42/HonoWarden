import {
  createHash,
  randomBytes as cryptoRandomBytes,
  randomUUID as cryptoRandomUUID,
} from 'node:crypto'
import { spawn } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { constants } from 'node:fs'
import { createRequire } from 'node:module'
import {
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  stat,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { performance } from 'node:perf_hooks'
import { clearTimeout, setTimeout } from 'node:timers'
import { pathToFileURL } from 'node:url'

// This companion is started only by the hosted-guest supervisor. No account is seeded.
let phase = 'module_setup'
let miniflareCoreErrorClass
let binaryProof

// Binary-only control. These helpers never emit child output, paths or exception fields.
const BINARY_PROOF = 'pinned_darwin_arm64_version_verified'
const BINARY_SHA =
  '1b652bc9930d82924f9b416a384df910bc667f88cfb72972a0b39532c94a4cfe'
const BINARY_BYTES = 114566712
const BINARY_FAILURE_KINDS = new Set([
  'binary_identity_unproved',
  'binary_platform_unproved',
  'binary_digest_mismatch',
  'binary_file_changed',
  'binary_probe_spawn_failed',
  'binary_probe_nonzero_exit',
  'binary_probe_terminated',
  'binary_probe_output_invalid',
  'binary_probe_stderr_present',
  'binary_probe_output_limit',
  'binary_probe_deadline',
  'binary_probe_cleanup_unproved',
  'binary_probe_stream_failed',
])
class BinaryProbeFailure extends Error {
  constructor(kind) {
    super('runtime_binary_probe_failed')
    if (!BINARY_FAILURE_KINDS.has(kind))
      throw new Error('binary_category_invalid')
    Object.defineProperty(this, 'kind', { value: kind })
  }
}
function binaryRequire(value, kind) {
  if (!value) throw new BinaryProbeFailure(kind)
}
function binaryBudget(end) {
  binaryRequire(performance.now() < end, 'binary_probe_deadline')
}
function sameBinaryStat(a, b) {
  return ['dev', 'ino', 'size', 'mode', 'uid', 'mtimeNs', 'ctimeNs'].every(
    (key) => a[key] === b[key],
  )
}
async function binaryMetadata(path) {
  const bytes = await readFile(path)
  binaryRequire(bytes.length <= 16384, 'binary_identity_unproved')
  return JSON.parse(bytes.toString('utf8'))
}
async function verifyRuntimeBinary(miniflareEntry, end) {
  binaryBudget(end)
  binaryRequire(
    process.platform === 'darwin' && process.arch === 'arm64',
    'binary_platform_unproved',
  )
  binaryRequire(
    !Object.hasOwn(process.env, 'MINIFLARE_WORKERD_PATH'),
    'binary_identity_unproved',
  )
  const sdkRequire = createRequire(miniflareEntry)
  const sdk = await binaryMetadata(sdkRequire.resolve('miniflare/package.json'))
  binaryRequire(
    sdk.name === 'miniflare' &&
      sdk.version === '4.20260714.0' &&
      sdk.dependencies?.workerd === '1.20260714.1',
    'binary_identity_unproved',
  )
  const nativeModule = sdkRequire('workerd')
  const nativeRequire = createRequire(sdkRequire.resolve('workerd'))
  const wrapper = await binaryMetadata(
    nativeRequire.resolve('workerd/package.json'),
  )
  const platform = await binaryMetadata(
    nativeRequire.resolve('@cloudflare/workerd-darwin-arm64/package.json'),
  )
  binaryRequire(
    wrapper.name === 'workerd' &&
      wrapper.version === '1.20260714.1' &&
      nativeModule.version === '1.20260714.1' &&
      typeof nativeModule.default === 'string' &&
      platform.name === '@cloudflare/workerd-darwin-arm64' &&
      platform.version === '1.20260714.1' &&
      JSON.stringify(platform.os) === '["darwin"]' &&
      JSON.stringify(platform.cpu) === '["arm64"]',
    'binary_identity_unproved',
  )
  const path = await realpath(nativeModule.default)
  binaryRequire(
    path ===
      (await realpath(
        nativeRequire.resolve('@cloudflare/workerd-darwin-arm64/bin/workerd'),
      )),
    'binary_identity_unproved',
  )
  binaryBudget(end)
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  let before
  try {
    before = await fd.stat({ bigint: true })
    binaryRequire(
      before.isFile() &&
        before.size === BigInt(BINARY_BYTES) &&
        before.uid === BigInt(process.getuid()) &&
        (before.mode & 0o111n) !== 0n &&
        (before.mode & 0o022n) === 0n,
      'binary_identity_unproved',
    )
    const hash = createHash('sha256')
    const buffer = Buffer.alloc(65536)
    let count = 0
    try {
      while (true) {
        binaryBudget(end)
        const { bytesRead } = await fd.read(buffer, 0, buffer.length, null)
        if (!bytesRead) break
        binaryRequire(
          Number.isInteger(bytesRead) &&
            bytesRead > 0 &&
            bytesRead <= buffer.length,
          'binary_identity_unproved',
        )
        if (count === 0)
          binaryRequire(
            bytesRead >= 8 &&
              buffer
                .subarray(0, 8)
                .equals(Buffer.from('cffaedfe0c000001', 'hex')),
            'binary_platform_unproved',
          )
        count += bytesRead
        binaryRequire(count <= BINARY_BYTES, 'binary_identity_unproved')
        hash.update(buffer.subarray(0, bytesRead))
      }
      binaryRequire(
        count === BINARY_BYTES && hash.digest('hex') === BINARY_SHA,
        'binary_digest_mismatch',
      )
    } finally {
      buffer.fill(0)
    }
    binaryRequire(
      sameBinaryStat(before, await fd.stat({ bigint: true })) &&
        sameBinaryStat(before, await stat(path, { bigint: true })),
      'binary_file_changed',
    )
  } finally {
    await fd.close()
  }
  binaryBudget(end)
  return { path, before }
}
async function runBinaryVersion(descriptor, end) {
  binaryBudget(end)
  binaryRequire(
    sameBinaryStat(
      descriptor.before,
      await stat(descriptor.path, { bigint: true }),
    ),
    'binary_file_changed',
  )
  binaryBudget(end)
  const env = Object.fromEntries(
    ['PATH', 'HOME', 'TMPDIR', 'LANG']
      .filter((key) => typeof process.env[key] === 'string')
      .map((key) => [key, process.env[key]]),
  )
  let child
  try {
    child = spawn(descriptor.path, ['--version'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    })
  } catch {
    throw new BinaryProbeFailure('binary_probe_spawn_failed')
  }
  await new Promise((resolve, reject) => {
    const bytes = Buffer.alloc(256)
    let total = 0,
      used = 0,
      stderrSeen = false,
      exited = false,
      closed = false,
      settled = false,
      firstFailure
    let exitCode, exitSignal
    const fail = (kind) => {
      firstFailure ??= kind
    }
    const signalOwned = (signal) => {
      // A reaped/unknown original child never authorizes a destructive signal.
      if (
        settled ||
        closed ||
        exited ||
        child.exitCode !== null ||
        child.signalCode !== null
      )
        return
      if (!Number.isInteger(child.pid) || child.pid <= 0) {
        fail('binary_probe_cleanup_unproved')
        return
      }
      try {
        // Timer due times do not admit a signal when its callback runs late.
        if (performance.now() >= end) {
          fail('binary_probe_deadline')
          return
        }
        if (!child.kill(signal)) fail('binary_probe_cleanup_unproved')
      } catch {
        fail('binary_probe_cleanup_unproved')
      }
    }
    const collect = (chunk, stderr) => {
      if (settled) return
      if (!Buffer.isBuffer(chunk)) {
        fail('binary_probe_stream_failed')
        signalOwned('SIGTERM')
        return
      }
      total = Math.min(257, total + chunk.length)
      if (total > 256) {
        fail('binary_probe_output_limit')
        signalOwned('SIGTERM')
        return
      }
      if (stderr && chunk.length) {
        stderrSeen = true
        fail('binary_probe_stderr_present')
        return
      }
      if (!stderr) {
        chunk.copy(bytes, used)
        used += chunk.length
      }
    }
    const remaining = Math.max(0, end - performance.now())
    const termTimer = setTimeout(
      () => {
        fail('binary_probe_deadline')
        signalOwned('SIGTERM')
      },
      Math.max(0, remaining - 1000),
    )
    const killTimer = setTimeout(
      () => {
        fail('binary_probe_deadline')
        signalOwned('SIGKILL')
      },
      Math.max(0, remaining - 250),
    )
    const endTimer = setTimeout(() => {
      fail('binary_probe_cleanup_unproved')
      settled = true
      for (const timer of [termTimer, killTimer]) clearTimeout(timer)
      bytes.fill(0)
      reject(new BinaryProbeFailure(firstFailure))
    }, remaining)
    // Register spawn failures before accessing pipes: failed spawn may have no streams.
    child.on('error', () => fail('binary_probe_spawn_failed'))
    if (!child.stdout || !child.stderr) fail('binary_probe_stream_failed')
    child.stdout?.on('data', (chunk) => collect(chunk, false))
    child.stderr?.on('data', (chunk) => collect(chunk, true))
    child.stdout?.on('error', () => fail('binary_probe_stream_failed'))
    child.stderr?.on('error', () => fail('binary_probe_stream_failed'))
    child.once('exit', (code, signal) => {
      exited = true
      exitCode = code
      exitSignal = signal
    })
    child.once('close', () => {
      closed = true
      for (const timer of [termTimer, killTimer, endTimer]) clearTimeout(timer)
      if (settled) {
        bytes.fill(0)
        return
      }
      settled = true
      try {
        if (firstFailure) throw new BinaryProbeFailure(firstFailure)
        binaryBudget(end)
        binaryRequire(
          Number.isInteger(child.pid) && child.pid > 0,
          'binary_probe_cleanup_unproved',
        )
        binaryRequire(exited, 'binary_probe_cleanup_unproved')
        binaryRequire(exitSignal === null, 'binary_probe_terminated')
        binaryRequire(
          Number.isInteger(exitCode) && exitCode === 0,
          'binary_probe_nonzero_exit',
        )
        binaryRequire(!stderrSeen, 'binary_probe_stderr_present')
        const output = bytes.subarray(0, used)
        binaryRequire(
          output.equals(Buffer.from('workerd 2026-07-14\n')) ||
            output.equals(Buffer.from('workerd 2026-07-14')),
          'binary_probe_output_invalid',
        )
        resolve()
      } catch (error) {
        reject(error)
      } finally {
        bytes.fill(0)
      }
    })
  })
  binaryBudget(end)
  binaryRequire(
    sameBinaryStat(
      descriptor.before,
      await stat(descriptor.path, { bigint: true }),
    ),
    'binary_file_changed',
  )
  binaryBudget(end)
}

async function startup() {
  const arguments_ = process.argv.slice(2)
  if (arguments_.length !== 2 && arguments_.length !== 3)
    throw new TypeError('fixture_input_invalid')
  const [company, root] = arguments_.slice(0, 2).map((p) => resolve(p))
  const mode = arguments_[2]
  let input
  if (mode !== undefined) {
    phase = 'fixture_input'
    fixtureRequire(mode === 'minimal' || mode === 'company')
    process.stdout.write('{"syntheticInput":"ready"}\n')
    input = await readFixtureInput(process.stdin, mode)
  }
  // The historical two-argument fixture path is never selected by the supervisor.
  const providers = input
    ? fixtureProviders(input.options)
    : {
        randomUUID: cryptoRandomUUID,
        randomBytes: cryptoRandomBytes,
        validate() {},
      }
  const { randomUUID, randomBytes } = providers
  const require = createRequire(join(company, 'package.json'))
  phase = 'dependency_import'
  const { migrationStatements } = await import(
    pathToFileURL(join(company, 'scripts/honowarden-company-admin-smoke.mjs'))
      .href
  )
  const { build } = await import(
    pathToFileURL(
      require.resolve('esbuild', {
        paths: [require.resolve('wrangler/package.json')],
      }),
    ).href
  )
  phase = 'runtime_binary_probe'
  // This five-second sub-budget consumes the existing supervisor readiness/absolute lease.
  const binaryEnd = performance.now() + 5000
  const descriptor = await verifyRuntimeBinary(
    require.resolve('miniflare'),
    binaryEnd,
  )
  await runBinaryVersion(descriptor, binaryEnd)
  binaryProof = BINARY_PROOF
  phase = 'dependency_import'
  const { Miniflare, Log, LogLevel, MiniflareCoreError } = await import(
    pathToFileURL(require.resolve('miniflare')).href
  )
  miniflareCoreErrorClass = MiniflareCoreError
  phase = 'state_prepare'
  if (mode !== 'company') await mkdir(join(root, 'state'), { mode: 0o700 })
  const scriptPath = join(root, 'worker.mjs')
  let companyBundleSha256
  if (mode === 'company') {
    phase = 'bundle_restore'
    await restoreCompanyBundle(root, input.companyBundleSha256)
  } else {
    phase = 'build'
    await build({
      entryPoints: [join(company, 'src/index.ts')],
      outfile: scriptPath,
      bundle: true,
      platform: 'browser',
      format: 'esm',
      target: 'es2022',
      external: ['cloudflare:workers', 'node:*'],
      logLevel: 'silent',
    })
    if (mode === 'minimal')
      companyBundleSha256 = await prepareMinimalBundle(root)
  }
  phase = mode === 'minimal' ? 'minimal_runtime_construct' : 'runtime_construct'
  const runtime = new Miniflare({
    modules: true,
    cf: false,
    scriptPath,
    compatibilityDate: '2026-07-21',
    compatibilityFlags: ['nodejs_compat'],
    host: '127.0.0.1',
    port: 0,
    d1Databases: { DB: randomUUID() },
    r2Buckets: { VAULT_OBJECTS: randomUUID() },
    d1Persist: join(root, 'state/d1'),
    r2Persist: join(root, 'state/r2'),
    log: new Log(LogLevel.NONE),
    handleRuntimeStdio: (out, err) => {
      out.resume()
      err.resume()
    },
    bindings: {
      HONOWARDEN_ENV: 'development',
      HONOWARDEN_TOKEN_SECRET: randomBytes(32).toString('hex'),
      HONOWARDEN_ALLOWED_EMAILS: 'native-preflight@example.invalid',
      HONOWARDEN_BOOTSTRAP_ENABLED: 'false',
      HONOWARDEN_ADMIN_ENABLED: 'false',
      HONOWARDEN_AUDIT_LOGS: 'false',
      HONOWARDEN_DURABLE_NOTIFICATIONS_ENABLED: 'false',
    },
    outboundService: async () => {
      throw new Error('external_fetch_refused')
    },
  })
  providers.validate()
  const dispose = createDisposer(runtime)
  async function finish() {
    await dispose()
    process.exit(0)
  }
  process.on('SIGTERM', () => void finish().catch(emitFailure))
  process.on('SIGINT', () => void finish().catch(emitFailure))
  phase = mode === 'minimal' ? 'minimal_runtime_ready' : 'runtime_ready'
  const url = await runtime.ready
  phase =
    mode === 'minimal'
      ? 'minimal_runtime_loopback_validate'
      : 'runtime_loopback_validate'
  if (url.hostname !== '127.0.0.1') throw new Error('worker_not_loopback')
  if (mode === 'minimal') {
    phase = 'minimal_http_probe'
    await probeMinimalHttp(runtime, url)
    phase = 'minimal_runtime_dispose'
    // Joining this one promise proves only public SDK disposal. The supervisor
    // must independently reap and prove the original process group absent.
    await dispose()
    process.stdout.write(
      JSON.stringify({
        canary: 'public_worker_ready',
        companyBundleSha256,
        binary: binaryProof,
      }) + '\n',
      () => process.exit(0),
    )
    return
  }
  phase = 'd1_migrate'
  const db = await runtime.getD1Database('DB')
  const migrations = (await readdir(join(company, 'migrations')))
    .filter((name) => /^\d{4}_[A-Za-z0-9_-]+\.sql$/.test(name))
    .sort()
  if (!migrations.some((name) => name.startsWith('0030_')))
    throw new Error('migration_missing')
  for (const name of migrations) {
    for (const sql of migrationStatements(
      await readFile(join(company, 'migrations', name), 'utf8'),
    )) {
      await db.prepare(sql).run()
    }
  }
  phase = 'd1_probe'
  const rows = await db
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all()
  if (!rows.results.length) throw new Error('d1_not_ready')
  phase = 'r2_probe'
  const bucket = await runtime.getR2Bucket('VAULT_OBJECTS')
  await bucket.put('preflight-probe', 'synthetic-public-probe')
  if (
    (await (await bucket.get('preflight-probe')).text()) !==
    'synthetic-public-probe'
  )
    throw new Error('r2_not_ready')
  await bucket.delete('preflight-probe')
  phase = 'http_probe'
  const response = await runtime.dispatchFetch(`${url.origin}/`)
  if (!response.ok || (await response.json()).name !== 'HonoWarden')
    throw new Error('worker_not_ready')
  // Readiness includes only fixed capability fields and binary-only proof; no account exists.
  process.stdout.write(
    JSON.stringify({
      port: Number(url.port),
      d1: true,
      r2: true,
      worker: true,
      binary: binaryProof,
    }) + '\n',
  )
}

// The synthetic capability is RAM-only and must arrive after the launcher's GO.
const FIXTURE_SCHEMA = 'honowarden.native-preauth-fixture.v1'
const FIXTURE_LIMIT = 512
const PUBLIC_BUNDLE_LIMIT = 16 * 1024 * 1024
const MINIMAL_BODY = 'honowarden-public-native-canary-v1'
const MINIMAL_PATH = '/__honowarden_public_canary'
const MINIMAL_SCRIPT =
  'export default {fetch(request){const u=new URL(request.url);' +
  'return request.method==="GET"&&u.pathname==="/__honowarden_public_canary"' +
  '&&u.search===""?new Response("honowarden-public-native-canary-v1",' +
  '{headers:{"content-type":"text/plain"}}):new Response("refused",{status:404});}};\n'

function fixtureRequire(value) {
  if (!value) throw new Error('fixture_input_invalid')
}
function fixtureOptions(options) {
  fixtureRequire(
    options !== null &&
      typeof options === 'object' &&
      JSON.stringify(Object.keys(options).sort()) ===
        '["databaseId","r2BucketId","tokenSecret"]',
  )
  const values = {}
  for (const key of ['databaseId', 'r2BucketId', 'tokenSecret']) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key)
    fixtureRequire(
      descriptor &&
        Object.hasOwn(descriptor, 'value') &&
        typeof descriptor.value === 'string',
    )
    values[key] = descriptor.value
  }
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  fixtureRequire(uuid.test(values.databaseId) && uuid.test(values.r2BucketId))
  fixtureRequire(/^[0-9a-f]{64}$/.test(values.tokenSecret))
  return values
}
function parseFixtureInput(raw, mode) {
  fixtureRequire(mode === 'minimal' || mode === 'company')
  fixtureRequire(
    Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= FIXTURE_LIMIT,
  )
  const document = JSON.parse(raw.toString('utf8'))
  fixtureRequire(
    document !== null &&
      typeof document === 'object' &&
      JSON.stringify(Object.keys(document).sort()) ===
        '["companyBundleSha256","options","schema"]' &&
      document.schema === FIXTURE_SCHEMA,
  )
  const options = fixtureOptions(document.options)
  const sha = document.companyBundleSha256
  fixtureRequire(
    mode === 'minimal'
      ? sha === null
      : typeof sha === 'string' && /^[0-9a-f]{64}$/.test(sha),
  )
  const checked = { companyBundleSha256: sha, options, schema: FIXTURE_SCHEMA }
  // Exact canonical bytes reject duplicate keys, replacement decoding and trailing data.
  fixtureRequire(raw.equals(Buffer.from(JSON.stringify(checked), 'utf8')))
  return checked
}
async function readFixtureInput(stream, mode) {
  const raw = Buffer.alloc(FIXTURE_LIMIT)
  let used = 0
  try {
    for await (const chunk of stream) {
      fixtureRequire(
        Buffer.isBuffer(chunk) && used + chunk.length <= FIXTURE_LIMIT,
      )
      chunk.copy(raw, used)
      used += chunk.length
    }
    // A complete JSON prefix does not authorize startup before EOF.
    return parseFixtureInput(raw.subarray(0, used), mode)
  } finally {
    raw.fill(0)
  }
}
function fixtureProviders(options) {
  const checked = fixtureOptions(options)
  let uuids = 0
  let tokens = 0
  return {
    randomUUID() {
      fixtureRequire(uuids < 2)
      return [checked.databaseId, checked.r2BucketId][uuids++]
    },
    randomBytes(size) {
      fixtureRequire(size === 32 && tokens++ === 0)
      return Buffer.from(checked.tokenSecret, 'hex')
    },
    validate() {
      fixtureRequire(uuids === 2 && tokens === 1)
    },
  }
}
function createDisposer(runtime) {
  let original
  return () => {
    original ??= Promise.resolve().then(() => runtime.dispose())
    return original
  }
}
async function readPublicBundle(path, privateOnly) {
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = await fd.stat({ bigint: true })
    if (
      !before.isFile() ||
      before.uid !== BigInt(process.getuid()) ||
      before.nlink !== 1n ||
      before.size <= 0n ||
      before.size > BigInt(PUBLIC_BUNDLE_LIMIT) ||
      (before.mode & 0o022n) !== 0n ||
      (privateOnly && (before.mode & 0o777n) !== 0o600n)
    )
      throw new Error('public_bundle_identity_invalid')
    const bytes = Buffer.alloc(Number(before.size))
    let used = 0
    while (used < bytes.length) {
      const { bytesRead } = await fd.read(
        bytes,
        used,
        bytes.length - used,
        null,
      )
      if (
        !Number.isInteger(bytesRead) ||
        bytesRead <= 0 ||
        bytesRead > bytes.length - used
      )
        throw new Error('public_bundle_changed')
      used += bytesRead
    }
    const { bytesRead: excess } = await fd.read(Buffer.alloc(1), 0, 1, null)
    const after = await fd.stat({ bigint: true })
    if (excess !== 0 || after.nlink !== 1n || !sameBinaryStat(before, after))
      throw new Error('public_bundle_changed')
    return { bytes, before }
  } finally {
    await fd.close()
  }
}
async function replacePublicScript(path, bytes, before) {
  const fd = await open(path, constants.O_WRONLY | constants.O_NOFOLLOW)
  try {
    const current = await fd.stat({ bigint: true })
    if (current.nlink !== 1n || !sameBinaryStat(before, current))
      throw new Error('public_bundle_changed')
    await fd.chmod(0o600)
    await fd.truncate(0)
    await fd.writeFile(bytes)
    await fd.sync()
  } finally {
    await fd.close()
  }
}
async function prepareMinimalBundle(root) {
  const script = join(root, 'worker.mjs')
  const { bytes, before } = await readPublicBundle(script, false)
  const sha = createHash('sha256').update(bytes).digest('hex')
  const backup = await open(
    join(root, 'company-worker.mjs'),
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  )
  try {
    await backup.writeFile(bytes)
    await backup.sync()
  } finally {
    await backup.close()
  }
  await replacePublicScript(script, Buffer.from(MINIMAL_SCRIPT), before)
  return sha
}
async function restoreCompanyBundle(root, expectedSha256) {
  if (
    typeof expectedSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(expectedSha256)
  )
    throw new Error('public_bundle_digest_invalid')
  const { bytes } = await readPublicBundle(
    join(root, 'company-worker.mjs'),
    true,
  )
  if (createHash('sha256').update(bytes).digest('hex') !== expectedSha256)
    throw new Error('public_bundle_digest_mismatch')
  const script = join(root, 'worker.mjs')
  const current = await readPublicBundle(script, true)
  if (!current.bytes.equals(Buffer.from(MINIMAL_SCRIPT)))
    throw new Error('public_bundle_predecessor_invalid')
  await replacePublicScript(script, bytes, current.before)
  // Re-read the exact path the next fresh SDK will consume.
  const restored = await readPublicBundle(script, true)
  if (
    createHash('sha256').update(restored.bytes).digest('hex') !== expectedSha256
  )
    throw new Error('public_bundle_restore_unproved')
}
async function probeMinimalHttp(runtime, url) {
  const response = await runtime.dispatchFetch(`${url.origin}${MINIMAL_PATH}`)
  if (
    response.status !== 200 ||
    response.headers.get('content-type') !== 'text/plain'
  )
    throw new Error('minimal_http_invalid')
  if (!response.body) throw new Error('minimal_http_invalid')
  const reader = response.body.getReader()
  const bytes = Buffer.alloc(128)
  let used = 0
  let failed = false
  let firstFailure
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array) || used + value.length > bytes.length)
        throw new Error('minimal_http_invalid')
      bytes.set(value, used)
      used += value.length
    }
    if (!bytes.subarray(0, used).equals(Buffer.from(MINIMAL_BODY)))
      throw new Error('minimal_http_invalid')
  } catch (error) {
    failed = true
    firstFailure = error
  } finally {
    bytes.fill(0)
    for (const close of [() => reader.cancel(), () => reader.releaseLock()]) {
      try {
        await close()
      } catch (error) {
        if (!failed) {
          failed = true
          firstFailure = error
        }
      }
    }
  }
  if (failed) throw firstFailure
}

function runtimeFailureKind(error) {
  // Read only own data descriptors and emit labels, never exception content.
  try {
    const message = Object.getOwnPropertyDescriptor(error, 'message')
    if (
      !message ||
      !Object.hasOwn(message, 'value') ||
      typeof message.value !== 'string' ||
      message.value.length > 16384 ||
      Buffer.byteLength(message.value, 'utf8') > 16384
    )
      return 'miniflare_runtime_failure'
    if (
      message.value ===
      'The Workers runtime failed to start. There is likely additional logging output above.'
    )
      return 'miniflare_runtime_ports_missing'
    if (message.value === 'Unable to access the runtime inspector socket.')
      return 'miniflare_runtime_inspector_socket_missing'
    const stderrPrefix =
      'The Workers runtime failed to start. There was likely a problem with the workerd binary or your configuration.\nRuntime stderr:\n'
    if (message.value.startsWith(stderrPrefix)) {
      const nonWhitespaceSuffix = /\S/g
      nonWhitespaceSuffix.lastIndex = stderrPrefix.length
      if (nonWhitespaceSuffix.test(message.value))
        return nativeModuleMarkerKind(message.value, stderrPrefix.length)
    }
  } catch {
    // Descriptor failure supplies no diagnostic evidence.
  }
  return 'miniflare_runtime_failure'
}

function nativeModuleMarkerKind(message, suffixStart) {
  // Observe public templates only; names and exception content never leave here.
  const markers = [
    [
      /(?:^|(?<=\n)|(?<=: ))(?:No such module "[^"\r\n]{1,512}"\.\n {2}imported from "[^"\r\n]{1,512}"|Invalid module specifier "[^"\r\n]{1,512}"\.\n {2}imported from "[^"\r\n]{1,512}"\.)(?=$|\n)/g,
      'miniflare_runtime_module_resolution_marker',
    ],
    [
      /(?:^|(?<=\n)|(?<=: ))(?:Top-level await in module is not permitted at this time\.|Top-level await in module is unsettled\.)(?=$|\n)/g,
      'miniflare_runtime_module_evaluation_marker',
    ],
  ]
  let kind = 'miniflare_runtime_stderr_present'
  let matches = 0
  for (const [pattern, candidate] of markers) {
    pattern.lastIndex = suffixStart
    if (pattern.test(message)) {
      matches += 1
      if (matches !== 1 || pattern.test(message))
        return 'miniflare_runtime_stderr_present'
      kind = candidate
    }
  }
  return kind
}

function failureKind(error) {
  if (error instanceof BinaryProbeFailure) {
    const kind = Object.getOwnPropertyDescriptor(error, 'kind')
    if (kind && 'value' in kind && BINARY_FAILURE_KINDS.has(kind.value))
      return kind.value
  }
  // Pinned SDK class and own data properties only; never emit exception fields.
  if (
    typeof miniflareCoreErrorClass === 'function' &&
    error instanceof miniflareCoreErrorClass
  ) {
    const code = Object.getOwnPropertyDescriptor(error, 'code')
    if (code && Object.hasOwn(code, 'value')) {
      if (code.value === 'ERR_RUNTIME_FAILURE') return runtimeFailureKind(error)
      if (code.value === 'ERR_ADDRESS_IN_USE') return 'miniflare_address_in_use'
    }
  }
  if (error instanceof TypeError) return 'type_error'
  if (error instanceof RangeError) return 'range_error'
  if (error instanceof SyntaxError) return 'syntax_error'
  if (error instanceof ReferenceError) return 'reference_error'
  if (error instanceof Error) return 'error'
  return 'unknown_exception'
}

function emitFailure(error) {
  // Flush only closed labels before failed exit; never log exception fields.
  process.stdout.write(
    JSON.stringify({
      phase,
      kind: failureKind(error),
      ...(binaryProof ? { binary: binaryProof } : {}),
    }) + '\n',
    () => process.exit(1),
  )
}

startup().catch(emitFailure)

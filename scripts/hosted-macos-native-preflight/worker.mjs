import { createHash, randomBytes, randomUUID } from 'node:crypto'
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
  const [company, root] = process.argv.slice(2).map((p) => resolve(p))
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
  await mkdir(join(root, 'state'), { mode: 0o700 })
  const scriptPath = join(root, 'worker.mjs')
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
  phase = 'runtime_construct'
  const runtime = new Miniflare({
    modules: true,
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
  let disposing = false
  async function finish() {
    if (disposing) return
    disposing = true
    await runtime.dispose()
    process.exit(0)
  }
  process.on('SIGTERM', () => void finish())
  process.on('SIGINT', () => void finish())
  phase = 'runtime_ready'
  const url = await runtime.ready
  phase = 'runtime_loopback_validate'
  if (url.hostname !== '127.0.0.1') throw new Error('worker_not_loopback')
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
        return 'miniflare_runtime_stderr_present'
    }
  } catch {
    // Descriptor failure supplies no diagnostic evidence.
  }
  return 'miniflare_runtime_failure'
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

startup().catch((error) => {
  // Flush only closed labels before failed exit; never log exception fields.
  process.stdout.write(
    JSON.stringify({
      phase,
      kind: failureKind(error),
      ...(binaryProof ? { binary: binaryProof } : {}),
    }) + '\n',
    () => process.exit(1),
  )
})

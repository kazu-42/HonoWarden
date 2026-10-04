import { randomBytes, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

// This companion is started only by the hosted-guest supervisor. No account is seeded.
let phase = 'module_setup'
let miniflareCoreErrorClass
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
  // Readiness remains the exact four-field public contract; no account exists.
  process.stdout.write(
    JSON.stringify({
      port: Number(url.port),
      d1: true,
      r2: true,
      worker: true,
    }) + '\n',
  )
}

function failureKind(error) {
  // Pinned SDK class and own data property only; never invoke or copy exception fields.
  if (
    typeof miniflareCoreErrorClass === 'function' &&
    error instanceof miniflareCoreErrorClass
  ) {
    const code = Object.getOwnPropertyDescriptor(error, 'code')
    if (code && 'value' in code) {
      if (code.value === 'ERR_RUNTIME_FAILURE')
        return 'miniflare_runtime_failure'
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
    JSON.stringify({ phase, kind: failureKind(error) }) + '\n',
    () => process.exit(1),
  )
})

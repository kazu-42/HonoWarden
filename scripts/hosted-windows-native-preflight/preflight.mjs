import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { setTimeout, clearTimeout } from 'node:timers'
import { URL } from 'node:url'
import {
  admitProbe,
  remainingBudget,
  projectedResult,
  decodeDesktopPayload,
  nativeFailureCode,
} from './preflight-policy.mjs'
import {
  createWindowsHelper,
  unusedLoopbackPort,
  attachOwnedPage,
} from './windows.mjs'
import { selectDesktopTarget, ensure } from './policy.mjs'

const { Response } = globalThis

export function loadPinnedWebSocket(require, scopedRequire = createRequire) {
  if (require('miniflare/package.json').version !== '4.20260714.0')
    throw Error('websocket_pin')
  const runtimeRequire = scopedRequire(require.resolve('miniflare'))
  if (runtimeRequire('ws/package.json').version !== '8.21.0')
    throw Error('websocket_pin')
  const WebSocket = runtimeRequire('ws')
  if (typeof WebSocket !== 'function') throw Error('websocket_pin')
  return WebSocket
}

export function migrationStatements(sql) {
  const statements = [],
    lines = []
  let trigger = false
  for (const line of sql.split('\n')) {
    const text = line.trim()
    if (!lines.length && !text) continue
    if (/^CREATE\s+TRIGGER\b/i.test(text)) trigger = true
    lines.push(line)
    if (trigger ? /^END;$/i.test(text) : text.endsWith(';')) {
      statements.push(lines.splice(0).join('\n'))
      trigger = false
    }
  }
  if (lines.some((line) => line.trim())) throw Error('migration_incomplete')
  return statements
}
async function run(input) {
  admitProbe({
    ...input,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
  })
  const root = dirname(fileURLToPath(import.meta.url)),
    require = createRequire(join(input.company, 'package.json'))
  let worker, connection, desktop, timer
  const result = {
    worker: false,
    gui: false,
    cleanup: false,
    nodePhase: 'bundle',
    nodeFailure: 'none',
  }
  try {
    timer = setTimeout(
      () => {
        connection?.cdp.close()
        desktop?.kill()
      },
      remainingBudget(input.expiresAtMs, Date.now(), 300000),
    )
    const esbuild = await import(
      pathToFileURL(
        join(
          input.company,
          'node_modules/.pnpm/esbuild@0.28.1/node_modules/esbuild/lib/main.js',
        ),
      ).href
    )
    if (esbuild.version !== '0.28.1') throw Error('build_pin')
    await esbuild.build({
      entryPoints: [join(input.company, 'src/index.ts')],
      outfile: join(input.attempt, 'worker.mjs'),
      bundle: true,
      platform: 'browser',
      format: 'esm',
      target: 'es2022',
      external: ['cloudflare:workers', 'node:*'],
      logLevel: 'silent',
    })
    remainingBudget(input.expiresAtMs)
    const { Miniflare, Log, LogLevel } = require('miniflare')
    result.nodePhase = 'worker_start'
    worker = new Miniflare({
      modules: true,
      cf: false,
      scriptPath: join(input.attempt, 'worker.mjs'),
      modulesRoot: input.attempt,
      compatibilityDate: '2026-07-21',
      compatibilityFlags: ['nodejs_compat'],
      host: '127.0.0.1',
      port: 0,
      d1Databases: { DB: randomUUID() },
      r2Buckets: { VAULT_OBJECTS: randomUUID() },
      d1Persist: join(input.attempt, 'd1'),
      r2Persist: join(input.attempt, 'r2'),
      log: new Log(LogLevel.NONE),
      handleRuntimeStdio: (stdout, stderr) => {
        stdout.resume()
        stderr.resume()
      },
      bindings: {
        HONOWARDEN_ENV: 'development',
        HONOWARDEN_TOKEN_SECRET: randomBytes(32).toString('base64url'),
      },
      outboundService: () => new Response(null, { status: 502 }),
    })
    const database = await worker.getD1Database('DB')
    result.nodePhase = 'migration'
    for (const name of (await readdir(join(input.company, 'migrations')))
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      remainingBudget(input.expiresAtMs)
      for (const sql of migrationStatements(
        await readFile(join(input.company, 'migrations', name), 'utf8'),
      ))
        await database.prepare(sql).run()
    }
    result.nodePhase = 'd1_probe'
    const count = await database
      .prepare('SELECT COUNT(*) AS count FROM users')
      .first('count')
    if (count !== 0) throw Error('not_empty')
    result.nodePhase = 'r2_probe'
    const bucket = await worker.getR2Bucket('VAULT_OBJECTS'),
      marker = 'preauth-public-marker-' + randomUUID()
    try {
      await bucket.put(marker, 'public marker')
      if ((await (await bucket.get(marker))?.text()) !== 'public marker')
        throw Error('r2_probe')
    } finally {
      await bucket.delete(marker)
      ensure((await bucket.get(marker)) === null, 'r2_cleanup')
    }
    result.nodePhase = 'worker_config'
    const origin = (await worker.ready).origin
    if (new URL(origin).hostname !== '127.0.0.1')
      throw Error('worker_not_loopback')
    if ((await worker.dispatchFetch(origin + '/api/config')).status !== 200)
      throw Error('worker_config')
    result.worker = true
    remainingBudget(input.expiresAtMs)
    const port = await unusedLoopbackPort(),
      profile = join(input.attempt, 'profile')
    const payload = decodeDesktopPayload(
      JSON.parse(
        await readFile(join(root, 'desktop-payload-manifest.json'), 'utf8'),
      ),
    )
    const executablePath = join(
      input.attempt,
      'desktop',
      payload.executablePath,
    )
    await mkdir(profile)
    result.nodePhase = 'desktop_launch'
    desktop = spawn(
      executablePath,
      [
        '--user-data-dir=' + profile,
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=' + port,
        '--proxy-server=http://127.0.0.1:9',
        '--proxy-bypass-list=127.0.0.1;localhost',
        '--disable-component-update',
        '--lang=en-US',
      ],
      {
        env: { ...process.env, [payload.appDataVariable]: profile },
        stdio: 'ignore',
        shell: false,
      },
    )
    desktop.once('error', () => {})
    const expected = pathToFileURL(
      join(input.attempt, 'desktop/resources/app.asar/index.html'),
    ).href
    result.nodePhase = 'desktop_attach'
    const helper = createWindowsHelper(root, {
      timeoutMs: 30000,
      deadline: input.expiresAtMs,
    })
    connection = await attachOwnedPage({
      child: desktop,
      identity: {
        path: executablePath,
        sha256:
          '48232882cc5412f8c9e3ddb1b2b1dc50f7247f7f9444fde2bee5c5f010ffac8a',
      },
      appdata: profile,
      port,
      jobName: input.jobName,
      helper,
      WebSocket: loadPinnedWebSocket(require),
      select: (targets, p) => selectDesktopTarget(targets, expected, p),
      timeoutMs: remainingBudget(input.expiresAtMs, Date.now(), 60000),
    })
    await connection.prove()
    remainingBudget(input.expiresAtMs)
    result.nodePhase = 'window_proof'
    const visible = await helper('WindowProof', {
      jobName: input.jobName,
      desktopPid: desktop.pid,
      desktopPath: executablePath,
      desktopHash:
        '48232882cc5412f8c9e3ddb1b2b1dc50f7247f7f9444fde2bee5c5f010ffac8a',
      desktopCreatedAt: connection.createdAt,
      appdata: profile,
    })
    if (visible.visible !== true || visible.sameSession !== true)
      throw Error('gui_unavailable')
    result.nodePhase = 'dom_probe'
    result.gui = await connection.cdp.evaluate(
      function (expected) {
        const { location, document, getComputedStyle } = globalThis
        const current = new URL(location.href)
        current.hash = ''
        const inputs = [
          ...document.querySelectorAll('[data-testid="login-email-input"]'),
        ].filter(
          (element) =>
            element.getClientRects().length &&
            getComputedStyle(element).visibility !== 'hidden',
        )
        return (
          current.href === expected &&
          inputs.length === 1 &&
          inputs[0].value === ''
        )
      },
      [expected],
    )
    if (result.gui !== true) throw Error('prelogin_dom_unavailable')
    result.nodePhase = 'complete'
  } catch (error) {
    result.failed = true
    result.nodeFailure = nativeFailureCode(error)
  } finally {
    clearTimeout(timer)
    let clean = true
    try {
      connection?.cdp.close()
    } catch {
      clean = false
    }
    try {
      desktop?.kill()
    } catch {
      clean = false
    }
    try {
      await worker?.dispose()
    } catch {
      clean = false
    }
    result.cleanup = clean
    await writeFile(
      join(input.attempt, 'safe-result.json'),
      JSON.stringify(projectedResult(result)),
    )
  }
  process.exitCode = result.failed || !result.cleanup ? 1 : 0
}
if (
  process.platform === 'win32' &&
  process.argv[1] === fileURLToPath(import.meta.url)
) {
  const parts = []
  let bytes = 0
  try {
    for await (const part of process.stdin) {
      bytes += part.length
      if (bytes > 16384) throw Error('input_bound')
      parts.push(part)
    }
    await run(JSON.parse(Buffer.concat(parts).toString()))
  } catch {
    process.exitCode = 1
  } finally {
    for (const part of parts) part.fill(0)
  }
}

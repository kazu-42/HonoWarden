import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { readFile, lstat, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import { setTimeout, clearTimeout } from 'node:timers'
import {
  ControllerFailure,
  ensure,
  requireRelativePath,
  requireProcessProof,
} from './policy.mjs'
import { boundedJson, connectCdp } from './cdp.mjs'

export async function verifyBundle(bundle, digest) {
  const raw = await readFile(join(bundle, 'manifest.json'))
  ensure(
    raw.length <= 2097152 &&
      createHash('sha256').update(raw).digest('hex') === digest,
    'manifest_mismatch',
  )
  const manifest = JSON.parse(raw.toString()),
    seen = new Set()
  ensure(
    Array.isArray(manifest.files) &&
      manifest.files.length >= 1000 &&
      manifest.files.length <= 2000,
    'manifest_mismatch',
  )
  for (const file of manifest.files) {
    const path = requireRelativePath(file.path),
      key = path.toLowerCase()
    ensure(
      !seen.has(key) &&
        Number.isSafeInteger(file.bytes) &&
        /^[a-f0-9]{64}$/.test(file.sha256),
      'manifest_mismatch',
    )
    seen.add(key)
    const full = resolve(bundle, ...path.split('/')),
      stat = await lstat(full)
    ensure(
      stat.isFile() && !stat.isSymbolicLink() && stat.size === file.bytes,
      'manifest_mismatch',
    )
    ensure(
      createHash('sha256')
        .update(await readFile(full))
        .digest('hex') === file.sha256,
      'manifest_mismatch',
    )
  }
  let count = 0
  async function scan(directory, prefix = '') {
    for (const name of await readdir(directory)) {
      const path = prefix + name,
        stat = await lstat(join(directory, name))
      ensure(++count <= 2500 && !stat.isSymbolicLink(), 'manifest_mismatch')
      if (stat.isDirectory()) await scan(join(directory, name), path + '/')
      else
        ensure(
          stat.isFile() &&
            (path === 'manifest.json' || seen.has(path.toLowerCase())),
          'manifest_mismatch',
        )
    }
  }
  await scan(bundle)
  return manifest
}
export function createWindowsHelper(
  controller,
  { spawner = spawn, schedule = setTimeout, cancel = clearTimeout } = {},
) {
  const executable = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
  return (mode, request) =>
    new Promise((resolve, reject) => {
      const child = spawner(
        executable,
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          join(controller, 'windows-helper.ps1'),
          '-Mode',
          mode,
        ],
        {
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'ignore'],
          env: process.env,
        },
      )
      let bytes = 0,
        parts = [],
        settled = false
      const releaseOutput = () => {
        for (const part of parts) part.fill(0)
        parts = []
      }
      const fail = (code) => {
        if (settled) return
        settled = true
        cancel(timer)
        releaseOutput()
        child.kill()
        reject(new ControllerFailure(code))
      }
      const timer = schedule(() => fail('windows_helper_timeout'), 10000)
      child.on('error', () => fail('windows_helper_spawn'))
      child.stdin.once?.('error', () => fail('windows_helper_input'))
      child.stdout.once?.('error', () => fail('windows_helper_output'))
      child.stdout.on('data', (chunk) => {
        if (settled) return
        bytes += chunk.length
        if (bytes > 16384) fail('windows_helper_output_bound')
        else parts.push(chunk)
      })
      child.on('close', (code) => {
        if (settled) return
        settled = true
        cancel(timer)
        try {
          const value = JSON.parse(Buffer.concat(parts).toString())
          if (
            value?.object === 'windowsHelperFailure' &&
            Object.keys(value).length === 2 &&
            [
              'windows_helper_compile',
              'windows_helper_job',
              'windows_helper_process',
              'windows_helper_listener',
              'windows_helper_window',
            ].includes(value.code)
          )
            throw new ControllerFailure(value.code)
          ensure(
            value?.object !== 'windowsHelperFailure',
            'windows_helper_failed',
          )
          ensure(code === 0, 'windows_helper_exit')
          resolve(value)
        } catch (error) {
          reject(
            error instanceof ControllerFailure
              ? error
              : new ControllerFailure('windows_helper_json'),
          )
        } finally {
          releaseOutput()
        }
      })
      const input = JSON.stringify(request)
      if (Buffer.byteLength(input) > 16384) {
        fail('windows_helper_input')
        return
      }
      child.stdin.end(input)
    })
}
export async function unusedLoopbackPort() {
  const server = createServer()
  await new Promise((yes, no) => {
    server.once('error', no)
    server.listen(0, '127.0.0.1', yes)
  })
  const port = server.address().port
  await new Promise((yes) => server.close(yes))
  return port
}
export async function attachOwnedPage({
  child,
  identity,
  appdata,
  port,
  jobName,
  helper,
  WebSocket,
  select,
  timeoutMs = 20000,
}) {
  let createdAt = null
  let lastFailure = new ControllerFailure('process_identity_invalid')
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    ensure(child.exitCode === null, 'desktop_process_exited')
    try {
      const proof = await helper('ProcessProof', {
        jobName,
        desktopPid: child.pid,
        desktopCreatedAt: createdAt,
        desktopPath: identity.path,
        desktopHash: identity.sha256,
        appdata,
        port,
      })
      if (createdAt === null) createdAt = proof.desktopCreatedAt
      requireProcessProof(proof, identity.sha256, child.pid, createdAt)
      const targets = await boundedJson(`http://127.0.0.1:${port}/json/list`),
        target = select(targets, port)
      const cdp = await connectCdp(target.webSocketDebuggerUrl, port, WebSocket)
      return {
        cdp,
        createdAt,
        async prove() {
          const proof = await helper('ProcessProof', {
            jobName,
            desktopPid: child.pid,
            desktopCreatedAt: createdAt,
            desktopPath: identity.path,
            desktopHash: identity.sha256,
            appdata,
            port,
          })
          requireProcessProof(proof, identity.sha256, child.pid, createdAt)
        },
        async menu(mode) {
          const proof = await helper(mode, {
            jobName,
            desktopPid: child.pid,
            desktopCreatedAt: createdAt,
            desktopPath: identity.path,
            desktopHash: identity.sha256,
          })
          ensure(proof.invoked === true, 'windows_helper_failed')
        },
      }
    } catch (error) {
      if (error.code === 'desktop_target_not_unique') throw error
      if (error instanceof ControllerFailure) lastFailure = error
      await new Promise((yes) => setTimeout(yes, 150))
    }
  }
  throw lastFailure
}

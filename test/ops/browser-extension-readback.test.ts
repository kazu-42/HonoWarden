import { spawn, type ChildProcess } from 'node:child_process'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

// @ts-expect-error script helper intentionally ships as plain ESM.
import * as browserReadback from '../../scripts/honowarden-browser-extension-readback.mjs'

const {
  CdpClient,
  cleanupOfficialBrowserExtensionResources,
  closeTarget,
  createBlankTarget,
  parseDevToolsActivePortFile,
  redactBrowserRuntimeException,
  readDevToolsActivePortEndpoint,
  readOwnedBrowserVersion,
  readTargets,
} = browserReadback

const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const liveChildren = new Set<ChildProcess>()

afterEach(async () => {
  await Promise.all(
    [...liveChildren].map(async (child) => {
      liveChildren.delete(child)
      if (child.exitCode !== null || child.signalCode !== null) return
      child.kill('SIGKILL')
      await waitForChildExit(child, 2_000).catch(() => undefined)
    }),
  )
})

describe('official browser extension CDP ownership', () => {
  it('marks an unexpected CDP close unhealthy after pending work is idle', () => {
    const socket = new FakeCdpSocket()
    const client = new CdpClient(socket)

    socket.disconnect()

    expect(() => client.assertHealthy()).toThrow(
      'official browser CDP connection closed',
    )
  })

  it('marks a CDP socket error unhealthy', () => {
    const socket = new FakeCdpSocket()
    const client = new CdpClient(socket)

    socket.fail()

    expect(() => client.assertHealthy()).toThrow(
      'official browser CDP connection failed',
    )
  })

  it('keeps an explicit CDP shutdown healthy', () => {
    const socket = new FakeCdpSocket()
    const client = new CdpClient(socket)

    client.close()

    expect(() => client.assertHealthy()).not.toThrow()
  })

  it('does not let cleanup mask a remote close already in progress', () => {
    const socket = new FakeCdpSocket()
    const client = new CdpClient(socket)

    socket.beginDisconnect()
    client.close()
    socket.finishDisconnect()

    expect(() => client.assertHealthy()).toThrow(
      'official browser CDP connection closed',
    )
  })

  it('parses only loopback DevToolsActivePort browser endpoints', () => {
    expect(
      parseDevToolsActivePortFile('39157\n/devtools/browser/owned-id\n'),
    ).toEqual({
      address: '127.0.0.1',
      browserPath: '/devtools/browser/owned-id',
      origin: 'http://127.0.0.1:39157',
      port: 39157,
      webSocketDebuggerUrl: 'ws://127.0.0.1:39157/devtools/browser/owned-id',
    })

    expect(() =>
      parseDevToolsActivePortFile('39157\n/devtools/page/not-browser\n'),
    ).toThrow('path was invalid')
    expect(() =>
      parseDevToolsActivePortFile('0\n/devtools/browser/owned-id\n'),
    ).toThrow('port was invalid')
    expect(() =>
      parseDevToolsActivePortFile('abc\n/devtools/browser/owned-id\n'),
    ).toThrow('was invalid')
    expect(() =>
      parseDevToolsActivePortFile('39157\n/devtools/browser/owned id\n'),
    ).toThrow('path was invalid')
    expect(() =>
      parseDevToolsActivePortFile('39157\n/devtools/browser/owned-id\nextra\n'),
    ).toThrow('was invalid')
  })

  it('reads DevToolsActivePort only from a private regular file in the owned profile', async () => {
    const profile = await createOwnedProfile('valid-active-port')
    await writeFile(
      join(profile.absolute, 'DevToolsActivePort'),
      '39158\n/devtools/browser/readback-id\n',
      { mode: 0o600 },
    )

    await expect(
      readDevToolsActivePortEndpoint(profile.relative),
    ).resolves.toMatchObject({
      port: 39158,
      webSocketDebuggerUrl: 'ws://127.0.0.1:39158/devtools/browser/readback-id',
    })

    const symlinkProfile = await createOwnedProfile('symlink-active-port')
    await symlink(
      join(profile.absolute, 'DevToolsActivePort'),
      join(symlinkProfile.absolute, 'DevToolsActivePort'),
    )
    await expect(
      readDevToolsActivePortEndpoint(symlinkProfile.relative),
    ).rejects.toThrow('DevToolsActivePort was invalid')

    const publicProfile = await createOwnedProfile('public-profile')
    await chmod(publicProfile.absolute, 0o755)
    await writeFile(
      join(publicProfile.absolute, 'DevToolsActivePort'),
      '39159\n/devtools/browser/public-id\n',
      { mode: 0o600 },
    )
    await expect(
      readDevToolsActivePortEndpoint(publicProfile.relative),
    ).rejects.toThrow('profile directory was not private')
  })

  it('requires /json/version to match the owned websocket endpoint exactly', async () => {
    const matching = await withJsonServer((request, response, port) => {
      expect(request.url).toBe('/json/version')
      writeJson(response, {
        Browser: 'Chrome/149.0',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/owned`,
      })
    })
    try {
      await expect(
        readOwnedBrowserVersion(
          endpointFor(matching.port, '/devtools/browser/owned'),
        ),
      ).resolves.toMatchObject({ Browser: 'Chrome/149.0' })
    } finally {
      await matching.close()
    }

    const mismatched = await withJsonServer((_request, response, port) => {
      writeJson(response, {
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/ambient`,
      })
    })
    try {
      await expect(
        readOwnedBrowserVersion(
          endpointFor(mismatched.port, '/devtools/browser/owned'),
        ),
      ).rejects.toThrow('ownership mismatch')
    } finally {
      await mismatched.close()
    }
  })

  it('passes the owned endpoint explicitly to target helpers', async () => {
    const requests: Array<{
      method: string | undefined
      url: string | undefined
    }> = []
    const server = await withJsonServer((request, response) => {
      requests.push({ method: request.method, url: request.url })
      if (request.url === '/json/list') {
        writeJson(response, [{ id: 'target-1' }])
        return
      }
      if (request.url === '/json/new?about:blank') {
        writeJson(response, { id: 'target-2' })
        return
      }
      if (request.url === '/json/close/target-2') {
        writeJson(response, { ok: true })
        return
      }
      response.writeHead(404).end()
    })
    try {
      const endpoint = endpointFor(server.port, '/devtools/browser/owned')
      await expect(readTargets(endpoint)).resolves.toEqual([{ id: 'target-1' }])
      await expect(createBlankTarget(endpoint)).resolves.toEqual({
        id: 'target-2',
      })
      await expect(closeTarget(endpoint, 'target-2')).resolves.toBeUndefined()
      expect(requests).toEqual([
        { method: 'GET', url: '/json/list' },
        { method: 'PUT', url: '/json/new?about:blank' },
        { method: 'GET', url: '/json/close/target-2' },
      ])
    } finally {
      await server.close()
    }
  })

  it('terminates an owned process group even after the leader exits cleanly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'honowarden-browser-pgid-'))
    const pidFile = join(root, 'descendant.pid')
    const leaderScript = join(root, 'leader.mjs')
    await writeFile(
      leaderScript,
      `import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

const descendant = spawn(process.execPath, [
  '-e',
  'setInterval(() => {}, 1000)',
], { detached: false, stdio: 'ignore' })
descendant.unref()
await writeFile(process.argv[2], String(descendant.pid))
process.exit(0)
`,
    )

    const leader = spawn(process.execPath, [leaderScript, pidFile], {
      detached: true,
      stdio: 'ignore',
    })
    liveChildren.add(leader)
    const descendantPid = await waitForPidFile(pidFile)
    await waitForChildExit(leader, 5_000)
    expect(leader.exitCode).toBe(0)
    expect(pidIsAlive(descendantPid)).toBe(true)

    const cleanup = await cleanupOfficialBrowserExtensionResources({
      commands: new Set(),
      process: leader,
    })
    liveChildren.delete(leader)

    expect(cleanup).toEqual({
      browserStopped: true,
      clipboardCleared: true,
      profileRemoved: true,
    })
    await expect(waitForPidExit(descendantPid, 5_000)).resolves.toBeUndefined()
  })

  it('shares one in-flight cleanup across concurrent callers', async () => {
    const browser = spawn(
      process.execPath,
      ['-e', 'setTimeout(() => process.exit(0), 250)'],
      {
        detached: true,
        stdio: 'ignore',
      },
    )
    liveChildren.add(browser)
    const resources = {
      commands: new Set<ChildProcess>(),
      process: browser,
    }

    const firstCleanup = cleanupOfficialBrowserExtensionResources(resources)
    const concurrentCleanup =
      cleanupOfficialBrowserExtensionResources(resources)

    await Promise.all([firstCleanup, concurrentCleanup])
    liveChildren.delete(browser)

    expect(concurrentCleanup).toBe(firstCleanup)
  })

  it('redacts JWT and base64url token shapes adjacent to underscores and hyphens', () => {
    const jwt = [`eyJ${'a'.repeat(16)}`, 'b'.repeat(16), 'c'.repeat(16)].join(
      '.',
    )
    const token = `${'A'.repeat(42)}_`
    const details = {
      exception: {
        description: `jwt=prefix_${jwt}-suffix token=prefix_${token}-suffix`,
      },
      text: `text jwt=prefix_${jwt}_suffix token=prefix-${token}_suffix`,
      url: 'chrome-extension://extension-id/background.js',
    }

    const redacted = redactBrowserRuntimeException(details, 'background', [])

    expect(redacted.description).not.toContain(jwt)
    expect(redacted.description).not.toContain(token)
    expect(redacted.text).not.toContain(jwt)
    expect(redacted.text).not.toContain(token)
    expect(redacted.description).toContain('[redacted-jwt]')
    expect(redacted.description).toContain('[redacted-token]')
    expect(redacted.text).toContain('[redacted-jwt]')
    expect(redacted.text).toContain('[redacted-token]')
  })
})

class FakeCdpSocket extends EventTarget {
  readyState = 1

  send() {}

  close() {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }

  disconnect() {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }

  beginDisconnect() {
    this.readyState = 2
  }

  finishDisconnect() {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }

  fail() {
    this.dispatchEvent(new Event('error'))
  }
}

async function createOwnedProfile(label: string) {
  const root = join(
    repoRoot,
    'test/.tmp',
    `browser-readback-${label}-${crypto.randomUUID()}`,
  )
  const profile = join(root, 'profile')
  await mkdir(profile, { recursive: true, mode: 0o700 })
  await chmod(profile, 0o700)
  return {
    absolute: profile,
    relative: relative(repoRoot, profile),
  }
}

function endpointFor(port: number, browserPath: string) {
  return {
    address: '127.0.0.1',
    browserPath,
    origin: `http://127.0.0.1:${port}`,
    port,
    webSocketDebuggerUrl: `ws://127.0.0.1:${port}${browserPath}`,
  }
}

async function withJsonServer(
  handler: (
    request: IncomingMessage,
    response: ServerResponse,
    port: number,
  ) => void,
) {
  let port = 0
  const server = createServer((request, response) => {
    handler(request, response, port)
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('test server did not bind to a TCP port')
  }
  port = address.port
  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

function writeJson(response: ServerResponse, value: unknown) {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

async function waitForPidFile(path: string): Promise<number> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      const pidText = await readFile(path, 'utf8')
      const pid = Number(pidText)
      if (Number.isSafeInteger(pid) && pid > 0) return pid
    } catch {
      // Wait for the leader to publish its child pid.
    }
    await delay(25)
  }
  throw new Error('descendant pid file was not written')
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number) {
  if (child.exitCode !== null || child.signalCode !== null) return
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    delay(timeoutMs).then(() => {
      throw new Error('child did not exit')
    }),
  ])
}

async function waitForPidExit(pid: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!pidIsAlive(pid)) return
    await delay(50)
  }
  throw new Error(`pid ${pid} did not exit`)
}

function pidIsAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error) {
      return error.code !== 'ESRCH'
    }
    throw error
  }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, milliseconds)
  })
}

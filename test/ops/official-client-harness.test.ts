import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import {
  access,
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const script = join(repoRoot, 'scripts/honowarden-official-client-harness.mjs')
const confirmation = 'official-client-harness'

const harnessModule = import(pathToFileURL(script).href)

describe('pinned official-client harness', () => {
  afterEach(async () => {
    const fixtureDirectory = join(repoRoot, 'test/.tmp')
    const entries = await readdir(fixtureDirectory)
    await Promise.all(
      entries
        .filter((entry) => entry.startsWith('official-client-'))
        .map((entry) =>
          rm(join(fixtureDirectory, entry), {
            recursive: true,
            force: true,
          }),
        ),
    )
  })

  it('plans exact source and release pins without creating secret storage', async () => {
    const root = ignoredRoot('plan')
    const result = await run([
      'plan',
      '--root',
      root,
      '--at',
      '2026-07-20T06:00:00.000Z',
      '--timeout-ms',
      '12345',
    ])
    const packet = JSON.parse(result.stdout)

    expect(packet).toMatchObject({
      schemaVersion: 1,
      action: 'plan',
      generatedAt: '2026-07-20T06:00:00.000Z',
      executed: false,
      status: 'planned',
      root,
      pins: {
        server: {
          tag: 'v2026.6.1',
          commit: 'a09c7edb03ae6d4fdece784f1250c67be73d5fe0',
        },
        web: {
          tag: 'web-v2026.6.1',
          commit: '39f07436ca60e3f25eac47777671754f288a98f1',
        },
        browser: {
          tag: 'browser-v2026.6.1',
          commit: '723c075bf8b9f45c901e56195be8e94e43ed75a2',
        },
        cli: {
          tag: 'cli-v2026.6.0',
          commit: 'e6293ff2bc85123e9baaa998cf1543030ec5d9f0',
        },
      },
      assets: {
        cliNpm: {
          id: 457_887_277,
          name: `${['bit', 'warden'].join('')}-cli-2026.6.0-npm-build.zip`,
          size: 4_402_383,
          sha256:
            '31765936eef9beca89298ffb554a658138932d505deebc6b65e02baa065c0660',
        },
        cliMacArm64: {
          id: 457_887_093,
          name: 'bw-macos-arm64-2026.6.0.zip',
          size: 41_121_808,
          sha256:
            '57d1e60d7748c6efed96559833ce0423a5c825cbf1356d952970c87a497a64d4',
        },
        browserChrome: {
          id: 462_351_736,
          name: 'dist-chrome-2026.6.1.zip',
          size: 21_593_500,
          sha256:
            'fcd29c5971d9b218ad9159717a19c38cca5150f2a0aa909ddf805bd7695d097e',
        },
      },
      safety: {
        officialImplementation: true,
        productionSupported: false,
        realCredentialsAllowed: false,
        printsSecrets: false,
        ignoredStorageRequired: true,
        isolatedProcessGroup: true,
      },
    })
    expect(packet.next.command).toContain(`--confirm ${confirmation}`)
    expect(packet.next.command).toContain('--at 2026-07-20T06:00:00.000Z')
    expect(packet.next.command).toContain('--timeout-ms 12345')
    await expect(access(join(repoRoot, root))).rejects.toThrow()
  })

  it('requires explicit confirmation before preparing or running clients', async () => {
    await expect(
      run(['prepare', '--root', ignoredRoot('confirm'), '--execute']),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        `--confirm ${confirmation} is required before --execute`,
      ),
    })

    await expect(
      run([
        'cli-run',
        '--root',
        ignoredRoot('cli-confirm'),
        '--execute',
        '--',
        'status',
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        `--confirm ${confirmation} is required before --execute`,
      ),
    })
  })

  it('keeps server configuration under the loopback-only wrapper', async () => {
    const { validateLoopbackOrigin, validateOfficialCliArgs } =
      await harnessModule

    expect(() => validateOfficialCliArgs(['status'])).not.toThrow()
    expect(() =>
      validateOfficialCliArgs([
        'login',
        '--passwordenv',
        'BW_PASSWORD',
        'fixture@example.invalid',
      ]),
    ).not.toThrow()
    expect(() =>
      validateOfficialCliArgs([
        'config',
        'server',
        'https://external.example.com',
      ]),
    ).toThrow('official CLI command is not allowed by the harness')
    expect(() =>
      validateOfficialCliArgs(['unlock', '--password', 'secret']),
    ).toThrow(
      'pass official CLI secrets through HONOWARDEN_SYNTHETIC_BW_* environment variables',
    )
    for (const unsafeArgs of [
      ['login', 'fixture@example.invalid', 'synthetic-positional-password'],
      ['unlock', 'synthetic-positional-password'],
      ['login', '--passwordfile', '/tmp/real-password'],
      ['login', '--code', '123456', 'fixture@example.invalid'],
      ['get', 'attachment', 'fixture-id', '--output', '/tmp/decrypted'],
    ]) {
      expect(() => validateOfficialCliArgs(unsafeArgs)).toThrow(
        'official CLI arguments violate the synthetic-only harness contract',
      )
    }
    expect(() =>
      validateOfficialCliArgs([
        'unlock',
        '--passwordenv',
        'BW_PASSWORD',
        '--raw',
      ]),
    ).not.toThrow()
    expect(() =>
      validateOfficialCliArgs(['get', 'item', 'fixture-item-id']),
    ).not.toThrow()
    expect(() =>
      validateOfficialCliArgs([
        'get',
        'item',
        '11111111-2222-4333-8444-555555555555',
      ]),
    ).not.toThrow()
    expect(validateLoopbackOrigin('http://127.0.0.1:8787')).toBe(
      'http://127.0.0.1:8787',
    )
    expect(validateLoopbackOrigin('https://localhost:9443')).toBe(
      'https://localhost:9443',
    )
    expect(validateLoopbackOrigin('http://[::1]:8787')).toBe(
      'http://[::1]:8787',
    )
    expect(() =>
      validateLoopbackOrigin('https://external.example.com'),
    ).toThrow('--origin must be an origin-only loopback URL')
    expect(() =>
      validateLoopbackOrigin('http://user:secret@127.0.0.1:8787'),
    ).toThrow('--origin must be an origin-only loopback URL')
  })

  it('reads the configured CLI server before deciding whether to update it', async () => {
    const { requiresOfficialCliServerUpdate } = await harnessModule

    expect(
      requiresOfficialCliServerUpdate(
        'http://127.0.0.1:8787\n',
        'http://127.0.0.1:8787',
      ),
    ).toBe(false)
    expect(
      requiresOfficialCliServerUpdate(
        'https://vault.example.test',
        'http://127.0.0.1:8787',
      ),
    ).toBe(true)
    expect(requiresOfficialCliServerUpdate('', 'http://127.0.0.1:8787')).toBe(
      true,
    )
    expect(() =>
      requiresOfficialCliServerUpdate(
        'not-a-server-origin',
        'http://127.0.0.1:8787',
      ),
    ).toThrow('official CLI returned an invalid server configuration')
  })

  it('rejects custom service endpoints in the pinned CLI profile', async () => {
    const { validateOfficialCliProfileEnvironment } = await harnessModule
    const origin = 'http://127.0.0.1:8787'
    const userEnvironmentKey =
      'user_11111111-2222-4333-8444-555555555555_environment_environment'
    const profile = {
      global_environment_environment: {
        region: 'Self-hosted',
        urls: {
          base: origin,
          api: null,
          identity: null,
          webVault: null,
          icons: null,
          notifications: null,
          events: null,
          keyConnector: null,
          send: null,
        },
      },
      [userEnvironmentKey]: {
        region: 'Self-hosted',
        urls: {
          base: origin,
          api: null,
          identity: null,
          webVault: null,
          icons: null,
          notifications: null,
          events: null,
          keyConnector: null,
          scim: null,
          send: null,
        },
      },
    }

    expect(validateOfficialCliProfileEnvironment(profile, origin)).toEqual({
      baseMatches: true,
      customEndpoints: false,
    })
    expect(() =>
      validateOfficialCliProfileEnvironment(
        {
          ...profile,
          global_environment_environment: {
            ...profile.global_environment_environment,
            urls: {
              ...profile.global_environment_environment.urls,
              api: 'https://external.example.test/api',
            },
          },
        },
        origin,
      ),
    ).toThrow(
      'official CLI profile server configuration violated the loopback-only contract',
    )
    expect(() =>
      validateOfficialCliProfileEnvironment(
        {
          ...profile,
          global_environment_environment: {
            ...profile.global_environment_environment,
            urls: {
              ...profile.global_environment_environment.urls,
              base: 'https://external.example.test',
            },
          },
        },
        origin,
      ),
    ).toThrow(
      'official CLI profile server configuration violated the loopback-only contract',
    )
    expect(() =>
      validateOfficialCliProfileEnvironment(
        {
          ...profile,
          [userEnvironmentKey]: {
            ...profile[userEnvironmentKey],
            urls: {
              ...profile[userEnvironmentKey].urls,
              identity: 'https://external.example.test/identity',
            },
          },
        },
        origin,
      ),
    ).toThrow(
      'official CLI profile server configuration violated the loopback-only contract',
    )
    expect(() =>
      validateOfficialCliProfileEnvironment(
        {
          ...profile,
          [userEnvironmentKey]: {
            ...profile[userEnvironmentKey],
            region: 'US',
          },
        },
        origin,
      ),
    ).toThrow(
      'official CLI profile server configuration violated the loopback-only contract',
    )
  })

  it('maps only explicitly synthetic upstream credentials into the client', async () => {
    const { isolatedClientEnvironment, resolveHarnessRoot } =
      await harnessModule
    const root = resolveHarnessRoot(ignoredRoot('environment'))
    const environment = isolatedClientEnvironment(root, {
      PATH: '/usr/bin:/bin',
      BW_PASSWORD: 'ambient-real-password',
      BW_SESSION: 'ambient-real-session',
      HONOWARDEN_SYNTHETIC_BW_PASSWORD: 'synthetic-password',
      HONOWARDEN_SYNTHETIC_BW_SESSION: 'synthetic-session',
    })

    expect(environment).toMatchObject({
      PATH: '/usr/bin:/bin',
      BW_NOINTERACTION: 'true',
      BW_PASSWORD: 'synthetic-password',
      BW_SESSION: 'synthetic-session',
    })
    expect(environment).not.toHaveProperty('HONOWARDEN_SYNTHETIC_BW_PASSWORD')
    expect(environment).not.toHaveProperty('HONOWARDEN_SYNTHETIC_BW_SESSION')
    expect(JSON.stringify(environment)).not.toContain('ambient-real')
  })

  it('rejects secret-bearing CLI plans without echoing the secret', async () => {
    const secret = 'synthetic-plan-secret-that-must-not-be-printed'
    let rejected: (Error & { stdout?: string; stderr?: string }) | undefined

    try {
      await run([
        'cli-run',
        '--origin',
        'http://127.0.0.1:8787',
        '--',
        'login',
        'fixture@example.invalid',
        secret,
      ])
    } catch (error) {
      rejected = error as Error & { stdout?: string; stderr?: string }
    }

    expect(rejected).toBeDefined()
    expect(rejected?.stdout ?? '').not.toContain(secret)
    expect(rejected?.stderr ?? '').not.toContain(secret)
  })

  it('rejects origins for non-CLI actions without echoing the origin', async () => {
    const secret = 'synthetic-origin-secret-that-must-not-be-printed'
    let rejected: (Error & { stdout?: string; stderr?: string }) | undefined

    try {
      await run([
        'plan',
        '--origin',
        `http://user:${secret}@external.example.test/path?token=${secret}`,
      ])
    } catch (error) {
      rejected = error as Error & { stdout?: string; stderr?: string }
    }

    expect(rejected).toBeDefined()
    expect(rejected?.stderr).toContain('--origin is only allowed for cli-run')
    expect(rejected?.stdout ?? '').not.toContain(secret)
    expect(rejected?.stderr ?? '').not.toContain(secret)
  })

  it('rejects unknown harness options without echoing their values', async () => {
    const secret = 'synthetic-option-secret-that-must-not-be-printed'
    let rejected: (Error & { stdout?: string; stderr?: string }) | undefined

    try {
      await run(['plan', `--password=${secret}`])
    } catch (error) {
      rejected = error as Error & { stdout?: string; stderr?: string }
    }

    expect(rejected).toBeDefined()
    expect(rejected?.stderr).toContain('unknown harness option')
    expect(rejected?.stdout ?? '').not.toContain(secret)
    expect(rejected?.stderr ?? '').not.toContain(secret)
  })

  it('rejects roots outside ignored storage and symlinked path components', async () => {
    const { resolveHarnessRoot, validateHarnessRoot } = await harnessModule

    expect(() => resolveHarnessRoot('/tmp/honowarden-official-client')).toThrow(
      'root must be inside test/.tmp',
    )

    const target = join(
      repoRoot,
      'test/.tmp',
      `official-client-target-${crypto.randomUUID()}`,
    )
    const link = join(
      repoRoot,
      'test/.tmp',
      `official-client-link-${crypto.randomUUID()}`,
    )
    await mkdir(target, { recursive: true, mode: 0o700 })
    await symlink(target, link)

    await expect(validateHarnessRoot(resolveHarnessRoot(link))).rejects.toThrow(
      'harness root must not contain symlinks',
    )
  })

  it('rejects mutable harness directories replaced by symlinks', async () => {
    const {
      resolveHarnessRoot,
      validateHarnessDirectories,
      validateHarnessRoot,
    } = await harnessModule
    const rootPath = ignoredRoot('mutable-link')
    const root = resolveHarnessRoot(rootPath)
    const outside = join(
      repoRoot,
      'test/.tmp',
      `official-client-outside-${crypto.randomUUID()}`,
    )
    await mkdir(root.absolute, { recursive: true, mode: 0o700 })
    await mkdir(outside, { mode: 0o700 })
    for (const directory of [
      'assets',
      'crypto',
      'native',
      'profile',
      'home',
      'tmp',
      'responses',
      'output',
    ]) {
      await mkdir(join(root.absolute, directory), { mode: 0o700 })
    }
    await symlink(outside, join(root.absolute, 'requests'))
    await validateHarnessRoot(root)

    await expect(validateHarnessDirectories(root)).rejects.toThrow(
      'harness requests directory must not be a symlink',
    )
  })

  it('rejects symlinks nested inside mutable profile storage', async () => {
    const {
      resolveHarnessRoot,
      validateHarnessDirectories,
      validateHarnessRoot,
    } = await harnessModule
    const root = resolveHarnessRoot(ignoredRoot('profile-link'))
    const outside = join(
      repoRoot,
      'test/.tmp',
      `official-client-profile-outside-${crypto.randomUUID()}.json`,
    )
    await mkdir(root.absolute, { recursive: true, mode: 0o700 })
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
    await writeFile(outside, '{}\n', { mode: 0o600 })
    await symlink(outside, join(root.absolute, 'profile', 'data.json'))

    try {
      await validateHarnessRoot(root)
      await expect(validateHarnessDirectories(root)).rejects.toThrow(
        'harness profile tree must not contain symlinks',
      )
    } finally {
      await rm(root.absolute, { recursive: true, force: true })
      await rm(outside, { force: true })
    }
  })

  it('rejects prepared runtime files that no longer match their manifest', async () => {
    const { validateRuntimeFileManifest } = await harnessModule
    const root = join(
      repoRoot,
      'test/.tmp',
      `official-client-runtime-${crypto.randomUUID()}`,
    )
    const cryptoDirectory = join(root, 'crypto')
    const nativeDirectory = join(root, 'native')
    const bridgePath = join(cryptoDirectory, 'bridge.cjs')
    const nativePath = join(nativeDirectory, 'client')
    const bridge = Buffer.from('trusted bridge')
    const native = Buffer.from('trusted native')
    await mkdir(cryptoDirectory, { recursive: true, mode: 0o700 })
    await mkdir(nativeDirectory, { mode: 0o700 })
    await writeFile(bridgePath, bridge, { mode: 0o700 })
    await writeFile(nativePath, native, { mode: 0o700 })
    const manifest = {
      'crypto/bridge.cjs': {
        bytes: bridge.length,
        sha256: createHash('sha256').update(bridge).digest('hex'),
        mode: 0o700,
      },
      'native/client': {
        bytes: native.length,
        sha256: createHash('sha256').update(native).digest('hex'),
        mode: 0o700,
      },
    }

    try {
      await expect(
        validateRuntimeFileManifest(root, manifest),
      ).resolves.toBeDefined()
      await writeFile(nativePath, 'tampered native', { mode: 0o700 })
      await expect(validateRuntimeFileManifest(root, manifest)).rejects.toThrow(
        'prepared runtime file did not match its pinned archive',
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails closed on asset size and digest mismatches', async () => {
    const { verifyPinnedAsset } = await harnessModule
    const bytes = Buffer.from('verified-official-asset')
    const metadata = {
      name: 'fixture.zip',
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }

    expect(verifyPinnedAsset(bytes, metadata)).toEqual({
      name: 'fixture.zip',
      size: bytes.length,
      sha256: metadata.sha256,
    })
    expect(() =>
      verifyPinnedAsset(bytes, { ...metadata, size: bytes.length + 1 }),
    ).toThrow('asset size mismatch')
    expect(() =>
      verifyPinnedAsset(bytes, { ...metadata, sha256: '0'.repeat(64) }),
    ).toThrow('asset digest mismatch')
  })

  it('injects the crypto bridge at one exact webpack boundary', async () => {
    const { renderOfficialCryptoBridge } = await harnessModule
    const source = `#!/usr/bin/env node
/******/ (() => { // webpackBootstrap
var __webpack_exports__ = {};
require("external-package");
/******/ })()
`
    const rendered = renderOfficialCryptoBridge(source)

    expect(rendered).toContain('/******/ (async () => { // webpackBootstrap')
    expect(rendered).toContain('HONOWARDEN_OFFICIAL_CRYPTO_BRIDGE')
    expect(rendered).toContain('await __webpack_require__.e(685)')
    expect(rendered).toContain('sdk.lIU(wasm)')
    expect(rendered).toContain('sdk.IEs.unwrap_decapsulation_key')
    expect(rendered).toContain('kdfId')
    expect(rendered.indexOf('HONOWARDEN_OFFICIAL_CRYPTO_BRIDGE')).toBeLessThan(
      rendered.indexOf('require("external-package")'),
    )

    expect(() =>
      renderOfficialCryptoBridge(source.replace('var __webpack_exports__', '')),
    ).toThrow('webpack export boundary did not match exactly once')
    expect(() =>
      renderOfficialCryptoBridge(`${source}\nvar __webpack_exports__ = {};`),
    ).toThrow('webpack export boundary did not match exactly once')
  })

  it('captures official CLI output without returning secret bytes', async () => {
    const { runCapturedProcess } = await harnessModule
    const root = join(
      repoRoot,
      'test/.tmp',
      `official-client-capture-${crypto.randomUUID()}`,
    )
    const output = join(root, 'output')
    const fakeCli = join(root, 'fake-cli.mjs')
    await mkdir(output, { recursive: true, mode: 0o700 })
    await writeFile(
      fakeCli,
      [
        "process.stdout.write('synthetic-secret-stdout')",
        "process.stderr.write('synthetic-secret-stderr')",
      ].join('\n'),
      { mode: 0o700 },
    )

    const result = await runCapturedProcess(process.execPath, [fakeCli], {
      cwd: root,
      env: process.env,
      outputDirectory: output,
      timeoutMs: 5_000,
      label: 'fake-cli',
    })
    const serialized = JSON.stringify(result)

    expect(result).toMatchObject({
      exitCode: 0,
      signal: null,
      timedOut: false,
      stdout: { bytes: 23 },
      stderr: { bytes: 23 },
    })
    expect(result.stdout.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.stderr.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(serialized).not.toContain('synthetic-secret')
    expect(await readFile(join(output, 'fake-cli.stdout.log'), 'utf8')).toBe(
      'synthetic-secret-stdout',
    )
    expect(await readFile(join(output, 'fake-cli.stderr.log'), 'utf8')).toBe(
      'synthetic-secret-stderr',
    )
    expect(
      (await lstat(join(output, 'fake-cli.stdout.log'))).mode & 0o777,
    ).toBe(0o600)
  })

  it('kills the isolated process group on timeout', async () => {
    const { runCapturedProcess } = await harnessModule
    const root = join(
      repoRoot,
      'test/.tmp',
      `official-client-timeout-${crypto.randomUUID()}`,
    )
    const output = join(root, 'output')
    const childPidPath = join(root, 'child.pid')
    const command = join(root, 'wait.sh')
    await mkdir(output, { recursive: true, mode: 0o700 })
    await writeFile(
      command,
      `#!/bin/sh
sleep 30 &
printf '%s' "$!" > ${shellQuote(childPidPath)}
wait
`,
      { mode: 0o700 },
    )
    await chmod(command, 0o700)

    const result = await runCapturedProcess(command, [], {
      cwd: root,
      env: process.env,
      outputDirectory: output,
      timeoutMs: 1_000,
      label: 'timeout',
    })
    const childPid = Number(await readFile(childPidPath, 'utf8'))

    expect(result).toMatchObject({
      exitCode: null,
      signal: 'SIGTERM',
      timedOut: true,
    })
    await expectProcessGone(childPid)
  })

  it('kills descendants that outlive a terminating group leader', async () => {
    const { runCapturedProcess } = await harnessModule
    const root = join(
      repoRoot,
      'test/.tmp',
      `official-client-stubborn-${crypto.randomUUID()}`,
    )
    const output = join(root, 'output')
    const parentPidPath = join(root, 'parent.pid')
    const childPidPath = join(root, 'child.pid')
    const command = join(root, 'wait.sh')
    let parentPid: number | undefined
    await mkdir(output, { recursive: true, mode: 0o700 })
    await writeFile(
      command,
      `#!/bin/sh
printf '%s' "$$" > ${shellQuote(parentPidPath)}
sh -c 'trap "" TERM; while :; do sleep 1; done' &
printf '%s' "$!" > ${shellQuote(childPidPath)}
trap 'exit 0' TERM
wait
`,
      { mode: 0o700 },
    )
    await chmod(command, 0o700)

    let testError: unknown
    let cleanupError: unknown
    try {
      const result = await runCapturedProcess(command, [], {
        cwd: root,
        env: process.env,
        outputDirectory: output,
        timeoutMs: 1_000,
        label: 'stubborn',
      })
      parentPid = Number(await readFile(parentPidPath, 'utf8'))
      const childPid = Number(await readFile(childPidPath, 'utf8'))

      expect(result.timedOut).toBe(true)
      await expectProcessGone(childPid)
    } catch (error) {
      testError = error
    }
    if (parentPid) {
      try {
        process.kill(-parentPid, 'SIGKILL')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
          cleanupError = error
        }
      }
    }
    try {
      await rm(root, { recursive: true, force: true })
    } catch (error) {
      cleanupError ??= error
    }
    if (testError) throw testError
    if (cleanupError) throw cleanupError
  })

  it('reaps a detached child before propagating parent termination', async () => {
    const root = join(
      repoRoot,
      'test/.tmp',
      `official-client-parent-signal-${crypto.randomUUID()}`,
    )
    const output = join(root, 'output')
    const childPidPath = join(root, 'child.pid')
    const command = join(root, 'wait.sh')
    const parentScript = join(root, 'parent.mjs')
    let parent: ReturnType<typeof spawn> | undefined
    let childPid: number | undefined
    await mkdir(output, { recursive: true, mode: 0o700 })
    await writeFile(
      command,
      `#!/bin/sh
printf '%s' "$$" > ${shellQuote(childPidPath)}
trap '' TERM
while :; do sleep 1; done
`,
      { mode: 0o700 },
    )
    await chmod(command, 0o700)
    await writeFile(
      parentScript,
      `import { runCapturedProcess } from ${JSON.stringify(pathToFileURL(script).href)}
await runCapturedProcess(${JSON.stringify(command)}, [], {
  cwd: ${JSON.stringify(root)},
  env: process.env,
  outputDirectory: ${JSON.stringify(output)},
  timeoutMs: 300000,
  label: 'parent-signal',
})
`,
      { mode: 0o600 },
    )

    let testError: unknown
    let cleanupError: unknown
    try {
      parent = spawn(process.execPath, [parentScript], {
        cwd: repoRoot,
        stdio: 'ignore',
      })
      await waitForFile(childPidPath)
      childPid = Number(await readFile(childPidPath, 'utf8'))
      process.kill(parent.pid!, 'SIGTERM')
      const [exitCode, signal] = (await once(parent, 'exit')) as [
        number | null,
        NodeJS.Signals | null,
      ]

      expect(exitCode).toBeNull()
      expect(signal).toBe('SIGTERM')
      await expectProcessGone(childPid)
    } catch (error) {
      testError = error
    }
    if (parent?.pid && parent.exitCode === null && parent.signalCode === null) {
      try {
        process.kill(parent.pid, 'SIGKILL')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
          cleanupError = error
        }
      }
    }
    if (childPid) {
      try {
        process.kill(-childPid, 'SIGKILL')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
          cleanupError = error
        }
      }
    }
    try {
      await rm(root, { recursive: true, force: true })
    } catch (error) {
      cleanupError ??= error
    }
    if (testError) throw testError
    if (cleanupError) throw cleanupError
  }, 15_000)

  it('installs bounded signal cleanup in detached lifecycle harnesses', () => {
    for (const path of [
      'scripts/honowarden-account-key-lifecycle.mjs',
      'scripts/honowarden-kdf-change-lifecycle.mjs',
      'scripts/honowarden-password-change-lifecycle.mjs',
      'scripts/honowarden-user-key-rotation-lifecycle.mjs',
    ]) {
      const source = readRepoFile(path)
      expect(source).toContain('createIdempotentCleanup')
      expect(source).toContain('installSignalCleanup')
      expect(source).toMatch(
        /} finally {\s+try {\s+await cleanup\(\)\s+} finally {\s+removeSignalCleanup\(\)/,
      )
    }
  })

  it('documents the evidence levels, recovery boundary, and package command', () => {
    const packageJson = readRepoFile('package.json')
    const runbook = readRepoFile(
      'docs/operations/official-client-credential-harness.md',
    )

    expect(packageJson).toContain('"client:official-harness"')
    expect(runbook).toContain('cli-v2026.6.0')
    expect(runbook).toContain('browser-v2026.6.1')
    expect(runbook).toContain('upstream-cli-sdk-wasm')
    expect(runbook).toContain('local_official_client')
    expect(runbook).toContain('test/.tmp/hon-207-official-client')
    expect(runbook).toContain('--confirm official-client-harness')
    expect(runbook).toMatch(/stdout\s+and\s+stderr.*mode\s+0600/i)
    expect(runbook).toMatch(/never\s+restores\s+an\s+older\s+credential/i)
    expect(runbook).toMatch(/production.*not\s+supported/i)
    expect(runbook).toContain('Chrome for Testing')
    expect(runbook).toContain('pnpm client:official-harness')
  })
})

function ignoredRoot(label: string): string {
  return `test/.tmp/official-client-${label}-${crypto.randomUUID()}`
}

async function run(args: string[]) {
  return execFileAsync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    env: process.env,
  })
}

async function expectProcessGone(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return
      throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`timed out process ${pid} was still running`)
}

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await access(path)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  throw new Error(`timed out waiting for ${path}`)
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}

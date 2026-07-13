import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const script = join(repoRoot, 'scripts/honowarden-browser-profile.mjs')
const confirmation = 'clean-browser-profile'

describe('official browser profile fixture CLI', () => {
  it('plans a pinned fresh profile without touching disk', async () => {
    const root = ignoredRoot('plan')
    const result = await run([
      'prepare',
      '--root',
      root,
      '--at',
      '2026-07-11T08:00:00.000Z',
    ])
    const packet = JSON.parse(result.stdout)

    expect(packet).toMatchObject({
      schemaVersion: 1,
      action: 'prepare',
      executed: false,
      status: 'planned',
      root,
      release: {
        repository: 'github:53538899',
        repositoryId: 53_538_899,
        tag: 'browser-v2026.6.1',
        asset: 'dist-chrome-2026.6.1.zip',
        assetId: 462_351_736,
        sha256:
          'fcd29c5971d9b218ad9159717a19c38cca5150f2a0aa909ddf805bd7695d097e',
        size: 21_593_500,
        manifestVersion: '2026.6.1',
      },
      launch: {
        browser: 'Brave Browser',
        remoteDebuggingPort: 9224,
      },
      safety: {
        freshProfileRequired: true,
        productionDataAllowed: false,
        printsCredentials: false,
      },
    })
    expect(result.stdout).toContain(
      'https://api.github.com/repositories/53538899/releases/assets/462351736',
    )
    expect(packet.launch.args).toEqual(expectedLaunchArgs(root))
    expect(packet.launch.args).not.toContain(
      '--enable-unsafe-extension-debugging',
    )
    await expect(access(join(repoRoot, root))).rejects.toThrow()
  })

  it('plans the fixed Chrome for Testing launch contract', async () => {
    const root = ignoredRoot('chrome-for-testing')
    const result = await run([
      'prepare',
      '--root',
      root,
      '--browser',
      'chrome-for-testing',
      '--browser-executable',
      '/usr/bin/true',
    ])
    const packet = JSON.parse(result.stdout)

    expect(packet.launch).toMatchObject({
      browser: 'Chrome for Testing',
      executable: '/usr/bin/true',
      remoteDebuggingAddress: '127.0.0.1',
      remoteDebuggingPort: 9224,
    })
    expect(packet.launch.args).toEqual(expectedLaunchArgs(root, true))
    expect(
      packet.launch.args.filter(
        (arg: string) => arg === '--enable-unsafe-extension-debugging',
      ),
    ).toHaveLength(1)
    expect(packet.next.command).toContain('--browser chrome-for-testing')
    expect(packet.next.command).toContain('--browser-executable /usr/bin/true')
    await expect(access(join(repoRoot, root))).rejects.toThrow()
  })

  it('keeps the legacy Brave executable override', async () => {
    const result = await run(['prepare', '--root', ignoredRoot('brave-env')], {
      HONOWARDEN_BRAVE_EXECUTABLE: '/usr/bin/true',
    })

    expect(JSON.parse(result.stdout).launch).toMatchObject({
      browser: 'Brave Browser',
      executable: '/usr/bin/true',
    })
  })

  it('rejects unknown browser hosts and missing Chrome executables', async () => {
    await expect(
      run(['prepare', '--browser', 'chromium']),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'unsupported --browser "chromium"; expected brave or chrome-for-testing',
      ),
    })

    await expect(
      run(['prepare', '--browser', 'chrome-for-testing']),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'Chrome for Testing requires --browser-executable <path>',
      ),
    })

    await expect(
      run([
        'prepare',
        '--browser',
        'constructor',
        '--browser-executable',
        '/usr/bin/true',
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'unsupported --browser "constructor"; expected brave or chrome-for-testing',
      ),
    })
  })

  it('rejects missing explicit browser executables during planning', async () => {
    const executable = join(
      tmpdir(),
      `honowarden-missing-browser-${crypto.randomUUID()}`,
    )

    await expect(
      run([
        'prepare',
        '--browser',
        'chrome-for-testing',
        '--browser-executable',
        executable,
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'Chrome for Testing executable was not accessible',
      ),
    })
  })

  it('rejects symlinked browser executables', async () => {
    const tools = await mkdtemp(join(tmpdir(), 'honowarden-browser-host-'))
    const executable = join(tools, 'browser')
    await symlink('/usr/bin/true', executable)

    await expect(
      run([
        'prepare',
        '--browser',
        'brave',
        '--browser-executable',
        executable,
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'Brave Browser executable must not be a symlink',
      ),
    })
  })

  it('rejects executables inside normal browser profile directories', async () => {
    const home = await mkdtemp(join(tmpdir(), 'honowarden-browser-home-'))
    const executable = join(
      home,
      'Library',
      'Application Support',
      'Google',
      'Chrome',
      'Default',
      'browser',
    )

    await expect(
      run(
        [
          'prepare',
          '--browser',
          'chrome-for-testing',
          '--browser-executable',
          executable,
        ],
        { HOME: home },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'Chrome for Testing executable must not point into a normal browser profile directory',
      ),
    })
  })

  it('rejects executables reached through a profile-directory symlink', async () => {
    const home = await mkdtemp(join(tmpdir(), 'honowarden-browser-home-'))
    const profile = join(
      home,
      'Library',
      'Application Support',
      'Google',
      'Chrome',
      'Default',
    )
    const executable = join(profile, 'browser')
    const linkRoot = await mkdtemp(
      join(tmpdir(), 'honowarden-browser-profile-link-'),
    )
    const linkedProfile = join(linkRoot, 'profile')
    await mkdir(profile, { recursive: true })
    await writeFile(executable, '#!/bin/sh\n')
    await symlink(profile, linkedProfile)

    await expect(
      run(
        [
          'prepare',
          '--browser',
          'chrome-for-testing',
          '--browser-executable',
          join(linkedProfile, 'browser'),
        ],
        { HOME: home },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'Chrome for Testing executable must not point into a normal browser profile directory',
      ),
    })
  })

  it('shell-quotes user-controlled roots in the execution command', async () => {
    const root = ignoredRoot('command with space;$(false)')
    const packet = JSON.parse((await run(['prepare', '--root', root])).stdout)

    expect(packet.next.command).toBe(
      `pnpm client:browser-profile -- prepare --root '${root}' --execute --confirm ${confirmation}`,
    )
  })

  it('does not accept arbitrary browser launch arguments', async () => {
    await expect(
      run(['prepare', '--browser-arg', '--disable-web-security']),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('Unknown option: --browser-arg'),
    })
  })

  it('requires exact confirmation before preparing a profile', async () => {
    await expect(
      run(['prepare', '--root', ignoredRoot('confirm'), '--execute']),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(`--confirm ${confirmation} is required`),
    })
  })

  it('rejects roots outside ignored storage and symlink escapes', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'honowarden-browser-outside-'))
    await expect(run(['prepare', '--root', outside])).rejects.toMatchObject({
      stderr: expect.stringContaining('root must be inside test/.tmp'),
    })

    const link = join(
      repoRoot,
      'test/.tmp',
      `browser-profile-link-${crypto.randomUUID()}`,
    )
    await mkdir(join(repoRoot, 'test/.tmp'), { recursive: true })
    await symlink(outside, link)
    await expect(
      run([
        'cleanup',
        '--root',
        relativeRoot(link),
        '--execute',
        '--confirm',
        confirmation,
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('root must not be a symlink'),
    })
  })

  it('removes a partial download when the pinned digest does not match', async () => {
    const root = ignoredRoot('digest')
    const preload = join(
      await mkdtemp(join(tmpdir(), 'honowarden-browser-fetch-')),
      'fetch.mjs',
    )
    await writeFile(
      preload,
      `globalThis.fetch = async (url) => {
  if (String(url) !== 'https://api.github.com/repositories/53538899/releases/assets/462351736') {
    throw new Error('unexpected URL')
  }
  return {
    ok: true,
    arrayBuffer: async () => new TextEncoder().encode('wrong asset').buffer,
  }
}
`,
    )

    await expect(
      run(['prepare', '--root', root, '--execute', '--confirm', confirmation], {
        NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
        HONOWARDEN_BRAVE_EXECUTABLE: '/usr/bin/true',
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('browser asset digest mismatch'),
    })
    await expect(access(join(repoRoot, root))).rejects.toThrow()
  })

  it('reports an absent profile and cleans only the confirmed ignored root', async () => {
    const root = ignoredRoot('cleanup')
    const absoluteRoot = join(repoRoot, root)
    const tools = await fakeClipboard()

    const missing = await run([
      'status',
      '--root',
      root,
      '--execute',
      '--confirm',
      confirmation,
    ])
    expect(JSON.parse(missing.stdout)).toMatchObject({
      executed: true,
      status: 'not_prepared',
      readback: { rootExists: false },
    })

    await mkdir(absoluteRoot, { recursive: true })
    await writeFile(
      join(absoluteRoot, 'partial-sensitive-state'),
      'do-not-print',
      {
        mode: 0o600,
      },
    )
    await writeFile(tools.clipboard, 'stale-value')

    const cleanup = await run(
      ['cleanup', '--root', root, '--execute', '--confirm', confirmation],
      { PATH: `${tools.bin}${delimiter}${process.env.PATH}` },
    )
    expect(JSON.parse(cleanup.stdout)).toMatchObject({
      executed: true,
      status: 'clean',
      readback: { rootExists: false, clipboardCleared: true },
    })
    expect(cleanup.stdout).not.toContain('do-not-print')
    expect(await readFile(tools.clipboard, 'utf8')).toBe('')
    await expect(access(absoluteRoot)).rejects.toThrow()
  })

  it('restores persisted browser metadata in the cleanup packet', async () => {
    const root = ignoredRoot('cleanup-host')
    const absoluteRoot = join(repoRoot, root)
    const tools = await fakeClipboard()
    await mkdir(absoluteRoot, { recursive: true })
    await writeFile(
      join(absoluteRoot, 'profile-state.json'),
      JSON.stringify({
        browser: {
          id: 'chrome-for-testing',
          name: 'Chrome for Testing',
          version: 'Google Chrome for Testing 149.0.7827.55',
          executable: '/usr/bin/true',
        },
      }),
    )

    const cleanup = await run(
      ['cleanup', '--root', root, '--execute', '--confirm', confirmation],
      { PATH: `${tools.bin}${delimiter}${process.env.PATH}` },
    )
    expect(JSON.parse(cleanup.stdout)).toMatchObject({
      status: 'clean',
      launch: {
        browser: 'Chrome for Testing',
        version: 'Google Chrome for Testing 149.0.7827.55',
      },
    })
  })

  it('documents the pinned source, launch boundary, and cleanup', () => {
    const packageJson = readRepoFile('package.json')
    const runbook = readRepoFile(
      'docs/operations/official-browser-profile-evidence.md',
    )
    const authRunbook = readRepoFile(
      'docs/operations/official-client-auth-request-evidence.md',
    )

    expect(packageJson).toContain('"client:browser-profile"')
    expect(runbook).toContain('browser-v2026.6.1')
    expect(runbook).toContain('fcd29c5971d9b218')
    expect(runbook).toContain('--remote-debugging-port=9224')
    expect(runbook).toContain('clean-browser-profile')
    expect(runbook).toMatch(/never\s+enter\s+real\s+vault\s+credentials/i)
    expect(runbook).toContain('HON-95')
    expect(runbook).toContain('Status: passed for HON-94')
    expect(runbook).toContain('Brave Browser 150.1.92.134')
    expect(runbook).toContain('Brave Browser 150.1.92.139')
    expect(runbook).toContain('Chrome for Testing `149.0.7827.55`')
    expect(runbook).toContain('--browser brave')
    expect(runbook).toContain('--browser chrome-for-testing')
    expect(runbook).toContain('--browser-executable')
    expect(runbook).toContain('CLI-emitted per-host launch contract')
    expect(runbook).toContain('--enable-unsafe-extension-debugging')
    expect(runbook).toContain('evidence-only')
    expect(runbook).toMatch(
      /must\s+never\s+be\s+used\s+with\s+a\s+daily\s+browser\s+profile/,
    )
    expect(authRunbook).toContain('CLI-emitted per-host launch contract')
    expect(authRunbook).not.toContain(
      'in addition to the arguments printed by `client:browser-profile`',
    )
    expect(runbook).toContain('`rootExists: false`')
  })
})

async function run(args: string[], env: Record<string, string> = {}) {
  return execFileAsync('node', [script, ...args], {
    env: { ...process.env, ...env },
  })
}

function ignoredRoot(label: string): string {
  return `test/.tmp/browser-profile-${label}-${crypto.randomUUID()}`
}

function expectedLaunchArgs(root: string, unsafe = false): string[] {
  return [
    `--user-data-dir=${join(root, 'profile')}`,
    `--disable-extensions-except=${join(root, 'extension')}`,
    `--load-extension=${join(root, 'extension')}`,
    ...(unsafe ? ['--enable-unsafe-extension-debugging'] : []),
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=9224',
    '--no-first-run',
    '--no-default-browser-check',
  ]
}

function relativeRoot(path: string): string {
  return relative(repoRoot, path)
}

async function fakeClipboard() {
  const root = await mkdtemp(join(tmpdir(), 'honowarden-browser-tools-'))
  const bin = join(root, 'bin')
  const clipboard = join(root, 'clipboard')
  await mkdir(bin)
  await writeFile(
    join(bin, 'pbcopy'),
    `#!/bin/sh\ncat > ${JSON.stringify(clipboard)}\n`,
  )
  await chmod(join(bin, 'pbcopy'), 0o755)
  return { bin, clipboard }
}

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}

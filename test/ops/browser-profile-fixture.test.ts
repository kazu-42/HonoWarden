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
    await expect(access(join(repoRoot, root))).rejects.toThrow()
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

  it('documents the pinned source, launch boundary, and cleanup', () => {
    const packageJson = readRepoFile('package.json')
    const runbook = readRepoFile(
      'docs/operations/official-browser-profile-evidence.md',
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
    expect(runbook).toContain('--enable-unsafe-extension-debugging')
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

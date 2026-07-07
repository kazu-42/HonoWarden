import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const brandScanScript = join(repoRoot, 'scripts/honowarden-brand-scan.mjs')
const blockedToken = ['Bit', 'warden'].join('')

describe('brand scan script', () => {
  it('passes on clean repository content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'honowarden-brand-scan-clean-'))
    mkdirSync(join(root, 'dist'))
    writeFileSync(join(root, 'README.txt'), 'project: honowarden')

    const result = await execFileAsync(
      'node',
      [brandScanScript, '--root', root],
      {
        encoding: 'utf8',
      },
    )

    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })

  it('fails when blocked content exists in scanned files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'honowarden-brand-scan-fail-'))
    mkdirSync(join(root, 'src'))
    writeFileSync(
      join(root, 'src', 'app.ts'),
      `const heading = '${blockedToken}'`,
    )

    await expect(
      execFileAsync('node', [brandScanScript, '--root', root], {
        encoding: 'utf8',
      }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('app.ts:1'),
    })
  })

  it('respects excluded directories and files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'honowarden-brand-scan-ignore-'))
    mkdirSync(join(root, 'test/.tmp'), { recursive: true })
    mkdirSync(join(root, 'coverage'), { recursive: true })
    mkdirSync(join(root, 'node_modules'), { recursive: true })
    writeFileSync(join(root, 'test/.tmp', 'ignore.txt'), `skip ${blockedToken}`)
    writeFileSync(
      join(root, 'coverage', 'ignore.txt'),
      `skip ${blockedToken} in coverage`,
    )
    writeFileSync(
      join(root, 'node_modules', 'ignore.txt'),
      `skip ${blockedToken} in node_modules`,
    )
    writeFileSync(
      join(root, 'LICENSE'),
      `forbidden ${blockedToken} should not be scanned`,
    )
    writeFileSync(join(root, 'pnpm-lock.yaml'), `ignore ${blockedToken} too`)

    const result = await execFileAsync(
      'node',
      [brandScanScript, '--root', root],
      {
        encoding: 'utf8',
      },
    )

    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })
})

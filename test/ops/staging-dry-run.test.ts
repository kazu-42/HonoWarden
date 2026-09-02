import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const dryRunScript = fileURLToPath(
  new URL(
    '../../scripts/honowarden-staging-dry-run.mjs',
    import.meta.url,
  ).toString(),
)
const stopMessage =
  'REAL WORKER/VERSION/TRAFFIC WRITE STOP: deploy, dry-run, and automated recovery are disabled pending a separately reviewed execution boundary.'
const packageStop =
  "deploy_stop() { printf '%s\\n' 'REAL WORKER/VERSION/TRAFFIC WRITE STOP: deploy, dry-run, and automated recovery are disabled pending a separately reviewed execution boundary.' >&2; return 1; }; deploy_stop"

describe('legacy staging dry-run entrypoint', () => {
  it.each([
    { args: [] },
    { args: ['--strict'] },
    { args: ['--output', 'ignored'] },
    { args: ['--unknown'] },
  ])('statically blocks invocation $args', async ({ args }) => {
    const result = await runBlocked(args)

    expect(result).toEqual({
      code: 1,
      stdout: '',
      stderr: `${stopMessage}\n`,
    })
  })

  it('contains no executable, credential, network, or filesystem writer capability', () => {
    const source = readFileSync(dryRunScript, 'utf8')

    expect(source).toMatch(/^import process from 'node:process'\n/mu)

    for (const forbidden of [
      /node:child_process/u,
      /node:(?:http|https|net|tls|dns|dgram)/u,
      /node:fs/u,
      /process\.env/u,
      /process\.argv/u,
      /CLOUDFLARE/u,
      /\b(?:git|pnpm|wrangler)\b/iu,
      /\bfetch\s*\(/u,
    ]) {
      expect(source).not.toMatch(forbidden)
    }
  })

  it('keeps the public package alias on the same shell-builtin STOP', () => {
    const packageJson = JSON.parse(
      readFileSync(`${repoRoot}/package.json`, 'utf8'),
    ) as { scripts?: Record<string, string> }

    expect(packageJson.scripts?.['staging:dry-run']).toBe(packageStop)
    expect(packageJson.scripts?.['prestaging:dry-run']).toBeUndefined()
    expect(packageJson.scripts?.['poststaging:dry-run']).toBeUndefined()
  })
})

async function runBlocked(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    await execFileAsync(process.execPath, [dryRunScript, ...args], {
      cwd: repoRoot,
      env: { PATH: '/nonexistent' },
    })
  } catch (error) {
    const failure = error as Error & {
      code?: number
      stdout?: string
      stderr?: string
    }
    return {
      code: failure.code ?? -1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    }
  }
  throw new Error('Staging dry-run entrypoint unexpectedly succeeded.')
}

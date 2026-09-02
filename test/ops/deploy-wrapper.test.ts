import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const deployScript = fileURLToPath(
  new URL('../../scripts/honowarden-deploy.mjs', import.meta.url).toString(),
)

const stopMessage =
  'REAL WORKER/VERSION/TRAFFIC WRITE STOP: deploy, dry-run, and automated recovery are disabled pending a separately reviewed execution boundary.'
const packageStop =
  "deploy_stop() { printf '%s\\n' 'REAL WORKER/VERSION/TRAFFIC WRITE STOP: deploy, dry-run, and automated recovery are disabled pending a separately reviewed execution boundary.' >&2; return 1; }; deploy_stop"

describe('HonoWarden deploy entrypoint', () => {
  it.each([
    { args: [] },
    { args: ['--env', 'staging', '--dry-run'] },
    { args: ['--env', 'staging'] },
    { args: ['--env', 'production', '--dry-run'] },
    { args: ['--env', 'production'] },
    { args: ['--recover', 'deployment-id'] },
    { args: ['--unknown'] },
  ])(
    'statically blocks invocation $args without exposing ambient input',
    async ({ args }) => {
      const result = await runBlocked(args)

      expect(result.code).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe(`${stopMessage}\n`)
      expect(result.stderr).not.toContain('credential-marker-must-stay-private')
    },
  )

  it('contains no credential, Git, child-process, Wrangler, or network execution path', () => {
    const source = readFileSync(deployScript, 'utf8')

    expect(source).toMatch(/^import process from 'node:process'\n/mu)

    for (const forbidden of [
      /node:child_process/u,
      /process\.env/u,
      /process\.argv/u,
      /CLOUDFLARE/u,
      /\b(?:git|pnpm|wrangler)\b/iu,
      /versions\s+(?:upload|deploy)/iu,
      /\bfetch\s*\(/u,
    ]) {
      expect(source).not.toMatch(forbidden)
    }
  })

  it('routes the package deploy alias only to the static blocker', () => {
    const packageJson = JSON.parse(
      readFileSync(`${repoRoot}/package.json`, 'utf8'),
    ) as { scripts?: Record<string, string> }

    expect(packageJson.scripts?.deploy).toBe(packageStop)
    expect(packageJson.scripts?.['staging:dry-run']).toBe(packageStop)
    expect(packageJson.scripts?.predeploy).toBeUndefined()
    expect(packageJson.scripts?.postdeploy).toBeUndefined()
  })

  it('executes the package shell blocker with no executable search path', async () => {
    const result = await runCommandBlocked(
      '/bin/sh',
      ['-c', packageStop, '--', '--env', 'production'],
      {
        PATH: '/nonexistent',
        CLOUDFLARE_API_TOKEN: 'credential-marker-must-stay-private',
      },
    )

    expect(result).toEqual({
      code: 1,
      stdout: '',
      stderr: `${stopMessage}\n`,
    })
  })
})

async function runBlocked(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    await execFileAsync(process.execPath, [deployScript, ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CLOUDFLARE_API_TOKEN: 'credential-marker-must-stay-private',
      },
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
  throw new Error('Deploy entrypoint unexpectedly succeeded.')
}

async function runCommandBlocked(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    await execFileAsync(executable, args, { cwd: repoRoot, env })
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
  throw new Error('Package deploy blocker unexpectedly succeeded.')
}

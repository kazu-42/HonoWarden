import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  forwardedArgumentStop,
  runLocalDev,
} from '../../scripts/honowarden-dev.mjs'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const scriptPath = fileURLToPath(
  new URL('../../scripts/honowarden-dev.mjs', import.meta.url).toString(),
)

describe('local-only dev wrapper', () => {
  it('is the only package dev entrypoint and has no lifecycle-hook bypass', () => {
    const packageJson = JSON.parse(
      readFileSync(`${repoRoot}/package.json`, 'utf8'),
    ) as { scripts?: Record<string, string> }

    expect(packageJson.scripts?.dev).toBe('node scripts/honowarden-dev.mjs')
    expect(packageJson.scripts?.predev).toBeUndefined()
    expect(packageJson.scripts?.postdev).toBeUndefined()
  })

  it.each([
    ['-r'],
    ['-r=true'],
    ['-e', 'staging'],
    ['-eproduction'],
    ['--env', 'staging'],
    ['--env=production'],
    ['--remote'],
    ['--remote=true'],
    ['--no-local'],
    ['--tunnel'],
    ['--tunnel=true'],
    ['--ip=0.0.0.0'],
    ['--experimental-provision'],
    ['--experimental-auto-create'],
    ['--config', 'wrangler.production.jsonc'],
    ['--config=wrangler.production.jsonc'],
    ['--cwd', '/tmp'],
    ['--'],
    ['--', '--remote'],
  ])(
    'rejects forwarded argv before reading env or starting a child: %j',
    async (...argv) => {
      let envReads = 0
      let commandCalls = 0
      const options = {
        runCommand: async () => {
          commandCalls += 1
          return 0
        },
      }
      Object.defineProperty(options, 'env', {
        get() {
          envReads += 1
          return { CLOUDFLARE_API_TOKEN: 'must-not-read' }
        },
      })

      await expect(runLocalDev(argv, options)).rejects.toThrow(
        forwardedArgumentStop,
      )
      expect(envReads).toBe(0)
      expect(commandCalls).toBe(0)
    },
  )

  it('starts only the pinned local Wrangler entry with fixed argv and no Cloudflare credentials', async () => {
    const calls: Array<{
      executable: string
      args: string[]
      options: { cwd: string; env: NodeJS.ProcessEnv; shell: false }
    }> = []

    await runLocalDev([], {
      env: {
        PATH: '/safe/bin',
        SAFE_LOCAL_VALUE: 'preserved',
        CLOUDFLARE_API_TOKEN: 'drop-me',
        CLOUDFLARE_HONOWARDEN_DEPLOY_TOKEN: 'drop-me',
        CF_API_TOKEN: 'drop-me',
        WRANGLER_API_TOKEN: 'drop-me',
        R2_ACCESS_KEY_ID: 'drop-me',
        R2_SECRET_ACCESS_KEY: 'drop-me',
      },
      runCommand: async (executable, args, options) => {
        calls.push({ executable, args, options })
        return 0
      },
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.executable).toBe(process.execPath)
    expect(calls[0]?.args[0]).toBe(
      resolve(repoRoot, 'node_modules/wrangler/bin/wrangler.js'),
    )
    expect(calls[0]?.args.slice(1)).toEqual([
      'dev',
      '--local',
      '--config',
      resolve(repoRoot, 'wrangler.jsonc'),
      '--ip',
      '127.0.0.1',
      '--no-tunnel',
      '--no-experimental-provision',
      '--no-experimental-auto-create',
    ])
    expect(calls[0]?.options).toMatchObject({ cwd: repoRoot, shell: false })
    expect(calls[0]?.options.env).toMatchObject({
      PATH: '/safe/bin',
      SAFE_LOCAL_VALUE: 'preserved',
      WRANGLER_SEND_METRICS: 'false',
      WRANGLER_SEND_ERROR_REPORTS: 'false',
      CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    })
    for (const key of [
      'CLOUDFLARE_API_TOKEN',
      'CLOUDFLARE_HONOWARDEN_DEPLOY_TOKEN',
      'CF_API_TOKEN',
      'WRANGLER_API_TOKEN',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
    ]) {
      expect(calls[0]?.options.env).not.toHaveProperty(key)
    }
  })

  it('keeps CLI rejection output fixed and secret-safe', async () => {
    const secret = 'ambient-cloudflare-secret-marker'

    await expect(
      execFileAsync(process.execPath, [scriptPath, '--remote=production'], {
        cwd: repoRoot,
        env: { ...process.env, CLOUDFLARE_API_TOKEN: secret },
      }),
    ).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: `${forwardedArgumentStop}\n`,
    })
  })
})

#!/usr/bin/env node

import { error as logError } from 'node:console'
import { resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'

export const forwardedArgumentStop =
  'LOCAL DEV ARGUMENT STOP: forwarded arguments are disabled; this entrypoint is fixed to the local HonoWarden configuration.'
const localDevFailure =
  'LOCAL DEV FAILED: the fixed local Wrangler process did not complete successfully.'

export async function runLocalDev(argv, options = {}) {
  if (!Array.isArray(argv) || argv.length !== 0) {
    throw new Error(forwardedArgumentStop)
  }

  const repoRoot = fileURLToPath(new URL('..', import.meta.url))
  const wranglerPath = resolve(
    repoRoot,
    'node_modules/wrangler/bin/wrangler.js',
  )
  const configPath = resolve(repoRoot, 'wrangler.jsonc')
  const env = sanitizeLocalDevEnvironment(options.env ?? process.env)
  const runCommand = options.runCommand ?? runChildCommand
  const exitCode = await runCommand(
    process.execPath,
    [
      wranglerPath,
      'dev',
      '--local',
      '--config',
      configPath,
      '--ip',
      '127.0.0.1',
      '--no-tunnel',
      '--no-experimental-provision',
      '--no-experimental-auto-create',
    ],
    {
      cwd: repoRoot,
      env,
      shell: false,
    },
  )
  if (exitCode !== 0) throw new Error(localDevFailure)
}

function sanitizeLocalDevEnvironment(source) {
  const env = { ...source }
  for (const key of Object.keys(env)) {
    if (
      key.startsWith('CLOUDFLARE_') ||
      key.startsWith('CF_') ||
      key === 'R2_ACCESS_KEY_ID' ||
      key === 'R2_SECRET_ACCESS_KEY' ||
      /^WRANGLER_(?:API|AUTH|OAUTH|ACCOUNT|PROFILE)/u.test(key)
    ) {
      delete env[key]
    }
  }
  env.WRANGLER_SEND_METRICS = 'false'
  env.WRANGLER_SEND_ERROR_REPORTS = 'false'
  env.CLOUDFLARE_INCLUDE_PROCESS_ENV = 'false'
  env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false'
  return env
}

async function runChildCommand(executable, args, options) {
  const { spawn } = await import('node:child_process')
  return new Promise((resolveExit) => {
    const child = spawn(executable, args, {
      ...options,
      stdio: 'inherit',
    })
    child.once('error', () => resolveExit(1))
    child.once('exit', (code) => resolveExit(code ?? 1))
  })
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runLocalDev(process.argv.slice(2)).catch((error) => {
    const message =
      error instanceof Error &&
      (error.message === forwardedArgumentStop ||
        error.message === localDevFailure)
        ? error.message
        : localDevFailure
    logError(message)
    process.exitCode = 1
  })
}

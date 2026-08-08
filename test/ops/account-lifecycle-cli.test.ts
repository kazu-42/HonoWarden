import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const lifecycleScript = join(
  repoRoot,
  'scripts/honowarden-account-lifecycle.mjs',
)

type LifecyclePacket = {
  schemaVersion: number
  action: 'plan'
  operation: 'status' | 'recover' | 'prepare-purge' | 'purge'
  executed: boolean
  mode: 'local' | 'remote'
  target: {
    userId: string
    lifecycleGeneration: string
    targetHash: string
  }
  commands: string[][]
  operatorRpc: {
    entrypoint: string
    method: string
    input: Record<string, string>
    publiclyAccessible: boolean
    executionIncluded: boolean
  }
}

describe('account lifecycle operator CLI', () => {
  it('plans redacted remote purge readback and a private named-entrypoint RPC', async () => {
    const result = await execFileAsync('node', [
      lifecycleScript,
      '--',
      'plan',
      '--operation',
      'purge',
      '--user-id',
      'user-123',
      '--generation',
      'generation-456',
      '--database',
      'honowarden-prod',
      '--mode',
      'remote',
      '--env',
      'production',
      '--reason',
      'approved-owner-request',
      '--request-id',
      'HON-164-purge',
      '--at',
      '2026-08-09T00:00:00.000Z',
    ])
    const packet = JSON.parse(result.stdout) as LifecyclePacket

    expect(packet).toMatchObject({
      schemaVersion: 2,
      action: 'plan',
      operation: 'purge',
      executed: false,
      mode: 'remote',
      target: {
        userId: 'user-123',
        lifecycleGeneration: 'generation-456',
      },
      operatorRpc: {
        entrypoint: 'AccountLifecycleOperator',
        method: 'purge',
        input: {
          userId: 'user-123',
          lifecycleGeneration: 'generation-456',
          confirmedLifecycleGeneration: 'generation-456',
          requestId: 'HON-164-purge',
          reason: 'approved-owner-request',
        },
        publiclyAccessible: false,
        executionIncluded: false,
      },
    })
    expect(packet.target.targetHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(packet.commands).toHaveLength(1)
    expect(packet.commands[0]?.slice(0, 6)).toEqual([
      'wrangler',
      'd1',
      'execute',
      'honowarden-prod',
      '--remote',
      '--command',
    ])
    expect(packet.commands[0]).toContain('--json')
    expect(packet.commands[0]).toContain('--env')
    const output = result.stdout
    expect(output).not.toContain('DELETE FROM users')
    expect(output).not.toContain('UPDATE users SET disabled_at')
    expect(output).not.toContain('object_key')
    expect(output).not.toContain('master_password_hash')
    expect(output).not.toContain('encrypted_json')
  })

  it('retires direct disable and enable because they bypass recovery invariants', async () => {
    for (const action of ['disable', 'enable']) {
      await expect(
        execFileAsync('node', [lifecycleScript, action]),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining(
          'Direct disable/enable was removed because it bypasses the recoverable account lifecycle.',
        ),
      })
    }
  })

  it('refuses mutation execution from the read-only CLI', async () => {
    await expect(
      execFileAsync('node', [
        lifecycleScript,
        'plan',
        '--operation',
        'recover',
        '--user-id',
        'user-123',
        '--generation',
        'generation-456',
        '--database',
        'honowarden',
        '--reason',
        'approved-recovery',
        '--request-id',
        'HON-164-recover',
        '--execute',
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'mutation RPC must run from a separately approved operator Worker binding',
      ),
    })
  })

  it('rejects operator values that exceed or bypass the private RPC boundary', async () => {
    const baseArgs = [
      lifecycleScript,
      'plan',
      '--user-id',
      'user-123',
      '--generation',
      'generation-456',
      '--database',
      'honowarden',
      '--reason',
      'approved-recovery',
      '--request-id',
      'HON-164-recover',
    ]
    await expect(
      execFileAsync('node', [...baseArgs, '--reason', `approved\nrecovery`]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('--reason is invalid'),
    })
    await expect(
      execFileAsync('node', [...baseArgs, '--generation', 'g'.repeat(129)]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('--generation is invalid'),
    })
  })

  it('documents the dry-run boundary, private RPC, and package script', () => {
    const packageJson = readRepoFile('package.json')
    const runbook = readRepoFile('docs/operations/account-lifecycle.md')
    const knownLimitations = readRepoFile('docs/security/known-limitations.md')

    expect(packageJson).toContain('"account:lifecycle"')
    expect(runbook).toContain('dry-run by default')
    expect(runbook).toContain('AccountLifecycleOperator')
    expect(runbook).toContain('named WorkerEntrypoint')
    expect(runbook).toContain('password grant, refresh grant, sync, and vault')
    expect(runbook).toContain('does not print vault payloads')
    expect(knownLimitations).toContain('account lifecycle operator CLI')
  })
})

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}

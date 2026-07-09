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
  action: 'disable' | 'enable'
  executed: boolean
  mode: 'local' | 'remote'
  database: string
  selector: {
    type: 'email' | 'user_id'
    value: string
    normalizedValue: string
    sqlWhere: string
  }
  audit: {
    event: string
    reason: string
    targetHash: string
    containsVaultData: boolean
  }
  commands: string[][]
  rollbackCommand: string[]
}

describe('account lifecycle operator CLI', () => {
  it('plans a remote account disable with readback and no vault-data output', async () => {
    const result = await execFileAsync('node', [
      lifecycleScript,
      '--',
      'disable',
      '--email',
      'Owner+Prod@example.test',
      '--database',
      'honowarden-prod',
      '--mode',
      'remote',
      '--env',
      'production',
      '--reason',
      'owner-request-2026-07-09',
      '--at',
      '2026-07-09T10:30:00.000Z',
    ])
    const packet = JSON.parse(result.stdout) as LifecyclePacket

    expect(packet).toMatchObject({
      schemaVersion: 1,
      action: 'disable',
      executed: false,
      mode: 'remote',
      database: 'honowarden-prod',
      selector: {
        type: 'email',
        normalizedValue: 'owner+prod@example.test',
        sqlWhere: "email_normalized = 'owner+prod@example.test'",
      },
      audit: {
        event: 'account.disable.plan',
        reason: 'owner-request-2026-07-09',
        containsVaultData: false,
      },
    })
    expect(packet.audit.targetHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(packet.commands).toHaveLength(3)
    expect(packet.commands[0]).toEqual([
      'wrangler',
      'd1',
      'execute',
      'honowarden-prod',
      '--remote',
      '--command',
      "SELECT COUNT(*) AS matched_users, SUM(CASE WHEN disabled_at IS NULL THEN 1 ELSE 0 END) AS active_users, SUM(CASE WHEN disabled_at IS NOT NULL THEN 1 ELSE 0 END) AS disabled_users FROM users WHERE email_normalized = 'owner+prod@example.test';",
      '--json',
      '--env',
      'production',
    ])
    expect(packet.commands[1]).toEqual([
      'wrangler',
      'd1',
      'execute',
      'honowarden-prod',
      '--remote',
      '--command',
      "UPDATE users SET disabled_at = '2026-07-09T10:30:00.000Z', updated_at = '2026-07-09T10:30:00.000Z', revision_date = '2026-07-09T10:30:00.000Z' WHERE email_normalized = 'owner+prod@example.test' AND disabled_at IS NULL;",
      '--yes',
      '--env',
      'production',
    ])
    expect(packet.commands[2]).toEqual(packet.commands[0])
    expect(packet.rollbackCommand).toContain(
      "UPDATE users SET disabled_at = NULL, updated_at = '2026-07-09T10:30:00.000Z', revision_date = '2026-07-09T10:30:00.000Z' WHERE email_normalized = 'owner+prod@example.test' AND disabled_at IS NOT NULL;",
    )
    expect(result.stdout).not.toContain('master_password_hash')
    expect(result.stdout).not.toContain('encrypted_json')
    expect(result.stdout).not.toContain('private_key')
  })

  it('requires exact target confirmation before execution', async () => {
    await expect(
      execFileAsync('node', [
        lifecycleScript,
        'disable',
        '--email',
        'owner@example.test',
        '--database',
        'honowarden-prod',
        '--mode',
        'remote',
        '--reason',
        'owner-request',
        '--execute',
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        '--confirm owner@example.test is required before disable --execute',
      ),
    })
  })

  it('plans local account enable by user id with local persistence flags', async () => {
    const result = await execFileAsync('node', [
      lifecycleScript,
      'enable',
      '--user-id',
      'user-123',
      '--database',
      'honowarden',
      '--mode',
      'local',
      '--persist-to',
      'test/.tmp/d1',
      '--reason',
      'restore-access',
      '--at',
      '2026-07-09T10:45:00.000Z',
    ])
    const packet = JSON.parse(result.stdout) as LifecyclePacket

    expect(packet).toMatchObject({
      action: 'enable',
      executed: false,
      selector: {
        type: 'user_id',
        normalizedValue: 'user-123',
        sqlWhere: "id = 'user-123'",
      },
      audit: {
        event: 'account.enable.plan',
        reason: 'restore-access',
        containsVaultData: false,
      },
    })
    expect(packet.commands[1]).toEqual([
      'wrangler',
      'd1',
      'execute',
      'honowarden',
      '--local',
      '--command',
      "UPDATE users SET disabled_at = NULL, updated_at = '2026-07-09T10:45:00.000Z', revision_date = '2026-07-09T10:45:00.000Z' WHERE id = 'user-123' AND disabled_at IS NOT NULL;",
      '--yes',
      '--persist-to',
      'test/.tmp/d1',
    ])
  })

  it('documents the operator runbook and package script', () => {
    const packageJson = readRepoFile('package.json')
    const runbook = readRepoFile('docs/operations/account-lifecycle.md')
    const knownLimitations = readRepoFile('docs/security/known-limitations.md')

    expect(packageJson).toContain('"account:lifecycle"')
    expect(runbook).toContain('dry-run by default')
    expect(runbook).toContain('--confirm <target>')
    expect(runbook).toContain('password grant, refresh grant, sync, and vault')
    expect(runbook).toContain('does not print vault payloads')
    expect(knownLimitations).toContain('account disable/enable operator CLI')
  })
})

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}

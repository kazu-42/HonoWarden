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
  'scripts/honowarden-account-key-lifecycle.mjs',
)

type LifecycleReport = {
  schemaVersion: number
  status: 'passed' | 'failed'
  mode: string
  upstreamPins: {
    server: string
    client: string
  }
  routes: {
    loginBeforeInitialization: number
    missingRead: number
    initialize: number
    readAfterInitialization: number
    exactReplay: number
    differentReplacement: number
    existingAccessSync: number
    refreshAfterInitialization: number
    concurrentInitialization: number[]
    auditFailureInitialization: number
    userFailureInitialization: number
    readAfterRestart: number
    profileAfterRestart: number
    syncAfterRestart: number
    refreshAfterRestart: number
    disabledRead: number
    disabledWrite: number
  }
  readback: {
    revisionDate: string
    initializationAuditCount: number
    concurrentAuditCount: number
    rollbackAuditCount: number
    activeDeviceCount: number
    activeRefreshTokenCount: number
  }
  checks: Array<{ id: string; status: 'pass' | 'fail' }>
  limitations: string[]
}

describe('account-key local D1 lifecycle', () => {
  it('keeps compatibility, security, rollback, and release evidence linked', () => {
    const evidence = readRepoFile(
      'docs/release/account-key-initialization-local-evidence.md',
    )
    const releaseIndex = readRepoFile('docs/release/index.md')
    const compatibility = readRepoFile('docs/compatibility-matrix.md')
    const currentState = readRepoFile('docs/current-state.md')
    const limitations = readRepoFile('docs/security/known-limitations.md')
    const rollback = readRepoFile('docs/release/rollback-guide.md')

    expect(evidence).toContain('Status: passed')
    expect(evidence).toContain('pnpm account:keys:lifecycle')
    expect(evidence).toContain('a09c7edb03ae6d4fdece784f1250c67be73d5fe0')
    expect(evidence).toContain('39f07436ca60e3f25eac47777671754f288a98f1')
    expect(releaseIndex).toContain(
      'account-key-initialization-local-evidence.md',
    )
    expect(compatibility).toContain('`account_keys` fixture')
    expect(currentState).toContain('Week 26 Account Key Initialization')
    expect(currentState).toContain('HONOWARDEN_ACCOUNT_KEYS_ENABLED')
    expect(limitations).toContain('one-time V1 initialization')
    expect(rollback).toContain('Account Key Initialization Rollback')
    expect(rollback).toContain('must not delete or null')
  })

  it('proves one-time initialization, rollback, restart, and flag rollback', async () => {
    const result = await execFileAsync('node', [lifecycleScript], {
      cwd: repoRoot,
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
    })
    const report = JSON.parse(result.stdout) as LifecycleReport

    expect(report).toMatchObject({
      schemaVersion: 1,
      status: 'passed',
      mode: 'wrangler-local-d1-synthetic',
      upstreamPins: {
        server: 'v2026.6.1@a09c7edb03ae6d4fdece784f1250c67be73d5fe0',
        client: 'web-v2026.6.1@39f07436ca60e3f25eac47777671754f288a98f1',
      },
      routes: {
        loginBeforeInitialization: 200,
        missingRead: 409,
        initialize: 200,
        readAfterInitialization: 200,
        exactReplay: 200,
        differentReplacement: 409,
        existingAccessSync: 200,
        refreshAfterInitialization: 200,
        concurrentInitialization: [200, 200],
        auditFailureInitialization: 503,
        userFailureInitialization: 503,
        readAfterRestart: 200,
        profileAfterRestart: 200,
        syncAfterRestart: 200,
        refreshAfterRestart: 200,
        disabledRead: 501,
        disabledWrite: 501,
      },
      readback: {
        revisionDate: expect.any(String),
        initializationAuditCount: 1,
        concurrentAuditCount: 1,
        rollbackAuditCount: 0,
        activeDeviceCount: 1,
        activeRefreshTokenCount: 1,
      },
    })
    expect(Date.parse(report.readback.revisionDate)).toBeGreaterThan(
      Date.parse('2026-07-19T00:00:00.000Z'),
    )
    expect(report.checks).not.toContainEqual(
      expect.objectContaining({ status: 'fail' }),
    )
    for (const id of [
      'official_v1_envelope_projected',
      'exact_replay_is_noop',
      'different_replacement_rejected',
      'security_stamp_and_sessions_preserved',
      'one_audit_per_initialized_account',
      'audit_failure_rolls_back_keypair',
      'restart_preserves_read_and_session_paths',
      'disabled_flag_is_state_free',
    ]) {
      expect(report.checks).toContainEqual({ id, status: 'pass' })
    }
    expect(report.limitations).toContain(
      'No remote Cloudflare resource, production deployment, real user, or official client UI was used.',
    )
    expect(result.stdout).not.toContain('synthetic-hon205-public-key')
    expect(result.stdout).not.toContain(
      '2.synthetic-hon205-wrapped-private-key',
    )
    expect(result.stdout).not.toContain('synthetic-hon205-authentication-hash')
    expect(result.stdout).not.toContain('synthetic-hon205-')
  }, 120_000)
})

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}

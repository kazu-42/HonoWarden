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
  'scripts/honowarden-user-key-rotation-lifecycle.mjs',
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
    primaryOldLoginBefore: number
    primarySyncBefore: number
    primaryAttachmentBefore: number
    primaryRotation: number
    primaryOldAccessAfter: number
    primaryOldRefreshAfter: number
    primaryOldPasswordAfter: number
    rollbackOldLoginBefore: number
    rollbackRotation: number
    rollbackAccessAfterAbort: number
    concurrentOldLoginBefore: number
    concurrentRotation: number[]
    primaryOldAccessAfterRestart: number
    primaryNewLoginAfterRestart: number
    profileAfterRestart: number
    syncAfterRestart: number
    backupAfterRestart: number
    attachmentAfterRestart: number
    disabledPost: number
  }
  readback: {
    primaryRotationAuditCount: number
    rollbackRotationAuditCount: number
    concurrentRotationAuditCount: number
    primarySupersededAuthRequestCount: number
    activePrimaryDeviceCount: number
    activePrimaryRefreshTokenCount: number
    r2SentinelSha256: string
  }
  checks: Array<{ id: string; status: 'pass' | 'fail' }>
  limitations: string[]
}

describe('user-key rotation local D1/R2 lifecycle', () => {
  it('keeps release, security, activation, and forward-recovery evidence linked', () => {
    const evidence = readRepoFile(
      'docs/release/user-key-rotation-local-evidence.md',
    )
    const releaseIndex = readRepoFile('docs/release/index.md')
    const reviewIndex = readRepoFile('docs/security/review-index.md')
    const currentState = readRepoFile('docs/current-state.md')
    const operatorDocs = readRepoFile('docs/operations/operator-environment.md')
    const rollback = readRepoFile('docs/release/rollback-guide.md')

    expect(evidence).toContain('Status: passed')
    expect(evidence).toContain('pnpm account:key-rotation:lifecycle')
    expect(evidence).toContain('a09c7edb03ae6d4fdece784f1250c67be73d5fe0')
    expect(evidence).toContain('39f07436ca60e3f25eac47777671754f288a98f1')
    expect(evidence).not.toContain('39f07436ca60e3f25eac47777671754f288a98f1f')
    expect(evidence).toContain('R2 sentinel')
    expect(releaseIndex).toContain('user-key-rotation-local-evidence.md')
    expect(reviewIndex).toContain('pnpm account:key-rotation:lifecycle')
    expect(currentState).toContain('Week 26 Atomic User-Key Rotation')
    expect(operatorDocs).toContain('HONOWARDEN_USER_KEY_ROTATION_ENABLED')
    expect(rollback).toContain('Never restore an old password hash')
  })

  it('proves populated rotation, rollback, concurrency, restart, and R2 identity', async () => {
    const result = await execFileAsync('node', [lifecycleScript], {
      cwd: repoRoot,
      timeout: 180_000,
      maxBuffer: 2 * 1024 * 1024,
    })
    const report = JSON.parse(result.stdout) as LifecycleReport

    expect(report).toMatchObject({
      schemaVersion: 1,
      status: 'passed',
      mode: 'wrangler-local-d1-r2-synthetic',
      upstreamPins: {
        server: 'v2026.6.1@a09c7edb03ae6d4fdece784f1250c67be73d5fe0',
        client: 'web-v2026.6.1@39f07436ca60e3f25eac47777671754f288a98f1',
      },
      routes: {
        primaryOldLoginBefore: 200,
        primarySyncBefore: 200,
        primaryAttachmentBefore: 200,
        primaryRotation: 200,
        primaryOldAccessAfter: 401,
        primaryOldRefreshAfter: 400,
        primaryOldPasswordAfter: 400,
        rollbackOldLoginBefore: 200,
        rollbackRotation: 503,
        rollbackAccessAfterAbort: 200,
        concurrentOldLoginBefore: 200,
        primaryOldAccessAfterRestart: 401,
        primaryNewLoginAfterRestart: 200,
        profileAfterRestart: 200,
        syncAfterRestart: 200,
        backupAfterRestart: 200,
        attachmentAfterRestart: 200,
        disabledPost: 501,
      },
      readback: {
        primaryRotationAuditCount: 1,
        rollbackRotationAuditCount: 0,
        concurrentRotationAuditCount: 1,
        primarySupersededAuthRequestCount: 2,
        activePrimaryDeviceCount: 1,
        activePrimaryRefreshTokenCount: 1,
        r2SentinelSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    })
    expect(report.routes.concurrentRotation).toHaveLength(2)
    expect(report.routes.concurrentRotation).toContain(200)
    expect(
      report.routes.concurrentRotation.filter((status) => status === 200),
    ).toHaveLength(1)
    expect(
      report.routes.concurrentRotation.every((status) =>
        [200, 401, 409].includes(status),
      ),
    ).toBe(true)
    expect(report.checks).not.toContainEqual(
      expect.objectContaining({ status: 'fail' }),
    )
    for (const id of [
      'primary_populated_generation_committed',
      'old_access_refresh_password_rejected',
      'new_profile_sync_backup_consistent_after_restart',
      'required_audit_abort_rolls_back_every_mutation',
      'concurrent_requests_commit_exactly_one_generation',
      'r2_object_identity_and_bytes_unchanged',
      'disabled_route_is_state_free',
    ]) {
      expect(report.checks).toContainEqual({ id, status: 'pass' })
    }
    expect(report.limitations).toContain(
      'No remote Cloudflare resource, production deployment, real user, or official client UI was used.',
    )
    expect(result.stdout).not.toContain('synthetic-hon206-')
  }, 180_000)
})

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}

import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const reportScript = join(repoRoot, 'scripts/honowarden-abuse-report.mjs')

describe('abuse report CLI', () => {
  it('plans secret-safe request quota and auth-defense metric queries', async () => {
    const result = await execFileAsync('node', [
      reportScript,
      '--database',
      'honowarden',
      '--mode',
      'local',
    ])
    const output = JSON.parse(result.stdout) as {
      action: string
      executed: boolean
      commands: string[][]
      evidence: {
        plaintextClientAddresses: string
        bucketIdentifier: string
        operatorIdentities: string
        vaultPayloads: string
      }
      retention: {
        authDefenseCleanupWindowSeconds: number
        auditEventRetentionDays: number
        requestQuotaCleanupRetentionSeconds: number
        rowsPerCleanupSlice: number
      }
      queries: Array<{ id: string; sql: string }>
      alerts: Array<{
        id: string
        metric: string
        levels: {
          warn: number
          critical: number
        }
        firstResponse: string[]
      }>
    }

    expect(output).toMatchObject({
      action: 'abuse-report',
      executed: false,
      evidence: {
        plaintextClientAddresses: 'excluded',
        bucketIdentifier: 'hashed_prefix_only',
        operatorIdentities: 'excluded',
        vaultPayloads: 'excluded',
      },
      retention: {
        authDefenseCleanupWindowSeconds: 900,
        auditEventRetentionDays: 365,
        requestQuotaCleanupRetentionSeconds: 3600,
        rowsPerCleanupSlice: 100,
      },
    })
    expect(output.commands[0]).toEqual([
      'wrangler',
      'd1',
      'execute',
      'honowarden',
      '--local',
      '--command',
      expect.stringContaining('request_quota_buckets'),
    ])
    expect(output.queries.map((query) => query.id)).toEqual([
      'request_quota_summary',
      'request_quota_top_buckets',
      'auth_failure_summary',
      'auth_failure_top_buckets',
      'auth_attempt_cleanup_candidates',
      'auth_failure_cleanup_candidates',
      'totp_challenge_cleanup_candidates',
      'audit_event_cleanup_candidates',
      'request_quota_cleanup_candidates',
    ])
    expect(
      output.queries.find(
        (query) => query.id === 'auth_attempt_cleanup_candidates',
      )?.sql,
    ).toContain('auth_attempts')
    expect(
      output.queries.find(
        (query) => query.id === 'request_quota_cleanup_candidates',
      )?.sql,
    ).toContain('blocked_until')
    expect(output.alerts.map((alert) => alert.id)).toEqual([
      'request_quota_active_blocked_buckets',
      'auth_failure_active_locked_buckets',
      'cleanup_candidate_rows',
      'scheduled_cleanup_failure',
    ])
    expect(output.alerts).toContainEqual(
      expect.objectContaining({
        id: 'cleanup_candidate_rows',
        metric: 'cleanup candidate query row counts',
        levels: {
          warn: 1000,
          critical: 5000,
        },
        firstResponse: expect.arrayContaining([
          'Run pnpm abuse:report against the affected environment and keep only aggregate counts, hashed bucket tags, and timestamps in the incident record.',
        ]),
      }),
    )
    const serialized = JSON.stringify(output)
    expect(serialized).not.toContain('203.0.113.10')
    expect(serialized).not.toContain('ip_address')
    expect(serialized).not.toContain('client_ip')
    expect(serialized).not.toContain('email')
    expect(serialized).not.toContain('Authorization')
    expect(serialized).not.toContain('encrypted_json')
  })
})

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const releaseGateScript = join(repoRoot, 'scripts/honowarden-release-gate.mjs')

type ReleaseGateReport = {
  schemaVersion: number
  target: string
  overall: 'ready' | 'not_ready'
  summary: {
    pass: number
    block: number
  }
  checks: Array<{
    id: string
    status: 'pass' | 'block'
    details?: Record<string, unknown>
  }>
}

describe('release gate preflight', () => {
  it('reports current alpha blockers without mutating external systems', async () => {
    const result = await execFileAsync('node', [releaseGateScript])
    const report = JSON.parse(result.stdout) as ReleaseGateReport

    expect(report.schemaVersion).toBe(1)
    expect(report.target).toBe('v0.1.0-alpha')
    expect(report.overall).toBe('not_ready')
    expect(report.summary.pass).toBeGreaterThan(0)
    expect(report.summary.block).toBeGreaterThan(0)

    expect(statusById(report, 'release_docs_present')).toBe('pass')
    expect(statusById(report, 'migration_freeze_hashes')).toBe('pass')
    expect(statusById(report, 'dependency_audit_evidence')).toBe('pass')
    expect(statusById(report, 'workflow_evidence')).toBe('pass')
    expect(statusById(report, 'linear_tracking_seed')).toBe('pass')
    expect(statusById(report, 'live_client_evidence')).toBe('block')
    expect(statusById(report, 'backup_restore_drill_evidence')).toBe('block')
    expect(statusById(report, 'staging_deploy_evidence')).toBe('block')
    expect(statusById(report, 'cloudflare_resource_evidence')).toBe('block')
  })

  it('fails in strict mode while release blockers remain', async () => {
    await expect(
      execFileAsync('node', [releaseGateScript, '--strict']),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('release gate is not ready'),
    })
  })
})

function statusById(report: ReleaseGateReport, id: string): string | undefined {
  return report.checks.find((check) => check.id === id)?.status
}

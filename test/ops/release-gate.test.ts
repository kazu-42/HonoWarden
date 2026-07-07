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
    evidence?: string[]
    details?: Record<string, unknown>
  }>
}

describe('release gate preflight', () => {
  it('reports current alpha readiness without mutating external systems', async () => {
    const result = await execFileAsync('node', [releaseGateScript])
    const report = JSON.parse(result.stdout) as ReleaseGateReport

    expect(report.schemaVersion).toBe(1)
    expect(report.target).toBe('v0.1.0-alpha')
    expect(report.overall).toBe('ready')
    expect(report.summary.pass).toBeGreaterThan(0)
    expect(report.summary.block).toBe(0)

    expect(statusById(report, 'release_docs_present')).toBe('pass')
    expect(statusById(report, 'package_version')).toBe('pass')
    expect(statusById(report, 'migration_freeze_hashes')).toBe('pass')
    expect(statusById(report, 'dependency_audit_evidence')).toBe('pass')
    expect(statusById(report, 'workflow_evidence')).toBe('pass')
    expect(statusById(report, 'linear_tracking_seed')).toBe('pass')
    expect(statusById(report, 'backup_restore_drill_evidence')).toBe('pass')
    expect(statusById(report, 'staging_deploy_evidence')).toBe('pass')
    expect(statusById(report, 'cloudflare_resource_evidence')).toBe('pass')
    expect(statusById(report, 'live_client_evidence')).toBe('pass')

    const workflowEvidence = checkById(report, 'workflow_evidence')?.evidence
    expect(workflowEvidence).toContain(
      '.workflow/week-26-alpha-version-alignment/state.json',
    )
    expect(workflowEvidence).toContain(
      '.workflow/week-26-device-list-api/state.json',
    )
    expect(workflowEvidence).toContain(
      '.workflow/week-26-known-device-api/state.json',
    )
    expect(workflowEvidence).toContain(
      '.workflow/week-26-alpha-tag-preflight/state.json',
    )
    expect(workflowEvidence).toContain(
      '.workflow/week-26-release-tag-workflow/state.json',
    )
    expect(workflowEvidence).toContain(
      '.workflow/week-26-github-release-plan/state.json',
    )
  })

  it('passes in strict mode when repository-local evidence is ready', async () => {
    await expect(
      execFileAsync('node', [releaseGateScript, '--strict']),
    ).resolves.toMatchObject({
      stderr: '',
    })
  })
})

function statusById(report: ReleaseGateReport, id: string): string | undefined {
  return checkById(report, id)?.status
}

function checkById(
  report: ReleaseGateReport,
  id: string,
): ReleaseGateReport['checks'][number] | undefined {
  return report.checks.find((check) => check.id === id)
}

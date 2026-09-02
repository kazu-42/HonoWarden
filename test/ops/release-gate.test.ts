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
  scope: 'repository_release_evidence'
  evidenceStatus: 'consistent' | 'inconsistent'
  executionStatus: 'not_admitted'
  overall: 'ready' | 'not_ready'
  layers: Record<
    'currentTree' | 'publishedAlphaArchive',
    {
      status: 'consistent' | 'inconsistent'
      summary: { pass: number; block: number }
      checkIds: string[]
    }
  >
  summary: {
    pass: number
    block: number
  }
  checks: Array<{
    id: string
    status: 'pass' | 'block'
    title?: string
    evidence?: string[]
    details?: Record<string, unknown>
  }>
}

describe('release gate preflight', () => {
  it('reports sealed alpha evidence without admitting current execution', async () => {
    const result = await execFileAsync('node', [releaseGateScript])
    const report = JSON.parse(result.stdout) as ReleaseGateReport

    expect(report.schemaVersion).toBe(2)
    expect(report.target).toBe('v0.1.0-alpha')
    expect(report.scope).toBe('repository_release_evidence')
    expect(report.evidenceStatus).toBe('consistent')
    expect(report.executionStatus).toBe('not_admitted')
    expect(report.overall).toBe('ready')
    expect(report.layers.currentTree).toMatchObject({ status: 'consistent' })
    expect(report.layers.currentTree.checkIds).toEqual(
      expect.arrayContaining([
        'release_docs_present',
        'migration_freeze_hashes',
        'dependency_audit_evidence',
        'staging_deploy_evidence',
      ]),
    )
    expect(report.layers.currentTree.checkIds).not.toContain(
      'compatibility_matrix_conservative',
    )
    expect(report.layers.publishedAlphaArchive).toMatchObject({
      status: 'consistent',
      checkIds: ['compatibility_matrix_conservative', 'live_client_evidence'],
    })
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
    expect(checkById(report, 'staging_deploy_evidence')).toMatchObject({
      title: 'Published alpha staging dry-run evidence is sealed',
      details: {
        evidenceKind: 'historical_repository_local_dry_run',
        currentExecutionAuthority: false,
      },
    })
    expect(statusById(report, 'cloudflare_resource_evidence')).toBe('pass')
    expect(statusById(report, 'live_client_evidence')).toBe('pass')
    expect(checkById(report, 'release_docs_present')?.evidence).toContain(
      'docs/release/live-regression-matrix.md',
    )
    expect(checkById(report, 'release_docs_present')?.evidence).toContain(
      'docs/release/two-user-dogfood-evidence.md',
    )
    expect(checkById(report, 'live_client_evidence')?.evidence).toContain(
      'docs/release/snapshots/v0.1.0-alpha/live-client-evidence.md',
    )
    expect(checkById(report, 'live_client_evidence')?.evidence).toContain(
      'compat/releases/v0.1.0-alpha-client-matrix.json',
    )
    expect(
      checkById(report, 'compatibility_matrix_conservative')?.evidence,
    ).toContain('compat/releases/v0.1.0-alpha-client-matrix.json')
    expect(checkById(report, 'live_client_evidence')?.evidence).toContain(
      'compat/releases/v0.1.0-alpha-client-matrix.json',
    )
    expect(
      checkById(report, 'compatibility_matrix_conservative')?.evidence,
    ).not.toContain('compat/client-matrix.json')
    expect(
      checkById(report, 'compatibility_matrix_conservative')?.details,
    ).toMatchObject({
      sourceCommit: 'e7a3c5ea9e51030143736bb0e7a36cb7a8babfce',
      sourceMatrixSha256:
        '8076ec9d4fd9179b9f0616f6f6b5489acacae291058ba95854e4591be56c3491',
      promotedRows: ['cli'],
    })
    expect(checkById(report, 'live_client_evidence')).toMatchObject({
      title: 'Tag-time synthetic CLI evidence is sealed for v0.1.0-alpha',
      evidence: [
        'compat/releases/v0.1.0-alpha-client-matrix.json',
        'docs/release/snapshots/v0.1.0-alpha/live-client-evidence.md',
      ],
    })
    expect(checkById(report, 'live_client_evidence')?.evidence).not.toEqual(
      expect.arrayContaining([
        'compat/client-matrix.json',
        'docs/release/live-client-evidence.md',
        'docs/release/browser-extension-live-client-evidence.md',
        'docs/release/totp-recent-auth-live-evidence.md',
      ]),
    )

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
      '.workflow/week-26-device-metadata-update-api/state.json',
    )
    expect(workflowEvidence).toContain(
      '.workflow/week-26-alpha-tag-preflight/state.json',
    )
    expect(workflowEvidence).toContain(
      '.workflow/week-26-release-tag-workflow/state.json',
    )
    expect(workflowEvidence).toContain(
      '.workflow/week-26-release-tag-recovery/state.json',
    )
    expect(workflowEvidence).toContain(
      '.workflow/week-26-release-evidence-shared-brand-scan/state.json',
    )
    expect(workflowEvidence).toContain(
      '.workflow/week-26-github-release-plan/state.json',
    )
    expect(workflowEvidence).toContain(
      '.workflow/week-26-release-approval-packet/state.json',
    )
    expect(workflowEvidence).toContain(
      '.workflow/week-26-post-tag-release-packet/state.json',
    )
    expect(workflowEvidence).toContain(
      '.workflow/week-26-release-publish-packet/state.json',
    )
    expect(workflowEvidence).toContain(
      '.workflow/week-26-release-published-packet/state.json',
    )
    expect(workflowEvidence).toContain(
      '.workflow/week-26-release-status-packet/state.json',
    )
    expect(workflowEvidence).toContain(
      '.workflow/week-26-post-alpha-ops-readiness-packet/state.json',
    )
    expect(workflowEvidence).toContain(
      '.workflow/week-26-ops-evidence-templates/state.json',
    )
    expect(workflowEvidence).toContain(
      '.workflow/week-26-ops-readiness-release-approval-gate/state.json',
    )
    expect(workflowEvidence).toContain(
      '.workflow/week-26-release-command-repo-scope/state.json',
    )
    expect(workflowEvidence).toContain(
      '.workflow/week-26-publication-gate-runbook/state.json',
    )
    expect(workflowEvidence).toContain(
      '.workflow/week-26-alpha-completion-audit/state.json',
    )
    expect(workflowEvidence).toContain(
      '.workflow/week-26-retention-cleanup-cron-trigger/state.json',
    )
  })

  it('passes in strict mode when historical repository evidence is consistent', async () => {
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

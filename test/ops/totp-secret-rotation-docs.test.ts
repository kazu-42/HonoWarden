import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())

describe('TOTP secret rotation docs and workflow', () => {
  it('documents the operator CLI, env placeholders, and remaining live-drill gap', () => {
    const packageJson = readRepoFile('package.json')
    const envExample = readRepoFile('.env.example')
    const runbook = readRepoFile('docs/operations/totp-secret-rotation.md')
    const operatorDocs = readRepoFile('docs/operations/operator-environment.md')
    const knownLimitations = readRepoFile('docs/security/known-limitations.md')
    const currentState = readRepoFile('docs/current-state.md')

    expect(packageJson).toContain('"totp:rotate-secret"')
    expect(envExample).toMatch(/^HONOWARDEN_TOTP_OLD_SECRET=$/m)
    expect(envExample).toMatch(/^HONOWARDEN_TOTP_NEW_SECRET=$/m)
    expect(operatorDocs).toContain('HONOWARDEN_TOTP_OLD_SECRET')
    expect(operatorDocs).toContain('HONOWARDEN_TOTP_NEW_SECRET')
    expect(runbook).toContain('Dry-run output contains counts')
    expect(runbook).toContain('--confirm honowarden:rewrap')
    expect(runbook).toContain('--confirm honowarden:force-reenrollment')
    expect(runbook).toContain('Do not record')
    expect(knownLimitations).toContain(
      'TOTP wrapping-secret rotation tooling exists',
    )
    expect(currentState).toContain(
      'Week 26 TOTP Wrapping-Secret Rotation Tooling',
    )
    expect(currentState).toContain('live staging or production TOTP')
  })

  it('records workflow evidence for HON-44 without claiming a live rotation', () => {
    const plan = readRepoFile(
      '.workflow/week-26-totp-secret-rotation-tooling/plan.md',
    )
    const state = readRepoFile(
      '.workflow/week-26-totp-secret-rotation-tooling/state.json',
    )
    const report = readRepoFile(
      '.workflow/week-26-totp-secret-rotation-tooling/final-report.md',
    )

    expect(plan).toContain('HON-44')
    expect(plan).toMatch(/without running a live secret\s+rotation/)
    expect(state).toContain('week-26-totp-secret-rotation-tooling')
    expect(state).toContain('Live TOTP secret rotation remains out of scope')
    expect(report).toContain('Status: local verification passed')
    expect(report).toContain('PR, CI, merge, and Linear closeout')
  })
})

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}

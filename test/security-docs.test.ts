import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const securityDocPaths = [
  'threat-model.md',
  'data-flow.md',
  'auth-state-machine.md',
  'secrets-inventory.md',
  'incident-response.md',
  'incident-response-exercise.md',
  'known-limitations.md',
  'dependency-audit.md',
  'review-index.md',
] as const

const securityDocsRoot = fileURLToPath(
  new URL('../docs/security', import.meta.url).toString(),
)

describe('security review materials', () => {
  it('keeps the required alpha security documents present', () => {
    for (const docPath of securityDocPaths) {
      const fullPath = `${securityDocsRoot}/${docPath}`
      expect(existsSync(fullPath), `${docPath} should exist`).toBe(true)
      expect(readFileSync(fullPath, 'utf8').trim().length).toBeGreaterThan(500)
    }
  })

  it('records critical security review sections', () => {
    const threatModel = readSecurityDoc('threat-model.md')
    expect(threatModel).toContain('## Assets')
    expect(threatModel).toContain('## Trust Boundaries')
    expect(threatModel).toContain('## STRIDE Summary')

    const dataFlow = readSecurityDoc('data-flow.md')
    expect(dataFlow).toContain('## Password Grant')
    expect(dataFlow).toContain('## Refresh Grant')
    expect(dataFlow).toContain('## Backup And Restore')

    const authStateMachine = readSecurityDoc('auth-state-machine.md')
    expect(authStateMachine).toContain('## Account States')
    expect(authStateMachine).toContain('## Refresh Grant')

    const secretsInventory = readSecurityDoc('secrets-inventory.md')
    expect(secretsInventory).toContain('HONOWARDEN_TOKEN_SECRET')
    expect(secretsInventory).toContain('HONOWARDEN_TOTP_SECRET')
    expect(secretsInventory).toContain('HONOWARDEN_BOOTSTRAP_TOKEN')

    const incidentResponse = readSecurityDoc('incident-response.md')
    expect(incidentResponse).toContain('## Detection')
    expect(incidentResponse).toContain('## Triage')
    expect(incidentResponse).toContain('## Containment')
    expect(incidentResponse).toContain('## Communication')
    expect(incidentResponse).toContain('## Recovery')
    expect(incidentResponse).toContain('## Postmortem')
    expect(incidentResponse).toContain('HONOWARDEN_TOKEN_SECRET')
    expect(incidentResponse).toContain('Operations Rollback Evidence')
    expect(incidentResponse).toContain('Backup And Restore Runbook')
    expect(incidentResponse).toContain('Account Lifecycle Operator Runbook')

    const incidentExercise = readSecurityDoc('incident-response-exercise.md')
    expect(incidentExercise).toContain('Status: passed')
    expect(incidentExercise).toContain('Simulated combined incident')
    expect(incidentExercise).toContain('Formal secret rotation dry-run')
    expect(incidentExercise).toContain('future live rotation window')
    expect(incidentExercise).toContain('access-control review')
    expect(incidentExercise).toContain('HON-57')
    expect(incidentExercise).toContain('HON-49')

    const knownLimitations = readSecurityDoc('known-limitations.md')
    expect(knownLimitations).toContain('pre-alpha')
    expect(knownLimitations).toContain('no independent security audit')
    expect(knownLimitations).toContain('incident response runbook')

    const dependencyAudit = readSecurityDoc('dependency-audit.md')
    expect(dependencyAudit).toContain('pnpm audit --audit-level low')
    expect(dependencyAudit).toContain('No known vulnerabilities found')
    expect(dependencyAudit).toContain('pnpm-lock.yaml')
  })
})

function readSecurityDoc(docPath: (typeof securityDocPaths)[number]): string {
  return readFileSync(`${securityDocsRoot}/${docPath}`, 'utf8')
}

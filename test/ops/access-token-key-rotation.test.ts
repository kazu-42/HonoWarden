import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())

describe('access-token key rotation docs and workflow', () => {
  it('documents staged access-token key rotation without claiming a live rotation drill', () => {
    const runbook = readRepoFile('docs/operations/access-token-key-rotation.md')
    const knownLimitations = readRepoFile('docs/security/known-limitations.md')
    const secretsInventory = readRepoFile('docs/security/secrets-inventory.md')
    const incidentResponse = readRepoFile('docs/security/incident-response.md')
    const currentState = readRepoFile('docs/current-state.md')

    expect(runbook).toContain('HONOWARDEN_ACCESS_TOKEN_ACTIVE_KID')
    expect(runbook).toContain('HONOWARDEN_ACCESS_TOKEN_ACTIVE_SECRET')
    expect(runbook).toContain('HONOWARDEN_ACCESS_TOKEN_PREVIOUS_KEYS')
    expect(runbook).toContain('Unknown `kid` values fail closed')
    expect(runbook).toContain(
      'No live production access-token key rotation drill',
    )
    expect(knownLimitations).toMatch(
      /Key id based staged rotation is\s+implemented/,
    )
    expect(secretsInventory).toContain('legacy no-kid access-token fallback')
    expect(incidentResponse).toContain('Access Token Key Rotation')
    expect(currentState).toContain('Week 26 Access Token Key Rotation Support')
    expect(currentState).toContain('unknown `kid` values fail closed')
  })

  it('keeps local env placeholders and workflow evidence for HON-45', () => {
    const envExample = readRepoFile('.env.example')
    const operatorDocs = readRepoFile('docs/operations/operator-environment.md')
    const workflowPlan = readRepoFile(
      '.workflow/week-26-access-token-key-rotation/plan.md',
    )
    const workflowState = readRepoFile(
      '.workflow/week-26-access-token-key-rotation/state.json',
    )

    for (const name of [
      'HONOWARDEN_ACCESS_TOKEN_ACTIVE_KID',
      'HONOWARDEN_ACCESS_TOKEN_ACTIVE_SECRET',
      'HONOWARDEN_ACCESS_TOKEN_PREVIOUS_KEYS',
    ]) {
      expect(envExample).toMatch(new RegExp(`^${name}=$`, 'm'))
      expect(operatorDocs).toContain(name)
      expect(workflowPlan).toContain(name)
    }

    expect(workflowPlan).toContain('HON-45')
    expect(workflowState).toContain(
      '"slug": "week-26-access-token-key-rotation"',
    )
    expect(workflowState).toContain('Live secret rotation remains out of scope')
  })
})

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}

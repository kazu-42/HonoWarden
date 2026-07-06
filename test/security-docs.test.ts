import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const securityDocPaths = [
  'threat-model.md',
  'data-flow.md',
  'auth-state-machine.md',
  'secrets-inventory.md',
  'known-limitations.md',
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

    const knownLimitations = readSecurityDoc('known-limitations.md')
    expect(knownLimitations).toContain('pre-alpha')
    expect(knownLimitations).toContain('no independent security audit')
  })
})

function readSecurityDoc(docPath: (typeof securityDocPaths)[number]): string {
  return readFileSync(`${securityDocsRoot}/${docPath}`, 'utf8')
}

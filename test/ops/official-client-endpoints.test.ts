import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const endpointRunbookPath = fileURLToPath(
  new URL(
    '../../docs/operations/official-client-endpoints.md',
    import.meta.url,
  ).toString(),
)
const quickstartPath = fileURLToPath(
  new URL(
    '../../docs/operations/operator-quickstart.md',
    import.meta.url,
  ).toString(),
)

describe('official client endpoint operations', () => {
  it('documents stable environment-specific client URLs and the website boundary', () => {
    expect(existsSync(endpointRunbookPath)).toBe(true)

    const runbook = readFileSync(endpointRunbookPath, 'utf8')

    expect(runbook).toContain('https://vault.honowarden.com')
    expect(runbook).toContain('https://vault-staging.honowarden.com')
    expect(runbook).toContain('https://honowarden.com')
    expect(runbook).toMatch(/website[\s\S]+not[\s\S]+Server URL/i)
    expect(runbook).toContain('/api/config')
    expect(runbook).toContain('/identity/accounts/prelogin')
    expect(runbook).toContain('custom_domain')
    expect(runbook).toContain('workers_dev')
    expect(runbook).toContain('Rollback')
    expect(runbook).not.toContain('production login completed')
  })

  it('uses the stable staging custom domain in the operator quickstart', () => {
    const quickstart = readFileSync(quickstartPath, 'utf8')

    expect(quickstart).toContain('BASE="https://vault-staging.honowarden.com"')
    expect(quickstart).toContain('https://vault.honowarden.com')
    expect(quickstart).toContain('https://honowarden.com')
    expect(quickstart).toContain('official-client-endpoints.md')
  })
})

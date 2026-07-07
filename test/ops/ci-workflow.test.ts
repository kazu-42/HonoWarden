import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const workflowPath = fileURLToPath(
  new URL('../../.github/workflows/ci.yml', import.meta.url).toString(),
)
const contiguousBlockedToken = ['Bit', 'warden'].join('')

describe('ci workflow', () => {
  it('contains external brand scan protection and does not run destructive git steps', () => {
    expect(existsSync(workflowPath)).toBe(true)

    const workflow = readFileSync(workflowPath, 'utf8')

    expect(workflow).toContain('name: CI')
    expect(workflow).toContain('permissions:')
    expect(workflow).toContain('contents: read')
    expect(workflow).toContain('Install dependencies')
    expect(workflow).toContain('pnpm install --frozen-lockfile')
    expect(workflow).toContain('Typecheck')
    expect(workflow).toContain('pnpm check')
    expect(workflow).toContain('Lint')
    expect(workflow).toContain('pnpm lint')
    expect(workflow).toContain('Test')
    expect(workflow).toContain('pnpm test')
    expect(workflow).toContain('Compatibility fixture test')
    expect(workflow).toContain('pnpm compat:test')
    expect(workflow).toContain('Release gate preflight')
    expect(workflow).toContain('pnpm release:gate')
    expect(workflow).toContain('Repository brand scan')
    expect(workflow).toContain('pnpm brand:scan')
    expect(workflow).toContain('Format check')
    expect(workflow).toContain('pnpm format')
    expect(workflow).not.toContain('BLOCKED_PATTERN')
    expect(workflow).not.toContain('rg -n')
    const releaseGateIndex = workflow.indexOf('Release gate preflight')
    const repositoryBrandScanIndex = workflow.indexOf('Repository brand scan')
    const formatCheckIndex = workflow.indexOf('Format check')

    expect(releaseGateIndex).toBeGreaterThan(-1)
    expect(repositoryBrandScanIndex).toBeGreaterThan(-1)
    expect(formatCheckIndex).toBeGreaterThan(-1)
    expect(repositoryBrandScanIndex).toBeGreaterThan(releaseGateIndex)
    expect(repositoryBrandScanIndex).toBeLessThan(formatCheckIndex)
    expect(workflow).not.toContain(contiguousBlockedToken)
    expect(workflow).not.toContain('git tag -a')
    expect(workflow).not.toContain('git push origin')
  })
})

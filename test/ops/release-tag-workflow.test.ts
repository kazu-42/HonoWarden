import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const workflowPath = fileURLToPath(
  new URL(
    '../../.github/workflows/release-tag.yml',
    import.meta.url,
  ).toString(),
)

describe('release tag workflow', () => {
  it('verifies the alpha release tag without mutating repository state', () => {
    expect(existsSync(workflowPath)).toBe(true)

    const workflow = readFileSync(workflowPath, 'utf8')

    expect(workflow).toContain('name: Release Tag Verification')
    expect(workflow).toContain('v0.1.0-alpha')
    expect(workflow).toContain('contents: read')
    expect(workflow).toContain('fetch-depth: 0')
    expect(workflow).toContain('pnpm install --frozen-lockfile')
    expect(workflow).toContain('pnpm check')
    expect(workflow).toContain('pnpm lint')
    expect(workflow).toContain('pnpm test')
    expect(workflow).toContain('pnpm compat:test')
    expect(workflow).toContain('pnpm release:gate -- --strict')
    expect(workflow).toContain(
      'pnpm release:tag:preflight -- --strict --allow-existing-tag',
    )
    expect(workflow).toContain('pnpm brand:scan')
    expect(workflow).not.toContain('BLOCKED_PATTERN')
    expect(workflow).not.toContain('rg -n')
    expect(workflow).toContain('pnpm format')
    expect(workflow).not.toContain('git tag -a')
    expect(workflow).not.toContain('git push origin')
  })
})

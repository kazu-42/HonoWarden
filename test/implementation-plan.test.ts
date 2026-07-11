import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const planPath = fileURLToPath(
  new URL('../docs/implementation-plan.md', import.meta.url).toString(),
)

describe('usable-state implementation plan', () => {
  it('defines gated outcomes, phases, hierarchy, and capacity policy', () => {
    const plan = readFileSync(planPath, 'utf8')

    expect(plan).toContain('## Definition Of Synthetic Usable')
    expect(plan).toContain('## Definition Of Real-Secret Ready')
    expect(plan).toContain(
      '### Phase 1: Reproducible Official-Client Workflows',
    )
    expect(plan).toContain('### Phase 2: Inquiry Inbox Operational Loop')
    expect(plan).toContain('### Phase 3: Operator And Security Hardening')
    expect(plan).toContain('### Phase 4: Usable-State Acceptance And Handoff')
    expect(plan).toContain('## Dependency Graph')
    expect(plan).toContain('## Issue Design Rules')
    expect(plan).toContain('## Free-Plan Issue Capacity')
    expect(plan).toContain('88 total issues')
    expect(plan).toContain('below 200 total: retain Done issues')
    expect(plan).toContain('Parent issues close bottom-up')
    expect(plan).toMatch(/Real-secret\s+ready cannot be self-attested/)
    expect(plan).toMatch(/production\s+is out of scope/i)
  })
})

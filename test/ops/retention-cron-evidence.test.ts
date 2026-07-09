import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())

describe('retention cron live evidence', () => {
  it('records the live deployment, schedule, smoke, and cron readback evidence', () => {
    const evidence = readRepoFile('docs/release/retention-cron-evidence.md')
    const runbook = readRepoFile('docs/operations/retention-cleanup.md')
    const currentState = readRepoFile('docs/current-state.md')
    const index = readRepoFile('docs/release/index.md')

    expect(index).toContain('retention-cron-evidence.md')

    expect(evidence).toContain('Status: passed')
    expect(evidence).toContain('0 * * * *')
    expect(evidence).toContain('b1270b557c604a868091ec3b4252c9b7566c958b')
    expect(evidence).toContain('35702116-2232-4236-9d81-dcc648ed2374')
    expect(evidence).toContain('96a2c5d1-7fce-42cf-8ab1-5709b69fe83c')
    expect(evidence).toContain('schema version `0005`')
    expect(evidence).toContain('hon-51-cron-smoke')
    expect(evidence).toContain('2026-07-09T16:00:08.894Z')
    expect(evidence).toContain('2026-07-09T16:00:08.895Z')
    expect(evidence).toContain('`ok`')
    expect(evidence).toMatch(/staging\s+\|\s+`0`\s+\|\s+`0`/)
    expect(evidence).toMatch(/production\s+\|\s+`0`\s+\|\s+`0`/)
    expect(evidence).toContain('rollback')

    expect(runbook).toContain('docs/release/retention-cron-evidence.md')
    expect(runbook).toContain('synthetic `hon-51-cron-smoke` cleanup rows')

    expect(currentState).toContain('retention-cron-evidence.md')
    expect(currentState).toContain('outcome: ok')
    expect(currentState).toContain('were deleted in both staging')
  })

  it('does not record operator identities, secrets, or real mailbox/user data', () => {
    const combined = [
      readRepoFile('docs/release/retention-cron-evidence.md'),
      readRepoFile('docs/operations/retention-cleanup.md'),
      readRepoFile('docs/current-state.md'),
      readRepoFile(
        '.workflow/week-26-retention-cron-live-closeout/final-report.md',
      ),
      readRepoFile('.workflow/week-26-retention-cron-live-closeout/state.json'),
    ].join('\n')

    expect(combined).not.toContain('author_email')
    expect(combined).not.toContain('CLOUDFLARE_GLOBAL_API_KEY=')
    expect(combined).not.toContain('X-Auth-Key')
    expect(combined).not.toMatch(
      /[A-Z0-9._%+-]+@(?!honowarden\.com\b)[A-Z0-9.-]+\.[A-Z]{2,}/i,
    )
  })
})

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}

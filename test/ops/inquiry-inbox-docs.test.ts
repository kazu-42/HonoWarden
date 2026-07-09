import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())

describe('inquiry inbox operations docs', () => {
  it('records the HON-24 implementation boundary without expanding follow-up scope', () => {
    const inquiryDoc = readRepoFile('docs/operations/ai-inquiry-inbox.md')
    const websiteEmailDoc = readRepoFile('docs/operations/website-email.md')
    const currentState = readRepoFile('docs/current-state.md')

    for (const content of [inquiryDoc, websiteEmailDoc, currentState]) {
      expect(content).toContain('HonoWarden-inquiry-inbox')
      expect(content).toContain('metadata-only')
      expect(content).toContain('inquiry-smoke@honowarden.com')
      expect(content).toContain('forwarding-only')
    }

    expect(inquiryDoc).toContain('Status: implemented for HON-24')
    expect(inquiryDoc).toContain('honowarden-inquiry-inbox-staging')
    expect(inquiryDoc).toContain('honowarden-inquiry-inbox')
    expect(inquiryDoc).toContain('honowarden-inquiry-staging')
    expect(inquiryDoc).toContain('honowarden-inquiry')
    expect(inquiryDoc).toContain('raw_storage_state = "disabled"')
    expect(inquiryDoc).toContain('HON-25')
    expect(inquiryDoc).toContain('HON-26')
    expect(inquiryDoc).toContain('HON-27')

    expect(websiteEmailDoc).toContain(
      'Public routes for `security`, `support`, `hello`, `admin`, `postmaster`, and',
    )
    expect(websiteEmailDoc).toContain('Raw MIME and attachment')
    expect(websiteEmailDoc).toContain(
      'attachment-bearing messages are rejected',
    )

    expect(currentState).toContain('public alias migration')
    expect(currentState).toMatch(/body or\s+attachment storage/)
    expect(currentState).toContain('AI triage')
    expect(currentState).toMatch(/Linear issue\s+creation automation/)
  })

  it('keeps private mailbox evidence out of the tracked operations docs', () => {
    const combined = [
      readRepoFile('docs/operations/ai-inquiry-inbox.md'),
      readRepoFile('docs/operations/website-email.md'),
      readRepoFile('docs/current-state.md'),
    ].join('\n')

    expect(combined).not.toContain('HONOWARDEN_SECURITY_FORWARD_TO=')
    expect(combined).not.toContain('HONOWARDEN_SUPPORT_FORWARD_TO=')
    expect(combined).not.toContain('HONOWARDEN_GENERAL_FORWARD_TO=')
    expect(combined).not.toMatch(
      /[A-Z0-9._%+-]+@(?!honowarden\.com\b)[A-Z0-9.-]+\.[A-Z]{2,}/i,
    )
  })
})

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}

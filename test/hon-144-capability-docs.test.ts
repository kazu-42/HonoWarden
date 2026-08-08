import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

function readRepositoryFile(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../${relativePath}`, import.meta.url).toString()),
    'utf8',
  )
}

describe('HON-144 current capability claims', () => {
  it('describes the merged organization slices without claiming broad compatibility', () => {
    const compatibility = readRepositoryFile('docs/compatibility.md')
    const matrix = readRepositoryFile('docs/compatibility-matrix.md')
    const limitations = readRepositoryFile('docs/security/known-limitations.md')
    const threatModel = readRepositoryFile('docs/security/threat-model.md')

    for (const document of [compatibility, matrix, limitations, threatModel]) {
      expect(document).toContain('ADR 0010')
      expect(document).toMatch(/organization\s+foundation/i)
      expect(document).toMatch(/collection\s+CRUD/i)
    }

    expect(matrix).toMatch(/slice-specific evidence/i)
    expect(matrix).not.toContain(
      'There is intentionally no Organizations or shared vault row',
    )
    expect(limitations).not.toContain(
      'Organizations and shared vaults are intentionally not implemented',
    )
    expect(threatModel).not.toContain('Organization routes remain unsupported')

    for (const document of [compatibility, matrix, limitations, threatModel]) {
      expect(document).toMatch(/membership/i)
      expect(document).toMatch(/cross-user\s+isolation/i)
      expect(document).toMatch(/organization\s+cipher/i)
    }
  })

  it('states exact audit coverage and the remaining organization audit gap', () => {
    const limitations = readRepositoryFile('docs/security/known-limitations.md')
    const threatModel = readRepositoryFile('docs/security/threat-model.md')

    for (const document of [limitations, threatModel]) {
      expect(document).toContain('D1 `audit_events`')
      expect(document).toMatch(/folder, cipher, and attachment\s+mutations/i)
      expect(document).toMatch(
        /organization creation and collection mutations\s+are not yet audited/i,
      )
    }

    expect(limitations).not.toContain(
      'Audit event coverage does not include every vault CRUD route',
    )
  })

  it('records current login-with-device and attachment evidence conservatively', () => {
    const currentState = readRepositoryFile('docs/current-state.md')
    const evidence = readRepositoryFile(
      'docs/release/login-with-device-live-client-evidence.md',
    )
    const limitations = readRepositoryFile('docs/security/known-limitations.md')
    const matrix = readRepositoryFile('docs/compatibility-matrix.md')
    const threatModel = readRepositoryFile('docs/security/threat-model.md')
    const operatorQuickstart = readRepositoryFile(
      'docs/operations/operator-quickstart.md',
    )
    const releaseNotes = readRepositoryFile(
      'docs/release/v0.1.0-alpha-release-notes.md',
    )

    expect(limitations).toMatch(/atomically supersedes/i)
    expect(limitations).not.toContain(
      'older pending requests visible until fixed expiry',
    )
    expect(currentState).not.toContain(
      'superseding older pending requests created by repeated resend attempts',
    )
    expect(evidence).toContain('Superseded status update (HON-115)')
    expect(evidence).toMatch(/original 2026-07-12 observation/i)
    expect(evidence).toMatch(
      /post-HON-115 official-client resend rerun is not recorded/i,
    )
    expect(threatModel).not.toContain(
      'Current mitigation: routes remain explicit 501 responses',
    )
    expect(threatModel).not.toContain(
      'controls that must be true before `v0.1.0-alpha` is tagged',
    )
    expect(operatorQuickstart).toMatch(/ADR 0010 organization foundation/i)
    expect(operatorQuickstart).not.toMatch(
      /unsupported surfaces \(organizations,\s*collections/i,
    )

    expect(limitations).toContain('HON-124')
    expect(limitations).not.toContain(
      'no live official-client attachment run has been captured yet',
    )
    expect(matrix).toContain('HON-124')
    expect(matrix).toMatch(/does not\s+promote the Desktop matrix row/i)
    expect(releaseNotes).toContain('## Post-Release Supersession')
    expect(releaseNotes).toContain(
      'Release status: published as a prerelease on 2026-07-08',
    )
    expect(releaseNotes).toContain('HON-124')
    expect(releaseNotes).toMatch(/production\s+default-off/i)
  })

  it('points current inquiry claims at the shipped dedicated service', () => {
    const currentState = readRepositoryFile('docs/current-state.md')
    const inquiry = readRepositoryFile('docs/operations/ai-inquiry-inbox.md')
    const limitations = readRepositoryFile('docs/security/known-limitations.md')
    const readme = readRepositoryFile('README.md')
    const releaseNotes = readRepositoryFile(
      'docs/release/v0.1.0-alpha-release-notes.md',
    )

    for (const document of [
      currentState,
      inquiry,
      limitations,
      readme,
      releaseNotes,
    ]) {
      expect(document).toContain('HonoWarden-inquiry-inbox')
    }

    expect(inquiry).toMatch(/operator queue/i)
    expect(inquiry).toMatch(/duplicate-safe Linear/i)
    expect(inquiry).toContain('OutboundProvider[Resend HTTPS API]')
    expect(inquiry).toContain('Inbox Worker to Resend')
    expect(inquiry).not.toContain('EmailBinding[send_email binding]')
    expect(inquiry).not.toContain('Inbox Worker to Email Service')
    expect(inquiry).not.toContain('participant Email as Email Service')
    expect(inquiry).not.toContain('HON-27 should implement')
    expect(currentState).toMatch(/redaction-first AI triage/i)
    expect(currentState).toMatch(/approval-gated outbound/i)
    expect(limitations).not.toContain(
      'AI triage, approved outbound replies, and Linear issue creation automation are not implemented yet',
    )
  })
})

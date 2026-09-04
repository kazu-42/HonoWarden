import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('..', import.meta.url).toString())
const adrPath = 'docs/adr/0013-emergency-access-product-line.md'
const threatModelPath = 'docs/security/emergency-access-threat-model.md'
const wireContractPath = 'docs/protocol/emergency-access-wire-contract.md'

describe('HON-188 Emergency Access design contract', () => {
  it('provides a substantial replacement ADR, threat model, and wire contract', () => {
    for (const path of [adrPath, threatModelPath, wireContractPath]) {
      expect(existsSync(`${repoRoot}/${path}`), `${path} should exist`).toBe(
        true,
      )
      expect(
        read(path).length,
        `${path} should be substantial`,
      ).toBeGreaterThan(4_000)
    }
  })

  it('supersedes the old defer decision without enabling runtime behavior early', () => {
    const oldAdr = read('docs/adr/0004-emergency-access-scope.md')
    const premiumAdr = read('docs/adr/0009-premium-surface-scope.md')
    const replacementAdr = read(adrPath)
    const app = read('src/app.ts')
    const rotation = read('src/domain/user-key-rotation.ts')

    expect(oldAdr).toContain('Superseded by ADR 0013')
    expect(premiumAdr).toContain('ADR 0013')
    expect(replacementAdr).toContain('## Status')
    expect(replacementAdr).toContain('Accepted')
    expect(replacementAdr).toContain('HON-189')
    expect(replacementAdr).toContain('HON-190')
    expect(replacementAdr).toContain('HON-191')
    expect(replacementAdr).toContain('No partial exposure')
    expect(replacementAdr).toContain('source capability')
    expect(replacementAdr).toContain('runtime activation')
    expect(replacementAdr).toContain('live compatibility evidence')
    expect(app).toContain(
      "app.all('/api/emergency-access', unsupportedPremiumFeature)",
    )
    expect(app).toContain(
      "app.all('/api/emergency-access/*', unsupportedPremiumFeature)",
    )
    expect(rotation).toContain(
      "!isRequiredEmptyArray(value, 'emergencyAccessUnlockData')",
    )
  })

  it('pins official-source references without claiming runtime support', () => {
    const docs = readContractDocs()

    expect(docs).toContain('web-v2026.6.1')
    expect(docs).toContain('39f07436ca60e3f25eac47777671754f288a98f1')
    expect(docs).toContain('v2026.6.1')
    expect(docs).toContain('a09c7edb03ae6d4fdece784f1250c67be73d5fe0')
    expect(docs).toContain('EmergencyAccessController.cs')
    expect(docs).toContain('emergency-access-api.service.ts')
    expect(docs).toContain(
      'Nothing in this document changes current runtime behavior',
    )
  })

  it('maps trusted/granted lists and the full lifecycle route inventory', () => {
    const contract = read(wireContractPath)
    const routes = [
      'GET /api/emergency-access/trusted',
      'GET /api/emergency-access/granted',
      'GET /api/emergency-access/:id',
      'GET /api/emergency-access/:id/policies',
      'PUT /api/emergency-access/:id',
      'POST /api/emergency-access/:id',
      'DELETE /api/emergency-access/:id',
      'POST /api/emergency-access/:id/delete',
      'POST /api/emergency-access/invite',
      'POST /api/emergency-access/:id/reinvite',
      'POST /api/emergency-access/:id/accept',
      'POST /api/emergency-access/:id/confirm',
      'POST /api/emergency-access/:id/initiate',
      'POST /api/emergency-access/:id/approve',
      'POST /api/emergency-access/:id/reject',
      'POST /api/emergency-access/:id/takeover',
      'POST /api/emergency-access/:id/password',
      'POST /api/emergency-access/:id/view',
      'GET /api/emergency-access/:id/:cipherId/attachment/:attachmentId',
    ]

    for (const route of routes) {
      expect(contract, `${route} should be specified`).toContain(route)
    }
    for (const field of [
      'WaitTimeDays',
      'KeyEncrypted',
      'emergencyAccessUnlockData',
      'token',
      'Type',
      'Status',
    ]) {
      expect(contract, `${field} should be specified`).toContain(field)
    }
  })

  it('defines identity, confirmation, wait/approval, and key-generation invariants', () => {
    const docs = readContractDocs()

    for (const invariant of [
      'identity proof',
      'invite token',
      'single-use',
      'recipient email',
      'Confirmed',
      'RecoveryInitiated',
      'RecoveryApproved',
      'wait time',
      'server-authoritative',
      'clock skew',
      'conditional UPDATE',
      'key generation',
      'KeyEncrypted',
      'opaque ciphertext',
      'never decrypt',
      'View',
      'Takeover',
    ]) {
      expect(docs, `${invariant} should be specified`).toContain(invariant)
    }
    expect(docs).toContain(
      'no path that skips identity proof, confirmation, wait/approval, or current key-generation checks',
    )
  })

  it('keeps notification out of the authoritative state machine', () => {
    const docs = readContractDocs()

    expect(docs).toContain('Notification loss never grants access')
    expect(docs).toContain(
      'notification success alone never advances authoritative state',
    )
    expect(docs).toContain('out-of-band')
    expect(docs).toContain('retry')
    expect(docs).toContain('LastNotificationDate')
    expect(docs).not.toContain('email delivery is authoritative')
  })

  it('defines abuse, retention, activation, and rollback gates', () => {
    const docs = readContractDocs()

    for (const invariant of [
      'invite quota',
      'initiate quota',
      'kill switch',
      'audit redaction',
      'HONOWARDEN_EMERGENCY_ACCESS_RUNTIME_ENABLED',
      '501',
      'unsupported_feature',
      'rollback',
      'not a substitute for organization account recovery',
      'operator account control',
    ]) {
      expect(docs, `${invariant} should be specified`).toContain(invariant)
    }
  })

  it('adds invitation schema without mounting Emergency Access HTTP routes', () => {
    const migrationText = readdirSync(join(repoRoot, 'migrations'))
      .filter((entry) => entry.endsWith('.sql'))
      .map((entry) => read(`migrations/${entry}`))
      .join('\n')
    const app = read('src/app.ts')

    expect(migrationText).toContain('CREATE TABLE emergency_access')
    expect(migrationText).toContain("VALUES ('0021')")
    expect(app).toContain(
      "app.all('/api/emergency-access', unsupportedPremiumFeature)",
    )
    expect(app).toContain(
      "app.all('/api/emergency-access/*', unsupportedPremiumFeature)",
    )
    expect(app).not.toMatch(/emergency-access\/(invite|trusted|granted)/)
    expect(read('src/domain/user-key-rotation.ts')).toContain(
      "!isRequiredEmptyArray(value, 'emergencyAccessUnlockData')",
    )
  })

  it('links the new contract without promoting current compatibility', () => {
    const reviewIndex = read('docs/security/review-index.md')
    const currentState = read('docs/current-state.md')
    const compatibility = read('docs/compatibility.md')
    const compatibilityMatrix = read('docs/compatibility-matrix.md')
    const knownLimitations = read('docs/security/known-limitations.md')
    const topLevelThreatModel = read('docs/security/threat-model.md')

    expect(reviewIndex).toContain('Emergency Access Threat Model')
    expect(reviewIndex).toContain('emergency-access-threat-model.md')
    expect(reviewIndex).toContain('emergency-access-wire-contract.md')
    for (const doc of [
      currentState,
      compatibility,
      compatibilityMatrix,
      knownLimitations,
      topLevelThreatModel,
    ]) {
      expect(doc).toContain('ADR 0013')
      expect(doc).toContain('501')
    }
    expect(compatibilityMatrix).toContain(
      'There is intentionally no Emergency Access row',
    )
    expect(compatibility).toContain('ADR 0004')
    expect(topLevelThreatModel).toContain('ADR 0004')
    expect(topLevelThreatModel).toContain(
      'Delegated recovery privilege escalation',
    )
  })
})

function read(path: string): string {
  return readFileSync(`${repoRoot}/${path}`, 'utf8')
}

function readContractDocs(): string {
  return [read(adrPath), read(threatModelPath), read(wireContractPath)]
    .join('\n')
    .replace(/\s+/g, ' ')
}

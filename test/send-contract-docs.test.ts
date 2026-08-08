import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('..', import.meta.url).toString())
const adrPath = 'docs/adr/0011-send-public-sharing-product-line.md'
const threatModelPath = 'docs/security/send-public-sharing-threat-model.md'
const wireContractPath = 'docs/protocol/send-wire-contract.md'

describe('HON-183 Send design contract', () => {
  it('provides substantial replacement ADR, threat model, and wire contract', () => {
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
    const oldAdr = read('docs/adr/0003-send-public-sharing-scope.md')
    const premiumAdr = read('docs/adr/0009-premium-surface-scope.md')
    const replacementAdr = read(adrPath)
    const app = read('src/app.ts')
    const config = read('src/protocol/config.ts')

    expect(oldAdr).toContain('Superseded by ADR 0011')
    expect(premiumAdr).toContain('ADR 0011')
    expect(replacementAdr).toContain('## Status')
    expect(replacementAdr).toContain('Accepted')
    expect(replacementAdr).toContain('HON-184')
    expect(replacementAdr).toContain('HON-185')
    expect(replacementAdr).toContain('HON-186')
    expect(replacementAdr).toContain('No partial exposure')
    expect(replacementAdr).toContain('source capability')
    expect(replacementAdr).toContain('runtime activation')
    expect(replacementAdr).toContain('live compatibility evidence')
    expect(app).toContain("app.all('/api/sends', unsupportedPremiumFeature)")
    expect(app).toContain("app.all('/api/sends/*', unsupportedPremiumFeature)")
    expect(app).toContain("form.get('grant_type') === 'send_access'")
    expect(config).toContain("'send-enabled': false")
  })

  it('pins the interoperable owner, token, public metadata, and file routes', () => {
    const contract = read(wireContractPath)
    const normalizedContract = contract.replace(/\s+/g, ' ')
    const routes = [
      'GET /api/sends',
      'GET /api/sends/:id',
      'POST /api/sends',
      'POST /api/sends/file/v2',
      'GET /api/sends/:sendId/file/:fileId',
      'POST /api/sends/:sendId/file/:fileId',
      'PUT /api/sends/:id',
      'PUT /api/sends/:id/remove-password',
      'PUT /api/sends/:id/remove-auth',
      'DELETE /api/sends/:id',
      'POST /identity/connect/token',
      'POST /api/sends/access/:accessId',
      'POST /api/sends/:accessId/access/file/:fileId',
      'POST /api/sends/access',
      'POST /api/sends/access/file/:fileId',
      'GET /api/sends/access/file-content/:ticket',
    ]

    for (const route of routes) {
      expect(contract, `${route} should be specified`).toContain(route)
    }
    for (const field of [
      'grant_type=send_access',
      'client_id=send',
      'scope=api.send.access',
      'send_id',
      'password_hash_b64',
      'send_access_error_type',
      'Send-Id',
      'Authorization: Bearer',
    ]) {
      expect(contract, `${field} should be specified`).toContain(field)
    }
    expect(contract).toContain('web-v2026.6.1')
    expect(contract).toContain('39f07436ca60e3f25eac47777671754f288a98f1')
    expect(contract).toContain('v2026.6.1')
    expect(contract).toContain('a09c7edb03ae6d4fdece784f1250c67be73d5fe0')
    expect(contract).toContain('"Password": "configured"')
    expect(normalizedContract).toContain('HideEmail` is false')
    expect(normalizedContract).toContain('HideEmail` is true')
    expect(contract).toContain('CreatorIdentifier')

    const publicMetadataContract = contract.slice(
      contract.indexOf('## Public Metadata Contract'),
      contract.indexOf('### Legacy `POST /api/sends/access/:accessId`'),
    )
    expect(publicMetadataContract).toContain('"AuthType": 1')
    expect(publicMetadataContract).toContain(
      'recipient-facing authentication method',
    )
  })

  it('defines the zero-knowledge and public-token security invariants', () => {
    const docs = readContractDocs()

    for (const invariant of [
      'URL fragment',
      'never receives plaintext',
      'opaque ciphertext',
      'CSPRNG',
      'keyed verifier',
      'encrypted capability envelope',
      'constant-time',
      'purpose-separated',
      'short-lived',
      'no refresh token',
      'send id',
      'generation',
      'audience',
      'scope',
      'deterministic decoy',
      'bearer replay window',
      'email OTP',
    ]) {
      expect(docs, `${invariant} should be specified`).toContain(invariant)
    }
  })

  it('defines a concurrency-safe D1/R2 lifecycle and failure policy', () => {
    const docs = readContractDocs()

    for (const invariant of [
      'pending_upload',
      'active',
      'disabled',
      'expired',
      'deleted',
      'conditional UPDATE',
      'access_count < max_access_count',
      'generation-specific',
      'access_generation',
      'object_generation',
      'compare-and-set',
      'orphan cleanup',
      'idempotent',
      'fail closed',
      'no-store',
      'Content-Disposition',
      'opaque download URL',
      'random ticket ID',
      'R2 is never presigned',
      'send_download_tickets',
      'bounded range/retry',
    ]) {
      expect(docs, `${invariant} should be specified`).toContain(invariant)
    }
    expect(docs).toContain(
      'file access is counted when a download URL is issued',
    )
    expect(docs).toContain('text access is counted with metadata delivery')
    expect(docs).toContain('expired` to `active')
  })

  it('defines abuse, retention, activation, observability, and rollback gates', () => {
    const docs = readContractDocs()

    for (const invariant of [
      'IP bucket',
      'capability bucket',
      'account bucket',
      'Retry-After',
      'kill switch',
      'quarantine',
      'audit redaction',
      'cleanup heartbeat',
      'backup residual',
      '35-day backup residual',
      'minimal tombstone',
      'legal hold',
      'migration marker',
      '503',
      'send-enabled: false',
      'rollback',
      'metrics',
      'alert',
    ]) {
      expect(docs, `${invariant} should be specified`).toContain(invariant)
    }
  })

  it('makes restore, platform logging, cache, and capability-secret boundaries explicit', () => {
    const docs = readContractDocs()

    for (const invariant of [
      'HONOWARDEN_SEND_RUNTIME_ENABLED',
      'out-of-band',
      'in-place restore',
      'activation epoch',
      'fresh target',
      'platform request logs',
      'path, query, referrer, and authorization fields',
      'HONOWARDEN_SEND_CAPABILITY_ENVELOPE_SECRET',
      'HONOWARDEN_SEND_LOOKUP_VERIFIER_SECRET',
      '/api/config',
      '/config',
      'readiness failures',
    ]) {
      expect(docs, `${invariant} should be specified`).toContain(invariant)
    }

    expect(docs).not.toContain('HONOWARDEN_SEND_VERIFIER_SECRET')
    expect(docs).not.toContain('is never logged or included in audit context')
  })

  it('links the new contract without promoting current compatibility', () => {
    const reviewIndex = read('docs/security/review-index.md')
    const currentState = read('docs/current-state.md')
    const compatibility = read('docs/compatibility.md')
    const compatibilityMatrix = read('docs/compatibility-matrix.md')
    const knownLimitations = read('docs/security/known-limitations.md')
    const topLevelThreatModel = read('docs/security/threat-model.md')

    expect(reviewIndex).toContain('Send And Public-Sharing Threat Model')
    expect(reviewIndex).toContain('send-public-sharing-threat-model.md')
    expect(reviewIndex).toContain('send-wire-contract.md')
    for (const doc of [
      currentState,
      compatibility,
      compatibilityMatrix,
      knownLimitations,
      topLevelThreatModel,
    ]) {
      expect(doc).toContain('ADR 0011')
      expect(doc).toContain('501')
    }
    expect(compatibilityMatrix).toContain(
      'There is intentionally no Send or public file-sharing row.',
    )
    expect(knownLimitations).toContain('send-enabled: false')
    expect(topLevelThreatModel).toContain('ADR 0003')
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

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import app from '../src/app'
import { signAccessToken } from '../src/domain/tokens'

const repoRoot = fileURLToPath(new URL('..', import.meta.url).toString())
const adrPath = 'docs/adr/0015-hibp-reports-integrations-scope.md'

const hibpUnsupportedMessage = 'This feature is unavailable on this server.'
const hibpUnsupportedBody = {
  Message: hibpUnsupportedMessage,
  error: {
    code: 'unsupported_feature',
    message: hibpUnsupportedMessage,
  },
}

const localClientPasswordHealth = [
  'weak-password evaluation',
  'reused-password evaluation',
  'unsecured-website report',
  'inactive two-factor report',
  'Pwned Passwords range API',
  'k-anonymity',
] as const

const vendorOrPlaintextNonGoals = [
  'GET /api/hibp/breach',
  'HaveIBeenPwned breachedaccount',
  'HIBP API key',
  'server-origin breach lookup',
  'at-risk password security tasks',
  'notification center',
  'vendor SIEM adapter',
  'Slack integration',
] as const

const encryptedMetadataCandidates = [
  'member access report',
  'collection access report',
  'organization event export',
  'existing audit_events',
] as const

describe('HON-200 HIBP, reports, and integrations decision', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('records a substantial accepted privacy/security ADR', () => {
    expect(existsSync(join(repoRoot, adrPath)), `${adrPath} should exist`).toBe(
      true,
    )

    const adr = read(adrPath)
    expect(adr.length, `${adrPath} should be substantial`).toBeGreaterThan(
      4_000,
    )
    expect(adr).toContain('## Status')
    expect(adr).toContain('Accepted')
    expect(adr).toContain('## Context')
    expect(adr).toContain('## Decision')
    expect(adr).toContain('## Consequences')
    expect(adr).toContain('HON-200')
    expect(adr).toContain('ADR 0009')
    expect(adr).toContain('operator opt-in')
    expect(adr).toContain('privacy/security ADR')
  })

  it('distinguishes local client password-health from server data processing', () => {
    const adr = read(adrPath)

    for (const phrase of localClientPasswordHealth) {
      expect(adr, `${phrase} should be documented as client-local`).toContain(
        phrase,
      )
    }

    expect(adr).toContain('does not add HonoWarden routes')
    expect(adr).toContain('does not receive password plaintext')
    expect(adr).toContain('does not receive password hashes')
    expect(adr).toContain('api.pwnedpasswords.com/range')
    expect(adr).toContain('haveibeenpwned.com/api/v3/breachedaccount')
    expect(adr).toContain('third-party disclosure')
    expect(adr).toContain('rate-limit')
    expect(adr).toContain('false-positive')
    expect(adr).toContain('vendor retention')
  })

  it('inventories reports, security tasks, notification center, and integrations by data boundary', () => {
    const adr = read(adrPath)

    expect(adr).toContain('## Reports And Security-Task Inventory')
    expect(adr).toContain('encrypted metadata')
    expect(adr).toContain('plaintext')
    expect(adr).toContain('third-party disclosure')

    for (const candidate of encryptedMetadataCandidates) {
      expect(adr, `${candidate} should be inventoried`).toContain(candidate)
    }
    for (const nonGoal of vendorOrPlaintextNonGoals) {
      expect(adr, `${nonGoal} should be inventoried`).toContain(nonGoal)
    }

    expect(adr).toContain('/notifications/hub')
    expect(adr).toContain('vault-sync notification hub')
    expect(adr).toContain('GET /tasks')
    expect(adr).toContain('POST /tasks/{orgId}/bulk-create')
    expect(adr).toContain('PATCH /tasks/{taskId}/complete')
  })

  it('keeps plaintext-requiring and vendor-dependent features explicit non-goals', () => {
    const adr = read(adrPath)

    expect(adr).toContain('## Explicit Non-Goals')
    expect(adr).toContain('unless a privacy/security ADR and operator opt-in')
    expect(adr).toContain('HONOWARDEN_HIBP_API_KEY')
    expect(adr).not.toMatch(/HONOWARDEN_HIBP_API_KEY.*=\s*['"][^'"]+['"]/)
    expect(adr).toContain('do not call HaveIBeenPwned')
    expect(adr).toContain('do not add vendor API keys')
    expect(adr).toContain('do not contact vendors')
  })

  it('decomposes accepted capabilities by boundary, adapter, failure, audit, retention, and rollback', () => {
    const adr = read(adrPath)

    expect(adr).toContain('## Accepted Capability Decomposition')
    for (const column of [
      'data boundary',
      'provider adapter',
      'failure policy',
      'audit',
      'retention',
      'rollback',
    ]) {
      expect(adr, `${column} should be a decomposition axis`).toContain(column)
    }

    expect(adr).toContain('local client password-health')
    expect(adr).toContain('state-free HIBP 501 guard')
    expect(adr).toContain('encrypted-metadata organization reports')
    expect(adr).toContain('operator-owned audit event export')
    expect(adr).toContain('none')
    expect(adr).toContain('git revert')
  })

  it('pins official-source references without claiming runtime HIBP support', () => {
    const adr = read(adrPath)

    expect(adr).toContain('web-v2026.6.1')
    expect(adr).toContain('39f07436ca60e3f25eac47777671754f288a98f1')
    expect(adr).toContain('v2026.6.1')
    expect(adr).toContain('a09c7edb03ae6d4fdece784f1250c67be73d5fe0')
    expect(adr).toContain('HibpController')
    expect(adr).toContain('username')
    expect(adr).not.toMatch(/runtime support claim/i)
    expect(adr).not.toContain('HIBP is implemented')
  })

  it('keeps GET /api/hibp/breach state-free even with auth, vendor keys, or throwing storage', async () => {
    const fetchMock = vi.fn(() => {
      throw new Error('HIBP route must not call fetch')
    })
    vi.stubGlobal('fetch', fetchMock)

    const throwingStorage = {
      prepare() {
        throw new Error('HIBP route must not query D1')
      },
      batch() {
        throw new Error('HIBP route must not batch D1')
      },
      exec() {
        throw new Error('HIBP route must not exec D1')
      },
      put() {
        throw new Error('HIBP route must not write R2')
      },
      get() {
        throw new Error('HIBP route must not read R2')
      },
    }

    const accessToken = await signAccessToken('test-token-secret', {
      sub: 'user-hibp',
      email: 'person@example.test',
      device: 'fixture-device',
      securityStamp: 'stamp',
      iat: 1,
      exp: 4_102_444_800,
    })

    const requests = [
      {
        name: 'anonymous lookup',
        init: {
          method: 'GET',
          headers: { 'X-Request-Id': 'hibp-anonymous' },
        },
        env: {},
        requestId: 'hibp-anonymous',
      },
      {
        name: 'authenticated lookup with vendor key and throwing storage',
        init: {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'X-Request-Id': 'hibp-authenticated',
          },
        },
        env: {
          DB: throwingStorage,
          VAULT_OBJECTS: throwingStorage,
          HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
          HONOWARDEN_HIBP_API_KEY: 'must-not-be-read',
          HONOWARDEN_PREMIUM_FEATURES_ENABLED: 'true',
        },
        requestId: 'hibp-authenticated',
      },
    ] as const

    for (const request of requests) {
      const response = await app.request(
        '/api/hibp/breach?username=person%40example.test',
        request.init,
        request.env,
      )

      expect(response.status, request.name).toBe(501)
      expect(response.headers.get('Cache-Control'), request.name).toBe(
        'no-store',
      )
      const body = await response.json()
      expect(body, request.name).toEqual({
        ...hibpUnsupportedBody,
        requestId: request.requestId,
      })
      expect(JSON.stringify(body), request.name).not.toContain(
        'person@example.test',
      )
      expect(JSON.stringify(body), request.name).not.toContain(
        'must-not-be-read',
      )
    }

    expect(fetchMock).not.toHaveBeenCalled()
    expect(read('src/app.ts')).toContain(
      "app.get('/api/hibp/breach', unsupportedPremiumFeature)",
    )
  })

  it('does not add HIBP vendor keys, report routes, or persistence', () => {
    const trackedConfig = [
      read('src/app.ts'),
      read('src/bindings.ts'),
      read('wrangler.jsonc'),
      read('package.json'),
    ].join('\n')
    const migrationText = readdirSync(join(repoRoot, 'migrations'))
      .filter((entry) => entry.endsWith('.sql'))
      .map((entry) => read(`migrations/${entry}`))
      .join('\n')

    expect(trackedConfig).not.toMatch(/HONOWARDEN_HIBP/)
    expect(trackedConfig).not.toMatch(/haveibeenpwned/i)
    expect(trackedConfig).not.toMatch(/hibp-api-key/i)
    expect(trackedConfig).not.toContain("app.get('/api/tasks")
    expect(trackedConfig).not.toContain("app.get('/api/reports")
    expect(migrationText).not.toMatch(/hibp|breach_report|security_task/i)
    expect(
      readdirSync(join(repoRoot, 'migrations'))
        .filter((entry) => entry.endsWith('.sql'))
        .sort(),
    ).toEqual([
      '0001_initial_schema.sql',
      '0002_login_defenses.sql',
      '0003_totp_login.sql',
      '0004_totp_change.sql',
      '0005_device_keys.sql',
      '0006_cipher_attachments.sql',
      '0007_audit_events.sql',
      '0008_request_quotas.sql',
      '0009_inquiry_messages.sql',
      '0010_equivalent_domains.sql',
      '0010a_inquiry_message_reconciliation.sql',
      '0011_inquiry_inbox.sql',
      '0012_auth_requests.sql',
      '0013_auth_request_supersede.sql',
      '0014_organizations.sql',
      '0014a_kdf_population.sql',
      '0016_user_key_rotation_wrapper_history.sql',
      '0017_account_lifecycle.sql',
      '0018_text_sends.sql',
    ])
  })

  it('leaves security-task, report, and vendor-integration routes unimplemented', async () => {
    const notFoundPaths = [
      '/api/tasks',
      '/api/tasks/organization',
      '/api/reports',
    ]
    const organizationFamilyPaths = [
      '/api/organizations/org-id/integrations',
      '/api/organizations/org-id/events',
    ]

    for (const path of notFoundPaths) {
      const response = await app.request(path, {
        method: 'GET',
        headers: { 'X-Request-Id': 'hibp-non-goal-route' },
      })

      expect(response.status, path).toBe(404)
      await expect(response.json(), path).resolves.toMatchObject({
        error: { code: 'not_found' },
        requestId: 'hibp-non-goal-route',
      })
    }

    for (const path of organizationFamilyPaths) {
      const response = await app.request(path, {
        method: 'GET',
        headers: { 'X-Request-Id': 'hibp-non-goal-org-route' },
      })

      expect(response.status, path).toBe(501)
      await expect(response.json(), path).resolves.toMatchObject({
        error: { code: 'unsupported_feature' },
        requestId: 'hibp-non-goal-org-route',
      })
    }
  })

  it('links the decision without promoting HIBP compatibility or live evidence', () => {
    const reviewIndex = read('docs/security/review-index.md')
    const currentState = read('docs/current-state.md')
    const compatibility = read('docs/compatibility.md')
    const compatibilityMatrix = read('docs/compatibility-matrix.md')
    const knownLimitations = read('docs/security/known-limitations.md')
    const threatModel = read('docs/security/threat-model.md')
    const premiumAdr = read('docs/adr/0009-premium-surface-scope.md')

    expect(reviewIndex).toContain('ADR 0015')
    expect(reviewIndex).toContain('0015-hibp-reports-integrations-scope.md')
    expect(premiumAdr).toContain('ADR 0015')

    for (const doc of [
      currentState,
      compatibility,
      compatibilityMatrix,
      knownLimitations,
      threatModel,
    ]) {
      expect(doc).toContain('ADR 0015')
      expect(doc).toContain('GET /api/hibp/breach')
      expect(doc).toContain('501')
    }

    expect(compatibility).toContain('local client password-health')
    expect(knownLimitations).toContain('operator opt-in')
    expect(threatModel).toContain('third-party disclosure')
    expect(currentState).toContain('state-free')
    expect(compatibilityMatrix).not.toMatch(/HIBP live evidence/i)
  })
})

function read(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}

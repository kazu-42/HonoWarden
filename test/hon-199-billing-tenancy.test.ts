import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import app from '../src/app'
import { signAccessToken } from '../src/domain/tokens'
import { FakeD1Database } from './support/fake-d1'

const repoRoot = fileURLToPath(new URL('..', import.meta.url).toString())

const adrPath = 'docs/adr/0014-hosted-billing-licensing-tenancy.md'
const hostedCommerceMessage = 'This feature is unavailable on this server.'

const canceledSubscription = {
  status: 'canceled',
  cart: {
    passwordManager: {
      seats: {
        translationKey: 'premiumMembership',
        quantity: 0,
        cost: 0,
        discount: null,
      },
      additionalStorage: null,
    },
    secretsManager: null,
    cadence: 'annually',
    discount: null,
    estimatedTax: 0,
  },
  storage: null,
  cancelAt: null,
  canceled: null,
  nextCharge: null,
  suspension: null,
  gracePeriod: null,
} as const

const hostedOnlyRequests = [
  ['POST', '/api/account/billing/vnext/subscription'],
  ['POST', '/api/account/billing/vnext/premium/checkout'],
  ['POST', '/api/account/billing/vnext/portal-session'],
  ['GET', '/api/account/billing/vnext/payment-method'],
  ['GET', '/api/account/billing/vnext/credit'],
  ['GET', '/api/account/billing/vnext/license'],
  ['GET', '/api/account/billing/vnext/discounts'],
  ['POST', '/api/account/billing/vnext/subscription/reinstate'],
  ['PUT', '/api/account/billing/vnext/subscription/storage'],
  ['POST', '/api/account/billing/vnext/self-host/license'],
  ['GET', '/api/accounts/subscription'],
  ['GET', '/api/accounts/billing/history'],
  ['GET', '/api/accounts/billing/invoices'],
  ['POST', '/api/accounts/license'],
  ['POST', '/api/accounts/cancel'],
  ['GET', '/api/licenses/user/user-id'],
  ['GET', '/api/licenses/organization/org-id'],
  ['POST', '/api/organizations/licenses/self-hosted'],
  ['POST', '/api/organizations/licenses/self-hosted/org-id/sync'],
  ['GET', '/api/plans'],
  ['GET', '/api/plans/premium'],
  ['GET', '/api/organizations/org-id/billing'],
  ['GET', '/api/organizations/org-id/billing/vnext/payment-method'],
  ['GET', '/api/organizations/org-id/subscription'],
  ['GET', '/api/organizations/org-id/license'],
  ['GET', '/api/providers'],
  ['GET', '/api/providers/provider-id'],
  ['GET', '/api/providers/provider-id/billing/subscription'],
  ['POST', '/api/providers/provider-id/clients'],
  ['POST', '/api/organization/sponsorship/org-id/families-for-enterprise'],
  ['GET', '/api/organization/sponsorship/org-id/sync-status'],
  [
    'POST',
    '/api/organization/sponsorship/self-hosted/org-id/families-for-enterprise',
  ],
  ['POST', '/api/billing/preview-invoice/premium/subscriptions/purchase'],
] as const

describe('HON-199 hosted billing, licensing, provider, and tenancy boundary', () => {
  it('freezes implement, defer, and reject decisions in the ADR and docs', () => {
    expect(existsSync(join(repoRoot, adrPath)), `${adrPath} should exist`).toBe(
      true,
    )

    const adr = readRepoFile(adrPath)
    const compatibility = readRepoFile('docs/compatibility.md')
    const limitations = readRepoFile('docs/security/known-limitations.md')
    const threatModel = readRepoFile('docs/security/threat-model.md')
    const readme = readRepoFile('README.md')

    expect(adr.trim().length).toBeGreaterThan(1_000)
    expect(adr).toContain('## Status')
    expect(adr).toContain('Accepted')
    expect(adr).toContain('## Inventory')
    expect(adr).toContain('official-client startup')
    expect(adr).toContain('commercial cloud')
    expect(adr).toMatch(/\|\s*implement\s*\|/)
    expect(adr).toMatch(/\|\s*defer\s*\|/)
    expect(adr).toMatch(/\|\s*reject\s*\|/)
    expect(adr).toContain('GET /api/account/billing/vnext/subscription')
    expect(adr).toContain('status: "canceled"')
    expect(adr).toContain('HONOWARDEN_PREMIUM_FEATURES_ENABLED')
    expect(adr).toContain('premiumFromOrganization')
    expect(adr).toContain('providerOrganizations')
    expect(adr).toContain('cloudRegion')
    expect(adr).toContain('self-hosted')
    expect(adr).toContain('Stripe')
    expect(adr).toContain('license')
    expect(adr).toContain('provider')
    expect(adr).toContain('sponsorship')
    expect(adr).toContain('multi-tenant')
    expect(adr).toContain('security/compliance-gated children')
    expect(adr).toMatch(/cannot imply an active paid subscription/i)
    expect(adr).toContain('zero-cost')
    expect(adr).toContain('quantity: 0')
    expect(adr).toContain('cost: 0')
    expect(adr).toContain('nextCharge: null')

    for (const document of [adr, compatibility, limitations, threatModel]) {
      expect(document).toContain('ADR 0014')
      expect(document).toMatch(/hosted billing/i)
      expect(document).toMatch(/provider\/reseller/i)
      expect(document).toMatch(/multi-tenant/i)
    }

    expect(compatibility).toContain('/api/account/billing/vnext')
    expect(compatibility).toContain('/api/providers')
    expect(compatibility).toContain('/api/organization/sponsorship')
    expect(compatibility).toContain('/api/licenses')
    expect(compatibility).toContain('/api/plans')
    expect(limitations).toContain('canceled')
    expect(limitations).toContain('does not imply')
    expect(readme).toMatch(/hosted billing/i)
    expect(readme).toMatch(/commercial licensing/i)
    expect(readme).toContain('hosted multi-tenant service')
  })

  it('keeps the Android startup subscription truthful and unpaid even when premium is enabled', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const env = {
      DB: new FakeD1Database(null, [], { authUser: user }),
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
      HONOWARDEN_PREMIUM_FEATURES_ENABLED: 'true',
    }

    const unauthorized = await app.request(
      '/api/account/billing/vnext/subscription',
      {},
      { HONOWARDEN_TOKEN_SECRET: 'test-token-secret' },
    )
    expect(unauthorized.status).toBe(401)

    const response = await app.request(
      '/api/account/billing/vnext/subscription',
      { headers: { Authorization: `Bearer ${accessToken}` } },
      env,
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as typeof canceledSubscription
    expect(body).toEqual(canceledSubscription)
    expect(body.status).not.toMatch(/active|trialing|past_due|paid/i)
    expect(body.cart.passwordManager.seats.quantity).toBe(0)
    expect(body.cart.passwordManager.seats.cost).toBe(0)
    expect(body.cart.estimatedTax).toBe(0)
    expect(body.nextCharge).toBeNull()
    expect(body.storage).toBeNull()
    expect(body.cart.secretsManager).toBeNull()
  })

  it('returns explicit unsupported errors for inventoried hosted-only commerce surfaces', async () => {
    for (const [method, path] of hostedOnlyRequests) {
      const response = await app.request(path, {
        method,
        headers: { 'X-Request-Id': 'hosted-commerce-request' },
      })

      expect(response.status, `${method} ${path}`).toBe(501)
      expect(response.headers.get('Cache-Control'), `${method} ${path}`).toBe(
        'no-store',
      )
      await expect(response.json()).resolves.toEqual({
        Message: hostedCommerceMessage,
        error: {
          code: 'unsupported_feature',
          message: hostedCommerceMessage,
        },
        requestId: 'hosted-commerce-request',
      })
    }
  })

  it('does not advertise providers, paid entitlements, or a hosted region in startup metadata', async () => {
    const user = authUserRecord()
    const accessToken = await accessTokenFor(user)
    const env = {
      DB: new FakeD1Database(null, [], { authUser: user }),
      HONOWARDEN_TOKEN_SECRET: 'test-token-secret',
    }

    const [configResponse, profileResponse, syncResponse] = await Promise.all([
      app.request('/api/config'),
      app.request(
        '/api/accounts/profile',
        { headers: { Authorization: `Bearer ${accessToken}` } },
        env,
      ),
      app.request(
        '/api/sync',
        { headers: { Authorization: `Bearer ${accessToken}` } },
        env,
      ),
    ])

    expect(configResponse.status).toBe(200)
    expect(profileResponse.status).toBe(200)
    expect(syncResponse.status).toBe(200)

    const config = (await configResponse.json()) as {
      environment: { cloudRegion: string }
    }
    const profile = (await profileResponse.json()) as Record<string, unknown>
    const sync = (await syncResponse.json()) as {
      profile: Record<string, unknown>
    }

    expect(config.environment.cloudRegion).toBe('self-hosted')
    expect(profile.providers).toEqual([])
    expect(profile.providerOrganizations).toEqual([])
    expect(profile.premiumFromOrganization).toBe(false)
    expect(sync.profile.providers).toEqual([])
    expect(sync.profile.providerOrganizations).toEqual([])
    expect(sync.profile.premiumFromOrganization).toBe(false)
  })

  it('does not add billing, license, provider, or multi-tenant runtime', () => {
    const packageJson = JSON.parse(readRepoFile('package.json')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const wrangler = readRepoFile('wrangler.jsonc')
    const bindings = readRepoFile('src/bindings.ts')
    const migrationText = readdirSync(join(repoRoot, 'migrations'))
      .filter((entry) => entry.endsWith('.sql'))
      .map((entry) => readRepoFile(`migrations/${entry}`))
      .join('\n')

    const dependencyNames = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ]
    expect(dependencyNames.some((name) => /stripe/i.test(name))).toBe(false)
    expect(wrangler).not.toMatch(/stripe|braintree|bitpay|paypal/i)
    expect(bindings).not.toMatch(/STRIPE|BILLING_SECRET|LICENSE_SECRET/i)
    expect(migrationText).not.toMatch(
      /create table (subscriptions|licenses|providers|tenants|invoices)/i,
    )
  })
})

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}

function authUserRecord() {
  return {
    id: 'user-id',
    email: 'Person@Example.Test',
    emailNormalized: 'person@example.test',
    emailVerifiedAt: '2026-07-06T00:00:00.000Z',
    displayName: 'Person',
    kdfAlgorithm: 'pbkdf2-sha256',
    kdfIterations: 600000,
    kdfMemory: null,
    kdfParallelism: null,
    masterPasswordHash: 'synthetic-master-password-hash',
    userKey: '2.synthetic-user-key',
    publicKey: 'synthetic-public-key',
    privateKey: '2.synthetic-private-key',
    securityStamp: 'security-stamp',
    revisionDate: '2026-07-06T00:00:00.000Z',
    createdAt: '2026-07-06T00:00:00.000Z',
    disabledAt: null,
    loginFailedCount: 0,
    loginFailedAt: null,
    loginLockedUntil: null,
    totpEnabled: false,
    totpEncryptedSecret: null,
    totpLastAcceptedStep: null,
  }
}

async function accessTokenFor(
  user: Pick<
    ReturnType<typeof authUserRecord>,
    'emailNormalized' | 'id' | 'securityStamp'
  >,
) {
  return signAccessToken('test-token-secret', {
    sub: user.id,
    email: user.emailNormalized,
    device: 'fixture-device',
    securityStamp: user.securityStamp,
    iat: 1,
    exp: 4_102_444_800,
  })
}

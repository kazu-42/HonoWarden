import { readFileSync } from 'node:fs'

import { parse } from 'jsonc-parser'
import { describe, expect, it } from 'vitest'

type WranglerBinding = {
  binding: string
  database_id?: string
  database_name?: string
  bucket_name?: string
  remote?: boolean
}

type WranglerEnvironment = {
  name: string
  preview_urls: boolean
  workers_dev: boolean
  routes: Array<{
    pattern: string
    custom_domain: boolean
  }>
  triggers: {
    crons: string[]
  }
  logpush: boolean
  observability: {
    enabled: boolean
    head_sampling_rate: number
  }
  vars: Record<string, string>
  d1_databases: WranglerBinding[]
  r2_buckets: WranglerBinding[]
  version_metadata: {
    binding: string
  }
}

type WranglerConfig = {
  name: string
  preview_urls: boolean
  workers_dev: boolean
  triggers: {
    crons: string[]
  }
  logpush: boolean
  observability: {
    enabled: boolean
    head_sampling_rate: number
  }
  vars: Record<string, string>
  d1_databases: WranglerBinding[]
  r2_buckets: WranglerBinding[]
  version_metadata: {
    binding: string
  }
  env: {
    staging: WranglerEnvironment
    production: WranglerEnvironment
  }
}

const config = parse(readFileSync('wrangler.jsonc', 'utf8')) as WranglerConfig
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts?: Record<string, string>
}
const expectedHourlyCron = ['0 * * * *']

describe('wrangler configuration scopes', () => {
  it('declares the non-inheritable Worker version metadata binding in all scopes', () => {
    expect(config.version_metadata).toEqual({
      binding: 'CF_VERSION_METADATA',
    })
    expect(config.env.staging.version_metadata).toEqual({
      binding: 'CF_VERSION_METADATA',
    })
    expect(config.env.production.version_metadata).toEqual({
      binding: 'CF_VERSION_METADATA',
    })
  })

  it('disables public version preview URLs in all deployment scopes', () => {
    expect(config.preview_urls).toBe(false)
    expect(config.env.staging.preview_urls).toBe(false)
    expect(config.env.production.preview_urls).toBe(false)
  })

  it('publishes environment-specific vault custom domains without taking the website apex', () => {
    expect(config.env.staging.routes).toEqual([
      {
        pattern: 'vault-staging.honowarden.com',
        custom_domain: true,
      },
    ])
    expect(config.env.production.routes).toEqual([
      {
        pattern: 'vault.honowarden.com',
        custom_domain: true,
      },
    ])

    const deployablePatterns = [
      ...config.env.staging.routes,
      ...config.env.production.routes,
    ].map((route) => route.pattern)

    expect(new Set(deployablePatterns).size).toBe(deployablePatterns.length)
    expect(deployablePatterns).not.toContain('honowarden.com')
    expect(deployablePatterns).not.toContain('www.honowarden.com')
    expect(config.workers_dev).toBe(false)
    expect(config.env.staging.workers_dev).toBe(false)
    expect(config.env.production.workers_dev).toBe(false)
  })

  it('keeps runtime environment labels explicit', () => {
    expect(config.vars.HONOWARDEN_ENV).toBe('development')
    expect(config.env.staging.vars.HONOWARDEN_ENV).toBe('staging')
    expect(config.env.production.vars.HONOWARDEN_ENV).toBe('production')
  })

  it('keeps staging and production deploy targets separated by name', () => {
    expect(config.env.staging.name).not.toBe(config.env.production.name)
    expect(config.env.staging.name).not.toBe(config.name)
    expect(config.env.production.name).not.toBe(config.name)
  })

  it('keeps the default Wrangler identity on local resources', () => {
    expect(config.name).toBe('honowarden-local')
    expect(config.workers_dev).toBe(false)
    expect(config.env.staging.workers_dev).toBe(false)
    expect(config.env.production.workers_dev).toBe(false)
    const localD1 = findBinding(config.d1_databases, 'DB')
    const localInquiryD1 = findBinding(config.d1_databases, 'INQUIRY_DB')

    expect(localD1).toMatchObject({
      database_name: 'honowarden-local',
      database_id: '00000000-0000-0000-0000-000000000001',
    })
    expect(localInquiryD1).toMatchObject({
      database_name: 'honowarden-inquiry-local',
      database_id: '00000000-0000-0000-0000-000000000002',
    })
    expect(config.r2_buckets).toEqual([
      {
        binding: 'VAULT_OBJECTS',
        bucket_name: 'honowarden-local-vault-objects',
      },
    ])
    expect(localD1?.remote).not.toBe(true)
    expect(localInquiryD1?.remote).not.toBe(true)
    expect(config.r2_buckets[0]?.remote).not.toBe(true)
    expect(packageJson.scripts?.['db:migrate:local']).toBe(
      'wrangler d1 migrations apply DB --local',
    )
    expect(packageJson.scripts?.dev).toBe('node scripts/honowarden-dev.mjs')
  })

  it('keeps staging and production storage names separated', () => {
    expect(config.env.staging.d1_databases).toHaveLength(2)
    expect(config.env.production.d1_databases).toHaveLength(2)
    expect(config.env.staging.r2_buckets).toHaveLength(1)
    expect(config.env.production.r2_buckets).toHaveLength(1)

    const stagingD1 = findBinding(config.env.staging.d1_databases, 'DB')
    const productionD1 = findBinding(config.env.production.d1_databases, 'DB')
    const stagingInquiryD1 = findBinding(
      config.env.staging.d1_databases,
      'INQUIRY_DB',
    )
    const productionInquiryD1 = findBinding(
      config.env.production.d1_databases,
      'INQUIRY_DB',
    )
    const stagingR2 = config.env.staging.r2_buckets[0]
    const productionR2 = config.env.production.r2_buckets[0]

    if (
      !stagingD1 ||
      !productionD1 ||
      !stagingInquiryD1 ||
      !productionInquiryD1 ||
      !stagingR2 ||
      !productionR2
    ) {
      throw new Error('Expected staging and production storage bindings')
    }

    expect(stagingD1.database_name).not.toBe(productionD1.database_name)
    expect(stagingInquiryD1.database_name).not.toBe(
      productionInquiryD1.database_name,
    )
    expect(stagingInquiryD1.database_name).not.toBe(stagingD1.database_name)
    expect(productionInquiryD1.database_name).not.toBe(
      productionD1.database_name,
    )
    expect(stagingR2.bucket_name).not.toBe(productionR2.bucket_name)
  })

  it('keeps tracked staging and production D1 ids real and separated', () => {
    const stagingD1 = findBinding(config.env.staging.d1_databases, 'DB')
    const productionD1 = findBinding(config.env.production.d1_databases, 'DB')
    const stagingInquiryD1 = findBinding(
      config.env.staging.d1_databases,
      'INQUIRY_DB',
    )
    const productionInquiryD1 = findBinding(
      config.env.production.d1_databases,
      'INQUIRY_DB',
    )
    const placeholder = '00000000-0000-0000-0000-000000000000'

    if (
      !stagingD1 ||
      !productionD1 ||
      !stagingInquiryD1 ||
      !productionInquiryD1
    ) {
      throw new Error('Expected staging and production D1 bindings')
    }

    expect(stagingD1.database_id).not.toBe(placeholder)
    expect(productionD1.database_id).not.toBe(placeholder)
    expect(stagingInquiryD1.database_id).not.toBe(placeholder)
    expect(productionInquiryD1.database_id).not.toBe(placeholder)
    expect(stagingD1.database_id).not.toBe(productionD1.database_id)
    expect(stagingInquiryD1.database_id).not.toBe(
      productionInquiryD1.database_id,
    )
    expect(stagingInquiryD1.database_id).not.toBe(stagingD1.database_id)
    expect(productionInquiryD1.database_id).not.toBe(productionD1.database_id)
  })

  it('keeps tracked staging and production bootstrap defaults fail-closed', () => {
    expect(config.env.staging.vars.HONOWARDEN_BOOTSTRAP_ENABLED).toBe('false')
    expect(config.env.production.vars.HONOWARDEN_BOOTSTRAP_ENABLED).toBe(
      'false',
    )
  })

  it('configures top-level scheduled cleanup cron for UTC hourly', () => {
    expect(config.triggers.crons).toEqual(expectedHourlyCron)
  })

  it('configures staging scheduled cleanup cron for UTC hourly', () => {
    expect(config.env.staging.triggers.crons).toEqual(expectedHourlyCron)
  })

  it('configures production scheduled cleanup cron for UTC hourly', () => {
    expect(config.env.production.triggers.crons).toEqual(expectedHourlyCron)
  })

  it('keeps audit logging opt-in across tracked scopes', () => {
    expect(config.vars.HONOWARDEN_AUDIT_LOGS).toBe('false')
    expect(config.env.staging.vars.HONOWARDEN_AUDIT_LOGS).toBe('false')
    expect(config.env.production.vars.HONOWARDEN_AUDIT_LOGS).toBe('false')
  })

  it('keeps refresh-token retention staged and disabled by default', () => {
    expect(config.vars.HONOWARDEN_REFRESH_TOKEN_RETENTION_ENABLED).toBe('false')
    expect(
      config.env.staging.vars.HONOWARDEN_REFRESH_TOKEN_RETENTION_ENABLED,
    ).toBe('true')
    expect(
      config.env.production.vars.HONOWARDEN_REFRESH_TOKEN_RETENTION_ENABLED,
    ).toBe('false')
  })

  it('keeps WebAuthn disabled in every tracked environment', () => {
    expect(config.vars.HONOWARDEN_WEBAUTHN_ENABLED).toBe('false')
    expect(config.env.staging.vars.HONOWARDEN_WEBAUTHN_ENABLED).toBe('false')
    expect(config.env.production.vars.HONOWARDEN_WEBAUTHN_ENABLED).toBe('false')
  })

  it('keeps irreversible KDF mutation disabled in every tracked environment', () => {
    expect(config.vars.HONOWARDEN_KDF_MUTATION_ENABLED).toBe('false')
    expect(config.env.staging.vars.HONOWARDEN_KDF_MUTATION_ENABLED).toBe(
      'false',
    )
    expect(config.env.production.vars.HONOWARDEN_KDF_MUTATION_ENABLED).toBe(
      'false',
    )
  })

  it('keeps password change disabled in every tracked environment', () => {
    expect(config.vars.HONOWARDEN_PASSWORD_CHANGE_ENABLED).toBe('false')
    expect(config.env.staging.vars.HONOWARDEN_PASSWORD_CHANGE_ENABLED).toBe(
      'false',
    )
    expect(config.env.production.vars.HONOWARDEN_PASSWORD_CHANGE_ENABLED).toBe(
      'false',
    )
  })

  it('keeps account-key initialization disabled in every tracked environment', () => {
    expect(config.vars.HONOWARDEN_ACCOUNT_KEYS_ENABLED).toBe('false')
    expect(config.env.staging.vars.HONOWARDEN_ACCOUNT_KEYS_ENABLED).toBe(
      'false',
    )
    expect(config.env.production.vars.HONOWARDEN_ACCOUNT_KEYS_ENABLED).toBe(
      'false',
    )
  })

  it('keeps account lifecycle mutation disabled in every tracked environment', () => {
    expect(config.vars.HONOWARDEN_ACCOUNT_LIFECYCLE_ENABLED).toBe('false')
    expect(config.env.staging.vars.HONOWARDEN_ACCOUNT_LIFECYCLE_ENABLED).toBe(
      'false',
    )
    expect(
      config.env.production.vars.HONOWARDEN_ACCOUNT_LIFECYCLE_ENABLED,
    ).toBe('false')
  })

  it('keeps user-key rotation disabled in every tracked environment', () => {
    expect(config.vars.HONOWARDEN_USER_KEY_ROTATION_ENABLED).toBe('false')
    expect(config.env.staging.vars.HONOWARDEN_USER_KEY_ROTATION_ENABLED).toBe(
      'false',
    )
    expect(
      config.env.production.vars.HONOWARDEN_USER_KEY_ROTATION_ENABLED,
    ).toBe('false')
  })

  it('enables premium features only in staging by default', () => {
    expect(config.vars.HONOWARDEN_PREMIUM_FEATURES_ENABLED).toBe('false')
    expect(config.env.staging.vars.HONOWARDEN_PREMIUM_FEATURES_ENABLED).toBe(
      'true',
    )
    expect(config.env.production.vars.HONOWARDEN_PREMIUM_FEATURES_ENABLED).toBe(
      'false',
    )
  })

  it('keeps Workers Logpush and observability enabled for tracked scopes', () => {
    expect(config.logpush).toBe(true)
    expect(config.env.staging.logpush).toBe(true)
    expect(config.env.production.logpush).toBe(true)

    expect(config.observability).toMatchObject({
      enabled: true,
      head_sampling_rate: 1,
    })
    expect(config.env.staging.observability).toMatchObject({
      enabled: true,
      head_sampling_rate: 1,
    })
    expect(config.env.production.observability).toMatchObject({
      enabled: true,
      head_sampling_rate: 1,
    })
  })
})

function findBinding(
  bindings: WranglerBinding[],
  bindingName: string,
): WranglerBinding | undefined {
  return bindings.find((binding) => binding.binding === bindingName)
}

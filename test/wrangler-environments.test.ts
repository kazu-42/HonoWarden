import { readFileSync } from 'node:fs'

import { parse } from 'jsonc-parser'
import { describe, expect, it } from 'vitest'

type WranglerBinding = {
  binding: string
  database_id?: string
  database_name?: string
  bucket_name?: string
}

type WranglerEnvironment = {
  name: string
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
}

type WranglerConfig = {
  name: string
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
  env: {
    staging: WranglerEnvironment
    production: WranglerEnvironment
  }
}

const config = parse(readFileSync('wrangler.jsonc', 'utf8')) as WranglerConfig
const expectedHourlyCron = ['0 * * * *']

describe('wrangler deployment environments', () => {
  it('keeps runtime environment labels explicit', () => {
    expect(config.vars.HONOWARDEN_ENV).toBe('development')
    expect(config.env.staging.vars.HONOWARDEN_ENV).toBe('staging')
    expect(config.env.production.vars.HONOWARDEN_ENV).toBe('production')
  })

  it('keeps staging and production deploy targets separated by name', () => {
    expect(config.env.staging.name).not.toBe(config.env.production.name)
    expect(config.env.staging.name).not.toBe(config.name)
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

  it('uses real separated D1 database ids for deployable environments', () => {
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

  it('keeps deployable environment bootstrap defaults fail-closed', () => {
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

  it('keeps audit logging opt-in across deployable environments', () => {
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

  it('keeps Workers Logpush and observability enabled for deployable environments', () => {
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

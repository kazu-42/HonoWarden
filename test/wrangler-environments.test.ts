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
  vars: Record<string, string>
  d1_databases: WranglerBinding[]
  r2_buckets: WranglerBinding[]
}

type WranglerConfig = {
  name: string
  triggers: {
    crons: string[]
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
    expect(config.env.staging.d1_databases).toHaveLength(1)
    expect(config.env.production.d1_databases).toHaveLength(1)
    expect(config.env.staging.r2_buckets).toHaveLength(1)
    expect(config.env.production.r2_buckets).toHaveLength(1)

    const stagingD1 = config.env.staging.d1_databases[0]
    const productionD1 = config.env.production.d1_databases[0]
    const stagingR2 = config.env.staging.r2_buckets[0]
    const productionR2 = config.env.production.r2_buckets[0]

    if (!stagingD1 || !productionD1 || !stagingR2 || !productionR2) {
      throw new Error('Expected staging and production storage bindings')
    }

    expect(stagingD1.database_name).not.toBe(productionD1.database_name)
    expect(stagingR2.bucket_name).not.toBe(productionR2.bucket_name)
  })

  it('uses real separated D1 database ids for deployable environments', () => {
    const stagingD1 = config.env.staging.d1_databases[0]
    const productionD1 = config.env.production.d1_databases[0]
    const placeholder = '00000000-0000-0000-0000-000000000000'

    if (!stagingD1 || !productionD1) {
      throw new Error('Expected staging and production D1 bindings')
    }

    expect(stagingD1.database_id).not.toBe(placeholder)
    expect(productionD1.database_id).not.toBe(placeholder)
    expect(stagingD1.database_id).not.toBe(productionD1.database_id)
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
})

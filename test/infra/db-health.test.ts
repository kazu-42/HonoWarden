import { describe, expect, it } from 'vitest'

import { getDatabaseHealth } from '../../src/infra/db-health'
import { FakeD1Database, requiredTables } from '../support/fake-d1'

describe('getDatabaseHealth', () => {
  it('returns ok when the schema metadata and required tables exist', async () => {
    const health = await getDatabaseHealth(
      new FakeD1Database('0001', [...requiredTables]),
    )

    expect(health).toEqual({
      ok: true,
      schemaVersion: '0001',
      requiredTables,
    })
  })

  it('returns an error when migration metadata is missing', async () => {
    const health = await getDatabaseHealth(
      new FakeD1Database(null, [...requiredTables]),
    )

    expect(health).toEqual({
      ok: false,
      code: 'schema_version_missing',
      message: 'Database schema metadata was not found.',
    })
  })

  it('returns an error when a required table is missing', async () => {
    const health = await getDatabaseHealth(
      new FakeD1Database(
        '0001',
        requiredTables.filter((name) => name !== 'ciphers'),
      ),
    )

    expect(health).toEqual({
      ok: false,
      code: 'required_tables_missing',
      message: 'Database schema is missing required tables.',
      missingTables: ['ciphers'],
    })
  })

  it('fails readiness when the credential wrapper history migration is missing', async () => {
    const health = await getDatabaseHealth(
      new FakeD1Database(
        '0016',
        requiredTables.filter(
          (name) => name !== 'user_key_rotation_wrapper_history',
        ),
      ),
    )

    expect(health).toEqual({
      ok: false,
      code: 'required_tables_missing',
      message: 'Database schema is missing required tables.',
      missingTables: ['user_key_rotation_wrapper_history'],
    })
  })
})

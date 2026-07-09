import { describe, expect, it } from 'vitest'

import {
  getDomainSettingsForUser,
  updateDomainSettingsForUser,
} from '../../src/repositories/domain-settings-repository'

const fakeMeta = {
  duration: 0,
  size_after: 0,
  rows_read: 1,
  rows_written: 1,
  last_row_id: 1,
  changed_db: true,
  changes: 1,
} satisfies D1Meta & Record<string, unknown>

describe('domain settings repository', () => {
  it('reads owner-scoped custom equivalent domain groups from the user row', async () => {
    const database = new RecordingDomainSettingsD1Database({
      equivalentDomainsJson: JSON.stringify([
        ['example.com', 'example.net'],
        ['service.test', 'login.service.test'],
      ]),
      excludedGlobalEquivalentDomainsJson: JSON.stringify([1, 2]),
    })

    await expect(
      getDomainSettingsForUser(database, 'user-id'),
    ).resolves.toEqual({
      equivalentDomains: [
        ['example.com', 'example.net'],
        ['service.test', 'login.service.test'],
      ],
      excludedGlobalEquivalentDomains: [1, 2],
    })
    expect(database.boundValues).toEqual(['user-id'])
    expect(database.queries.join('\n')).toContain('FROM users')
    expect(database.queries.join('\n')).toContain('disabled_at IS NULL')
  })

  it('returns empty domain settings for users without configured metadata', async () => {
    const database = new RecordingDomainSettingsD1Database({
      equivalentDomainsJson: null,
      excludedGlobalEquivalentDomainsJson: null,
    })

    await expect(
      getDomainSettingsForUser(database, 'user-id'),
    ).resolves.toEqual({
      equivalentDomains: [],
      excludedGlobalEquivalentDomains: [],
    })
  })

  it('updates custom equivalent domains atomically on the owner user row', async () => {
    const database = new RecordingDomainSettingsD1Database(null, {
      updateChanges: 1,
    })

    await expect(
      updateDomainSettingsForUser(database, {
        userId: 'user-id',
        equivalentDomains: [['example.com', 'example.net']],
        excludedGlobalEquivalentDomains: [],
        revisionDate: '2026-07-10T00:00:00.000Z',
      }),
    ).resolves.toEqual({
      status: 'updated',
      settings: {
        equivalentDomains: [['example.com', 'example.net']],
        excludedGlobalEquivalentDomains: [],
      },
      revisionDate: '2026-07-10T00:00:00.000Z',
    })
    expect(database.boundValues).toContain(
      JSON.stringify([['example.com', 'example.net']]),
    )
    expect(database.boundValues).toContain(JSON.stringify([]))
    expect(database.boundValues).toContain('2026-07-10T00:00:00.000Z')
    expect(database.boundValues).toContain('user-id')
    expect(database.queries.join('\n')).toContain('UPDATE users')
    expect(database.queries.join('\n')).toContain('disabled_at IS NULL')
  })

  it('returns not found for missing, disabled, or cross-user updates', async () => {
    const database = new RecordingDomainSettingsD1Database(null, {
      updateChanges: 0,
    })

    await expect(
      updateDomainSettingsForUser(database, {
        userId: 'user-id',
        equivalentDomains: [],
        excludedGlobalEquivalentDomains: [],
        revisionDate: '2026-07-10T00:00:00.000Z',
      }),
    ).resolves.toEqual({ status: 'not_found' })
  })
})

class RecordingDomainSettingsD1Database {
  boundValues: unknown[] = []
  queries: string[] = []

  constructor(
    private readonly row: unknown,
    private readonly options: { updateChanges?: number } = {},
  ) {}

  prepare(query: string): D1PreparedStatement {
    this.queries.push(query)
    const pushValues = (values: unknown[]) => {
      this.boundValues.push(...values)
    }
    const getRow = () => this.row
    const getOptions = () => this.options

    const statement = {
      bind(...values: unknown[]) {
        pushValues(values)
        return statement
      },
      async first<T = unknown>(): Promise<T | null> {
        return getRow() as T | null
      },
      async all<T = unknown>(): Promise<D1Result<T>> {
        return {
          success: true,
          results: [],
          meta: fakeMeta,
        }
      },
      async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        return {
          success: true,
          results: [],
          meta: {
            ...fakeMeta,
            changes: getOptions().updateChanges ?? 1,
          },
        }
      },
      async raw<T = unknown>(): Promise<T[]> {
        return []
      },
    } as D1PreparedStatement

    return statement
  }
}

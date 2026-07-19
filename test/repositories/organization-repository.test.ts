import { describe, expect, it } from 'vitest'

import { updateOrganizationCollection } from '../../src/repositories/organization-repository'

const fakeMeta = {
  duration: 0,
  size_after: 0,
  rows_read: 0,
  rows_written: 1,
  last_row_id: 1,
  changed_db: true,
  changes: 1,
} satisfies D1Meta & Record<string, unknown>

describe('updateOrganizationCollection', () => {
  it('preserves an omitted external ID inside the atomic update', async () => {
    const database = new RecordingOrganizationDatabase()

    await expect(
      updateOrganizationCollection(database, {
        id: 'collection-id',
        organizationId: 'organization-id',
        userId: 'owner-user-id',
        encryptedName: '2.renamed-collection',
        externalId: undefined,
        now: '2026-07-16T00:10:00.000Z',
      }),
    ).resolves.toMatchObject({
      id: 'collection-id',
      externalId: 'existing-external-id',
    })

    const collectionUpdate = database.statements.find((statement) =>
      statement.query.includes('UPDATE collections'),
    )
    expect(collectionUpdate?.query).toContain(
      'external_id = CASE WHEN ? = 1 THEN ? ELSE external_id END',
    )
    expect(collectionUpdate?.values.slice(0, 3)).toEqual([
      '2.renamed-collection',
      0,
      null,
    ])
  })
})

type RecordedStatement = {
  query: string
  values: unknown[]
}

class RecordingOrganizationDatabase {
  readonly statements: RecordedStatement[] = []

  prepare(query: string): D1PreparedStatement {
    const recorded = { query, values: [] as unknown[] }
    this.statements.push(recorded)

    const statement = {
      bind(...values: unknown[]) {
        recorded.values = values
        return statement
      },
      async first<T = unknown>(): Promise<T | null> {
        return collectionRecord() as T
      },
      async all<T = unknown>(): Promise<D1Result<T>> {
        return result<T>()
      },
      async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        return result<T>()
      },
      async raw<T = unknown>(): Promise<T[]> {
        return []
      },
    } as D1PreparedStatement

    return statement
  }

  async batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    return statements.map(() => result<T>())
  }
}

function result<T>(): D1Result<T> {
  return {
    success: true,
    results: [],
    meta: fakeMeta,
  }
}

function collectionRecord() {
  return {
    id: 'collection-id',
    organizationId: 'organization-id',
    encryptedName: '2.renamed-collection',
    externalId: 'existing-external-id',
    readOnly: false,
    hidePasswords: false,
    manage: true,
    type: 0,
    revisionDate: '2026-07-16T00:10:00.000Z',
  }
}

const fakeMeta = {
  duration: 0,
  size_after: 0,
  rows_read: 0,
  rows_written: 0,
  last_row_id: 0,
  changed_db: false,
  changes: 0,
} satisfies D1Meta & Record<string, unknown>

type FakeD1DatabaseOptions = {
  userInsertChanges?: number
}

export class FakeD1Database {
  constructor(
    private readonly schemaVersion: string | null,
    private readonly tables: readonly string[],
    private readonly options: FakeD1DatabaseOptions = {},
  ) {}

  prepare(query: string): D1PreparedStatement {
    const schemaVersion = this.schemaVersion
    const tables = this.tables
    const options = this.options

    const statement = {
      bind() {
        return statement
      },
      async first<T = unknown>(column?: string): Promise<T | null> {
        if (query.includes('FROM schema_migrations')) {
          if (!schemaVersion) {
            return null
          }

          const row = {
            version: schemaVersion,
            appliedAt: '2026-07-06T00:00:00.000Z',
          }

          return (column ? row[column as keyof typeof row] : row) as T
        }

        return null
      },
      async all<T = unknown>(): Promise<D1Result<T>> {
        if (query.includes('sqlite_master')) {
          return {
            success: true,
            results: tables.map((name) => ({ name }) as T),
            meta: fakeMeta,
          }
        }

        return {
          success: true,
          results: [],
          meta: fakeMeta,
        }
      },
      async run(): Promise<D1Result> {
        if (query.includes('INSERT OR IGNORE INTO users')) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: options.userInsertChanges ?? 1,
            },
          }
        }

        return { success: true, results: [], meta: fakeMeta }
      },
      async raw<T = unknown>(): Promise<T[]> {
        return []
      },
    } as D1PreparedStatement

    return statement
  }
}

export const requiredTables = [
  'schema_migrations',
  'users',
  'devices',
  'refresh_tokens',
  'folders',
  'ciphers',
] as const

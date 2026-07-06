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
  authUser?: Record<string, unknown> | null
  cipherInsertChanges?: number
  ciphers?: Record<string, unknown>[]
  folder?: Record<string, unknown> | null
  folderDeleteChanges?: number
  folders?: Record<string, unknown>[]
  folderUpdateChanges?: number
  refreshSession?: Record<string, unknown> | null
  refreshRotationChanges?: number
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
        if (query.includes('FROM refresh_tokens')) {
          return (options.refreshSession ?? null) as T | null
        }

        if (query.includes('FROM folders')) {
          return (options.folder ?? null) as T | null
        }

        if (query.includes('FROM users')) {
          return (options.authUser ?? null) as T | null
        }

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
        if (query.includes('FROM ciphers')) {
          return {
            success: true,
            results: (options.ciphers ?? []) as T[],
            meta: fakeMeta,
          }
        }

        if (query.includes('FROM folders')) {
          return {
            success: true,
            results: (options.folders ?? []) as T[],
            meta: fakeMeta,
          }
        }

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

        if (query.includes('INSERT INTO ciphers')) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: options.cipherInsertChanges ?? 1,
            },
          }
        }

        if (query.includes('INSERT INTO folders')) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: 1,
            },
          }
        }

        if (/UPDATE\s+folders/.test(query)) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: query.includes('deleted_at = ?')
                ? (options.folderDeleteChanges ?? 1)
                : (options.folderUpdateChanges ?? 1),
            },
          }
        }

        if (/UPDATE\s+refresh_tokens/.test(query)) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: options.refreshRotationChanges ?? 1,
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

  async batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    return statements.map(() => ({
      success: true,
      results: [],
      meta: fakeMeta,
    }))
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

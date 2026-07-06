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
  authAttemptCount?: number
  lockedAccountFailureBucket?: boolean
  lockedIpFailureBucket?: boolean
  authUser?: Record<string, unknown> | null
  userTotp?: Record<string, unknown> | null
  totpChallenge?: Record<string, unknown> | null
  cipher?: Record<string, unknown> | null
  cipherInsertChanges?: number
  cipherPermanentDeleteChanges?: number
  cipherRestoreChanges?: number
  cipherSoftDeleteChanges?: number
  cipherUpdateChanges?: number
  ciphers?: Record<string, unknown>[]
  deviceRevokeChanges?: number
  folder?: Record<string, unknown> | null
  folderDeleteChanges?: number
  folders?: Record<string, unknown>[]
  folderUpdateChanges?: number
  refreshSession?: Record<string, unknown> | null
  refreshRotationChanges?: number
  userInsertChanges?: number
  userTotpInsertChanges?: number
  userTotpUpdateChanges?: number
  totpChallengeInsertChanges?: number
  totpChallengeUpdateChanges?: number
}

export class FakeD1Database {
  readonly deletedAuthFailureBucketKeys: string[] = []

  private readonly authFailureBuckets = new Map<
    string,
    Record<string, unknown>
  >()

  constructor(
    private readonly schemaVersion: string | null,
    private readonly tables: readonly string[],
    private readonly options: FakeD1DatabaseOptions = {},
  ) {}

  prepare(query: string): D1PreparedStatement {
    const schemaVersion = this.schemaVersion
    const tables = this.tables
    const options = this.options
    const authFailureBuckets = this.authFailureBuckets
    const deletedAuthFailureBucketKeys = this.deletedAuthFailureBucketKeys
    let boundValues: unknown[] = []

    const statement = {
      bind(...values: unknown[]) {
        boundValues = values
        return statement
      },
      async first<T = unknown>(column?: string): Promise<T | null> {
        if (query.includes('FROM auth_failure_buckets')) {
          const bucketKey = String(boundValues[0] ?? '')
          const lockedUntil = '2999-01-01T00:00:00.000Z'

          if (bucketKey.startsWith('ip:') && options.lockedIpFailureBucket) {
            return {
              bucketKey,
              failedCount: 20,
              windowStartedAt: '2026-07-06T00:00:00.000Z',
              lockedUntil,
              updatedAt: '2026-07-06T00:00:00.000Z',
            } as T
          }

          if (
            bucketKey.startsWith('account:') &&
            options.lockedAccountFailureBucket
          ) {
            return {
              bucketKey,
              failedCount: 5,
              windowStartedAt: '2026-07-06T00:00:00.000Z',
              lockedUntil,
              updatedAt: '2026-07-06T00:00:00.000Z',
            } as T
          }

          return (authFailureBuckets.get(bucketKey) ?? null) as T | null
        }

        if (query.includes('COUNT(*) as count')) {
          const row = {
            count: options.authAttemptCount ?? 0,
          }

          return (column ? row[column as keyof typeof row] : row) as T
        }

        if (query.includes('FROM refresh_tokens')) {
          return (options.refreshSession ?? null) as T | null
        }

        if (query.includes('FROM folders')) {
          return (options.folder ?? null) as T | null
        }

        if (query.includes('FROM ciphers')) {
          return (options.cipher ?? null) as T | null
        }

        if (query.includes('FROM user_totp')) {
          return (options.userTotp ?? null) as T | null
        }

        if (query.includes('FROM totp_challenges')) {
          return (options.totpChallenge ?? null) as T | null
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

        if (query.includes('INSERT INTO user_totp')) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: options.userTotpInsertChanges ?? 1,
            },
          }
        }

        if (query.includes('INSERT INTO totp_challenges')) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: options.totpChallengeInsertChanges ?? 1,
            },
          }
        }

        if (/DELETE\s+FROM\s+ciphers/.test(query)) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: options.cipherPermanentDeleteChanges ?? 1,
            },
          }
        }

        if (/UPDATE\s+ciphers/.test(query)) {
          let changes = options.cipherUpdateChanges ?? 1

          if (query.includes('deleted_at = NULL')) {
            changes = options.cipherRestoreChanges ?? 1
          } else if (query.includes('deleted_at = ?')) {
            changes = options.cipherSoftDeleteChanges ?? 1
          }

          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes,
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

        if (/UPDATE\s+users/.test(query)) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: 1,
            },
          }
        }

        if (/UPDATE\s+user_totp/.test(query)) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: options.userTotpUpdateChanges ?? 1,
            },
          }
        }

        if (/UPDATE\s+totp_challenges/.test(query)) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: options.totpChallengeUpdateChanges ?? 1,
            },
          }
        }

        if (query.includes('INSERT INTO auth_attempts')) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: 1,
            },
          }
        }

        if (query.includes('INSERT INTO auth_failure_buckets')) {
          const bucketKey = String(boundValues[0])
          const now = String(boundValues[1])
          const firstFailureLockedUntil = boundValues[2] as string | null
          const windowThreshold = String(boundValues[4])
          const failureLimit = Number(boundValues[7])
          const lockedUntil = String(boundValues[8])
          const existing = authFailureBuckets.get(bucketKey)
          const existingWindowStartedAt =
            typeof existing?.windowStartedAt === 'string'
              ? existing.windowStartedAt
              : null
          const insideWindow =
            existingWindowStartedAt !== null &&
            existingWindowStartedAt >= windowThreshold
          const failedCount = insideWindow
            ? Number(existing?.failedCount ?? 0) + 1
            : 1
          const nextLockedUntil =
            failedCount >= failureLimit ? lockedUntil : firstFailureLockedUntil

          authFailureBuckets.set(bucketKey, {
            bucketKey,
            failedCount,
            windowStartedAt: insideWindow ? existingWindowStartedAt : now,
            lockedUntil: nextLockedUntil,
            updatedAt: now,
          })

          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: 1,
            },
          }
        }

        if (/DELETE\s+FROM\s+auth_failure_buckets/.test(query)) {
          const bucketKey = String(boundValues[0])

          authFailureBuckets.delete(bucketKey)
          deletedAuthFailureBucketKeys.push(bucketKey)

          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: 1,
            },
          }
        }

        if (
          /UPDATE\s+devices/.test(query) &&
          query.includes('revoked_at = ?')
        ) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: options.deviceRevokeChanges ?? 1,
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
  'auth_attempts',
  'auth_failure_buckets',
  'folders',
  'ciphers',
  'user_totp',
  'totp_challenges',
] as const

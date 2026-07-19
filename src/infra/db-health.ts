export const requiredSchemaTables = [
  'schema_migrations',
  'users',
  'devices',
  'refresh_tokens',
  'auth_attempts',
  'auth_failure_buckets',
  'request_quota_buckets',
  'folders',
  'ciphers',
  'cipher_attachments',
  'audit_events',
  'user_totp',
  'totp_challenges',
  'organizations',
  'organization_users',
  'collections',
  'collection_users',
  'collection_ciphers',
] as const

export type DatabaseHealth =
  | {
      ok: true
      schemaVersion: string
      requiredTables: readonly string[]
    }
  | {
      ok: false
      code:
        | 'schema_version_missing'
        | 'required_tables_missing'
        | 'database_unavailable'
      message: string
      missingTables?: string[]
    }

type SchemaMigrationRow = {
  version: string
  appliedAt: string
}

type TableNameRow = {
  name: string
}

type DatabaseHealthClient = Pick<D1Database, 'prepare'>

export async function getDatabaseHealth(
  database: DatabaseHealthClient,
): Promise<DatabaseHealth> {
  try {
    const latestMigration = await database
      .prepare(
        `
          SELECT version, applied_at as appliedAt
          FROM schema_migrations
          ORDER BY version DESC
          LIMIT 1
        `,
      )
      .first<SchemaMigrationRow>()

    if (!latestMigration?.version) {
      return {
        ok: false,
        code: 'schema_version_missing',
        message: 'Database schema metadata was not found.',
      }
    }

    const tableRows = await database
      .prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
        `,
      )
      .all<TableNameRow>()

    const existingTables = new Set(
      (tableRows.results ?? []).map((row) => row.name),
    )
    const missingTables = requiredSchemaTables.filter(
      (tableName) => !existingTables.has(tableName),
    )

    if (missingTables.length > 0) {
      return {
        ok: false,
        code: 'required_tables_missing',
        message: 'Database schema is missing required tables.',
        missingTables,
      }
    }

    return {
      ok: true,
      schemaVersion: latestMigration.version,
      requiredTables: requiredSchemaTables,
    }
  } catch {
    return {
      ok: false,
      code: 'database_unavailable',
      message: 'Database health check failed.',
    }
  }
}

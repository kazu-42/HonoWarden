import type { AuditEvent } from '../domain/audit'

type AuditEventDatabase = Pick<D1Database, 'prepare'>

export const auditEventRetentionPolicy = {
  retentionDays: 365,
  maxRowsPerCleanup: 100,
} as const

export type PersistAuditEventResult = {
  id: string
}

export type CleanupExpiredAuditEventsInput = {
  expiredBefore: string
  limit: number
}

export async function persistAuditEvent(
  database: AuditEventDatabase,
  event: AuditEvent,
): Promise<PersistAuditEventResult> {
  const id = crypto.randomUUID()

  await database
    .prepare(
      `
        INSERT INTO audit_events (
          id,
          schema_version,
          name,
          outcome,
          request_id,
          occurred_at,
          actor_user_id,
          actor_device_identifier,
          target_type,
          target_id,
          context_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      id,
      event.schemaVersion,
      event.name,
      event.outcome,
      event.requestId,
      event.occurredAt,
      event.actor?.userId ?? null,
      event.actor?.deviceIdentifier ?? null,
      event.target?.type ?? null,
      event.target?.id ?? null,
      event.context ? JSON.stringify(event.context) : null,
    )
    .run()

  return { id }
}

export async function cleanupExpiredAuditEvents(
  database: AuditEventDatabase,
  input: CleanupExpiredAuditEventsInput,
): Promise<number> {
  const result = await database
    .prepare(
      `
        DELETE FROM audit_events
        WHERE id IN (
          SELECT id
          FROM audit_events
          WHERE occurred_at < ?
          ORDER BY occurred_at ASC, id ASC
          LIMIT ?
        )
      `,
    )
    .bind(input.expiredBefore, input.limit)
    .run()

  return result.meta.changes
}

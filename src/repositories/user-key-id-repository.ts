import type { AuditEvent } from '../domain/audit'

export async function registerUserKeyId(
  database: Pick<D1Database, 'prepare' | 'batch'>,
  input: {
    userId: string
    userKeyId: string
    expectedUserKey: string
    expectedSecurityStamp: string
    expectedRevisionDate: string
    nextRevisionDate: string
    auditEvent: AuditEvent
  },
): Promise<boolean> {
  const event = input.auditEvent
  const results = await database.batch([
    database
      .prepare(
        `
      UPDATE users SET user_key_id = ?, revision_date = ?, updated_at = ?
      WHERE id = ? AND disabled_at IS NULL AND user_key_id IS NULL
        AND user_key = ? AND security_stamp = ? AND revision_date = ?
    `,
      )
      .bind(
        input.userKeyId,
        input.nextRevisionDate,
        input.nextRevisionDate,
        input.userId,
        input.expectedUserKey,
        input.expectedSecurityStamp,
        input.expectedRevisionDate,
      ),
    // changes() is scoped to the immediately preceding statement in this batch.
    // A same-millisecond duplicate must not manufacture a second success audit.
    database
      .prepare(
        `
      INSERT INTO audit_events (
        id, schema_version, name, outcome, request_id, occurred_at,
        actor_user_id, actor_device_identifier, target_type, target_id, context_json
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1
    `,
      )
      .bind(
        crypto.randomUUID(),
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
      ),
  ])
  if (results.length !== 2 || results.some((result) => !result.success)) {
    throw new Error('Incomplete user-key ID registration transaction.')
  }
  return results[0]?.meta.changes === 1
}

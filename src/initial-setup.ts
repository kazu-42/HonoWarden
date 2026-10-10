import {
  accountRegistrationFields,
  parseAccountRegistrationFields,
  type AccountRegistrationFields,
} from './domain/account-registration'

export function parseInitialSetup(
  body: unknown,
): AccountRegistrationFields | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const allowed = new Set<string>(accountRegistrationFields)
  if (Object.keys(body).some((key) => !allowed.has(key))) return null
  return parseAccountRegistrationFields(body as Record<string, unknown>)
}

export async function createInitialAccount(
  database: Pick<D1Database, 'prepare' | 'batch'>,
  input: AccountRegistrationFields,
  now: string,
  requestId: string,
): Promise<boolean> {
  const userId = crypto.randomUUID()
  const stamp = crypto.randomUUID()
  const statements = [
    database
      .prepare(
        `INSERT OR IGNORE INTO initial_setup_receipt (singleton,user_id,consumed_at)
      SELECT 1,?,? WHERE NOT EXISTS (SELECT 1 FROM users)`,
      )
      .bind(userId, now),
    database
      .prepare(
        `INSERT INTO users (id,email,email_normalized,display_name,kdf_algorithm,kdf_iterations,kdf_memory,kdf_parallelism,master_password_hash,user_key,public_key,private_key,security_stamp,revision_date)
      SELECT ?,?,?,?,'pbkdf2-sha256',600000,NULL,NULL,?,?,?,?,?,?
      FROM initial_setup_receipt WHERE singleton=1 AND user_id=?`,
      )
      .bind(
        userId,
        input.email,
        input.email,
        input.displayName,
        input.masterPasswordHash,
        input.userKey,
        input.publicKey,
        input.privateKey,
        stamp,
        now,
        userId,
      ),
    database
      .prepare(
        `INSERT INTO audit_events (id,schema_version,name,outcome,request_id,occurred_at,actor_user_id,target_type,target_id,context_json)
      SELECT ?,1,'admin.initial_setup','success',?,?,NULL,'account',?,'{}'
      FROM initial_setup_receipt WHERE singleton=1 AND user_id=?`,
      )
      .bind(userId, requestId, now, userId, userId),
    database
      .prepare(
        `SELECT CASE WHEN EXISTS (SELECT 1 FROM initial_setup_receipt WHERE singleton=1 AND user_id=?)
      AND (NOT EXISTS (SELECT 1 FROM users WHERE id=?) OR NOT EXISTS (SELECT 1 FROM audit_events WHERE id=? AND name='admin.initial_setup'))
      THEN json('required initial setup write missing') ELSE 1 END AS valid`,
      )
      .bind(userId, userId, userId),
    database.prepare('SELECT id FROM users WHERE id=?').bind(userId),
  ]
  const result = await database.batch(statements)
  if (result.length !== statements.length || result.some((row) => !row.success))
    throw new Error('Initial setup could not be confirmed.')
  const created = result[4]?.results[0] as { id?: unknown } | undefined
  return created?.id === userId
}

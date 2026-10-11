import type { EmailVerificationActor } from '../domain/email-verification'
import { emailVerificationPolicy } from '../domain/email-verification'

type Database = Pick<D1Database, 'prepare' | 'batch'>
export type EmailVerificationChallenge = {
  id: string
  nonceDigest: string
  audience: string
  expiresAt: string
}
type ChallengeScope = {
  actor: EmailVerificationActor
  audience: string
  now: string
}

const activeFamilySql = `EXISTS (
  SELECT 1 FROM users u
  INNER JOIN devices d ON d.user_id = u.id
    AND d.identifier = email_verification_challenges.device_identifier
    AND d.session_id = email_verification_challenges.session_id
    AND d.revoked_at IS NULL
  WHERE u.id = email_verification_challenges.user_id
    AND u.email_normalized = email_verification_challenges.email_normalized
    AND u.security_stamp = email_verification_challenges.security_stamp
    AND u.disabled_at IS NULL
)`

export async function createEmailVerificationChallengeRecord(
  database: Pick<D1Database, 'prepare'>,
  input: ChallengeScope & {
    id: string
    nonceDigest: string
    expiresAt: string
  },
): Promise<boolean> {
  const actor = input.actor
  const result = await database
    .prepare(
      `
    INSERT INTO email_verification_challenges (
      id,user_id,session_id,device_identifier,email_normalized,security_stamp,
      audience,nonce_digest,created_at,expires_at
    )
    SELECT ?,u.id,d.session_id,d.identifier,u.email_normalized,u.security_stamp,?,?,?,?
    FROM users u INNER JOIN devices d ON d.user_id = u.id
    WHERE u.id = ? AND u.email_normalized = ? AND u.security_stamp = ?
      AND u.disabled_at IS NULL AND d.identifier = ? AND d.session_id = ?
      AND d.revoked_at IS NULL
    ON CONFLICT(user_id,session_id) DO UPDATE SET
      id = excluded.id, device_identifier = excluded.device_identifier,
      email_normalized = excluded.email_normalized, security_stamp = excluded.security_stamp,
      audience = excluded.audience, nonce_digest = excluded.nonce_digest,
      created_at = excluded.created_at, expires_at = excluded.expires_at,
      consumed_at = NULL, verification_mutation_id = NULL
    RETURNING id
  `,
    )
    .bind(
      input.id,
      input.audience,
      input.nonceDigest,
      input.now,
      input.expiresAt,
      actor.userId,
      actor.emailNormalized,
      actor.securityStamp,
      actor.deviceIdentifier,
      actor.sessionId,
    )
    .run<{ id: string }>()
  return result.results.length === 1
}

export async function findEmailVerificationChallenge(
  database: Pick<D1Database, 'prepare'>,
  input: ChallengeScope & { id: string },
): Promise<EmailVerificationChallenge | null> {
  return database
    .prepare(
      `
    SELECT id, nonce_digest AS nonceDigest, audience, expires_at AS expiresAt
    FROM email_verification_challenges
    WHERE id = ? AND user_id = ? AND session_id = ? AND device_identifier = ?
      AND email_normalized = ? AND security_stamp = ? AND audience = ?
      AND consumed_at IS NULL AND expires_at > ? AND ${activeFamilySql}
    LIMIT 1
  `,
    )
    .bind(
      input.id,
      input.actor.userId,
      input.actor.sessionId,
      input.actor.deviceIdentifier,
      input.actor.emailNormalized,
      input.actor.securityStamp,
      input.audience,
      input.now,
    )
    .first<EmailVerificationChallenge>()
}

export async function consumeEmailVerificationChallenge(
  database: Database,
  input: ChallengeScope & {
    id: string
    nonceDigest: string
    mutationId: string
    requestId: string
  },
): Promise<boolean> {
  const actor = input.actor
  const marker = `EXISTS (SELECT 1 FROM email_verification_challenges WHERE id = ? AND verification_mutation_id = ?)`
  const results = await database.batch([
    database
      .prepare(
        `
      UPDATE email_verification_challenges
      SET consumed_at = ?, verification_mutation_id = ?
      WHERE id = ? AND user_id = ? AND session_id = ? AND device_identifier = ?
        AND email_normalized = ? AND security_stamp = ? AND audience = ? AND nonce_digest = ?
        AND consumed_at IS NULL AND expires_at > ? AND ${activeFamilySql}
      RETURNING id
    `,
      )
      .bind(
        input.now,
        input.mutationId,
        input.id,
        actor.userId,
        actor.sessionId,
        actor.deviceIdentifier,
        actor.emailNormalized,
        actor.securityStamp,
        input.audience,
        input.nonceDigest,
        input.now,
      ),
    database
      .prepare(
        `
      UPDATE users
      SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ?,
        revision_date = strftime('%Y-%m-%dT%H:%M:%fZ', MAX(revision_date, ?), '+0.001 seconds')
      WHERE changes() = 1 AND id = ? AND email_normalized = ? AND security_stamp = ?
        AND disabled_at IS NULL AND ${marker}
        AND EXISTS (SELECT 1 FROM devices d WHERE d.user_id = users.id
          AND d.identifier = ? AND d.session_id = ? AND d.revoked_at IS NULL)
    `,
      )
      .bind(
        input.now,
        input.now,
        input.now,
        actor.userId,
        actor.emailNormalized,
        actor.securityStamp,
        input.id,
        input.mutationId,
        actor.deviceIdentifier,
        actor.sessionId,
      ),
    // An assertion inside the batch also rolls back ignored user writes.
    database
      .prepare(
        `SELECT CASE WHEN ${marker} AND changes() <> 1
      THEN json('required email verification user write missing') ELSE 1 END AS valid`,
      )
      .bind(input.id, input.mutationId),
    database
      .prepare(
        `
      INSERT INTO audit_events (
        id,schema_version,name,outcome,request_id,occurred_at,
        actor_user_id,actor_device_identifier,target_type,target_id,context_json
      )
      SELECT ?,1,'account.email.verify','success',?,?,?,?,'account',?,?
      WHERE changes() = 1 AND ${marker}
    `,
      )
      .bind(
        input.mutationId,
        input.requestId,
        input.now,
        actor.userId,
        actor.deviceIdentifier,
        actor.userId,
        JSON.stringify({
          method: 'evp',
          protocol: emailVerificationPolicy.protocol,
        }),
        input.id,
        input.mutationId,
      ),
    // Required success audit is part of the same transaction even under RAISE(IGNORE).
    database
      .prepare(
        `SELECT CASE WHEN ${marker}
      AND NOT EXISTS (SELECT 1 FROM audit_events WHERE id = ?)
      THEN json('required email verification audit missing') ELSE 1 END AS valid`,
      )
      .bind(input.id, input.mutationId, input.mutationId),
  ])
  if (results.length !== 5)
    throw new Error(
      'Email verification batch returned an invalid result count.',
    )
  return results[0]?.results.length === 1
}

export async function cleanupExpiredEmailVerificationChallenges(
  database: Pick<D1Database, 'prepare'>,
  now: string,
): Promise<void> {
  const before = new Date(Date.parse(now) - 24 * 60 * 60 * 1000).toISOString()
  await database
    .prepare(
      `DELETE FROM email_verification_challenges WHERE id IN (
    SELECT id FROM email_verification_challenges WHERE expires_at < ? ORDER BY expires_at LIMIT 100
  )`,
    )
    .bind(before)
    .run()
}

export type TextSendRow = {
  id: string
  ownerUserId: string
  type: 0
  authType: 1 | 2
  lifecycleState:
    | 'active'
    | 'deleted'
    | 'disabled'
    | 'expired'
    | 'pending_upload'
    | 'quarantined'
  capabilityEnvelope: string
  capabilityEnvelopeKeyId: string
  capabilityVerifier: string
  capabilityVerifierKeyId: string
  accessGeneration: number
  encryptedName: string
  encryptedNotes: string | null
  encryptedKey: string
  encryptedText: string
  textHidden: number
  passwordVerifier: string | null
  passwordKeyId: string | null
  maxAccessCount: number | null
  accessCount: number
  disabled: number
  hideEmail: number
  expirationAt: string | null
  deletionAt: string
  revisionDate: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  quarantinedAt: string | null
  lastAccessedAt: string | null
}

export type CreateTextSendInput = TextSendRow & {
  auditEventId: string
  requestId: string
}

export type UpdateTextSendInput = {
  id: string
  ownerUserId: string
  expectedRevisionDate: string
  encryptedName: string
  encryptedNotes: string | null
  encryptedKey: string
  encryptedText: string
  textHidden: boolean
  authType: 1 | 2
  passwordVerifier: string | null
  passwordKeyId: string | null
  maxAccessCount: number | null
  disabled: boolean
  hideEmail: boolean
  expirationAt: string | null
  deletionAt: string
  nextRevisionDate: string
}

type OwnerMutationInput = {
  id: string
  ownerUserId: string
  now: string
}

type TextSendDatabase = Pick<D1Database, 'batch' | 'prepare'>
type TextSendReadDatabase = Pick<D1Database, 'prepare'>

const textSendProjection = `
  id,
  owner_user_id AS ownerUserId,
  type,
  auth_type AS authType,
  lifecycle_state AS lifecycleState,
  capability_envelope AS capabilityEnvelope,
  capability_envelope_key_id AS capabilityEnvelopeKeyId,
  capability_verifier AS capabilityVerifier,
  capability_verifier_key_id AS capabilityVerifierKeyId,
  access_generation AS accessGeneration,
  encrypted_name AS encryptedName,
  encrypted_notes AS encryptedNotes,
  encrypted_key AS encryptedKey,
  encrypted_text AS encryptedText,
  text_hidden AS textHidden,
  password_verifier AS passwordVerifier,
  password_key_id AS passwordKeyId,
  max_access_count AS maxAccessCount,
  access_count AS accessCount,
  disabled,
  hide_email AS hideEmail,
  expiration_at AS expirationAt,
  deletion_at AS deletionAt,
  revision_date AS revisionDate,
  created_at AS createdAt,
  updated_at AS updatedAt,
  deleted_at AS deletedAt,
  quarantined_at AS quarantinedAt,
  last_accessed_at AS lastAccessedAt
`

export async function createTextSend(
  database: TextSendDatabase,
  input: CreateTextSendInput,
): Promise<{ status: 'created'; send: TextSendRow }> {
  const results = await database.batch<TextSendRow>([
    database
      .prepare(
        `
          INSERT INTO sends (
            id, owner_user_id, type, auth_type, lifecycle_state,
            capability_envelope, capability_envelope_key_id,
            capability_verifier, capability_verifier_key_id,
            access_generation, encrypted_name, encrypted_notes, encrypted_key,
            encrypted_text, text_hidden, password_verifier, password_key_id,
            max_access_count, access_count, disabled, hide_email,
            expiration_at, deletion_at, revision_date, created_at, updated_at,
            deleted_at, quarantined_at, last_accessed_at
          )
          VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?
          )
          RETURNING ${textSendProjection}
        `,
      )
      .bind(
        input.id,
        input.ownerUserId,
        input.type,
        input.authType,
        input.lifecycleState,
        input.capabilityEnvelope,
        input.capabilityEnvelopeKeyId,
        input.capabilityVerifier,
        input.capabilityVerifierKeyId,
        input.accessGeneration,
        input.encryptedName,
        input.encryptedNotes,
        input.encryptedKey,
        input.encryptedText,
        input.textHidden,
        input.passwordVerifier,
        input.passwordKeyId,
        input.maxAccessCount,
        input.accessCount,
        input.disabled,
        input.hideEmail,
        input.expirationAt,
        input.deletionAt,
        input.revisionDate,
        input.createdAt,
        input.updatedAt,
        input.deletedAt,
        input.quarantinedAt,
        input.lastAccessedAt,
      ),
    database
      .prepare(
        `
          INSERT INTO audit_events (
            id, schema_version, name, outcome, request_id, occurred_at,
            actor_user_id, actor_device_identifier, target_type, target_id,
            context_json
          )
          VALUES (?, 1, 'send.text.create', 'success', ?, ?, ?, NULL, 'send', ?, ?)
        `,
      )
      .bind(
        input.auditEventId,
        input.requestId,
        input.createdAt,
        input.ownerUserId,
        input.id,
        JSON.stringify({ type: 'text' }),
      ),
  ])

  const send = results[0]?.results[0]
  if (
    results.length !== 2 ||
    results.some((result) => !result.success || result.meta.changes !== 1) ||
    !send
  ) {
    throw new Error('Text Send create batch did not fully apply.')
  }
  return { status: 'created', send }
}

export async function listOwnerTextSends(
  database: TextSendReadDatabase,
  ownerUserId: string,
): Promise<TextSendRow[]> {
  const result = await database
    .prepare(
      `
        SELECT ${textSendProjection}
        FROM sends
        WHERE owner_user_id = ?
          AND deleted_at IS NULL
          AND type = 0
        ORDER BY revision_date DESC, id ASC
      `,
    )
    .bind(ownerUserId)
    .all<TextSendRow>()
  return result.results
}

export async function getOwnerTextSend(
  database: TextSendReadDatabase,
  input: { id: string; ownerUserId: string },
): Promise<TextSendRow | null> {
  return database
    .prepare(
      `
        SELECT ${textSendProjection}
        FROM sends
        WHERE id = ?
          AND owner_user_id = ?
          AND deleted_at IS NULL
          AND type = 0
      `,
    )
    .bind(input.id, input.ownerUserId)
    .first<TextSendRow>()
}

export async function getOwnerTextSendForMutation(
  database: TextSendReadDatabase,
  input: { id: string; ownerUserId: string },
): Promise<TextSendRow | null> {
  return database
    .prepare(
      `
        SELECT ${textSendProjection}
        FROM sends
        WHERE id = ?
          AND owner_user_id = ?
          AND type = 0
      `,
    )
    .bind(input.id, input.ownerUserId)
    .first<TextSendRow>()
}

export async function updateTextSend(
  database: TextSendReadDatabase,
  input: UpdateTextSendInput,
): Promise<{ status: 'updated'; send: TextSendRow } | { status: 'conflict' }> {
  const send = await database
    .prepare(
      `
        UPDATE sends
        SET
          encrypted_name = ?,
          encrypted_notes = ?,
          encrypted_key = ?,
          encrypted_text = ?,
          text_hidden = ?,
          auth_type = ?,
          password_verifier = ?,
          password_key_id = ?,
          max_access_count = ?,
          disabled = ?,
          hide_email = ?,
          expiration_at = ?,
          deletion_at = ?,
          lifecycle_state = CASE WHEN ? = 1 THEN 'disabled' ELSE 'active' END,
          access_generation = access_generation + 1,
          revision_date = ?,
          updated_at = ?
        WHERE id = ?
          AND owner_user_id = ?
          AND revision_date = ?
          AND type = 0
          AND deleted_at IS NULL
          AND quarantined_at IS NULL
          AND lifecycle_state IN ('active', 'disabled', 'expired')
          AND (max_access_count IS NULL OR max_access_count >= access_count)
          AND (? IS NULL OR ? >= access_count)
          AND ? > revision_date
        RETURNING ${textSendProjection}
      `,
    )
    .bind(
      input.encryptedName,
      input.encryptedNotes,
      input.encryptedKey,
      input.encryptedText,
      input.textHidden ? 1 : 0,
      input.authType,
      input.passwordVerifier,
      input.passwordKeyId,
      input.maxAccessCount,
      input.disabled ? 1 : 0,
      input.hideEmail ? 1 : 0,
      input.expirationAt,
      input.deletionAt,
      input.disabled ? 1 : 0,
      input.nextRevisionDate,
      input.nextRevisionDate,
      input.id,
      input.ownerUserId,
      input.expectedRevisionDate,
      input.maxAccessCount,
      input.maxAccessCount,
      input.nextRevisionDate,
    )
    .first<TextSendRow>()
  return send ? { status: 'updated', send } : { status: 'conflict' }
}

export async function removeTextSendAuth(
  database: TextSendReadDatabase,
  input: OwnerMutationInput,
): Promise<{ status: 'updated'; send: TextSendRow } | { status: 'not_found' }> {
  const send = await database
    .prepare(
      `
        UPDATE sends
        SET
          auth_type = 2,
          password_verifier = NULL,
          password_key_id = NULL,
          access_generation = CASE WHEN auth_type = 2
            AND password_verifier IS NULL
            AND password_key_id IS NULL
            THEN access_generation ELSE access_generation + 1 END,
          revision_date = CASE WHEN auth_type = 2
            AND password_verifier IS NULL
            AND password_key_id IS NULL
            THEN revision_date ELSE ? END,
          updated_at = CASE WHEN auth_type = 2
            AND password_verifier IS NULL
            AND password_key_id IS NULL
            THEN updated_at ELSE ? END
        WHERE id = ?
          AND owner_user_id = ?
          AND type = 0
          AND deleted_at IS NULL
          AND quarantined_at IS NULL
          AND lifecycle_state IN ('active', 'disabled', 'expired')
          AND (
            (auth_type = 2 AND password_verifier IS NULL AND password_key_id IS NULL)
            OR ? > revision_date
          )
        RETURNING ${textSendProjection}
      `,
    )
    .bind(input.now, input.now, input.id, input.ownerUserId, input.now)
    .first<TextSendRow>()
  return send ? { status: 'updated', send } : { status: 'not_found' }
}

export async function deleteTextSend(
  database: TextSendReadDatabase,
  input: OwnerMutationInput,
): Promise<{ status: 'deleted' } | { status: 'not_found' }> {
  const send = await database
    .prepare(
      `
        UPDATE sends
        SET
          lifecycle_state = CASE WHEN deleted_at IS NULL
            THEN 'deleted' ELSE lifecycle_state END,
          disabled = CASE WHEN deleted_at IS NULL THEN 1 ELSE disabled END,
          deleted_at = CASE WHEN deleted_at IS NULL THEN ? ELSE deleted_at END,
          access_generation = CASE WHEN deleted_at IS NULL
            THEN access_generation + 1 ELSE access_generation END,
          revision_date = CASE WHEN deleted_at IS NULL THEN ? ELSE revision_date END,
          updated_at = CASE WHEN deleted_at IS NULL THEN ? ELSE updated_at END
        WHERE id = ?
          AND owner_user_id = ?
          AND type = 0
          AND (
            (
              deleted_at IS NOT NULL
              AND lifecycle_state = 'deleted'
              AND disabled = 1
            )
            OR (
              deleted_at IS NULL
              AND ? > revision_date
            )
          )
        RETURNING id
      `,
    )
    .bind(
      input.now,
      input.now,
      input.now,
      input.id,
      input.ownerUserId,
      input.now,
    )
    .first<{ id: string }>()
  return send ? { status: 'deleted' } : { status: 'not_found' }
}

export async function consumeTextSendAccess(
  database: TextSendReadDatabase,
  input: {
    capabilityVerifier: string
    accessGeneration: number
    now: string
  },
): Promise<
  { status: 'consumed'; send: TextSendRow } | { status: 'unavailable' }
> {
  const send = await database
    .prepare(
      `
        UPDATE sends
        SET
          access_count = access_count + 1,
          last_accessed_at = ?,
          updated_at = ?
        WHERE capability_verifier = ?
          AND access_generation = ?
          AND type = 0
          AND lifecycle_state = 'active'
          AND disabled = 0
          AND deleted_at IS NULL
          AND quarantined_at IS NULL
          AND deletion_at > ?
          AND (expiration_at IS NULL OR expiration_at > ?)
          AND (max_access_count IS NULL OR access_count < max_access_count)
        RETURNING ${textSendProjection}
      `,
    )
    .bind(
      input.now,
      input.now,
      input.capabilityVerifier,
      input.accessGeneration,
      input.now,
      input.now,
    )
    .first<TextSendRow>()
  return send ? { status: 'consumed', send } : { status: 'unavailable' }
}

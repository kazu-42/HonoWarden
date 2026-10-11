import {
  organizationAccessActorValues,
  organizationCollectionAccessCte,
  type OrganizationAccessContext,
} from './organization-collection-access-sql'
import type { CipherRecord } from './cipher-repository'

export type OrganizationCipherUpdateInput = OrganizationAccessContext & {
  id: string
  userId: string
  type: number
  favorite: boolean
  encryptedJson: string
  cipherKey?: string
  revisionDate: string
  expectedRevisionDate: string
}

export type OrganizationCipherRecord = CipherRecord & {
  organizationId: string
  cipherKey: string | null
}

type MutationFailure =
  { status: 'not_found' } | { status: 'conflict'; currentRevisionDate: string }

type Database = Pick<D1Database, 'prepare'>

// Content mutation needs a writable assignment to a collection containing this
// cipher. Collection administration (`manage`) is a separate permission.
const writableOrganizationCipherPredicate = `
  organization_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM accessible_organization_collections access
    INNER JOIN collection_ciphers mapping ON mapping.collection_id = access.collectionId
    WHERE access.organizationId = ciphers.organization_id
      AND access.readOnly = 0 AND mapping.cipher_id = ciphers.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM cipher_attachments attachment
    WHERE attachment.cipher_id = ciphers.id
  )
`

type OrganizationCipherRow = Omit<OrganizationCipherRecord, 'favorite'> & {
  favorite: number | boolean
}

export type OrganizationCipherLifecycleInput = OrganizationAccessContext & {
  id: string
  userId: string
  revisionDate: string
  expectedRevisionDate?: string
}

export async function updateOrganizationCipher(
  database: Database,
  input: OrganizationCipherUpdateInput,
): Promise<
  MutationFailure | { status: 'updated'; cipher: OrganizationCipherRecord }
> {
  if (
    input.cipherKey !== undefined &&
    (typeof input.cipherKey !== 'string' ||
      input.cipherKey.length === 0 ||
      new TextEncoder().encode(input.cipherKey).byteLength > 65_536)
  ) {
    throw new TypeError(
      'Organization cipher key must contain 1 to 65536 UTF-8 bytes',
    )
  }

  const row = await database
    .prepare(
      `
      ${organizationCollectionAccessCte}
      UPDATE ciphers
      SET type = ?, favorite = ?, encrypted_json = ?,
        cipher_key = COALESCE(?, cipher_key),
        revision_date = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL AND revision_date = ?
        AND revision_date < ?
        AND ${writableOrganizationCipherPredicate}
      RETURNING id, user_id AS userId, folder_id AS folderId, type,
        favorite, encrypted_json AS encryptedJson, revision_date AS revisionDate,
        created_at AS createdAt, deleted_at AS deletedAt,
        organization_id AS organizationId, cipher_key AS cipherKey
    `,
    )
    .bind(
      ...organizationAccessActorValues(input.userId, input.actor),
      input.type,
      input.favorite ? 1 : 0,
      input.encryptedJson,
      input.cipherKey ?? null,
      input.revisionDate,
      input.revisionDate,
      input.id,
      input.expectedRevisionDate,
      input.revisionDate,
    )
    .first<OrganizationCipherRow>()

  if (!row) return mutationFailure(database, input, 'deleted_at IS NULL')
  return {
    status: 'updated',
    cipher: { ...row, favorite: Boolean(row.favorite) },
  }
}

export async function softDeleteOrganizationCipher(
  database: Database,
  input: Omit<OrganizationCipherLifecycleInput, 'revisionDate'> & {
    deletedAt: string
  },
): Promise<
  | MutationFailure
  | { status: 'deleted'; id: string; revisionDate: string; deletedAt: string }
> {
  const row = await database
    .prepare(
      `
      ${organizationCollectionAccessCte}
      UPDATE ciphers
      SET deleted_at = ?, revision_date = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL AND revision_date < ?
        AND (? IS NULL OR revision_date = ?)
        AND ${writableOrganizationCipherPredicate}
      RETURNING id
    `,
    )
    .bind(
      ...organizationAccessActorValues(input.userId, input.actor),
      input.deletedAt,
      input.deletedAt,
      input.deletedAt,
      input.id,
      input.deletedAt,
      input.expectedRevisionDate ?? null,
      input.expectedRevisionDate ?? null,
    )
    .first<{ id: string }>()

  if (!row) return mutationFailure(database, input, 'deleted_at IS NULL')
  return {
    status: 'deleted',
    id: row.id,
    revisionDate: input.deletedAt,
    deletedAt: input.deletedAt,
  }
}

export async function restoreOrganizationCipher(
  database: Database,
  input: OrganizationCipherLifecycleInput,
): Promise<
  MutationFailure | { status: 'restored'; id: string; revisionDate: string }
> {
  const row = await database
    .prepare(
      `
      ${organizationCollectionAccessCte}
      UPDATE ciphers
      SET deleted_at = NULL, revision_date = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NOT NULL AND revision_date < ?
        AND (? IS NULL OR revision_date = ?)
        AND ${writableOrganizationCipherPredicate}
      RETURNING id
    `,
    )
    .bind(
      ...organizationAccessActorValues(input.userId, input.actor),
      input.revisionDate,
      input.revisionDate,
      input.id,
      input.revisionDate,
      input.expectedRevisionDate ?? null,
      input.expectedRevisionDate ?? null,
    )
    .first<{ id: string }>()

  if (!row) return mutationFailure(database, input, 'deleted_at IS NOT NULL')
  return { status: 'restored', id: row.id, revisionDate: input.revisionDate }
}

export async function permanentlyDeleteOrganizationCipher(
  database: Database,
  input: OrganizationCipherLifecycleInput,
): Promise<
  MutationFailure | { status: 'deleted'; id: string; revisionDate: string }
> {
  const row = await database
    .prepare(
      `
      ${organizationCollectionAccessCte}
      DELETE FROM ciphers
      WHERE id = ? AND (? IS NULL OR revision_date = ?)
        AND ${writableOrganizationCipherPredicate}
      RETURNING id
    `,
    )
    .bind(
      ...organizationAccessActorValues(input.userId, input.actor),
      input.id,
      input.expectedRevisionDate ?? null,
      input.expectedRevisionDate ?? null,
    )
    .first<{ id: string }>()

  if (!row) return mutationFailure(database, input, '1 = 1')
  return { status: 'deleted', id: row.id, revisionDate: input.revisionDate }
}

async function mutationFailure(
  database: Database,
  input: OrganizationAccessContext & {
    id: string
    userId: string
    expectedRevisionDate?: string
  },
  lifecyclePredicate: 'deleted_at IS NULL' | 'deleted_at IS NOT NULL' | '1 = 1',
): Promise<MutationFailure> {
  if (input.expectedRevisionDate === undefined) return { status: 'not_found' }

  // Recheck the current grant before reporting a revision. Revocation between
  // the CAS attempt and readback must return the same result as an unknown ID.
  const current = await database
    .prepare(
      `
      ${organizationCollectionAccessCte}
      SELECT revision_date AS revisionDate FROM ciphers
      WHERE id = ? AND ${lifecyclePredicate}
        AND ${writableOrganizationCipherPredicate}
    `,
    )
    .bind(...organizationAccessActorValues(input.userId, input.actor), input.id)
    .first<{ revisionDate: string }>()

  return current
    ? { status: 'conflict', currentRevisionDate: current.revisionDate }
    : { status: 'not_found' }
}

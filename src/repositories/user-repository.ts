import type { BootstrapUserRecord } from '../domain/bootstrap'

export type CreateBootstrapUserResult =
  | {
      status: 'created'
      userId: string
    }
  | {
      status: 'duplicate'
    }

export type AccountProfileUpdateInput = {
  userId: string
  displayName: string
  revisionDate: string
  updatedAt: string
}

export type AccountProfileUpdateResult =
  | {
      status: 'updated'
      displayName: string
      revisionDate: string
    }
  | {
      status: 'not_found'
    }

type UserRepositoryDatabase = Pick<D1Database, 'prepare'>

type AccountRevisionRow = {
  revisionDate: string | null
}

export async function createBootstrapUser(
  database: UserRepositoryDatabase,
  user: BootstrapUserRecord,
): Promise<CreateBootstrapUserResult> {
  const result = await database
    .prepare(
      `
        INSERT OR IGNORE INTO users (
          id,
          email,
          email_normalized,
          display_name,
          kdf_algorithm,
          kdf_iterations,
          kdf_memory,
          kdf_parallelism,
          master_password_hash,
          user_key,
          public_key,
          private_key,
          security_stamp,
          revision_date
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      user.id,
      user.email,
      user.emailNormalized,
      user.displayName,
      user.kdfAlgorithm,
      user.kdfIterations,
      user.kdfMemory,
      user.kdfParallelism,
      user.masterPasswordHash,
      user.userKey,
      user.publicKey,
      user.privateKey,
      user.securityStamp,
      user.revisionDate,
    )
    .run()

  if (result.meta.changes === 0) {
    return { status: 'duplicate' }
  }

  return {
    status: 'created',
    userId: user.id,
  }
}

export async function getAccountRevisionDate(
  database: UserRepositoryDatabase,
  userId: string,
): Promise<string | null> {
  const row = await database
    .prepare(
      `
        WITH requested_user AS (
          SELECT ? AS userId
        ),
        confirmed_memberships AS (
          SELECT
            membership.id as organizationUserId,
            membership.organization_id as organizationId
          FROM organization_users membership
          INNER JOIN requested_user
            ON requested_user.userId = membership.user_id
          WHERE membership.status = 2
        ),
        accessible_organization_collections AS (
          SELECT DISTINCT
            collection.id as collectionId,
            collection.organization_id as organizationId,
            collection_user.manage
          FROM confirmed_memberships membership
          INNER JOIN collection_users collection_user
            ON collection_user.organization_user_id = membership.organizationUserId
          INNER JOIN collections collection
            ON collection.id = collection_user.collection_id
            AND collection.organization_id = membership.organizationId
        )
        SELECT MAX(revision_date) as revisionDate
        FROM (
          SELECT user.revision_date
          FROM users user
          INNER JOIN requested_user
            ON requested_user.userId = user.id
          UNION ALL
          SELECT folder.revision_date
          FROM folders folder
          INNER JOIN requested_user
            ON requested_user.userId = folder.user_id
          UNION ALL
          SELECT cipher.revision_date
          FROM ciphers cipher
          INNER JOIN requested_user
            ON requested_user.userId = cipher.user_id
          WHERE cipher.organization_id IS NULL
          UNION ALL
          SELECT organization.revision_date
          FROM organizations organization
          INNER JOIN confirmed_memberships membership
            ON membership.organizationId = organization.id
          UNION ALL
          SELECT cipher.revision_date
          FROM ciphers cipher
          WHERE cipher.organization_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM collection_ciphers mapping
              INNER JOIN accessible_organization_collections accessible_collection
                ON accessible_collection.collectionId = mapping.collection_id
                AND accessible_collection.organizationId = cipher.organization_id
                AND accessible_collection.manage = 1
              WHERE mapping.cipher_id = cipher.id
            )
        )
      `,
    )
    .bind(userId)
    .first<AccountRevisionRow>()

  return row?.revisionDate ?? null
}

export async function updateAccountProfile(
  database: UserRepositoryDatabase,
  input: AccountProfileUpdateInput,
): Promise<AccountProfileUpdateResult> {
  const result = await database
    .prepare(
      `
        UPDATE users
        SET
          display_name = ?,
          revision_date = ?,
          updated_at = ?
        WHERE id = ?
          AND disabled_at IS NULL
      `,
    )
    .bind(input.displayName, input.revisionDate, input.updatedAt, input.userId)
    .run()

  if (result.meta.changes !== 1) {
    return {
      status: 'not_found',
    }
  }

  return {
    status: 'updated',
    displayName: input.displayName,
    revisionDate: input.revisionDate,
  }
}

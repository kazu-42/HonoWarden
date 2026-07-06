import type { BootstrapUserRecord } from '../domain/bootstrap'

export type CreateBootstrapUserResult =
  | {
      status: 'created'
      userId: string
    }
  | {
      status: 'duplicate'
    }

type UserRepositoryDatabase = Pick<D1Database, 'prepare'>

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

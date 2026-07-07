import { loginDefensePolicy } from '../domain/login-defense'
import { cleanupAuthDefenseState } from '../repositories/auth-repository'
import { cleanupExpiredTotpChallenges } from '../repositories/totp-repository'

const authDefenseCleanupRowsPerSlice = 100

const authDefenseCleanupWindowSeconds = Math.max(
  loginDefensePolicy.accountFailureWindowSeconds,
  loginDefensePolicy.accountLockoutSeconds,
  loginDefensePolicy.ipFailureWindowSeconds,
  loginDefensePolicy.ipRetryAfterSeconds,
)

export async function cleanupTransientAuthData(
  database: Pick<D1Database, 'prepare'>,
  now: string,
): Promise<void> {
  // This call is intentionally bounded and idempotent so it can be triggered on
  // hot paths without risking large table churn.
  await cleanupAuthDefenseState(database, {
    now,
    authAttemptExpiredBefore: new Date(
      Date.parse(now) - authDefenseCleanupWindowSeconds * 1000,
    ).toISOString(),
    authFailureBucketExpiredBefore: new Date(
      Date.parse(now) - authDefenseCleanupWindowSeconds * 1000,
    ).toISOString(),
    maxRowsPerQuery: authDefenseCleanupRowsPerSlice,
  })

  await cleanupExpiredTotpChallenges(database, {
    expiredBefore: now,
    limit: authDefenseCleanupRowsPerSlice,
  })
}

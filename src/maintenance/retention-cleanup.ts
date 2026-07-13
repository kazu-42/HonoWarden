import { loginDefensePolicy } from '../domain/login-defense'
import { refreshTokenRetentionRowsPerSlice } from '../domain/tokens'
import {
  cleanupAuthDefenseState,
  deleteExpiredRefreshTokens,
} from '../repositories/auth-repository'
import {
  auditEventRetentionPolicy,
  cleanupExpiredAuditEvents,
} from '../repositories/audit-event-repository'
import { requestQuotaPolicy } from '../domain/request-quota'
import { cleanupExpiredRequestQuotaBuckets } from '../repositories/request-quota-repository'
import { cleanupExpiredTotpChallenges } from '../repositories/totp-repository'
import {
  deleteRetainedAuthRequests,
  expireAuthRequests,
} from '../repositories/auth-request-repository'

const authDefenseCleanupRowsPerSlice = 100

const authDefenseCleanupWindowSeconds = Math.max(
  loginDefensePolicy.accountFailureWindowSeconds,
  loginDefensePolicy.accountLockoutSeconds,
  loginDefensePolicy.ipFailureWindowSeconds,
  loginDefensePolicy.ipRetryAfterSeconds,
)

type CleanupTransientAuthDataOptions = {
  auditEvents?: boolean
  authRequests?: boolean
  refreshTokens?: boolean
  requestQuotaBuckets?: boolean
}

export async function cleanupTransientAuthData(
  database: Pick<D1Database, 'prepare'>,
  now: string,
  options: CleanupTransientAuthDataOptions = {},
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

  if (options.authRequests) {
    await expireAuthRequests(database, now, authDefenseCleanupRowsPerSlice)
    await deleteRetainedAuthRequests(
      database,
      now,
      authDefenseCleanupRowsPerSlice,
    )
  }

  if (options.refreshTokens) {
    await deleteExpiredRefreshTokens(database, {
      now,
      limit: refreshTokenRetentionRowsPerSlice,
    })
  }

  if (options.auditEvents) {
    await cleanupExpiredAuditEvents(database, {
      expiredBefore: new Date(
        Date.parse(now) -
          auditEventRetentionPolicy.retentionDays * 86400 * 1000,
      ).toISOString(),
      limit: auditEventRetentionPolicy.maxRowsPerCleanup,
    })
  }

  if (options.requestQuotaBuckets) {
    await cleanupExpiredRequestQuotaBuckets(database, {
      expiredBefore: new Date(
        Date.parse(now) - requestQuotaPolicy.cleanupRetentionSeconds * 1000,
      ).toISOString(),
      now,
      limit: requestQuotaPolicy.cleanupRowsPerSlice,
    })
  }
}

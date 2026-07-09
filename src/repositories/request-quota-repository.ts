import type {
  RequestQuotaBucket,
  RequestQuotaScope,
} from '../domain/request-quota'

export type RequestQuotaHitInput = {
  bucketKey: string
  scope: RequestQuotaScope
  limit: number
  windowSeconds: number
  blockSeconds: number
  now: string
}

type RequestQuotaBucketRow = {
  bucketKey: string
  scope: RequestQuotaScope
  requestCount: number
  windowStartedAt: string
  blockedUntil: string | null
  updatedAt: string
}

type RequestQuotaDatabase = Pick<D1Database, 'prepare'>

export async function recordRequestQuotaHit(
  database: RequestQuotaDatabase,
  input: RequestQuotaHitInput,
): Promise<RequestQuotaBucket> {
  const nowMs = Date.parse(input.now)
  const windowThreshold = new Date(
    nowMs - input.windowSeconds * 1000,
  ).toISOString()
  const blockedUntil = new Date(nowMs + input.blockSeconds * 1000).toISOString()
  const firstRequestBlockedUntil = input.limit < 1 ? blockedUntil : null

  await database
    .prepare(
      `
        INSERT INTO request_quota_buckets (
          bucket_key,
          scope,
          request_count,
          window_started_at,
          blocked_until,
          updated_at
        )
        VALUES (?, ?, 1, ?, ?, ?)
        ON CONFLICT(bucket_key) DO UPDATE SET
          scope = excluded.scope,
          request_count = CASE
            WHEN request_quota_buckets.window_started_at >= ?
              THEN request_quota_buckets.request_count + 1
            ELSE 1
          END,
          window_started_at = CASE
            WHEN request_quota_buckets.window_started_at >= ?
              THEN request_quota_buckets.window_started_at
            ELSE excluded.window_started_at
          END,
          blocked_until = CASE
            WHEN (
              CASE
                WHEN request_quota_buckets.window_started_at >= ?
                  THEN request_quota_buckets.request_count + 1
                ELSE 1
              END
            ) > ? THEN ?
            ELSE NULL
          END,
          updated_at = excluded.updated_at
      `,
    )
    .bind(
      input.bucketKey,
      input.scope,
      input.now,
      firstRequestBlockedUntil,
      input.now,
      windowThreshold,
      windowThreshold,
      windowThreshold,
      input.limit,
      blockedUntil,
    )
    .run()

  const bucket = await findRequestQuotaBucket(database, input.bucketKey)

  if (!bucket) {
    throw new Error('Request quota bucket was not persisted.')
  }

  return bucket
}

export async function findRequestQuotaBucket(
  database: RequestQuotaDatabase,
  bucketKey: string,
): Promise<RequestQuotaBucket | null> {
  const row = await database
    .prepare(
      `
        SELECT
          bucket_key as bucketKey,
          scope,
          request_count as requestCount,
          window_started_at as windowStartedAt,
          blocked_until as blockedUntil,
          updated_at as updatedAt
        FROM request_quota_buckets
        WHERE bucket_key = ?
        LIMIT 1
      `,
    )
    .bind(bucketKey)
    .first<RequestQuotaBucketRow>()

  return row ? { ...row } : null
}

export async function cleanupExpiredRequestQuotaBuckets(
  database: RequestQuotaDatabase,
  input: {
    expiredBefore: string
    now: string
    limit: number
  },
): Promise<number> {
  const result = await database
    .prepare(
      `
        DELETE FROM request_quota_buckets
        WHERE bucket_key IN (
          SELECT bucket_key
          FROM request_quota_buckets
          WHERE updated_at < ?
            AND (blocked_until IS NULL OR blocked_until < ?)
          ORDER BY updated_at ASC
          LIMIT ?
        )
      `,
    )
    .bind(input.expiredBefore, input.now, input.limit)
    .run()

  return result.meta.changes
}

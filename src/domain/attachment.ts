export const attachmentStoragePolicy = {
  maxStorageBytes: 1024 ** 3,
  maxStorageGb: 1,
  pendingAllocationTtlSeconds: 24 * 60 * 60,
  cleanupRowsPerSlice: 100,
} as const

export function pendingAttachmentExpiresAt(
  reservedAt: string,
  ttlSeconds: number = attachmentStoragePolicy.pendingAllocationTtlSeconds,
): string {
  const reservedAtMilliseconds = Date.parse(reservedAt)
  if (!Number.isFinite(reservedAtMilliseconds)) {
    throw new Error('Pending attachment reservation time is invalid.')
  }

  return new Date(reservedAtMilliseconds + ttlSeconds * 1000).toISOString()
}

export function pendingAttachmentExpiredBefore(now: string): string {
  const nowMilliseconds = Date.parse(now)
  if (!Number.isFinite(nowMilliseconds)) {
    throw new Error('Pending attachment cleanup time is invalid.')
  }

  return new Date(
    nowMilliseconds -
      attachmentStoragePolicy.pendingAllocationTtlSeconds * 1000,
  ).toISOString()
}

import { pendingAttachmentExpiresAt } from '../../src/domain/attachment'

const fakeMeta = {
  duration: 0,
  size_after: 0,
  rows_read: 0,
  rows_written: 0,
  last_row_id: 0,
  changed_db: false,
  changes: 0,
} satisfies D1Meta & Record<string, unknown>

type FakeD1DatabaseOptions = {
  authAttemptCount?: number
  lockedAccountFailureBucket?: boolean
  lockedIpFailureBucket?: boolean
  authUser?: Record<string, unknown> | null
  authUsers?: Record<string, unknown>[]
  authRequests?: Record<string, unknown>[]
  userTotp?: Record<string, unknown> | null
  totpChallenge?: Record<string, unknown> | null
  cipher?: Record<string, unknown> | null
  attachment?: Record<string, unknown> | null
  attachmentDeleteChanges?: number
  attachmentInsertChanges?: number
  attachments?: Record<string, unknown>[]
  cipherInsertChanges?: number
  cipherPermanentDeleteChanges?: number
  cipherRestoreChanges?: number
  cipherSoftDeleteChanges?: number
  cipherUpdateChanges?: number
  ciphers?: Record<string, unknown>[]
  devices?: Record<string, unknown>[]
  deviceUpdateChanges?: number
  deviceRevokeChanges?: number
  folder?: Record<string, unknown> | null
  folderDeleteChanges?: number
  folders?: Record<string, unknown>[]
  folderUpdateChanges?: number
  refreshSession?: Record<string, unknown> | null
  refreshTokens?: Record<string, unknown>[]
  refreshRotationChanges?: number
  userInsertChanges?: number
  userUpdateChanges?: number
  userTotpInsertChanges?: number
  userTotpDeleteChanges?: number
  userTotpUpdateChanges?: number
  totpChallengeInsertChanges?: number
  totpChallengeUpdateChanges?: number
  auditEventCleanupChanges?: number
  auditEventInsertThrows?: boolean
  requestQuotaBucket?: Record<string, unknown> | null
  requestQuotaCleanupChanges?: number
  requestQuotaInsertThrows?: boolean
  inquiryForwardUpdateThrows?: boolean
  inquiryInsertThrows?: boolean
}

export type FakeAuditEventInsert = {
  id: string
  schemaVersion: number
  name: string
  outcome: string
  requestId: string
  occurredAt: string
  actorUserId: string | null
  actorDeviceIdentifier: string | null
  targetType: string | null
  targetId: string | null
  contextJson: string | null
}

export type FakeAuditEventCleanupDelete = {
  expiredBefore: string
  limit: number
}

export type FakeRefreshTokenCleanupDelete = {
  expiredBefore: string
  limit: number
  deleted: number
}

export type FakeRequestQuotaWrite = {
  bucketKey: string
  scope: string
  limit: number
  windowSeconds: number
  blockSeconds: number
}

export type FakeRequestQuotaCleanupDelete = {
  expiredBefore: string
  now: string
  limit: number
}

export type FakeInquiryThreadInsert = {
  id: string
  mailbox: string
  threadKey: string
  senderHash: string
  subjectPreview: string | null
  status: string
  retentionDeadline: string
  createdAt: string
  updatedAt: string
}

export type FakeInquiryMessageInsert = {
  id: string
  threadId: string
  direction: string
  envelopeSenderHash: string
  envelopeRecipient: string
  messageIdHash: string | null
  inReplyToHash: string | null
  referencesHash: string | null
  subjectPreview: string | null
  rawSize: number
  contentType: string | null
  hasAttachmentHint: boolean
  bodyStorageState: string
  rawBodyStored: boolean
  rawObjectKey: string | null
  attachmentStorageState: string
  deliveryStatus: string
  rejectionReason: string | null
  forwardAttempted: boolean
  forwardedAt: string | null
  receivedAt: string
  retentionDeadline: string
  createdAt: string
}

export type FakeInquiryEventInsert = {
  id: string
  threadId: string
  messageId: string
  name: string
  outcome: string
  occurredAt: string
  metadataJson: string | null
  createdAt: string
}

export type FakeInquiryMessageForwardUpdate = {
  messageId: string
  forwardedAt: string
}

export class FakeD1Database {
  readonly deletedAuthFailureBucketKeys: string[] = []
  readonly auditEventInserts: FakeAuditEventInsert[] = []
  readonly auditEventCleanupDeletes: FakeAuditEventCleanupDelete[] = []
  readonly refreshTokenCleanupDeletes: FakeRefreshTokenCleanupDelete[] = []
  readonly requestQuotaWrites: FakeRequestQuotaWrite[] = []
  readonly requestQuotaCleanupDeletes: FakeRequestQuotaCleanupDelete[] = []
  readonly inquiryThreadInserts: FakeInquiryThreadInsert[] = []
  readonly inquiryMessageInserts: FakeInquiryMessageInsert[] = []
  readonly inquiryEventInserts: FakeInquiryEventInsert[] = []
  readonly inquiryMessageForwardUpdates: FakeInquiryMessageForwardUpdate[] = []

  private readonly authFailureBuckets = new Map<
    string,
    Record<string, unknown>
  >()

  constructor(
    private readonly schemaVersion: string | null,
    private readonly tables: readonly string[],
    private readonly options: FakeD1DatabaseOptions = {},
  ) {}

  prepare(query: string): D1PreparedStatement {
    const schemaVersion = this.schemaVersion
    const tables = this.tables
    const options = this.options
    const authFailureBuckets = this.authFailureBuckets
    const deletedAuthFailureBucketKeys = this.deletedAuthFailureBucketKeys
    const auditEventInserts = this.auditEventInserts
    const auditEventCleanupDeletes = this.auditEventCleanupDeletes
    const refreshTokenCleanupDeletes = this.refreshTokenCleanupDeletes
    const requestQuotaWrites = this.requestQuotaWrites
    const requestQuotaCleanupDeletes = this.requestQuotaCleanupDeletes
    const inquiryThreadInserts = this.inquiryThreadInserts
    const inquiryMessageInserts = this.inquiryMessageInserts
    const inquiryEventInserts = this.inquiryEventInserts
    const inquiryMessageForwardUpdates = this.inquiryMessageForwardUpdates
    let boundValues: unknown[] = []

    const statement = {
      get __fakeQuery() {
        return query
      },
      get __fakeBoundValues() {
        return boundValues
      },
      bind(...values: unknown[]) {
        boundValues = values
        return statement
      },
      async first<T = unknown>(column?: string): Promise<T | null> {
        if (query.includes('FROM auth_requests')) {
          return findAuthRequestRow(
            options.authRequests ?? [],
            boundValues,
            query,
          ) as T | null
        }

        if (query.includes('FROM request_quota_buckets')) {
          return (options.requestQuotaBucket ?? null) as T | null
        }

        if (query.includes('FROM auth_failure_buckets')) {
          const bucketKey = String(boundValues[0] ?? '')
          const lockedUntil = '2999-01-01T00:00:00.000Z'

          if (bucketKey.startsWith('ip:') && options.lockedIpFailureBucket) {
            return {
              bucketKey,
              failedCount: 20,
              windowStartedAt: '2026-07-06T00:00:00.000Z',
              lockedUntil,
              updatedAt: '2026-07-06T00:00:00.000Z',
            } as T
          }

          if (
            bucketKey.startsWith('account:') &&
            options.lockedAccountFailureBucket
          ) {
            return {
              bucketKey,
              failedCount: 5,
              windowStartedAt: '2026-07-06T00:00:00.000Z',
              lockedUntil,
              updatedAt: '2026-07-06T00:00:00.000Z',
            } as T
          }

          return (authFailureBuckets.get(bucketKey) ?? null) as T | null
        }

        if (query.includes('COUNT(*) as count')) {
          const row = {
            count: options.authAttemptCount ?? 0,
          }

          return (column ? row[column as keyof typeof row] : row) as T
        }

        if (query.includes('MAX(revision_date) as revisionDate')) {
          const row = {
            revisionDate: findLatestRevisionDate(options, boundValues),
          }

          return (column ? row[column as keyof typeof row] : row) as T
        }

        if (query.includes('FROM refresh_tokens')) {
          return (options.refreshSession ?? null) as T | null
        }

        if (query.includes('FROM folders')) {
          if (options.folder !== undefined) {
            return (options.folder ?? null) as T | null
          }

          return findScopedRow(
            options.folders ?? [],
            boundValues,
            query,
          ) as T | null
        }

        if (query.includes('FROM cipher_attachments')) {
          if (query.includes('SUM(size)')) {
            const row = {
              storageBytes: calculateAttachmentStorageBytes(
                options.attachments ?? [],
                boundValues,
                query,
              ),
            }

            return (column ? row[column as keyof typeof row] : row) as T
          }

          if (options.attachment !== undefined) {
            return (options.attachment ?? null) as T | null
          }

          return findScopedAttachmentRow(
            options.attachments ?? [],
            boundValues,
          ) as T | null
        }

        if (query.includes('FROM ciphers')) {
          if (options.cipher !== undefined) {
            return (options.cipher ?? null) as T | null
          }

          return findScopedRow(
            options.ciphers ?? [],
            boundValues,
            query,
          ) as T | null
        }

        if (
          query.includes('FROM users u') &&
          query.includes('JOIN devices d')
        ) {
          return findKnownDeviceRow(options, boundValues) as T | null
        }

        if (query.includes('FROM devices')) {
          return findDeviceRow(
            options.devices ?? [],
            boundValues,
            query,
          ) as T | null
        }

        if (query.includes('FROM user_totp')) {
          return (options.userTotp ?? null) as T | null
        }

        if (query.includes('FROM totp_challenges')) {
          return (options.totpChallenge ?? null) as T | null
        }

        if (query.includes('FROM users')) {
          return findAuthUser(options, query, boundValues) as T | null
        }

        if (query.includes('FROM schema_migrations')) {
          if (!schemaVersion) {
            return null
          }

          const row = {
            version: schemaVersion,
            appliedAt: '2026-07-06T00:00:00.000Z',
          }

          return (column ? row[column as keyof typeof row] : row) as T
        }

        return null
      },
      async all<T = unknown>(): Promise<D1Result<T>> {
        if (query.includes('FROM auth_requests')) {
          return {
            success: true,
            results: filterAuthRequestRows(
              options.authRequests ?? [],
              boundValues,
              query,
            ) as T[],
            meta: fakeMeta,
          }
        }

        if (query.includes('FROM cipher_attachments')) {
          return {
            success: true,
            results: filterAttachmentRows(
              options.attachments ?? [],
              boundValues,
              query,
            ) as T[],
            meta: fakeMeta,
          }
        }

        if (query.includes('FROM ciphers')) {
          return {
            success: true,
            results: filterRowsByQuery(
              options.ciphers ?? [],
              boundValues,
              query,
            ) as T[],
            meta: fakeMeta,
          }
        }

        if (query.includes('FROM folders')) {
          return {
            success: true,
            results: filterRowsByQuery(
              options.folders ?? [],
              boundValues,
              query,
            ) as T[],
            meta: fakeMeta,
          }
        }

        if (query.includes('FROM devices')) {
          return {
            success: true,
            results: filterDeviceRows(
              options.devices ?? [],
              boundValues,
            ) as T[],
            meta: fakeMeta,
          }
        }

        if (query.includes('sqlite_master')) {
          return {
            success: true,
            results: tables.map((name) => ({ name }) as T),
            meta: fakeMeta,
          }
        }

        return {
          success: true,
          results: [],
          meta: fakeMeta,
        }
      },
      async run(): Promise<D1Result> {
        if (query.includes('INSERT INTO auth_requests')) {
          const changes = insertAuthRequest(options, boundValues)

          return {
            success: true,
            results: [],
            meta: { ...fakeMeta, changes },
          }
        }

        if (/UPDATE\s+auth_requests/.test(query)) {
          const changes = updateAuthRequest(options, boundValues, query)

          return {
            success: true,
            results: [],
            meta: { ...fakeMeta, changes },
          }
        }

        if (query.includes('DELETE FROM auth_requests')) {
          const changes = deleteRetainedAuthRequestRows(options, boundValues)

          return {
            success: true,
            results: [],
            meta: { ...fakeMeta, changes },
          }
        }

        if (/DELETE\s+FROM\s+refresh_tokens/.test(query)) {
          const deleted = deleteExpiredRefreshTokenRows(options, boundValues)

          refreshTokenCleanupDeletes.push({
            expiredBefore: String(boundValues[0]),
            limit: Number(boundValues[1]),
            deleted,
          })

          return {
            success: true,
            results: [],
            meta: { ...fakeMeta, changes: deleted },
          }
        }

        if (query.includes('INSERT OR IGNORE INTO users')) {
          const insertedUserChanges =
            options.userInsertChanges ??
            insertAuthUserIfStateful(options, boundValues)

          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: insertedUserChanges,
            },
          }
        }

        if (
          /UPDATE\s+users/.test(query) &&
          query.includes('display_name = ?')
        ) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: options.userUpdateChanges ?? 1,
            },
          }
        }

        if (query.includes('INSERT INTO ciphers')) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: options.cipherInsertChanges ?? 1,
            },
          }
        }

        if (query.includes('INSERT INTO cipher_attachments')) {
          const changes =
            options.attachmentInsertChanges ??
            insertCipherAttachment(options, boundValues, query)

          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes,
            },
          }
        }

        if (/UPDATE\s+cipher_attachments/.test(query)) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: updateCipherAttachment(options, boundValues, query),
            },
          }
        }

        if (/DELETE\s+FROM\s+cipher_attachments/.test(query)) {
          const changes =
            options.attachmentDeleteChanges === 0
              ? 0
              : deleteCipherAttachments(options, boundValues, query)

          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes:
                options.attachmentDeleteChanges ??
                (options.attachments ? changes : 1),
            },
          }
        }

        if (query.includes('INSERT INTO user_totp')) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: options.userTotpInsertChanges ?? 1,
            },
          }
        }

        if (query.includes('INSERT INTO totp_challenges')) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: options.totpChallengeInsertChanges ?? 1,
            },
          }
        }

        if (/DELETE\s+FROM\s+ciphers/.test(query)) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: options.cipherPermanentDeleteChanges ?? 1,
            },
          }
        }

        if (/UPDATE\s+ciphers/.test(query)) {
          let changes = options.cipherUpdateChanges ?? 1

          if (
            options.ciphers &&
            query.includes('WHERE id = ? AND user_id = ?')
          ) {
            const id = String(boundValues[6] ?? '')
            const userId = String(boundValues[7] ?? '')
            changes = options.ciphers.some(
              (row) =>
                row.id === id && row.userId === userId && row.deletedAt == null,
            )
              ? changes
              : 0
          }

          if (query.includes('deleted_at = NULL')) {
            changes = options.cipherRestoreChanges ?? 1
          } else if (query.includes('deleted_at = ?')) {
            changes = options.cipherSoftDeleteChanges ?? 1
          }

          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes,
            },
          }
        }

        if (query.includes('INSERT INTO folders')) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: 1,
            },
          }
        }

        if (/UPDATE\s+folders/.test(query)) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: query.includes('deleted_at = ?')
                ? (options.folderDeleteChanges ?? 1)
                : (options.folderUpdateChanges ?? 1),
            },
          }
        }

        if (/UPDATE\s+refresh_tokens/.test(query)) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: options.refreshRotationChanges ?? 1,
            },
          }
        }

        if (/UPDATE\s+users/.test(query)) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: 1,
            },
          }
        }

        if (/UPDATE\s+user_totp/.test(query)) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: options.userTotpUpdateChanges ?? 1,
            },
          }
        }

        if (/DELETE\s+FROM\s+user_totp/.test(query)) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: options.userTotpDeleteChanges ?? 1,
            },
          }
        }

        if (/UPDATE\s+totp_challenges/.test(query)) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: options.totpChallengeUpdateChanges ?? 1,
            },
          }
        }

        if (query.includes('INSERT INTO auth_attempts')) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: 1,
            },
          }
        }

        if (/DELETE\s+FROM\s+auth_attempts/.test(query)) {
          return {
            success: true,
            results: [],
            meta: fakeMeta,
          }
        }

        if (
          /DELETE\s+FROM\s+auth_failure_buckets/.test(query) &&
          query.includes('WHERE bucket_key IN')
        ) {
          return {
            success: true,
            results: [],
            meta: fakeMeta,
          }
        }

        if (/DELETE\s+FROM\s+totp_challenges/.test(query)) {
          return {
            success: true,
            results: [],
            meta: fakeMeta,
          }
        }

        if (query.includes('INSERT INTO auth_failure_buckets')) {
          const bucketKey = String(boundValues[0])
          const now = String(boundValues[1])
          const firstFailureLockedUntil = boundValues[2] as string | null
          const windowThreshold = String(boundValues[4])
          const failureLimit = Number(boundValues[7])
          const lockedUntil = String(boundValues[8])
          const existing = authFailureBuckets.get(bucketKey)
          const existingWindowStartedAt =
            typeof existing?.windowStartedAt === 'string'
              ? existing.windowStartedAt
              : null
          const insideWindow =
            existingWindowStartedAt !== null &&
            existingWindowStartedAt >= windowThreshold
          const failedCount = insideWindow
            ? Number(existing?.failedCount ?? 0) + 1
            : 1
          const nextLockedUntil =
            failedCount >= failureLimit ? lockedUntil : firstFailureLockedUntil

          authFailureBuckets.set(bucketKey, {
            bucketKey,
            failedCount,
            windowStartedAt: insideWindow ? existingWindowStartedAt : now,
            lockedUntil: nextLockedUntil,
            updatedAt: now,
          })

          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: 1,
            },
          }
        }

        if (query.includes('INSERT INTO audit_events')) {
          if (options.auditEventInsertThrows) {
            throw new Error('audit event insert failed')
          }

          auditEventInserts.push({
            id: String(boundValues[0]),
            schemaVersion: Number(boundValues[1]),
            name: String(boundValues[2]),
            outcome: String(boundValues[3]),
            requestId: String(boundValues[4]),
            occurredAt: String(boundValues[5]),
            actorUserId:
              boundValues[6] === null ? null : String(boundValues[6]),
            actorDeviceIdentifier:
              boundValues[7] === null ? null : String(boundValues[7]),
            targetType: boundValues[8] === null ? null : String(boundValues[8]),
            targetId: boundValues[9] === null ? null : String(boundValues[9]),
            contextJson:
              boundValues[10] === null ? null : String(boundValues[10]),
          })

          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: 1,
            },
          }
        }

        if (query.includes('INSERT INTO request_quota_buckets')) {
          if (options.requestQuotaInsertThrows) {
            throw new Error('request quota insert failed')
          }

          const now = String(boundValues[4])
          const windowThreshold = String(boundValues[5])
          const blockedUntil = String(boundValues[9])
          requestQuotaWrites.push({
            bucketKey: String(boundValues[0]),
            scope: String(boundValues[1]),
            limit: Number(boundValues[8]),
            windowSeconds:
              (Date.parse(now) - Date.parse(windowThreshold)) / 1000,
            blockSeconds: (Date.parse(blockedUntil) - Date.parse(now)) / 1000,
          })

          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: 1,
            },
          }
        }

        if (query.includes('INSERT INTO inquiry_threads')) {
          if (options.inquiryInsertThrows) {
            throw new Error('inquiry insert failed')
          }

          inquiryThreadInserts.push({
            id: String(boundValues[0]),
            mailbox: String(boundValues[1]),
            threadKey: String(boundValues[2]),
            senderHash: String(boundValues[3]),
            subjectPreview:
              boundValues[4] === null ? null : String(boundValues[4]),
            status: String(boundValues[5]),
            retentionDeadline: String(boundValues[6]),
            createdAt: String(boundValues[7]),
            updatedAt: String(boundValues[8]),
          })

          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: 1,
            },
          }
        }

        if (query.includes('INSERT INTO inquiry_messages')) {
          if (options.inquiryInsertThrows) {
            throw new Error('inquiry insert failed')
          }

          inquiryMessageInserts.push({
            id: String(boundValues[0]),
            threadId: String(boundValues[1]),
            direction: String(boundValues[2]),
            envelopeSenderHash: String(boundValues[3]),
            envelopeRecipient: String(boundValues[4]),
            messageIdHash:
              boundValues[5] === null ? null : String(boundValues[5]),
            inReplyToHash:
              boundValues[6] === null ? null : String(boundValues[6]),
            referencesHash:
              boundValues[7] === null ? null : String(boundValues[7]),
            subjectPreview:
              boundValues[8] === null ? null : String(boundValues[8]),
            rawSize: Number(boundValues[9]),
            contentType:
              boundValues[10] === null ? null : String(boundValues[10]),
            hasAttachmentHint: boundValues[11] === 1,
            bodyStorageState: String(boundValues[12]),
            rawBodyStored: boundValues[13] === 1,
            rawObjectKey:
              boundValues[14] === null ? null : String(boundValues[14]),
            attachmentStorageState: String(boundValues[15]),
            deliveryStatus: String(boundValues[16]),
            rejectionReason:
              boundValues[17] === null ? null : String(boundValues[17]),
            forwardAttempted: boundValues[18] === 1,
            forwardedAt:
              boundValues[19] === null ? null : String(boundValues[19]),
            receivedAt: String(boundValues[20]),
            retentionDeadline: String(boundValues[21]),
            createdAt: String(boundValues[22]),
          })

          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: 1,
            },
          }
        }

        if (query.includes('INSERT INTO inquiry_events')) {
          if (options.inquiryInsertThrows) {
            throw new Error('inquiry insert failed')
          }

          inquiryEventInserts.push({
            id: String(boundValues[0]),
            threadId: String(boundValues[1]),
            messageId: String(boundValues[2]),
            name: String(boundValues[3]),
            outcome: String(boundValues[4]),
            occurredAt: String(boundValues[5]),
            metadataJson:
              boundValues[6] === null ? null : String(boundValues[6]),
            createdAt: String(boundValues[7]),
          })

          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: 1,
            },
          }
        }

        if (
          /UPDATE\s+inquiry_messages/.test(query) &&
          query.includes("delivery_status = 'forwarded'")
        ) {
          if (options.inquiryForwardUpdateThrows) {
            throw new Error('inquiry forward update failed')
          }

          inquiryMessageForwardUpdates.push({
            forwardedAt: String(boundValues[0]),
            messageId: String(boundValues[1]),
          })

          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: 1,
            },
          }
        }

        if (/DELETE\s+FROM\s+request_quota_buckets/.test(query)) {
          requestQuotaCleanupDeletes.push({
            expiredBefore: String(boundValues[0]),
            now: String(boundValues[1]),
            limit: Number(boundValues[2]),
          })

          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: options.requestQuotaCleanupChanges ?? 1,
            },
          }
        }

        if (/DELETE\s+FROM\s+audit_events/.test(query)) {
          auditEventCleanupDeletes.push({
            expiredBefore: String(boundValues[0]),
            limit: Number(boundValues[1]),
          })

          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: options.auditEventCleanupChanges ?? 1,
            },
          }
        }

        if (/DELETE\s+FROM\s+auth_failure_buckets/.test(query)) {
          const bucketKey = String(boundValues[0])

          authFailureBuckets.delete(bucketKey)
          deletedAuthFailureBucketKeys.push(bucketKey)

          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: 1,
            },
          }
        }

        if (
          /UPDATE\s+devices/.test(query) &&
          query.includes('name = ?') &&
          query.includes('type = ?')
        ) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: options.deviceUpdateChanges ?? 1,
            },
          }
        }

        if (
          /UPDATE\s+devices/.test(query) &&
          query.includes('encrypted_user_key = ?')
        ) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: options.deviceUpdateChanges ?? 1,
            },
          }
        }

        if (
          /UPDATE\s+devices/.test(query) &&
          query.includes('revoked_at = ?')
        ) {
          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes: options.deviceRevokeChanges ?? 1,
            },
          }
        }

        return { success: true, results: [], meta: fakeMeta }
      },
      async raw<T = unknown>(): Promise<T[]> {
        return []
      },
    } as unknown as D1PreparedStatement

    return statement
  }

  async batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    const fakeStatements = statements as unknown as Array<{
      __fakeQuery: string
      __fakeBoundValues: unknown[]
    }>
    const expireStatement = fakeStatements.find(
      (statement) =>
        /UPDATE\s+auth_requests/.test(statement.__fakeQuery) &&
        /SET\s+status\s*=\s*'expired'/.test(statement.__fakeQuery) &&
        statement.__fakeQuery.includes('user_id = ?') &&
        statement.__fakeQuery.includes('request_device_identifier = ?') &&
        statement.__fakeQuery.includes("status = 'pending'") &&
        statement.__fakeQuery.includes('expires_at <= ?'),
    )
    const supersedeStatement = fakeStatements.find(
      (statement) =>
        /UPDATE\s+auth_requests/.test(statement.__fakeQuery) &&
        /SET\s+status\s*=\s*'superseded'/.test(statement.__fakeQuery),
    )
    const createStatement = fakeStatements.find((statement) =>
      statement.__fakeQuery.includes('INSERT INTO auth_requests'),
    )

    if (expireStatement && supersedeStatement && createStatement) {
      const rows = this.options.authRequests
      const snapshots = rows?.map((row) => ({ row, values: { ...row } }))

      try {
        return fakeStatements.map((statement) => {
          let changes = 0

          if (
            statement === expireStatement ||
            statement === supersedeStatement
          ) {
            changes = updateAuthRequest(
              this.options,
              statement.__fakeBoundValues,
              statement.__fakeQuery,
            )
          } else if (statement === createStatement) {
            changes = insertAuthRequest(
              this.options,
              statement.__fakeBoundValues,
            )
            if (changes !== 1) {
              throw new Error('Auth request insert failed')
            }
          }

          return {
            success: true,
            results: [],
            meta: { ...fakeMeta, changes },
          }
        })
      } catch (error) {
        if (rows && snapshots) {
          for (const { row, values } of snapshots) {
            for (const key of Object.keys(row)) {
              delete row[key]
            }
            Object.assign(row, values)
          }
          rows.splice(0, rows.length, ...snapshots.map(({ row }) => row))
        }

        throw error
      }
    }

    const consumeStatement = fakeStatements.find(
      (statement) =>
        /UPDATE\s+auth_requests/.test(statement.__fakeQuery) &&
        /SET\s+status\s*=\s*'consumed'/.test(statement.__fakeQuery) &&
        statement.__fakeQuery.includes('consumed_at = ?'),
    )
    if (consumeStatement && this.options.authRequests) {
      const values = consumeStatement.__fakeBoundValues
      const row = this.options.authRequests.find(
        (candidate) =>
          candidate.id === values[2] &&
          candidate.userId === values[3] &&
          candidate.requestDeviceIdentifier === values[4] &&
          candidate.accessCodeHash === values[5] &&
          candidate.status === 'approved' &&
          String(candidate.expiresAt) > String(values[6]),
      )
      const changes = row ? 1 : 0
      if (row) {
        Object.assign(row, {
          status: 'consumed',
          consumedAt: values[0],
          updatedAt: values[1],
        })
      }

      return statements.map(() => ({
        success: true,
        results: [],
        meta: { ...fakeMeta, changes },
      }))
    }

    return statements.map(() => ({
      success: true,
      results: [],
      meta: {
        ...fakeMeta,
        changes: this.options.deviceUpdateChanges ?? 1,
      },
    }))
  }
}

function insertAuthUserIfStateful(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
): number {
  if (!options.authUsers) {
    return 1
  }

  const insertedUser = buildInsertedAuthUser(boundValues)
  const duplicate = options.authUsers.some(
    (user) =>
      user.id === insertedUser.id ||
      user.emailNormalized === insertedUser.emailNormalized,
  )

  if (duplicate) {
    return 0
  }

  options.authUsers.push(insertedUser)
  return 1
}

function buildInsertedAuthUser(
  boundValues: unknown[],
): Record<string, unknown> {
  const revisionDate =
    stringOrNull(boundValues[13]) ?? new Date(0).toISOString()

  return {
    id: String(boundValues[0]),
    email: String(boundValues[1]),
    emailNormalized: String(boundValues[2]),
    displayName: stringOrNull(boundValues[3]),
    kdfAlgorithm: String(boundValues[4]),
    kdfIterations: Number(boundValues[5]),
    kdfMemory: numberOrNull(boundValues[6]),
    kdfParallelism: numberOrNull(boundValues[7]),
    masterPasswordHash: String(boundValues[8]),
    userKey: stringOrNull(boundValues[9]),
    publicKey: stringOrNull(boundValues[10]),
    privateKey: stringOrNull(boundValues[11]),
    securityStamp: String(boundValues[12]),
    revisionDate,
    createdAt: revisionDate,
    disabledAt: null,
    loginFailedCount: 0,
    loginFailedAt: null,
    loginLockedUntil: null,
    totpEnabled: false,
    totpEncryptedSecret: null,
    totpLastAcceptedStep: null,
  }
}

function stringOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value)
}

function findAuthUser(
  options: FakeD1DatabaseOptions,
  query: string,
  boundValues: unknown[],
): Record<string, unknown> | null {
  if (!options.authUsers) {
    return options.authUser ?? null
  }

  const lookupValue = String(boundValues[0] ?? '')
  if (query.includes('u.email_normalized = ?')) {
    return (
      options.authUsers.find((user) => user.emailNormalized === lookupValue) ??
      null
    )
  }

  if (query.includes('u.id = ?')) {
    return options.authUsers.find((user) => user.id === lookupValue) ?? null
  }

  return options.authUsers[0] ?? null
}

function findKnownDeviceRow(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
): Record<string, unknown> | null {
  const emailNormalized = String(boundValues[0] ?? '')
  const identifier = String(boundValues[1] ?? '')
  const users =
    options.authUsers ?? (options.authUser ? [options.authUser] : [])
  const user = users.find(
    (candidate) =>
      candidate.emailNormalized === emailNormalized && !candidate.disabledAt,
  )

  if (!user) {
    return null
  }

  const known = filterDeviceRows(options.devices ?? [], [user.id]).some(
    (row) => row.identifier === identifier,
  )

  return known ? { found: 1 } : null
}

function findLatestRevisionDate(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
): string | null {
  const userId = String(boundValues[0] ?? '')
  const revisions: string[] = []
  const users =
    options.authUsers ?? (options.authUser ? [options.authUser] : [])

  for (const user of users) {
    if (user.id === userId && typeof user.revisionDate === 'string') {
      revisions.push(user.revisionDate)
    }
  }

  for (const row of [...(options.folders ?? []), ...(options.ciphers ?? [])]) {
    if (row.userId === userId && typeof row.revisionDate === 'string') {
      revisions.push(row.revisionDate)
    }
  }

  return revisions.sort().at(-1) ?? null
}

function filterRowsByUserId(
  rows: Record<string, unknown>[],
  boundValues: unknown[],
): Record<string, unknown>[] {
  if (boundValues.length === 0) {
    return rows
  }

  const userId = String(boundValues[0])
  return rows.filter((row) => row.userId === userId)
}

function filterRowsByQuery(
  rows: Record<string, unknown>[],
  boundValues: unknown[],
  query: string,
): Record<string, unknown>[] {
  let scopedRows = applyDeletedFilter(
    filterRowsByUserId(rows, boundValues),
    query,
  ).sort(compareRevisionThenId)

  if (query.includes('(revision_date > ? OR (revision_date = ? AND id > ?))')) {
    const cursorRevisionDate = String(boundValues[1] ?? '')
    const cursorId = String(boundValues[3] ?? '')

    scopedRows = scopedRows.filter((row) => {
      const revisionDate = String(row.revisionDate ?? '')
      const id = String(row.id ?? '')

      return (
        revisionDate > cursorRevisionDate ||
        (revisionDate === cursorRevisionDate && id > cursorId)
      )
    })
  }

  if (query.includes('LIMIT ?')) {
    const limit = Number(boundValues.at(-1))
    if (Number.isSafeInteger(limit) && limit >= 0) {
      scopedRows = scopedRows.slice(0, limit)
    }
  }

  return scopedRows
}

function compareRevisionThenId(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): number {
  const leftRevisionDate = String(left.revisionDate ?? '')
  const rightRevisionDate = String(right.revisionDate ?? '')

  if (leftRevisionDate !== rightRevisionDate) {
    return leftRevisionDate < rightRevisionDate ? -1 : 1
  }

  const leftId = String(left.id ?? '')
  const rightId = String(right.id ?? '')

  if (leftId === rightId) {
    return 0
  }

  return leftId < rightId ? -1 : 1
}

function applyDeletedFilter(
  rows: Record<string, unknown>[],
  query: string,
): Record<string, unknown>[] {
  if (query.includes('deleted_at IS NULL')) {
    return rows.filter((row) => row.deletedAt == null)
  }

  if (query.includes('deleted_at IS NOT NULL')) {
    return rows.filter((row) => row.deletedAt != null)
  }

  return rows
}

function findScopedRow(
  rows: Record<string, unknown>[],
  boundValues: unknown[],
  query: string,
): Record<string, unknown> | null {
  const scopedRows = applyDeletedFilter(rows, query)

  if (boundValues.length >= 2) {
    const id = String(boundValues[0])
    const userId = String(boundValues[1])

    return (
      scopedRows.find((row) => row.id === id && row.userId === userId) ?? null
    )
  }

  return scopedRows[0] ?? null
}

function findScopedAttachmentRow(
  rows: Record<string, unknown>[],
  boundValues: unknown[],
): Record<string, unknown> | null {
  const id = String(boundValues[0] ?? '')
  const cipherId = String(boundValues[1] ?? '')
  const userId = String(boundValues[2] ?? '')

  return (
    rows.find(
      (row) =>
        row.id === id && row.cipherId === cipherId && row.userId === userId,
    ) ?? null
  )
}

function filterAttachmentRows(
  rows: Record<string, unknown>[],
  boundValues: unknown[],
  query: string,
): Record<string, unknown>[] {
  const userId = String(boundValues[0] ?? '')

  return rows
    .filter((row) => row.userId === userId)
    .filter(
      (row) =>
        !query.includes('content_type IS NOT NULL') || row.contentType != null,
    )
    .sort(compareRevisionThenId)
}

function calculateAttachmentStorageBytes(
  rows: Record<string, unknown>[],
  boundValues: unknown[],
  query: string,
): number {
  const userId = String(boundValues[0] ?? '')
  const expiredBefore = String(boundValues[1] ?? '')

  return rows
    .filter((row) => row.userId === userId)
    .filter((row) => {
      if (row.contentType != null) {
        return true
      }

      return (
        query.includes('content_type IS NULL') &&
        String(row.updatedAt ?? '') > expiredBefore
      )
    })
    .reduce((total, row) => total + Number(row.size ?? 0), 0)
}

function insertCipherAttachment(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
  query: string,
): number {
  if (!options.attachments) {
    return 1
  }

  const id = String(boundValues[0])
  if (options.attachments.some((row) => row.id === id)) {
    return 0
  }

  if (query.includes('SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?')) {
    const requestedSize = Number(boundValues[11])
    const userId = String(boundValues[12])
    const expiredBefore = String(boundValues[13])
    const maxStorageBytes = Number(boundValues[14])
    const reservedStorage = calculateAttachmentStorageBytes(
      options.attachments,
      [userId, expiredBefore],
      'content_type IS NOT NULL content_type IS NULL',
    )

    if (reservedStorage + requestedSize > maxStorageBytes) {
      return 0
    }
  }

  const contentType =
    boundValues[7] === null || boundValues[7] === undefined
      ? null
      : String(boundValues[7])
  const updatedAt = String(boundValues[10])
  options.attachments.push({
    id,
    userId: String(boundValues[1]),
    cipherId: String(boundValues[2]),
    objectKey: String(boundValues[3]),
    fileName: String(boundValues[4]),
    attachmentKey: String(boundValues[5]),
    size: Number(boundValues[6]),
    contentType,
    uploadState: contentType === null ? 'pending' : 'uploaded',
    pendingExpiresAt:
      contentType === null ? pendingAttachmentExpiresAt(updatedAt) : null,
    revisionDate: String(boundValues[8]),
    createdAt: String(boundValues[9]),
    updatedAt,
  })

  return 1
}

function updateCipherAttachment(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
  query: string,
): number {
  if (!options.attachments) {
    return 1
  }

  if (query.includes('SET updated_at = ?')) {
    const [updatedAt, id, cipherId, userId, expiredBefore] = boundValues
    const requestedSize = Number(boundValues[5])
    const maxStorageBytes = Number(boundValues[9])
    const row = options.attachments.find(
      (candidate) =>
        candidate.id === id &&
        candidate.cipherId === cipherId &&
        candidate.userId === userId &&
        candidate.contentType === null &&
        String(candidate.updatedAt ?? '') > String(expiredBefore),
    )
    if (!row) {
      return 0
    }

    const otherReservedStorage = options.attachments
      .filter((candidate) => candidate.userId === userId && candidate.id !== id)
      .filter(
        (candidate) =>
          candidate.contentType != null ||
          String(candidate.updatedAt ?? '') > String(expiredBefore),
      )
      .reduce((total, candidate) => total + Number(candidate.size ?? 0), 0)
    if (otherReservedStorage + requestedSize > maxStorageBytes) {
      return 0
    }

    Object.assign(row, {
      updatedAt,
      pendingExpiresAt: pendingAttachmentExpiresAt(String(updatedAt)),
    })
    return 1
  }

  const [contentType, revisionDate, updatedAt, id, cipherId, userId] =
    boundValues
  const row = options.attachments.find(
    (candidate) =>
      candidate.id === id &&
      candidate.cipherId === cipherId &&
      candidate.userId === userId &&
      candidate.contentType === null,
  )
  if (!row) {
    return 0
  }

  Object.assign(row, {
    contentType,
    uploadState: 'uploaded',
    pendingExpiresAt: null,
    revisionDate,
    updatedAt,
  })
  return 1
}

function deleteCipherAttachments(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
  query: string,
): number {
  if (!options.attachments) {
    return 1
  }

  if (query.includes('WHERE id IN')) {
    const expiredBefore = String(boundValues[0])
    const limit = Number(boundValues[1])
    const ids = options.attachments
      .filter(
        (row) =>
          row.contentType === null &&
          String(row.updatedAt ?? '') <= expiredBefore,
      )
      .sort((left, right) => {
        const expiryComparison = String(left.updatedAt).localeCompare(
          String(right.updatedAt),
        )
        return (
          expiryComparison || String(left.id).localeCompare(String(right.id))
        )
      })
      .slice(0, limit)
      .map((row) => row.id)

    options.attachments.splice(
      0,
      options.attachments.length,
      ...options.attachments.filter((row) => !ids.includes(row.id)),
    )
    return ids.length
  }

  const [id, cipherId, userId] = boundValues
  const index = options.attachments.findIndex(
    (row) =>
      row.id === id && row.cipherId === cipherId && row.userId === userId,
  )
  if (index < 0) {
    return 0
  }

  options.attachments.splice(index, 1)
  return 1
}

function findDeviceRow(
  rows: Record<string, unknown>[],
  boundValues: unknown[],
  query: string,
): Record<string, unknown> | null {
  const lookupValue = String(boundValues[1] ?? '')
  const scopedRows = filterDeviceRows(rows, boundValues)

  if (lookupValue) {
    if (query.includes('identifier = ?')) {
      return scopedRows.find((row) => row.identifier === lookupValue) ?? null
    }

    if (query.includes('id = ?')) {
      return scopedRows.find((row) => row.id === lookupValue) ?? null
    }

    return scopedRows.find((row) => row.id === lookupValue) ?? null
  }

  return scopedRows[0] ?? null
}

function findAuthRequestRow(
  rows: Record<string, unknown>[],
  boundValues: unknown[],
  query: string,
): Record<string, unknown> | null {
  const id = String(boundValues[0] ?? '')
  const row = rows.find((candidate) => candidate.id === id)
  if (!row) {
    return null
  }

  if (query.includes('user_id = ?') && row.userId !== boundValues[1]) {
    return null
  }

  if (
    /status\s+IN\s+\('pending',\s*'approved',\s*'denied'\)/.test(query) &&
    row.status !== 'pending' &&
    row.status !== 'approved' &&
    row.status !== 'denied'
  ) {
    return null
  }

  const now = String(boundValues.at(-1) ?? '')
  if (query.includes('expires_at > ?') && String(row.expiresAt) <= now) {
    return null
  }

  return row
}

function filterAuthRequestRows(
  rows: Record<string, unknown>[],
  boundValues: unknown[],
  query: string,
): Record<string, unknown>[] {
  const userId = String(boundValues[0] ?? '')
  const now = String(boundValues[1] ?? '')

  return rows
    .filter((row) => row.userId === userId)
    .filter(
      (row) =>
        !query.includes("status = 'pending'") || row.status === 'pending',
    )
    .filter(
      (row) => !query.includes('expires_at > ?') || String(row.expiresAt) > now,
    )
}

function insertAuthRequest(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
): number {
  if (!options.authRequests) {
    return 1
  }

  const id = String(boundValues[0])
  if (options.authRequests.some((row) => row.id === id)) {
    return 0
  }

  const userId =
    boundValues[1] === null || boundValues[1] === undefined
      ? null
      : String(boundValues[1])
  const requestDeviceIdentifier = String(boundValues[4])
  if (
    userId !== null &&
    options.authRequests.some(
      (row) =>
        row.userId === userId &&
        row.requestDeviceIdentifier === requestDeviceIdentifier &&
        row.status === 'pending',
    )
  ) {
    throw new Error(
      'UNIQUE constraint failed: auth_requests.user_id, auth_requests.request_device_identifier',
    )
  }

  options.authRequests.push({
    id,
    userId,
    emailHash: String(boundValues[2]),
    requestType: Number(boundValues[3]),
    requestDeviceIdentifier,
    requestDeviceType: Number(boundValues[5]),
    requestPublicKey: String(boundValues[6]),
    accessCodeHash: String(boundValues[7]),
    status: 'pending',
    requestApproved: null,
    approvingDeviceIdentifier: null,
    encryptedResponseKey: null,
    createdAt: String(boundValues[8]),
    responseAt: null,
    consumedAt: null,
    expiresAt: String(boundValues[9]),
    retentionDeleteAfter: String(boundValues[10]),
    updatedAt: String(boundValues[11]),
  })

  return 1
}

function updateAuthRequest(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
  query: string,
): number {
  if (!options.authRequests) {
    return 1
  }

  if (
    /SET\s+status\s*=\s*'expired'/.test(query) &&
    query.includes('user_id = ?') &&
    query.includes('request_device_identifier = ?')
  ) {
    const [updatedAt, userId, requester, expiryThreshold] = boundValues
    const rows = options.authRequests.filter(
      (candidate) =>
        candidate.userId === userId &&
        candidate.requestDeviceIdentifier === requester &&
        candidate.status === 'pending' &&
        String(candidate.expiresAt) <= String(expiryThreshold),
    )

    for (const row of rows) {
      Object.assign(row, { status: 'expired', updatedAt })
    }

    return rows.length
  }

  if (/SET\s+status\s*=\s*'superseded'/.test(query)) {
    const [updatedAt, userId, requester, now, excludedId] = boundValues
    const rows = options.authRequests.filter(
      (candidate) =>
        candidate.userId === userId &&
        candidate.requestDeviceIdentifier === requester &&
        candidate.status === 'pending' &&
        String(candidate.expiresAt) > String(now) &&
        candidate.id !== excludedId,
    )

    for (const row of rows) {
      Object.assign(row, {
        status: 'superseded',
        requestApproved: 0,
        updatedAt,
      })
    }

    return rows.length
  }

  if (/SET\s+status = 'approved'/.test(query)) {
    const [approver, encryptedKey, now, , id, userId, , requester] = boundValues
    const row = options.authRequests.find(
      (candidate) =>
        candidate.id === id &&
        candidate.userId === userId &&
        candidate.status === 'pending' &&
        candidate.requestDeviceIdentifier !== requester &&
        String(candidate.expiresAt) > String(now),
    )
    if (!row) return 0
    Object.assign(row, {
      status: 'approved',
      requestApproved: 1,
      approvingDeviceIdentifier: approver,
      encryptedResponseKey: encryptedKey,
      responseAt: now,
      updatedAt: now,
    })
    return 1
  }

  if (/SET\s+status = 'denied'/.test(query)) {
    const [approver, now, , id, userId, , requester] = boundValues
    const row = options.authRequests.find(
      (candidate) =>
        candidate.id === id &&
        candidate.userId === userId &&
        candidate.status === 'pending' &&
        candidate.requestDeviceIdentifier !== requester &&
        String(candidate.expiresAt) > String(now),
    )
    if (!row) return 0
    Object.assign(row, {
      status: 'denied',
      requestApproved: 0,
      approvingDeviceIdentifier: approver,
      encryptedResponseKey: null,
      responseAt: now,
      updatedAt: now,
    })
    return 1
  }

  if (/SET\s+status = 'expired'/.test(query)) {
    const [now, expiryThreshold, rawLimit] = boundValues
    const limit = Number(rawLimit)
    const rows = options.authRequests
      .filter(
        (candidate) =>
          (candidate.status === 'pending' || candidate.status === 'approved') &&
          String(candidate.expiresAt) <= String(expiryThreshold),
      )
      .slice(0, limit)

    for (const row of rows) {
      Object.assign(row, { status: 'expired', updatedAt: now })
    }

    return rows.length
  }

  return 0
}

function deleteRetainedAuthRequestRows(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
): number {
  if (!options.authRequests) {
    return 0
  }

  const [retentionThreshold, rawLimit] = boundValues
  const limit = Number(rawLimit)
  const ids = options.authRequests
    .filter(
      (row) =>
        (row.status === 'denied' ||
          row.status === 'consumed' ||
          row.status === 'expired' ||
          row.status === 'superseded') &&
        String(row.retentionDeleteAfter) <= String(retentionThreshold),
    )
    .slice(0, limit)
    .map((row) => row.id)

  options.authRequests.splice(
    0,
    options.authRequests.length,
    ...options.authRequests.filter((row) => !ids.includes(row.id)),
  )

  return ids.length
}

function deleteExpiredRefreshTokenRows(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
): number {
  if (!options.refreshTokens) {
    return 0
  }

  const [expiredBefore, rawLimit] = boundValues
  const deletedIds = new Set(
    options.refreshTokens
      .filter((row) => String(row.expiresAt) <= String(expiredBefore))
      .sort((left, right) =>
        String(left.expiresAt).localeCompare(String(right.expiresAt)),
      )
      .slice(0, Number(rawLimit))
      .map((row) => row.id),
  )

  options.refreshTokens.splice(
    0,
    options.refreshTokens.length,
    ...options.refreshTokens.filter((row) => !deletedIds.has(row.id)),
  )

  for (const row of options.refreshTokens) {
    if (deletedIds.has(row.rotatedFromTokenId)) {
      row.rotatedFromTokenId = null
    }
  }

  return deletedIds.size
}

function filterDeviceRows(
  rows: Record<string, unknown>[],
  boundValues: unknown[],
): Record<string, unknown>[] {
  return filterRowsByUserId(rows, boundValues).filter((row) => {
    const revokedAt = row.revokedAt ?? row.revoked_at

    return revokedAt === null || revokedAt === undefined
  })
}

export const requiredTables = [
  'schema_migrations',
  'users',
  'devices',
  'refresh_tokens',
  'auth_attempts',
  'auth_failure_buckets',
  'request_quota_buckets',
  'folders',
  'ciphers',
  'cipher_attachments',
  'audit_events',
  'user_totp',
  'totp_challenges',
] as const

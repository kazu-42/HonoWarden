import { pendingAttachmentExpiresAt } from '../../src/domain/attachment'
import { preloginKdfPolicy } from '../../src/domain/prelogin'

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
  credentialRotationConflict?: boolean
  credentialRotationFailureAt?:
    'user' | 'devices' | 'refresh_tokens' | 'auth_requests' | 'audit'
  requestQuotaBucket?: Record<string, unknown> | null
  requestQuotaCleanupChanges?: number
  requestQuotaInsertThrows?: boolean
  inquiryForwardUpdateThrows?: boolean
  inquiryInsertThrows?: boolean
  organizations?: Record<string, unknown>[]
  organizationUsers?: Record<string, unknown>[]
  collections?: Record<string, unknown>[]
  collectionUsers?: Record<string, unknown>[]
  collectionCiphers?: Record<string, unknown>[]
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
        if (
          query.includes('FROM organization_users membership') &&
          query.includes('membership.id as organizationUserId') &&
          query.includes('membership.organization_id = ?') &&
          query.includes('membership.user_id = ?') &&
          query.includes('membership.status = 2') &&
          query.includes('membership.type = 0')
        ) {
          return findConfirmedOrganizationOwnerRow(
            options,
            boundValues,
          ) as T | null
        }

        if (
          query.includes('FROM organizations organization') &&
          query.includes('INNER JOIN organization_users membership') &&
          query.includes('organization.id = ?') &&
          query.includes('membership.user_id = ?') &&
          query.includes('membership.status = 2')
        ) {
          return findConfirmedOrganizationRow(options, boundValues) as T | null
        }

        if (
          query.includes('FROM collections collection') &&
          query.includes('collection.id = ?') &&
          query.includes('collection.organization_id = ?') &&
          query.includes('membership.user_id = ?') &&
          query.includes('membership.status = 2') &&
          query.includes('INNER JOIN collection_users collection_user')
        ) {
          return findAccessibleOrganizationCollectionRow(
            options,
            boundValues,
            query.includes('membership.type = 0') &&
              query.includes('collection_user.manage = 1'),
          ) as T | null
        }

        if (
          query.includes('FROM organization_users membership') &&
          query.includes('INNER JOIN collection_ciphers collection_cipher') &&
          query.includes('collection_user.manage = 1') &&
          query.includes(
            'collection.organization_id = membership.organization_id',
          ) &&
          query.includes('membership.user_id = ?') &&
          query.includes('membership.status = 2') &&
          query.includes('membership.organization_id = ?') &&
          query.includes('collection_cipher.cipher_id = ?')
        ) {
          return findManagedOrganizationCipherAccess(
            options,
            boundValues,
          ) as T | null
        }

        if (
          query.includes('FROM ciphers') &&
          query.includes('organization_id as organizationId') &&
          query.includes('WHERE id = ?')
        ) {
          return findCipherAccessRow(options, boundValues) as T | null
        }

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
        if (
          query.includes('WITH target AS') &&
          query.includes('FROM account_kdf_population')
        ) {
          return {
            success: true,
            results: listPreloginKdfRows(options, boundValues) as T[],
            meta: fakeMeta,
          }
        }

        if (
          query.includes('FROM organization_users membership') &&
          query.includes('INNER JOIN organizations organization') &&
          query.includes('membership.user_id = ?') &&
          query.includes('membership.status = 2')
        ) {
          return {
            success: true,
            results: listConfirmedOrganizationRows(options, boundValues) as T[],
            meta: fakeMeta,
          }
        }

        if (
          query.includes('FROM collections collection') &&
          query.includes('INNER JOIN collection_users collection_user') &&
          query.includes('INNER JOIN organization_users membership') &&
          query.includes(
            'membership.id = collection_user.organization_user_id',
          ) &&
          query.includes(
            'membership.organization_id = collection.organization_id',
          ) &&
          query.includes('membership.user_id = ?') &&
          query.includes('membership.status = 2')
        ) {
          return {
            success: true,
            results: listAccessibleOrganizationCollectionRows(
              options,
              boundValues,
              query,
            ) as T[],
            meta: fakeMeta,
          }
        }

        if (
          query.includes('FROM collections collection') &&
          query.includes('INNER JOIN organization_users owner_membership') &&
          query.includes('INNER JOIN organization_users assigned_membership') &&
          query.includes('assigned_membership.id as organizationUserId') &&
          query.includes('owner_membership.type = 0')
        ) {
          return {
            success: true,
            results: listOrganizationCollectionUserRowsForOwner(
              options,
              boundValues,
            ) as T[],
            meta: fakeMeta,
          }
        }

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
        if (/UPDATE\s+collections/.test(query)) {
          const changes = updateOrganizationCollectionRow(options, boundValues)

          return {
            success: true,
            results: [],
            meta: { ...fakeMeta, changes },
          }
        }

        if (/DELETE\s+FROM\s+collections/.test(query)) {
          const changes = query.includes('SELECT COUNT(*)')
            ? deleteManyOrganizationCollectionRows(options, boundValues, query)
            : deleteOrganizationCollectionRow(options, boundValues)

          return {
            success: true,
            results: [],
            meta: { ...fakeMeta, changes },
          }
        }

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
          const statefulChanges =
            options.cipherPermanentDeleteChanges === undefined
              ? mutateCipherRows(options, boundValues, query)
              : null

          return {
            success: true,
            results: [],
            meta: {
              ...fakeMeta,
              changes:
                statefulChanges ?? options.cipherPermanentDeleteChanges ?? 1,
            },
          }
        }

        if (/UPDATE\s+ciphers/.test(query)) {
          const explicitChanges = query.includes('deleted_at = NULL')
            ? options.cipherRestoreChanges
            : query.includes('deleted_at = ?')
              ? options.cipherSoftDeleteChanges
              : options.cipherUpdateChanges
          const statefulChanges =
            explicitChanges === undefined
              ? mutateCipherRows(options, boundValues, query)
              : null
          let changes = statefulChanges ?? explicitChanges ?? 1

          if (
            statefulChanges === null &&
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

          if (statefulChanges === null && query.includes('deleted_at = NULL')) {
            changes = options.cipherRestoreChanges ?? 1
          } else if (
            statefulChanges === null &&
            query.includes('deleted_at = ?')
          ) {
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

    if (isCredentialRotationBatch(fakeStatements)) {
      return applyCredentialRotationBatch(
        this.options,
        fakeStatements,
        this.auditEventInserts,
      ) as D1Result<T>[]
    }

    if (isOrganizationFoundationBatch(fakeStatements)) {
      return applyOrganizationFoundationBatch(
        this.options,
        fakeStatements,
      ) as D1Result<T>[]
    }

    if (isOrganizationCollectionBatch(fakeStatements)) {
      return applyOrganizationCollectionBatch(
        this.options,
        fakeStatements,
      ) as D1Result<T>[]
    }

    if (isOrganizationCollectionUpdateBatch(fakeStatements)) {
      return applyOrganizationCollectionUpdateBatch(
        this.options,
        fakeStatements,
      ) as D1Result<T>[]
    }

    if (isOrganizationCollectionDeleteBatch(fakeStatements)) {
      return applyOrganizationCollectionDeleteBatch(
        this.options,
        fakeStatements,
      ) as D1Result<T>[]
    }

    if (
      fakeStatements.every(
        (statement) =>
          statement.__fakeQuery.includes(
            'FROM cipher_attachments attachment',
          ) && statement.__fakeQuery.includes('INNER JOIN ciphers cipher'),
      )
    ) {
      return fakeStatements.map((statement) => ({
        success: true,
        results: findOwnedCipherAttachmentObjectKeys(
          this.options,
          statement.__fakeBoundValues,
        ) as T[],
        meta: fakeMeta,
      }))
    }

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

    if (
      fakeStatements.every(
        (statement) =>
          statement.__fakeQuery.includes('id IN (') &&
          statement.__fakeQuery.includes('user_id = ?') &&
          /(?:SELECT\s+id\s+FROM|UPDATE|DELETE\s+FROM)\s+ciphers/.test(
            statement.__fakeQuery,
          ),
      )
    ) {
      const results: D1Result<T>[] = []

      for (let index = 0; index < fakeStatements.length; index += 1) {
        const fakeStatement = fakeStatements[index]
        const statement = statements[index]

        if (!fakeStatement || !statement) {
          continue
        }

        if (/SELECT\s+id\s+FROM\s+ciphers/.test(fakeStatement.__fakeQuery)) {
          results.push({
            success: true,
            results: findBulkCipherIds(
              this.options,
              fakeStatement.__fakeBoundValues,
              fakeStatement.__fakeQuery,
            ) as T[],
            meta: fakeMeta,
          })
          continue
        }

        results.push(await statement.run<T>())
      }

      return results
    }

    if (
      fakeStatements.every((statement) =>
        /(?:UPDATE|DELETE\s+FROM)\s+ciphers/.test(statement.__fakeQuery),
      )
    ) {
      const results: D1Result<T>[] = []
      for (const statement of statements) {
        results.push(await statement.run<T>())
      }
      return results
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

function isCredentialRotationBatch(
  statements: FakePreparedStatement[],
): boolean {
  return (
    statements.length === 5 &&
    statements.some(
      (statement) =>
        /UPDATE\s+users/.test(statement.__fakeQuery) &&
        statement.__fakeQuery.includes('security_stamp = ?'),
    ) &&
    statements.some((statement) =>
      /UPDATE\s+devices/.test(statement.__fakeQuery),
    ) &&
    statements.some((statement) =>
      /UPDATE\s+refresh_tokens/.test(statement.__fakeQuery),
    ) &&
    statements.some((statement) =>
      /UPDATE\s+auth_requests/.test(statement.__fakeQuery),
    ) &&
    statements.some((statement) =>
      statement.__fakeQuery.includes('INSERT INTO audit_events'),
    )
  )
}

function applyCredentialRotationBatch(
  options: FakeD1DatabaseOptions,
  statements: FakePreparedStatement[],
  auditEventInserts: FakeAuditEventInsert[],
): D1Result[] {
  const userRows = uniqueRows([
    ...(options.authUser ? [options.authUser] : []),
    ...(options.authUsers ?? []),
  ])
  const snapshots = [
    ...userRows.map((row) => ({ row, values: { ...row } })),
    ...(options.devices ?? []).map((row) => ({ row, values: { ...row } })),
    ...(options.refreshTokens ?? []).map((row) => ({
      row,
      values: { ...row },
    })),
    ...(options.authRequests ?? []).map((row) => ({
      row,
      values: { ...row },
    })),
  ]
  const auditLength = auditEventInserts.length

  try {
    const userStatement = requiredFakeStatement(
      statements,
      (query) => /UPDATE\s+users/.test(query),
      'user',
    )
    const deviceStatement = requiredFakeStatement(
      statements,
      (query) => /UPDATE\s+devices/.test(query),
      'devices',
    )
    const refreshStatement = requiredFakeStatement(
      statements,
      (query) => /UPDATE\s+refresh_tokens/.test(query),
      'refresh_tokens',
    )
    const authRequestStatement = requiredFakeStatement(
      statements,
      (query) => /UPDATE\s+auth_requests/.test(query),
      'auth_requests',
    )
    const auditStatement = requiredFakeStatement(
      statements,
      (query) => query.includes('INSERT INTO audit_events'),
      'audit',
    )
    const userValues = userStatement.__fakeBoundValues
    const passwordChange =
      /SET\s+master_password_hash = \?,\s+user_key = \?/.test(
        userStatement.__fakeQuery,
      )
    const userSetClause = userStatement.__fakeQuery.slice(
      0,
      userStatement.__fakeQuery.indexOf('WHERE'),
    )
    const kdfChange =
      passwordChange && userSetClause.includes('kdf_algorithm = ?')
    const userIdIndex = kdfChange ? 9 : passwordChange ? 5 : 3
    const user = userRows.find((row) => row.id === userValues[userIdIndex])
    const generationMatches = kdfChange
      ? kdfChangeGenerationMatches(options, user, userValues)
      : passwordChange
        ? passwordChangeGenerationMatches(options, user, userValues)
        : securityStampGenerationMatches(options, user, userValues)
    const results = new Map<FakePreparedStatement, D1Result>()

    if (generationMatches && user) {
      if (passwordChange) {
        setFakeColumn(
          user,
          'masterPasswordHash',
          'master_password_hash',
          userValues[0],
        )
        setFakeColumn(user, 'userKey', 'user_key', userValues[1])
        if (kdfChange) {
          setFakeColumn(user, 'kdfAlgorithm', 'kdf_algorithm', userValues[2])
          setFakeColumn(user, 'kdfIterations', 'kdf_iterations', userValues[3])
          setFakeColumn(user, 'kdfMemory', 'kdf_memory', userValues[4])
          setFakeColumn(
            user,
            'kdfParallelism',
            'kdf_parallelism',
            userValues[5],
          )
          setFakeColumn(user, 'securityStamp', 'security_stamp', userValues[6])
          setFakeColumn(user, 'revisionDate', 'revision_date', userValues[7])
          setFakeColumn(user, 'updatedAt', 'updated_at', userValues[8])
        } else {
          setFakeColumn(user, 'securityStamp', 'security_stamp', userValues[2])
          setFakeColumn(user, 'revisionDate', 'revision_date', userValues[3])
          setFakeColumn(user, 'updatedAt', 'updated_at', userValues[4])
        }
      } else {
        setFakeColumn(user, 'securityStamp', 'security_stamp', userValues[0])
        setFakeColumn(user, 'revisionDate', 'revision_date', userValues[1])
        setFakeColumn(user, 'updatedAt', 'updated_at', userValues[2])
      }
    }
    failCredentialRotationAt(options, 'user')
    results.set(userStatement, {
      success: true,
      results: generationMatches && user ? [{ id: user.id }] : [],
      meta: {
        ...fakeMeta,
        changes: generationMatches ? (kdfChange ? 3 : 1) : 0,
      },
    })

    const deviceValues = deviceStatement.__fakeBoundValues
    const deviceChanges = generationMatches
      ? mutateActiveRows(
          options.devices ?? [],
          String(deviceValues[2]),
          String(deviceValues[0]),
          String(deviceValues[1]),
        )
      : 0
    failCredentialRotationAt(options, 'devices')
    results.set(deviceStatement, fakeResult(deviceChanges))

    const refreshValues = refreshStatement.__fakeBoundValues
    const refreshChanges = generationMatches
      ? mutateActiveRows(
          options.refreshTokens ?? [],
          String(refreshValues[1]),
          String(refreshValues[0]),
          null,
        )
      : 0
    failCredentialRotationAt(options, 'refresh_tokens')
    results.set(refreshStatement, fakeResult(refreshChanges))

    const authRequestValues = authRequestStatement.__fakeBoundValues
    const authRequestChanges = generationMatches
      ? supersedeActiveAuthRequests(
          options.authRequests ?? [],
          String(authRequestValues[1]),
          String(authRequestValues[0]),
        )
      : 0
    failCredentialRotationAt(options, 'auth_requests')
    results.set(authRequestStatement, fakeResult(authRequestChanges))

    if (generationMatches) {
      const values = auditStatement.__fakeBoundValues
      if (auditEventInserts.some((event) => event.id === values[0])) {
        throw new Error('duplicate credential rotation audit event')
      }
      auditEventInserts.push({
        id: String(values[0]),
        schemaVersion: Number(values[1]),
        name: String(values[2]),
        outcome: String(values[3]),
        requestId: String(values[4]),
        occurredAt: String(values[5]),
        actorUserId: nullableString(values[6]),
        actorDeviceIdentifier: nullableString(values[7]),
        targetType: nullableString(values[8]),
        targetId: nullableString(values[9]),
        contextJson: nullableString(values[10]),
      })
    }
    failCredentialRotationAt(options, 'audit')
    results.set(auditStatement, fakeResult(generationMatches ? 1 : 0))

    return statements.map(
      (statement) => results.get(statement) ?? fakeResult(0),
    )
  } catch (error) {
    for (const { row, values } of snapshots) {
      for (const key of Object.keys(row)) {
        delete row[key]
      }
      Object.assign(row, values)
    }
    auditEventInserts.splice(auditLength)
    throw error
  }
}

function securityStampGenerationMatches(
  options: FakeD1DatabaseOptions,
  user: Record<string, unknown> | undefined,
  values: unknown[],
): boolean {
  return (
    !options.credentialRotationConflict &&
    user != null &&
    fakeColumn(user, 'disabledAt', 'disabled_at') == null &&
    fakeColumn(user, 'masterPasswordHash', 'master_password_hash') ===
      values[4] &&
    fakeColumn(user, 'securityStamp', 'security_stamp') === values[5] &&
    fakeColumn(user, 'revisionDate', 'revision_date') === values[6]
  )
}

function passwordChangeGenerationMatches(
  options: FakeD1DatabaseOptions,
  user: Record<string, unknown> | undefined,
  values: unknown[],
): boolean {
  return (
    !options.credentialRotationConflict &&
    user != null &&
    fakeColumn(user, 'disabledAt', 'disabled_at') == null &&
    fakeColumn(user, 'masterPasswordHash', 'master_password_hash') ===
      values[6] &&
    fakeColumn(user, 'emailNormalized', 'email_normalized') === values[7] &&
    fakeColumn(user, 'kdfAlgorithm', 'kdf_algorithm') === values[8] &&
    fakeColumn(user, 'kdfIterations', 'kdf_iterations') === values[9] &&
    fakeColumn(user, 'kdfMemory', 'kdf_memory') === values[10] &&
    fakeColumn(user, 'kdfParallelism', 'kdf_parallelism') === values[11] &&
    fakeColumn(user, 'securityStamp', 'security_stamp') === values[12] &&
    fakeColumn(user, 'revisionDate', 'revision_date') === values[13]
  )
}

function kdfChangeGenerationMatches(
  options: FakeD1DatabaseOptions,
  user: Record<string, unknown> | undefined,
  values: unknown[],
): boolean {
  return (
    !options.credentialRotationConflict &&
    user != null &&
    fakeColumn(user, 'disabledAt', 'disabled_at') == null &&
    fakeColumn(user, 'masterPasswordHash', 'master_password_hash') ===
      values[10] &&
    fakeColumn(user, 'emailNormalized', 'email_normalized') === values[11] &&
    fakeColumn(user, 'kdfAlgorithm', 'kdf_algorithm') === values[12] &&
    fakeColumn(user, 'kdfIterations', 'kdf_iterations') === values[13] &&
    fakeColumn(user, 'kdfMemory', 'kdf_memory') === values[14] &&
    fakeColumn(user, 'kdfParallelism', 'kdf_parallelism') === values[15] &&
    fakeColumn(user, 'securityStamp', 'security_stamp') === values[16] &&
    fakeColumn(user, 'revisionDate', 'revision_date') === values[17]
  )
}

function requiredFakeStatement(
  statements: FakePreparedStatement[],
  matches: (query: string) => boolean,
  name: string,
): FakePreparedStatement {
  const statement = statements.find((candidate) =>
    matches(candidate.__fakeQuery),
  )
  if (!statement) {
    throw new Error(`credential rotation ${name} statement missing`)
  }
  return statement
}

function uniqueRows(
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  return [...new Set(rows)]
}

function fakeColumn(
  row: Record<string, unknown>,
  camelName: string,
  snakeName: string,
): unknown {
  return camelName in row ? row[camelName] : row[snakeName]
}

function setFakeColumn(
  row: Record<string, unknown>,
  camelName: string,
  snakeName: string,
  value: unknown,
): void {
  if (snakeName in row && !(camelName in row)) {
    row[snakeName] = value
  } else {
    row[camelName] = value
  }
}

function mutateActiveRows(
  rows: Record<string, unknown>[],
  userId: string,
  revokedAt: string,
  updatedAt: string | null,
): number {
  let changes = 0
  for (const row of rows) {
    if (
      fakeColumn(row, 'userId', 'user_id') !== userId ||
      fakeColumn(row, 'revokedAt', 'revoked_at') != null
    ) {
      continue
    }
    setFakeColumn(row, 'revokedAt', 'revoked_at', revokedAt)
    if (updatedAt !== null) {
      setFakeColumn(row, 'updatedAt', 'updated_at', updatedAt)
    }
    changes += 1
  }
  return changes
}

function supersedeActiveAuthRequests(
  rows: Record<string, unknown>[],
  userId: string,
  updatedAt: string,
): number {
  let changes = 0
  for (const row of rows) {
    const status = fakeColumn(row, 'status', 'status')
    if (
      fakeColumn(row, 'userId', 'user_id') !== userId ||
      (status !== 'pending' && status !== 'approved')
    ) {
      continue
    }

    setFakeColumn(row, 'status', 'status', 'superseded')
    setFakeColumn(row, 'requestApproved', 'request_approved', 0)
    setFakeColumn(row, 'encryptedResponseKey', 'encrypted_response_key', null)
    setFakeColumn(row, 'updatedAt', 'updated_at', updatedAt)
    changes += 1
  }
  return changes
}

function failCredentialRotationAt(
  options: FakeD1DatabaseOptions,
  stage: NonNullable<FakeD1DatabaseOptions['credentialRotationFailureAt']>,
): void {
  if (options.credentialRotationFailureAt === stage) {
    throw new Error(`credential rotation ${stage} failed`)
  }
}

function fakeResult(changes: number): D1Result {
  return {
    success: true,
    results: [],
    meta: { ...fakeMeta, changes },
  }
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

type FakePreparedStatement = {
  __fakeQuery: string
  __fakeBoundValues: unknown[]
}

function isOrganizationFoundationBatch(
  statements: FakePreparedStatement[],
): boolean {
  return (
    statements.length === 4 &&
    statements.some((statement) =>
      statement.__fakeQuery.includes('INSERT INTO organizations'),
    ) &&
    statements.some((statement) =>
      statement.__fakeQuery.includes('INSERT INTO organization_users'),
    ) &&
    statements.some((statement) =>
      statement.__fakeQuery.includes('INSERT INTO collections'),
    ) &&
    statements.some((statement) =>
      statement.__fakeQuery.includes('INSERT INTO collection_users'),
    )
  )
}

function isOrganizationCollectionBatch(
  statements: FakePreparedStatement[],
): boolean {
  return (
    statements.length === 3 &&
    statements.some((statement) =>
      /UPDATE\s+organizations/.test(statement.__fakeQuery),
    ) &&
    statements.some((statement) =>
      statement.__fakeQuery.includes('INSERT INTO collections'),
    ) &&
    statements.some((statement) =>
      statement.__fakeQuery.includes('INSERT INTO collection_users'),
    )
  )
}

function isOrganizationCollectionUpdateBatch(
  statements: FakePreparedStatement[],
): boolean {
  const revision = statements[0]?.__fakeQuery ?? ''
  const mutation = statements[1]?.__fakeQuery ?? ''

  return (
    statements.length === 2 &&
    /UPDATE\s+organizations/.test(revision) &&
    revision.includes('FROM collections candidate') &&
    /UPDATE\s+collections/.test(mutation) &&
    mutation.includes(
      'external_id = CASE WHEN ? = 1 THEN ? ELSE external_id END',
    ) &&
    mutation.includes('changes() = 1')
  )
}

function applyOrganizationCollectionUpdateBatch(
  options: FakeD1DatabaseOptions,
  statements: FakePreparedStatement[],
): D1Result[] {
  const revisionValues = statements[0]?.__fakeBoundValues ?? []
  const mutationValues = statements[1]?.__fakeBoundValues ?? []
  const now = String(revisionValues[0] ?? '')
  const organizationId = String(revisionValues[2] ?? '')
  const collectionId = String(revisionValues[3] ?? '')
  const userId = String(revisionValues[4] ?? '')
  const organization = options.organizations?.find(
    (row) => row.id === organizationId,
  )
  const collection = options.collections?.find(
    (row) => row.id === collectionId && row.organizationId === organizationId,
  )
  const managedCollectionIds = findManagedOrganizationCollectionIds(
    options,
    userId,
    organizationId,
    [collectionId],
  )

  if (!organization || !collection || managedCollectionIds.length !== 1) {
    return [0, 0].map((changes) => ({
      success: true,
      results: [],
      meta: { ...fakeMeta, changes },
    }))
  }

  const restoreOrganizations = snapshotFakeRows(options.organizations)
  const restoreCollections = snapshotFakeRows(options.collections)

  try {
    organization.revisionDate = now
    organization.updatedAt = now
    if (mutationValues[0] !== null) {
      collection.encryptedName = String(mutationValues[0])
    }
    if (Number(mutationValues[1]) === 1) {
      collection.externalId = mutationValues[2]
    }
    collection.revisionDate = String(mutationValues[3])

    return [1, 1].map((changes) => ({
      success: true,
      results: [],
      meta: { ...fakeMeta, changes },
    }))
  } catch (error) {
    restoreOrganizations()
    restoreCollections()
    throw error
  }
}

function isOrganizationCollectionDeleteBatch(
  statements: FakePreparedStatement[],
): boolean {
  const revision = statements[0]?.__fakeQuery ?? ''
  const deletion = statements[1]?.__fakeQuery ?? ''

  return (
    statements.length === 2 &&
    /UPDATE\s+organizations/.test(revision) &&
    revision.includes('COUNT(DISTINCT candidate.id)') &&
    revision.includes('FROM collection_ciphers selected_mapping') &&
    /DELETE\s+FROM\s+collections/.test(deletion) &&
    deletion.includes('changes() = 1')
  )
}

function applyOrganizationCollectionDeleteBatch(
  options: FakeD1DatabaseOptions,
  statements: FakePreparedStatement[],
): D1Result[] {
  const revisionValues = statements[0]?.__fakeBoundValues ?? []
  const deletionValues = statements[1]?.__fakeBoundValues ?? []
  const now = String(revisionValues[0] ?? '')
  const organizationId = String(deletionValues[0] ?? '')
  const userId = String(revisionValues[3] ?? '')
  const collectionIds = deletionValues.slice(1).map(String)
  const organization = options.organizations?.find(
    (row) => row.id === organizationId,
  )
  const managedCollectionIds = findManagedOrganizationCollectionIds(
    options,
    userId,
    organizationId,
    collectionIds,
  )
  const selectedIds = new Set(collectionIds)
  const wouldOrphanCipher = (options.ciphers ?? []).some((cipher) => {
    if (cipher.organizationId !== organizationId) {
      return false
    }

    const mappings = (options.collectionCiphers ?? []).filter(
      (mapping) => mapping.cipherId === cipher.id,
    )
    const hasSelectedMapping = mappings.some((mapping) =>
      selectedIds.has(String(mapping.collectionId)),
    )
    const hasSurvivingMapping = mappings.some((mapping) => {
      const collectionId = String(mapping.collectionId)
      return (
        !selectedIds.has(collectionId) &&
        options.collections?.some(
          (collection) =>
            collection.id === collectionId &&
            collection.organizationId === organizationId,
        )
      )
    })

    return hasSelectedMapping && !hasSurvivingMapping
  })
  const canDelete =
    Boolean(organization) &&
    collectionIds.length > 0 &&
    selectedIds.size === collectionIds.length &&
    managedCollectionIds.length === collectionIds.length &&
    !wouldOrphanCipher

  if (!canDelete || !organization) {
    return [0, 0].map((changes) => ({
      success: true,
      results: [],
      meta: { ...fakeMeta, changes },
    }))
  }

  const restoreOrganizations = snapshotFakeRows(options.organizations)
  const restoreCollections = snapshotFakeRows(options.collections)
  const restoreCollectionUsers = snapshotFakeRows(options.collectionUsers)
  const restoreCollectionCiphers = snapshotFakeRows(options.collectionCiphers)

  try {
    organization.revisionDate = now
    organization.updatedAt = now
    const deleted = deleteOrganizationCollectionRowsByIds(
      options,
      organizationId,
      collectionIds,
    )
    if (deleted !== collectionIds.length) {
      throw new Error('Organization collection deletion was incomplete')
    }

    return [1, deleted].map((changes) => ({
      success: true,
      results: [],
      meta: { ...fakeMeta, changes },
    }))
  } catch (error) {
    restoreOrganizations()
    restoreCollections()
    restoreCollectionUsers()
    restoreCollectionCiphers()
    throw error
  }
}

function snapshotFakeRows(
  rows: Record<string, unknown>[] | undefined,
): () => void {
  if (!rows) {
    return () => undefined
  }

  const snapshots = rows.map((row) => ({ row, values: { ...row } }))
  return () => {
    for (const { row, values } of snapshots) {
      for (const key of Object.keys(row)) {
        delete row[key]
      }
      Object.assign(row, values)
    }
    rows.splice(0, rows.length, ...snapshots.map(({ row }) => row))
  }
}

function applyOrganizationCollectionBatch(
  options: FakeD1DatabaseOptions,
  statements: FakePreparedStatement[],
): D1Result[] {
  const revisionStatement = statements.find((statement) =>
    /UPDATE\s+organizations/.test(statement.__fakeQuery),
  )
  const revisionValues = revisionStatement?.__fakeBoundValues ?? []
  const now = String(revisionValues[0] ?? '')
  const organizationId = String(revisionValues[2] ?? '')
  const organizationUserId = String(revisionValues[3] ?? '')
  const userId = String(revisionValues[4] ?? '')
  const organization = options.organizations?.find(
    (row) => row.id === organizationId,
  )
  const owner = options.organizationUsers?.find(
    (row) =>
      row.id === organizationUserId &&
      row.organizationId === organizationId &&
      row.userId === userId &&
      Number(row.status) === 2 &&
      Number(row.type) === 0,
  )

  if (!organization || !owner) {
    return statements.map(() => ({
      success: true,
      results: [],
      meta: { ...fakeMeta, changes: 0 },
    }))
  }

  const restoreOrganizations = snapshotFakeRows(options.organizations)
  const restoreCollections = snapshotFakeRows(options.collections)
  const restoreCollectionUsers = snapshotFakeRows(options.collectionUsers)

  try {
    organization.revisionDate = now
    organization.updatedAt = now
    for (const statement of statements) {
      if (statement === revisionStatement) {
        continue
      }
      applyOrganizationFoundationStatement(options, statement)
    }
  } catch (error) {
    restoreOrganizations()
    restoreCollections()
    restoreCollectionUsers()
    throw error
  }

  return statements.map(() => ({
    success: true,
    results: [],
    meta: { ...fakeMeta, changes: 1 },
  }))
}

function applyOrganizationFoundationBatch(
  options: FakeD1DatabaseOptions,
  statements: FakePreparedStatement[],
): D1Result[] {
  const statefulTables = [
    options.organizations,
    options.organizationUsers,
    options.collections,
    options.collectionUsers,
  ].filter((rows): rows is Record<string, unknown>[] => Boolean(rows))
  const snapshots = statefulTables.map((rows) => ({
    rows,
    values: rows.map((row) => ({ ...row })),
  }))

  try {
    for (const statement of statements) {
      applyOrganizationFoundationStatement(options, statement)
    }
  } catch (error) {
    for (const snapshot of snapshots) {
      snapshot.rows.splice(0, snapshot.rows.length, ...snapshot.values)
    }
    throw error
  }

  return statements.map(() => ({
    success: true,
    results: [],
    meta: { ...fakeMeta, changes: 1 },
  }))
}

function applyOrganizationFoundationStatement(
  options: FakeD1DatabaseOptions,
  statement: FakePreparedStatement,
): void {
  const values = statement.__fakeBoundValues
  const query = statement.__fakeQuery

  if (query.includes('INSERT INTO organizations')) {
    pushUniqueFakeRow(options.organizations, 'id', {
      id: String(values[0]),
      name: String(values[1]),
      billingEmail: values[2] === null ? null : String(values[2]),
      planType: Number(values[3]),
      publicKey: values[4] === null ? null : String(values[4]),
      privateKey: values[5] === null ? null : String(values[5]),
      enabled: Number(values[6]),
      useTotp: Number(values[7]),
      revisionDate: String(values[8]),
      createdAt: String(values[9]),
      updatedAt: String(values[10]),
    })
    return
  }

  if (query.includes('INSERT INTO organization_users')) {
    pushUniqueFakeRow(options.organizationUsers, 'id', {
      id: String(values[0]),
      organizationId: String(values[1]),
      userId: values[2] === null ? null : String(values[2]),
      email: String(values[3]),
      orgKey: values[4] === null ? null : String(values[4]),
      status: Number(values[5]),
      type: Number(values[6]),
      permissions: values[7] === null ? null : String(values[7]),
      createdAt: String(values[8]),
      updatedAt: String(values[9]),
    })
    return
  }

  if (query.includes('INSERT INTO collections')) {
    pushUniqueFakeRow(options.collections, 'id', {
      id: String(values[0]),
      organizationId: String(values[1]),
      encryptedName: String(values[2]),
      externalId: values[3] === null ? null : String(values[3]),
      type: Number(values[4]),
      revisionDate: String(values[5]),
      createdAt: String(values[6]),
    })
    return
  }

  if (query.includes('INSERT INTO collection_users')) {
    const row = {
      collectionId: String(values[0]),
      organizationUserId: String(values[1]),
      readOnly: Number(values[2]),
      hidePasswords: Number(values[3]),
      manage: Number(values[4]),
    }
    const duplicate = options.collectionUsers?.some(
      (candidate) =>
        candidate.collectionId === row.collectionId &&
        candidate.organizationUserId === row.organizationUserId,
    )
    if (duplicate) {
      throw new Error('Duplicate collection user')
    }
    options.collectionUsers?.push(row)
  }
}

function pushUniqueFakeRow(
  rows: Record<string, unknown>[] | undefined,
  key: string,
  row: Record<string, unknown>,
): void {
  if (!rows) {
    return
  }
  if (rows.some((candidate) => candidate[key] === row[key])) {
    throw new Error(`Duplicate fake row key: ${String(row[key])}`)
  }
  rows.push(row)
}

function findConfirmedOrganizationRow(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
): Record<string, unknown> | null {
  const [organizationId, userId] = boundValues
  const membership = options.organizationUsers?.find(
    (row) =>
      row.organizationId === organizationId &&
      row.userId === userId &&
      Number(row.status) === 2,
  )
  if (!membership) {
    return null
  }

  return options.organizations?.find((row) => row.id === organizationId) ?? null
}

function findConfirmedOrganizationOwnerRow(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
): Record<string, unknown> | null {
  const [organizationId, userId] = boundValues
  const membership = options.organizationUsers?.find(
    (row) =>
      row.organizationId === organizationId &&
      row.userId === userId &&
      Number(row.status) === 2 &&
      Number(row.type) === 0,
  )

  return membership
    ? {
        organizationUserId: membership.id,
        organizationId: membership.organizationId,
        userId: membership.userId,
      }
    : null
}

function listConfirmedOrganizationRows(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
): Record<string, unknown>[] {
  const [userId] = boundValues
  const rows: Record<string, unknown>[] = []

  for (const membership of options.organizationUsers ?? []) {
    if (membership.userId !== userId || Number(membership.status) !== 2) {
      continue
    }
    const organization = options.organizations?.find(
      (row) => row.id === membership.organizationId,
    )
    if (organization) {
      rows.push({
        ...organization,
        organizationUserId: membership.id,
        orgKey: membership.orgKey ?? null,
        status: Number(membership.status),
        type: Number(membership.type),
        permissions: membership.permissions ?? null,
      })
    }
  }

  return rows.sort((left, right) =>
    String(left.id).localeCompare(String(right.id)),
  )
}

function listAccessibleOrganizationCollectionRows(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
  query: string,
): Record<string, unknown>[] {
  const organizationScoped = query.includes('collection.organization_id = ?')
  const organizationId = organizationScoped ? boundValues[0] : null
  const userId = organizationScoped ? boundValues[1] : boundValues[0]
  const rows: Record<string, unknown>[] = []

  for (const membership of options.organizationUsers ?? []) {
    if (
      membership.userId !== userId ||
      Number(membership.status) !== 2 ||
      (organizationScoped && membership.organizationId !== organizationId)
    ) {
      continue
    }
    for (const collectionUser of options.collectionUsers ?? []) {
      if (collectionUser.organizationUserId !== membership.id) {
        continue
      }
      const collection = options.collections?.find(
        (row) =>
          row.id === collectionUser.collectionId &&
          row.organizationId === membership.organizationId,
      )
      if (!collection) {
        continue
      }
      rows.push({
        ...collection,
        readOnly: Number(collectionUser.readOnly ?? 0),
        hidePasswords: Number(collectionUser.hidePasswords ?? 0),
        manage: Number(collectionUser.manage ?? 0),
      })
    }
  }

  return rows.sort((left, right) =>
    String(left.id).localeCompare(String(right.id)),
  )
}

function findAccessibleOrganizationCollectionRow(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
  ownerOnly: boolean,
): Record<string, unknown> | null {
  const [organizationId, collectionId, userId] = boundValues
  const membership = options.organizationUsers?.find(
    (row) =>
      row.organizationId === organizationId &&
      row.userId === userId &&
      Number(row.status) === 2 &&
      (!ownerOnly || Number(row.type) === 0),
  )
  if (!membership) {
    return null
  }

  const access = options.collectionUsers?.find(
    (row) =>
      row.collectionId === collectionId &&
      row.organizationUserId === membership.id &&
      (!ownerOnly || Number(row.manage) === 1),
  )
  if (!access) {
    return null
  }

  const collection = options.collections?.find(
    (row) => row.id === collectionId && row.organizationId === organizationId,
  )
  return collection
    ? {
        ...collection,
        readOnly: Number(access.readOnly ?? 0),
        hidePasswords: Number(access.hidePasswords ?? 0),
        manage: Number(access.manage ?? 0),
      }
    : null
}

function listOrganizationCollectionUserRowsForOwner(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
): Record<string, unknown>[] {
  const [organizationId, collectionId, userId] = boundValues
  const owner = options.organizationUsers?.find(
    (row) =>
      row.organizationId === organizationId &&
      row.userId === userId &&
      Number(row.status) === 2 &&
      Number(row.type) === 0,
  )
  const collection = options.collections?.find(
    (row) => row.id === collectionId && row.organizationId === organizationId,
  )
  if (!owner || !collection) {
    return []
  }

  const rows: Record<string, unknown>[] = []
  for (const access of options.collectionUsers ?? []) {
    if (access.collectionId !== collectionId) {
      continue
    }
    const membership = options.organizationUsers?.find(
      (row) =>
        row.id === access.organizationUserId &&
        row.organizationId === organizationId,
    )
    if (!membership) {
      continue
    }
    rows.push({
      organizationUserId: membership.id,
      readOnly: Number(access.readOnly ?? 0),
      hidePasswords: Number(access.hidePasswords ?? 0),
      manage: Number(access.manage ?? 0),
    })
  }

  return rows.sort((left, right) =>
    String(left.organizationUserId).localeCompare(
      String(right.organizationUserId),
    ),
  )
}

function updateOrganizationCollectionRow(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
): number {
  const [
    encryptedName,
    externalId,
    revisionDate,
    collectionId,
    organizationId,
    userId,
  ] = boundValues
  const owner = findConfirmedOrganizationOwnerRow(options, [
    organizationId,
    userId,
  ])
  const collection = options.collections?.find(
    (row) => row.id === collectionId && row.organizationId === organizationId,
  )
  if (!owner || !collection) {
    return 0
  }

  if (encryptedName !== null) {
    collection.encryptedName = String(encryptedName)
  }
  collection.externalId = externalId === null ? null : String(externalId)
  collection.revisionDate = String(revisionDate)
  return 1
}

function deleteOrganizationCollectionRow(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
): number {
  const [collectionId, organizationId, userId] = boundValues
  const owner = findConfirmedOrganizationOwnerRow(options, [
    organizationId,
    userId,
  ])
  if (!owner) {
    return 0
  }

  return deleteOrganizationCollectionRowsByIds(
    options,
    String(organizationId),
    [String(collectionId)],
  )
}

function deleteManyOrganizationCollectionRows(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
  query: string,
): number {
  const firstInClause = query.match(/id IN \(([^)]+)\)/)
  const idCount = firstInClause?.[1]?.match(/\?/g)?.length ?? 0
  if (idCount < 1) {
    return 0
  }

  const organizationId = String(boundValues[0])
  const collectionIds = boundValues
    .slice(1, idCount + 1)
    .map((value) => String(value))
  const userId = boundValues[idCount * 2 + 2]
  const owner = findConfirmedOrganizationOwnerRow(options, [
    organizationId,
    userId,
  ])
  if (!owner) {
    return 0
  }

  const existingCount = collectionIds.filter((collectionId) =>
    options.collections?.some(
      (row) => row.id === collectionId && row.organizationId === organizationId,
    ),
  ).length
  if (existingCount !== collectionIds.length) {
    return 0
  }

  return deleteOrganizationCollectionRowsByIds(
    options,
    organizationId,
    collectionIds,
  )
}

function deleteOrganizationCollectionRowsByIds(
  options: FakeD1DatabaseOptions,
  organizationId: string,
  collectionIds: string[],
): number {
  if (!options.collections) {
    return 0
  }

  const ids = new Set(collectionIds)
  const before = options.collections.length
  const retained = options.collections.filter(
    (row) =>
      !(row.organizationId === organizationId && ids.has(String(row.id))),
  )
  const deletedIds = new Set(
    options.collections
      .filter(
        (row) =>
          row.organizationId === organizationId && ids.has(String(row.id)),
      )
      .map((row) => String(row.id)),
  )
  options.collections.splice(0, options.collections.length, ...retained)

  if (options.collectionUsers) {
    const retainedUsers = options.collectionUsers.filter(
      (row) => !deletedIds.has(String(row.collectionId)),
    )
    options.collectionUsers.splice(
      0,
      options.collectionUsers.length,
      ...retainedUsers,
    )
  }
  if (options.collectionCiphers) {
    const retainedCiphers = options.collectionCiphers.filter(
      (row) => !deletedIds.has(String(row.collectionId)),
    )
    options.collectionCiphers.splice(
      0,
      options.collectionCiphers.length,
      ...retainedCiphers,
    )
  }

  return before - options.collections.length
}

function findManagedOrganizationCollectionIds(
  options: FakeD1DatabaseOptions,
  userId: string,
  organizationId: string,
  requestedCollectionIds: readonly string[],
): string[] {
  const requested = new Set(requestedCollectionIds)
  const managed = new Set<string>()

  for (const membership of options.organizationUsers ?? []) {
    if (
      membership.userId !== userId ||
      membership.organizationId !== organizationId ||
      Number(membership.status) !== 2 ||
      Number(membership.type) !== 0
    ) {
      continue
    }

    for (const collectionUser of options.collectionUsers ?? []) {
      if (
        collectionUser.organizationUserId !== membership.id ||
        Number(collectionUser.manage) !== 1
      ) {
        continue
      }
      const collection = options.collections?.find(
        (row) =>
          requested.has(String(row.id)) &&
          row.id === collectionUser.collectionId &&
          row.organizationId === organizationId,
      )
      if (collection) {
        managed.add(String(collection.id))
      }
    }
  }

  return [...managed].sort()
}

function findCipherAccessRow(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
): Record<string, unknown> | null {
  const cipherId = boundValues[0]
  if (options.cipher !== undefined) {
    if (options.cipher === null) {
      return null
    }
    if (options.cipher.id !== undefined && options.cipher.id !== cipherId) {
      return null
    }
    return options.cipher
  }

  return options.ciphers?.find((row) => row.id === cipherId) ?? null
}

function findManagedOrganizationCipherAccess(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
): Record<string, unknown> | null {
  const [userId, membershipOrganizationId, collectionOrganizationId, cipherId] =
    boundValues
  if (membershipOrganizationId !== collectionOrganizationId) {
    return null
  }

  for (const membership of options.organizationUsers ?? []) {
    if (
      membership.userId !== userId ||
      membership.organizationId !== membershipOrganizationId ||
      Number(membership.status) !== 2
    ) {
      continue
    }
    for (const collectionUser of options.collectionUsers ?? []) {
      if (
        collectionUser.organizationUserId !== membership.id ||
        Number(collectionUser.manage) !== 1
      ) {
        continue
      }
      const collection = options.collections?.find(
        (row) =>
          row.id === collectionUser.collectionId &&
          row.organizationId === membershipOrganizationId,
      )
      const collectionCipher = options.collectionCiphers?.find(
        (row) =>
          row.collectionId === collection?.id && row.cipherId === cipherId,
      )
      if (collection && collectionCipher) {
        return { hasManageAccess: 1 }
      }
    }
  }

  return null
}

function mutateCipherRows(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
  query: string,
): number | null {
  if (!options.ciphers) {
    return null
  }

  if (/DELETE\s+FROM\s+ciphers/.test(query)) {
    if (query.includes('id IN (')) {
      const userId = boundValues.at(-1)
      const ids = new Set(boundValues.slice(0, -1))
      const deletedCipherIds = options.ciphers
        .filter((row) => row.userId === userId && ids.has(row.id))
        .map((row) => row.id)

      options.ciphers.splice(
        0,
        options.ciphers.length,
        ...options.ciphers.filter(
          (row) => row.userId !== userId || !ids.has(row.id),
        ),
      )
      if (options.attachments && deletedCipherIds.length > 0) {
        const deletedCipherIdSet = new Set(deletedCipherIds)
        options.attachments.splice(
          0,
          options.attachments.length,
          ...options.attachments.filter(
            (attachment) => !deletedCipherIdSet.has(attachment.cipherId),
          ),
        )
      }

      return deletedCipherIds.length
    }

    const [id, userId] = boundValues
    const index = options.ciphers.findIndex(
      (row) => row.id === id && row.userId === userId,
    )
    if (index < 0) {
      return 0
    }

    const [deletedCipher] = options.ciphers.splice(index, 1)
    if (options.attachments && deletedCipher) {
      options.attachments.splice(
        0,
        options.attachments.length,
        ...options.attachments.filter(
          (attachment) => attachment.cipherId !== deletedCipher.id,
        ),
      )
    }
    return 1
  }

  if (query.includes('deleted_at = NULL')) {
    if (query.includes('id IN (')) {
      const [revisionDate, updatedAt] = boundValues
      const userId = boundValues.at(-1)
      const ids = new Set(boundValues.slice(2, -1))
      const rows = options.ciphers.filter(
        (candidate) =>
          ids.has(candidate.id) &&
          candidate.userId === userId &&
          candidate.deletedAt != null,
      )

      for (const row of rows) {
        Object.assign(row, {
          deletedAt: null,
          revisionDate,
          updatedAt,
        })
      }

      return rows.length
    }

    const [revisionDate, updatedAt, id, userId] = boundValues
    const row = options.ciphers.find(
      (candidate) =>
        candidate.id === id &&
        candidate.userId === userId &&
        candidate.deletedAt != null,
    )
    if (!row) {
      return 0
    }

    Object.assign(row, {
      deletedAt: null,
      revisionDate,
      updatedAt,
    })
    return 1
  }

  if (query.includes('deleted_at = ?')) {
    if (query.includes('id IN (')) {
      const [deletedAt, revisionDate, updatedAt] = boundValues
      const userId = boundValues.at(-1)
      const ids = new Set(boundValues.slice(3, -1))
      const rows = options.ciphers.filter(
        (candidate) =>
          ids.has(candidate.id) &&
          candidate.userId === userId &&
          candidate.deletedAt == null,
      )

      for (const row of rows) {
        Object.assign(row, {
          deletedAt,
          revisionDate,
          updatedAt,
        })
      }

      return rows.length
    }

    const [deletedAt, revisionDate, updatedAt, id, userId] = boundValues
    const row = options.ciphers.find(
      (candidate) =>
        candidate.id === id &&
        candidate.userId === userId &&
        candidate.deletedAt == null,
    )
    if (!row) {
      return 0
    }

    Object.assign(row, {
      deletedAt,
      revisionDate,
      updatedAt,
    })
    return 1
  }

  if (query.includes('type = ?') && query.includes('revision_date = ?')) {
    const [
      folderId,
      type,
      favorite,
      encryptedJson,
      revisionDate,
      updatedAt,
      id,
      userId,
      expectedRevisionDate,
    ] = boundValues
    const row = options.ciphers.find(
      (candidate) =>
        candidate.id === id &&
        candidate.userId === userId &&
        candidate.deletedAt == null &&
        candidate.revisionDate === expectedRevisionDate,
    )
    if (!row) {
      return 0
    }

    Object.assign(row, {
      folderId,
      type,
      favorite,
      encryptedJson,
      revisionDate,
      updatedAt,
    })
    return 1
  }

  if (query.includes('folder_id = ?')) {
    if (query.includes('id IN (')) {
      const [folderId, revisionDate, updatedAt] = boundValues
      const userId = boundValues.at(-1)
      const ids = new Set(boundValues.slice(3, -1))
      const rows = options.ciphers.filter(
        (candidate) =>
          ids.has(candidate.id) &&
          candidate.userId === userId &&
          candidate.deletedAt == null,
      )

      for (const row of rows) {
        Object.assign(row, {
          folderId,
          revisionDate,
          updatedAt,
        })
      }

      return rows.length
    }

    const [folderId, revisionDate, updatedAt, id, userId] = boundValues
    const row = options.ciphers.find(
      (candidate) =>
        candidate.id === id &&
        candidate.userId === userId &&
        candidate.deletedAt == null,
    )
    if (!row) {
      return 0
    }

    Object.assign(row, {
      folderId,
      revisionDate,
      updatedAt,
    })
    return 1
  }

  return null
}

function findOwnedCipherAttachmentObjectKeys(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
): Array<{ cipherId: string; objectKey: string }> {
  const userId = boundValues.at(-2)
  const attachmentUserId = boundValues.at(-1)
  const requestedCipherIds = new Set(boundValues.slice(0, -2))
  if (userId !== attachmentUserId) {
    return []
  }

  const ownedCipherIds = new Set(
    (options.ciphers ?? [])
      .filter(
        (cipher) =>
          requestedCipherIds.has(cipher.id) && cipher.userId === userId,
      )
      .map((cipher) => cipher.id),
  )

  return (options.attachments ?? [])
    .filter(
      (attachment) =>
        ownedCipherIds.has(attachment.cipherId) && attachment.userId === userId,
    )
    .map((attachment) => ({
      cipherId: String(attachment.cipherId),
      objectKey: String(attachment.objectKey),
    }))
}

function findBulkCipherIds(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
  query: string,
): Array<{ id: string }> {
  const userId = boundValues.at(-1)
  const requestedIds = new Set(boundValues.slice(0, -1))

  return applyDeletedFilter(options.ciphers ?? [], query)
    .filter((cipher) => requestedIds.has(cipher.id) && cipher.userId === userId)
    .map((cipher) => ({ id: String(cipher.id) }))
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

function listPreloginKdfRows(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
): Record<string, unknown>[] {
  const users =
    options.authUsers ?? (options.authUser ? [options.authUser] : [])
  const targetEmailNormalized = String(boundValues[0] ?? '')
  const target = users.find(
    (user) =>
      fakeColumn(user, 'emailNormalized', 'email_normalized') ===
      targetEmailNormalized,
  )
  const groups = new Map<
    string,
    {
      kdfAlgorithm: unknown
      kdfIterations: unknown
      kdfMemory: unknown
      kdfParallelism: unknown
      accountCount: number
    }
  >()

  for (const user of users) {
    if (!hasClientReadablePreloginKdf(user)) {
      continue
    }
    const kdfAlgorithm = fakeColumn(user, 'kdfAlgorithm', 'kdf_algorithm')
    const kdfIterations = fakeColumn(user, 'kdfIterations', 'kdf_iterations')
    const kdfMemory = fakeColumn(user, 'kdfMemory', 'kdf_memory') ?? null
    const kdfParallelism =
      fakeColumn(user, 'kdfParallelism', 'kdf_parallelism') ?? null
    const key = JSON.stringify([
      kdfAlgorithm,
      kdfIterations,
      kdfMemory,
      kdfParallelism,
    ])
    const existing = groups.get(key)
    if (existing) {
      existing.accountCount += 1
    } else {
      groups.set(key, {
        kdfAlgorithm,
        kdfIterations,
        kdfMemory,
        kdfParallelism,
        accountCount: 1,
      })
    }
  }

  const targetFields = {
    targetEmailNormalized:
      target == null
        ? null
        : fakeColumn(target, 'emailNormalized', 'email_normalized'),
    targetKdfAlgorithm:
      target == null
        ? null
        : fakeColumn(target, 'kdfAlgorithm', 'kdf_algorithm'),
    targetKdfIterations:
      target == null
        ? null
        : fakeColumn(target, 'kdfIterations', 'kdf_iterations'),
    targetKdfMemory:
      target == null
        ? null
        : (fakeColumn(target, 'kdfMemory', 'kdf_memory') ?? null),
    targetKdfParallelism:
      target == null
        ? null
        : (fakeColumn(target, 'kdfParallelism', 'kdf_parallelism') ?? null),
  }

  const distributionRows = [...groups.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, row]) => ({ ...row, ...targetFields }))

  return distributionRows.length > 0
    ? distributionRows
    : [
        {
          kdfAlgorithm: null,
          kdfIterations: null,
          kdfMemory: null,
          kdfParallelism: null,
          accountCount: null,
          ...targetFields,
        },
      ]
}

function hasClientReadablePreloginKdf(user: Record<string, unknown>): boolean {
  const algorithm = fakeColumn(user, 'kdfAlgorithm', 'kdf_algorithm')
  const iterations = fakeColumn(user, 'kdfIterations', 'kdf_iterations')
  const memory = fakeColumn(user, 'kdfMemory', 'kdf_memory') ?? null
  const parallelism =
    fakeColumn(user, 'kdfParallelism', 'kdf_parallelism') ?? null

  if (!Number.isSafeInteger(iterations)) {
    return false
  }
  if (algorithm === 'pbkdf2-sha256') {
    return (
      inFakeRange(iterations as number, preloginKdfPolicy.pbkdf2Iterations) &&
      memory === null &&
      parallelism === null
    )
  }

  return (
    algorithm === 'argon2id' &&
    inFakeRange(iterations as number, preloginKdfPolicy.argon2Iterations) &&
    Number.isSafeInteger(memory) &&
    inFakeRange(memory as number, preloginKdfPolicy.argon2Memory) &&
    Number.isSafeInteger(parallelism) &&
    inFakeRange(parallelism as number, preloginKdfPolicy.argon2Parallelism)
  )
}

function inFakeRange(
  value: number,
  range: { min: number; max: number },
): boolean {
  return value >= range.min && value <= range.max
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

  for (const membership of options.organizationUsers ?? []) {
    if (membership.userId !== userId || Number(membership.status) !== 2) {
      continue
    }
    const organization = options.organizations?.find(
      (row) => row.id === membership.organizationId,
    )
    if (organization && typeof organization.revisionDate === 'string') {
      revisions.push(organization.revisionDate)
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
  let scopedRows = applyOrganizationFilter(
    applyDeletedFilter(filterRowsByUserId(rows, boundValues), query),
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

function applyOrganizationFilter(
  rows: Record<string, unknown>[],
  query: string,
): Record<string, unknown>[] {
  if (query.includes('organization_id IS NULL')) {
    return rows.filter((row) => row.organizationId == null)
  }

  return rows
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
  'organizations',
  'organization_users',
  'collections',
  'collection_users',
  'collection_ciphers',
  'account_kdf_population',
] as const

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
  preloginKdfLookupThrows?: boolean
  authRequests?: Record<string, unknown>[]
  userTotp?: Record<string, unknown> | null
  userTotps?: Record<string, unknown>[]
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
  accountKeyInitializationFailureAt?: 'user' | 'wrapper_history' | 'audit'
  credentialRotationConflict?: boolean
  credentialRotationFailureAt?:
    | 'user'
    | 'wrapper_history'
    | 'devices'
    | 'refresh_tokens'
    | 'auth_requests'
    | 'audit'
  wrapperHistory?: Array<{
    userId: string
    wrapperKind: 'user_key' | 'private_key'
    wrapperSha256: string
    recordedAt: string
  }>
  requestQuotaBucket?: Record<string, unknown> | null
  requestQuotaCleanupChanges?: number
  requestQuotaInsertThrows?: boolean
  inquiryForwardUpdateThrows?: boolean
  inquiryInsertThrows?: boolean
  personalApiKeys?: Record<string, unknown>[]
  webauthnChallenges?: Record<string, unknown>[]
  webauthnCredentials?: Record<string, unknown>[]
  organizations?: Record<string, unknown>[]
  organizationUsers?: Record<string, unknown>[]
  collections?: Record<string, unknown>[]
  collectionUsers?: Record<string, unknown>[]
  collectionCiphers?: Record<string, unknown>[]
  organizationGroups?: Record<string, unknown>[]
  organizationGroupUsers?: Record<string, unknown>[]
  collectionGroups?: Record<string, unknown>[]
  organizationPolicies?: Record<string, unknown>[]
  organizationCipherBatchFailureAt?: 'cipher' | 'mappings'
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
  ) {
    options.webauthnChallenges ??= []
    options.webauthnCredentials ??= []
    // Default route fixtures model one concrete active session per seeded user.
    // Explicit device arrays, including an empty array, always remain authoritative.
    options.devices ??= (
      options.authUsers ?? (options.authUser ? [options.authUser] : [])
    ).map((user) => ({
      id: `${String(user.id)}:fixture-device`,
      userId: user.id,
      identifier: 'fixture-device',
      sessionId: 'synthetic-session-id',
      name: 'Fixture device',
      type: 8,
      encryptedUserKey: null,
      encryptedPublicKey: null,
      encryptedPrivateKey: null,
      lastSeenAt: null,
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z',
      revokedAt: null,
    }))
  }

  get webauthnCredentials(): Record<string, unknown>[] {
    return this.options.webauthnCredentials ?? []
  }

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
        if (isSharedOrganizationAccessQuery(query)) {
          const row =
            readSharedOrganizationAccessRows(options, boundValues, query)[0] ??
            null
          return (column && row ? row[column] : row) as T | null
        }

        if (
          query.includes('SELECT 1 AS assured') &&
          query.includes('mfa_totp_credential_generation')
        ) {
          const [userId, deviceIdentifier, sessionId] = boundValues
          return hasFakeSessionTotpAssurance(
            options,
            String(userId),
            sessionId,
            deviceIdentifier,
          )
            ? ({ assured: 1 } as T)
            : null
        }

        if (query.includes('WITH accessible_organization_collections AS')) {
          return findAccessibleCipherRow(
            options,
            boundValues,
            query,
          ) as T | null
        }

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
          query.includes('COUNT(DISTINCT collection.id) as count') &&
          query.includes('membership.status = 2') &&
          query.includes('membership.type IN (0, 1, 2)') &&
          query.includes('collection_user.read_only = 0')
        ) {
          const row = {
            count: findManagedOrganizationCollectionIds(
              options,
              String(boundValues[0] ?? ''),
              String(boundValues[1] ?? ''),
              boundValues.slice(2).map(String),
              false,
            ).length,
          }

          return (column ? row[column as keyof typeof row] : row) as T
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
          if (query.includes('1 as found')) {
            const row =
              options.cipher ??
              options.ciphers?.find(
                (candidate) =>
                  candidate.id === boundValues[0] &&
                  candidate.userId === boundValues[1],
              )
            return row &&
              row.id === boundValues[0] &&
              row.userId === boundValues[1] &&
              row.organizationId == null &&
              row.deletedAt == null
              ? ({ found: 1 } as T)
              : null
          }
          if (
            /DELETE\s+FROM\s+ciphers/.test(query) &&
            query.includes('RETURNING id')
          ) {
            if (options.cipher !== undefined && !options.ciphers) {
              const row = options.cipher
              const owned =
                row &&
                row.id === boundValues[0] &&
                row.userId === boundValues[1] &&
                row.organizationId == null &&
                options.cipherPermanentDeleteChanges !== 0
              if (!owned) return null
              options.cipher = null
              return { id: boundValues[0] } as T
            }
            const changes = mutateCipherRows(options, boundValues, query)
            return changes === 1 ? ({ id: boundValues[0] } as T) : null
          }
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
          return (fakeTotpRows(options).find(
            (factor) => factor.userId === boundValues[0],
          ) ?? null) as T | null
        }

        if (query.includes('FROM totp_challenges')) {
          return (options.totpChallenge ?? null) as T | null
        }

        if (query.includes('FROM personal_api_keys')) {
          return findPersonalApiKeyRow(options, boundValues, query) as T | null
        }

        if (query.includes('FROM webauthn_credentials')) {
          return findWebAuthnCredentialRow(
            options,
            boundValues,
            query,
          ) as T | null
        }

        if (query.includes('FROM webauthn_challenges')) {
          return findWebAuthnChallengeRow(options, boundValues) as T | null
        }

        if (query.includes('INNER JOIN devices auth_device')) {
          const [identifier, sessionId, userId] = boundValues
          const device = options.devices?.find(
            (row) =>
              row.userId === userId &&
              row.identifier === identifier &&
              row.sessionId === sessionId &&
              row.revokedAt == null,
          )
          return device
            ? (findAuthUser(options, query, [userId]) as T | null)
            : null
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
          query.includes('INSERT INTO user_totp') &&
          query.includes('RETURNING user_id')
        ) {
          return applyFakePendingTotpSetup(options, boundValues) as D1Result<T>
        }
        if (query.includes('FROM organization_policies policy')) {
          const [actorUserId, sessionId, deviceIdentifier, userId] = boundValues
          const active =
            actorUserId === userId &&
            options.devices?.some(
              (device) =>
                device.userId === actorUserId &&
                device.sessionId === sessionId &&
                device.identifier === deviceIdentifier &&
                device.revokedAt == null,
            )
          const users =
            options.authUsers ?? (options.authUser ? [options.authUser] : [])
          const rows =
            active &&
            users.some(
              (user) => user.id === actorUserId && user.disabledAt == null,
            )
              ? (options.organizationPolicies ?? []).filter(
                  (policy) =>
                    Number(policy.type) === 0 &&
                    options.organizations?.some(
                      (organization) =>
                        organization.id === policy.organizationId &&
                        Number(organization.enabled ?? 1) === 1,
                    ) &&
                    options.organizationUsers?.some(
                      (membership) =>
                        membership.userId === userId &&
                        membership.organizationId === policy.organizationId &&
                        [1, 2].includes(Number(membership.status)) &&
                        [0, 1, 2].includes(Number(membership.type)),
                    ),
                )
              : []
          return { success: true, results: rows as T[], meta: fakeMeta }
        }

        if (isSharedOrganizationAccessQuery(query)) {
          return {
            success: true,
            results: readSharedOrganizationAccessRows(
              options,
              boundValues,
              query,
            ) as T[],
            meta: fakeMeta,
          }
        }

        if (query.includes('WITH accessible_organization_collections AS')) {
          return {
            success: true,
            results: listAccessibleCipherRows(
              options,
              boundValues,
              query,
            ) as T[],
            meta: fakeMeta,
          }
        }

        if (
          query.includes('WITH target AS') &&
          query.includes('FROM account_kdf_population')
        ) {
          if (options.preloginKdfLookupThrows) {
            throw new Error('Synthetic prelogin KDF lookup failure')
          }

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

        if (query.includes('FROM webauthn_credentials')) {
          return {
            success: true,
            results: listWebAuthnCredentialRows(
              options,
              boundValues,
              query,
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
        if (query.includes('INSERT INTO webauthn_challenges')) {
          const changes = insertWebAuthnChallenge(options, boundValues)

          return {
            success: true,
            results: [],
            meta: { ...fakeMeta, changes },
          }
        }

        if (query.includes('INSERT INTO webauthn_credentials')) {
          const changes = insertWebAuthnCredential(options, boundValues, query)

          return {
            success: true,
            results: [],
            meta: { ...fakeMeta, changes },
          }
        }

        if (/UPDATE\s+webauthn_challenges/.test(query)) {
          const changes = consumeWebAuthnChallengeRow(
            options,
            boundValues,
            query,
          )

          return {
            success: true,
            results: [],
            meta: { ...fakeMeta, changes },
          }
        }

        if (query.includes('INSERT INTO personal_api_keys')) {
          const changes = insertPersonalApiKey(options, boundValues)

          return {
            success: true,
            results: [],
            meta: { ...fakeMeta, changes },
          }
        }

        if (/UPDATE\s+personal_api_keys/.test(query)) {
          const changes = updatePersonalApiKey(options, boundValues, query)

          return {
            success: true,
            results: [],
            meta: { ...fakeMeta, changes },
          }
        }

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
          const actualChanges =
            options.attachmentInsertChanges === 0
              ? 0
              : insertCipherAttachment(options, boundValues, query)
          const changes =
            actualChanges === 0
              ? 0
              : (options.attachmentInsertChanges ?? actualChanges)

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
          if (query.includes('RETURNING user_id')) {
            return applyFakePendingTotpSetup(options, boundValues)
          }
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

        if (/DELETE\s+FROM\s+webauthn_challenges/.test(query)) {
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

    if (isAccountKeyInitializationBatch(fakeStatements)) {
      return applyAccountKeyInitializationBatch(
        this.options,
        fakeStatements,
        this.auditEventInserts,
      ) as D1Result<T>[]
    }

    if (isCredentialRotationBatch(fakeStatements)) {
      return applyCredentialRotationBatch(
        this.options,
        fakeStatements,
        this.auditEventInserts,
      ) as D1Result<T>[]
    }

    if (
      fakeStatements[0]?.__fakeQuery.includes('UPDATE user_totp') &&
      (fakeStatements[1]?.__fakeQuery.includes(
        'mfa_totp_credential_generation',
      ) ||
        fakeStatements
          .at(-1)
          ?.__fakeQuery.includes('SET mfa_totp_credential_generation'))
    ) {
      return applyFakeTotpSessionBatch(
        this.options,
        fakeStatements,
      ) as D1Result<T>[]
    }

    if (
      fakeStatements.length === 3 &&
      fakeStatements[0]?.__fakeQuery.includes('DELETE FROM user_totp') &&
      fakeStatements[0].__fakeQuery.includes('credential_generation = ?') &&
      fakeStatements[2]?.__fakeQuery.includes("'totp.disable'")
    ) {
      return applyFakeTotpDisableBatch(
        this.options,
        fakeStatements,
        this.auditEventInserts,
      ) as D1Result<T>[]
    }

    if (
      fakeStatements.length === 3 &&
      fakeStatements[0]?.__fakeQuery.includes(
        'INSERT OR IGNORE INTO devices',
      ) &&
      fakeStatements[1]?.__fakeQuery.includes('session_id = ?') &&
      fakeStatements[2]?.__fakeQuery.includes('INSERT INTO refresh_tokens')
    ) {
      const values = fakeStatements[0].__fakeBoundValues
      const user = findAuthUser(this.options, 'FROM users WHERE u.id = ?', [
        values[6],
      ])
      const validGeneration =
        user &&
        user.disabledAt == null &&
        user.masterPasswordHash === values[7] &&
        user.securityStamp === values[8]
      if (!validGeneration || this.options.deviceUpdateChanges === 0) {
        return fakeStatements.map(() => fakeResult(0)) as D1Result<T>[]
      }
      this.options.devices ??= []
      let device = this.options.devices.find((row) => row.id === values[0])
      const inserted = device ? 0 : 1
      if (!device) {
        device = {
          id: values[0],
          userId: values[1],
          identifier: values[2],
          createdAt: values[5],
        }
        this.options.devices.push(device)
      }
      const updates = fakeStatements[1].__fakeBoundValues
      Object.assign(device, {
        name: updates[0],
        type: updates[1],
        lastSeenAt: updates[2],
        updatedAt: updates[3],
        sessionId: updates[4],
        mfaTotpCredentialGeneration: null,
        mfaVerifiedAt: null,
        revokedAt: null,
      })
      const token = fakeStatements[2].__fakeBoundValues
      this.options.refreshTokens ??= []
      this.options.refreshTokens.push({
        id: token[0],
        userId: token[1],
        deviceId: token[2],
        tokenHash: token[3],
        expiresAt: token[4],
        sessionId: token[5],
        revokedAt: null,
      })
      return [inserted, 1, 1].map(fakeResult) as D1Result<T>[]
    }

    if (isPersonalApiKeyMutationBatch(fakeStatements)) {
      return applyPersonalApiKeyMutationBatch(
        this.options,
        statements,
        fakeStatements,
        this.auditEventInserts,
      ) as Promise<D1Result<T>[]>
    }

    if (
      fakeStatements.length === 2 &&
      /UPDATE\s+devices/.test(fakeStatements[0]?.__fakeQuery ?? '') &&
      fakeStatements[1]?.__fakeQuery.includes('changes() = 1')
    ) {
      const values = fakeStatements[0]?.__fakeBoundValues ?? []
      const device = this.options.devices?.find(
        (row) =>
          row.userId === values[2] &&
          row.id === values[3] &&
          row.revokedAt == null,
      )
      const changes = this.options.deviceRevokeChanges ?? (device ? 1 : 0)
      if (changes === 1 && device) {
        device.revokedAt = values[0]
        device.updatedAt = values[1]
        for (const token of this.options.refreshTokens ?? []) {
          if (
            token.userId === values[2] &&
            token.deviceId === values[3] &&
            token.revokedAt == null
          ) {
            token.revokedAt = values[0]
          }
        }
      }
      return [changes, changes].map(fakeResult) as D1Result<T>[]
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

    if (isOrganizationCipherTransitionBatch(fakeStatements)) {
      return applyOrganizationCipherTransitionBatch(
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
        const deviceValues = fakeStatements[0]?.__fakeBoundValues ?? []
        const sessionValues = fakeStatements[1]?.__fakeBoundValues ?? []
        const tokenValues = fakeStatements[2]?.__fakeBoundValues ?? []
        this.options.devices ??= []
        let device = this.options.devices.find(
          (candidate) => candidate.id === deviceValues[0],
        )
        if (!device) {
          device = {
            id: deviceValues[0],
            userId: deviceValues[1],
            identifier: deviceValues[2],
            createdAt: deviceValues[5],
          }
          this.options.devices.push(device)
        }
        Object.assign(device, {
          name: sessionValues[0],
          type: sessionValues[1],
          lastSeenAt: sessionValues[2],
          updatedAt: sessionValues[3],
          sessionId: sessionValues[4],
          revokedAt: null,
        })
        this.options.refreshTokens ??= []
        this.options.refreshTokens.push({
          id: tokenValues[0],
          userId: tokenValues[1],
          deviceId: tokenValues[2],
          tokenHash: tokenValues[3],
          expiresAt: tokenValues[4],
          sessionId: tokenValues[5],
          revokedAt: null,
        })
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

    if (
      fakeStatements.some((statement) =>
        /webauthn_challenges|webauthn_credentials/.test(statement.__fakeQuery),
      )
    ) {
      const results: D1Result<T>[] = []
      let previousChanges = 0
      for (const [index, statement] of statements.entries()) {
        const fakeStatement = fakeStatements[index]
        if (!fakeStatement) {
          throw new Error('Fake D1 batch statement mismatch.')
        }
        if (
          fakeStatement.__fakeQuery.includes('WHERE changes() = 1') &&
          previousChanges !== 1
        ) {
          results.push({
            success: true,
            results: [],
            meta: { ...fakeMeta, changes: 0 },
          })
          previousChanges = 0
          continue
        }
        const result = await statement.run<T>()
        results.push(result)
        previousChanges = result.meta.changes
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

function isAccountKeyInitializationBatch(
  statements: FakePreparedStatement[],
): boolean {
  return (
    statements.length === 3 &&
    statements.some(
      (statement) =>
        /UPDATE\s+users/.test(statement.__fakeQuery) &&
        statement.__fakeQuery.includes('public_key = ?') &&
        statement.__fakeQuery.includes('private_key = ?') &&
        statement.__fakeQuery.includes('public_key IS NULL') &&
        statement.__fakeQuery.includes('private_key IS NULL') &&
        statement.__fakeQuery.includes('RETURNING id'),
    ) &&
    statements.some((statement) =>
      statement.__fakeQuery.includes('INSERT INTO audit_events'),
    ) &&
    statements.some((statement) =>
      statement.__fakeQuery.includes(
        'INSERT OR IGNORE INTO user_key_rotation_wrapper_history',
      ),
    )
  )
}

function applyAccountKeyInitializationBatch(
  options: FakeD1DatabaseOptions,
  statements: FakePreparedStatement[],
  auditEventInserts: FakeAuditEventInsert[],
): D1Result[] {
  options.wrapperHistory ??= []
  const userRows = uniqueRows([
    ...(options.authUser ? [options.authUser] : []),
    ...(options.authUsers ?? []),
  ])
  const snapshots = userRows.map((row) => ({ row, values: { ...row } }))
  const wrapperHistoryBefore = structuredClone(options.wrapperHistory)
  const auditLength = auditEventInserts.length

  try {
    const userStatement = statements.find(
      (statement) =>
        /UPDATE\s+users/.test(statement.__fakeQuery) &&
        statement.__fakeQuery.includes('public_key = ?'),
    )
    const auditStatement = statements.find((statement) =>
      statement.__fakeQuery.includes('INSERT INTO audit_events'),
    )
    const wrapperHistoryStatement = statements.find((statement) =>
      statement.__fakeQuery.includes(
        'INSERT OR IGNORE INTO user_key_rotation_wrapper_history',
      ),
    )
    if (!userStatement || !auditStatement || !wrapperHistoryStatement) {
      throw new Error('account key initialization statement missing')
    }

    const values = userStatement.__fakeBoundValues
    const user = userRows.find((row) => row.id === values[4])
    const wrappedUserKey =
      user == null ? null : fakeColumn(user, 'userKey', 'user_key')
    const generationMatches =
      user != null &&
      fakeColumn(user, 'disabledAt', 'disabled_at') == null &&
      typeof wrappedUserKey === 'string' &&
      wrappedUserKey.trim().length > 0 &&
      wrappedUserKey === values[5] &&
      fakeColumn(user, 'publicKey', 'public_key') == null &&
      fakeColumn(user, 'privateKey', 'private_key') == null &&
      !wrapperHistoryContains(options.wrapperHistory, user, values[7]) &&
      fakeColumn(user, 'securityStamp', 'security_stamp') === values[8] &&
      fakeColumn(user, 'revisionDate', 'revision_date') === values[9]

    if (generationMatches && user) {
      setFakeColumn(user, 'publicKey', 'public_key', values[0])
      setFakeColumn(user, 'privateKey', 'private_key', values[1])
      setFakeColumn(user, 'revisionDate', 'revision_date', values[2])
      setFakeColumn(user, 'updatedAt', 'updated_at', values[3])
    }
    failAccountKeyInitializationAt(options, 'user')

    const results = new Map<FakePreparedStatement, D1Result>()
    results.set(userStatement, {
      success: true,
      results: generationMatches && user ? [{ id: user.id }] : [],
      meta: { ...fakeMeta, changes: generationMatches ? 1 : 0 },
    })

    const insertedHistory = generationMatches
      ? insertCredentialWrapperHistory(
          options.wrapperHistory,
          wrapperHistoryStatement.__fakeBoundValues,
        )
      : []
    failAccountKeyInitializationAt(options, 'wrapper_history')
    results.set(wrapperHistoryStatement, {
      success: true,
      results: insertedHistory,
      meta: { ...fakeMeta, changes: insertedHistory.length },
    })

    if (generationMatches) {
      const auditValues = auditStatement.__fakeBoundValues
      if (auditEventInserts.some((event) => event.id === auditValues[0])) {
        throw new Error('duplicate account key initialization audit event')
      }
      auditEventInserts.push({
        id: String(auditValues[0]),
        schemaVersion: Number(auditValues[1]),
        name: String(auditValues[2]),
        outcome: String(auditValues[3]),
        requestId: String(auditValues[4]),
        occurredAt: String(auditValues[5]),
        actorUserId: nullableString(auditValues[6]),
        actorDeviceIdentifier: nullableString(auditValues[7]),
        targetType: nullableString(auditValues[8]),
        targetId: nullableString(auditValues[9]),
        contextJson: nullableString(auditValues[10]),
      })
    }
    failAccountKeyInitializationAt(options, 'audit')
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
    options.wrapperHistory.splice(
      0,
      options.wrapperHistory.length,
      ...wrapperHistoryBefore,
    )
    auditEventInserts.splice(auditLength)
    throw error
  }
}

function failAccountKeyInitializationAt(
  options: FakeD1DatabaseOptions,
  stage: NonNullable<
    FakeD1DatabaseOptions['accountKeyInitializationFailureAt']
  >,
): void {
  if (options.accountKeyInitializationFailureAt === stage) {
    throw new Error(`account key initialization ${stage} failed`)
  }
}

function isCredentialRotationBatch(
  statements: FakePreparedStatement[],
): boolean {
  return (
    (statements.length === 5 || statements.length === 6) &&
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
  options.wrapperHistory ??= []
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
  const wrapperHistoryBefore = structuredClone(options.wrapperHistory)
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
    const wrapperHistoryStatement = passwordChange
      ? requiredFakeStatement(
          statements,
          (query) =>
            query.includes(
              'INSERT OR IGNORE INTO user_key_rotation_wrapper_history',
            ),
          'wrapper_history',
        )
      : undefined
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

    if (wrapperHistoryStatement) {
      const inserted = generationMatches
        ? insertCredentialWrapperHistory(
            options.wrapperHistory,
            wrapperHistoryStatement.__fakeBoundValues,
          )
        : []
      failCredentialRotationAt(options, 'wrapper_history')
      results.set(wrapperHistoryStatement, {
        success: true,
        results: inserted,
        meta: { ...fakeMeta, changes: inserted.length },
      })
    }

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
    options.wrapperHistory.splice(
      0,
      options.wrapperHistory.length,
      ...wrapperHistoryBefore,
    )
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
    fakeColumn(user, 'revisionDate', 'revision_date') === values[13] &&
    fakeColumn(user, 'userKey', 'user_key') === values[14] &&
    fakeColumn(user, 'privateKey', 'private_key') === values[15] &&
    !wrapperHistoryContains(options.wrapperHistory ?? [], user, values[16])
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
    fakeColumn(user, 'revisionDate', 'revision_date') === values[17] &&
    fakeColumn(user, 'userKey', 'user_key') === values[18] &&
    fakeColumn(user, 'privateKey', 'private_key') === values[19] &&
    !wrapperHistoryContains(options.wrapperHistory ?? [], user, values[20])
  )
}

function insertCredentialWrapperHistory(
  history: NonNullable<FakeD1DatabaseOptions['wrapperHistory']>,
  values: unknown[],
): Array<{
  wrapperKind: 'user_key' | 'private_key'
  wrapperSha256: string
}> {
  const entries = JSON.parse(String(values[0])) as Array<{
    kind: 'user_key' | 'private_key'
    sha256: string
  }>
  const userId = String(values[1])
  const recordedAt = String(values[2])
  const inserted: Array<{
    wrapperKind: 'user_key' | 'private_key'
    wrapperSha256: string
  }> = []
  for (const entry of entries) {
    if (
      history.some(
        (row) => row.userId === userId && row.wrapperSha256 === entry.sha256,
      )
    ) {
      continue
    }
    history.push({
      userId,
      wrapperKind: entry.kind,
      wrapperSha256: entry.sha256,
      recordedAt,
    })
    inserted.push({
      wrapperKind: entry.kind,
      wrapperSha256: entry.sha256,
    })
  }
  return inserted
}

function wrapperHistoryContains(
  history: NonNullable<FakeD1DatabaseOptions['wrapperHistory']>,
  user: Record<string, unknown>,
  wrapperSha256: unknown,
): boolean {
  return history.some(
    (row) =>
      row.userId === fakeColumn(user, 'id', 'id') &&
      row.wrapperSha256 === wrapperSha256,
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
    (revision.includes('FROM collections candidate') ||
      revision.includes('FROM accessible_organization_collections access')) &&
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
  const revisionValues = organizationStatementValues(
    statements[0] as FakePreparedStatement,
  )
  const mutationValues = organizationStatementValues(
    statements[1] as FakePreparedStatement,
  )
  const now = String(revisionValues[0] ?? '')
  const organizationId = String(revisionValues[2] ?? '')
  const collectionId = String(revisionValues[3] ?? '')
  const actorValues = statements[0]?.__fakeBoundValues ?? []
  const userId = String(
    isSharedOrganizationAccessQuery(statements[0]?.__fakeQuery ?? '')
      ? actorValues[0]
      : (revisionValues[4] ?? ''),
  )
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
    true,
    actorValues,
  )

  if (
    !organization ||
    !collection ||
    managedCollectionIds.length !== 1 ||
    !isActiveFakeOrganizationActor(
      options,
      actorValues,
      statements[0]?.__fakeQuery ?? '',
    )
  ) {
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
    (revision.includes('COUNT(DISTINCT candidate.id)') ||
      revision.includes('COUNT(DISTINCT access.collectionId)')) &&
    revision.includes('FROM collection_ciphers selected_mapping') &&
    /DELETE\s+FROM\s+collections/.test(deletion) &&
    deletion.includes('changes() = 1')
  )
}

function applyOrganizationCollectionDeleteBatch(
  options: FakeD1DatabaseOptions,
  statements: FakePreparedStatement[],
): D1Result[] {
  const revisionValues = organizationStatementValues(
    statements[0] as FakePreparedStatement,
  )
  const deletionValues = organizationStatementValues(
    statements[1] as FakePreparedStatement,
  )
  const now = String(revisionValues[0] ?? '')
  const organizationId = String(deletionValues[0] ?? '')
  const actorValues = statements[0]?.__fakeBoundValues ?? []
  const userId = String(
    isSharedOrganizationAccessQuery(statements[0]?.__fakeQuery ?? '')
      ? actorValues[0]
      : (revisionValues[3] ?? ''),
  )
  const collectionIds = statements[1]?.__fakeQuery.includes('json_each(?)')
    ? (JSON.parse(String(deletionValues[1])) as string[])
    : deletionValues.slice(1).map(String)
  const organization = options.organizations?.find(
    (row) => row.id === organizationId,
  )
  const managedCollectionIds = findManagedOrganizationCollectionIds(
    options,
    userId,
    organizationId,
    collectionIds,
    true,
    actorValues,
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
    Boolean(organization && Number(organization.enabled ?? 1) === 1) &&
    collectionIds.length > 0 &&
    selectedIds.size === collectionIds.length &&
    managedCollectionIds.length === collectionIds.length &&
    isActiveFakeOrganizationActor(
      options,
      actorValues,
      statements[0]?.__fakeQuery ?? '',
    ) &&
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

    return [1, deleted].map((changes, index) => ({
      success: true,
      results:
        index === 1 && statements[1]?.__fakeQuery.includes('RETURNING id')
          ? collectionIds.map((id) => ({ id }))
          : [],
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

function isOrganizationCipherTransitionBatch(
  statements: FakePreparedStatement[],
): boolean {
  const mutation = statements[0]?.__fakeQuery ?? ''
  const mappings = statements[1]?.__fakeQuery ?? ''

  return (
    statements.length === 2 &&
    (mutation.includes('INSERT INTO ciphers') ||
      /UPDATE\s+ciphers/.test(mutation)) &&
    mutation.includes('COUNT(DISTINCT collection.id)') &&
    mappings.includes('INSERT INTO collection_ciphers') &&
    mappings.includes('changes() = 1')
  )
}

function applyOrganizationCipherTransitionBatch(
  options: FakeD1DatabaseOptions,
  statements: FakePreparedStatement[],
): D1Result[] {
  const restoreCiphers = snapshotFakeRows(options.ciphers)
  const restoreMappings = snapshotFakeRows(options.collectionCiphers)

  try {
    const mutationChanges = applyOrganizationCipherMutation(
      options,
      statements[0] as FakePreparedStatement,
    )
    if (
      mutationChanges === 1 &&
      options.organizationCipherBatchFailureAt === 'cipher'
    ) {
      throw new Error('Organization cipher mutation failed')
    }

    const mappingChanges =
      mutationChanges === 1
        ? applyOrganizationCipherMappings(
            options,
            statements[1] as FakePreparedStatement,
          )
        : 0
    if (
      mutationChanges === 1 &&
      options.organizationCipherBatchFailureAt === 'mappings'
    ) {
      throw new Error('Organization cipher mapping insert failed')
    }

    return [mutationChanges, mappingChanges].map((changes) => ({
      success: true,
      results: [],
      meta: { ...fakeMeta, changes },
    }))
  } catch (error) {
    restoreCiphers()
    restoreMappings()
    throw error
  }
}

function applyOrganizationCipherMutation(
  options: FakeD1DatabaseOptions,
  statement: FakePreparedStatement,
): number {
  const values = organizationStatementValues(statement)
  const query = statement.__fakeQuery
  const shared = isSharedOrganizationAccessQuery(query)
  const requestedCollectionIds = query.includes('json_each(?)')
    ? (JSON.parse(String(values[11])) as string[])
    : values.slice(12, -1).map(String)
  const expectedCollectionCount = Number(values.at(-1))
  const guardUserId = String(
    shared ? statement.__fakeBoundValues[0] : (values[10] ?? ''),
  )
  const guardOrganizationId = String(values[shared ? 10 : 11] ?? '')
  const managedCollectionIds = findManagedOrganizationCollectionIds(
    options,
    guardUserId,
    guardOrganizationId,
    requestedCollectionIds,
    false,
    statement.__fakeBoundValues,
  )

  if (
    requestedCollectionIds.length !== expectedCollectionCount ||
    managedCollectionIds.length !== expectedCollectionCount ||
    !isActiveFakeOrganizationActor(options, statement.__fakeBoundValues, query)
  ) {
    return 0
  }

  if (query.includes('INSERT INTO ciphers')) {
    const id = String(values[0] ?? '')
    const userId = String(values[1] ?? '')
    const organizationId = String(values[8] ?? '')
    if (userId !== guardUserId || organizationId !== guardOrganizationId) {
      return 0
    }
    if (options.ciphers?.some((row) => row.id === id)) {
      throw new Error('Duplicate cipher')
    }

    options.ciphers?.push({
      id,
      userId,
      folderId: null,
      type: Number(values[2]),
      favorite: Number(values[3]),
      encryptedJson: String(values[4]),
      revisionDate: String(values[5]),
      createdAt: String(values[6]),
      updatedAt: String(values[7]),
      deletedAt: null,
      organizationId,
      cipherKey: String(values[9]),
    })
    return 1
  }

  const id = String(values[7] ?? '')
  const userId = String(values[8] ?? '')
  const expectedRevisionDate = String(values[9] ?? '')
  const row = options.ciphers?.find(
    (candidate) =>
      candidate.id === id &&
      candidate.userId === userId &&
      candidate.organizationId == null &&
      candidate.deletedAt == null &&
      candidate.revisionDate === expectedRevisionDate &&
      !(options.collectionCiphers ?? []).some(
        (mapping) => mapping.cipherId === id,
      ) &&
      !(options.attachments ?? []).some(
        (attachment) => attachment.cipherId === id,
      ),
  )
  if (
    !row ||
    userId !== guardUserId ||
    String(values[5] ?? '') !== guardOrganizationId
  ) {
    return 0
  }

  Object.assign(row, {
    folderId: null,
    type: Number(values[0]),
    favorite: Number(values[1]),
    encryptedJson: String(values[2]),
    revisionDate: String(values[3]),
    updatedAt: String(values[4]),
    organizationId: String(values[5]),
    cipherKey: String(values[6]),
  })
  return 1
}

function applyOrganizationCipherMappings(
  options: FakeD1DatabaseOptions,
  statement: FakePreparedStatement,
): number {
  const values = organizationStatementValues(statement)
  const cipherId = String(values[0] ?? '')
  const shared = isSharedOrganizationAccessQuery(statement.__fakeQuery)
  const userId = String(
    shared ? statement.__fakeBoundValues[0] : (values[1] ?? ''),
  )
  const organizationId = String(values[shared ? 1 : 2] ?? '')
  const requestedCollectionIds = statement.__fakeQuery.includes('json_each(?)')
    ? (JSON.parse(String(values[2])) as string[])
    : values.slice(3, -5).map(String)
  const [transitionedCipherId, transitionedUserId, transitionedOrganizationId] =
    values.slice(-5, -2).map(String)
  const revisionDate = String(values.at(-2) ?? '')
  const updatedAt = String(values.at(-1) ?? '')
  const managedCollectionIds = findManagedOrganizationCollectionIds(
    options,
    userId,
    organizationId,
    requestedCollectionIds,
    false,
    statement.__fakeBoundValues,
  )
  const cipher = options.ciphers?.find(
    (row) =>
      row.id === transitionedCipherId &&
      row.userId === transitionedUserId &&
      row.organizationId === transitionedOrganizationId &&
      row.revisionDate === revisionDate &&
      row.updatedAt === updatedAt,
  )
  if (
    !cipher ||
    cipherId !== transitionedCipherId ||
    userId !== transitionedUserId ||
    organizationId !== transitionedOrganizationId
  ) {
    return 0
  }

  for (const collectionId of managedCollectionIds) {
    const duplicate = options.collectionCiphers?.some(
      (mapping) =>
        mapping.collectionId === collectionId && mapping.cipherId === cipherId,
    )
    if (duplicate) {
      throw new Error('Duplicate collection cipher')
    }
    options.collectionCiphers?.push({ collectionId, cipherId })
  }

  return managedCollectionIds.length
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
  const revisionValues = revisionStatement
    ? organizationStatementValues(revisionStatement)
    : []
  const now = String(revisionValues[0] ?? '')
  const organizationId = String(revisionValues[2] ?? '')
  const organizationUserId = String(revisionValues[3] ?? '')
  const userId = String(
    revisionStatement &&
      isSharedOrganizationAccessQuery(revisionStatement.__fakeQuery)
      ? revisionStatement.__fakeBoundValues[0]
      : (revisionValues[4] ?? ''),
  )
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

  if (
    !organization ||
    Number(organization.enabled ?? 1) !== 1 ||
    !owner ||
    !fakeOrganizationPolicyAllows(
      options,
      organizationId,
      userId,
      revisionStatement?.__fakeBoundValues,
    ) ||
    !isActiveFakeOrganizationActor(
      options,
      revisionStatement?.__fakeBoundValues ?? [],
      revisionStatement?.__fakeQuery ?? '',
    )
  ) {
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
  if (
    statements.some(
      (statement) =>
        !isActiveFakeOrganizationActor(
          options,
          statement.__fakeBoundValues,
          statement.__fakeQuery,
        ),
    )
  ) {
    return statements.map(() => fakeResult(0))
  }
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
  const values = organizationStatementValues(statement)
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
    const fixedType = query.includes('SELECT ?, ?, ?, ?, 0, ?, ?')
    pushUniqueFakeRow(options.collections, 'id', {
      id: String(values[0]),
      organizationId: String(values[1]),
      encryptedName: String(values[2]),
      externalId: values[3] === null ? null : String(values[3]),
      type: fixedType ? 0 : Number(values[4]),
      revisionDate: String(values[fixedType ? 4 : 5]),
      createdAt: String(values[fixedType ? 5 : 6]),
    })
    return
  }

  if (query.includes('INSERT INTO collection_users')) {
    const fixedGrant = query.includes('SELECT ?, ?, 0, 0, 1')
    const row = {
      collectionId: String(values[0]),
      organizationUserId: String(values[1]),
      readOnly: fixedGrant ? 0 : Number(values[2]),
      hidePasswords: fixedGrant ? 0 : Number(values[3]),
      manage: fixedGrant ? 1 : Number(values[4]),
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

  return (
    options.organizations?.find(
      (row) => row.id === organizationId && Number(row.enabled ?? 1) === 1,
    ) ?? null
  )
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

  const enabled = options.organizations?.some(
    (row) => row.id === organizationId && Number(row.enabled ?? 1) === 1,
  )
  return membership && enabled
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
    if (organization && Number(organization.enabled ?? 1) === 1) {
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
  requireAdministration = true,
  actorValues: unknown[] = [],
): string[] {
  const access = findConfirmedCollectionAccess(options, userId, actorValues)
  if (!requireAdministration)
    return requestedCollectionIds
      .filter(
        (id) =>
          access.get(id)?.organizationId === organizationId &&
          access.get(id)?.canEdit,
      )
      .sort()
  const owner = options.organizationUsers?.some(
    (membership) =>
      membership.userId === userId &&
      membership.organizationId === organizationId &&
      Number(membership.status) === 2 &&
      Number(membership.type) === 0,
  )
  if (!owner) return []
  return requestedCollectionIds
    .filter((id) => {
      const grant = access.get(id)
      return (
        grant?.organizationId === organizationId &&
        grant.manage &&
        grant.canEdit
      )
    })
    .sort()
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

  const organization = options.organizations?.find(
    (row) => row.id === membershipOrganizationId,
  )
  if (organization && Number(organization.enabled ?? 1) !== 1) return null
  const grants: Record<string, unknown>[] = []

  for (const membership of options.organizationUsers ?? []) {
    if (
      membership.userId !== userId ||
      membership.organizationId !== membershipOrganizationId ||
      Number(membership.status) !== 2 ||
      ![0, 1, 2].includes(Number(membership.type ?? 2))
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
          row.organizationId === membershipOrganizationId,
      )
      const collectionCipher = options.collectionCiphers?.find(
        (row) =>
          row.collectionId === collection?.id && row.cipherId === cipherId,
      )
      if (collection && collectionCipher) {
        grants.push({
          hasManageAccess: 1,
          readOnly: Number(collectionUser.readOnly ?? 0),
          hidePasswords: Number(collectionUser.hidePasswords ?? 0),
        })
      }
    }
  }

  return grants.length > 0
    ? {
        hasManageAccess: grants.length,
        readOnly: Math.min(...grants.map((grant) => Number(grant.readOnly))),
        hidePasswords: Math.min(
          ...grants.map((grant) => Number(grant.hidePasswords)),
        ),
      }
    : null
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
      (row) =>
        row.id === id &&
        row.userId === userId &&
        (!query.includes('organization_id IS NULL') ||
          row.organizationId == null),
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

function isPersonalApiKeyMutationBatch(
  statements: FakePreparedStatement[],
): boolean {
  return (
    statements.some((statement) =>
      /(?:INSERT INTO|UPDATE)\s+personal_api_keys/.test(statement.__fakeQuery),
    ) &&
    statements.some((statement) =>
      statement.__fakeQuery.includes('INSERT INTO audit_events'),
    )
  )
}

async function applyPersonalApiKeyMutationBatch<T = unknown>(
  options: FakeD1DatabaseOptions,
  statements: D1PreparedStatement[],
  fakeStatements: FakePreparedStatement[],
  auditEventInserts: FakeAuditEventInsert[],
): Promise<D1Result<T>[]> {
  const personalApiKeys = (options.personalApiKeys ??= [])
  const personalApiKeySnapshot = personalApiKeys.map((row) => ({ ...row }))
  const auditEventCount = auditEventInserts.length
  const results: D1Result<T>[] = []
  let previousChanges = 0

  try {
    for (let index = 0; index < statements.length; index += 1) {
      const fakeStatement = fakeStatements[index]
      const statement = statements[index]
      if (!fakeStatement || !statement) {
        throw new Error('Fake D1 batch statement mismatch.')
      }

      if (
        fakeStatement.__fakeQuery.includes('WHERE changes() = 1') &&
        previousChanges !== 1
      ) {
        results.push({
          success: true,
          results: [],
          meta: fakeMeta,
        })
        previousChanges = 0
        continue
      }

      const result = await statement.run<T>()
      results.push(result)
      previousChanges = result.meta.changes
    }

    return results
  } catch (error) {
    personalApiKeys.splice(0, personalApiKeys.length, ...personalApiKeySnapshot)
    auditEventInserts.splice(auditEventCount)
    throw error
  }
}

function findPersonalApiKeyRow(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
  query: string,
): Record<string, unknown> | null {
  const userId = String(boundValues[0] ?? '')
  const row = (options.personalApiKeys ?? []).find(
    (candidate) => candidate.userId === userId,
  )
  if (!row) {
    return null
  }

  if (query.includes('secret_verifier as secretVerifier')) {
    return {
      userId: row.userId,
      secretVerifier: row.secretVerifier,
      revisionDate: row.revisionDate,
    }
  }

  return {
    userId: row.userId,
    createdAt: row.createdAt,
    rotatedAt: row.rotatedAt ?? null,
    lastUsedAt: row.lastUsedAt ?? null,
    revisionDate: row.revisionDate,
  }
}

function insertPersonalApiKey(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
): number {
  const rows = (options.personalApiKeys ??= [])
  const userId = String(boundValues[0] ?? '')
  if (rows.some((row) => row.userId === userId)) {
    return 0
  }

  rows.push({
    userId,
    secretVerifier: String(boundValues[1] ?? ''),
    createdAt: String(boundValues[2] ?? ''),
    rotatedAt: null,
    lastUsedAt: null,
    revisionDate: String(boundValues[3] ?? ''),
  })
  return 1
}

function updatePersonalApiKey(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
  query: string,
): number {
  const rows = options.personalApiKeys ?? []

  if (query.includes('SET last_used_at = ?')) {
    const userId = String(boundValues[1] ?? '')
    const expectedVerifier = String(boundValues[2] ?? '')
    const row = rows.find(
      (candidate) =>
        candidate.userId === userId &&
        candidate.secretVerifier === expectedVerifier,
    )
    if (!row) {
      return 0
    }
    row.lastUsedAt = String(boundValues[0] ?? '')
    return 1
  }

  const userId = String(boundValues[3] ?? '')
  const row = rows.find((candidate) => candidate.userId === userId)
  if (!row) {
    return 0
  }
  row.secretVerifier = String(boundValues[0] ?? '')
  row.rotatedAt = String(boundValues[1] ?? '')
  row.revisionDate = String(boundValues[2] ?? '')
  return 1
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
  query = '',
): string | null {
  const userId = String(boundValues[0] ?? '')
  const revisions: string[] = []
  const users =
    options.authUsers ?? (options.authUser ? [options.authUser] : [])
  const collectionAccess = isActiveFakeOrganizationActor(
    options,
    boundValues,
    query,
  )
    ? findConfirmedCollectionAccess(options, userId, boundValues)
    : new Map()

  for (const user of users) {
    if (user.id === userId && typeof user.revisionDate === 'string') {
      revisions.push(user.revisionDate)
    }
  }

  for (const row of options.folders ?? []) {
    if (row.userId === userId && typeof row.revisionDate === 'string') {
      revisions.push(row.revisionDate)
    }
  }

  for (const row of options.ciphers ?? []) {
    const organizationId =
      typeof row.organizationId === 'string' ? row.organizationId : null
    const isPersonal = organizationId === null && row.userId === userId
    const isAccessibleOrganizationCipher =
      organizationId !== null &&
      (options.collectionCiphers ?? []).some((mapping) => {
        if (mapping.cipherId !== row.id) {
          return false
        }
        const access = collectionAccess.get(String(mapping.collectionId))
        return access?.organizationId === organizationId
      })

    if (
      (isPersonal || isAccessibleOrganizationCipher) &&
      typeof row.revisionDate === 'string'
    ) {
      revisions.push(row.revisionDate)
    }
  }

  for (const membership of options.organizationUsers ?? []) {
    if (
      membership.userId !== userId ||
      Number(membership.status) !== 2 ||
      ![0, 1, 2].includes(Number(membership.type ?? 2))
    ) {
      continue
    }
    const organization = options.organizations?.find(
      (row) => row.id === membership.organizationId,
    )
    if (
      organization &&
      Number(organization.enabled ?? 1) === 1 &&
      typeof organization.revisionDate === 'string'
    ) {
      revisions.push(organization.revisionDate)
    }
  }

  return revisions.sort().at(-1) ?? null
}

function applyFakePendingTotpSetup(
  options: FakeD1DatabaseOptions,
  values: unknown[],
): D1Result {
  const userId = values[0]
  const users =
    options.authUsers ?? (options.authUser ? [options.authUser] : [])
  const active =
    userId === values[4] &&
    users.some((user) => user.id === userId && user.disabledAt == null) &&
    options.devices?.some(
      (device) =>
        device.userId === userId &&
        device.identifier === values[5] &&
        device.sessionId === values[6] &&
        device.revokedAt == null,
    )
  const factor = fakeTotpRows(options).find((row) => row.userId === userId)
  if (
    !active ||
    options.userTotpInsertChanges === 0 ||
    (factor && Number(factor.enabled) !== 0)
  )
    return fakeResult(0)
  const pending = factor ?? { userId, createdAt: values[2] }
  Object.assign(pending, {
    encryptedSecret: values[1],
    enabled: 0,
    verifiedAt: null,
    lastAcceptedStep: null,
    credentialGeneration: null,
    pendingEncryptedSecret: null,
    pendingCreatedAt: null,
    updatedAt: values[3],
  })
  if (!factor) {
    if (options.userTotps) options.userTotps.push(pending)
    else options.userTotp = pending
  }
  invalidateFakeTotpAssurance(options, userId)
  return { ...fakeResult(1), results: [{ user_id: userId }] }
}

function applyFakeTotpDisableBatch(
  options: FakeD1DatabaseOptions,
  statements: FakePreparedStatement[],
  auditEvents: FakeAuditEventInsert[],
): D1Result[] {
  const values = statements[0]?.__fakeBoundValues ?? []
  const factor = fakeTotpRows(options).find((row) => row.userId === values[0])
  const users =
    options.authUsers ?? (options.authUser ? [options.authUser] : [])
  const user = users.find(
    (row) => row.id === values[0] && row.disabledAt == null,
  )
  const activeDevice = options.devices?.some(
    (device) =>
      device.userId === values[0] &&
      device.identifier === values[2] &&
      device.sessionId === values[3] &&
      device.revokedAt == null,
  )
  const wouldRemoveLastOwner = (options.organizationUsers ?? []).some(
    (membership) => {
      if (
        membership.userId !== values[0] ||
        Number(membership.status) !== 2 ||
        Number(membership.type) !== 0 ||
        !options.organizations?.some(
          (organization) =>
            organization.id === membership.organizationId &&
            Number(organization.enabled ?? 1) === 1,
        ) ||
        !options.organizationPolicies?.some(
          (policy) =>
            policy.organizationId === membership.organizationId &&
            Number(policy.type) === 0 &&
            Number(policy.enabled) === 1,
        )
      )
        return false
      return !options.organizationUsers?.some(
        (survivor) =>
          survivor.organizationId === membership.organizationId &&
          survivor.userId !== values[0] &&
          Number(survivor.status) === 2 &&
          Number(survivor.type) === 0 &&
          users.some(
            (account) =>
              account.id === survivor.userId && account.disabledAt == null,
          ) &&
          fakeTotpRows(options).some(
            (enrollment) =>
              enrollment.userId === survivor.userId &&
              Number(enrollment.enabled) === 1 &&
              enrollment.verifiedAt != null &&
              enrollment.credentialGeneration != null,
          ),
      )
    },
  )
  if (
    !factor ||
    !user ||
    !activeDevice ||
    Number(factor.enabled) !== 1 ||
    factor.credentialGeneration !== values[1] ||
    options.userTotpDeleteChanges === 0 ||
    wouldRemoveLastOwner
  ) {
    return statements.map(() => fakeResult(0))
  }
  if (options.auditEventInsertThrows)
    throw new Error('audit event insert failed')
  if (options.userTotp === factor) options.userTotp = null
  if (options.userTotps)
    options.userTotps.splice(options.userTotps.indexOf(factor), 1)
  invalidateFakeTotpAssurance(options, values[0])
  const revision = statements[1]?.__fakeBoundValues ?? []
  user.revisionDate = revision[0]
  user.updatedAt = revision[1]
  const audit = statements[2]?.__fakeBoundValues ?? []
  auditEvents.push({
    id: String(audit[0]),
    schemaVersion: 1,
    name: 'totp.disable',
    outcome: 'success',
    requestId: String(audit[1]),
    occurredAt: String(audit[2]),
    actorUserId: String(audit[3]),
    actorDeviceIdentifier: String(audit[4]),
    targetType: 'account',
    targetId: String(audit[5]),
    contextJson: String(audit[6]),
  })
  const result = fakeResult(1)
  return [
    { ...result, results: [{ user_id: values[0] }] },
    fakeResult(1),
    fakeResult(1),
  ]
}

function invalidateFakeTotpAssurance(
  options: FakeD1DatabaseOptions,
  userId: unknown,
): void {
  for (const device of options.devices ?? []) {
    if (device.userId === userId) {
      device.mfaTotpCredentialGeneration = null
      device.mfaVerifiedAt = null
    }
  }
}

function applyFakeTotpSessionBatch(
  options: FakeD1DatabaseOptions,
  statements: FakePreparedStatement[],
): D1Result[] {
  const first = statements[0] as FakePreparedStatement
  const pendingChange =
    statements[1]?.__fakeQuery.includes('SET pending_encrypted_secret = ?') ??
    false
  const proof = (
    pendingChange ? statements[2] : statements[1]
  ) as FakePreparedStatement
  const values = first.__fakeBoundValues
  const query = first.__fakeQuery
  const passwordLogin = proof.__fakeQuery.includes('INSERT INTO devices')
  const enrollment = query.includes('SET enabled = 1')
  const promotion = query.includes(
    'encrypted_secret = pending_encrypted_secret',
  )
  const userId = enrollment || promotion ? values[4] : values[2]
  const factor = fakeTotpRows(options).find((row) => row.userId === userId)
  const users =
    options.authUsers ?? (options.authUser ? [options.authUser] : [])
  const user = users.find((row) => row.id === userId && row.disabledAt == null)
  const proofValues = proof.__fakeBoundValues
  const device = passwordLogin
    ? options.devices?.find((row) => row.id === proofValues[0])
    : options.devices?.find(
        (row) =>
          row.userId === userId &&
          row.identifier === proofValues[3] &&
          row.sessionId === proofValues[4] &&
          row.revokedAt == null,
      )
  const lastStep = factor?.lastAcceptedStep
  let allowed = Boolean(factor && user && options.userTotpUpdateChanges !== 0)
  if (passwordLogin) {
    allowed &&=
      Number(factor?.enabled) === 1 &&
      factor?.verifiedAt != null &&
      factor?.credentialGeneration === values[3] &&
      (lastStep == null || Number(values[0]) > Number(lastStep)) &&
      user?.masterPasswordHash === values[5] &&
      user?.securityStamp === values[6]
  } else if (enrollment) {
    allowed &&=
      Boolean(device) &&
      Number(factor?.enabled) === 0 &&
      factor?.encryptedSecret === values[5] &&
      (lastStep == null || Number(values[1]) > Number(lastStep))
  } else if (promotion) {
    allowed &&=
      Boolean(device) &&
      Number(factor?.enabled) === 1 &&
      factor?.verifiedAt != null &&
      factor?.credentialGeneration === values[5] &&
      factor?.pendingEncryptedSecret === values[6]
  } else {
    allowed &&=
      Boolean(device) &&
      Number(factor?.enabled) === 1 &&
      factor?.verifiedAt != null &&
      factor?.credentialGeneration === values[3] &&
      (lastStep == null || Number(values[0]) > Number(lastStep))
  }
  if (!passwordLogin) {
    const scopeOffset = enrollment || promotion ? 7 : 5
    allowed &&=
      values[scopeOffset] === device?.identifier &&
      values[scopeOffset + 1] === device?.sessionId
  }
  if (!allowed || !factor) return statements.map(() => fakeResult(0))
  const restoreFactors = snapshotFakeRows(fakeTotpRows(options))
  const restoreDevices = snapshotFakeRows(options.devices)
  const restoreRefreshTokens = snapshotFakeRows(options.refreshTokens)
  try {
    if (enrollment || promotion) {
      invalidateFakeTotpAssurance(options, userId)
      Object.assign(factor, {
        enabled: 1,
        verifiedAt: values[0],
        lastAcceptedStep: values[1],
        credentialGeneration: values[2],
        updatedAt: values[3],
      })
      if (promotion)
        Object.assign(factor, {
          encryptedSecret: factor.pendingEncryptedSecret,
          pendingEncryptedSecret: null,
          pendingCreatedAt: null,
        })
    } else {
      factor.lastAcceptedStep = values[0]
      factor.updatedAt = values[1]
    }
    if (pendingChange) {
      const pending = statements[1]?.__fakeBoundValues ?? []
      if (
        pending[3] !== userId ||
        pending[4] !== factor.credentialGeneration ||
        pending[5] !== device?.identifier ||
        pending[6] !== device?.sessionId
      ) {
        return [1, 0, 0].map(fakeResult)
      }
      factor.pendingEncryptedSecret = pending[0]
      factor.pendingCreatedAt = pending[1]
      factor.updatedAt = pending[2]
    }
    if (options.deviceUpdateChanges === 0)
      return statements.map((_, index) => fakeResult(index === 0 ? 1 : 0))
    if (passwordLogin) {
      if (
        device &&
        (device.userId !== userId || device.identifier !== proofValues[2])
      ) {
        return [1, 0, 0].map(fakeResult)
      }
      options.devices ??= []
      const nextDevice = device ?? {
        id: proofValues[0],
        userId,
        identifier: proofValues[2],
        createdAt: proofValues[5],
      }
      if (!device) options.devices.push(nextDevice)
      Object.assign(nextDevice, {
        name: proofValues[3],
        type: proofValues[4],
        lastSeenAt: proofValues[5],
        updatedAt: proofValues[6],
        sessionId: proofValues[7],
        mfaTotpCredentialGeneration: proofValues[8],
        mfaVerifiedAt: proofValues[9],
        revokedAt: null,
      })
      const token = statements[2]?.__fakeBoundValues ?? []
      if (
        nextDevice.id !== token[6] ||
        nextDevice.userId !== token[7] ||
        nextDevice.identifier !== token[8] ||
        nextDevice.sessionId !== token[9] ||
        nextDevice.mfaTotpCredentialGeneration !== token[10] ||
        token[1] !== userId ||
        token[2] !== nextDevice.id ||
        token[5] !== nextDevice.sessionId
      ) {
        return [1, 1, 0].map(fakeResult)
      }
      options.refreshTokens ??= []
      options.refreshTokens.push({
        id: token[0],
        userId: token[1],
        deviceId: token[2],
        tokenHash: token[3],
        expiresAt: token[4],
        sessionId: token[5],
        revokedAt: null,
      })
      return [1, 1, 1].map(fakeResult)
    }
    if (
      !device ||
      proofValues[0] !== factor.credentialGeneration ||
      proofValues[5] !== factor.credentialGeneration
    ) {
      return [1, 0].map(fakeResult)
    }
    Object.assign(device, {
      mfaTotpCredentialGeneration: proofValues[0],
      mfaVerifiedAt: proofValues[1],
    })
    return statements.map(() => fakeResult(1))
  } catch (error) {
    restoreFactors()
    restoreDevices()
    restoreRefreshTokens()
    throw error
  }
}

function isSharedOrganizationAccessQuery(query: string): boolean {
  return (
    query.includes('requested_actor AS') &&
    query.includes('accessible_organization_collections AS')
  )
}

function organizationStatementValues(
  statement: FakePreparedStatement,
): unknown[] {
  return statement.__fakeQuery.includes('requested_actor AS')
    ? statement.__fakeBoundValues.slice(
        organizationActorValueCount(statement.__fakeQuery),
      )
    : statement.__fakeBoundValues
}

function organizationActorValueCount(query: string): number {
  return query.includes('actor_provided') ? 4 : 3
}

function isActiveFakeOrganizationActor(
  options: FakeD1DatabaseOptions,
  values: unknown[],
  query: string,
): boolean {
  if (!query.includes('active_organization_actor')) return true
  const users =
    options.authUsers ?? (options.authUser ? [options.authUser] : [])
  if (!users.some((user) => user.id === values[0] && user.disabledAt == null))
    return false
  return (
    values[3] === 0 ||
    Boolean(
      options.devices?.some(
        (device) =>
          device.userId === values[0] &&
          device.sessionId === values[1] &&
          device.identifier === values[2] &&
          device.revokedAt == null,
      ),
    )
  )
}

function fakeTotpRows(
  options: FakeD1DatabaseOptions,
): Record<string, unknown>[] {
  return options.userTotps ?? (options.userTotp ? [options.userTotp] : [])
}

function hasFakeSessionTotpAssurance(
  options: FakeD1DatabaseOptions,
  userId: string,
  sessionId: unknown,
  deviceIdentifier: unknown,
): boolean {
  const users =
    options.authUsers ?? (options.authUser ? [options.authUser] : [])
  if (!users.some((user) => user.id === userId && user.disabledAt == null))
    return false
  if (typeof sessionId !== 'string' || typeof deviceIdentifier !== 'string')
    return false
  return fakeTotpRows(options).some(
    (factor) =>
      factor.userId === userId &&
      Number(factor.enabled) === 1 &&
      factor.verifiedAt != null &&
      typeof factor.credentialGeneration === 'string' &&
      options.devices?.some(
        (device) =>
          device.userId === userId &&
          device.sessionId === sessionId &&
          device.identifier === deviceIdentifier &&
          device.revokedAt == null &&
          device.mfaTotpCredentialGeneration === factor.credentialGeneration &&
          device.mfaVerifiedAt != null,
      ),
  )
}

function fakeOrganizationPolicyAllows(
  options: FakeD1DatabaseOptions,
  organizationId: unknown,
  userId: string,
  actorValues: unknown[] = [],
): boolean {
  const requiresTotp = options.organizationPolicies?.some(
    (policy) =>
      policy.organizationId === organizationId &&
      Number(policy.type) === 0 &&
      Number(policy.enabled) === 1,
  )
  return (
    !requiresTotp ||
    hasFakeSessionTotpAssurance(options, userId, actorValues[1], actorValues[2])
  )
}

function readSharedOrganizationAccessRows(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
  query: string,
): Record<string, unknown>[] {
  const userId = String(boundValues[0] ?? '')
  const values = boundValues.slice(organizationActorValueCount(query))
  const activeActor = isActiveFakeOrganizationActor(options, boundValues, query)
  const accessOptions = {
    ...options,
    organizationUsers: activeActor ? (options.organizationUsers ?? []) : [],
  }
  const access = findConfirmedCollectionAccess(
    accessOptions,
    userId,
    boundValues,
  )
  const memberships = (options.organizationUsers ?? []).filter(
    (membership) =>
      activeActor &&
      membership.userId === userId &&
      Number(membership.status) === 2 &&
      [0, 1, 2].includes(Number(membership.type ?? 2)) &&
      options.organizations?.some(
        (organization) =>
          organization.id === membership.organizationId &&
          Number(organization.enabled ?? 1) === 1,
      ) &&
      fakeOrganizationPolicyAllows(
        options,
        membership.organizationId,
        userId,
        boundValues,
      ),
  )
  const scopedOptions = { ...options, organizationUsers: memberships }
  // Inspect the final statement, so tables inside the shared CTE cannot select
  // an unrelated fake handler (for example the TOTP or device lookup).
  const statementSql =
    query
      .split(/accessible_organization_collections AS \([\s\S]*?\n\s*\)/u)
      .at(-1) ?? query

  if (statementSql.includes('MAX(revision_date) as revisionDate')) {
    return [
      { revisionDate: findLatestRevisionDate(options, boundValues, query) },
    ]
  }
  if (statementSql.includes('FROM ciphers cipher')) {
    return listAccessibleCipherRows(accessOptions, boundValues, query)
  }
  if (statementSql.includes('COUNT(DISTINCT collection.id) as count')) {
    const requestedIds = new Set(
      query.includes('json_each(?)')
        ? (JSON.parse(String(values[1])) as string[])
        : values.slice(1).map(String),
    )
    return [
      {
        count: [...access].filter(
          ([collectionId, grant]) =>
            grant.organizationId === values[0] &&
            grant.canEdit &&
            requestedIds.has(collectionId),
        ).length,
      },
    ]
  }
  if (statementSql.includes('AS hasManageAccess')) {
    const grants = [...access]
      .filter(
        ([collectionId, grant]) =>
          grant.organizationId === values[0] &&
          options.collectionCiphers?.some(
            (mapping) =>
              mapping.collectionId === collectionId &&
              mapping.cipherId === values[1],
          ),
      )
      .map(([, grant]) => grant)
    return [
      {
        hasManageAccess: grants.length,
        readOnly: grants.length
          ? Number(!grants.some((grant) => grant.canEdit))
          : null,
        hidePasswords: grants.length
          ? Number(!grants.some((grant) => grant.canViewPassword))
          : null,
      },
    ]
  }
  if (statementSql.includes('FROM confirmed_memberships membership')) {
    const owner = findConfirmedOrganizationOwnerRow(scopedOptions, [
      values[0],
      userId,
    ])
    return owner ? [owner] : []
  }
  if (statementSql.includes('FROM organizations organization')) {
    const rows = listConfirmedOrganizationRows(scopedOptions, [userId])
    return statementSql.includes('WHERE organization.id = ?')
      ? rows.filter((organization) => organization.id === values[0])
      : rows
  }
  if (statementSql.includes('FROM collections collection')) {
    if (statementSql.includes('assigned_membership.id AS organizationUserId')) {
      if (
        !findConfirmedOrganizationOwnerRow(scopedOptions, [values[0], userId])
      )
        return []
      return listOrganizationCollectionUserRowsForOwner(options, [
        values[0],
        values[1],
        userId,
      ])
    }
    const ownerOnly = statementSql.includes('membership.type = 0')
    return (options.collections ?? [])
      .flatMap<Record<string, unknown>>((collection) => {
        const grant = access.get(String(collection.id))
        if (
          !grant ||
          (values[0] !== undefined &&
            collection.organizationId !== values[0]) ||
          (values[1] !== undefined && collection.id !== values[1])
        )
          return []
        if (
          ownerOnly &&
          (!grant.manage ||
            !grant.canEdit ||
            !memberships.some(
              (membership) =>
                membership.organizationId === collection.organizationId &&
                Number(membership.type) === 0,
            ))
        )
          return []
        return [
          {
            ...collection,
            readOnly: Number(!grant.canEdit),
            hidePasswords: Number(!grant.canViewPassword),
            manage: Number(grant.manage),
          },
        ]
      })
      .sort((left, right) => String(left.id).localeCompare(String(right.id)))
  }
  throw new Error('Unsupported shared organization access fixture query')
}

function findConfirmedCollectionAccess(
  options: FakeD1DatabaseOptions,
  userId: string,
  actorValues: unknown[] = [],
): Map<
  string,
  {
    organizationId: string
    manage: boolean
    canEdit: boolean
    canViewPassword: boolean
  }
> {
  const collectionAccess = new Map<
    string,
    {
      organizationId: string
      manage: boolean
      canEdit: boolean
      canViewPassword: boolean
    }
  >()

  for (const membership of options.organizationUsers ?? []) {
    if (
      membership.userId !== userId ||
      Number(membership.status) !== 2 ||
      ![0, 1, 2].includes(Number(membership.type ?? 2))
    ) {
      continue
    }
    if (
      !fakeOrganizationPolicyAllows(
        options,
        membership.organizationId,
        userId,
        actorValues,
      )
    )
      continue
    if (
      !options.organizations?.some(
        (row) =>
          row.id === membership.organizationId &&
          Number(row.enabled ?? 1) === 1,
      )
    ) {
      continue
    }

    const grants = (options.collectionUsers ?? []).filter(
      (grant) => grant.organizationUserId === membership.id,
    )
    for (const groupMember of options.organizationGroupUsers ?? []) {
      if (
        groupMember.organizationUserId !== membership.id ||
        groupMember.organizationId !== membership.organizationId
      )
        continue
      if (
        !options.organizationGroups?.some(
          (group) =>
            group.id === groupMember.groupId &&
            group.organizationId === membership.organizationId,
        )
      )
        continue
      grants.push(
        ...(options.collectionGroups ?? []).filter(
          (grant) =>
            grant.groupId === groupMember.groupId &&
            grant.organizationId === membership.organizationId,
        ),
      )
    }
    for (const collectionUser of grants) {
      const collection = options.collections?.find(
        (row) =>
          row.id === collectionUser.collectionId &&
          row.organizationId === membership.organizationId,
      )
      if (!collection) {
        continue
      }

      const collectionId = String(collection.id)
      const existing = collectionAccess.get(collectionId)
      collectionAccess.set(collectionId, {
        organizationId: String(collection.organizationId),
        manage:
          existing?.manage === true || Number(collectionUser.manage) === 1,
        canEdit:
          existing?.canEdit === true ||
          Number(collectionUser.readOnly ?? 0) === 0,
        canViewPassword:
          existing?.canViewPassword === true ||
          Number(collectionUser.hidePasswords ?? 0) === 0,
      })
    }
  }

  return collectionAccess
}

function findAccessibleCipherRow(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
  query: string,
): Record<string, unknown> | null {
  return listAccessibleCipherRows(options, boundValues, query)[0] ?? null
}

function listAccessibleCipherRows(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
  query: string,
): Record<string, unknown>[] {
  const userId = String(boundValues[0] ?? '')
  const accessibleCollections = findConfirmedCollectionAccess(
    options,
    userId,
    boundValues,
  )

  let rows: Record<string, unknown>[] = []
  for (const row of options.ciphers ?? []) {
    const organizationId =
      typeof row.organizationId === 'string' ? row.organizationId : null
    if (organizationId === null) {
      if (row.userId === userId) {
        rows.push({
          ...row,
          organizationId: null,
          cipherKey: null,
          collectionIdsJson: '[]',
          canEdit: 1,
          canViewPassword: 1,
        })
      }
      continue
    }

    const collectionIds = [
      ...new Set(
        (options.collectionCiphers ?? [])
          .filter(
            (mapping) =>
              mapping.cipherId === row.id &&
              accessibleCollections.get(String(mapping.collectionId))
                ?.organizationId === organizationId,
          )
          .map((mapping) => String(mapping.collectionId)),
      ),
    ].sort()

    if (collectionIds.length > 0) {
      rows.push({
        ...row,
        organizationId,
        cipherKey: row.cipherKey ?? null,
        collectionIdsJson: JSON.stringify(collectionIds),
        canEdit: Number(
          collectionIds.some((id) => accessibleCollections.get(id)?.canEdit),
        ),
        canViewPassword: Number(
          collectionIds.some(
            (id) => accessibleCollections.get(id)?.canViewPassword,
          ),
        ),
      })
    }
  }

  if (query.includes('WHERE cipher.id = ?')) {
    const cipherId = String(
      boundValues[
        isSharedOrganizationAccessQuery(query)
          ? organizationActorValueCount(query)
          : 1
      ] ?? '',
    )
    rows = rows.filter((row) => row.id === cipherId)
  }

  rows.sort(compareRevisionThenId)

  if (
    query.includes(
      '(cipher.revision_date > ? OR (cipher.revision_date = ? AND cipher.id > ?))',
    )
  ) {
    const cursorRevisionDate = String(
      boundValues[
        isSharedOrganizationAccessQuery(query)
          ? organizationActorValueCount(query) + 1
          : 2
      ] ?? '',
    )
    const cursorId = String(
      boundValues[
        isSharedOrganizationAccessQuery(query)
          ? organizationActorValueCount(query) + 3
          : 4
      ] ?? '',
    )
    rows = rows.filter((row) => {
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
      rows = rows.slice(0, limit)
    }
  }

  return rows
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
  if (query.includes('WHERE EXISTS') && query.includes('FROM ciphers')) {
    const row =
      options.cipher ??
      options.ciphers?.find(
        (candidate) =>
          candidate.id === boundValues[11] &&
          candidate.userId === boundValues[12],
      )
    if (
      !row ||
      row.id !== boundValues[11] ||
      row.userId !== boundValues[12] ||
      row.organizationId != null ||
      row.deletedAt != null
    )
      return 0
  }
  if (!options.attachments) {
    return 1
  }

  const id = String(boundValues[0])
  if (options.attachments.some((row) => row.id === id)) {
    return 0
  }

  if (query.includes('SELECT SUM(size)')) {
    const requestedSize = Number(boundValues[13])
    const userId = String(boundValues[14])
    const expiredBefore = String(boundValues[15])
    const maxStorageBytes = Number(boundValues[16])
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

function webAuthnChallenges(
  options: FakeD1DatabaseOptions,
): Record<string, unknown>[] {
  options.webauthnChallenges ??= []
  return options.webauthnChallenges
}

function webAuthnCredentials(
  options: FakeD1DatabaseOptions,
): Record<string, unknown>[] {
  options.webauthnCredentials ??= []
  return options.webauthnCredentials
}

function insertWebAuthnChallenge(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
): number {
  const [
    id,
    tokenHash,
    challengeHash,
    purpose,
    userId,
    credentialId,
    rpId,
    originPolicyVersion,
    expiresAt,
    createdAt,
    retentionDeleteAfter,
  ] = boundValues
  webAuthnChallenges(options).push({
    id,
    tokenHash,
    challengeHash,
    purpose,
    userId,
    credentialId,
    rpId,
    originPolicyVersion,
    expiresAt,
    consumedAt: null,
    createdAt,
    retentionDeleteAfter,
  })
  return 1
}

function insertWebAuthnCredential(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
  query: string,
): number {
  const credentials = webAuthnCredentials(options)
  const userId = String(boundValues[1])
  const credentialId = String(boundValues[2])
  const ownerCount = credentials.filter(
    (row) => String(row.userId) === userId,
  ).length
  const limit = Number(boundValues[22] ?? 5)
  if (ownerCount >= limit) {
    return 0
  }
  if (credentials.some((row) => String(row.credentialId) === credentialId)) {
    return 0
  }
  if (query.includes('EXISTS') && query.includes('webauthn_challenges')) {
    const tokenHash = String(boundValues[23])
    const challengeHash = String(boundValues[24])
    const consumedAt = String(boundValues[25])
    const purpose = String(boundValues[26])
    const matchingChallenge = webAuthnChallenges(options).some(
      (row) =>
        String(row.tokenHash) === tokenHash &&
        String(row.challengeHash) === challengeHash &&
        String(row.consumedAt) === consumedAt &&
        String(row.purpose) === purpose,
    )
    if (!matchingChallenge) {
      return 0
    }
  }

  credentials.push({
    id: boundValues[0],
    userId: boundValues[1],
    credentialId: boundValues[2],
    publicKey: boundValues[3],
    userHandle: boundValues[4],
    signCount: boundValues[5],
    credentialType: boundValues[6],
    transports: boundValues[7],
    aaguid: boundValues[8],
    discoverable: boundValues[9],
    backupEligible: boundValues[10],
    backupState: boundValues[11],
    prfSupported: boundValues[12],
    encryptedUserKey: boundValues[13],
    encryptedPublicKey: boundValues[14],
    encryptedPrivateKey: boundValues[15],
    name: boundValues[16],
    createdAt: boundValues[17],
    revisionDate: boundValues[18],
    lastUsedAt: boundValues[19],
    updatedAt: boundValues[20],
  })
  return 1
}

function consumeWebAuthnChallengeRow(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
  query: string,
): number {
  const consumedAt = String(boundValues[0])
  const userId = String(boundValues[1])
  const tokenHash = String(boundValues[2])
  const usesChallengeHash = query.includes('challenge_hash = ?')
  const purpose = String(boundValues[usesChallengeHash ? 4 : 3])
  const rpId = String(boundValues[usesChallengeHash ? 5 : 4])
  const originPolicyVersion = String(boundValues[usesChallengeHash ? 6 : 5])
  const now = String(boundValues[usesChallengeHash ? 7 : 6])
  const ownerId = String(boundValues[usesChallengeHash ? 8 : 7])
  const credentialId = boundValues[usesChallengeHash ? 9 : 8]
  const challengeHash = usesChallengeHash ? String(boundValues[3]) : null
  const credentialLimit = query.includes('COUNT(*)')
    ? Number(boundValues[usesChallengeHash ? 12 : 11] ?? 5)
    : Number.POSITIVE_INFINITY
  const duplicateCredentialId =
    query.includes('NOT EXISTS') && query.includes('credential_id = ?')
      ? String(boundValues[usesChallengeHash ? 13 : 12] ?? '')
      : null

  if (
    credentialLimit < Number.POSITIVE_INFINITY &&
    webAuthnCredentials(options).filter((row) => String(row.userId) === ownerId)
      .length >= credentialLimit
  ) {
    return 0
  }
  if (
    duplicateCredentialId &&
    webAuthnCredentials(options).some(
      (row) => String(row.credentialId) === duplicateCredentialId,
    )
  ) {
    return 0
  }

  const row = webAuthnChallenges(options).find((candidate) => {
    const sameCredential =
      credentialId == null
        ? candidate.credentialId == null
        : String(candidate.credentialId) === String(credentialId)
    return (
      String(candidate.tokenHash) === tokenHash &&
      String(candidate.purpose) === purpose &&
      String(candidate.rpId) === rpId &&
      String(candidate.originPolicyVersion) === originPolicyVersion &&
      candidate.consumedAt == null &&
      String(candidate.expiresAt) > now &&
      (candidate.userId == null || String(candidate.userId) === ownerId) &&
      sameCredential &&
      (challengeHash === null ||
        String(candidate.challengeHash) === challengeHash)
    )
  })
  if (!row) {
    return 0
  }

  row.consumedAt = consumedAt
  row.userId = row.userId ?? userId
  return 1
}

function listWebAuthnCredentialRows(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
  query: string,
): Record<string, unknown>[] {
  const userId = String(boundValues[0] ?? '')
  const limit = Number(boundValues[boundValues.length - 1] ?? 6)
  return webAuthnCredentials(options)
    .filter((row) => {
      if (query.includes('credential_id = ?')) {
        return String(row.credentialId) === String(boundValues[0])
      }
      if (query.includes('id = ? AND user_id = ?')) {
        return (
          String(row.id) === String(boundValues[0]) &&
          String(row.userId) === String(boundValues[1])
        )
      }
      return String(row.userId) === userId
    })
    .sort((left, right) => {
      const revision = String(left.revisionDate).localeCompare(
        String(right.revisionDate),
      )
      return revision !== 0
        ? revision
        : String(left.id).localeCompare(String(right.id))
    })
    .slice(0, Number.isFinite(limit) ? limit : undefined)
}

function findWebAuthnCredentialRow(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
  query: string,
): Record<string, unknown> | null {
  return listWebAuthnCredentialRows(options, boundValues, query)[0] ?? null
}

function findWebAuthnChallengeRow(
  options: FakeD1DatabaseOptions,
  boundValues: unknown[],
): Record<string, unknown> | null {
  return (
    webAuthnChallenges(options).find(
      (row) => String(row.tokenHash) === String(boundValues[0]),
    ) ?? null
  )
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
  'organization_groups',
  'organization_group_users',
  'collection_groups',
  'organization_policies',
  'collections',
  'collection_users',
  'collection_ciphers',
  'account_kdf_population',
  'user_key_rotation_wrapper_history',
  'webauthn_credentials',
  'webauthn_challenges',
  'personal_api_keys',
  'emergency_access',
] as const

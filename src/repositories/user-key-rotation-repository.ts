import type { AuditEvent } from '../domain/audit'
import {
  matchesUserKeyRotationCredentialGeneration,
  userKeyRotationPolicy,
  type UserKeyRotationRequest,
} from '../domain/user-key-rotation'
import { classifyStoredUserKeyRotationCipherMetadata } from '../domain/user-key-rotation-cipher'
import {
  insertAuditEventSql,
  invalidateAuthRequestsSql,
  revokeDevicesSql,
  revokeRefreshTokensSql,
  snapshotAttachmentsSql,
  snapshotCiphersSql,
  snapshotFoldersSql,
  snapshotSummarySql,
  snapshotTrustedDevicesSql,
  updateAttachmentsSql,
  updateCiphersSql,
  updateFoldersSql,
  updateTrustedDevicesSql,
  updateUserGenerationSql,
} from './user-key-rotation-sql'

type UserKeyRotationDatabase = Pick<D1Database, 'batch' | 'prepare'>

export const userKeyRotationRepositoryPolicy = {
  snapshotQueries: 5,
  mutationStatements: 9,
  maxQueriesPerInvocation: 50,
  maxBoundParameters: 100,
  maxStatementLength: 100_000,
  maxBoundValueLength: 2_000_000,
  maxManifestValueLength: 1_800_000,
  maxSnapshotFolderBytes: 1_000_000,
  maxSnapshotCipherBytes: 1_800_000,
  maxSnapshotAttachmentBytes: 1_800_000,
  maxSnapshotTrustedDeviceBytes: 1_000_000,
  maxSnapshotTotalBytes: 5_000_000,
} as const

export type RotateUserKeyGenerationInput = {
  userId: string
  expectedSecurityStamp: string
  expectedRevisionDate: string
  nextSecurityStamp: string
  nextRevisionDate: string
  request: UserKeyRotationRequest
  auditEventId: string
  auditEvent: AuditEvent
}

export type RotateUserKeyGenerationResult =
  | {
      status: 'rotated'
      securityStamp: string
      revisionDate: string
      rotatedFolderCount: number
      rotatedCipherCount: number
      rotatedAttachmentCount: number
      rotatedTrustedDeviceCount: number
      revokedDeviceCount: number
      revokedRefreshTokenCount: number
      invalidatedAuthRequestCount: number
      auditEventId: string
      budget: UserKeyRotationQueryBudget
    }
  | { status: 'not_found' }
  | { status: 'unsupported_state'; reason: UnsupportedSnapshotReason }
  | { status: 'over_budget'; reason: OverBudgetReason }
  | { status: 'conflict' }

export type UserKeyRotationQueryBudget = {
  snapshotQueries: number
  mutationStatements: number
  totalQueries: number
}

type UnsupportedSnapshotReason =
  | 'account_disabled'
  | 'account_keys_incomplete'
  | 'deleted_folders'
  | 'deleted_ciphers'
  | 'pending_attachments'
  | 'partial_trusted_device_keys'
  | 'personal_cipher_key_column'
  | 'stored_cipher_invalid'

type OverBudgetReason =
  'snapshot_count' | 'snapshot_bytes' | 'manifest_bytes' | 'query_count'

type SnapshotSummaryRow = {
  id: string
  emailNormalized: string
  kdfAlgorithm: string
  kdfIterations: number
  kdfMemory: number | null
  kdfParallelism: number | null
  masterPasswordHash: string
  userKey: string | null
  publicKey: string | null
  privateKey: string | null
  securityStamp: string
  revisionDate: string
  disabledAt: string | null
  activeFolderCount: number
  deletedFolderCount: number
  folderBytes: number
  activeCipherCount: number
  deletedCipherCount: number
  personalCipherKeyCount: number
  cipherBytes: number
  uploadedAttachmentCount: number
  pendingAttachmentCount: number
  attachmentBytes: number
  trustedDeviceCount: number
  incompleteTrustedDeviceCount: number
  trustedDeviceBytes: number
}

type SnapshotFolderRow = {
  id: string
  userId: string
  name: string
  revisionDate: string
}

type SnapshotCipherRow = {
  id: string
  userId: string
  folderId: string | null
  type: number
  favorite: number | boolean
  encryptedJson: string
  revisionDate: string
}

type SnapshotAttachmentRow = {
  id: string
  userId: string
  cipherId: string
  objectKey: string
  fileName: string
  attachmentKey: string
  size: number
  contentType: string
  revisionDate: string
}

type SnapshotTrustedDeviceRow = {
  id: string
  userId: string
  encryptedUserKey: string
  encryptedPublicKey: string
  encryptedPrivateKey: string
}

type UserKeyRotationSnapshot = {
  summary: SnapshotSummaryRow
  folders: SnapshotFolderRow[]
  ciphers: SnapshotCipherRow[]
  attachments: SnapshotAttachmentRow[]
  trustedDevices: SnapshotTrustedDeviceRow[]
}

type SnapshotReadResult =
  | { status: 'ready'; snapshot: UserKeyRotationSnapshot }
  | Exclude<
      RotateUserKeyGenerationResult,
      { status: 'rotated' } | { status: 'conflict' }
    >
  | { status: 'conflict' }

type RotationManifests = {
  currentFolders: string
  currentCiphers: string
  currentAttachments: string
  currentTrustedDevices: string
  nextFolders: string
  nextCiphers: string
  nextAttachments: string
  nextTrustedDevices: string
}

type BoundStatement = {
  sql: string
  values: unknown[]
}

type UpdatedUserRow = {
  id: string
}

const queryBudget: UserKeyRotationQueryBudget = {
  snapshotQueries: userKeyRotationRepositoryPolicy.snapshotQueries,
  mutationStatements: userKeyRotationRepositoryPolicy.mutationStatements,
  totalQueries:
    userKeyRotationRepositoryPolicy.snapshotQueries +
    userKeyRotationRepositoryPolicy.mutationStatements,
}

export async function rotateUserKeyGeneration(
  database: UserKeyRotationDatabase,
  input: RotateUserKeyGenerationInput,
): Promise<RotateUserKeyGenerationResult> {
  validateRotationInput(input)
  if (
    queryBudget.totalQueries >
    userKeyRotationRepositoryPolicy.maxQueriesPerInvocation
  ) {
    return { status: 'over_budget', reason: 'query_count' }
  }

  const snapshotResult = await readUserKeyRotationSnapshot(database, input)
  if (snapshotResult.status !== 'ready') {
    return snapshotResult
  }

  const snapshotValidation = validateSnapshotAgainstRequest(
    snapshotResult.snapshot,
    input,
  )
  if (snapshotValidation) {
    return snapshotValidation
  }

  const manifests = buildRotationManifests(
    snapshotResult.snapshot,
    input.request,
  )
  if (!manifests) {
    return { status: 'over_budget', reason: 'manifest_bytes' }
  }

  const statements = buildMutationStatements(
    database,
    snapshotResult.snapshot,
    input,
    manifests,
  )
  const results = await database.batch(statements)
  return interpretMutationResults(results, input)
}

async function readUserKeyRotationSnapshot(
  database: UserKeyRotationDatabase,
  input: RotateUserKeyGenerationInput,
): Promise<SnapshotReadResult> {
  const summary = await prepareChecked(database, {
    sql: snapshotSummarySql,
    values: [input.userId],
  }).first<SnapshotSummaryRow>()
  if (!summary) {
    return { status: 'not_found' }
  }
  assertSnapshotSummary(summary)

  const unsupported = unsupportedSummaryReason(summary)
  if (unsupported) {
    return { status: 'unsupported_state', reason: unsupported }
  }
  if (snapshotCountOverBudget(summary)) {
    return { status: 'over_budget', reason: 'snapshot_count' }
  }
  if (snapshotBytesOverBudget(summary)) {
    return { status: 'over_budget', reason: 'snapshot_bytes' }
  }

  const requestedAttachmentCount = input.request.ciphers.reduce(
    (total, cipher) => total + cipher.attachments.length,
    0,
  )
  if (
    summary.activeFolderCount !== input.request.folders.length ||
    summary.activeCipherCount !== input.request.ciphers.length ||
    summary.uploadedAttachmentCount !== requestedAttachmentCount ||
    summary.trustedDeviceCount !== input.request.trustedDevices.length
  ) {
    return { status: 'conflict' }
  }

  if (
    summary.id !== input.userId ||
    summary.securityStamp !== input.expectedSecurityStamp ||
    summary.revisionDate !== input.expectedRevisionDate ||
    summary.masterPasswordHash !== input.request.oldMasterKeyAuthenticationHash
  ) {
    return { status: 'conflict' }
  }
  if (!summary.userKey || !summary.publicKey || !summary.privateKey) {
    return { status: 'unsupported_state', reason: 'account_keys_incomplete' }
  }
  if (
    input.request.nextMasterKeyAuthenticationHash ===
      summary.masterPasswordHash ||
    !matchesUserKeyRotationCredentialGeneration(input.request, summary)
  ) {
    return { status: 'conflict' }
  }

  const [folders, ciphers, attachments, trustedDevices] = await Promise.all([
    prepareChecked(database, {
      sql: snapshotFoldersSql,
      values: [input.userId],
    }).all<SnapshotFolderRow>(),
    prepareChecked(database, {
      sql: snapshotCiphersSql,
      values: [input.userId],
    }).all<SnapshotCipherRow>(),
    prepareChecked(database, {
      sql: snapshotAttachmentsSql,
      values: [input.userId],
    }).all<SnapshotAttachmentRow>(),
    prepareChecked(database, {
      sql: snapshotTrustedDevicesSql,
      values: [input.userId],
    }).all<SnapshotTrustedDeviceRow>(),
  ])

  if (
    folders.results.length !== summary.activeFolderCount ||
    ciphers.results.length !== summary.activeCipherCount ||
    attachments.results.length !== summary.uploadedAttachmentCount ||
    trustedDevices.results.length !== summary.trustedDeviceCount
  ) {
    return { status: 'conflict' }
  }

  return {
    status: 'ready',
    snapshot: {
      summary,
      folders: folders.results,
      ciphers: ciphers.results,
      attachments: attachments.results,
      trustedDevices: trustedDevices.results,
    },
  }
}

function validateSnapshotAgainstRequest(
  snapshot: UserKeyRotationSnapshot,
  input: RotateUserKeyGenerationInput,
): RotateUserKeyGenerationResult | null {
  const request = input.request
  if (
    !hasUniqueIds(request.folders) ||
    !hasUniqueIds(request.ciphers) ||
    !hasUniqueIds(request.trustedDevices) ||
    !hasUniqueIds(snapshot.folders) ||
    !hasUniqueIds(snapshot.ciphers) ||
    !hasUniqueIds(snapshot.attachments) ||
    !hasUniqueIds(snapshot.trustedDevices)
  ) {
    return { status: 'conflict' }
  }

  const currentFolders = new Map(
    snapshot.folders.map((folder) => [folder.id, folder]),
  )
  for (const folder of request.folders) {
    const current = currentFolders.get(folder.id)
    if (
      !current ||
      current.userId !== input.userId ||
      current.name === folder.name ||
      !isNonemptyString(current.revisionDate)
    ) {
      return { status: 'conflict' }
    }
  }

  const folderIds = new Set(request.folders.map((folder) => folder.id))
  const currentCiphers = new Map(
    snapshot.ciphers.map((cipher) => [cipher.id, cipher]),
  )
  for (const cipher of request.ciphers) {
    const current = currentCiphers.get(cipher.id)
    if (
      !current ||
      current.userId !== input.userId ||
      cipher.encryptedFor !== input.userId ||
      cipher.organizationId !== null ||
      current.folderId !== cipher.folderId ||
      (cipher.folderId !== null && !folderIds.has(cipher.folderId)) ||
      current.type !== cipher.type ||
      Boolean(current.favorite) !== cipher.favorite ||
      current.revisionDate !== cipher.lastKnownRevisionDate
    ) {
      return { status: 'conflict' }
    }
    const metadataStatus = classifyStoredUserKeyRotationCipherMetadata(
      cipher,
      current.encryptedJson,
    )
    if (metadataStatus === 'invalid') {
      return { status: 'unsupported_state', reason: 'stored_cipher_invalid' }
    }
    if (metadataStatus === 'mismatch') {
      return { status: 'conflict' }
    }
  }

  const requestedAttachments = request.ciphers.flatMap((cipher) =>
    cipher.attachments.map((attachment) => ({
      ...attachment,
      cipherId: cipher.id,
    })),
  )
  if (!hasUniqueIds(requestedAttachments)) {
    return { status: 'conflict' }
  }
  const currentAttachments = new Map(
    snapshot.attachments.map((attachment) => [attachment.id, attachment]),
  )
  for (const attachment of requestedAttachments) {
    const current = currentAttachments.get(attachment.id)
    if (
      !current ||
      current.userId !== input.userId ||
      current.cipherId !== attachment.cipherId ||
      current.revisionDate !== attachment.lastKnownRevisionDate ||
      !isNonemptyString(current.objectKey) ||
      !isNonnegativeInteger(current.size) ||
      !isNonemptyString(current.contentType) ||
      current.fileName === attachment.fileName ||
      current.attachmentKey === attachment.attachmentKey
    ) {
      return { status: 'conflict' }
    }
  }

  const currentTrustedDevices = new Map(
    snapshot.trustedDevices.map((device) => [device.id, device]),
  )
  for (const device of request.trustedDevices) {
    const current = currentTrustedDevices.get(device.id)
    if (
      !current ||
      current.userId !== input.userId ||
      !isNonemptyString(current.encryptedPrivateKey) ||
      current.encryptedPublicKey === device.encryptedPublicKey ||
      current.encryptedUserKey === device.encryptedUserKey
    ) {
      return { status: 'conflict' }
    }
  }

  return null
}

function buildRotationManifests(
  snapshot: UserKeyRotationSnapshot,
  request: UserKeyRotationRequest,
): RotationManifests | null {
  const currentFolders = serializeManifest(
    snapshot.folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      revisionDate: folder.revisionDate,
    })),
  )
  const currentCiphers = serializeManifest(
    snapshot.ciphers.map((cipher) => ({
      id: cipher.id,
      folderId: cipher.folderId,
      type: cipher.type,
      favorite: Boolean(cipher.favorite),
      encryptedJson: cipher.encryptedJson,
      revisionDate: cipher.revisionDate,
    })),
  )
  const currentAttachments = serializeManifest(
    snapshot.attachments.map((attachment) => ({
      id: attachment.id,
      cipherId: attachment.cipherId,
      objectKey: attachment.objectKey,
      fileName: attachment.fileName,
      attachmentKey: attachment.attachmentKey,
      size: attachment.size,
      contentType: attachment.contentType,
      revisionDate: attachment.revisionDate,
    })),
  )
  const currentTrustedDevices = serializeManifest(
    snapshot.trustedDevices.map((device) => ({
      id: device.id,
      encryptedUserKey: device.encryptedUserKey,
      encryptedPublicKey: device.encryptedPublicKey,
      encryptedPrivateKey: device.encryptedPrivateKey,
    })),
  )
  const nextFolders = serializeManifest(request.folders)
  const nextCiphers = serializeManifest(
    request.ciphers.map((cipher) => ({
      id: cipher.id,
      encryptedJson: cipher.encryptedJson,
    })),
  )
  const nextAttachments = serializeManifest(
    request.ciphers.flatMap((cipher) =>
      cipher.attachments.map((attachment) => ({
        id: attachment.id,
        fileName: attachment.fileName,
        attachmentKey: attachment.attachmentKey,
      })),
    ),
  )
  const nextTrustedDevices = serializeManifest(request.trustedDevices)
  const values = {
    currentFolders,
    currentCiphers,
    currentAttachments,
    currentTrustedDevices,
    nextFolders,
    nextCiphers,
    nextAttachments,
    nextTrustedDevices,
  }
  return Object.values(values).every(
    (value) =>
      value.length <= userKeyRotationRepositoryPolicy.maxManifestValueLength &&
      value.length <= userKeyRotationRepositoryPolicy.maxBoundValueLength,
  )
    ? values
    : null
}

function buildMutationStatements(
  database: UserKeyRotationDatabase,
  snapshot: UserKeyRotationSnapshot,
  input: RotateUserKeyGenerationInput,
  manifests: RotationManifests,
): D1PreparedStatement[] {
  const event = input.auditEvent
  const summary = snapshot.summary
  const statements: BoundStatement[] = [
    {
      sql: updateUserGenerationSql,
      values: [
        manifests.currentFolders,
        manifests.currentCiphers,
        manifests.currentAttachments,
        manifests.currentTrustedDevices,
        input.request.nextMasterKeyAuthenticationHash,
        input.request.nextUserKey,
        input.request.accountKeys.wrappedPrivateKey,
        input.nextSecurityStamp,
        input.nextRevisionDate,
        input.nextRevisionDate,
        input.userId,
        input.request.oldMasterKeyAuthenticationHash,
        summary.emailNormalized,
        summary.kdfAlgorithm,
        summary.kdfIterations,
        summary.kdfMemory,
        summary.kdfParallelism,
        summary.userKey,
        summary.publicKey,
        summary.privateKey,
        input.expectedSecurityStamp,
        input.expectedRevisionDate,
      ],
    },
    generationGatedStatement(updateFoldersSql, manifests.nextFolders, input),
    generationGatedStatement(updateCiphersSql, manifests.nextCiphers, input),
    generationGatedStatement(
      updateAttachmentsSql,
      manifests.nextAttachments,
      input,
    ),
    {
      sql: updateTrustedDevicesSql,
      values: [
        manifests.nextTrustedDevices,
        input.nextRevisionDate,
        input.userId,
        input.userId,
        input.nextSecurityStamp,
        input.nextRevisionDate,
      ],
    },
    {
      sql: revokeDevicesSql,
      values: generationGatedValues(input),
    },
    {
      sql: revokeRefreshTokensSql,
      values: [
        input.nextRevisionDate,
        input.userId,
        input.userId,
        input.nextSecurityStamp,
        input.nextRevisionDate,
      ],
    },
    {
      sql: invalidateAuthRequestsSql,
      values: [
        input.nextRevisionDate,
        input.userId,
        input.userId,
        input.nextSecurityStamp,
        input.nextRevisionDate,
      ],
    },
    {
      sql: insertAuditEventSql,
      values: [
        input.auditEventId,
        event.schemaVersion,
        event.name,
        event.outcome,
        event.requestId,
        event.occurredAt,
        event.actor?.userId ?? null,
        event.actor?.deviceIdentifier ?? null,
        event.target?.type ?? null,
        event.target?.id ?? null,
        event.context ? JSON.stringify(event.context) : null,
        input.userId,
        input.nextSecurityStamp,
        input.nextRevisionDate,
      ],
    },
  ]

  if (
    statements.length !== userKeyRotationRepositoryPolicy.mutationStatements
  ) {
    throw new Error('user key rotation statement budget invariant was violated')
  }
  return statements.map((statement) => prepareChecked(database, statement))
}

function generationGatedStatement(
  sql: string,
  manifest: string,
  input: RotateUserKeyGenerationInput,
): BoundStatement {
  return {
    sql,
    values: [manifest, ...generationGatedValues(input)],
  }
}

function generationGatedValues(input: RotateUserKeyGenerationInput): unknown[] {
  return [
    input.nextRevisionDate,
    input.nextRevisionDate,
    input.userId,
    input.userId,
    input.nextSecurityStamp,
    input.nextRevisionDate,
  ]
}

function interpretMutationResults(
  results: D1Result[],
  input: RotateUserKeyGenerationInput,
): RotateUserKeyGenerationResult {
  if (results.length !== userKeyRotationRepositoryPolicy.mutationStatements) {
    throw new Error('user key rotation batch returned an invalid result count')
  }
  const [
    userResult,
    folderResult,
    cipherResult,
    attachmentResult,
    trustedDeviceResult,
    deviceResult,
    refreshResult,
    authRequestResult,
    auditResult,
  ] = results
  if (
    !userResult ||
    !folderResult ||
    !cipherResult ||
    !attachmentResult ||
    !trustedDeviceResult ||
    !deviceResult ||
    !refreshResult ||
    !authRequestResult ||
    !auditResult
  ) {
    throw new Error('user key rotation batch returned an invalid result count')
  }
  const updatedUsers = (userResult?.results ?? []) as UpdatedUserRow[]
  const userChanges = updatedUsers.length
  const downstreamChanges = results
    .slice(1)
    .map((result) => result.meta.changes ?? 0)

  if (userChanges === 0) {
    if (downstreamChanges.some((changes) => changes !== 0)) {
      throw new Error('user key rotation guard invariant was violated')
    }
    return { status: 'conflict' }
  }

  const expectedAttachmentCount = input.request.ciphers.reduce(
    (total, cipher) => total + cipher.attachments.length,
    0,
  )
  if (
    results.some((result) => !result.success) ||
    userChanges !== 1 ||
    updatedUsers[0]?.id !== input.userId ||
    (userResult?.meta.changes ?? 0) !== 1 ||
    (folderResult?.meta.changes ?? 0) !== input.request.folders.length ||
    (cipherResult?.meta.changes ?? 0) !== input.request.ciphers.length ||
    (attachmentResult?.meta.changes ?? 0) !== expectedAttachmentCount ||
    (trustedDeviceResult?.meta.changes ?? 0) !==
      input.request.trustedDevices.length ||
    (auditResult?.meta.changes ?? 0) !== 1
  ) {
    throw new Error(
      'user key rotation batch did not commit one exact generation',
    )
  }

  return {
    status: 'rotated',
    securityStamp: input.nextSecurityStamp,
    revisionDate: input.nextRevisionDate,
    rotatedFolderCount: folderResult.meta.changes,
    rotatedCipherCount: cipherResult.meta.changes,
    rotatedAttachmentCount: attachmentResult.meta.changes,
    rotatedTrustedDeviceCount: trustedDeviceResult.meta.changes,
    revokedDeviceCount: deviceResult.meta.changes,
    revokedRefreshTokenCount: refreshResult.meta.changes,
    invalidatedAuthRequestCount: authRequestResult.meta.changes,
    auditEventId: input.auditEventId,
    budget: queryBudget,
  }
}

function validateRotationInput(input: RotateUserKeyGenerationInput): void {
  if (
    !isNonemptyString(input.userId) ||
    !isNonemptyString(input.expectedSecurityStamp) ||
    !isNonemptyString(input.expectedRevisionDate) ||
    !isNonemptyString(input.nextSecurityStamp) ||
    !isNonemptyString(input.nextRevisionDate) ||
    !isNonemptyString(input.auditEventId) ||
    input.nextSecurityStamp === input.expectedSecurityStamp ||
    !isStrictlyLaterIsoDate(
      input.nextRevisionDate,
      input.expectedRevisionDate,
    ) ||
    input.auditEvent.name !== 'account.keys.rotate' ||
    input.auditEvent.outcome !== 'success' ||
    input.auditEvent.occurredAt !== input.nextRevisionDate ||
    input.auditEvent.actor?.userId !== input.userId ||
    input.auditEvent.target?.type !== 'account' ||
    input.auditEvent.target.id !== input.userId
  ) {
    throw new Error('user key rotation input generation is invalid')
  }
}

function unsupportedSummaryReason(
  summary: SnapshotSummaryRow,
): UnsupportedSnapshotReason | null {
  if (summary.disabledAt !== null) {
    return 'account_disabled'
  }
  if (summary.deletedFolderCount > 0) {
    return 'deleted_folders'
  }
  if (summary.deletedCipherCount > 0) {
    return 'deleted_ciphers'
  }
  if (summary.pendingAttachmentCount > 0) {
    return 'pending_attachments'
  }
  if (summary.incompleteTrustedDeviceCount > 0) {
    return 'partial_trusted_device_keys'
  }
  if (summary.personalCipherKeyCount > 0) {
    return 'personal_cipher_key_column'
  }
  return null
}

function snapshotCountOverBudget(summary: SnapshotSummaryRow): boolean {
  return (
    summary.activeFolderCount > userKeyRotationPolicy.foldersMax ||
    summary.activeCipherCount > userKeyRotationPolicy.ciphersMax ||
    summary.trustedDeviceCount > userKeyRotationPolicy.trustedDevicesMax ||
    summary.uploadedAttachmentCount >
      userKeyRotationPolicy.ciphersMax *
        userKeyRotationPolicy.attachmentsPerCipherMax
  )
}

function snapshotBytesOverBudget(summary: SnapshotSummaryRow): boolean {
  const total =
    summary.folderBytes +
    summary.cipherBytes +
    summary.attachmentBytes +
    summary.trustedDeviceBytes
  return (
    summary.folderBytes >
      userKeyRotationRepositoryPolicy.maxSnapshotFolderBytes ||
    summary.cipherBytes >
      userKeyRotationRepositoryPolicy.maxSnapshotCipherBytes ||
    summary.attachmentBytes >
      userKeyRotationRepositoryPolicy.maxSnapshotAttachmentBytes ||
    summary.trustedDeviceBytes >
      userKeyRotationRepositoryPolicy.maxSnapshotTrustedDeviceBytes ||
    total > userKeyRotationRepositoryPolicy.maxSnapshotTotalBytes
  )
}

function assertSnapshotSummary(summary: SnapshotSummaryRow): void {
  const countFields = [
    summary.activeFolderCount,
    summary.deletedFolderCount,
    summary.activeCipherCount,
    summary.deletedCipherCount,
    summary.personalCipherKeyCount,
    summary.uploadedAttachmentCount,
    summary.pendingAttachmentCount,
    summary.trustedDeviceCount,
    summary.incompleteTrustedDeviceCount,
  ]
  const byteFields = [
    summary.folderBytes,
    summary.cipherBytes,
    summary.attachmentBytes,
    summary.trustedDeviceBytes,
  ]
  if (
    !isNonemptyString(summary.id) ||
    !isNonemptyString(summary.emailNormalized) ||
    !isNonemptyString(summary.kdfAlgorithm) ||
    !isNonnegativeInteger(summary.kdfIterations) ||
    countFields.some((value) => !isNonnegativeInteger(value)) ||
    byteFields.some((value) => !isNonnegativeInteger(value))
  ) {
    throw new Error('user key rotation snapshot summary is invalid')
  }
}

function prepareChecked(
  database: UserKeyRotationDatabase,
  statement: BoundStatement,
): D1PreparedStatement {
  if (
    statement.sql.length > userKeyRotationRepositoryPolicy.maxStatementLength ||
    statement.values.length >
      userKeyRotationRepositoryPolicy.maxBoundParameters ||
    statement.values.some(
      (value) =>
        typeof value === 'string' &&
        value.length > userKeyRotationRepositoryPolicy.maxBoundValueLength,
    )
  ) {
    throw new Error('user key rotation D1 statement exceeds its budget')
  }
  return database.prepare(statement.sql).bind(...statement.values)
}

function serializeManifest(values: readonly { id: string }[]): string {
  return JSON.stringify(
    [...values].sort((left, right) => left.id.localeCompare(right.id)),
  )
}

function hasUniqueIds(values: readonly { id: string }[]): boolean {
  return new Set(values.map((value) => value.id)).size === values.length
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function isStrictlyLaterIsoDate(next: string, current: string): boolean {
  const nextTimestamp = Date.parse(next)
  const currentTimestamp = Date.parse(current)
  return (
    Number.isFinite(nextTimestamp) &&
    Number.isFinite(currentTimestamp) &&
    new Date(nextTimestamp).toISOString() === next &&
    new Date(currentTimestamp).toISOString() === current &&
    nextTimestamp > currentTimestamp
  )
}

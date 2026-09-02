import { lstatSync } from 'node:fs'
import { join, posix } from 'node:path'

const allowedVerificationLevels = new Set([
  'fixture_only',
  'live_smoke',
  'live_regression',
])

const requiredRegressionFlows = [
  'config',
  'prelogin',
  'password_grant',
  'initial_sync',
  'post_mutation_sync',
  'cipher_create',
  'cipher_update',
  'cipher_soft_delete',
  'cipher_permanent_delete',
  'refresh_grant',
  'session_revoke',
]

const selectedAuthRegressionFlows = new Set([
  'totp_login',
  'device_revoke',
  'revoke_all_other_sessions',
  'disabled_user_denied',
])

export function inspectClientMatrix(
  matrix,
  { evidenceIsRegularFile = () => false } = {},
) {
  const entries = requireClientMatrixEntries(matrix)
  const invalidVerificationRows = entries
    .filter((entry) => !allowedVerificationLevels.has(entry.verificationLevel))
    .map((entry) => entry.surface)
  const fixtureOnlyRowsWithLiveEvidence = entries
    .filter(
      (entry) =>
        entry.verificationLevel === 'fixture_only' &&
        entry.liveEvidence !== undefined,
    )
    .map((entry) => entry.surface)
  const promotedRows = entries.filter(
    (entry) => entry.verificationLevel !== 'fixture_only',
  )
  const promotedRowsWithoutEvidence = promotedRows
    .filter((entry) => {
      if (!hasClientMatrixLiveEvidence(entry, { evidenceIsRegularFile })) {
        return true
      }

      return (
        entry.verificationLevel === 'live_regression' &&
        !hasClientMatrixLiveRegressionEvidence(entry)
      )
    })
    .map((entry) => entry.surface)
  const rowsWithoutKnownIssues = entries
    .filter(
      (entry) =>
        !Array.isArray(entry.knownIssues) || entry.knownIssues.length < 1,
    )
    .map((entry) => entry.surface)

  return {
    invalidVerificationRows,
    fixtureOnlyRowsWithLiveEvidence,
    promotedRows: promotedRows.map((entry) => entry.surface),
    promotedRowsWithoutEvidence,
    rowsWithoutKnownIssues,
  }
}

export function matrixLiveEvidencePaths(entry) {
  const evidence = entry?.liveEvidence
  if (!evidence || !isSafeClientEvidencePath(evidence.path)) {
    return []
  }

  if (
    evidence.additionalPaths !== undefined &&
    (!Array.isArray(evidence.additionalPaths) ||
      !evidence.additionalPaths.every(isSafeClientEvidencePath))
  ) {
    return []
  }

  const additionalPaths = evidence.additionalPaths ?? []

  return [evidence.path, ...additionalPaths]
}

export function hasClientMatrixLiveEvidence(
  entry,
  { evidenceIsRegularFile = () => false } = {},
) {
  const evidence = entry?.liveEvidence
  const evidencePaths = matrixLiveEvidencePaths(entry)
  const additionalPathsValid =
    evidence?.additionalPaths === undefined ||
    (Array.isArray(evidence.additionalPaths) &&
      evidence.additionalPaths.every(isSafeClientEvidencePath))
  const hasExactBuild =
    entry?.build === undefined || evidence?.clientBuild === entry.build

  return Boolean(
    evidence &&
    evidence.status === 'passed' &&
    evidence.clientVersion === entry.version &&
    hasExactBuild &&
    additionalPathsValid &&
    evidencePaths.length > 0 &&
    evidencePaths.every((entryPath) => evidenceIsRegularFile(entryPath)) &&
    isCanonicalUtcInstant(evidence.recordedAt) &&
    isCanonicalUtcInstant(entry.releasePublishedAt) &&
    Date.parse(evidence.recordedAt) >= Date.parse(entry.releasePublishedAt) &&
    Array.isArray(evidence.flows) &&
    evidence.flows.length > 0,
  )
}

export function isSafeClientEvidencePath(evidencePath) {
  if (
    typeof evidencePath !== 'string' ||
    evidencePath.length === 0 ||
    evidencePath.trim() !== evidencePath ||
    posix.isAbsolute(evidencePath) ||
    posix.normalize(evidencePath) !== evidencePath
  ) {
    return false
  }

  return /^docs\/release\/(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(
    evidencePath,
  )
}

export function isRegularRepositoryEvidenceFile(repoRoot, evidencePath) {
  if (
    typeof repoRoot !== 'string' ||
    repoRoot.length === 0 ||
    !isSafeClientEvidencePath(evidencePath)
  ) {
    return false
  }

  try {
    const rootStat = lstatSync(repoRoot)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      return false
    }

    const segments = evidencePath.split('/')
    let currentPath = repoRoot

    for (const [index, segment] of segments.entries()) {
      currentPath = join(currentPath, segment)
      const entryStat = lstatSync(currentPath)
      if (entryStat.isSymbolicLink()) {
        return false
      }

      const isFinalSegment = index === segments.length - 1
      if (isFinalSegment) {
        return entryStat.isFile()
      }
      if (!entryStat.isDirectory()) {
        return false
      }
    }
  } catch {
    return false
  }

  return false
}

export function isCanonicalUtcInstant(timestamp) {
  if (
    typeof timestamp !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(timestamp)
  ) {
    return false
  }

  const parsedTimestamp = Date.parse(timestamp)
  if (!Number.isFinite(parsedTimestamp)) {
    return false
  }

  return (
    new Date(parsedTimestamp).toISOString().replace('.000Z', 'Z') === timestamp
  )
}

function hasClientMatrixLiveRegressionEvidence(entry) {
  const evidence = entry?.liveEvidence
  const flows = evidence?.flows

  return Boolean(
    typeof evidence?.path === 'string' &&
    evidence.path.startsWith('docs/release/live-regression-evidence/') &&
    Array.isArray(flows) &&
    requiredRegressionFlows.every((flow) => flows.includes(flow)) &&
    flows.some((flow) => selectedAuthRegressionFlows.has(flow)),
  )
}

function requireClientMatrixEntries(matrix) {
  if (!isRecord(matrix) || !Array.isArray(matrix.entries)) {
    throw new Error(
      'Client matrix structure is invalid: entries must be an array.',
    )
  }

  for (const [index, entry] of matrix.entries.entries()) {
    if (
      !isRecord(entry) ||
      !isNonEmptyString(entry.surface) ||
      !isNonEmptyString(entry.version) ||
      !isNonEmptyString(entry.verificationLevel) ||
      !isCanonicalUtcInstant(entry.releasePublishedAt) ||
      (entry.build !== undefined && !isNonEmptyString(entry.build)) ||
      !Array.isArray(entry.knownIssues) ||
      !entry.knownIssues.every(isNonEmptyString)
    ) {
      throw new Error(
        `Client matrix structure is invalid: entry ${index} is malformed.`,
      )
    }
  }

  return matrix.entries
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
}

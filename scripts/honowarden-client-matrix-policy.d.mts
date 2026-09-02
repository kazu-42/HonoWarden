export type ClientMatrixInspection = {
  invalidVerificationRows: string[]
  fixtureOnlyRowsWithLiveEvidence: string[]
  promotedRows: string[]
  promotedRowsWithoutEvidence: string[]
  rowsWithoutKnownIssues: string[]
}

export function inspectClientMatrix(
  matrix: unknown,
  options?: { evidenceIsRegularFile?: (path: string) => boolean },
): ClientMatrixInspection

export function matrixLiveEvidencePaths(entry: unknown): string[]

export function hasClientMatrixLiveEvidence(
  entry: unknown,
  options?: { evidenceIsRegularFile?: (path: string) => boolean },
): boolean

export function isSafeClientEvidencePath(path: unknown): boolean

export function isRegularRepositoryEvidenceFile(
  repoRoot: unknown,
  path: unknown,
): boolean

export function isCanonicalUtcInstant(timestamp: unknown): boolean

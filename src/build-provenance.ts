import type { RuntimeEnvironment } from './infra/environment'

export type BuildProvenance = {
  gitSha: string
  workerVersionId: string
  createdAt: string
}

export type BuildProvenanceFailureReason =
  | 'metadata_missing'
  | 'worker_version_id_invalid'
  | 'git_sha_invalid'
  | 'timestamp_invalid'

export type BuildProvenanceResolution =
  | {
      ok: true
      build: BuildProvenance
    }
  | {
      ok: false
      environment: RuntimeEnvironment
      reason: BuildProvenanceFailureReason
      fatal: boolean
    }

const fullGitShaPattern = /^[a-f0-9]{40}$/
const placeholderGitSha = '0'.repeat(40)
const cloudflareTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/

export function resolveBuildProvenance(
  metadata: WorkerVersionMetadata | undefined,
  environment: RuntimeEnvironment,
): BuildProvenanceResolution {
  const fatal = environment !== 'development'

  if (!metadata) {
    return failure(environment, 'metadata_missing', fatal)
  }

  if (
    typeof metadata.id !== 'string' ||
    metadata.id.trim().length === 0 ||
    metadata.id.trim() !== metadata.id
  ) {
    return failure(environment, 'worker_version_id_invalid', fatal)
  }

  if (
    typeof metadata.tag !== 'string' ||
    !fullGitShaPattern.test(metadata.tag) ||
    metadata.tag === placeholderGitSha
  ) {
    return failure(environment, 'git_sha_invalid', fatal)
  }

  const createdAt = normalizeTimestamp(metadata.timestamp)
  if (!createdAt) {
    return failure(environment, 'timestamp_invalid', fatal)
  }

  return {
    ok: true,
    build: {
      gitSha: metadata.tag,
      workerVersionId: metadata.id,
      createdAt,
    },
  }
}

function normalizeTimestamp(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    !cloudflareTimestampPattern.test(value)
  ) {
    return null
  }

  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    return null
  }

  const normalized = new Date(timestamp).toISOString()
  const expectedNormalized = value.includes('.')
    ? value.replace(
        /\.(\d{1,9})Z$/,
        (_match, fraction: string) =>
          `.${fraction.slice(0, 3).padEnd(3, '0')}Z`,
      )
    : value.replace(/Z$/, '.000Z')

  return normalized === expectedNormalized ? normalized : null
}

function failure(
  environment: RuntimeEnvironment,
  reason: BuildProvenanceFailureReason,
  fatal: boolean,
): BuildProvenanceResolution {
  return { ok: false, environment, reason, fatal }
}

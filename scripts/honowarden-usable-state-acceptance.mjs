#!/usr/bin/env node

import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { isIP } from 'node:net'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
} from 'node:path'
import { fileURLToPath, pathToFileURL, URL } from 'node:url'
import process from 'node:process'

const defaultRepoRoot = fileURLToPath(new URL('..', import.meta.url).toString())
const defaultEvidenceRoot = join(
  defaultRepoRoot,
  'docs/release/usable-state-acceptance-runs',
)
const clientMatrixRelativePath = 'compat/client-matrix.json'
const stagingWorkerUrl = 'https://honowarden-staging.ghive42.workers.dev'
const stagingWorkerHostname = 'honowarden-staging.ghive42.workers.dev'
const allowedPublicContactAddresses = new Set([
  'security@honowarden.com',
  'support@honowarden.com',
  'hello@honowarden.com',
  'admin@honowarden.com',
  'postmaster@honowarden.com',
  'abuse@honowarden.com',
])
const reservedExampleDomains = new Set([
  'example.com',
  'example.net',
  'example.org',
])
const reservedDomainSuffixes = ['.example', '.invalid', '.localhost', '.test']
const expectedCriteria = Array.from(
  { length: 10 },
  (_, index) => `SU-${String(index + 1).padStart(2, '0')}`,
)
const cleanupCountKeys = [
  'users',
  'devices',
  'refreshTokens',
  'authRequests',
  'orphanDevices',
  'r2SyntheticObjects',
  'pendingInquiryApprovals',
  'pendingOutboundDispatches',
  'foreignKeyViolations',
]
const sensitiveJsonFieldNames = new Set([
  'password',
  'passwordhash',
  'masterpassword',
  'masterpasswordhash',
  'accesstoken',
  'refreshtoken',
  'token',
  'secret',
  'secretkey',
  'clientsecret',
  'apikey',
  'privatekey',
  'recoverycode',
  'encryptedpayload',
  'cipherstring',
])
const sensitiveJsonFieldSuffixes = new Set([
  'credential',
  'credentials',
  'key',
  'password',
  'secret',
  'token',
])
const sensitiveJsonPluralFieldSuffixes = new Set([
  'credentials',
  'keys',
  'passwords',
  'secrets',
  'tokens',
])
const topLevelKeys = [
  'schemaVersion',
  'runId',
  'startedAt',
  'completedAt',
  'environment',
  'sourceCommit',
  'worker',
  'clients',
  'targetEvidence',
  'criteria',
  'cleanup',
]
const workerKeys = ['name', 'versionId', 'serverUrl']
const clientSetKeys = ['browser_extension', 'desktop']
const clientPinKeys = ['version', 'build', 'releaseTag']
const criterionKeys = ['id', 'status', 'evidence']
const cleanupKeys = ['status', 'checkedAt', 'counts', 'evidence']
const evidenceSizeLimitBytes = 256 * 1024
const limitations = [
  'This verifier does not deploy a Worker, run an official client, mutate a database, or prove that the recorded observations happened.',
  'A passed report proves only that the checked-in manifest and redacted evidence satisfy the HON-110 common-target contract.',
  'HON-110 still requires operator-observed staging execution, runtime readback, committed evidence, PR/CI, and cleanup proof.',
]

function main(argv = process.argv.slice(2)) {
  let options
  let report

  try {
    options = parseOptions(argv)
    report = verifyUsableStateAcceptanceManifest({
      manifestPath: options.manifestPath,
    })
  } catch {
    options = { strict: argv.includes('--strict') }
    report = emptyReport({
      status: 'not_ready',
      blockingReason: 'arguments_invalid',
      requirements: [
        failedRequirement('arguments', 'arguments_invalid', [
          'Use --manifest <path> and optional --strict.',
        ]),
      ],
    })
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

  if (options.strict && report.status !== 'passed') {
    process.stderr.write(
      `usable-state acceptance manifest is not passing: ${report.blockingReason}\n`,
    )
    process.exitCode = 1
  }
}

export function verifyUsableStateAcceptanceManifest({
  manifestPath,
  repoRoot = defaultRepoRoot,
  evidenceRoot = defaultEvidenceRoot,
  commitExists = gitCommitExists,
} = {}) {
  const state = {
    manifestPath: null,
    target: null,
    clients: null,
    criteria: [],
    cleanup: null,
    requirements: [],
  }
  const failNotReady = (blockingReason, requirementId, evidence = []) => {
    state.requirements.push(
      failedRequirement(requirementId, blockingReason, evidence),
    )
    return reportFromState(state, 'not_ready', blockingReason)
  }
  const pass = (id, evidence = []) => {
    state.requirements.push(passedRequirement(id, evidence))
  }

  const resolvedRepoRoot = resolve(repoRoot)
  const resolvedEvidenceRoot = resolve(evidenceRoot)
  const manifestPathResolution = resolveManifestPath(
    manifestPath,
    resolvedRepoRoot,
  )
  if (!manifestPathResolution.ok) {
    return failNotReady(
      manifestPathResolution.blockingReason,
      'manifest_location',
      manifestPathResolution.blockingReason === 'manifest_path_unsafe'
        ? ['Manifest path must be canonical and repository-relative.']
        : [],
    )
  }
  const resolvedManifestPath = manifestPathResolution.path

  const manifestRelativeToEvidenceRoot = relative(
    resolvedEvidenceRoot,
    resolvedManifestPath,
  )
  const manifestParts = manifestRelativeToEvidenceRoot.split(/[\\/]/)
  if (
    !isWithin(resolvedEvidenceRoot, resolvedManifestPath) ||
    manifestParts.length !== 2 ||
    manifestParts[1] !== 'manifest.json'
  ) {
    return failNotReady('manifest_path_unsafe', 'manifest_location', [
      'Manifest must be <evidence-root>/<run-id>/manifest.json.',
    ])
  }

  state.manifestPath = normalizeReportPath(
    resolvedManifestPath,
    resolvedRepoRoot,
  )
  if (!isSafeRegularFile(resolvedManifestPath)) {
    return failNotReady('manifest_file_invalid', 'manifest_location', [
      state.manifestPath,
    ])
  }
  if (statSync(resolvedManifestPath).size > evidenceSizeLimitBytes) {
    return failNotReady('manifest_file_too_large', 'manifest_location', [
      state.manifestPath,
    ])
  }
  if (
    hasSymlinkComponent(resolvedRepoRoot, resolvedEvidenceRoot) ||
    !realPathWithin(resolvedEvidenceRoot, resolvedManifestPath) ||
    hasSymlinkComponent(resolvedEvidenceRoot, resolvedManifestPath)
  ) {
    return failNotReady('manifest_path_unsafe', 'manifest_location', [
      state.manifestPath,
    ])
  }
  pass('manifest_location', [state.manifestPath])

  const manifestText = readFileSync(resolvedManifestPath, 'utf8')
  const unsafeManifestRule = unsafeContentRule(manifestText, {
    scanEmbeddedPairs: false,
  })
  if (unsafeManifestRule) {
    return failNotReady('unsafe_manifest_content', 'manifest_content_safe', [
      state.manifestPath,
      `rule: ${unsafeManifestRule}`,
    ])
  }

  let manifest
  try {
    manifest = JSON.parse(manifestText)
  } catch {
    return failNotReady('manifest_json_invalid', 'manifest_schema', [
      state.manifestPath,
    ])
  }

  if (!hasValidManifestShape(manifest)) {
    return failNotReady('manifest_schema_invalid', 'manifest_schema', [
      state.manifestPath,
    ])
  }
  pass('manifest_schema', ['schemaVersion: 1'])

  if (
    !isIsoTimestamp(manifest.startedAt) ||
    !isIsoTimestamp(manifest.completedAt) ||
    !isIsoTimestamp(manifest.cleanup.checkedAt) ||
    Date.parse(manifest.completedAt) < Date.parse(manifest.startedAt) ||
    Date.parse(manifest.cleanup.checkedAt) < Date.parse(manifest.completedAt)
  ) {
    return failNotReady('run_timestamps_invalid', 'run_identity', [
      state.manifestPath,
    ])
  }

  const runIdFromPath = manifestParts[0]
  if (
    !isRunId(manifest.runId) ||
    manifest.runId !== runIdFromPath ||
    manifest.runId !== runIdForTimestamp(manifest.startedAt)
  ) {
    return failNotReady('run_identity_invalid', 'run_identity', [
      state.manifestPath,
    ])
  }
  pass('run_identity', [`runId: ${manifest.runId}`])

  if (
    manifest.environment !== 'staging' ||
    manifest.worker.name !== 'honowarden-staging' ||
    !isFullCommit(manifest.sourceCommit) ||
    !isUuid(manifest.worker.versionId) ||
    !isSafeStagingUrl(manifest.worker.serverUrl)
  ) {
    return failNotReady('target_pin_invalid', 'target_pinned', [
      'Expected staging, honowarden-staging, full source commit, Worker version UUID, and credential-free HTTPS URL.',
    ])
  }
  state.target = safeTarget(manifest)
  pass('target_pinned', [
    `sourceCommit: ${manifest.sourceCommit}`,
    `workerVersionId: ${manifest.worker.versionId}`,
  ])

  let sourceCommitAvailable
  try {
    sourceCommitAvailable = commitExists(
      manifest.sourceCommit,
      resolvedRepoRoot,
    )
  } catch {
    sourceCommitAvailable = false
  }
  if (!sourceCommitAvailable) {
    return failNotReady(
      'source_commit_unavailable',
      'source_commit_available',
      [`sourceCommit: ${manifest.sourceCommit}`],
    )
  }
  pass('source_commit_available', [`sourceCommit: ${manifest.sourceCommit}`])

  const clientMatrix = readClientMatrix(resolvedRepoRoot)
  if (!clientMatrix) {
    return failNotReady('client_matrix_invalid', 'client_set', [
      clientMatrixRelativePath,
    ])
  }
  const clientMismatch = clientSetMismatch(manifest.clients, clientMatrix)
  if (clientMismatch) {
    return failNotReady('client_set_mismatch', 'client_set', [
      `surface: ${clientMismatch}`,
      clientMatrixRelativePath,
    ])
  }
  state.clients = safeClients(manifest.clients)
  pass('client_set', [clientMatrixRelativePath])

  const criterionIds = manifest.criteria.map((criterion) => criterion.id)
  const uniqueCriterionIds = new Set(criterionIds)
  if (
    uniqueCriterionIds.size !== expectedCriteria.length ||
    criterionIds.length !== expectedCriteria.length ||
    expectedCriteria.some((criterionId) => !uniqueCriterionIds.has(criterionId))
  ) {
    return failNotReady('criteria_set_invalid', 'criteria_complete', [
      'Exactly SU-01 through SU-10 are required once each.',
    ])
  }
  if (
    manifest.criteria.some(
      (criterion) => !['pass', 'fail'].includes(criterion.status),
    )
  ) {
    return failNotReady('criterion_status_invalid', 'criteria_complete', [
      'Only pass or fail are accepted; skip and waiver states are invalid.',
    ])
  }
  if (
    manifest.targetEvidence.length !== 1 ||
    manifest.targetEvidence[0] !== 'target-readback.md' ||
    manifest.cleanup.evidence.length !== 1 ||
    manifest.cleanup.evidence[0] !== 'cleanup-readback.md' ||
    manifest.criteria.some(
      (criterion) =>
        criterion.evidence.length !== 1 ||
        criterion.evidence[0] !== `criteria/${criterion.id}.md`,
    )
  ) {
    return failNotReady('evidence_contract_invalid', 'criteria_complete', [
      'Each criterion needs criteria/SU-NN.md; target and cleanup use their fixed readback files.',
    ])
  }
  if (!['pass', 'fail'].includes(manifest.cleanup.status)) {
    return failNotReady('cleanup_status_invalid', 'cleanup_contract')
  }
  const verifiedCriteria = [...manifest.criteria]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((criterion) => ({
      id: criterion.id,
      status: criterion.status,
      evidence: [...criterion.evidence],
    }))
  const verifiedCleanup = {
    status: manifest.cleanup.status,
    checkedAt: manifest.cleanup.checkedAt,
    counts: { ...manifest.cleanup.counts },
    evidence: [...manifest.cleanup.evidence],
  }
  pass('criteria_complete', ['SU-01 through SU-10'])

  const runDirectory = dirname(resolvedManifestPath)
  const evidenceReferences = buildEvidenceReferences(manifest)
  const resolvedEvidenceReferences = []
  const evidenceFiles = new Map()
  for (const reference of evidenceReferences) {
    const evidencePathCheck = resolveEvidencePath(runDirectory, reference.path)
    if (!evidencePathCheck.ok) {
      return failNotReady(
        evidencePathCheck.blockingReason,
        'evidence_files_safe',
        ['Unsafe evidence path was not echoed.'],
      )
    }
    const evidencePath = evidencePathCheck.path
    if (!isSafeRegularFile(evidencePath)) {
      return failNotReady('evidence_file_invalid', 'evidence_files_safe', [
        reference.path,
      ])
    }
    if (statSync(evidencePath).size > evidenceSizeLimitBytes) {
      return failNotReady('evidence_file_too_large', 'evidence_files_safe', [
        reference.path,
      ])
    }
    if (
      !realPathWithin(runDirectory, evidencePath) ||
      hasSymlinkComponent(runDirectory, evidencePath)
    ) {
      return failNotReady('evidence_path_unsafe', 'evidence_files_safe', [
        reference.path,
      ])
    }
    resolvedEvidenceReferences.push({ ...reference, path: evidencePath })
  }

  const unexpectedEvidencePath = findUnexpectedRunEntry(
    runDirectory,
    new Set([
      resolvedManifestPath,
      ...resolvedEvidenceReferences.map((reference) => reference.path),
    ]),
  )
  if (unexpectedEvidencePath) {
    return failNotReady('unexpected_evidence_file', 'evidence_files_safe', [
      toPosixRelativePath(relative(runDirectory, unexpectedEvidencePath)),
    ])
  }

  for (const resolvedReference of resolvedEvidenceReferences) {
    const evidencePath = resolvedReference.path
    const reportPath = toPosixRelativePath(relative(runDirectory, evidencePath))
    const content = readFileSync(evidencePath, 'utf8')
    const unsafeRule = unsafeContentRule(content, {
      allowCleanupCountAssignments: reportPath === 'cleanup-readback.md',
    })
    if (unsafeRule) {
      return failNotReady('unsafe_evidence_content', 'evidence_content_safe', [
        reportPath,
        `rule: ${unsafeRule}`,
      ])
    }
    evidenceFiles.set(reportPath, content)
  }
  pass('evidence_files_safe', [
    `files: ${evidenceFiles.size}`,
    `root: ${manifestParts[0]}`,
  ])
  pass('evidence_content_safe', ['No prohibited structural pattern found.'])

  for (const reference of evidenceReferences) {
    const content = evidenceFiles.get(reference.path)
    if (
      !content ||
      !hasBindingMarkers(content, manifest, reference.expectedStatus)
    ) {
      return failNotReady('evidence_binding_invalid', 'evidence_binding', [
        reference.path,
      ])
    }
  }
  pass('evidence_binding', [
    `runId: ${manifest.runId}`,
    `sourceCommit: ${manifest.sourceCommit}`,
    `workerVersionId: ${manifest.worker.versionId}`,
  ])

  state.criteria = verifiedCriteria
  state.cleanup = verifiedCleanup

  for (const targetPath of manifest.targetEvidence) {
    const content = evidenceFiles.get(targetPath)
    if (!content || !hasTargetReadback(content)) {
      return failNotReady('target_readback_invalid', 'target_readback', [
        targetPath,
      ])
    }
  }
  pass('target_readback', [
    'environment: staging',
    'worker: honowarden-staging',
    'health: passed',
    'migrations: current',
  ])

  for (const cleanupPath of manifest.cleanup.evidence) {
    const content = evidenceFiles.get(cleanupPath)
    if (!content || !hasCleanupReadback(content, manifest.cleanup.counts)) {
      return failNotReady('cleanup_readback_invalid', 'cleanup_contract', [
        cleanupPath,
      ])
    }
  }
  pass('cleanup_contract', [`checkedAt: ${manifest.cleanup.checkedAt}`])

  const failedCriterion = verifiedCriteria.find(
    (criterion) => criterion.status === 'fail',
  )
  if (failedCriterion) {
    state.requirements.push(
      failedRequirement('criterion_results', 'criterion_failed', [
        `criterion: ${failedCriterion.id}`,
      ]),
    )
    return reportFromState(state, 'failed', 'criterion_failed')
  }
  pass('criterion_results', ['All ten criteria recorded pass.'])

  const nonZeroCleanup = cleanupCountKeys.find(
    (key) => manifest.cleanup.counts[key] !== 0,
  )
  if (manifest.cleanup.status === 'fail' || nonZeroCleanup) {
    state.requirements.push(
      failedRequirement('cleanup_zero_state', 'cleanup_not_zero', [
        nonZeroCleanup ? `count: ${nonZeroCleanup}` : 'cleanup status: fail',
      ]),
    )
    return reportFromState(state, 'failed', 'cleanup_not_zero')
  }
  pass(
    'cleanup_zero_state',
    cleanupCountKeys.map((key) => `${key}: 0`),
  )

  return reportFromState(state, 'passed', null)
}

function hasValidManifestShape(manifest) {
  if (
    !isRecord(manifest) ||
    !hasExactKeys(manifest, topLevelKeys) ||
    manifest.schemaVersion !== 1 ||
    typeof manifest.runId !== 'string' ||
    typeof manifest.startedAt !== 'string' ||
    typeof manifest.completedAt !== 'string' ||
    typeof manifest.environment !== 'string' ||
    typeof manifest.sourceCommit !== 'string' ||
    !isRecord(manifest.worker) ||
    !hasExactKeys(manifest.worker, workerKeys) ||
    typeof manifest.worker.name !== 'string' ||
    typeof manifest.worker.versionId !== 'string' ||
    typeof manifest.worker.serverUrl !== 'string' ||
    !isRecord(manifest.clients) ||
    !hasExactKeys(manifest.clients, clientSetKeys) ||
    !clientSetKeys.every(
      (surface) =>
        isRecord(manifest.clients[surface]) &&
        hasExactKeys(manifest.clients[surface], clientPinKeys) &&
        typeof manifest.clients[surface].version === 'string' &&
        (manifest.clients[surface].build === null ||
          typeof manifest.clients[surface].build === 'string') &&
        typeof manifest.clients[surface].releaseTag === 'string',
    ) ||
    !isStringArray(manifest.targetEvidence) ||
    manifest.targetEvidence.length === 0 ||
    !Array.isArray(manifest.criteria) ||
    !manifest.criteria.every(
      (criterion) =>
        isRecord(criterion) &&
        hasExactKeys(criterion, criterionKeys) &&
        typeof criterion.id === 'string' &&
        typeof criterion.status === 'string' &&
        isStringArray(criterion.evidence) &&
        criterion.evidence.length > 0,
    ) ||
    !isRecord(manifest.cleanup) ||
    !hasExactKeys(manifest.cleanup, cleanupKeys) ||
    typeof manifest.cleanup.status !== 'string' ||
    typeof manifest.cleanup.checkedAt !== 'string' ||
    !isRecord(manifest.cleanup.counts) ||
    !hasExactKeys(manifest.cleanup.counts, cleanupCountKeys) ||
    !cleanupCountKeys.every(
      (key) =>
        Number.isInteger(manifest.cleanup.counts[key]) &&
        manifest.cleanup.counts[key] >= 0,
    ) ||
    !isStringArray(manifest.cleanup.evidence) ||
    manifest.cleanup.evidence.length === 0
  ) {
    return false
  }

  return true
}

function buildEvidenceReferences(manifest) {
  return [
    ...manifest.targetEvidence.map((path) => ({
      path,
      expectedStatus: 'passed',
    })),
    ...manifest.criteria.flatMap((criterion) =>
      criterion.evidence.map((path) => ({
        path,
        expectedStatus: criterion.status === 'pass' ? 'passed' : 'failed',
      })),
    ),
    ...manifest.cleanup.evidence.map((path) => ({
      path,
      expectedStatus: manifest.cleanup.status === 'pass' ? 'passed' : 'failed',
    })),
  ]
}

function resolveEvidencePath(runDirectory, evidencePath) {
  if (!isCanonicalPosixRelativePath(evidencePath)) {
    return { ok: false, blockingReason: 'evidence_path_unsafe' }
  }

  const resolvedPath = resolve(runDirectory, evidencePath)
  if (!isWithin(runDirectory, resolvedPath)) {
    return { ok: false, blockingReason: 'evidence_path_unsafe' }
  }

  return { ok: true, path: resolvedPath }
}

function findUnexpectedRunEntry(runDirectory, expectedFiles) {
  const expectedDirectories = new Set([runDirectory])
  for (const expectedFile of expectedFiles) {
    let current = dirname(expectedFile)
    while (current !== runDirectory) {
      expectedDirectories.add(current)
      current = dirname(current)
    }
  }

  const visit = (directory) => {
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true }).sort(
        (left, right) => left.name.localeCompare(right.name),
      )
    } catch {
      return directory
    }

    for (const entry of entries) {
      const entryPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!expectedDirectories.has(entryPath)) {
          return entryPath
        }
        const unexpectedChild = visit(entryPath)
        if (unexpectedChild) {
          return unexpectedChild
        }
        continue
      }
      if (!entry.isFile() || !expectedFiles.has(entryPath)) {
        return entryPath
      }
    }

    return null
  }

  return visit(runDirectory)
}

function hasBindingMarkers(content, manifest, expectedStatus) {
  const canonicalLines = canonicalEvidenceLines(content)
  const expectedHeader = [
    `Status: ${expectedStatus}`,
    `Run ID: \`${manifest.runId}\``,
    `Source commit: \`${manifest.sourceCommit}\``,
    `Worker version ID: \`${manifest.worker.versionId}\``,
  ]
  return (
    expectedHeader.every((line, index) => canonicalLines[index] === line) &&
    uniquePlainMarker(content, 'Status') === expectedStatus &&
    uniqueCodeMarker(content, 'Run ID') === manifest.runId &&
    uniqueCodeMarker(content, 'Source commit') === manifest.sourceCommit &&
    uniqueCodeMarker(content, 'Worker version ID') === manifest.worker.versionId
  )
}

function hasTargetReadback(content) {
  const expectedReadback = [
    'Environment: staging',
    'Worker name: honowarden-staging',
    'Health status: passed',
    'Migration status: current',
  ]
  const canonicalLines = canonicalEvidenceLines(content)
  return (
    expectedReadback.every(
      (line, index) => canonicalLines[index + 4] === line,
    ) &&
    uniquePlainMarker(content, 'Environment') === 'staging' &&
    uniquePlainMarker(content, 'Worker name') === 'honowarden-staging' &&
    uniquePlainMarker(content, 'Health status') === 'passed' &&
    uniquePlainMarker(content, 'Migration status') === 'current'
  )
}

function hasCleanupReadback(content, counts) {
  const canonicalLines = canonicalEvidenceLines(content)
  return cleanupCountKeys.every((key, index) => {
    const value = uniqueCodeMarker(content, key)
    return (
      canonicalLines[index + 4] === `${key}: \`${counts[key]}\`` &&
      value !== null &&
      /^(?:0|[1-9]\d*)$/.test(value) &&
      Number(value) === counts[key]
    )
  })
}

function canonicalEvidenceLines(content) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines[0]?.startsWith('# ')) {
    lines.shift()
  }

  return lines
}

function uniquePlainMarker(content, label) {
  const pattern = new RegExp(
    `^[ \\t]*${escapeRegularExpression(label)}:[ \\t]*([^\\r\\n]+?)[ \\t]*\\r?$`,
    'gm',
  )
  const values = [...content.matchAll(pattern)].map((match) => match[1])
  return values.length === 1 ? values[0] : null
}

function uniqueCodeMarker(content, label) {
  const pattern = new RegExp(
    '^[ \\t]*' +
      escapeRegularExpression(label) +
      ':[ \\t]*`([^`\\r\\n]+)`[ \\t]*\\r?$',
    'gm',
  )
  const values = [...content.matchAll(pattern)].map((match) => match[1])
  return values.length === 1 ? values[0] : null
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function unsafeContentRule(
  content,
  { scanEmbeddedPairs = true, allowCleanupCountAssignments = false } = {},
) {
  if (hasUnsafeAuthorizationCredential(content)) {
    return 'authorization_credential'
  }
  if (
    hasUnsafeSensitiveJsonField(content, {
      includePluralSuffixes: scanEmbeddedPairs,
    })
  ) {
    return 'sensitive_json_field'
  }
  if (scanEmbeddedPairs && hasUnsafeUrlUserInfo(content)) {
    return 'url_userinfo'
  }
  if (scanEmbeddedPairs && hasUnsafeEmbeddedSensitivePair(content)) {
    return 'sensitive_assignment'
  }
  if (hasUnsafeSensitiveAssignment(content, { allowCleanupCountAssignments })) {
    return 'sensitive_assignment'
  }

  const structuralRules = [
    [
      'private_key',
      /-----BEGIN (?:PGP PRIVATE KEY BLOCK|(?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED) )?PRIVATE KEY)-----/i,
    ],
    [
      'jwt',
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    ],
    [
      'raw_payload_field',
      /"(?:request[-_]?body|response[-_]?body|raw[-_]?body|raw[-_]?request|raw[-_]?response|raw[-_]?inquiry[-_]?body|encrypted[-_]?payload|cipher[-_]?string)"\s*:/i,
    ],
    [
      'opaque_vault_material',
      /(?:^|[^A-Za-z0-9+/_=-])[012]\.[A-Za-z0-9+/_-]{20,}={0,2}(?:\|[A-Za-z0-9+/_-]{20,}={0,2}){1,2}(?=$|[^A-Za-z0-9+/_=|-])/,
    ],
  ]

  for (const [id, pattern] of structuralRules) {
    if (pattern.test(content)) {
      return id
    }
  }

  for (const match of content.matchAll(
    /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi,
  )) {
    const address = match[0].toLowerCase()
    const domain = match[1]?.toLowerCase()
    if (domain && !isAllowedEvidenceEmailAddress(address, domain)) {
      return 'personal_email_address'
    }
  }

  return null
}

function hasUnsafeAuthorizationCredential(content) {
  for (const field of structuredJsonFields(content)) {
    if (normalizeJsonFieldName(field.name) !== 'authorization') {
      continue
    }
    if (!field.parsed.ok) {
      const lineEnd = content.indexOf('\n', field.valueStart)
      const rawValue = content.slice(
        field.valueStart,
        lineEnd < 0 ? content.length : lineEnd,
      )
      if (/\b(?:Bearer|Basic)\b/i.test(rawValue)) {
        return true
      }
      continue
    }
    if (containsUnsafeAuthorizationValue(field.parsed.value)) {
      return true
    }
  }

  const pattern =
    /\bAuthorization["'`]?\s*[:=]\s*(["'`]?)\s*(?:Bearer|Basic)\s+([^\r\n]+)/gi

  for (const match of content.matchAll(pattern)) {
    const quote = match[1] ?? ''
    const remainder = match[2]?.trim() ?? ''
    if (!quote) {
      if (!isExactRedactedValue(remainder)) {
        return true
      }
      continue
    }

    const closingQuoteIndex = remainder.indexOf(quote)
    if (closingQuoteIndex < 0) {
      return true
    }
    const value = remainder.slice(0, closingQuoteIndex).trim()
    const trailing = remainder.slice(closingQuoteIndex + 1).trim()
    const hasQuotedJsonKey = content[match.index - 1] === '"'
    if (
      !isExactRedactedValue(value) ||
      (trailing.length > 0 && !(hasQuotedJsonKey && /^[,}]/.test(trailing)))
    ) {
      return true
    }
  }

  return false
}

function hasUnsafeUrlUserInfo(content) {
  for (const match of content.matchAll(
    /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]+/gi,
  )) {
    try {
      const url = new URL(match[0])
      if (url.username || url.password) {
        return true
      }
    } catch {
      continue
    }
  }

  return false
}

function hasUnsafeSensitiveJsonField(
  content,
  { includePluralSuffixes = true } = {},
) {
  for (const field of structuredJsonFields(content)) {
    if (!isSensitiveJsonFieldName(field.name, { includePluralSuffixes })) {
      continue
    }
    if (
      !field.parsed.ok ||
      typeof field.parsed.value !== 'string' ||
      !isExactRedactedValue(field.parsed.value)
    ) {
      return true
    }
  }

  return false
}

function structuredJsonFields(content) {
  const fields = []
  const pattern = /("(?:\\.|[^"\\])*")\s*:/g

  for (const match of content.matchAll(pattern)) {
    let name
    try {
      name = JSON.parse(match[1])
    } catch {
      continue
    }
    if (typeof name !== 'string') {
      continue
    }

    const valueStart = (match.index ?? 0) + match[0].length
    fields.push({
      name,
      valueStart,
      parsed: parseJsonValueAt(content, valueStart),
    })
  }

  return fields
}

function parseJsonValueAt(content, valueStart) {
  let start = valueStart
  while (start < content.length && /\s/.test(content[start])) {
    start += 1
  }
  if (start >= content.length) {
    return { ok: false }
  }

  const firstCharacter = content[start]
  let end
  if (firstCharacter === '"') {
    end = jsonStringEnd(content, start)
  } else if (firstCharacter === '[' || firstCharacter === '{') {
    end = jsonCompositeEnd(content, start)
  } else {
    end = start
    while (end < content.length && !/[,\]}\r\n]/.test(content[end])) {
      end += 1
    }
  }
  if (end === null || end === start) {
    return { ok: false }
  }

  let value
  try {
    value = JSON.parse(content.slice(start, end).trim())
  } catch {
    return { ok: false }
  }

  let trailingIndex = end
  while (
    trailingIndex < content.length &&
    (content[trailingIndex] === ' ' || content[trailingIndex] === '\t')
  ) {
    trailingIndex += 1
  }
  if (
    trailingIndex < content.length &&
    !/[,\]}\r\n]/.test(content[trailingIndex])
  ) {
    return { ok: false }
  }

  return { ok: true, value }
}

function jsonStringEnd(content, start) {
  let escaped = false
  for (let index = start + 1; index < content.length; index += 1) {
    const character = content[index]
    if (escaped) {
      escaped = false
    } else if (character === '\\') {
      escaped = true
    } else if (character === '"') {
      return index + 1
    }
  }
  return null
}

function jsonCompositeEnd(content, start) {
  const expectedClosers = []
  let inString = false
  let escaped = false

  for (let index = start; index < content.length; index += 1) {
    const character = content[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }

    if (character === '"') {
      inString = true
    } else if (character === '{') {
      expectedClosers.push('}')
    } else if (character === '[') {
      expectedClosers.push(']')
    } else if (character === '}' || character === ']') {
      if (expectedClosers.pop() !== character) {
        return null
      }
      if (expectedClosers.length === 0) {
        return index + 1
      }
    }
  }

  return null
}

function normalizeJsonFieldName(value) {
  return value.toLowerCase().replace(/[\s_-]/g, '')
}

function isSensitiveJsonFieldName(
  value,
  { includePluralSuffixes = true } = {},
) {
  const normalized = normalizeJsonFieldName(value)
  if (
    sensitiveJsonFieldNames.has(normalized) ||
    normalized.endsWith('token') ||
    normalized.endsWith('secret') ||
    (includePluralSuffixes &&
      (normalized.endsWith('tokens') ||
        normalized.endsWith('secrets') ||
        normalized.endsWith('passwords')))
  ) {
    return true
  }

  const words = value
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
  const suffix = words.at(-1)?.toLowerCase()

  return suffix
    ? sensitiveJsonFieldSuffixes.has(suffix) ||
        (includePluralSuffixes && sensitiveJsonPluralFieldSuffixes.has(suffix))
    : false
}

function containsUnsafeAuthorizationValue(value) {
  if (typeof value === 'string') {
    const match = /^\s*(?:Bearer|Basic)\s+(.+)$/i.exec(value)
    return match ? !isExactRedactedValue(match[1] ?? '') : false
  }
  if (Array.isArray(value)) {
    return value.some(containsUnsafeAuthorizationValue)
  }
  if (isRecord(value)) {
    return Object.values(value).some(containsUnsafeAuthorizationValue)
  }
  return false
}

function hasUnsafeSensitiveAssignment(
  content,
  { allowCleanupCountAssignments = false } = {},
) {
  const pattern =
    /^[ \t]*(?:(?:[-*+>]|[0-9]+[.)])[ \t]+)*(?:\[[ xX]\][ \t]+)?(?:\$[ \t]+)?(?:export[ \t]+)?`?((?:passwords?|password[ _-]?hash(?:es)?|master[ _-]?passwords?|master[ _-]?password[ _-]?hash(?:es)?|access[ _-]?tokens?|refresh[ _-]?tokens?|tokens?|secret[ _-]?keys?|secrets?|client[ _-]?secrets?|api[ _-]?keys?|private[ _-]?keys?|recovery[ _-]?codes?|credentials?|request[ _-]?body|response[ _-]?body|raw[ _-]?body|raw[ _-]?request|raw[ _-]?response|raw[ _-]?inquiry[ _-]?body|encrypted[ _-]?payload|cipher[ _-]?string|[A-Z][A-Z0-9_-]*(?:TOKENS?|SECRET[ _-]?KEYS?|SECRETS?|PASSWORDS?|PASSWORD[ _-]?HASH(?:ES)?|PRIVATE[ _-]?KEYS?|API[ _-]?KEYS?|SECRET[ _-]?ACCESS[ _-]?KEYS?|CREDENTIALS?)))`?\s*[:=]\s*(\S.*)$/gim

  for (const match of content.matchAll(pattern)) {
    const fieldName = match[1] ?? ''
    const value = match[2] ?? ''
    if (isExactRedactedValue(value, true)) {
      continue
    }
    if (
      allowCleanupCountAssignments &&
      isCleanupCountAssignment(fieldName, value)
    ) {
      continue
    }
    return true
  }

  return false
}

function hasUnsafeEmbeddedSensitivePair(content) {
  const pattern =
    /(?:^|[?&;,:\s"'`])(?:passwords?|password[-_]?hash(?:es)?|master[-_]?passwords?|master[-_]?password[-_]?hash(?:es)?|access[-_]?tokens?|refresh[-_]?tokens?|tokens?|secret[-_]?keys?|secrets?|client[-_]?secrets?|api[-_]?keys?|private[-_]?keys?|recovery[-_]?codes?|credentials?|[A-Z][A-Z0-9_-]*(?:TOKENS?|SECRET[-_]?KEYS?|SECRETS?|PASSWORDS?|PASSWORD[-_]?HASH(?:ES)?|PRIVATE[-_]?KEYS?|API[-_]?KEYS?|SECRET[-_]?ACCESS[-_]?KEYS?|CREDENTIALS?))\s*=\s*([^&#;,\s]+)/gim

  for (const match of content.matchAll(pattern)) {
    if (!isExactRedactedValue(match[1] ?? '', true)) {
      return true
    }
  }

  return false
}

function isCleanupCountAssignment(fieldName, value) {
  if (normalizeJsonFieldName(fieldName) !== 'refreshtokens') {
    return false
  }

  let normalized = value.trim()
  const quote = normalized[0]
  if (
    normalized.length >= 2 &&
    ['"', "'", '`'].includes(quote) &&
    normalized.at(-1) === quote
  ) {
    normalized = normalized.slice(1, -1).trim()
  }

  return /^(?:0|[1-9]\d*)$/.test(normalized)
}

function isExactRedactedValue(value, allowEmptySentinel = false) {
  let normalized = value.trim()
  const quote = normalized[0]
  if (
    normalized.length >= 2 &&
    ['"', "'", '`'].includes(quote) &&
    normalized.at(-1) === quote
  ) {
    normalized = normalized.slice(1, -1).trim()
  }
  normalized = normalized.toLowerCase()

  if (['<redacted>', '[redacted]', 'redacted'].includes(normalized)) {
    return true
  }
  return allowEmptySentinel && ['none', 'null', 'false'].includes(normalized)
}

function isAllowedEvidenceEmailAddress(address, domain) {
  if (allowedPublicContactAddresses.has(address)) {
    return true
  }
  if (
    [...reservedExampleDomains].some(
      (reservedDomain) =>
        domain === reservedDomain || domain.endsWith(`.${reservedDomain}`),
    )
  ) {
    return true
  }
  return reservedDomainSuffixes.some((suffix) => domain.endsWith(suffix))
}

function readClientMatrix(repoRoot) {
  try {
    const matrix = JSON.parse(
      readFileSync(join(repoRoot, clientMatrixRelativePath), 'utf8'),
    )
    if (!isRecord(matrix) || !Array.isArray(matrix.entries)) {
      return null
    }
    return matrix
  } catch {
    return null
  }
}

function clientSetMismatch(clients, matrix) {
  for (const surface of clientSetKeys) {
    const matrixEntry = matrix.entries.find(
      (entry) => isRecord(entry) && entry.surface === surface,
    )
    if (!matrixEntry) {
      return surface
    }
    const expectedBuild =
      typeof matrixEntry.build === 'string' ? matrixEntry.build : null
    if (
      clients[surface].version !== matrixEntry.version ||
      clients[surface].build !== expectedBuild ||
      clients[surface].releaseTag !== matrixEntry.releaseTag
    ) {
      return surface
    }
  }
  return null
}

function parseOptions(argv) {
  const options = { strict: false, manifestPath: null }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    switch (argument) {
      case '--':
        break
      case '--strict':
        options.strict = true
        break
      case '--manifest':
        options.manifestPath = takeValue(argv, (index += 1), argument)
        break
      default:
        throw new Error('Unknown option')
    }
  }

  return options
}

function takeValue(argv, index, optionName) {
  const value = argv[index]
  if (!value || value.startsWith('--')) {
    throw new Error(`${optionName} requires a value`)
  }
  return value
}

function resolveManifestPath(manifestPath, repoRoot) {
  if (typeof manifestPath !== 'string' || manifestPath.trim().length === 0) {
    return { ok: false, blockingReason: 'manifest_path_missing' }
  }
  if (!isCanonicalPosixRelativePath(manifestPath)) {
    return { ok: false, blockingReason: 'manifest_path_unsafe' }
  }
  return { ok: true, path: resolve(repoRoot, manifestPath) }
}

export function isCanonicalPosixRelativePath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value === value.trim() &&
    !isAbsolute(value) &&
    !value.includes('\\') &&
    posix.normalize(value) === value
  )
}

export function toPosixRelativePath(value) {
  return value.replaceAll('\\', '/')
}

function isSafeRegularFile(path) {
  if (!existsSync(path)) {
    return false
  }
  const stats = lstatSync(path)
  return stats.isFile() && !stats.isSymbolicLink()
}

function realPathWithin(root, path) {
  try {
    return isWithin(realpathSync(root), realpathSync(path))
  } catch {
    return false
  }
}

function hasSymlinkComponent(root, path) {
  const relativePath = relative(resolve(root), resolve(path))
  if (
    relativePath.length === 0 ||
    relativePath.startsWith('..') ||
    isAbsolute(relativePath)
  ) {
    return true
  }

  let current = resolve(root)
  try {
    for (const segment of relativePath.split(/[\\/]/)) {
      current = join(current, segment)
      if (lstatSync(current).isSymbolicLink()) {
        return true
      }
    }
  } catch {
    return true
  }

  return false
}

function isWithin(root, path) {
  const relativePath = relative(resolve(root), resolve(path))
  return (
    relativePath.length > 0 &&
    !relativePath.startsWith('..') &&
    !isAbsolute(relativePath)
  )
}

function normalizeReportPath(path, repoRoot) {
  const relativePath = relative(repoRoot, path)
  if (
    relativePath.length > 0 &&
    !relativePath.startsWith('..') &&
    !isAbsolute(relativePath)
  ) {
    return relativePath
  }
  return basename(path)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value, expectedKeys) {
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  )
}

function isStringArray(value) {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string' && entry.length > 0)
  )
}

function isRunId(value) {
  return /^\d{8}T\d{6}Z$/.test(value)
}

function runIdForTimestamp(value) {
  if (!isIsoTimestamp(value)) {
    return null
  }
  return value.replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '')
}

function isIsoTimestamp(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  ) {
    return false
  }

  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    return false
  }

  const canonicalValue = value.includes('.')
    ? value
    : value.replace(/Z$/, '.000Z')
  return new Date(timestamp).toISOString() === canonicalValue
}

function isFullCommit(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value)
}

function isUuid(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
}

function isSafeStagingUrl(value) {
  if (value !== stagingWorkerUrl) {
    return false
  }
  try {
    const url = new URL(value)
    const hostname = url.hostname
      .toLowerCase()
      .replace(/^\[/, '')
      .replace(/\]$/, '')
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      hostname !== 'localhost' &&
      !hostname.endsWith('.localhost') &&
      isIP(hostname) === 0 &&
      hostname === stagingWorkerHostname &&
      url.port === '' &&
      url.pathname === '/'
    )
  } catch {
    return false
  }
}

function gitCommitExists(sourceCommit, repoRoot) {
  if (!isFullCommit(sourceCommit)) {
    return false
  }
  const result = spawnSync(
    'git',
    ['cat-file', '-e', `${sourceCommit}^{commit}`],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'ignore'],
    },
  )
  return result.status === 0
}

function safeTarget(manifest) {
  return {
    environment: manifest.environment,
    sourceCommit: manifest.sourceCommit,
    workerName: manifest.worker.name,
    workerVersionId: manifest.worker.versionId,
    serverUrl: safeUrlForReport(manifest.worker.serverUrl),
  }
}

function safeUrlForReport(value) {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return '<invalid-url>'
  }
}

function safeClients(clients) {
  return Object.fromEntries(
    clientSetKeys.map((surface) => [
      surface,
      {
        version: clients[surface].version,
        build: clients[surface].build,
        releaseTag: clients[surface].releaseTag,
      },
    ]),
  )
}

function passedRequirement(id, evidence = []) {
  return { id, status: 'pass', blocker: null, evidence }
}

function failedRequirement(id, blocker, evidence = []) {
  return { id, status: 'fail', blocker, evidence }
}

function reportFromState(state, status, blockingReason) {
  return {
    schemaVersion: 1,
    status,
    blockingReason,
    manifestPath: state.manifestPath,
    target: state.target,
    clients: state.clients,
    criteria: state.criteria,
    cleanup: state.cleanup,
    requirements: state.requirements,
    limitations,
  }
}

function emptyReport({ status, blockingReason, requirements }) {
  return {
    schemaVersion: 1,
    status,
    blockingReason,
    manifestPath: null,
    target: null,
    clients: null,
    criteria: [],
    cleanup: null,
    requirements,
    limitations,
  }
}

const invokedPath = process.argv[1]
if (
  invokedPath &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).toString()
) {
  main()
}

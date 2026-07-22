import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { parseTree } from 'jsonc-parser'

const scriptPath = fileURLToPath(import.meta.url)
const defaultRepoRoot = resolve(dirname(scriptPath), '..')
const defaultRegistryPath = resolve(
  defaultRepoRoot,
  'compat/credential-evidence.json',
)

export const credentialEvidenceLevels = Object.freeze([
  Object.freeze({ id: 'fixture', rank: 0, scope: 'recorded_wire_only' }),
  Object.freeze({ id: 'local_api', rank: 1, scope: 'isolated_local_api' }),
  Object.freeze({
    id: 'local_official_client',
    rank: 2,
    scope: 'isolated_local_official_client',
  }),
  Object.freeze({ id: 'staging', rank: 3, scope: 'tracked_staging' }),
  Object.freeze({ id: 'production', rank: 4, scope: 'approved_production' }),
])

export const credentialOperations = Object.freeze([
  'account.password.verify',
  'account.password.change',
  'account.kdf.pbkdf2_to_argon2id',
  'account.kdf.argon2id_to_pbkdf2',
  'account.key.initialize',
  'account.key.read',
  'account.user_key.rotate',
  'recovery.backup.export',
  'recovery.restore.fresh_target',
  'recovery.writers.disabled',
  'recovery.forward_generation',
])

const localApiLevel = 'local_api'
const officialClientLevel = 'local_official_client'
const lifecycleMerge = '7443d3daee70d09b015c864da6033ff3246d0f75'
const backupMerge = '27388e56e54c8b7bd67249bc9cf4fea5401d3a7a'
const restoreMerge = 'c1e2f7c8befb4c85030d48e9b7171fb5599761c2'
const recoveryMerge = '13f4e895d69b2c2485a10a82d1793cf60e148024'
const lifecycleResult =
  '.workflow/hon-207-credential-closeout/results/02-credential-lifecycle.md'
const backupResult =
  '.workflow/hon-207-credential-closeout/results/03a-generation-bound-backup.md'
const restoreResult =
  '.workflow/hon-207-credential-closeout/results/03b-fresh-restore.md'
const recoveryResult =
  '.workflow/hon-207-credential-closeout/results/03c-disable-forward-recovery.md'
const cliFullReadback = [
  clientProvenance('cli.release', [
    'login',
    'lock',
    'unlock',
    'sync',
    'item_read',
  ]),
]

export const credentialArtifactDigests = Object.freeze({
  [lifecycleResult]:
    'a85ae44c13af4a47a72f81ae2e13fe1ad4c1f018ee969ad36d0d74a04a8247d8',
  [backupResult]:
    '3a061f20f0f738004e803f7a5b92334bd3288cf3df50593b31b5410a7701be74',
  [restoreResult]:
    '272e6bde92b657eebe6934d7b814885f5de8fd0a4c3429068022f07058e4c540',
  [recoveryResult]:
    '8a5130246653fdd4dc17e358038d257d2f4a27762b4c5fc4caceadebe1c4c979',
  'docs/release/account-kdf-change-local-evidence.md':
    '1cbca6435c005b735b24aaee227df23573ceaa9dabdc35e5edb538f3b32a8213',
  'docs/release/account-key-initialization-local-evidence.md':
    'cd3d5197099e57a710a858f93d4972825c5585077dc4bb88667f2879f957d198',
  'docs/release/account-password-change-local-evidence.md':
    '5d66e66ab6d241a971115861b781c81ce40c30a281bc224a355f8942b85cf648',
  'docs/release/user-key-rotation-local-evidence.md':
    '50c6d16e4baa45b49dd7538019f6fe5a459342604fb940abbeeefecbcc7f2c6c',
})

// The registry is mutable input; this catalog is its independent provenance anchor.
export const credentialClaimProvenance = deepFreeze({
  'account.password.verify': defineClaimProvenance({
    sourceCommit: lifecycleMerge,
    artifacts: [
      [lifecycleResult, localApiLevel],
      ['docs/release/account-password-change-local-evidence.md', localApiLevel],
    ],
  }),
  'account.password.change': defineClaimProvenance({
    evidenceLevel: officialClientLevel,
    sourceCommit: lifecycleMerge,
    artifacts: [
      ['docs/release/account-password-change-local-evidence.md', localApiLevel],
      [lifecycleResult, officialClientLevel],
    ],
    clientEvidence: cliFullReadback,
  }),
  'account.kdf.pbkdf2_to_argon2id': defineClaimProvenance({
    evidenceLevel: officialClientLevel,
    sourceCommit: lifecycleMerge,
    artifacts: [
      ['docs/release/account-kdf-change-local-evidence.md', localApiLevel],
      [lifecycleResult, officialClientLevel],
    ],
    clientEvidence: cliFullReadback,
  }),
  'account.kdf.argon2id_to_pbkdf2': defineClaimProvenance({
    evidenceLevel: officialClientLevel,
    sourceCommit: lifecycleMerge,
    artifacts: [
      ['docs/release/account-kdf-change-local-evidence.md', localApiLevel],
      [lifecycleResult, officialClientLevel],
    ],
    clientEvidence: cliFullReadback,
  }),
  'account.key.initialize': defineClaimProvenance({
    evidenceLevel: officialClientLevel,
    sourceCommit: lifecycleMerge,
    artifacts: [
      [
        'docs/release/account-key-initialization-local-evidence.md',
        localApiLevel,
      ],
      [lifecycleResult, officialClientLevel],
    ],
    clientEvidence: cliFullReadback,
  }),
  'account.key.read': defineClaimProvenance({
    sourceCommit: lifecycleMerge,
    artifacts: [
      [lifecycleResult, localApiLevel],
      [
        'docs/release/account-key-initialization-local-evidence.md',
        localApiLevel,
      ],
    ],
  }),
  'account.user_key.rotate': defineClaimProvenance({
    evidenceLevel: officialClientLevel,
    sourceCommit: lifecycleMerge,
    artifacts: [
      ['docs/release/user-key-rotation-local-evidence.md', localApiLevel],
      [lifecycleResult, officialClientLevel],
    ],
    clientEvidence: [
      ...cliFullReadback,
      clientProvenance('browser.release', ['login', 'sync', 'vault_read']),
    ],
  }),
  'recovery.backup.export': defineClaimProvenance({
    sourceCommit: backupMerge,
    artifacts: [[backupResult, localApiLevel]],
  }),
  'recovery.restore.fresh_target': defineClaimProvenance({
    evidenceLevel: officialClientLevel,
    sourceCommit: restoreMerge,
    artifacts: [
      [restoreResult, localApiLevel],
      [restoreResult, officialClientLevel],
    ],
    clientEvidence: cliFullReadback,
  }),
  'recovery.writers.disabled': defineClaimProvenance({
    sourceCommit: recoveryMerge,
    artifacts: [[recoveryResult, localApiLevel]],
  }),
  'recovery.forward_generation': defineClaimProvenance({
    evidenceLevel: officialClientLevel,
    sourceCommit: recoveryMerge,
    artifacts: [
      [recoveryResult, localApiLevel],
      [recoveryResult, officialClientLevel],
    ],
    clientEvidence: [clientProvenance('cli.release', ['item_read'])],
  }),
})

export const credentialClaimDigests = Object.freeze({
  'account.password.verify':
    '5e59e6ab2dd1881225dd4de5c4866a861c7f463359f95ca352698a44b7429d26',
  'account.password.change':
    '088e85c21b8a5d7997cf7e0d440b93bfac5d0cb75d30412e3123a0b38a84a49b',
  'account.kdf.pbkdf2_to_argon2id':
    '0000da17afe76b48055f3eed01e8f3ef4809e067126d0e996e8dee3583976c42',
  'account.kdf.argon2id_to_pbkdf2':
    '3608bebe5202a3e17dad0d052705f0e1cd1a945f8c51c4a18e06fdeafdd8fd3a',
  'account.key.initialize':
    '9b91c0493063c453f3d3b4cd2799ccef459f8e3166ba6064dee36a98fe0fd14b',
  'account.key.read':
    'ff4ffd5804f6255c22145968f6f1e64cdbe4296caff9592702da01e5bb9ebe88',
  'account.user_key.rotate':
    '3d5df13a00058d8ba4c82b80f1811cf579dfbdca190a8ef3e4b9c9210d4afbcc',
  'recovery.backup.export':
    '971fb7c2b9612e58a7341b784693f50f2104cd7d13ac460fb7531860475b939f',
  'recovery.restore.fresh_target':
    '50a8fb6bdcb95fe680ec081295309b13d76adebeb0b151f59fdfff39cc067ce0',
  'recovery.writers.disabled':
    'a2f23defbf2e227d97edade05fc506004508f96789c1939bfc2abb75c0c4f022',
  'recovery.forward_generation':
    '33d46043272594fe507e3802a71e06e3f236d34276b2b40e3e7560f684f906c4',
})

export const credentialEvidenceSources = Object.freeze({
  repository: Object.freeze({
    programBaseCommit: 'a68ec0ccf0c5379ce228dce93f4f8eef05f6d6f3',
  }),
  clients: Object.freeze([
    Object.freeze({
      id: 'cli.release',
      surface: 'cli',
      version: '2026.6.0',
      sourceRef: 'cli-v2026.6.0@e6293ff2bc85123e9baaa998cf1543030ec5d9f0',
      assetSha256:
        '57d1e60d7748c6efed96559833ce0423a5c825cbf1356d952970c87a497a64d4',
    }),
    Object.freeze({
      id: 'browser.release',
      surface: 'browser_extension',
      version: '2026.6.1',
      sourceRef: 'browser-v2026.6.1@723c075bf8b9f45c901e56195be8e94e43ed75a2',
      assetSha256:
        'fcd29c5971d9b218ad9159717a19c38cca5150f2a0aa909ddf805bd7695d097e',
    }),
  ]),
})

const levelById = new Map(
  credentialEvidenceLevels.map((level) => [level.id, level]),
)
const operationSet = new Set(credentialOperations)
const sourceKinds = new Set(['merge_commit', 'reviewed_head'])
const clientOperationsBySurface = new Map([
  ['cli', new Set(['login', 'lock', 'unlock', 'sync', 'item_read'])],
  ['browser_extension', new Set(['login', 'sync', 'vault_read'])],
])
const topLevelKeys = ['schemaVersion', 'evidenceLevels', 'sources', 'claims']

export function readCredentialEvidenceRegistryText(path = defaultRegistryPath) {
  return readFileSync(path, 'utf8')
}

export function loadCredentialEvidenceRegistry({
  repoRoot = defaultRepoRoot,
  registryPath = resolve(repoRoot, 'compat/credential-evidence.json'),
  trackedPaths,
} = {}) {
  const registry = parseCredentialEvidenceRegistry(
    readCredentialEvidenceRegistryText(registryPath),
  )
  validateCredentialEvidenceRegistry(registry, { repoRoot, trackedPaths })
  return registry
}

function parseCredentialEvidenceRegistry(text) {
  const errors = []
  const tree = parseTree(text, errors, {
    allowEmptyContent: false,
    allowTrailingComma: false,
    disallowComments: true,
  })
  if (!tree || errors.length > 0) {
    throw new Error('credential evidence registry is not valid JSON')
  }
  assertNoDuplicateJsonObjectKeys(tree)

  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error('credential evidence registry is not valid JSON', {
      cause: error,
    })
  }
}

function assertNoDuplicateJsonObjectKeys(node) {
  if (node.type === 'array') {
    for (const child of node.children ?? []) {
      assertNoDuplicateJsonObjectKeys(child)
    }
    return
  }
  if (node.type !== 'object') return

  const keys = new Set()
  for (const property of node.children ?? []) {
    const [keyNode, valueNode] = property.children ?? []
    if (
      property.type !== 'property' ||
      keyNode?.type !== 'string' ||
      typeof keyNode.value !== 'string' ||
      valueNode === undefined
    ) {
      throw new Error('credential evidence registry is not valid JSON')
    }
    if (keys.has(keyNode.value)) {
      throw new Error(
        'credential evidence registry contains a duplicate object key',
      )
    }
    keys.add(keyNode.value)
    assertNoDuplicateJsonObjectKeys(valueNode)
  }
}

export function validateCredentialEvidenceRegistry(
  registry,
  { repoRoot = defaultRepoRoot, trackedPaths } = {},
) {
  assertPlainObject(registry, 'registry')
  assertExactKeys(registry, topLevelKeys, 'registry')
  if (registry.schemaVersion !== 1) {
    throw new Error('registry schemaVersion must be 1')
  }
  if (
    JSON.stringify(registry.evidenceLevels) !==
    JSON.stringify(credentialEvidenceLevels)
  ) {
    throw new Error('registry evidenceLevels do not match the canonical model')
  }

  const sources = validateSources(registry.sources)
  if (
    JSON.stringify(registry.sources) !==
    JSON.stringify(credentialEvidenceSources)
  ) {
    throw new Error('registry sources do not match the canonical pins')
  }
  if (!Array.isArray(registry.claims)) {
    throw new Error('registry claims must be an array')
  }
  if (registry.claims.length !== credentialOperations.length) {
    throw new Error(
      `registry must contain ${credentialOperations.length} credential claims`,
    )
  }

  const canonicalRepoRoot = realpathSync(repoRoot)
  const tracked =
    trackedPaths === undefined
      ? readTrackedPaths(canonicalRepoRoot)
      : new Set(trackedPaths)
  const claimIds = new Set()
  const operations = new Set()

  registry.claims.forEach((claim, index) => {
    validateClaim(claim, {
      index,
      repoRoot: canonicalRepoRoot,
      trackedPaths: tracked,
      sources,
      claimIds,
      operations,
    })
  })

  const actualOperations = registry.claims.map((claim) => claim.operation)
  if (
    JSON.stringify(actualOperations) !== JSON.stringify(credentialOperations)
  ) {
    throw new Error('credential claims are missing or not in canonical order')
  }

  const liveEvidenceLevels = ['staging', 'production'].filter((level) =>
    registry.claims.some((claim) => claim.evidenceLevel === level),
  )

  return {
    schemaVersion: 1,
    status: 'passed',
    levels: credentialEvidenceLevels.length,
    claims: registry.claims.length,
    artifacts: new Set(
      registry.claims.flatMap((claim) =>
        claim.artifacts.map((artifact) => artifact.path),
      ),
    ).size,
    liveEvidenceLevels,
    limitations: summarizeCredentialEvidenceLimitations(registry.claims),
  }
}

export function summarizeCredentialEvidenceLimitations(claims) {
  const liveLevels = new Set(
    claims
      .map((claim) => claim.evidenceLevel)
      .filter((level) => level === 'staging' || level === 'production'),
  )
  const limitations = [
    'The registry verifies committed metadata and artifact markers; it does not rerun the recorded local lifecycle.',
  ]
  const missing = ['staging', 'production'].filter(
    (level) => !liveLevels.has(level),
  )
  if (missing.length === 2) {
    limitations.push(
      'No claim in this registry proves staging or production activation.',
    )
  } else if (missing.length === 1) {
    limitations.push(
      `No claim in this registry proves ${missing[0]} activation.`,
    )
  }
  return limitations
}

function validateSources(value) {
  assertPlainObject(value, 'sources')
  assertExactKeys(value, ['repository', 'clients'], 'sources')
  assertPlainObject(value.repository, 'sources.repository')
  assertExactKeys(value.repository, ['programBaseCommit'], 'sources.repository')
  assertCommit(
    value.repository.programBaseCommit,
    'sources.repository.programBaseCommit',
  )
  if (!Array.isArray(value.clients) || value.clients.length === 0) {
    throw new Error('sources.clients must be a non-empty array')
  }

  const clients = new Map()
  for (const [index, client] of value.clients.entries()) {
    const label = `sources.clients[${index}]`
    assertPlainObject(client, label)
    assertExactKeys(
      client,
      ['id', 'surface', 'version', 'sourceRef', 'assetSha256'],
      label,
    )
    assertIdentifier(client.id, `${label}.id`)
    if (clients.has(client.id)) {
      throw new Error(`duplicate client source: ${client.id}`)
    }
    if (!clientOperationsBySurface.has(client.surface)) {
      throw new Error(`${label}.surface is unsupported`)
    }
    assertNonEmptyString(client.version, `${label}.version`)
    if (
      typeof client.sourceRef !== 'string' ||
      !/@[0-9a-f]{40}$/.test(client.sourceRef)
    ) {
      throw new Error(`${label}.sourceRef must end in an exact commit`)
    }
    assertSha256(client.assetSha256, `${label}.assetSha256`)
    clients.set(client.id, client)
  }
  return { clients }
}

function validateClaim(claim, context) {
  const label = `claims[${context.index}]`
  assertPlainObject(claim, label)
  const required = [
    'id',
    'operation',
    'assertion',
    'executionLevel',
    'evidenceLevel',
    'sourceGeneration',
    'artifacts',
    'limitations',
  ]
  const optional = ['clientEvidence', 'environmentEvidence']
  assertExactKeys(claim, required, label, optional)
  assertIdentifier(claim.id, `${label}.id`)
  if (context.claimIds.has(claim.id)) {
    throw new Error(`duplicate claim id: ${claim.id}`)
  }
  context.claimIds.add(claim.id)

  if (!operationSet.has(claim.operation)) {
    throw new Error(`unknown operation: ${String(claim.operation)}`)
  }
  if (context.operations.has(claim.operation)) {
    throw new Error(`duplicate operation: ${claim.operation}`)
  }
  context.operations.add(claim.operation)
  assertNonEmptyString(claim.assertion, `${label}.assertion`)

  const execution = requiredLevel(
    claim.executionLevel,
    `${label}.executionLevel`,
  )
  const evidence = requiredLevel(claim.evidenceLevel, `${label}.evidenceLevel`)
  if (execution.rank > evidence.rank) {
    throw new Error(`${label} executionLevel exceeds evidenceLevel`)
  }

  assertPlainObject(claim.sourceGeneration, `${label}.sourceGeneration`)
  assertExactKeys(
    claim.sourceGeneration,
    ['kind', 'commit'],
    `${label}.sourceGeneration`,
  )
  if (!sourceKinds.has(claim.sourceGeneration.kind)) {
    throw new Error(`${label}.sourceGeneration.kind is unsupported`)
  }
  assertCommit(
    claim.sourceGeneration.commit,
    `${label}.sourceGeneration.commit`,
  )
  const provenance = credentialClaimProvenance[claim.operation]
  if (
    JSON.stringify(claim.sourceGeneration) !==
    JSON.stringify(provenance.sourceGeneration)
  ) {
    throw new Error(
      `${label} source generation does not match canonical provenance`,
    )
  }

  let environmentEvidence = null
  if (
    claim.evidenceLevel === 'staging' ||
    claim.evidenceLevel === 'production'
  ) {
    environmentEvidence = validateEnvironmentEvidence(
      claim.environmentEvidence,
      claim.evidenceLevel,
      label,
    )
  } else if (Object.hasOwn(claim, 'environmentEvidence')) {
    throw new Error(
      `${label} environmentEvidence is only valid for live environments`,
    )
  }
  if (!Array.isArray(claim.artifacts) || claim.artifacts.length === 0) {
    throw new Error(`${label}.artifacts must be a non-empty array`)
  }
  const artifactKeys = new Set()
  const artifactLevels = []
  let sourceCommitMarkerFound = false
  for (const [artifactIndex, artifact] of claim.artifacts.entries()) {
    const artifactLevel = validateArtifact(artifact, {
      label: `${label}.artifacts[${artifactIndex}]`,
      repoRoot: context.repoRoot,
      trackedPaths: context.trackedPaths,
    })
    if (artifactLevel.rank > evidence.rank) {
      throw new Error(`${label} artifact exceeds the claimed evidence level`)
    }
    const key = `${artifact.path}:${artifact.evidenceLevel}`
    if (artifactKeys.has(key)) {
      throw new Error(`${label} has a duplicate artifact binding: ${key}`)
    }
    artifactKeys.add(key)
    artifactLevels.push(artifact.evidenceLevel)
    if (artifact.requiredMarkers.includes(claim.sourceGeneration.commit)) {
      sourceCommitMarkerFound = true
    }
  }
  if (!sourceCommitMarkerFound) {
    throw new Error(
      `${label} source generation is not an exact artifact marker`,
    )
  }
  if (!artifactLevels.includes(claim.evidenceLevel)) {
    throw new Error(
      `${label} requires an exact ${claim.evidenceLevel} artifact`,
    )
  }
  if (
    environmentEvidence !== null &&
    !claim.artifacts.some(
      (artifact) =>
        artifact.evidenceLevel === claim.evidenceLevel &&
        artifact.requiredMarkers.includes(environmentEvidence.deploymentRef) &&
        artifact.requiredMarkers.includes(environmentEvidence.recordedAt),
    )
  ) {
    throw new Error(`${label} live environment evidence must be artifact-bound`)
  }
  if (
    claim.executionLevel !== provenance.executionLevel ||
    claim.evidenceLevel !== provenance.evidenceLevel
  ) {
    throw new Error(`${label} claim levels do not match canonical provenance`)
  }
  const artifactProvenance = claim.artifacts.map(
    ({ path, evidenceLevel, contentSha256 }) => ({
      path,
      evidenceLevel,
      contentSha256,
    }),
  )
  if (
    JSON.stringify(artifactProvenance) !== JSON.stringify(provenance.artifacts)
  ) {
    throw new Error(`${label} artifacts do not match canonical provenance`)
  }

  if (claim.evidenceLevel === 'local_official_client') {
    if (
      !Array.isArray(claim.clientEvidence) ||
      claim.clientEvidence.length === 0
    ) {
      throw new Error(
        `${label} local_official_client claim requires clientEvidence`,
      )
    }
    if (claim.executionLevel !== 'local_api') {
      throw new Error(
        `${label} official-client claim must expose local_api execution`,
      )
    }
    validateClientEvidence(claim.clientEvidence, context.sources.clients, label)
    if (
      JSON.stringify(claim.clientEvidence) !==
      JSON.stringify(provenance.clientEvidence)
    ) {
      throw new Error(
        `${label} client evidence does not match canonical provenance`,
      )
    }
  } else if (Object.hasOwn(claim, 'clientEvidence')) {
    throw new Error(
      `${label} clientEvidence is only valid for local_official_client`,
    )
  }

  assertUniqueNonEmptyStrings(claim.limitations, `${label}.limitations`)
  if (sha256Json(claim) !== credentialClaimDigests[claim.operation]) {
    throw new Error(`${label} claim payload does not match canonical digest`)
  }
}

function validateArtifact(artifact, context) {
  assertPlainObject(artifact, context.label)
  assertExactKeys(
    artifact,
    ['path', 'evidenceLevel', 'contentSha256', 'requiredMarkers'],
    context.label,
  )
  assertCanonicalRepoPath(artifact.path, `${context.label}.path`)
  const level = requiredLevel(
    artifact.evidenceLevel,
    `${context.label}.evidenceLevel`,
  )
  assertSha256(artifact.contentSha256, `${context.label}.contentSha256`)
  assertUniqueNonEmptyStrings(
    artifact.requiredMarkers,
    `${context.label}.requiredMarkers`,
  )
  if (!context.trackedPaths.has(artifact.path)) {
    throw new Error(
      `${context.label} artifact is not tracked: ${artifact.path}`,
    )
  }
  if (artifact.contentSha256 !== credentialArtifactDigests[artifact.path]) {
    throw new Error(`${context.label} artifact digest is not canonical`)
  }
  const absolute = resolve(context.repoRoot, artifact.path)
  assertNoSymlinkComponents(context.repoRoot, artifact.path, context.label)
  const stat = lstatSync(absolute)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${context.label} artifact is not a regular file`)
  }
  const resolvedArtifact = realpathSync(absolute)
  if (!isWithin(context.repoRoot, resolvedArtifact)) {
    throw new Error(`${context.label} artifact resolves outside the repository`)
  }
  const content = readFileSync(resolvedArtifact, 'utf8')
  if (sha256Text(content) !== artifact.contentSha256) {
    throw new Error(`${context.label} artifact content digest mismatch`)
  }
  for (const marker of artifact.requiredMarkers) {
    if (!content.includes(marker)) {
      throw new Error(`${context.label} artifact marker is missing`)
    }
  }
  return level
}

function validateClientEvidence(entries, clients, claimLabel) {
  const sourceIds = new Set()
  for (const [index, entry] of entries.entries()) {
    const label = `${claimLabel}.clientEvidence[${index}]`
    assertPlainObject(entry, label)
    assertExactKeys(entry, ['sourceId', 'operations'], label)
    const source = clients.get(entry.sourceId)
    if (!source) {
      throw new Error(`${label} references an unknown client source`)
    }
    if (sourceIds.has(entry.sourceId)) {
      throw new Error(
        `${claimLabel} has duplicate client source ${entry.sourceId}`,
      )
    }
    sourceIds.add(entry.sourceId)
    assertUniqueNonEmptyStrings(entry.operations, `${label}.operations`)
    const allowed = clientOperationsBySurface.get(source.surface)
    for (const operation of entry.operations) {
      if (!allowed.has(operation)) {
        throw new Error(
          `${label} operation is unsupported for ${source.surface}`,
        )
      }
    }
  }
}

function validateEnvironmentEvidence(value, evidenceLevel, claimLabel) {
  if (!value) {
    throw new Error(
      `${claimLabel} ${evidenceLevel} claim requires ${evidenceLevel} environment evidence`,
    )
  }
  assertPlainObject(value, `${claimLabel}.environmentEvidence`)
  assertExactKeys(
    value,
    ['environment', 'deploymentRef', 'recordedAt'],
    `${claimLabel}.environmentEvidence`,
  )
  if (value.environment !== evidenceLevel) {
    throw new Error(`${claimLabel} environment evidence level mismatch`)
  }
  assertNonEmptyString(value.deploymentRef, `${claimLabel}.deploymentRef`)
  if (
    typeof value.recordedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value.recordedAt)
  ) {
    throw new Error(`${claimLabel}.recordedAt must be an exact UTC timestamp`)
  }
  const recordedAt = new Date(value.recordedAt)
  if (
    Number.isNaN(recordedAt.getTime()) ||
    recordedAt.toISOString() !== value.recordedAt.replace(/Z$/, '.000Z')
  ) {
    throw new Error(`${claimLabel}.recordedAt must be an exact UTC timestamp`)
  }
  return value
}

function readTrackedPaths(repoRoot) {
  const output = execFileSync('git', ['-C', repoRoot, 'ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  return new Set(output.split('\0').filter(Boolean))
}

function assertNoSymlinkComponents(repoRoot, path, label) {
  let current = repoRoot
  for (const part of path.split('/')) {
    current = resolve(current, part)
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`${label} artifact path contains a symlink`)
    }
  }
}

function assertCanonicalRepoPath(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    isAbsolute(value) ||
    value.includes('\\') ||
    !/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(value) ||
    value.split('/').some((part) => part === '.' || part === '..')
  ) {
    throw new Error(`${label} artifact path is not canonical`)
  }
}

function requiredLevel(value, label) {
  const level = levelById.get(value)
  if (!level) throw new Error(`${label} is not a recognized evidence level`)
  return level
}

function assertExactKeys(value, required, label, optional = []) {
  const allowed = new Set([...required, ...optional])
  const keys = Object.keys(value)
  for (const key of required) {
    if (!Object.hasOwn(value, key))
      throw new Error(`${label} is missing ${key}`)
  }
  for (const key of keys) {
    if (!allowed.has(key)) throw new Error(`${label} has unknown field ${key}`)
  }
}

function assertPlainObject(value, label) {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(`${label} must be a plain object`)
  }
}

function assertIdentifier(value, label) {
  if (
    typeof value !== 'string' ||
    !/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/.test(value)
  ) {
    throw new Error(`${label} must be a canonical identifier`)
  }
}

function assertCommit(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`${label} must be a 40-character commit`)
  }
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest`)
  }
}

function assertNonEmptyString(value, label) {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length === 0
  ) {
    throw new Error(`${label} must be a non-empty canonical string`)
  }
}

function assertUniqueNonEmptyStrings(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array`)
  }
  const unique = new Set()
  for (const [index, item] of value.entries()) {
    assertNonEmptyString(item, `${label}[${index}]`)
    if (unique.has(item)) throw new Error(`${label} contains a duplicate value`)
    unique.add(item)
  }
}

function isWithin(root, candidate) {
  const path = relative(root, candidate)
  return (
    path === '' ||
    (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  )
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex')
}

function defineClaimProvenance({
  executionLevel = localApiLevel,
  evidenceLevel = localApiLevel,
  sourceCommit,
  artifacts,
  clientEvidence = null,
}) {
  return {
    executionLevel,
    evidenceLevel,
    sourceGeneration: { kind: 'merge_commit', commit: sourceCommit },
    artifacts: artifacts.map(([path, level]) => ({
      path,
      evidenceLevel: level,
      contentSha256: credentialArtifactDigests[path],
    })),
    clientEvidence:
      clientEvidence?.map(({ sourceId, operations }) => ({
        sourceId,
        operations: [...operations],
      })) ?? null,
  }
}

function clientProvenance(sourceId, operations) {
  return { sourceId, operations }
}

function deepFreeze(value) {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value
  }
  Object.freeze(value)
  for (const nested of Object.values(value)) deepFreeze(nested)
  return value
}

function isMainModule() {
  return (
    typeof process.argv[1] === 'string' &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  )
}

if (isMainModule()) {
  try {
    const registry = loadCredentialEvidenceRegistry()
    const report = validateCredentialEvidenceRegistry(registry)
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(
      `credential evidence verification failed: ${errorMessage(error)}\n`,
    )
    process.exitCode = 1
  }
}

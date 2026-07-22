#!/usr/bin/env node

import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  chmodSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path'
import process from 'node:process'
import { TextDecoder } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { parseTree } from 'jsonc-parser'

import {
  credentialArtifactDigests,
  credentialClaimDigests,
  credentialEvidenceLevels,
  credentialEvidenceSources,
  loadCredentialEvidenceRegistry,
  summarizeCredentialEvidenceLimitations,
} from './honowarden-credential-evidence.mjs'

const scriptPath = fileURLToPath(import.meta.url)
const defaultRepoRoot = resolve(dirname(scriptPath), '..')
const registryRelativePath = 'compat/credential-evidence.json'
const schemaRelativePath = 'compat/credential-evidence.schema.json'
const maximumInputBytes = 1024 * 1024
const utf8Decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const highRiskSecretFieldWords = new Set([
  'password',
  'passwords',
  'token',
  'tokens',
  'secret',
  'secrets',
  'credential',
  'credentials',
  'key',
  'keys',
])
const secretFieldSuffixWords = new Set([
  'hash',
  'hashes',
  'signature',
  'signatures',
  'value',
  'values',
])
const compactSecretFieldPattern =
  /(?:password(?:hash)?|(?:api|access|refresh|auth|id|session|bearer)tokens?|(?:api|client|auth)secrets?|api(?:keys?|credentials?)|(?:auth|client|service)credentials?)(?:hash|signature|value|v[0-9]+)*$/
const vaultCiphertextPartPattern = '[A-Za-z0-9+/_-]{20,}={0,2}'
const vaultCiphertextPattern = new RegExp(
  `(?:^|[^A-Za-z0-9+/_=-])(?:[0347]\\.${vaultCiphertextPartPattern}|[056]\\.${vaultCiphertextPartPattern}\\|${vaultCiphertextPartPattern}|[12]\\.${vaultCiphertextPartPattern}\\|${vaultCiphertextPartPattern}\\|${vaultCiphertextPartPattern})(?=$|[^A-Za-z0-9+/_=|-])`,
)

export const credentialCloseoutPacketPath =
  'compat/credential-closeout-packet.json'

export const credentialCloseoutClaimIds = Object.freeze([
  'account.password.verify.local-api',
  'account.password.change.client-readback',
  'account.kdf.pbkdf2-to-argon2id.client-readback',
  'account.kdf.argon2id-to-pbkdf2.client-readback',
  'account.key.initialize.client-readback',
  'account.key.read.local-api',
  'account.user-key.rotate.client-readback',
  'recovery.backup.export.local-api',
  'recovery.restore.fresh-target.client-readback',
  'recovery.writers.disabled.local-api',
  'recovery.forward-generation.client-readback',
])

export const credentialCloseoutArtifactPaths = Object.freeze([
  '.workflow/hon-207-credential-closeout/results/02-credential-lifecycle.md',
  'docs/release/account-password-change-local-evidence.md',
  'docs/release/account-kdf-change-local-evidence.md',
  'docs/release/account-key-initialization-local-evidence.md',
  'docs/release/user-key-rotation-local-evidence.md',
  '.workflow/hon-207-credential-closeout/results/03a-generation-bound-backup.md',
  '.workflow/hon-207-credential-closeout/results/03b-fresh-restore.md',
  '.workflow/hon-207-credential-closeout/results/03c-disable-forward-recovery.md',
])

const credentialCloseoutSourceDigests = Object.freeze({
  [registryRelativePath]:
    '53192962c66ccd1714d3a9ce6d878d12ed91b31f1d765caef1af4e127e15a169',
  [schemaRelativePath]:
    '1640608cb08c4fdac43d6ac94bfdc4b06e5af6fe10e6c1473a6d459a3f02c32f',
})

const allowedPublicAddresses = new Set([
  'security@honowarden.com',
  'support@honowarden.com',
  'hello@honowarden.com',
  'admin@honowarden.com',
  'postmaster@honowarden.com',
  'abuse@honowarden.com',
])
const reservedIdentityDomains = new Set([
  'example.com',
  'example.net',
  'example.org',
])
const reservedIdentitySuffixes = ['.example', '.invalid', '.localhost', '.test']

export function buildCredentialCloseoutPacket({
  repoRoot = defaultRepoRoot,
  registryPath = resolve(repoRoot, registryRelativePath),
  schemaPath = resolve(repoRoot, schemaRelativePath),
  trackedPaths,
} = {}) {
  const requestedRepoRoot = resolve(repoRoot)
  const canonicalRepoRoot = realpathSync(requestedRepoRoot)
  const canonicalRegistryPath = remapToCanonicalRoot(
    requestedRepoRoot,
    canonicalRepoRoot,
    registryPath,
  )
  const canonicalSchemaPath = remapToCanonicalRoot(
    requestedRepoRoot,
    canonicalRepoRoot,
    schemaPath,
  )
  const tracked =
    trackedPaths === undefined
      ? readTrackedPaths(canonicalRepoRoot)
      : new Set(trackedPaths)
  const registryText = readSafeTrackedText({
    repoRoot: canonicalRepoRoot,
    path: canonicalRegistryPath,
    expectedPath: registryRelativePath,
    expectedSha256: credentialCloseoutSourceDigests[registryRelativePath],
    trackedPaths: tracked,
  })
  const schemaText = readSafeTrackedText({
    repoRoot: canonicalRepoRoot,
    path: canonicalSchemaPath,
    expectedPath: schemaRelativePath,
    expectedSha256: credentialCloseoutSourceDigests[schemaRelativePath],
    trackedPaths: tracked,
  })
  assertCredentialCloseoutContentSafe(registryText)
  assertCredentialCloseoutContentSafe(schemaText)

  const registry = loadCredentialEvidenceRegistry({
    repoRoot: canonicalRepoRoot,
    registryPath: canonicalRegistryPath,
    trackedPaths: [...tracked],
  })
  const actualClaimIds = registry.claims.map((claim) => claim.id)
  if (
    JSON.stringify(actualClaimIds) !==
    JSON.stringify(credentialCloseoutClaimIds)
  ) {
    throw new Error('credential closeout claim set is not canonical')
  }
  const artifactPaths = uniqueArtifactPaths(registry.claims)
  if (
    JSON.stringify(artifactPaths) !==
    JSON.stringify(credentialCloseoutArtifactPaths)
  ) {
    throw new Error('credential closeout artifact set is not canonical')
  }
  if (
    JSON.stringify(Object.keys(credentialArtifactDigests).sort()) !==
    JSON.stringify([...credentialCloseoutArtifactPaths].sort())
  ) {
    throw new Error('credential closeout artifact catalog is inconsistent')
  }

  scanCredentialCloseoutArtifacts({
    repoRoot: canonicalRepoRoot,
    artifactPaths,
    trackedPaths: [...tracked],
  })

  const claims = registry.claims.map((claim) => ({
    id: claim.id,
    status: 'verified',
    executionLevel: claim.executionLevel,
    evidenceLevel: claim.evidenceLevel,
    sourceGeneration: {
      kind: claim.sourceGeneration.kind,
      commit: claim.sourceGeneration.commit,
    },
    artifacts: claim.artifacts.map((artifact) => ({
      path: artifact.path,
      evidenceLevel: artifact.evidenceLevel,
      sha256: artifact.contentSha256,
    })),
    clientSourceIds: (claim.clientEvidence ?? []).map(
      (entry) => entry.sourceId,
    ),
    limitations: [...claim.limitations],
    sha256: requiredClaimDigest(claim.operation),
  }))
  const packet = {
    schemaVersion: 1,
    status: 'verified',
    registry: {
      path: registryRelativePath,
      sha256: credentialCloseoutSourceDigests[registryRelativePath],
      schemaPath: schemaRelativePath,
      schemaSha256: credentialCloseoutSourceDigests[schemaRelativePath],
    },
    sourcePins: {
      programBaseCommit: credentialEvidenceSources.repository.programBaseCommit,
      clients: credentialEvidenceSources.clients.map((source) => ({
        id: source.id,
        surface: source.surface,
        version: source.version,
        sourceRef: source.sourceRef,
        assetSha256: source.assetSha256,
      })),
    },
    evidenceLevels: credentialEvidenceLevels.map((level) => ({
      id: level.id,
      rank: level.rank,
      scope: level.scope,
    })),
    claims,
    counts: {
      evidenceLevels: credentialEvidenceLevels.length,
      clientSources: credentialEvidenceSources.clients.length,
      claims: claims.length,
      artifacts: artifactPaths.length,
      artifactBindings: claims.reduce(
        (count, claim) => count + claim.artifacts.length,
        0,
      ),
      fixtureClaims: countClaimsAtLevel(claims, 'fixture'),
      localApiClaims: countClaimsAtLevel(claims, 'local_api'),
      localOfficialClientClaims: countClaimsAtLevel(
        claims,
        'local_official_client',
      ),
      stagingClaims: countClaimsAtLevel(claims, 'staging'),
      productionClaims: countClaimsAtLevel(claims, 'production'),
    },
    liveEvidenceLevels: ['staging', 'production'].filter((level) =>
      claims.some((claim) => claim.evidenceLevel === level),
    ),
    limitations: summarizeCredentialEvidenceLimitations(registry.claims),
  }
  assertCredentialCloseoutContentSafe(serializeCredentialCloseoutPacket(packet))
  return packet
}

export function scanCredentialCloseoutArtifacts({
  repoRoot = defaultRepoRoot,
  artifactPaths = credentialCloseoutArtifactPaths,
  trackedPaths,
} = {}) {
  if (
    JSON.stringify(artifactPaths) !==
    JSON.stringify(credentialCloseoutArtifactPaths)
  ) {
    throw new Error('credential closeout artifact set is not canonical')
  }
  const canonicalRepoRoot = realpathSync(repoRoot)
  const tracked =
    trackedPaths === undefined
      ? readTrackedPaths(canonicalRepoRoot)
      : new Set(trackedPaths)
  let bytes = 0
  for (const path of artifactPaths) {
    const content = readSafeTrackedText({
      repoRoot: canonicalRepoRoot,
      path: resolve(canonicalRepoRoot, path),
      expectedPath: path,
      trackedPaths: tracked,
    })
    bytes += Buffer.byteLength(content)
    assertCredentialCloseoutContentSafe(content)
  }
  return { artifacts: artifactPaths.length, bytes }
}

export function assertCredentialCloseoutContentSafe(content) {
  if (typeof content !== 'string' || unsafeCredentialCloseoutContent(content)) {
    throw new Error('credential closeout content is unsafe')
  }
}

export function serializeCredentialCloseoutPacket(packet) {
  return `${JSON.stringify(packet, null, 2)}\n`
}

export function sha256CredentialCloseoutText(text) {
  if (typeof text !== 'string') {
    throw new Error('credential closeout text must be a string')
  }
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function verifyCredentialCloseoutPacket({
  repoRoot = defaultRepoRoot,
  registryPath = resolve(repoRoot, registryRelativePath),
  schemaPath = resolve(repoRoot, schemaRelativePath),
  packetPath = resolve(repoRoot, credentialCloseoutPacketPath),
  trackedPaths,
} = {}) {
  const packet = buildCredentialCloseoutPacket({
    repoRoot,
    registryPath,
    schemaPath,
    trackedPaths,
  })
  const expectedText = serializeCredentialCloseoutPacket(packet)
  const actualText = readCanonicalPacketText(repoRoot, packetPath)
  assertCredentialCloseoutContentSafe(actualText)
  parseStrictPacketJson(actualText)
  if (actualText !== expectedText) {
    throw new Error('credential closeout packet is stale or noncanonical')
  }
  return {
    schemaVersion: 1,
    status: 'passed',
    claims: packet.counts.claims,
    artifacts: packet.counts.artifacts,
    scannedInputs: packet.counts.artifacts + 3,
    bytes: Buffer.byteLength(actualText),
    sha256: sha256CredentialCloseoutText(actualText),
    liveEvidenceLevels: [...packet.liveEvidenceLevels],
    limitations: [...packet.limitations],
  }
}

export function writeCredentialCloseoutPacket(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot
  const canonicalRepoRoot = realpathSync(repoRoot)
  const packetPath = resolve(canonicalRepoRoot, credentialCloseoutPacketPath)
  assertCanonicalPacketLocation(canonicalRepoRoot, packetPath)
  assertSafeOutputParent(canonicalRepoRoot, dirname(packetPath))
  try {
    const stat = lstatSync(packetPath)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('credential closeout packet path is unsafe')
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const packet = buildCredentialCloseoutPacket(options)
  const serialized = serializeCredentialCloseoutPacket(packet)
  assertCredentialCloseoutContentSafe(serialized)
  const temporaryPath = resolve(
    dirname(packetPath),
    `.${basename(packetPath)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
  )
  try {
    writeFileSync(temporaryPath, serialized, { flag: 'wx', mode: 0o600 })
    renameSync(temporaryPath, packetPath)
    chmodSync(packetPath, 0o644)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
  return verifyCredentialCloseoutPacket({ ...options, packetPath })
}

function readSafeTrackedText({
  repoRoot,
  path,
  expectedPath,
  expectedSha256,
  trackedPaths,
}) {
  assertCanonicalInputLocation(repoRoot, path, expectedPath)
  if (!trackedPaths.has(expectedPath)) {
    throw new Error('credential closeout input is not tracked')
  }
  assertNoSymlinkComponents(repoRoot, expectedPath)
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('credential closeout input is not a regular file')
  }
  if (stat.size > maximumInputBytes) {
    throw new Error('credential closeout input exceeds the size limit')
  }
  const resolvedPath = realpathSync(path)
  if (!isWithin(repoRoot, resolvedPath)) {
    throw new Error('credential closeout input resolves outside the repository')
  }
  const bytes = canonicalizeTextBytes(readFileSync(resolvedPath))
  if (expectedSha256 !== undefined && sha256Bytes(bytes) !== expectedSha256) {
    throw new Error('credential closeout source digest mismatch')
  }
  try {
    return utf8Decoder.decode(bytes)
  } catch {
    throw new Error('credential closeout input is not UTF-8 text')
  }
}

function readCanonicalPacketText(repoRoot, packetPath) {
  const requestedRepoRoot = resolve(repoRoot)
  const canonicalRepoRoot = realpathSync(requestedRepoRoot)
  const canonicalPacketPath = remapToCanonicalRoot(
    requestedRepoRoot,
    canonicalRepoRoot,
    packetPath,
  )
  assertCanonicalPacketLocation(canonicalRepoRoot, canonicalPacketPath)
  try {
    assertNoSymlinkComponents(canonicalRepoRoot, credentialCloseoutPacketPath)
    const stat = lstatSync(canonicalPacketPath)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('credential closeout packet path is unsafe')
    }
    if (stat.size > maximumInputBytes) {
      throw new Error('credential closeout packet exceeds the size limit')
    }
    const resolvedPath = realpathSync(canonicalPacketPath)
    if (!isWithin(canonicalRepoRoot, resolvedPath)) {
      throw new Error('credential closeout packet path is unsafe')
    }
    return utf8Decoder.decode(canonicalizeTextBytes(readFileSync(resolvedPath)))
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('unsupported line endings') ||
        error.message.includes('exceeds the size limit'))
    ) {
      throw error
    }
    throw new Error('credential closeout packet path is unsafe', {
      cause: error,
    })
  }
}

function parseStrictPacketJson(text) {
  const errors = []
  const tree = parseTree(text, errors, {
    allowEmptyContent: false,
    allowTrailingComma: false,
    disallowComments: true,
  })
  if (!tree || errors.length > 0) {
    throw new Error('credential closeout packet JSON is invalid')
  }
  try {
    assertNoDuplicateJsonObjectKeys(tree)
    JSON.parse(text)
  } catch {
    throw new Error('credential closeout packet JSON is invalid')
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
      valueNode === undefined ||
      keys.has(keyNode.value)
    ) {
      throw new Error('duplicate or invalid packet object key')
    }
    keys.add(keyNode.value)
    assertNoDuplicateJsonObjectKeys(valueNode)
  }
}

function unsafeCredentialCloseoutContent(content) {
  if (hasSecretLikeJsonField(content)) return true
  if (hasSecretLikeAssignment(content)) return true
  if (hasEmbeddedSecretLikePair(content)) return true
  if (
    /\bAuthorization["'`]?\s*[:=]\s*["'`]?\s*(?:Bearer|Basic)\s+(?!<?redacted>?\b|\[redacted\]\b)\S+/i.test(
      content,
    )
  ) {
    return true
  }
  if (
    /-----BEGIN (?:PGP PRIVATE KEY BLOCK|(?:(?:RSA|EC|DSA|OPENSSH|ENCRYPTED) )?PRIVATE KEY)-----/i.test(
      content,
    )
  ) {
    return true
  }
  if (
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/.test(
      content,
    )
  ) {
    return true
  }
  if (vaultCiphertextPattern.test(content)) {
    return true
  }
  for (const match of content.matchAll(
    /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi,
  )) {
    const address = match[0].toLowerCase()
    const domain = match[1]?.toLowerCase()
    if (domain && !isAllowedIdentity(address, domain)) return true
  }
  return false
}

function hasSecretLikeJsonField(content) {
  for (const match of content.matchAll(/("(?:\\.|[^"\\])*")\s*:/g)) {
    let name
    try {
      name = JSON.parse(match[1])
    } catch {
      continue
    }
    if (typeof name === 'string' && isSecretLikeFieldName(name)) return true
  }
  return false
}

function hasSecretLikeAssignment(content) {
  const pattern =
    /^[ \t]*(?:(?:[-*+>]|[0-9]+[.)])[ \t]+)*(?:\[[ xX]\][ \t]+)?(?:\$[ \t]+)?(?:export[ \t]+)?`?([A-Za-z][A-Za-z0-9_. -]{0,80})`?\s*[:=]\s*(\S.*)$/gm
  for (const match of content.matchAll(pattern)) {
    if (
      isSecretLikeFieldName(match[1] ?? '') &&
      !isEmptySecretSentinel(match[2] ?? '')
    ) {
      return true
    }
  }
  return false
}

function hasEmbeddedSecretLikePair(content) {
  // Overlapping matches keep an outer field from hiding a nested pair. The
  // bounded value prefix prevents repeated delimiters from causing quadratic
  // scans across the remainder of a maximum-sized line.
  const pairPattern =
    /(?=(?:^|[?&;,\s>{|=])(["'`]?)([A-Za-z][A-Za-z0-9_. -]{0,80})\1\s*[:=]\s*([^\r\n]{1,256}))/gm
  for (const match of content.matchAll(pairPattern)) {
    if (
      isSecretLikeFieldName(match[2] ?? '') &&
      !isEmptySecretSentinel(match[3] ?? '')
    ) {
      return true
    }
  }
  return false
}

function isSecretLikeFieldName(value) {
  const words = fieldWords(value)
  const normalized = words.join('')
  const last = words.at(-1) ?? ''
  if (
    hasHighRiskSecretWordSequence(words) ||
    compactSecretFieldPattern.test(normalized) ||
    ['identity', 'identities', 'profile', 'profiles'].includes(last)
  ) {
    return true
  }
  if (
    normalized.includes('cipherstring') ||
    normalized.includes('encrypteditem') ||
    normalized.includes('encryptedbody') ||
    normalized.includes('encryptedpayload')
  ) {
    return true
  }
  const wordSet = new Set(words)
  if (
    wordSet.has('provider') &&
    ['payload', 'request', 'response', 'body', 'data'].some((word) =>
      wordSet.has(word),
    )
  ) {
    return true
  }
  return (
    wordSet.has('raw') &&
    ['payload', 'request', 'response', 'body'].some((word) => wordSet.has(word))
  )
}

function hasHighRiskSecretWordSequence(words) {
  return words.some(
    (word, index) =>
      highRiskSecretFieldWords.has(word) &&
      words
        .slice(index + 1)
        .every(
          (suffix) =>
            secretFieldSuffixWords.has(suffix) || /^v[0-9]+$/.test(suffix),
        ),
  )
}

function fieldWords(value) {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
}

function isEmptySecretSentinel(value) {
  let normalized = value.trim()
  const quote = normalized[0]
  if (
    normalized.length >= 2 &&
    ['"', "'", '`'].includes(quote) &&
    normalized.at(-1) === quote
  ) {
    normalized = normalized.slice(1, -1).trim()
  }
  return [
    '0',
    'none',
    'null',
    'false',
    'redacted',
    '<redacted>',
    '[redacted]',
    'passed',
    'failed',
    'rejected',
    'unchanged',
    'disabled',
  ].includes(normalized.toLowerCase())
}

function isAllowedIdentity(address, domain) {
  if (allowedPublicAddresses.has(address)) return true
  if (
    [...reservedIdentityDomains].some(
      (reserved) => domain === reserved || domain.endsWith(`.${reserved}`),
    )
  ) {
    return true
  }
  return reservedIdentitySuffixes.some((suffix) => domain.endsWith(suffix))
}

function canonicalizeTextBytes(value) {
  const canonical = Buffer.allocUnsafe(value.length)
  let writeIndex = 0
  for (let readIndex = 0; readIndex < value.length; readIndex += 1) {
    const byte = value[readIndex]
    if (byte !== 0x0d) {
      canonical[writeIndex] = byte
      writeIndex += 1
      continue
    }
    if (value[readIndex + 1] !== 0x0a) {
      throw new Error(
        'credential closeout input contains unsupported line endings',
      )
    }
    canonical[writeIndex] = 0x0a
    writeIndex += 1
    readIndex += 1
  }
  return canonical.subarray(0, writeIndex)
}

function readTrackedPaths(repoRoot) {
  const output = execFileSync('git', ['-C', repoRoot, 'ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  return new Set(output.split('\0').filter(Boolean))
}

function assertCanonicalInputLocation(repoRoot, path, expectedPath) {
  if (!isCanonicalRepoPath(expectedPath)) {
    throw new Error('credential closeout input path is not canonical')
  }
  const actualRelative = toPosix(relative(repoRoot, resolve(path)))
  if (actualRelative !== expectedPath) {
    throw new Error('credential closeout input path is not canonical')
  }
}

function assertCanonicalPacketLocation(repoRoot, packetPath) {
  const actualRelative = toPosix(relative(repoRoot, resolve(packetPath)))
  if (actualRelative !== credentialCloseoutPacketPath) {
    throw new Error('credential closeout packet path is unsafe')
  }
}

function assertSafeOutputParent(repoRoot, outputParent) {
  const resolvedParent = realpathSync(outputParent)
  if (!isWithin(repoRoot, resolvedParent)) {
    throw new Error('credential closeout packet path is unsafe')
  }
  const relativeParent = toPosix(relative(repoRoot, resolvedParent))
  assertNoSymlinkComponents(repoRoot, relativeParent)
  if (!statSync(resolvedParent).isDirectory()) {
    throw new Error('credential closeout packet path is unsafe')
  }
}

function assertNoSymlinkComponents(repoRoot, path) {
  let current = repoRoot
  for (const part of path.split('/')) {
    if (!part) continue
    current = resolve(current, part)
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error('credential closeout path contains a symlink')
    }
  }
}

function isCanonicalRepoPath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !isAbsolute(value) &&
    !value.includes('\\') &&
    /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(value) &&
    !value.split('/').some((part) => part === '.' || part === '..')
  )
}

function isWithin(root, candidate) {
  const path = relative(root, candidate)
  return (
    path === '' ||
    (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  )
}

function uniqueArtifactPaths(claims) {
  return [
    ...new Set(
      claims.flatMap((claim) =>
        claim.artifacts.map((artifact) => artifact.path),
      ),
    ),
  ]
}

function countClaimsAtLevel(claims, level) {
  return claims.filter((claim) => claim.evidenceLevel === level).length
}

function requiredClaimDigest(operation) {
  const digest = credentialClaimDigests[operation]
  if (!digest) throw new Error('credential closeout claim digest is missing')
  return digest
}

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex')
}

function toPosix(value) {
  return value.replaceAll('\\', '/')
}

function remapToCanonicalRoot(requestedRoot, canonicalRoot, path) {
  const resolvedPath = resolve(path)
  if (isWithin(canonicalRoot, resolvedPath)) return resolvedPath
  return resolve(canonicalRoot, relative(requestedRoot, resolvedPath))
}

function isMainModule() {
  return (
    typeof process.argv[1] === 'string' &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  )
}

if (isMainModule()) {
  try {
    const args = process.argv.slice(2).filter((argument) => argument !== '--')
    let report
    if (args.length === 0 || (args.length === 1 && args[0] === 'verify')) {
      report = verifyCredentialCloseoutPacket()
    } else if (args.length === 1 && args[0] === 'write') {
      report = writeCredentialCloseoutPacket()
    } else {
      throw new Error('unsupported credential closeout command')
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } catch {
    process.stderr.write('credential closeout verification failed\n')
    process.exitCode = 1
  }
}

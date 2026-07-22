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
import { fileURLToPath, pathToFileURL, URL } from 'node:url'

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
  'candidate',
  'hash',
  'hashes',
  'signature',
  'signatures',
  'value',
  'values',
  'plaintext',
  'material',
  'blob',
  'clear',
  'raw',
  'bearer',
  'old',
  'new',
  'current',
  'previous',
  'confirmation',
  'confirm',
  'copy',
  'repeat',
  'original',
  'proposed',
])
const compactSecretFieldSuffixPattern = `(?:${[...secretFieldSuffixWords].join(
  '|',
)}|v[0-9]+)`
const compactSecretFieldPattern = new RegExp(
  `(?:password(?:hash)?|(?:api|access|refresh|auth|id|session|bearer)tokens?|(?:api|client|auth)secrets?|api(?:keys?|credentials?)|(?:auth|client|service)credentials?)(?:${compactSecretFieldSuffixPattern})*$|^(?:passwords?|tokens?|secrets?|credentials?|keys?)(?:${compactSecretFieldSuffixPattern})+$`,
)
const recoverySecretFieldPattern = new RegExp(
  `^(?:seedphrases?|mnemonics?|recoverycodes?|totpseeds?|salts?)(?:${compactSecretFieldSuffixPattern})*$`,
)
const emptyAuthorizationSchemes = new Set([
  'basic',
  'bearer',
  'digest',
  'negotiate',
  'token',
])
const emptyAuthorizationAnnotations = new Set([
  'disabled',
  'expired',
  'omitted',
  'removed',
  'revoked',
  'rotated',
])
const authenticationCookieNames = new Set(
  [
    'access-token',
    'auth',
    'auth-token',
    'connect.sid',
    'jsessionid',
    'jwt',
    'phpsessid',
    'refresh-token',
    'session',
    'sessionid',
    'sid',
    'token',
  ].map(normalizeCookieName),
)
const identityTokenBoundaryCharacters = new Set([
  '"',
  "'",
  '`',
  '(',
  ')',
  '<',
  '>',
  '[',
  ']',
  '{',
  '}',
  ',',
  ':',
  ';',
  '|',
  '、',
  '。',
  '：',
  '（',
  '）',
  '「',
  '」',
  '【',
  '】',
])
const urlAuthorityBoundaryCharacters = new Set([
  '/',
  '\\',
  '?',
  '#',
  '<',
  '>',
  '"',
  "'",
  '`',
])
const vaultCiphertextPartPattern = '[A-Za-z0-9+/_-]{20,}={0,2}'
const vaultCiphertextPattern = new RegExp(
  `(?:^|[^A-Za-z0-9+/_=-])(?:[347]\\.${vaultCiphertextPartPattern}|[056]\\.${vaultCiphertextPartPattern}\\|${vaultCiphertextPartPattern}|[12]\\.${vaultCiphertextPartPattern}\\|${vaultCiphertextPartPattern}\\|${vaultCiphertextPartPattern})(?=$|[^A-Za-z0-9+/_=|-])`,
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
  const tracked = requiredCredentialCloseoutTrackedPaths(repoRoot, trackedPaths)
  const packet = buildCredentialCloseoutPacket({
    repoRoot,
    registryPath,
    schemaPath,
    trackedPaths: [...tracked],
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
  const tracked = requiredCredentialCloseoutTrackedPaths(
    canonicalRepoRoot,
    options.trackedPaths,
  )
  try {
    const stat = lstatSync(packetPath)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('credential closeout packet path is unsafe')
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const packet = buildCredentialCloseoutPacket({
    ...options,
    trackedPaths: [...tracked],
  })
  const serialized = serializeCredentialCloseoutPacket(packet)
  assertCredentialCloseoutContentSafe(serialized)
  const packetByteLimit = requiredPacketByteLimit(options.packetByteLimit)
  if (Buffer.byteLength(serialized) > packetByteLimit) {
    throw new Error('credential closeout packet exceeds the size limit')
  }
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
  if (hasMarkdownSecretLikePair(content)) return true
  if (hasSecretLikeAssignment(content)) return true
  if (hasEmbeddedSecretLikePair(content)) return true
  if (hasAuthorizationCredential(content)) return true
  if (hasAuthenticationCookie(content)) return true
  if (hasOpaqueAccessToken(content)) return true
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
  if (hasUrlUserInfo(content)) return true
  if (hasDisallowedJsonStringIdentity(content)) return true
  if (hasDisallowedEncodedIdentity(content)) return true
  return hasDisallowedIdentity(content)
}

function hasUrlUserInfo(content) {
  let separatorIndex = content.indexOf('//')
  while (separatorIndex !== -1) {
    let authorityEnd = separatorIndex + 2
    while (
      authorityEnd < content.length &&
      isUrlAuthorityCharacter(content[authorityEnd])
    ) {
      authorityEnd += 1
    }
    const authority = content.slice(separatorIndex + 2, authorityEnd)
    const atIndex = authority.lastIndexOf('@')
    if (atIndex !== -1) {
      try {
        const url = new URL(`https://${authority}`)
        if (url.username || url.password) return true
      } catch {
        if (atIndex > 0) return true
      }
    }
    const nextIndex = Math.max(separatorIndex + 2, authorityEnd)
    separatorIndex = content.indexOf('//', nextIndex)
  }
  return false
}

function isUrlAuthorityCharacter(character) {
  return (
    character !== undefined &&
    !/\s/u.test(character) &&
    !urlAuthorityBoundaryCharacters.has(character)
  )
}

function hasDisallowedJsonStringIdentity(content) {
  for (const match of content.matchAll(/"(?:\\.|[^"\\])*"/g)) {
    if (!(match[0] ?? '').includes('\\')) continue
    try {
      const decoded = JSON.parse(match[0] ?? '')
      if (typeof decoded === 'string' && hasDisallowedIdentity(decoded)) {
        return true
      }
    } catch {
      continue
    }
  }
  return false
}

function hasDisallowedEncodedIdentity(content) {
  const decoded = content.replace(
    /\\u0*040|\\x40|&#0*64;|&#x0*40;|&commat;|%40|\\@/gi,
    '@',
  )
  return decoded !== content && hasDisallowedIdentity(decoded)
}

function hasDisallowedIdentity(content) {
  if (hasDisallowedDecoratedIdentity(content)) return true

  let atIndex = content.indexOf('@')
  while (atIndex !== -1) {
    let start = atIndex
    while (start > 0 && isEmailLocalCharacter(content.charCodeAt(start - 1))) {
      start -= 1
    }
    if (hasNonAsciiIdentityCandidate(content, atIndex)) return true

    if (start < atIndex && hasAddressLiteralDomain(content, atIndex))
      return true

    let end = atIndex + 1
    while (
      end < content.length &&
      isEmailDomainCharacter(content.charCodeAt(end))
    ) {
      end += 1
    }

    while (end > atIndex + 1 && content[end - 1] === '.') end -= 1
    if (start === atIndex || end === atIndex + 1) {
      atIndex = content.indexOf('@', atIndex + 1)
      continue
    }

    const candidate = content.slice(start, end)
    if (isVersionSourceReference(candidate)) {
      atIndex = content.indexOf('@', atIndex + 1)
      continue
    }
    const match = /^([A-Z0-9._%+-]+)@([A-Z0-9.-]+\.[A-Z]{2,})$/i.exec(candidate)
    const address = match?.[0].toLowerCase()
    const domain = match?.[2].toLowerCase()
    if (address && domain && !isAllowedIdentity(address, domain)) return true
    if (!address) return true

    atIndex = content.indexOf('@', atIndex + 1)
  }
  return false
}

function hasDisallowedDecoratedIdentity(content) {
  for (const match of content.matchAll(/("(?:\\.|[^"\\\r\n]){1,128}")@/g)) {
    let local
    try {
      local = JSON.parse(match[1] ?? '')
    } catch {
      return true
    }
    const atIndex = (match.index ?? 0) + (match[0]?.length ?? 1) - 1
    if (isDisallowedDecoratedAddress(content, atIndex, local)) return true
  }

  const commentedLocalPattern =
    /([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64})\((?:\\.|[^()\r\n]){1,128}\)@/g
  for (const match of content.matchAll(commentedLocalPattern)) {
    const atIndex = (match.index ?? 0) + (match[0]?.length ?? 1) - 1
    if (isDisallowedDecoratedAddress(content, atIndex, match[1] ?? '')) {
      return true
    }
  }
  return false
}

function isDisallowedDecoratedAddress(content, atIndex, local) {
  if (!local) return false
  if (hasAddressLiteralDomain(content, atIndex)) return true

  let end = atIndex + 1
  while (end < content.length && isIdentityTokenCharacter(content[end])) {
    end += 1
  }
  while (end > atIndex + 1 && content[end - 1] === '.') end -= 1
  const domain = content.slice(atIndex + 1, end)
  if (!domain) return false
  if (containsNonAscii(domain)) return true
  if (!/^[A-Za-z0-9.-]+$/.test(domain)) return true

  const normalizedDomain = domain.toLowerCase()
  const normalizedAddress = `${local}@${normalizedDomain}`.toLowerCase()
  return !isAllowedIdentity(normalizedAddress, normalizedDomain)
}

function hasAddressLiteralDomain(content, atIndex) {
  return /^\[(?:IPv6:)?[0-9A-Fa-f:.]+\]/i.test(
    content.slice(atIndex + 1, atIndex + 82),
  )
}

function isVersionSourceReference(value) {
  return /^(?:[A-Za-z0-9._-]+-)?v[0-9]+(?:\.[0-9]+)+@[0-9a-f]{40}$/i.test(value)
}

function hasNonAsciiIdentityCandidate(content, atIndex) {
  let start = atIndex
  while (start > 0 && isIdentityTokenCharacter(content[start - 1])) {
    start -= 1
  }
  let end = atIndex + 1
  while (end < content.length && isIdentityTokenCharacter(content[end])) {
    end += 1
  }

  const local = content.slice(start, atIndex)
  const domain = content.slice(atIndex + 1, end)
  if (!local || !domain) return false
  const hasNonAscii = containsNonAscii(local) || containsNonAscii(domain)
  return hasNonAscii
}

function isIdentityTokenCharacter(character) {
  return (
    character !== undefined &&
    character !== '@' &&
    !/\s/u.test(character) &&
    !identityTokenBoundaryCharacters.has(character)
  )
}

function containsNonAscii(value) {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) return true
  }
  return false
}

function isAsciiWordCharacter(code) {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    code === 95 ||
    (code >= 97 && code <= 122)
  )
}

function isEmailLocalCharacter(code) {
  return (
    isAsciiWordCharacter(code) ||
    code === 37 ||
    code === 43 ||
    code === 45 ||
    code === 46
  )
}

function isEmailDomainCharacter(code) {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    code === 45 ||
    code === 46 ||
    (code >= 97 && code <= 122)
  )
}

function hasSecretLikeJsonField(content) {
  for (const match of content.matchAll(/("(?:\\.|[^"\\])*")\s*:/g)) {
    let name
    try {
      name = JSON.parse(match[1])
    } catch {
      continue
    }
    if (typeof name !== 'string') continue
    const secretLike = isSecretLikeJsonFieldName(name)
    const cookieHeader = isCookieHeaderFieldName(name)
    if (!secretLike && !cookieHeader) continue
    const scalar = readBoundedJsonScalar(
      content,
      (match.index ?? 0) + match[0].length,
    )
    if (cookieHeader) {
      if (
        scalar === undefined ||
        hasUnsafeAuthenticationCookieValue(name, scalar)
      ) {
        return true
      }
      continue
    }
    if (scalar !== undefined && isApprovedNonSecretSummary(name, scalar)) {
      continue
    }
    return true
  }
  return false
}

function isSecretLikeJsonFieldName(value) {
  return (
    isSecretLikeFieldName(value) ||
    fieldWords(value).some((word) => highRiskSecretFieldWords.has(word))
  )
}

function readBoundedJsonScalar(content, valueIndex) {
  while (/\s/u.test(content[valueIndex] ?? '')) valueIndex += 1
  const candidate = content.slice(valueIndex, valueIndex + 512)
  const match =
    /^(?:"(?:\\.|[^"\\])*"|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null)/.exec(
      candidate,
    )
  if (!match) return undefined
  const trailing = content[valueIndex + match[0].length]
  if (trailing !== undefined && !/[\s,}\]]/u.test(trailing)) return undefined
  try {
    const value = JSON.parse(match[0])
    return value === null ? 'null' : String(value)
  } catch {
    return undefined
  }
}

function hasAuthorizationCredential(content) {
  const pattern =
    /(?:^|[^A-Za-z0-9_])(?:(?:[A-Za-z][A-Za-z0-9]*_)+)?Authorization["'`]?\s*[:=]\s*([^\r\n]+)/gim
  for (const match of content.matchAll(pattern)) {
    if (
      isWrappedMarkdownAuthorization(
        content,
        match.index ?? 0,
        match[0] ?? '',
        match[1] ?? '',
      )
    ) {
      continue
    }
    if (!isEmptyAuthorizationCredential(match[1] ?? '')) return true
  }
  return false
}

function isWrappedMarkdownAuthorization(content, matchIndex, rawMatch, value) {
  const fieldOffset = rawMatch.search(/authorization/i)
  if (fieldOffset === -1) return false
  const fieldIndex = matchIndex + fieldOffset
  const lineStart = content.lastIndexOf('\n', matchIndex - 1) + 1
  const prefix = content.slice(lineStart, fieldIndex).trimEnd()
  const normalizedValue = value.trimStart()

  for (const wrapper of ['**', '__', '~~', '*', '_', '`']) {
    if (
      prefix.endsWith(wrapper) &&
      normalizedValue.startsWith(wrapper) &&
      isMarkdownFieldPrefix(prefix.slice(0, -wrapper.length).trim())
    ) {
      return true
    }
  }

  const html = /<(strong|b)>$/i.exec(prefix)
  return Boolean(
    html &&
    normalizedValue.toLowerCase().startsWith(`</${html[1].toLowerCase()}>`) &&
    isMarkdownFieldPrefix(prefix.slice(0, -(html[0]?.length ?? 0)).trim()),
  )
}

function isMarkdownFieldPrefix(value) {
  return (
    value === '' ||
    /^(?:#{1,6}|(?:[-*+>]|[0-9]+[.)])(?:[ \t]+\[[ xX]\])?)$/.test(value)
  )
}

function hasAuthenticationCookie(content) {
  const pattern =
    /(?:^|[\r\n])[ \t]*(?:(?:[-*+>]|[0-9]+[.)])[ \t]+)*(Set-Cookie|Cookie)[ \t]*:[ \t]*([^\r\n]*)/gim
  for (const match of content.matchAll(pattern)) {
    if (hasUnsafeAuthenticationCookieValue(match[1] ?? '', match[2] ?? '')) {
      return true
    }
  }
  return false
}

function hasUnsafeAuthenticationCookieValue(headerName, headerValue) {
  const pairs = headerValue.split(';')
  const relevantPairs =
    headerName.trim().toLowerCase() === 'set-cookie' ? pairs.slice(0, 1) : pairs
  for (const pair of relevantPairs) {
    const separator = pair.indexOf('=')
    if (separator <= 0) continue
    const name = normalizeCookieName(pair.slice(0, separator))
    if (!authenticationCookieNames.has(name)) continue
    const value = pair.slice(separator + 1).trim()
    if (value && !isRedactedSecretSentinel(value)) return true
  }
  return false
}

function normalizeCookieName(value) {
  return value
    .trim()
    .replace(/^__(?:Host|Secure)-/i, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase()
}

function hasOpaqueAccessToken(content) {
  return /(?:^|[^A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,}|xox[baprs]-[A-Za-z0-9-]{20,})(?=$|[^A-Za-z0-9_-])/m.test(
    content,
  )
}

function isEmptyAuthorizationCredential(value) {
  let normalized = value.trim()
  const quote = normalized[0]
  if (
    normalized.length >= 2 &&
    ['"', "'", '`'].includes(quote) &&
    normalized.at(-1) === quote
  ) {
    normalized = normalized.slice(1, -1).trim()
  }
  if (isRedactedSecretSentinelWithAnnotation(normalized)) return true

  const separator = normalized.search(/\s/)
  if (separator === -1) {
    return emptyAuthorizationSchemes.has(normalized.toLowerCase())
  }
  if (separator <= 0) return false

  return isRedactedSecretSentinelWithAnnotation(
    normalized.slice(separator + 1).trim(),
  )
}

function isRedactedSecretSentinelWithAnnotation(value) {
  if (isRedactedSecretSentinel(value)) return true
  const annotated = /^(.*?)[ \t]+\(([^()\r\n]+)\)$/.exec(value)
  return Boolean(
    annotated &&
    isRedactedSecretSentinel(annotated[1] ?? '') &&
    emptyAuthorizationAnnotations.has(
      (annotated[2] ?? '').trim().toLowerCase(),
    ),
  )
}

function hasMarkdownSecretLikePair(content) {
  const patterns = [
    {
      pattern:
        /(?=(?:^|[|;,>\s])(?:#{1,6}[ \t]+)?(?:(?:[-*+>]|[0-9]+[.)])[ \t]+)?(?:\[[ xX]\][ \t]+)?(\*\*|__|~~|\*|_|`)[ \t]*([A-Za-z][A-Za-z0-9_. ()[\]/-]{0,80})[ \t]*(?:\1\s*[:=]|[:=]\s*\1)\s*([^\r\n]{1,256}))/gm,
      fieldIndex: 2,
      valueIndex: 3,
    },
    {
      pattern:
        /(?=(?:^|[|;,>\s])(?:#{1,6}[ \t]+)?(?:(?:[-*+>]|[0-9]+[.)])[ \t]+)?<(strong|b)>[ \t]*([A-Za-z][A-Za-z0-9_. ()[\]/-]{0,80})[ \t]*(?:<\/\1>\s*[:=]|[:=]\s*<\/\1>)\s*([^\r\n]{1,256}))/gim,
      fieldIndex: 2,
      valueIndex: 3,
    },
  ]

  for (const { pattern, fieldIndex, valueIndex } of patterns) {
    for (const match of content.matchAll(pattern)) {
      const field = match[fieldIndex] ?? ''
      const value = match[valueIndex] ?? ''
      if (isUnsafeMarkdownPair(field, value)) return true
    }
  }
  return hasMarkdownTableSecretLikePair(content)
}

function hasMarkdownTableSecretLikePair(content) {
  if (!content.includes('|')) return false
  const lines = content.split('\n')
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    const trimmed = line.trim()
    const hasOuterPipe = trimmed.startsWith('|') || trimmed.endsWith('|')
    if (hasOuterPipe && hasUnsafeMarkdownTableRow(line)) return true

    if (
      !line.includes('|') ||
      !isMarkdownTableDelimiter(lines[lineIndex + 1] ?? '')
    ) {
      continue
    }

    if (hasUnsafeMarkdownTableRow(line)) return true
    lineIndex += 1
    while (
      lineIndex + 1 < lines.length &&
      isMarkdownTableDataRow(lines[lineIndex + 1])
    ) {
      lineIndex += 1
      if (hasUnsafeMarkdownTableRow(lines[lineIndex])) return true
    }
  }
  return false
}

function hasUnsafeMarkdownTableRow(line) {
  const cells = markdownTableCells(line)
  for (let index = 0; index + 1 < cells.length; index += 1) {
    const field = unwrapMarkdownField(cells[index] ?? '')
    const value = (cells[index + 1] ?? '').trim()
    if (isUnsafeMarkdownPair(field, value)) return true
  }
  return false
}

function markdownTableCells(line) {
  const trimmed = line.trim()
  const cells = trimmed.split('|')
  if (trimmed.startsWith('|')) cells.shift()
  if (trimmed.endsWith('|')) cells.pop()
  return cells
}

function isMarkdownTableDelimiter(line) {
  const cells = markdownTableCells(line)
  return (
    cells.length >= 2 && cells.every((cell) => /^:?-+:?$/.test(cell.trim()))
  )
}

function isMarkdownTableDataRow(line) {
  const trimmed = line.trim()
  return trimmed.length > 0 && trimmed.includes('|')
}

function isUnsafeMarkdownPair(field, value) {
  if (isAuthorizationFieldName(field)) {
    return !isEmptyAuthorizationCredential(value)
  }
  if (isCookieHeaderFieldName(field)) {
    return hasUnsafeAuthenticationCookieValue(field, value)
  }
  return isSecretLikeFieldName(field) && !isSafeSecretLikePair(field, value)
}

function isAuthorizationFieldName(value) {
  return /^(?:(?:[A-Za-z][A-Za-z0-9]*)_)*Authorization$/i.test(value.trim())
}

function isCookieHeaderFieldName(value) {
  return fieldWords(value).at(-1) === 'cookie'
}

function unwrapMarkdownField(value) {
  let normalized = value.trim()
  for (const wrapper of ['**', '__', '~~', '*', '_', '`']) {
    if (
      normalized.length > wrapper.length * 2 &&
      normalized.startsWith(wrapper) &&
      normalized.endsWith(wrapper)
    ) {
      normalized = normalized.slice(wrapper.length, -wrapper.length).trim()
      break
    }
  }
  const html = /^<(strong|b)>[ \t]*(.*?)[ \t]*<\/\1>$/i.exec(normalized)
  return html?.[2] ?? normalized
}

function hasSecretLikeAssignment(content) {
  const pattern =
    /^[ \t]*(?:(?:[-*+>]|[0-9]+[.)])[ \t]+)*(?:\[[ xX]\][ \t]+)?(?:\$[ \t]+)?(?:export[ \t]+)?`?([A-Za-z][A-Za-z0-9_. ()[\]/-]{0,80})`?\s*[:=]\s*(\S.*)$/gm
  for (const match of content.matchAll(pattern)) {
    if (
      isSecretLikeFieldName(match[1] ?? '') &&
      !isSafeSecretLikePair(match[1] ?? '', match[2] ?? '')
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
    /(?=(?:^|\[|[?&;,\s>{|=])(["'`]?)([A-Za-z][A-Za-z0-9_. ()[\]/-]{0,80})\1\s*([:=])\s*([^\r\n]{1,256}))/gm
  for (const match of content.matchAll(pairPattern)) {
    const field = match[2] ?? ''
    const value = match[4] ?? ''
    if (match[1] === '"' && match[3] === ':') continue
    if (isWrappedHtmlPair(content, match.index ?? 0, value)) continue
    const secretLike = isSecretLikeFieldName(field)
    if (
      isUnsafeMarkdownPair(field, value) &&
      !(
        secretLike &&
        isApprovedNestedNonSecretSummary(
          content,
          match.index ?? 0,
          field,
          value,
        )
      )
    ) {
      return true
    }
  }
  return false
}

function isWrappedHtmlPair(content, matchIndex, value) {
  const prefix = content.slice(Math.max(0, matchIndex - 16), matchIndex + 1)
  const tag = /<(strong|b)>$/i.exec(prefix)
  return Boolean(
    tag &&
    value.trimStart().toLowerCase().startsWith(`</${tag[1].toLowerCase()}>`),
  )
}

function isSecretLikeFieldName(value) {
  const unqualifiedValue = removeFieldQualifiers(value)
  const words = fieldWords(unqualifiedValue)
  const normalized = words.join('')
  const last = words.at(-1) ?? ''
  if (
    (isStructuredFieldIdentifier(unqualifiedValue) &&
      (words.some((word) => highRiskSecretFieldWords.has(word)) ||
        hasCompactStructuredSecretMarker(normalized))) ||
    hasHighRiskSecretWordSequence(words) ||
    compactSecretFieldPattern.test(normalized) ||
    recoverySecretFieldPattern.test(normalized) ||
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

function removeFieldQualifiers(value) {
  let normalized = value.trim()
  for (let index = 0; index < 4; index += 1) {
    const previous = normalized
    normalized = normalized
      .replace(/[ \t]*(?:\([^()\r\n]{1,40}\)|\[[^[\]\r\n]{1,40}\])[ \t]*$/, '')
      .replace(/[ \t]*\/[ \t]*[A-Za-z0-9_.-]{1,40}[ \t]*$/, '')
      .trim()
    if (normalized === previous) break
  }
  return normalized
}

function isStructuredFieldIdentifier(value) {
  return /^[A-Za-z][A-Za-z0-9_.-]*$/.test(value.trim())
}

function hasCompactStructuredSecretMarker(value) {
  return /(?:password|accesstoken|refreshtoken|authtoken|sessiontoken|bearertoken|apikey|wrappedkey|unwrappedkey|clientsecret|authsecret|servicecredential|seedphrase|mnemonic|recoverycode|totpseed|salt)/.test(
    value,
  )
}

function hasHighRiskSecretWordSequence(words) {
  let suffixesOnly = true
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const word = words[index]
    if (highRiskSecretFieldWords.has(word) && suffixesOnly) return true
    if (!secretFieldSuffixWords.has(word) && !/^v[0-9]+$/.test(word)) {
      suffixesOnly = false
    }
  }
  return false
}

function fieldWords(value) {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
}

function isSafeSecretLikePair(field, value) {
  return (
    isRedactedSecretSentinel(value) || isApprovedNonSecretSummary(field, value)
  )
}

function isApprovedNonSecretSummary(field, value) {
  const normalizedField = fieldWords(field).join('')
  const normalizedValue = normalizeQuotedScalar(value)
  return (
    (normalizedField === 'realsecrets' &&
      ['0', 'none'].includes(normalizedValue)) ||
    (normalizedField === 'stalepasswordaccessrefreshprofile' &&
      /^[0-9]+ each before restart; [0-9]+ each after restart$/.test(
        normalizedValue,
      )) ||
    (normalizedField === 'passwordpolicy' &&
      /^minimum [0-9]+ characters$/.test(normalizedValue)) ||
    (normalizedField === 'accesstokencount' &&
      /^[0-9]+$/.test(normalizedValue)) ||
    (normalizedField === 'credentialproof' && normalizedValue === 'passed') ||
    (normalizedField === 'keydigest' &&
      /^sha256:[0-9a-f]{64}$/.test(normalizedValue)) ||
    ([
      'honowardenaccountkeysenabled',
      'honowardenuserkeyrotationenabled',
    ].includes(normalizedField) &&
      /^(?:true|false)(?:`|$)/i.test(value.trim()))
  )
}

function isApprovedNestedNonSecretSummary(content, index, field, value) {
  return (
    fieldWords(field).join('') === 'secrets' &&
    ['0', 'none'].includes(normalizeQuotedScalar(value)) &&
    /\breal[ \t]*$/i.test(content.slice(Math.max(0, index - 16), index))
  )
}

function isRedactedSecretSentinel(value) {
  return ['redacted', '<redacted>', '[redacted]'].includes(
    normalizeQuotedScalar(value),
  )
}

function normalizeQuotedScalar(value) {
  let normalized = value.trim()
  const quote = normalized[0]
  if (
    normalized.length >= 2 &&
    ['"', "'", '`'].includes(quote) &&
    normalized.at(-1) === quote
  ) {
    normalized = normalized.slice(1, -1).trim()
  }
  return normalized.toLowerCase()
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

function requiredCredentialCloseoutTrackedPaths(repoRoot, trackedPaths) {
  const canonicalRepoRoot = realpathSync(repoRoot)
  const tracked =
    trackedPaths === undefined
      ? readTrackedPaths(canonicalRepoRoot)
      : new Set(trackedPaths)
  if (!tracked.has(credentialCloseoutPacketPath)) {
    throw new Error('credential closeout packet is not tracked')
  }
  return tracked
}

function requiredPacketByteLimit(value) {
  const limit = value ?? maximumInputBytes
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > maximumInputBytes) {
    throw new Error('credential closeout packet size limit is invalid')
  }
  return limit
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

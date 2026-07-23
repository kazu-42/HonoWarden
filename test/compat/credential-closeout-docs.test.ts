import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import { parse as parseJsonc } from 'jsonc-parser'
import { describe, expect, it } from 'vitest'

interface EvidenceLevel {
  id: string
  rank: number
  scope: string
}

interface EvidenceArtifact {
  path: string
  evidenceLevel: string
  contentSha256: string
}

interface EvidenceClaim {
  id: string
  operation: string
  executionLevel: string
  evidenceLevel: string
  sourceGeneration: string
  limitations: string[]
  artifacts: EvidenceArtifact[]
}

interface EvidenceRegistry {
  schemaVersion: number
  evidenceLevels: EvidenceLevel[]
  claims: EvidenceClaim[]
}

interface PacketArtifact {
  path: string
  evidenceLevel: string
  sha256: string
}

interface PacketClaim {
  id: string
  executionLevel: string
  evidenceLevel: string
  sourceGeneration: string
  status: string
  limitations: string[]
  artifacts: PacketArtifact[]
}

interface CloseoutPacket {
  schemaVersion: number
  status: string
  registry: {
    path: string
    sha256: string
  }
  counts: {
    evidenceLevels: number
    claims: number
    artifacts: number
    artifactBindings: number
    fixtureClaims: number
    localApiClaims: number
    localOfficialClientClaims: number
    stagingClaims: number
    productionClaims: number
  }
  liveEvidenceLevels: string[]
  limitations: string[]
  evidenceLevels: EvidenceLevel[]
  claims: PacketClaim[]
}

interface WranglerConfig {
  vars?: Record<string, string>
  env?: Record<string, { vars?: Record<string, string> }>
}

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const registryPath = 'compat/credential-evidence.json'
const packetPath = 'compat/credential-closeout-packet.json'

const credentialDocs = [
  'compat/README.md',
  'docs/compatibility.md',
  'docs/compatibility-matrix.md',
  'docs/current-state.md',
  'docs/security/data-flow.md',
  'docs/operations/audit-events.md',
  'docs/operations/retention-cleanup.md',
  'docs/operations/backup-restore.md',
  'docs/release/rollback-guide.md',
  'docs/operations/operator-environment.md',
  'docs/release/index.md',
  'docs/security/review-index.md',
  'docs/security/known-limitations.md',
] as const

const evidenceSummaryDocs = [
  'compat/README.md',
  'docs/compatibility-matrix.md',
  'docs/current-state.md',
  'docs/security/known-limitations.md',
] as const

const indexDocs = [
  'docs/release/index.md',
  'docs/security/review-index.md',
] as const

const rolloutFlagDocs = [
  'docs/operations/operator-environment.md',
  'docs/release/rollback-guide.md',
] as const

const freshnessDocs = [
  'docs/current-state.md',
  'docs/release/index.md',
  'docs/release/rollback-guide.md',
  'docs/security/data-flow.md',
  'docs/security/known-limitations.md',
  'docs/security/review-index.md',
] as const

const rolloutFlags = [
  'HONOWARDEN_PASSWORD_CHANGE_ENABLED',
  'HONOWARDEN_ACCOUNT_KEYS_ENABLED',
  'HONOWARDEN_KDF_MUTATION_ENABLED',
  'HONOWARDEN_USER_KEY_ROTATION_ENABLED',
] as const

const registry = readJson<EvidenceRegistry>(registryPath)
const packet = readJson<CloseoutPacket>(packetPath)

describe('credential closeout documentation contract', () => {
  it('keeps the closeout packet bound to the exact registry and artifacts', () => {
    expect(packet.schemaVersion).toBe(registry.schemaVersion)
    expect(packet.status).toBe('verified')
    expect(packet.registry.path).toBe(registryPath)
    expect(packet.registry.sha256).toBe(sha256(readBytes(registryPath)))
    expect(packet.evidenceLevels).toEqual(registry.evidenceLevels)

    const registryClaims = registry.claims.map((claim) => ({
      id: claim.id,
      executionLevel: claim.executionLevel,
      evidenceLevel: claim.evidenceLevel,
      sourceGeneration: claim.sourceGeneration,
      limitations: claim.limitations,
      artifacts: claim.artifacts.map((artifact) => ({
        path: artifact.path,
        evidenceLevel: artifact.evidenceLevel,
        sha256: artifact.contentSha256,
      })),
    }))
    const packetClaims = packet.claims.map((claim) => ({
      id: claim.id,
      executionLevel: claim.executionLevel,
      evidenceLevel: claim.evidenceLevel,
      sourceGeneration: claim.sourceGeneration,
      limitations: claim.limitations,
      artifacts: claim.artifacts,
    }))

    expect(packetClaims).toEqual(registryClaims)
    expect(packet.claims.every((claim) => claim.status === 'verified')).toBe(
      true,
    )

    const artifactBindings = packet.claims.flatMap((claim) => claim.artifacts)
    const uniqueArtifacts = new Map<string, string>()
    for (const artifact of artifactBindings) {
      const previousHash = uniqueArtifacts.get(artifact.path)
      expect(previousHash, `${artifact.path} has conflicting hashes`).toBeOneOf(
        [undefined, artifact.sha256],
      )
      uniqueArtifacts.set(artifact.path, artifact.sha256)
      expect(existsSync(repoPath(artifact.path)), artifact.path).toBe(true)
      expect(sha256(readBytes(artifact.path)), artifact.path).toBe(
        artifact.sha256,
      )
    }

    const claimsPerLevel = countBy(
      packet.claims,
      (claim) => claim.evidenceLevel,
    )
    expect(packet.counts).toMatchObject({
      evidenceLevels: registry.evidenceLevels.length,
      claims: registry.claims.length,
      artifacts: uniqueArtifacts.size,
      artifactBindings: artifactBindings.length,
      fixtureClaims: claimsPerLevel.fixture ?? 0,
      localApiClaims: claimsPerLevel.local_api ?? 0,
      localOfficialClientClaims: claimsPerLevel.local_official_client ?? 0,
      stagingClaims: claimsPerLevel.staging ?? 0,
      productionClaims: claimsPerLevel.production ?? 0,
    })
    expect(packet.liveEvidenceLevels).toEqual([])
    expect(packet.counts.stagingClaims).toBe(0)
    expect(packet.counts.productionClaims).toBe(0)
  })

  it('links every reconciled document to the canonical packet and registry', () => {
    for (const docPath of credentialDocs) {
      const content = readText(docPath)
      const links = resolvedRepoLinks(docPath, content)

      expect(links, `${docPath} must link the closeout packet`).toContain(
        packetPath,
      )
      expect(links, `${docPath} must link the evidence registry`).toContain(
        registryPath,
      )
      for (const link of links) {
        expect(
          existsSync(repoPath(link)),
          `${docPath} has an orphaned local link: ${link}`,
        ).toBe(true)
      }

      const canonicalSection = sectionWithCanonicalCredentialLinks(
        docPath,
        content,
      )
      for (const limitation of packet.limitations) {
        expect(canonicalSection, `${docPath} packet limitation`).toContain(
          limitation,
        )
      }
      const sectionWithoutCanonicalLimitations = packet.limitations.reduce(
        (section, limitation) => section.replaceAll(limitation, ''),
        canonicalSection,
      )
      expect(
        sectionWithoutCanonicalLimitations,
        `${docPath} must not claim verified staging or production activation`,
      ).not.toMatch(
        /\b(?:staging|production)\s+(?:activation|evidence|writer(?: activation)?)\s+(?:is|are|was|were|has been|have been)\s+(?:verified|proven|recorded|enabled|activated|complete|completed|passed)\b/i,
      )
      expect(
        sectionWithoutCanonicalLimitations,
        `${docPath} packet must not prove staging or production activation`,
      ).not.toMatch(
        /\b(?:packet|registry|closeout|evidence)\s+(?:verifies|proves|records|confirms|demonstrates)\s+(?:tracked\s+)?(?:staging|production)\b/i,
      )
    }
  })

  it('exposes exactly one canonical credential entry in each review index', () => {
    for (const docPath of indexDocs) {
      const content = readText(docPath)
      const links = resolvedRepoLinks(docPath, content)

      expect(
        links.filter((link) => link === packetPath),
        `${docPath} closeout packet links`,
      ).toHaveLength(1)
      expect(
        links.filter((link) => link === registryPath),
        `${docPath} evidence registry links`,
      ).toHaveLength(1)
      expect(countOccurrences(content, 'Credential Closeout Evidence')).toBe(1)
      for (const limitation of packet.limitations) {
        expect(content, `${docPath} packet limitation`).toContain(limitation)
      }
    }
  })

  it('keeps one operation row per claim with a real representative artifact', () => {
    const inventoryPath = 'compat/README.md'
    const inventory = readText(inventoryPath)
    const lines = inventory.split('\n')

    for (const claim of registry.claims) {
      const claimRows = lines
        .map((line) => ({ line, cells: markdownTableCells(line) }))
        .filter(({ cells }) => cells[0] === `\`${claim.id}\``)
      expect(claimRows, `${claim.id} inventory rows`).toHaveLength(1)

      const claimRow = claimRows[0]
      if (!claimRow) {
        throw new Error(`missing inventory row for ${claim.id}`)
      }
      const { line: row, cells } = claimRow
      expect(cells).toContain(`\`${claim.operation}\``)
      expect(cells).toContain(`\`${claim.executionLevel}\``)
      expect(cells).toContain(`\`${claim.evidenceLevel}\``)

      const rowLinks = resolvedRepoLinks(inventoryPath, row)
      const representativeArtifacts = claim.artifacts.filter((artifact) =>
        rowLinks.includes(artifact.path),
      )
      expect(
        representativeArtifacts,
        `${claim.id} must link one of its exact artifacts`,
      ).not.toHaveLength(0)
      expect(
        representativeArtifacts.some(
          (artifact) => artifact.evidenceLevel === claim.evidenceLevel,
        ),
        `${claim.id} representative artifact must prove ${claim.evidenceLevel}`,
      ).toBe(true)
    }
  })

  it('keeps reconciled document freshness metadata current', () => {
    for (const docPath of freshnessDocs) {
      expect(readText(docPath), `${docPath} freshness metadata`).toMatch(
        /^Last (?:updated|reviewed): 2026-07-23\.?$/m,
      )
    }
  })

  it('keeps evidence summaries aligned with the packet ceiling and counts', () => {
    const levelCounts = countBy(registry.claims, (claim) => claim.evidenceLevel)

    for (const docPath of evidenceSummaryDocs) {
      const content = readText(docPath)

      for (const level of registry.evidenceLevels) {
        const expectedCount = levelCounts[level.id] ?? 0
        expect(content, `${docPath} ${level.id} count`).toMatch(
          new RegExp(
            `\\|\\s*\`${escapeRegExp(level.id)}\`\\s*\\|\\s*${expectedCount}\\s*\\|`,
          ),
        )
      }

      for (const limitation of packet.limitations) {
        expect(content, `${docPath} packet limitation`).toContain(limitation)
      }
      expect(content).not.toMatch(/no official[- ]client evidence/i)
    }
  })

  it('keeps tracked credential rollout flags disabled in config and docs', () => {
    const config = parseJsonc(readText('wrangler.jsonc')) as WranglerConfig
    const scopes = [
      config.vars ?? {},
      config.env?.staging?.vars ?? {},
      config.env?.production?.vars ?? {},
    ]

    for (const flag of rolloutFlags) {
      const values = scopes.map((vars) => vars[flag])
      expect(values, `${flag} tracked values`).toEqual([
        'false',
        'false',
        'false',
      ])

      const rowPattern = new RegExp(
        `\\|\\s*\`${escapeRegExp(flag)}\`\\s*\\|\\s*\`false\`\\s*\\|\\s*\`false\`\\s*\\|\\s*\`false\`\\s*\\|`,
      )
      for (const docPath of rolloutFlagDocs) {
        expect(readText(docPath), `${docPath} ${flag} values`).toMatch(
          rowPattern,
        )
      }
    }
  })
})

function readJson<T>(path: string): T {
  return JSON.parse(readText(path)) as T
}

function readText(path: string): string {
  return readFileSync(repoPath(path), 'utf8')
}

function readBytes(path: string): Buffer {
  return readFileSync(repoPath(path))
}

function repoPath(path: string): string {
  return resolve(repoRoot, path)
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

function countBy<T>(
  values: T[],
  keyFor: (value: T) => string,
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) {
    const key = keyFor(value)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

function resolvedRepoLinks(docPath: string, content: string): string[] {
  const links: string[] = []
  const linkPattern = /\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/g

  for (const match of content.matchAll(linkPattern)) {
    const rawTarget = match[1]
    if (!rawTarget) {
      throw new Error(`missing link target in ${docPath}`)
    }
    const target = rawTarget.replace(/^<|>$/g, '')
    if (/^(?:https?:|mailto:|#)/.test(target)) {
      continue
    }

    const pathOnly = target.split(/[?#]/, 1)[0]
    if (!pathOnly) {
      throw new Error(`empty local link target in ${docPath}`)
    }
    const absolutePath = resolve(repoRoot, dirname(docPath), pathOnly)
    const relativePath = relative(repoRoot, absolutePath).split(sep).join('/')
    expect(
      relativePath,
      `${docPath} link must stay inside the repository`,
    ).not.toMatch(/^\.\.(?:\/|$)/)
    links.push(relativePath)
  }

  return links
}

function sectionWithCanonicalCredentialLinks(
  docPath: string,
  content: string,
): string {
  const lines = content.split('\n')
  const starts = [
    0,
    ...lines.flatMap((line, index) => (/^## /.test(line) ? [index] : [])),
  ]
  const sections = starts.map((start, index) =>
    lines.slice(start, starts[index + 1] ?? lines.length).join('\n'),
  )
  const canonicalSections = sections.filter((section) => {
    const links = resolvedRepoLinks(docPath, section)
    return links.includes(packetPath) && links.includes(registryPath)
  })

  expect(
    canonicalSections,
    `${docPath} canonical credential sections`,
  ).toHaveLength(1)
  const canonicalSection = canonicalSections[0]
  if (!canonicalSection) {
    throw new Error(`missing canonical credential section in ${docPath}`)
  }
  return canonicalSection
}

function countOccurrences(content: string, needle: string): number {
  return content.split(needle).length - 1
}

function markdownTableCells(line: string): string[] {
  if (!line.trim().startsWith('|')) {
    return []
  }
  return line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim())
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

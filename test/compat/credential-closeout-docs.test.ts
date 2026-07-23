import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import type { Nodes, Root, RootContent, Table } from 'mdast'
import { parse as parseJsonc } from 'jsonc-parser'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
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

interface ResolvedRepoTarget {
  kind: 'image' | 'link'
  path: string
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
  'docs/operations/official-client-credential-harness.md',
  'docs/release/index.md',
  'docs/security/review-index.md',
  'docs/security/known-limitations.md',
] as const

const credentialSectionHeadings = {
  'compat/README.md': 'Credential Closeout Evidence',
  'docs/compatibility.md': 'Credential Closeout Boundary',
  'docs/compatibility-matrix.md': 'Credential Closeout Evidence Levels',
  'docs/current-state.md':
    '2026-07-23 HON-229 Credential Evidence Reconciliation',
  'docs/security/data-flow.md': 'Credential And Recovery Evidence Boundary',
  'docs/operations/audit-events.md': 'Credential Closeout Evidence Boundary',
  'docs/operations/retention-cleanup.md': 'Credential Closeout Boundary',
  'docs/operations/backup-restore.md': 'Credential Recovery Evidence Boundary',
  'docs/release/rollback-guide.md': 'Credential Writer Rollback Boundary',
  'docs/operations/operator-environment.md': 'Operator Environment',
  'docs/operations/official-client-credential-harness.md':
    'Credential Closeout Evidence',
  'docs/release/index.md': 'Credential Closeout Evidence',
  'docs/security/review-index.md': 'Credential Closeout Evidence',
  'docs/security/known-limitations.md': 'Credential Closeout Boundary',
} as const satisfies Record<(typeof credentialDocs)[number], string>

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
const markdownParser = unified().use(remarkParse).use(remarkGfm)
const registryCredentialDocs = [
  ...new Set(
    registry.claims.flatMap((claim) =>
      claim.artifacts
        .map((artifact) => artifact.path)
        .filter((path) => path.startsWith('docs/') && path.endsWith('.md')),
    ),
  ),
].sort()
const credentialNavigationDocs = [
  'docs/operations/operator-environment.md',
  'docs/release/index.md',
] as const

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
      assertCredentialDocContract(docPath, content)
    }
  })

  it('protects every registry-backed credential evidence document', () => {
    expect(registryCredentialDocs).toEqual([
      'docs/release/account-kdf-change-local-evidence.md',
      'docs/release/account-key-initialization-local-evidence.md',
      'docs/release/account-password-change-local-evidence.md',
      'docs/release/user-key-rotation-local-evidence.md',
    ])

    for (const docPath of registryCredentialDocs) {
      assertCredentialSupportingDocContract(docPath, readText(docPath))
    }
  })

  it('exposes every credential-supporting document from canonical navigation', () => {
    const requiredDocs = [
      ...registryCredentialDocs,
      'docs/operations/official-client-credential-harness.md',
    ].sort()
    const linkedDocs = [
      ...new Set(
        credentialNavigationDocs.flatMap((docPath) =>
          resolvedRepoLinks(docPath, readText(docPath)).filter((link) =>
            requiredDocs.includes(link),
          ),
        ),
      ),
    ].sort()

    expect(linkedDocs).toEqual(requiredDocs)
  })

  it('keeps the official credential harness bound to HON-226 publication closeout', () => {
    const content = readText(
      'docs/operations/official-client-credential-harness.md',
    )

    expect(content).not.toMatch(
      /HON-226[\s\S]{0,160}pending exact-head review/i,
    )
    expect(content).toContain('PR #114')
    expect(content).toContain('13f4e895d69b2c2485a10a82d1793cf60e148024')
    expect(content).toContain('2026-07-22T02:39:04.165Z')
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
    assertOperationInventoryContract(inventoryPath, readText(inventoryPath))
  })

  it('keeps reconciled document freshness metadata current', () => {
    for (const docPath of freshnessDocs) {
      expect(readText(docPath), `${docPath} freshness metadata`).toMatch(
        /^Last (?:updated|reviewed): 2026-07-23\.?$/m,
      )
    }
  })

  it('keeps evidence summaries aligned with the packet ceiling and counts', () => {
    for (const docPath of evidenceSummaryDocs) {
      const content = readText(docPath)
      assertEvidenceSummaryContract(docPath, content)
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
    }

    for (const docPath of rolloutFlagDocs) {
      assertRolloutFlagContract(docPath, readText(docPath))
    }
  })

  it.each([
    'Production credential writer activation is verified.',
    'Production `credential writer activation` is verified.',
    'Credential writer activation is verified in production.',
    'Credential writer activation in production is verified.',
    'Do not rely on local data; production credential writer activation is verified.',
    'No blockers remain and production credential writer activation is verified.',
    'Production credential writer activation is approved.',
    'Production credential writer is live.',
    'Production credential writer is ready.',
    'Production password change is verified.',
    'Production KDF mutation is verified.',
    'Production account-key rotation is verified.',
    'Without credential evidence, production credential writer activation is verified.',
    'Without staging evidence, production credential writer activation is approved.',
    'Without local evidence, production credential writer is ready.',
    'Before lunch, production credential writer activation is verified.',
    'After lunch, production credential writer activation is verified.',
    'If convenient, production password change is approved.',
    'The packet verifies credential writer activation in production.',
    'The registry confirms production KDF mutation.',
    'Verified production credential writer activation.',
    'Approved production password change.',
    'Confirmed staging KDF mutation.',
    'Live production account-key initialization.',
    'Ready production user-key rotation.',
    'The registry confirms the production KDF mutation.',
    'Evidence demonstrates the staging password change.',
    'Production supports password changes.',
    'Password changes work in production.',
    'Production recovery restore is verified.',
    'Production backup export is approved.',
    'Production recovery writers are disabled.',
    'Production recovery forward generation is verified.',
    'Remote credential restoration is verified.',
    'Remote D1/R2 restore is operational.',
    'Real-account recovery is confirmed.',
    'Prod credential writer activation is verified.',
    'Production credential writer activation: verified.',
    'Production password change: approved.',
    'Remote credential restoration: operational.',
    'Verified in production: credential writer activation.',
    'Context follows. Verified in production: credential writer activation.',
    'Status: verified in production: credential writer activation.',
    'Production credential writer activation evidence exists.',
    'Production credential writer activation evidence is present.',
    'Production credential writer activation is not only documented but is verified.',
  ])(
    'rejects unsupported live credential claims outside the canonical section: %s',
    (claim) => {
      const docPath = 'docs/release/index.md'
      const content = `${readText(docPath)}\n## Contradictory Credential Claim\n\n${claim}\n`

      expect(() => assertCredentialDocContract(docPath, content)).toThrow(
        /must not claim verified staging or production activation/,
      )
    },
  )

  it('rejects unsupported live credential claims assembled across table cells', () => {
    const docPath = 'docs/release/index.md'
    const content = `${readText(docPath)}\n| Environment | Operation | Status |\n| --- | --- | --- |\n| Production | credential writer activation | Verified |\n`

    expect(() => assertCredentialDocContract(docPath, content)).toThrow(
      /must not claim verified staging or production activation/,
    )
  })

  it('rejects unsupported live credential claims inherited from a section heading', () => {
    const docPath = 'docs/release/index.md'
    const content = `${readText(docPath)}\n## Production\n\nCredential writer activation is verified.\n`

    expect(() => assertCredentialDocContract(docPath, content)).toThrow(
      /must not claim verified staging or production activation/,
    )
  })

  it.each([
    ['Production', 'Backup export is approved.'],
    ['Prod', 'Credential writer activation is verified.'],
  ])(
    'rejects unsupported live credential claims inherited from a %s heading',
    (heading, claim) => {
      const docPath = 'docs/release/index.md'
      const content = `${readText(docPath)}\n## ${heading}\n\n${claim}\n`

      expect(() => assertCredentialDocContract(docPath, content)).toThrow(
        /must not claim verified staging or production activation/,
      )
    },
  )

  it('rejects unsupported live credential claims inherited from a nested section heading', () => {
    const docPath = 'docs/release/index.md'
    const content = `${readText(docPath)}\n> ## Production\n>\n> Credential writer activation is verified.\n`

    expect(() => assertCredentialDocContract(docPath, content)).toThrow(
      /must not claim verified staging or production activation/,
    )
  })

  it('rejects unsupported live credential claims inherited from table headers', () => {
    const docPath = 'docs/release/index.md'
    const content = `${readText(docPath)}\n| Production operation | Status |\n| --- | --- |\n| credential writer activation | Verified |\n`

    expect(() => assertCredentialDocContract(docPath, content)).toThrow(
      /must not claim verified staging or production activation/,
    )
  })

  it('rejects unsupported live credential claims in fenced output', () => {
    const docPath = 'docs/release/index.md'
    const content = `${readText(docPath)}\n\`\`\`text\nProduction credential writer activation is verified.\n\`\`\`\n`

    expect(() => assertCredentialDocContract(docPath, content)).toThrow(
      /must not claim verified staging or production activation/,
    )
  })

  it.each([
    'Production credential writer activation is not verified.',
    'No production credential writer activation is verified.',
    'No official client password-change UI or production password-change run is recorded.',
    'It does not prove staging or production writer activation.',
    'Production credential writer activation has not yet been verified.',
    'Production credential writer activation is not fully verified.',
    'Remote credential restoration is not completely verified.',
    'Production backup export is not independently approved.',
    'No production recovery restore is verified.',
    'Production credential writer activation evidence does not exist.',
    'Production credential writer activation evidence is not present.',
    'Production credential writer activation: not verified.',
    'Local evidence is available: production credential writer activation is not verified.',
  ])('accepts an explicitly negated live credential claim: %s', (claim) => {
    const docPath = 'docs/release/index.md'
    const content = `${readText(docPath)}\n${claim}\n`

    expect(() => assertCredentialDocContract(docPath, content)).not.toThrow()
  })

  it('accepts generic remote backup export evidence without a credential claim', () => {
    const docPath = 'docs/release/index.md'
    const content = `${readText(docPath)}\nScheduled remote backup export evidence is recorded.\n\n## Remote\n\nScheduled backup export evidence is recorded.\n`

    expect(() => assertCredentialDocContract(docPath, content)).not.toThrow()
  })

  it.each([
    'Before production credential writer activation is verified, keep the flag disabled.',
    'If production credential writer activation is verified, update this packet.',
    'When staging password change is approved, record separate environment evidence.',
    'Once production KDF mutation is verified, update the release index.',
    'Production credential writer activation must be verified before the flag is enabled.',
    'Production password change will be verified in a later evidence run.',
    'If remote credential restoration is verified, record separate evidence.',
    'After production credential writer activation is verified, update this packet.',
  ])('accepts a non-assertive future live credential gate: %s', (claim) => {
    const docPath = 'docs/release/index.md'
    const content = `${readText(docPath)}\n${claim}\n`

    expect(() => assertCredentialDocContract(docPath, content)).not.toThrow()
  })

  it('accepts a conditional credential gate under an environment heading', () => {
    const docPath = 'docs/release/index.md'
    const content = `${readText(docPath)}\n## Production\n\nIf credential writer activation is verified, update this packet.\n`

    expect(() => assertCredentialDocContract(docPath, content)).not.toThrow()
  })

  it('rejects duplicate canonical entries at any heading level', () => {
    const docPath = 'docs/release/index.md'
    const content = `${readText(docPath)}\n### Duplicate Credential Closeout Evidence\n\nCanonical source: [packet](../../compat/credential-closeout-packet.json) and [registry](../../compat/credential-evidence.json).\n\n- ${packet.limitations[0]}\n- ${packet.limitations[1]}\n`

    expect(() => assertCredentialDocContract(docPath, content)).toThrow(
      /canonical credential sections|closeout packet links/,
    )
  })

  it('binds canonical evidence links and limitations to the expected heading', () => {
    const docPath = 'docs/release/index.md'
    let content = readText(docPath)
      .replace(
        '[packet](../../compat/credential-closeout-packet.json)',
        'packet',
      )
      .replace('[registry](../../compat/credential-evidence.json)', 'registry')
    for (const limitation of packet.limitations) {
      content = content.replace(limitation, 'Canonical limitation moved below.')
    }
    content += `\n## Unrelated Appendix\n\n[packet](../../compat/credential-closeout-packet.json) and [registry](../../compat/credential-evidence.json).\n\n- ${packet.limitations[0]}\n- ${packet.limitations[1]}\n`

    expect(() => assertCredentialDocContract(docPath, content)).toThrow(
      /canonical credential sections/,
    )
  })

  it.each([
    '[orphan](<../../compat/missing artifact.json>)',
    '[orphan][missing-artifact]\n\n[missing-artifact]: <../../compat/missing artifact.json>',
    '[orphan][artifact]\n\n[artifact]: <../../compat/missing artifact.json>\n[artifact]: ../../compat/credential-evidence.json',
    '[orphan](../../compat/missing artifact.json)',
  ])('rejects orphaned or unparsed local link syntax: %s', (link) => {
    const docPath = 'docs/release/index.md'
    const content = `${readText(docPath)}\n${link}\n`

    expect(() => assertCredentialDocContract(docPath, content)).toThrow(
      /orphaned local link|unparsed Markdown link/,
    )
  })

  it('rejects machine-specific absolute local links', () => {
    const docPath = 'docs/release/index.md'
    const absoluteRegistryPath = repoPath(registryPath)
    const content = readText(docPath).replace(
      '../../compat/credential-evidence.json',
      absoluteRegistryPath,
    )

    expect(() => assertCredentialDocContract(docPath, content)).toThrow(
      /absolute local link/,
    )
  })

  it('does not count an image target as a canonical evidence link', () => {
    const docPath = 'docs/release/index.md'
    const content = readText(docPath).replace(
      '[packet](../../compat/credential-closeout-packet.json)',
      '![packet](../../compat/credential-closeout-packet.json)',
    )

    expect(() => assertCredentialDocContract(docPath, content)).toThrow(
      /closeout packet links/,
    )
  })

  it.each([
    '<a href="../../compat/missing-artifact.json">orphaned evidence</a>',
    '<img src="../../compat/missing.png" alt="missing packet">',
    '<p>Production credential writer activation is verified.</p>',
  ])('rejects raw HTML in protected credential documentation: %s', (html) => {
    const docPath = 'docs/release/index.md'
    const content = `${readText(docPath)}\n${html}\n`

    expect(() => assertCredentialDocContract(docPath, content)).toThrow(
      /raw HTML/,
    )
  })

  it('rejects inventory claim rows absent from the registry', () => {
    const docPath = 'compat/README.md'
    const content = readText(docPath)
    const lastClaim = registry.claims.at(-1)
    if (!lastClaim) {
      throw new Error('credential registry must contain claims')
    }
    const lastRow = content
      .split('\n')
      .find((line) => line.startsWith(`| \`${lastClaim.id}\``))
    if (!lastRow) {
      throw new Error(`missing inventory row for ${lastClaim.id}`)
    }
    const staleRow =
      '| `stale.removed-claim` | `stale_operation` | `local_api` | `local_api` | [registry](credential-evidence.json) |'
    const mutated = content.replace(lastRow, `${lastRow}\n${staleRow}`)

    expect(inventoryClaimIds(docPath, mutated)).not.toEqual(
      registry.claims.map((claim) => claim.id),
    )
  })

  it('requires exact positional inventory columns and row width', () => {
    const docPath = 'compat/README.md'
    const content = readText(docPath)
    const claim = registry.claims[0]
    if (!claim) {
      throw new Error('credential registry must contain claims')
    }
    const original = content
      .split('\n')
      .find((line) => line.startsWith(`| \`${claim.id}\``))
    if (!original) {
      throw new Error(`missing inventory row for ${claim.id}`)
    }
    const exactArtifact = claim.artifacts.find(
      (artifact) => artifact.evidenceLevel === claim.evidenceLevel,
    )
    if (!exactArtifact) {
      throw new Error(`missing exact-level artifact for ${claim.id}`)
    }
    const mutated = content.replace(
      original,
      `| \`${claim.id}\` | \`wrong.operation\` | \`wrong_execution\` | \`production\` | [wrong existing artifact](../.workflow/hon-207-credential-closeout/results/03a-generation-bound-backup.md) | \`${claim.operation}\` | \`${claim.executionLevel}\` | \`${claim.evidenceLevel}\` | [correct artifact](../${exactArtifact.path}) |`,
    )

    expect(() => assertOperationInventoryContract(docPath, mutated)).toThrow(
      /inventory row/,
    )
  })

  it('requires the representative artifact link in its positional cell', () => {
    const docPath = 'compat/README.md'
    const content = readText(docPath)
    const claim = registry.claims[0]
    if (!claim) {
      throw new Error('credential registry must contain claims')
    }
    const original = content
      .split('\n')
      .find((line) => line.startsWith(`| \`${claim.id}\``))
    if (!original) {
      throw new Error(`missing inventory row for ${claim.id}`)
    }
    const exactArtifact = claim.artifacts.find(
      (artifact) => artifact.evidenceLevel === claim.evidenceLevel,
    )
    if (!exactArtifact) {
      throw new Error(`missing exact-level artifact for ${claim.id}`)
    }
    const mutated = content.replace(
      original,
      `| \`${claim.id}\` [](<../${exactArtifact.path}>) | \`${claim.operation}\` | \`${claim.executionLevel}\` | \`${claim.evidenceLevel}\` | No representative artifact |`,
    )

    expect(() => assertOperationInventoryContract(docPath, mutated)).toThrow(
      /representative artifact links/,
    )
  })

  it('reads evidence counts only from the canonical section table', () => {
    const docPath = 'docs/current-state.md'
    const content = `${readText(docPath).replace(
      /\| `local_api`\s+\|\s+4 \|/,
      '| `local_api`             |    999 |',
    )}\n## Stale Credential Count\n\n| Evidence level | Claims |\n| --- | ---: |\n| \`local_api\` | 4 |\n`

    expect(() => assertEvidenceSummaryContract(docPath, content)).toThrow(
      /evidence count table/,
    )
  })

  it('requires one exact documented row per rollout flag', () => {
    const docPath = 'docs/release/rollback-guide.md'
    const content = `${readText(docPath)}\n| Flag | Top-level | Staging | Production |\n| --- | --- | --- | --- |\n| \`HONOWARDEN_PASSWORD_CHANGE_ENABLED\` | \`false\` | \`true\` | \`false\` |\n`

    expect(() => assertRolloutFlagContract(docPath, content)).toThrow(
      /HONOWARDEN_PASSWORD_CHANGE_ENABLED rows/,
    )
  })

  it('requires the canonical rollout scope columns', () => {
    const docPath = 'docs/release/rollback-guide.md'
    const content = readText(docPath).replace(
      '| Flag                                   | Top-level | Staging | Production |',
      '| Flag                                   | Root      | Test    | Live       |',
    )

    expect(() => assertRolloutFlagContract(docPath, content)).toThrow(
      /rollout flag table/,
    )
  })
})

function assertCredentialDocContract(docPath: string, content: string): void {
  const document = parseMarkdown(docPath, content)
  const targets = resolvedRepoTargetsInTree(docPath, document, document)
  const links = targets
    .filter((target) => target.kind === 'link')
    .map((target) => target.path)

  expect(
    links.filter((link) => link === packetPath),
    `${docPath} closeout packet links`,
  ).toHaveLength(1)
  expect(
    links.filter((link) => link === registryPath),
    `${docPath} evidence registry links`,
  ).toHaveLength(1)
  for (const target of targets) {
    expect(
      existsSync(repoPath(target.path)),
      `${docPath} has an orphaned local ${target.kind}: ${target.path}`,
    ).toBe(true)
  }

  const canonicalSection = canonicalCredentialSection(docPath, document)

  const canonicalText = markdownText(canonicalSection, true)
  for (const limitation of packet.limitations) {
    expect(canonicalText, `${docPath} packet limitation`).toContain(limitation)
  }

  for (const fragment of proseFragments(document)) {
    const withoutLimitations = packet.limitations.reduce(
      (value, limitation) => value.replaceAll(limitation, ''),
      fragment,
    )
    expect(
      unsupportedLiveCredentialClaim(withoutLimitations),
      `${docPath} must not claim verified staging or production activation: ${fragment}`,
    ).toBe(false)
  }
}

function assertCredentialSupportingDocContract(
  docPath: string,
  content: string,
): void {
  const document = parseMarkdown(docPath, content)
  const targets = resolvedRepoTargetsInTree(docPath, document, document)
  for (const target of targets) {
    expect(
      existsSync(repoPath(target.path)),
      `${docPath} has an orphaned local ${target.kind}: ${target.path}`,
    ).toBe(true)
  }

  for (const fragment of proseFragments(document)) {
    expect(
      unsupportedLiveCredentialClaim(fragment),
      `${docPath} must not claim verified staging or production activation: ${fragment}`,
    ).toBe(false)
  }
}

function assertOperationInventoryContract(
  inventoryPath: string,
  inventory: string,
): void {
  const { document, table } = operationInventoryTable(inventoryPath, inventory)
  const rows = table.children.slice(1)

  expect(
    rows.map((row) => markdownText(row.children[0]!, true).trim()),
    `${inventoryPath} inventory claim IDs`,
  ).toEqual(registry.claims.map((claim) => claim.id))

  for (const claim of registry.claims) {
    const claimRows = rows.filter(
      (row) => markdownText(row.children[0]!, true).trim() === claim.id,
    )
    expect(claimRows, `${claim.id} inventory rows`).toHaveLength(1)

    const claimRow = claimRows[0]
    if (!claimRow) {
      throw new Error(`missing inventory row for ${claim.id}`)
    }
    const cells = claimRow.children.map((cell) =>
      markdownText(cell, true).trim(),
    )
    expect(cells, `${claim.id} inventory row`).toHaveLength(5)
    expect(cells.slice(0, 4), `${claim.id} inventory row values`).toEqual([
      claim.id,
      claim.operation,
      claim.executionLevel,
      claim.evidenceLevel,
    ])

    const rowLinks = resolvedRepoLinksInTree(inventoryPath, claimRow, document)
    expect(rowLinks, `${claim.id} inventory row links`).toHaveLength(1)
    const representativeCell = claimRow.children[4]
    if (!representativeCell) {
      throw new Error(`missing representative artifact cell for ${claim.id}`)
    }
    const representativeLinks = resolvedRepoLinksInTree(
      inventoryPath,
      representativeCell,
      document,
    )
    expect(
      representativeLinks,
      `${claim.id} representative artifact links`,
    ).toHaveLength(1)
    const representativeArtifacts = claim.artifacts.filter((artifact) =>
      representativeLinks.includes(artifact.path),
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
}

function inventoryClaimIds(docPath: string, content: string): string[] {
  const { table } = operationInventoryTable(docPath, content)
  return markdownTableRows(table)
    .slice(1)
    .map((row) => row[0] ?? '')
}

function operationInventoryTable(
  docPath: string,
  content: string,
): { document: Root; table: Table } {
  const document = parseMarkdown(docPath, content)
  const tables = tablesIn(document)
  const inventoryTables = tables.filter((table) => {
    const header = markdownTableRows(table)[0]
    return header?.[0] === 'Claim ID'
  })
  expect(inventoryTables, `${docPath} operation inventory tables`).toHaveLength(
    1,
  )
  const inventoryTable = inventoryTables[0]
  if (!inventoryTable) {
    throw new Error(`missing operation inventory table in ${docPath}`)
  }
  expect(
    markdownTableRows(inventoryTable)[0],
    `${docPath} operation inventory header`,
  ).toEqual([
    'Claim ID',
    'Operation',
    'Execution level',
    'Evidence level',
    'Representative artifact',
  ])
  return { document, table: inventoryTable }
}

function assertEvidenceSummaryContract(docPath: string, content: string): void {
  const document = parseMarkdown(docPath, content)
  const canonicalSection = canonicalCredentialSection(docPath, document)
  const evidenceTables = tablesIn(canonicalSection).filter((table) => {
    const rows = markdownTableRows(table)
    return rows[0]?.[0] === 'Evidence level' && rows[0]?.[1] === 'Claims'
  })
  expect(
    evidenceTables,
    `${docPath} canonical evidence count tables`,
  ).toHaveLength(1)

  const evidenceTable = evidenceTables[0]
  if (!evidenceTable) {
    throw new Error(`missing canonical evidence count table in ${docPath}`)
  }
  const levelCounts = countBy(registry.claims, (claim) => claim.evidenceLevel)
  const expectedRows = registry.evidenceLevels.map((level) => [
    level.id,
    String(levelCounts[level.id] ?? 0),
  ])
  expect(
    markdownTableRows(evidenceTable).slice(1),
    `${docPath} evidence count table`,
  ).toEqual(expectedRows)
}

function assertRolloutFlagContract(docPath: string, content: string): void {
  const tables = tablesIn(parseMarkdown(docPath, content))
  const rows = tables.flatMap((table) => markdownTableRows(table))

  for (const flag of rolloutFlags) {
    const flagRows = rows.filter((row) => row[0] === flag)
    expect(flagRows, `${docPath} ${flag} rows`).toHaveLength(1)
    expect(flagRows[0], `${docPath} ${flag} values`).toEqual([
      flag,
      'false',
      'false',
      'false',
    ])
  }

  const rolloutTables = tables.filter((table) =>
    markdownTableRows(table).some((row) =>
      rolloutFlags.includes(row[0] as (typeof rolloutFlags)[number]),
    ),
  )
  expect(rolloutTables, `${docPath} rollout flag tables`).toHaveLength(1)
  const rolloutTable = rolloutTables[0]
  if (!rolloutTable) {
    throw new Error(`missing rollout flag table in ${docPath}`)
  }
  const [header, ...documentedFlags] = markdownTableRows(rolloutTable)
  expect(header?.[0], `${docPath} rollout flag table label`).toMatch(
    /^(?:Flag|Rollout flag)$/,
  )
  expect(header?.slice(1), `${docPath} rollout flag table scopes`).toEqual([
    'Top-level',
    'Staging',
    'Production',
  ])
  expect(documentedFlags, `${docPath} rollout flag table rows`).toEqual(
    rolloutFlags.map((flag) => [flag, 'false', 'false', 'false']),
  )
}

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
  const document = parseMarkdown(docPath, content)
  return resolvedRepoLinksInTree(docPath, document, document)
}

function parseMarkdown(docPath: string, content: string): Root {
  const document = markdownParser.parse(content) as Root
  walkMarkdown(document, (node) => {
    if (node.type === 'html') {
      throw new Error(`${docPath} contains raw HTML: ${node.value}`)
    }
    if (
      node.type === 'text' &&
      (/\[[^\]\n]+\]\s*\([^\n)]*\)/.test(node.value) ||
        /\[[^\]\n]+\]\s*\[[^\]\n]*\]/.test(node.value))
    ) {
      throw new Error(
        `${docPath} has unparsed Markdown link syntax: ${node.value}`,
      )
    }
  })
  return document
}

function resolvedRepoLinksInTree(
  docPath: string,
  tree: Nodes,
  fullDocument: Root,
): string[] {
  return resolvedRepoTargetsInTree(docPath, tree, fullDocument)
    .filter((target) => target.kind === 'link')
    .map((target) => target.path)
}

function resolvedRepoTargetsInTree(
  docPath: string,
  tree: Nodes,
  fullDocument: Root,
): ResolvedRepoTarget[] {
  const definitions = new Map<string, string>()
  walkMarkdown(fullDocument, (node) => {
    if (
      node.type === 'definition' &&
      !definitions.has(node.identifier.toLowerCase())
    ) {
      definitions.set(node.identifier.toLowerCase(), node.url)
    }
  })

  const targets: ResolvedRepoTarget[] = []
  walkMarkdown(tree, (node) => {
    let kind: ResolvedRepoTarget['kind'] | undefined
    let target: string | undefined
    if (node.type === 'link') {
      kind = 'link'
      target = node.url
    } else if (node.type === 'image') {
      kind = 'image'
      target = node.url
    } else if (node.type === 'linkReference') {
      kind = 'link'
      target = definitions.get(node.identifier.toLowerCase())
      if (!target) {
        throw new Error(
          `${docPath} has an unresolved Markdown link reference: ${node.identifier}`,
        )
      }
    } else if (node.type === 'imageReference') {
      kind = 'image'
      target = definitions.get(node.identifier.toLowerCase())
      if (!target) {
        throw new Error(
          `${docPath} has an unresolved Markdown image reference: ${node.identifier}`,
        )
      }
    }

    if (kind !== undefined && target !== undefined) {
      const resolved = resolveRepoLink(docPath, target)
      if (resolved !== undefined) {
        targets.push({ kind, path: resolved })
      }
    }
  })
  return targets
}

function resolveRepoLink(docPath: string, target: string): string | undefined {
  if (/^(?:https?:|mailto:|#)/i.test(target)) {
    return undefined
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(target)) {
    throw new Error(`${docPath} has an unsupported link scheme: ${target}`)
  }

  const pathOnly = target.split(/[?#]/, 1)[0]
  if (!pathOnly) {
    throw new Error(`empty local link target in ${docPath}`)
  }
  if (pathOnly.includes('\\')) {
    throw new Error(`${docPath} local link must use forward slashes: ${target}`)
  }

  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(pathOnly)
  } catch {
    throw new Error(`${docPath} has an invalid encoded link target: ${target}`)
  }
  if (isAbsolute(decodedPath)) {
    throw new Error(`${docPath} has an absolute local link: ${target}`)
  }
  const absolutePath = resolve(repoRoot, dirname(docPath), decodedPath)
  const relativePath = relative(repoRoot, absolutePath).split(sep).join('/')
  expect(
    relativePath,
    `${docPath} link must stay inside the repository`,
  ).not.toMatch(/^\.\.(?:\/|$)/)
  return relativePath
}

function markdownBlocks(document: Root): Root[] {
  const blocks: Root[] = []
  let children: RootContent[] = []

  for (const child of document.children) {
    if (child.type === 'heading' && children.length > 0) {
      blocks.push({ type: 'root', children })
      children = []
    }
    children.push(child)
  }
  if (children.length > 0) {
    blocks.push({ type: 'root', children })
  }
  return blocks
}

function canonicalCredentialSection(docPath: string, document: Root): Root {
  const expectedHeading =
    credentialSectionHeadings[docPath as keyof typeof credentialSectionHeadings]
  if (!expectedHeading) {
    throw new Error(`missing canonical credential heading for ${docPath}`)
  }
  const sections = markdownBlocks(document).filter((block) => {
    const heading = block.children[0]
    if (
      heading?.type !== 'heading' ||
      markdownText(heading, true).trim() !== expectedHeading
    ) {
      return false
    }
    const links = resolvedRepoLinksInTree(docPath, block, document)
    return links.includes(packetPath) && links.includes(registryPath)
  })
  expect(sections, `${docPath} canonical credential sections`).toHaveLength(1)
  const section = sections[0]
  if (!section) {
    throw new Error(`missing canonical credential section in ${docPath}`)
  }
  return section
}

function proseFragments(document: Root): string[] {
  const fragments: string[] = []

  const append = (parts: string[]): void => {
    const text = parts
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join(' ')
    if (text.length > 0) {
      fragments.push(text)
    }
  }

  const appendWithHeadingContext = (
    headingContext: string[],
    parts: string[],
  ): void => {
    append(parts)
    const content = parts.join(' ')
    const environmentHeadings = headingContext.filter((heading) =>
      hasLiveEnvironmentContext(heading),
    )
    if (
      environmentHeadings.length > 0 &&
      hasCredentialClaimContext([...environmentHeadings, content].join(' '))
    ) {
      append([...environmentHeadings, ...parts])
    }
  }

  const visitChildren = (
    children: Nodes[],
    inheritedHeadingContext: string[],
  ): void => {
    let headingContext = [...inheritedHeadingContext]
    for (const child of children) {
      if (child.type === 'heading') {
        headingContext = headingContext.slice(0, child.depth - 1)
        headingContext[child.depth - 1] = markdownText(child, true).trim()
        append([...headingContext])
        continue
      }
      if (child.type === 'paragraph') {
        const text = markdownText(child, true).trim()
        appendWithHeadingContext(headingContext, [text])
        continue
      }
      if (child.type === 'table') {
        const [header, ...rows] = markdownTableRows(child)
        for (const row of rows) {
          appendWithHeadingContext(headingContext, [...(header ?? []), ...row])
        }
        continue
      }
      if (child.type === 'code') {
        const lines = child.value.split(/\r?\n/)
        for (const line of lines) {
          appendWithHeadingContext(headingContext, [line])
        }
        if (lines.length > 1) {
          appendWithHeadingContext(headingContext, lines)
        }
        continue
      }
      if ('children' in child) {
        visitChildren(child.children as Nodes[], headingContext)
      }
    }
  }

  visitChildren(document.children as Nodes[], [])
  return fragments
}

function unsupportedLiveCredentialClaim(text: string): boolean {
  const normalized = text.replaceAll('|', ' ').replace(/\s+/g, ' ').trim()
  const clauses = normalized
    .split(/[.;!?]+/)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0)

  for (const clause of clauses) {
    const environments = [
      ...clause.matchAll(
        /\b(?:staging|prod(?:uction)?|remote|real[-\s]+account)\b/gi,
      ),
    ]
    if (environments.length === 0) {
      continue
    }

    const hasCredentialContext = hasCredentialClaimContext(clause)
    if (hasCredentialContext) {
      const statuses = [
        ...clause.matchAll(
          /\b(?:verified|proven|recorded|enabled|disabled|activated|approved|available|complete|completed|deployed|documented|live|operational|passed|ready|successful|succeeded|confirmed|demonstrated|exists?|(?:is|are|was|were)\s+present|support(?:ed|s)?|work(?:ed|s|ing)?|function(?:al|ed|s|ing)?|verifies|proves|records|confirms|demonstrates|documents)\b/gi,
        ),
      ]
      for (const status of statuses) {
        const environment = environments.reduce((nearest, candidate) =>
          Math.abs(candidate.index - status.index) <
          Math.abs(nearest.index - status.index)
            ? candidate
            : nearest,
        )
        if (
          !statusDescribesEnvironmentClaim(
            clause,
            environment.index,
            status.index,
          )
        ) {
          continue
        }
        if (
          !liveClaimIsNegated(clause, environment.index, status.index) &&
          !liveClaimIsNonAssertive(clause, environment.index, status.index)
        ) {
          return true
        }
      }
    }

    for (const match of clause.matchAll(
      /\b(?:packet|registry|closeout|evidence)\s+(?:verifies|proves|records|confirms|demonstrates)\s+(?:tracked\s+)?(?:staging|prod(?:uction)?|remote|real[-\s]+account)\b/gi,
    )) {
      const environmentOffset = match[0].search(
        /\b(?:staging|prod(?:uction)?|remote|real[-\s]+account)\b/i,
      )
      const environmentIndex = match.index + environmentOffset
      const statusOffset = match[0].search(
        /\b(?:verifies|proves|records|confirms|demonstrates)\b/i,
      )
      if (
        !liveClaimIsNegated(
          clause,
          environmentIndex,
          match.index + statusOffset,
        ) &&
        !liveClaimIsNonAssertive(
          clause,
          environmentIndex,
          match.index + statusOffset,
        )
      ) {
        return true
      }
    }
  }
  return false
}

function statusDescribesEnvironmentClaim(
  clause: string,
  environmentIndex: number,
  statusIndex: number,
): boolean {
  const beforeStatus = clause.slice(0, statusIndex)
  const linkingVerb = beforeStatus.match(
    /\b(?:is|are|was|were|has\s+been|have\s+been)\s*$/i,
  )
  if (linkingVerb?.index !== undefined) {
    const beforeSubject = beforeStatus.slice(0, linkingVerb.index)
    const boundaries = [
      ...beforeSubject.matchAll(
        /[,;:]|\b(?:before|after|if|when|once|until|and|but|however|yet)\b/gi,
      ),
    ]
    const boundary = boundaries.at(-1)
    const subject = beforeSubject.slice(
      boundary ? boundary.index + boundary[0].length : 0,
    )
    return hasCredentialClaimContext(subject)
  }

  const start = Math.min(environmentIndex, statusIndex)
  const end = Math.max(environmentIndex, statusIndex)
  const relation = clause.slice(start, end)
  const boundaryPattern = /[,;]|\b(?:and|but|however|yet|while|whereas)\b/gi
  if (boundaryPattern.test(relation)) {
    return false
  }

  const beforeRelation = clause.slice(0, start)
  const leftBoundary = [
    ...beforeRelation.matchAll(
      /[,;:]|\b(?:and|but|however|yet|while|whereas)\b/gi,
    ),
  ].at(-1)
  const afterRelation = clause.slice(end)
  const statusIntroducesTrailingLabel =
    statusIndex < environmentIndex &&
    /^(?:status\s*:\s*)?$/i.test(clause.slice(0, statusIndex))
  const rightBoundary = afterRelation.match(
    statusIntroducesTrailingLabel
      ? /[,;]|\b(?:and|but|however|yet|while|whereas)\b/i
      : /[,;:]|\b(?:and|but|however|yet|while|whereas)\b/i,
  )
  const segmentStart = leftBoundary
    ? leftBoundary.index + leftBoundary[0].length
    : 0
  const segmentEnd =
    rightBoundary?.index !== undefined
      ? end + rightBoundary.index
      : clause.length
  const segment = clause.slice(segmentStart, segmentEnd)
  return /\bstatus\b/i.test(segment) || hasCredentialClaimContext(segment)
}

function hasCredentialClaimContext(clause: string): boolean {
  if (
    /\b(?:password[-\s]+(?:changes?|verify|verification|mutation|rotation)|kdf(?:[-\s]+mutation)?|account[-\s]+key(?:[-\s]+(?:initialization|rotation|read))?|user[-\s]+key(?:[-\s]+rotation)?|credential[-\s]+writer|writer|recovery|restor(?:e|es|ed|ation)|disabled[-\s]+writers?|writers?[-\s]+disabled|forward[-\s]+generation)\b/i.test(
      clause,
    )
  ) {
    return true
  }
  if (
    /\bcredential\b/i.test(clause) &&
    /\b(?:activation|evidence|writer|run|operation|lifecycle|mutation|rotation|readback|recovery|backup|restore|restoration|generation)\b/i.test(
      clause,
    )
  ) {
    return true
  }
  return (
    /\bbackup[-\s]+export\b/i.test(clause) &&
    /\b(?:staging|prod(?:uction)?|real[-\s]+account)\b/i.test(clause)
  )
}

function hasLiveEnvironmentContext(value: string): boolean {
  return /\b(?:staging|prod(?:uction)?|remote|real[-\s]+account)\b/i.test(value)
}

function liveClaimIsNegated(
  clause: string,
  environmentIndex: number,
  statusIndex: number,
): boolean {
  const beforeStatus = clause.slice(0, statusIndex)
  if (
    /\b(?:not|never)(?:\s+(?:actually|currently|ever|yet|fully|completely|independently))?(?:\s+been)?\s*$/i.test(
      beforeStatus,
    )
  ) {
    return true
  }

  const beforeEnvironment = clause.slice(0, environmentIndex)
  const negator = [...beforeEnvironment.matchAll(/\bno\b/gi)].at(-1)
  if (!negator) {
    return false
  }
  const scope = beforeEnvironment.slice(negator.index + negator[0].length)
  if (/[;:]|\b(?:and|but|however|yet)\b/i.test(scope)) {
    return false
  }
  if (
    scope.includes(',') &&
    hasCredentialClaimContext(clause.slice(environmentIndex, statusIndex))
  ) {
    return false
  }
  return (
    scope.trim().length === 0 ||
    /\b(?:claim|evidence|credential|password|kdf|account[-\s]+key|user[-\s]+key|activation|writer|client|settings|ui|run|operation|lifecycle|recovery|backup|restore|restoration|generation)\b/i.test(
      scope,
    ) ||
    /^(?:\s|a|later|current|tracked|live|remote|actual|real|official|client|any|environment(?:-specific)?|staging|production|or)*$/i.test(
      scope,
    )
  )
}

function liveClaimIsNonAssertive(
  clause: string,
  environmentIndex: number,
  statusIndex: number,
): boolean {
  const beforeStatus = clause.slice(0, statusIndex)
  if (
    /\b(?:will|would|must|should|could|may|might|needs?\s+to)(?:\s+(?:be|have\s+been))?\s*$/i.test(
      beforeStatus,
    )
  ) {
    return true
  }

  const marker = [
    ...beforeStatus.matchAll(/\b(?:before|after|if|when|once|until)\b/gi),
  ].at(-1)
  if (!marker) {
    return false
  }

  const scope = clause.slice(marker.index, statusIndex)
  if (/[,;:]|\b(?:but|however|yet)\b/i.test(scope)) {
    return false
  }
  return (
    (/\b(?:staging|prod(?:uction)?|remote|real[-\s]+account)\b/i.test(scope) &&
      hasCredentialClaimContext(scope)) ||
    (environmentIndex < marker.index && hasCredentialClaimContext(scope))
  )
}

function tablesIn(document: Root): Table[] {
  const tables: Table[] = []
  walkMarkdown(document, (node) => {
    if (node.type === 'table') {
      tables.push(node)
    }
  })
  return tables
}

function markdownTableRows(table: Table): string[][] {
  return table.children.map((row) =>
    row.children.map((cell) => markdownText(cell, true).trim()),
  )
}

function markdownText(node: Nodes, includeCode: boolean): string {
  if (node.type === 'text') {
    return node.value
  }
  if (node.type === 'inlineCode') {
    return includeCode ? node.value : ''
  }
  if (node.type === 'code') {
    return ''
  }
  if ('children' in node) {
    return node.children
      .map((child) => markdownText(child as Nodes, includeCode))
      .join('')
  }
  return ''
}

function walkMarkdown(node: Nodes, visit: (node: Nodes) => void): void {
  visit(node)
  if ('children' in node) {
    for (const child of node.children) {
      walkMarkdown(child as Nodes, visit)
    }
  }
}

function countOccurrences(content: string, needle: string): number {
  return content.split(needle).length - 1
}

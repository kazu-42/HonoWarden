import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import type { Nodes, Root, Table } from 'mdast'
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
  'docs/release/index.md',
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
const credentialPolicyMutationDocs = [
  'docs/adr/0009-premium-surface-scope.md',
  'docs/release/upgrade-guide.md',
  'docs/release/v0.1.0-alpha-release-notes.md',
  'docs/security/auth-state-machine.md',
  'docs/security/secrets-inventory.md',
  'docs/security/threat-model.md',
] as const

const registry = readJson<EvidenceRegistry>(registryPath)
const packet = readJson<CloseoutPacket>(packetPath)
const liveEnvironmentPatternSource = String.raw`\b(?:staging|prod(?:uction)?|remote|real[-\s]+account)\b`
const liveEnvironmentAliasPatternSource = String.raw`\b(?:live|cloudflare)\b`
const liveStatusPatternSource = String.raw`\b(?:verified|validated|proven|recorded|enabled|disabled|activated|active|approved|available|captured|collected|complete|completed|deployed|documented|in\s+place|live|operational|passed|ready|released|rolled\s+out|shipped|tested(?:\s+successfully)?|success(?:ful(?:ly)?)?|succeeded|confirmed|demonstrated|exists?|(?:is|are|was|were)\s+present|support(?:ed|s)?|work(?:ed|s|ing)?|function(?:al|ed|s|ing)?|turned\s+on|true|yes|ok|verifies|validates|proves|records|confirms|demonstrates|documents)\b`
const registryCredentialSpellings = [
  ...new Set(registry.claims.flatMap((claim) => [claim.id, claim.operation])),
]
  .sort((left, right) => right.length - left.length)
  .map((canonical) => ({
    canonical,
    prose: canonical.replace(/[._-]+/g, ' '),
  }))
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
const credentialDocumentationDocs = [
  ...markdownFilesAtRoot(),
  ...markdownFilesUnder('compat'),
  ...markdownFilesUnder('docs'),
  ...markdownFilesUnder('specs'),
].sort()
const credentialSupportingDocs = [
  ...new Set([...registryCredentialDocs, ...credentialPolicyMutationDocs]),
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

  it('keeps representative credential policy documents under mutation coverage', () => {
    for (const docPath of credentialPolicyMutationDocs) {
      assertCredentialSupportingDocContract(docPath, readText(docPath))
    }
  })

  it('scans every Markdown document for credential claims and rollout assignments', () => {
    expect(credentialDocumentationDocs).toEqual(
      expect.arrayContaining([
        'README.md',
        'ROADMAP.md',
        'SECURITY.md',
        'compat/README.md',
        'docs/release/feature-freeze-checklist.md',
        'specs/week-16-dogfood-environment-readiness.md',
      ]),
    )
    for (const docPath of credentialDocumentationDocs) {
      assertCredentialPolicyDocContract(docPath, readText(docPath))
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
    'No evidence is required because production credential writer activation is verified.',
    'No proof exists that production credential writer activation is verified.',
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
    'Production credential writer activation is  \nverified.',
    '![Production password change is verified.](assets/hon-95/desktop-vault.png)',
    'Production `account.password.change` is verified.',
    'Production `account.user_key.rotate` is verified.',
    'Production `account.password.change.client-readback` is verified.',
    'Production password change has been validated.',
    'Production password change has been tested successfully.',
    'Production password change was a success.',
    'Production password change is active.',
    'Production credential writer is turned on.',
    'Production password change has shipped.',
    'Production password change has rolled out.',
    'Production password change is released.',
    'Production password reset is verified.',
    'Production is verified for password change.',
    'Staging is approved for KDF mutation.',
    'Production has been validated for credential writer activation.',
    'After production credential writer activation was verified, the rollout flag was enabled.',
    'After production password change has been verified, the release index was updated.',
    'After production password change has been verified in Cloudflare, the release index was updated.',
    'Once production KDF mutation was verified, the release moved to Done.',
    'After production password change succeeded, the release index was updated.',
    'After production password change released, the release index was updated.',
    'After production password change rolled out, the release index was updated.',
    'Once production password change released, the release index was updated.',
    'Once production password change rolled out, the release index was updated.',
    'After production password change tested successfully, the release index was updated.',
    'Once production KDF mutation completed, the release moved to Done.',
    'After production credential writer activation shipped, the rollout flag was enabled.',
    'Once staging password change activated, the release moved to Done.',
    'After production password change went live, the release index was updated.',
    'Once staging credential writer activation became active, the release moved to Done.',
    'After production KDF mutation became operational, the rollback guide was updated.',
    'Live credential writer activation is verified.',
    'Cloudflare credential writer activation is verified.',
    'Credential writer activation is verified in Cloudflare.',
    'Production evidence remains local, but live password change has shipped.',
    'Production evidence remains local, but Cloudflare password change has shipped.',
    'Production master-password update is verified.',
    'Master-password update is verified in production.',
    'Password change is live.',
    'Credential writer activation is live.',
    'Password change went live.',
    'Password change has gone live.',
    'There is production password-change evidence.',
    'There is password-change evidence for production.',
    'There was production password-change evidence.',
    'Production has password-change evidence.',
    'No doubt production password change is verified.',
    'There is no doubt that production password change is verified.',
    'There is no blocker, but production password-change evidence exists.',
    'Production pass**word** change is verified.',
    'Production pass[word](feature-freeze-checklist.md) change is verified.',
    'Production password-change evidence has been collected.',
    'Production password-change proof has been captured.',
    'Production password-change evidence is in place.',
    '[details](feature-freeze-checklist.md "Production credential writer activation is verified.")',
    '[details][live-title]\n\n[live-title]: feature-freeze-checklist.md "Production credential writer activation is verified."',
    '![safe alt](assets/hon-95/desktop-vault.png "Production credential writer activation is verified.")',
    '[Production password change](feature-freeze-checklist.md "verified")',
    '[Production password change][split-title]\n\n[split-title]: feature-freeze-checklist.md "verified"',
    '![Production password change](assets/hon-95/desktop-vault.png "verified")',
    '![Production password change](assets/hon-95/desktop-vault.png)[proof](feature-freeze-checklist.md "verified")',
    '[Production password change](feature-freeze-checklist.md)![proof](assets/hon-95/desktop-vault.png "verified")',
    '![Production password change][split-image][proof][split-proof]\n\n[split-image]: assets/hon-95/desktop-vault.png\n[split-proof]: feature-freeze-checklist.md "verified"',
    'Production credential writer activation is not only documented but is verified.',
    'Neither the local docs nor the fixture notes change the fact that production password change is verified.',
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

  it.each([
    '| Environment | Password change |\n| --- | --- |\n| Production | Verified |',
    '| Credential writer activation | Status |\n| --- | --- |\n| Production | Verified |',
  ])(
    'rejects unsupported live credential claims using table header semantics: %s',
    (table) => {
      const docPath = 'docs/release/index.md'
      const content = `${readText(docPath)}\n${table}\n`

      expect(() => assertCredentialDocContract(docPath, content)).toThrow(
        /must not claim verified staging or production activation/,
      )
    },
  )

  it('preserves table column ownership for local and live statuses', () => {
    const docPath = 'docs/release/index.md'
    const content = `${readText(docPath)}\n| Operation | Production | Local |\n| --- | --- | --- |\n| Password change | Not verified | Verified |\n`

    expect(() => assertCredentialDocContract(docPath, content)).not.toThrow()
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
    ['Live', 'Credential writer activation is verified.'],
    ['Cloudflare', 'Credential writer activation is verified.'],
    ['Cloudflare account', 'Password change is verified.'],
    ['Cloudflare account settings', 'Password change is verified.'],
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

  it('inherits a credential operation from its section heading', () => {
    const docPath = 'docs/release/index.md'
    const content = `${readText(docPath)}\n## Credential writer activation\n\nProduction status: verified.\n`

    expect(() => assertCredentialDocContract(docPath, content)).toThrow(
      /must not claim verified staging or production activation/,
    )
  })

  it('treats a nested status heading as the pending credential status', () => {
    const docPath = 'docs/release/index.md'
    const content = `${readText(docPath)}\n## Production\n\nPassword change.\n\n### Verified\n`

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

  it.each([
    '## Production\n\nCredential writer activation.\n\nStatus: verified.',
    '## Production\n\nCredential writer activation.\n\nDeployment notes remain unchanged.\n\nStatus: verified.',
    '## Production\n\nCredential writer activation.\n\nLocal test notes are linked below.\n\nStatus: verified.',
    '## Production\n\n- Credential writer activation\n- Status: verified',
    '## Production\n\n- Credential writer activation\n- Deployment notes remain unchanged\n- Status: verified',
    '## Production\n\n- Credential writer activation\n- Verified',
    '## Production\n\nPassword change.\n\nRollout status: complete.',
    '## Production\n\nPassword change.\n\nDeployment status: verified.',
    '## Production\n\nPassword change.\n\n### Current status\n\nVerified.',
    'Production password change.\n\nRelease status: ready.',
    'Production password change. Deployment notes remain unchanged. Release status: ready.',
    '| Environment | Operation |\n| --- | --- |\n| Production | credential writer activation |\n| Status | verified |',
  ])(
    'rejects unsupported live credential claims assembled across adjacent blocks: %s',
    (claim) => {
      const docPath = 'docs/release/index.md'
      const content = `${readText(docPath)}\n${claim}\n`

      expect(() => assertCredentialDocContract(docPath, content)).toThrow(
        /must not claim verified staging or production activation/,
      )
    },
  )

  it.each([
    'Production credential writer activation. Verified.',
    'Cloudflare password change. Approved.',
  ])(
    'rejects unsupported live credential claims assembled across adjacent sentences: %s',
    (claim) => {
      const docPath = 'docs/release/index.md'
      const content = `${readText(docPath)}\n${claim}\n`

      expect(() => assertCredentialDocContract(docPath, content)).toThrow(
        /must not claim verified staging or production activation/,
      )
    },
  )

  it.each([
    '## Production\n\nCredential writer activation.\n\nStatus: not verified.',
    '## Production\n\n- Credential writer activation\n- Not verified',
    '## Production\n\nCredential writer activation.\n\nLocal fixture status: verified.',
    'Production password change. Deployment notes remain unchanged. Release status: not ready.',
    '## Production\n\n- Credential writer activation\n- Locally verified',
    '## Live\n\nCredential writer activation is not verified.',
  ])('accepts bounded adjacent-block credential evidence: %s', (claim) => {
    const docPath = 'docs/release/index.md'
    const content = `${readText(docPath)}\n${claim}\n`

    expect(() => assertCredentialDocContract(docPath, content)).not.toThrow()
  })

  it('rejects unsupported live credential claims in fenced output', () => {
    const docPath = 'docs/release/index.md'
    const content = `${readText(docPath)}\n\`\`\`text\nProduction credential writer activation is verified.\n\`\`\`\n`

    expect(() => assertCredentialDocContract(docPath, content)).toThrow(
      /must not claim verified staging or production activation/,
    )
  })

  it.each([
    '<a title="Production password change is verified.">details</a>',
    '<img src="proof.png" alt="Production password change is verified.">',
    '<span aria-label="Production password change is verified.">status</span>',
  ])(
    'rejects unsupported live credential claims in raw HTML attributes: %s',
    (html) => {
      const docPath = 'docs/adr/0009-premium-surface-scope.md'
      const content = `${readText(docPath)}\n${html}\n`

      expect(() => assertCredentialPolicyDocContract(docPath, content)).toThrow(
        /must not claim verified staging or production activation/,
      )
    },
  )

  it('rejects a live alias claim regardless of explanatory clause length', () => {
    const docPath = 'docs/release/index.md'
    const padding = 'detailed deployment context '.repeat(8)
    const content = `${readText(docPath)}\nLive ${padding}password change is verified.\n`

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
    'Production password change has not been validated.',
    'Production password change was not a success.',
    'Production password change is not active.',
    'Production password change has not shipped.',
    "Production password change isn't verified.",
    "Production password change hasn't shipped.",
    'Live credential writer activation is not verified.',
    'Cloudflare credential writer activation is not verified.',
    'Production account.password.change is not verified.',
    'Production account.password.change.client-readback is not verified.',
    'Credential writer activation is not verified in Cloudflare.',
    'Production evidence remains local, but live password change has not shipped.',
    'Password change is not live.',
    'Password change did not go live.',
    'Production credential writer activation. Not verified.',
    'Neither production password change nor staging KDF mutation is verified.',
    'Neither production password change nor staging KDF mutation has shipped.',
    'Production password change is neither verified nor approved.',
    'There is no production password-change evidence.',
    '[details](feature-freeze-checklist.md "Production credential writer activation is not verified.")',
    '[Production password change](feature-freeze-checklist.md "not verified")',
    '[Production password change][first-title]\n\n[first-title]: feature-freeze-checklist.md\n[first-title]: feature-freeze-checklist.md "verified"',
    '![Production password change is not verified.](assets/hon-95/desktop-vault.png)',
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
    '## Production\n\n### Local harness\n\nCredential writer activation is verified.',
    'Is production password change verified?',
  ])('accepts a non-live or non-assertive credential status: %s', (claim) => {
    const docPath = 'docs/release/index.md'
    const content = `${readText(docPath)}\n${claim}\n`

    expect(() => assertCredentialDocContract(docPath, content)).not.toThrow()
  })

  it.each([
    'Production is verified for release documentation.',
    'Staging is ready for ordinary website traffic.',
    'The live documentation index is ready for password change updates.',
    '## Cloudflare documentation\n\nPassword change is verified.',
  ])('accepts a non-credential environment status: %s', (claim) => {
    const docPath = 'docs/release/index.md'
    const content = `${readText(docPath)}\n${claim}\n`

    expect(() => assertCredentialDocContract(docPath, content)).not.toThrow()
  })

  it('describes operator-driven restore separately from API credential mutations', () => {
    const currentState = readText('docs/current-state.md')

    expect(currentState).toMatch(
      /operator-driven local fresh-target restore with\s+official-client readback/,
    )
    expect(currentState).not.toContain(
      'The `local_official_client` rows mean local API-driven credential mutations',
    )
  })

  it.each([
    'Before production credential writer activation is verified, keep the flag disabled.',
    'If production credential writer activation is verified, update this packet.',
    'When staging password change is approved, record separate environment evidence.',
    'Once production KDF mutation is verified, update the release index.',
    'Production credential writer activation must be verified before the flag is enabled.',
    'Production password change will be verified in a later evidence run.',
    'Password change will be live only after a separate production evidence run.',
    'Password change will go live only after a separate production evidence run.',
    'If remote credential restoration is verified, record separate evidence.',
    'After production credential writer activation is verified, update this packet.',
    'Once production password change has been verified, update this packet.',
    'After production password change has been verified, enable the flag.',
    'When staging KDF mutation has been approved, record separate evidence.',
    'After production password change has been verified in Cloudflare, update this packet.',
    'There is a plan to collect production password-change evidence.',
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

  it('keeps nested subsections inside the canonical credential section', () => {
    const docPath = 'docs/release/index.md'
    const content = readText(docPath).replace(
      'Packet limitations:\n\n- The registry verifies committed metadata',
      '### Packet limitations\n\n- The registry verifies committed metadata',
    )

    expect(() => assertCredentialDocContract(docPath, content)).not.toThrow()
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

  it('binds release-index evidence counts to the canonical packet', () => {
    const docPath = 'docs/release/index.md'
    const content = readText(docPath).replace(
      /\| `local_api`\s+\|\s+4 \|/,
      '| `local_api`             |    999 |',
    )

    expect(() => assertEvidenceSummaryContract(docPath, content)).toThrow(
      /evidence count table/,
    )
  })

  it.each([...credentialDocs, ...credentialSupportingDocs])(
    'rejects a live true rollout assignment in protected documentation: %s',
    (docPath) => {
      const content = `${readText(docPath)}\n\nProduction \`HONOWARDEN_PASSWORD_CHANGE_ENABLED=true\`.\n`
      const assertContract = credentialDocs.some((path) => path === docPath)
        ? assertCredentialDocContract
        : assertCredentialSupportingDocContract

      expect(() => assertContract(docPath, content)).toThrow(
        /tracked credential rollout flag/,
      )
    },
  )

  it.each([...credentialDocs, ...credentialSupportingDocs])(
    'rejects a heading-scoped live true rollout assignment in protected documentation: %s',
    (docPath) => {
      const content = `${readText(docPath)}\n\n## Production\n\n\`HONOWARDEN_PASSWORD_CHANGE_ENABLED=true\`\n`
      const assertContract = credentialDocs.some((path) => path === docPath)
        ? assertCredentialDocContract
        : assertCredentialSupportingDocContract

      expect(() => assertContract(docPath, content)).toThrow(
        /tracked credential rollout flag/,
      )
    },
  )

  it.each([
    'Production uses the following setting. `HONOWARDEN_PASSWORD_CHANGE_ENABLED=true`.',
    '## Production\n\n```text\nHONOWARDEN_PASSWORD_CHANGE_ENABLED=true\n```',
    'Production rollout settings are listed below. Credential gates remain documented here. `HONOWARDEN_PASSWORD_CHANGE_ENABLED=true`.',
    'Production uses the following setting.\n\n```text\nHONOWARDEN_PASSWORD_CHANGE_ENABLED=true\n```',
    'Production uses the following setting.\n\n### Current value\n\n```text\nHONOWARDEN_PASSWORD_CHANGE_ENABLED=true\n```',
    'Production uses the following setting.\n\nThis setting is not local.\n\n```text\nHONOWARDEN_PASSWORD_CHANGE_ENABLED=true\n```',
    '## Production\n\nThe local harness uses:\n\nDeployment notes remain unchanged.\n\n```text\nHONOWARDEN_PASSWORD_CHANGE_ENABLED=true\n```',
  ])(
    'rejects a live true rollout assignment with bounded environment context: %s',
    (claim) => {
      const docPath = 'docs/release/index.md'
      const content = `${readText(docPath)}\n\n${claim}\n`

      expect(() => assertCredentialDocContract(docPath, content)).toThrow(
        /tracked credential rollout flag/,
      )
    },
  )

  it.each([
    'Production enables `HONOWARDEN_PASSWORD_CHANGE_ENABLED`.',
    'Staging turns on `HONOWARDEN_KDF_MUTATION_ENABLED`.',
    'Production sets `HONOWARDEN_PASSWORD_CHANGE_ENABLED` to true.',
    'Production configures `HONOWARDEN_KDF_MUTATION_ENABLED` as enabled.',
    'Production uses `HONOWARDEN_ACCOUNT_KEYS_ENABLED` as enabled.',
    'Production turns `HONOWARDEN_KDF_MUTATION_ENABLED` on.',
    'Production has `HONOWARDEN_PASSWORD_CHANGE_ENABLED` enabled.',
    'Production keeps `HONOWARDEN_ACCOUNT_KEYS_ENABLED` enabled.',
    'Production runs with `HONOWARDEN_USER_KEY_ROTATION_ENABLED` enabled.',
    'Production sets `HONOWARDEN_PASSWORD_CHANGE_ENABLED` true.',
    'Production has `HONOWARDEN_PASSWORD_CHANGE_ENABLED` turned on.',
    'Production flips `HONOWARDEN_PASSWORD_CHANGE_ENABLED` on.',
    'Production config: `"HONOWARDEN_PASSWORD_CHANGE_ENABLED": "true"`.',
    '## Production\n\n```json\n{"HONOWARDEN_PASSWORD_CHANGE_ENABLED": "true"}\n```',
    'Production sets `HONOWARDEN_PASSWORD_CHANGE_ENABLED` to "true".',
    'Production uses `HONOWARDEN_PASSWORD_CHANGE_ENABLED = "true"`.',
    'Production keeps `HONOWARDEN_PASSWORD_CHANGE_ENABLED` turned on.',
    'Production env var `HONOWARDEN_PASSWORD_CHANGE_ENABLED` is set to true.',
    'Production has `HONOWARDEN_PASSWORD_CHANGE_ENABLED` set to true.',
    'Production defines `HONOWARDEN_PASSWORD_CHANGE_ENABLED` as true.',
    'Production maps `HONOWARDEN_PASSWORD_CHANGE_ENABLED` to true.',
    'Production `HONOWARDEN_PASSWORD_CHANGE_ENABLED` value is `true`.',
    "Production's non-local harness sets `HONOWARDEN_PASSWORD_CHANGE_ENABLED` to true.",
    'Production and the local harness set `HONOWARDEN_PASSWORD_CHANGE_ENABLED` to true.',
    'Production does not set `HONOWARDEN_PASSWORD_CHANGE_ENABLED=true` while staging sets `HONOWARDEN_PASSWORD_CHANGE_ENABLED=true`.',
  ])('rejects every active live rollout assignment: %s', (claim) => {
    const docPath = 'docs/release/index.md'
    const content = `${readText(docPath)}\n\n${claim}\n`

    expect(() => assertCredentialDocContract(docPath, content)).toThrow(
      /tracked credential rollout flag/,
    )
  })

  it('rejects a live true rollout assignment split across table cells', () => {
    const docPath = 'docs/release/index.md'
    const content = `${readText(docPath)}\n\n## Production\n\n| Flag | Value |\n| --- | --- |\n| \`HONOWARDEN_PASSWORD_CHANGE_ENABLED\` | \`true\` |\n`

    expect(() => assertCredentialDocContract(docPath, content)).toThrow(
      /tracked credential rollout flag/,
    )
  })

  it.each([
    '| Flag | Top-level | Staging | Production |\n| --- | --- | --- | --- |\n| `HONOWARDEN_PASSWORD_CHANGE_ENABLED` | `false` | `false` | `true` |',
    '| Environment | Value | Flag |\n| --- | --- | --- |\n| Production | `true` | `HONOWARDEN_PASSWORD_CHANGE_ENABLED` |',
    '| Environment | Value | Flag |\n| --- | --- | --- |\n| Production | `true (temporary)` | `HONOWARDEN_PASSWORD_CHANGE_ENABLED` |',
    '| Environment | `HONOWARDEN_PASSWORD_CHANGE_ENABLED` |\n| --- | --- |\n| Production | `true` |',
  ])(
    'rejects a live true rollout assignment regardless of table column order: %s',
    (table) => {
      const docPath = 'docs/release/index.md'
      const content = `${readText(docPath)}\n\n${table}\n`

      expect(() => assertCredentialDocContract(docPath, content)).toThrow(
        /tracked credential rollout flag/,
      )
    },
  )

  it('rejects a live true rollout assignment in a multiline deployment command', () => {
    const docPath = 'docs/release/index.md'
    const content = [
      readText(docPath),
      '## Deployment',
      '',
      '```sh',
      'wrangler deploy --env production \\',
      '  --var HONOWARDEN_PASSWORD_CHANGE_ENABLED=true',
      '```',
      '',
    ].join('\n')

    expect(() => assertCredentialDocContract(docPath, content)).toThrow(
      /tracked credential rollout flag/,
    )
  })

  it('scopes a local-harness exception to the assignment it describes', () => {
    const docPath = 'docs/release/index.md'
    const content = `${readText(docPath)}\n\n## Production\n\nThe local harness is described below. This environment uses \`HONOWARDEN_PASSWORD_CHANGE_ENABLED=true\`.\n`

    expect(() => assertCredentialDocContract(docPath, content)).toThrow(
      /tracked credential rollout flag/,
    )
  })

  it.each([
    '## Live deployment\n\n`HONOWARDEN_PASSWORD_CHANGE_ENABLED=true`',
    '## Cloudflare Workers\n\n`HONOWARDEN_ACCOUNT_KEYS_ENABLED=true`',
  ])(
    'rejects a rollout assignment inherited from a qualified live heading: %s',
    (claim) => {
      const docPath = 'docs/release/index.md'
      const content = `${readText(docPath)}\n\n${claim}\n`

      expect(() => assertCredentialDocContract(docPath, content)).toThrow(
        /tracked credential rollout flag/,
      )
    },
  )

  it.each([
    'Production `HONOWARDEN_PASSWORD_CHANGE_ENABLED=false`.',
    'Production config: `"HONOWARDEN_PASSWORD_CHANGE_ENABLED": "false"`.',
    'Production env var `HONOWARDEN_PASSWORD_CHANGE_ENABLED` is set to false.',
    'No production environment uses `HONOWARDEN_PASSWORD_CHANGE_ENABLED=true`.',
    'Production must not use `HONOWARDEN_PASSWORD_CHANGE_ENABLED=true`.',
    'Production does not set `HONOWARDEN_PASSWORD_CHANGE_ENABLED=true`.',
    'Production never uses `HONOWARDEN_PASSWORD_CHANGE_ENABLED=true`.',
    'Production cannot enable `HONOWARDEN_PASSWORD_CHANGE_ENABLED=true`.',
    'Production does not enable `HONOWARDEN_PASSWORD_CHANGE_ENABLED`.',
    'Staging never turns on `HONOWARDEN_KDF_MUTATION_ENABLED`.',
    'No production environment enables `HONOWARDEN_PASSWORD_CHANGE_ENABLED`.',
    'Production does not set `HONOWARDEN_PASSWORD_CHANGE_ENABLED` to true.',
    'Production does not configure `HONOWARDEN_KDF_MUTATION_ENABLED` as enabled.',
    'Production does not turn `HONOWARDEN_KDF_MUTATION_ENABLED` on.',
    'Production does not flip `HONOWARDEN_PASSWORD_CHANGE_ENABLED` on.',
    'Production does not have `HONOWARDEN_PASSWORD_CHANGE_ENABLED` enabled.',
    'Production never keeps `HONOWARDEN_ACCOUNT_KEYS_ENABLED` enabled.',
    'Production does not run with `HONOWARDEN_USER_KEY_ROTATION_ENABLED` enabled.',
    'Production does not have `HONOWARDEN_PASSWORD_CHANGE_ENABLED` set to true.',
    "Production doesn't have `HONOWARDEN_PASSWORD_CHANGE_ENABLED` set to true.",
    'Production does not define `HONOWARDEN_PASSWORD_CHANGE_ENABLED` as true.',
    'Production does not map `HONOWARDEN_PASSWORD_CHANGE_ENABLED` to true.',
    '## Production\n\n| Context | Flag | Value |\n| --- | --- | --- |\n| Local harness | `HONOWARDEN_PASSWORD_CHANGE_ENABLED` | `true` |',
    'Production remains disabled. The local harness uses `HONOWARDEN_PASSWORD_CHANGE_ENABLED=true`.',
    '## Production\n\nThe local harness uses `HONOWARDEN_PASSWORD_CHANGE_ENABLED=true`; production remains false.',
    '## Production\n\nThe local harness enables `HONOWARDEN_PASSWORD_CHANGE_ENABLED`; production remains disabled.',
    '## Production\n\nLocal harness: `HONOWARDEN_PASSWORD_CHANGE_ENABLED=true`.',
    '## Production\n\nThe local harness that uses `HONOWARDEN_PASSWORD_CHANGE_ENABLED=true` is documented.',
    'The local harness uses `HONOWARDEN_PASSWORD_CHANGE_ENABLED=true`; production keeps the flag false.',
    'Production rollout settings are listed below. Credential gates remain documented here. The local harness uses `HONOWARDEN_PASSWORD_CHANGE_ENABLED=true`.',
    'Production config: no `"HONOWARDEN_PASSWORD_CHANGE_ENABLED": "true"`.',
    'Production config has no `"HONOWARDEN_PASSWORD_CHANGE_ENABLED": "true"` entry.',
    'Production config does not contain `"HONOWARDEN_PASSWORD_CHANGE_ENABLED": "true"`.',
    'Production does not set `"HONOWARDEN_PASSWORD_CHANGE_ENABLED": "true"`.',
    'Production has no `HONOWARDEN_PASSWORD_CHANGE_ENABLED = "true"` entry.',
    'Production uses the following setting.\n\nThe local harness uses:\n\n```text\nHONOWARDEN_PASSWORD_CHANGE_ENABLED=true\n```',
    'Production uses the following setting.\n\n## Local harness\n\n```text\nHONOWARDEN_PASSWORD_CHANGE_ENABLED=true\n```',
    '## Production\n\nThe local harness uses:\n\n```text\nHONOWARDEN_PASSWORD_CHANGE_ENABLED=true\n```',
    '## Production\n\n### Local harness\n\n```text\nHONOWARDEN_PASSWORD_CHANGE_ENABLED=true\n```',
    '## Production\n\n### Local harness\n\nConfiguration follows.\n\n```text\nHONOWARDEN_PASSWORD_CHANGE_ENABLED=true\n```',
    'Production uses the following setting.\n\n## Documentation example\n\n```text\nHONOWARDEN_PASSWORD_CHANGE_ENABLED=true\n```',
    'Production has not yet set `HONOWARDEN_PASSWORD_CHANGE_ENABLED` to true.',
  ])('accepts a non-contradictory rollout assignment: %s', (claim) => {
    const docPath = 'docs/release/index.md'
    const content = `${readText(docPath)}\n\n${claim}\n`

    expect(() => assertCredentialDocContract(docPath, content)).not.toThrow()
  })

  it.each([
    'No blockers remain and production `HONOWARDEN_PASSWORD_CHANGE_ENABLED=true`.',
    'Production cannot remain blocked because `HONOWARDEN_PASSWORD_CHANGE_ENABLED=true`.',
    'No doubt production uses `HONOWARDEN_PASSWORD_CHANGE_ENABLED=true`.',
  ])(
    'does not let an unrelated negation mask a live true rollout assignment: %s',
    (claim) => {
      const docPath = 'docs/release/index.md'
      const content = `${readText(docPath)}\n\n${claim}\n`

      expect(() => assertCredentialDocContract(docPath, content)).toThrow(
        /tracked credential rollout flag/,
      )
    },
  )

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

  // Seventeenth-round adversarial fail-open probes (exact HEAD review).
  it('rejects a live true rollout assignment in a multiline deploy command without backslash', () => {
    const docPath = 'docs/release/index.md'
    const content = [
      readText(docPath),
      '## Deployment',
      '',
      '```sh',
      'wrangler deploy --env production',
      '  --var HONOWARDEN_PASSWORD_CHANGE_ENABLED=true',
      '```',
      '',
    ].join('\n')
    expect(() => assertCredentialDocContract(docPath, content)).toThrow(
      /tracked credential rollout flag/,
    )
  })

  it('rejects a comma-separated production credential claim', () => {
    const docPath = 'docs/release/index.md'
    const content = `${readText(docPath)}\n## Contradictory Credential Claim\n\nProduction password change, verified.\n`
    expect(() => assertCredentialDocContract(docPath, content)).toThrow(
      /must not claim verified staging or production activation/,
    )
  })

  it('rejects a boolean true production credential status claim', () => {
    const docPath = 'docs/release/index.md'
    const content = `${readText(docPath)}\n## Contradictory Credential Claim\n\nProduction password change is true.\n`
    expect(() => assertCredentialDocContract(docPath, content)).toThrow(
      /must not claim verified staging or production activation/,
    )
  })

  it('rejects a bare-local sentence that would clear production rollout context', () => {
    const docPath = 'docs/release/index.md'
    const content = [
      readText(docPath),
      '',
      'Production runtime configuration is applied next.',
      '',
      'Local operator notes follow.',
      '',
      '`HONOWARDEN_PASSWORD_CHANGE_ENABLED=true`.',
      '',
    ].join('\n')
    expect(() => assertCredentialDocContract(docPath, content)).toThrow(
      /tracked credential rollout flag/,
    )
  })
})

function assertCredentialDocContract(docPath: string, content: string): void {
  const document = parseMarkdown(docPath, content)
  assertNoLiveRolloutFlagAssignments(docPath, document)
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
  assertNoLiveRolloutFlagAssignments(docPath, document)
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

function assertCredentialPolicyDocContract(
  docPath: string,
  content: string,
): void {
  const document = parsePolicyMarkdown(content)
  assertNoLiveRolloutFlagAssignments(docPath, document)
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

function markdownFilesAtRoot(): string[] {
  return readdirSync(repoRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort()
}

function markdownFilesUnder(directoryPath: string): string[] {
  return readdirSync(repoPath(directoryPath), { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = join(directoryPath, entry.name)
      if (entry.isDirectory()) {
        return markdownFilesUnder(entryPath)
      }
      return entry.isFile() && entry.name.endsWith('.md') ? [entryPath] : []
    })
    .sort()
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
  const document = parsePolicyMarkdown(content)
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

function parsePolicyMarkdown(content: string): Root {
  return markdownParser.parse(content) as Root
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

function markdownSections(document: Root): Root[] {
  const sections: Root[] = []
  for (let start = 0; start < document.children.length; start += 1) {
    const heading = document.children[start]
    if (heading?.type !== 'heading') {
      continue
    }
    let end = start + 1
    while (end < document.children.length) {
      const candidate = document.children[end]
      if (candidate?.type === 'heading' && candidate.depth <= heading.depth) {
        break
      }
      end += 1
    }
    sections.push({
      type: 'root',
      children: document.children.slice(start, end),
    })
  }
  return sections
}

function canonicalCredentialSection(docPath: string, document: Root): Root {
  const expectedHeading =
    credentialSectionHeadings[docPath as keyof typeof credentialSectionHeadings]
  if (!expectedHeading) {
    throw new Error(`missing canonical credential heading for ${docPath}`)
  }
  const sections = markdownSections(document).filter((block) => {
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

function assertNoLiveRolloutFlagAssignments(
  docPath: string,
  document: Root,
): void {
  const environmentPattern = new RegExp(
    `${liveEnvironmentPatternSource}|${liveEnvironmentAliasPatternSource}`,
    'i',
  )

  for (const fragment of proseFragments(document)) {
    const segments = fragment
      .replace(/\bnot\s+yet\b/gi, 'not_yet')
      .split(/[.;!?]+|\b(?:but|however|yet)\b/i)
      .map((segment) => segment.replaceAll('not_yet', 'not yet').trim())
      .filter((segment) => segment.length > 0)
    let pendingLiveEnvironment = false
    for (const segment of segments) {
      const hasLiveEnvironment = environmentPattern.test(segment)
      // Bare "local" alone must not clear production context; only explicit
      // local-harness / fixture / synthetic scopes may drop pending live env.
      const hasExplicitLocalContext = hasScopedLocalRolloutContext(segment)
      const inheritsLiveEnvironment =
        !hasLiveEnvironment &&
        pendingLiveEnvironment &&
        !hasExplicitLocalContext
      if (hasLiveEnvironment) {
        pendingLiveEnvironment = true
      } else if (hasExplicitLocalContext) {
        pendingLiveEnvironment = false
      }
      if (!hasLiveEnvironment && !inheritsLiveEnvironment) {
        continue
      }
      for (const flag of rolloutFlags) {
        for (const assignment of positiveRolloutAssignments(segment, flag)) {
          const prefix = segment.slice(0, assignment.flagIndex)
          if (rolloutAssignmentIsExplicitlyLocal(prefix)) {
            continue
          }
          expect(
            rolloutAssignmentIsNegated(prefix),
            `${docPath} must not enable a tracked credential rollout flag in a live environment: ${segment}`,
          ).toBe(true)
        }
      }
    }
  }
}

interface RolloutAssignment {
  flagIndex: number
}

function positiveRolloutAssignments(
  segment: string,
  flag: string,
): RolloutAssignment[] {
  const escapedFlag = escapeRegExp(flag)
  const quotedFlag = `["']?\\b${escapedFlag}\\b["']?`
  const positiveValue = `["']?(?:true|1|yes|on|enabled)\\b["']?`
  const patterns = [
    new RegExp(`${quotedFlag}\\s*(?:=|:|\\bis\\b)\\s*${positiveValue}`, 'gi'),
    new RegExp(`${quotedFlag}\\s+${positiveValue}`, 'gi'),
    new RegExp(
      `${quotedFlag}\\s+(?:current\\s+)?value\\s*(?:=|:|\\bis\\b)\\s*${positiveValue}`,
      'gi',
    ),
    new RegExp(
      `\\b(?:enable(?:s|d|ing)?|turn(?:s|ed|ing)?\\s+on)\\s+(?:the\\s+)?${quotedFlag}`,
      'gi',
    ),
    new RegExp(
      `\\b(?:assign(?:s|ed|ing)?|configur(?:e|es|ed|ing)|declar(?:e|es|ed|ing)|defin(?:e|es|ed|ing)|map(?:s|ped|ping)?|set(?:s|ting)?|use(?:s|d|ing)?)\\s+(?:the\\s+)?${quotedFlag}\\s+(?:(?:to|as|=)\\s*)?${positiveValue}`,
      'gi',
    ),
    new RegExp(
      `\\b(?:turn(?:s|ed|ing)?|flip(?:s|ped|ping)?)\\s+(?:the\\s+)?${quotedFlag}\\s+on\\b`,
      'gi',
    ),
    new RegExp(
      `\\b(?:has|have|keep(?:s|ing)?|run(?:s|ning)?\\s+with)\\s+(?:the\\s+)?${quotedFlag}\\s+(?:${positiveValue}|turned\\s+on\\b|(?:set|configured)\\s+(?:to|as)\\s*${positiveValue})`,
      'gi',
    ),
    new RegExp(
      `${quotedFlag}\\s+(?:(?:is|was)|(?:has|had)\\s+been)\\s+(?:(?:set|configured)\\s+(?:to|as)\\s*${positiveValue}|turned\\s+on\\b)`,
      'gi',
    ),
  ]
  const assignments = new Map<number, RolloutAssignment>()
  const flagPattern = new RegExp(`\\b${escapedFlag}\\b`, 'i')
  for (const pattern of patterns) {
    for (const match of segment.matchAll(pattern)) {
      if (match.index === undefined) {
        throw new Error('rollout assignment match omitted its index')
      }
      const relativeFlagIndex = match[0].search(flagPattern)
      if (relativeFlagIndex < 0) {
        throw new Error(`rollout assignment omitted ${flag}`)
      }
      const flagIndex = match.index + relativeFlagIndex
      assignments.set(flagIndex, { flagIndex })
    }
  }
  return [...assignments.values()].sort(
    (left, right) => left.flagIndex - right.flagIndex,
  )
}

function rolloutAssignmentIsNegated(prefix: string): boolean {
  const scopedPrefix = rolloutPredicateScope(prefix)
    .replace(/["'`]+\s*$/g, '')
    .trim()
  const assignmentVerb =
    '(?:assign(?:s|ed|ing)?|configur(?:e|es|ed|ing)|contain(?:s|ed|ing)?|declar(?:e|es|ed|ing)|defin(?:e|es|ed|ing)|enable(?:s|d|ing)?|flip(?:s|ped|ping)?|has|have|keep(?:s|ing)?|map(?:s|ped|ping)?|run(?:s|ning)?(?:\\s+with)?|set(?:s|ting)?|turn(?:s|ed|ing)?(?:\\s+on)?|use(?:s|d|ing)?)'

  if (
    new RegExp(
      `\\b(?:can|could|did|do|does|had|has|have|is|may|might|must|should|was|were|will|would)\\s+not(?:\\s+(?:actually|currently|directly|ever|explicitly|yet))?(?:\\s+${assignmentVerb})?\\s*$`,
      'i',
    ).test(scopedPrefix)
  ) {
    return true
  }
  if (
    new RegExp(`\\b(?:cannot|never)\\s+${assignmentVerb}\\s*$`, 'i').test(
      scopedPrefix,
    )
  ) {
    return true
  }
  if (
    new RegExp(
      `\\b(?:(?:ain|are|ca|could|did|do|does|had|has|have|is|might|must|need|should|was|were|wo|would)n['’]t)(?:\\s+(?:actually|currently|directly|ever|explicitly|yet))?(?:\\s+${assignmentVerb})?\\s*$`,
      'i',
    ).test(scopedPrefix)
  ) {
    return true
  }

  const no = [...scopedPrefix.matchAll(/\bno\b/gi)].at(-1)
  if (!no) {
    return false
  }
  const governedPrefix = scopedPrefix.slice(no.index + no[0].length).trim()
  const verb = governedPrefix.match(
    new RegExp(`\\b${assignmentVerb}\\s*$`, 'i'),
  )
  const governedSubject =
    verb?.index === undefined
      ? governedPrefix
      : governedPrefix.slice(0, verb.index).trim()
  if (governedSubject.length === 0) {
    return true
  }
  return /^(?:(?:any|config|credential|current|deployed|environment|flag|live|production|real|remote|route|runtime|setting|staging|the|tracked|writer)\s*)+$/i.test(
    governedSubject,
  )
}

function rolloutAssignmentIsExplicitlyLocal(prefix: string): boolean {
  if (
    new RegExp(
      `${liveEnvironmentPatternSource}[^,;.!?]*\\b(?:along\\s+with|and|as\\s+well\\s+as|together\\s+with)\\s+(?:the\\s+)?(?:local|loopback|synthetic)(?:[-\\s]+only)?[-\\s]+(?:fixture|harness|runtime|tests?)\\b`,
      'i',
    ).test(prefix)
  ) {
    return false
  }

  const scopedPrefix =
    prefix
      .split(
        /[,;]|\b(?:although|and|because|but|however|though|while|whereas|yet)\b/i,
      )
      .at(-1)
      ?.trim() ?? ''
  const localScope = [
    ...scopedPrefix.matchAll(
      /\b(?:local|loopback|synthetic)(?:[-\s]+only)?[-\s]+(?:fixture|harness|runtime|tests?)\b/gi,
    ),
  ].at(-1)
  if (!localScope || localScope.index === undefined) {
    return false
  }
  const beforeLocalScope = scopedPrefix.slice(0, localScope.index)
  if (
    /\b(?:non[-\s]*|not(?:\s+(?:actually|explicitly|truly))?\s+|isn['’]t\s+)$/i.test(
      beforeLocalScope,
    )
  ) {
    return false
  }
  const afterLocalScope = scopedPrefix.slice(
    localScope.index + localScope[0].length,
  )
  return !new RegExp(
    `${liveEnvironmentPatternSource}|${liveEnvironmentAliasPatternSource}|\\bthis\\s+environment\\b`,
    'i',
  ).test(afterLocalScope)
}

function rolloutPredicateScope(prefix: string): string {
  return (
    prefix
      .replace(/\bnot\s+yet\b/gi, 'not_yet')
      .split(
        /[,;:]|\b(?:although|and|because|but|however|though|while|whereas|yet)\b/i,
      )
      .at(-1)
      ?.replaceAll('not_yet', 'not yet')
      ?.trim() ?? ''
  )
}

function rolloutTableFragments(
  headingContext: string[],
  header: string[],
  row: string[],
): string[] {
  const flags = rolloutFlags.filter((flag) =>
    [...header, ...row].some((cell) =>
      new RegExp(`\\b${escapeRegExp(flag)}\\b`, 'i').test(cell),
    ),
  )
  const positiveValueIndexes = row.flatMap((cell, index) =>
    /^["']?(?:true|1|yes|on|enabled)(?:\s*\([^)]*\))?["']?$/i.test(cell.trim())
      ? [index]
      : [],
  )
  if (flags.length === 0 || positiveValueIndexes.length === 0) {
    return []
  }

  const explicitLiveContexts = row.filter((cell) =>
    hasLiveEnvironmentContext(cell),
  )
  const hasExplicitLocalContext = row.some((cell) =>
    hasExplicitLocalRolloutContext(cell),
  )
  const inheritedLiveContext = [...headingContext]
    .reverse()
    .find((heading) => hasLiveEnvironmentContext(heading))
  const fragments = new Set<string>()

  for (const flag of flags) {
    for (const valueIndex of positiveValueIndexes) {
      const matrixLiveContext = header[valueIndex]
      if (
        matrixLiveContext !== undefined &&
        hasLiveEnvironmentContext(matrixLiveContext)
      ) {
        fragments.add(`${matrixLiveContext} ${flag} is true`)
      }
      for (const liveContext of explicitLiveContexts) {
        fragments.add(`${liveContext} ${flag} is true`)
      }
      if (
        explicitLiveContexts.length === 0 &&
        !hasExplicitLocalContext &&
        matrixLiveContext !== undefined &&
        !hasLiveEnvironmentContext(matrixLiveContext) &&
        inheritedLiveContext !== undefined
      ) {
        fragments.add(`${inheritedLiveContext} ${flag} is true`)
      }
    }
  }
  return [...fragments]
}

function tableRowProseParts(header: string[], row: string[]): string[][] {
  const dimensionParts = row.flatMap((cell, index) => {
    const headerCell = header[index] ?? ''
    if (
      !/\b(?:environment|feature|operation|claim|flag|setting)\b/i.test(
        headerCell,
      ) &&
      !hasCredentialClaimContext(headerCell) &&
      !hasTrackedRolloutFlag(headerCell)
    ) {
      return []
    }
    return [headerCell, cell]
  })

  return row.map((cell, index) => [
    ...dimensionParts,
    header[index] ?? '',
    cell,
  ])
}

function proseFragments(document: Root): string[] {
  const fragments: string[] = []
  const referenceTitles = new Map<string, string | undefined>()
  walkMarkdown(document, (node) => {
    if (
      node.type === 'definition' &&
      !referenceTitles.has(node.identifier.toLowerCase())
    ) {
      referenceTitles.set(
        node.identifier.toLowerCase(),
        node.title ?? undefined,
      )
    }
  })
  let pendingAdjacentClaim:
    { headingKey: string; contextualParts: string[] } | undefined
  let pendingRolloutContext:
    { headingKey: string; contextualParts: string[] } | undefined
  let pendingLocalRolloutContext:
    { headingKey: string; contextualParts: string[] } | undefined

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
    literalBlock = false,
  ): void => {
    append(parts)
    const content = parts.join(' ').trim()
    const environmentHeadings = headingContext.filter((heading) =>
      hasLiveEnvironmentContext(heading),
    )
    const localHeadings = headingContext.filter((heading) =>
      hasScopedLocalRolloutContext(heading),
    )
    const localClaimHeadings = headingContext.filter((heading) =>
      hasLocalSectionHeadingContext(heading),
    )
    const credentialHeadings = headingContext.filter((heading) =>
      hasInheritableCredentialHeadingContext(heading),
    )
    const effectiveEnvironmentHeadings =
      localClaimHeadings.length > 0 ? [] : environmentHeadings
    const contextualParts = [
      ...effectiveEnvironmentHeadings,
      ...credentialHeadings,
      ...parts,
    ]
    const contextualContent = contextualParts.join(' ')
    const headingKey = headingContext.join('\u0000')
    const hasTrackedFlag = hasTrackedRolloutFlag(content)
    const inheritedLocalRolloutContext =
      literalBlock &&
      hasTrackedFlag &&
      pendingLocalRolloutContext?.headingKey === headingKey
        ? pendingLocalRolloutContext
        : undefined
    const inheritsLocalRolloutContext =
      inheritedLocalRolloutContext !== undefined
    const rolloutContextualParts = [
      ...environmentHeadings,
      ...(inheritedLocalRolloutContext?.contextualParts ?? []),
      ...localHeadings,
      ...parts,
    ]
    if (
      contextualParts.length > parts.length &&
      (effectiveEnvironmentHeadings.length > 0 ||
        hasLiveEnvironmentContext(content)) &&
      (hasCredentialClaimContext(contextualContent) ||
        hasTrackedRolloutFlag(contextualContent))
    ) {
      append(hasTrackedFlag ? rolloutContextualParts : contextualParts)
    }

    const hasExplicitLocalContext =
      localHeadings.length > 0 || hasScopedLocalRolloutContext(content)
    if (
      pendingRolloutContext?.headingKey === headingKey &&
      hasTrackedFlag &&
      !hasExplicitLocalContext
    ) {
      append([...pendingRolloutContext.contextualParts, ...parts])
    }
    if (
      pendingLocalRolloutContext !== undefined &&
      !inheritsLocalRolloutContext &&
      !hasExplicitLocalContext
    ) {
      pendingLocalRolloutContext = undefined
    }
    if (hasExplicitLocalContext) {
      pendingRolloutContext = undefined
      pendingLocalRolloutContext = hasTrackedFlag
        ? undefined
        : { headingKey, contextualParts: parts }
    } else if (hasTrackedFlag) {
      pendingRolloutContext = undefined
      pendingLocalRolloutContext = undefined
    } else if (
      environmentHeadings.length > 0 ||
      hasLiveEnvironmentContext(content)
    ) {
      pendingRolloutContext = { headingKey, contextualParts }
    } else if (pendingRolloutContext?.headingKey !== headingKey) {
      pendingRolloutContext = undefined
    }

    if (
      pendingAdjacentClaim?.headingKey === headingKey &&
      isStandaloneAffirmativeStatus(content) &&
      !hasCredentialClaimContext(content) &&
      !/\b(?:fixture|local|synthetic)\b/i.test(content)
    ) {
      append(
        [...pendingAdjacentClaim.contextualParts, ...parts].map((part) =>
          part.replace(/[.;!?]+\s*$/g, ''),
        ),
      )
      pendingAdjacentClaim = undefined
      return
    }

    const nextPendingClaim =
      (effectiveEnvironmentHeadings.length > 0 ||
        hasLiveEnvironmentContext(content)) &&
      hasCredentialClaimContext(contextualContent) &&
      !hasAffirmativeLiveStatus(contextualContent)
        ? { headingKey, contextualParts }
        : undefined
    if (nextPendingClaim) {
      pendingAdjacentClaim = nextPendingClaim
      return
    }
    if (pendingAdjacentClaim?.headingKey !== headingKey) {
      pendingAdjacentClaim = undefined
      return
    }
    if (
      hasAffirmativeLiveStatus(content) ||
      hasCredentialClaimContext(content)
    ) {
      pendingAdjacentClaim = undefined
    }
  }

  const visitChildren = (
    children: Nodes[],
    inheritedHeadingContext: string[],
  ): void => {
    let headingContext = [...inheritedHeadingContext]
    for (const child of children) {
      if (child.type === 'html') {
        appendWithHeadingContext(headingContext, [
          htmlElementProse(child.value),
        ])
        continue
      }
      if (child.type === 'heading') {
        const previousHeadingDepth = headingContext.length
        const headingText = markdownProseText(child, referenceTitles).trim()
        const completesPendingClaim =
          child.depth > previousHeadingDepth &&
          pendingAdjacentClaim !== undefined &&
          pendingAdjacentClaim.headingKey === headingContext.join('\u0000') &&
          isStandaloneAffirmativeStatus(headingText) &&
          !hasScopedLocalRolloutContext(headingText)
        if (completesPendingClaim && pendingAdjacentClaim !== undefined) {
          append([...pendingAdjacentClaim.contextualParts, headingText])
          pendingAdjacentClaim = undefined
        }
        headingContext = headingContext.slice(0, child.depth - 1)
        headingContext[child.depth - 1] = headingText
        const headingKey = headingContext.join('\u0000')
        const nestedNeutralHeading =
          child.depth > previousHeadingDepth &&
          !hasLiveEnvironmentContext(headingText) &&
          !hasScopedLocalRolloutContext(headingText)
        if (nestedNeutralHeading && pendingRolloutContext !== undefined) {
          pendingRolloutContext.headingKey = headingKey
        } else {
          pendingRolloutContext = undefined
        }
        if (nestedNeutralHeading && pendingLocalRolloutContext !== undefined) {
          pendingLocalRolloutContext.headingKey = headingKey
        } else {
          pendingLocalRolloutContext = undefined
        }
        if (
          !completesPendingClaim &&
          nestedNeutralHeading &&
          pendingAdjacentClaim !== undefined
        ) {
          pendingAdjacentClaim.headingKey = headingKey
        } else {
          pendingAdjacentClaim = undefined
        }
        append([...headingContext])
        continue
      }
      if (child.type === 'paragraph') {
        const text = markdownProseText(child, referenceTitles).trim()
        appendWithHeadingContext(headingContext, [text])
        continue
      }
      if (child.type === 'table') {
        const [header, ...rows] = child.children.map((row) =>
          row.children.map((cell) =>
            markdownProseText(cell, referenceTitles).trim(),
          ),
        )
        for (const row of rows) {
          appendWithHeadingContext(headingContext, row)
          for (const parts of tableRowProseParts(header ?? [], row)) {
            appendWithHeadingContext(headingContext, parts)
          }
          for (const fragment of rolloutTableFragments(
            headingContext,
            header ?? [],
            row,
          )) {
            append([fragment])
          }
        }
        continue
      }
      if (child.type === 'code') {
        // Join shell line-continuations and always scan the full fence so
        // `--env production` on one line and `--var FLAG=true` on the next
        // cannot hide a live assignment even without trailing `\`.
        const lines = joinBackslashContinuedLines(child.value.split(/\r?\n/))
        const fullFence = lines
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .join(' ')
        for (const line of lines) {
          append([line])
        }
        if (fullFence.length > 0) {
          append([fullFence])
        }
        if (!commandFragmentIsInstruction(fullFence || lines.join(' '))) {
          appendWithHeadingContext(headingContext, lines, true)
        }
        continue
      }
      if ('children' in child) {
        visitChildren(child.children as Nodes[], headingContext)
      }
    }
  }

  visitChildren(document.children as Nodes[], [])
  walkMarkdown(document, (node) => {
    if ('title' in node && typeof node.title === 'string') {
      append([node.title])
    }
  })
  return fragments
}

function isStandaloneAffirmativeStatus(value: string): boolean {
  return liveStatusMatches(value).some((status) => {
    const prefixWords = value
      .slice(0, status.index)
      .replace(/[:|]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0)
    const suffix = value.slice(status.index + status[0].length)
    return (
      prefixWords.every((word) =>
        [
          'deployment',
          'environment',
          'operation',
          'release',
          'rollout',
          'status',
        ].includes(word.toLowerCase()),
      ) && /^[\s:;,.!?|()-]*$/.test(suffix)
    )
  })
}

function markdownProseText(
  node: Nodes,
  referenceTitles: ReadonlyMap<string, string | undefined>,
): string {
  if (node.type === 'text') {
    return node.value
  }
  if (node.type === 'inlineCode') {
    return node.value
  }
  if (node.type === 'html') {
    // mdast keeps open/close tags as raw HTML; attribute prose (title/alt)
    // would otherwise be discarded with the tag.
    return htmlElementProse(node.value)
  }
  if (node.type === 'code') {
    return ''
  }
  if (node.type === 'break') {
    return ' '
  }
  if (node.type === 'image' || node.type === 'imageReference') {
    const title =
      node.type === 'image'
        ? node.title
        : referenceTitles.get(node.identifier.toLowerCase())
    return [node.alt ?? '', title ?? ''].filter(Boolean).join(' ')
  }

  const content =
    'children' in node
      ? joinMarkdownProseChildren(node.children as Nodes[], referenceTitles)
      : ''
  if (node.type === 'link') {
    return [content, node.title ?? ''].filter(Boolean).join(' ')
  }
  if (node.type === 'linkReference') {
    return [content, referenceTitles.get(node.identifier.toLowerCase()) ?? '']
      .filter(Boolean)
      .join(' ')
  }
  return content
}

function joinMarkdownProseChildren(
  children: Nodes[],
  referenceTitles: ReadonlyMap<string, string | undefined>,
): string {
  let content = ''
  let previousNode: Nodes | undefined
  let previousText = ''
  for (const child of children) {
    const childText = markdownProseText(child, referenceTitles)
    if (
      previousNode !== undefined &&
      previousText.length > 0 &&
      childText.length > 0 &&
      !/\s$/.test(previousText) &&
      !/^\s/.test(childText) &&
      !inlineFormattingNodesMayJoin(previousNode, child)
    ) {
      content += ' '
    }
    content += childText
    previousNode = child
    previousText = childText
  }
  return content
}

function inlineFormattingNodesMayJoin(left: Nodes, right: Nodes): boolean {
  const formattingTypes = new Set([
    'delete',
    'emphasis',
    'inlineCode',
    'strong',
    'text',
  ])
  if (formattingTypes.has(left.type) && formattingTypes.has(right.type)) {
    return true
  }

  const renderedTextTypes = new Set([
    ...formattingTypes,
    'link',
    'linkReference',
  ])
  return (
    renderedTextTypes.has(left.type) &&
    renderedTextTypes.has(right.type) &&
    left.position?.end.offset !== undefined &&
    left.position.end.offset === right.position?.start.offset
  )
}

function normalizeCredentialSpellings(value: string): string {
  let normalized = value
  for (const { canonical, prose } of registryCredentialSpellings) {
    normalized = normalized.replace(
      new RegExp(`\\b${escapeRegExp(canonical)}\\b`, 'gi'),
      prose,
    )
  }
  return normalized
}

interface IndexedRegExpMatch extends RegExpMatchArray {
  index: number
}

function liveEnvironmentMatches(value: string): IndexedRegExpMatch[] {
  const aliases = indexedMatches(
    value,
    new RegExp(liveEnvironmentAliasPatternSource, 'gi'),
  ).filter((match) => liveAliasHasCredentialContext(value, match))
  return [
    ...indexedMatches(value, new RegExp(liveEnvironmentPatternSource, 'gi')),
    ...aliases,
  ].sort((left, right) => left.index - right.index)
}

function liveAliasHasCredentialContext(
  value: string,
  alias: IndexedRegExpMatch,
): boolean {
  const afterAlias = value.slice(alias.index + alias[0].length)
  if (
    alias[0].toLowerCase() === 'live' &&
    /^\s+(?:(?:release|technical)\s+)?(?:documentation|docs?|guide|index|page|report)\b/i.test(
      afterAlias,
    )
  ) {
    return false
  }

  const boundaryPattern =
    /[,;:]|\b(?:although|and|because|but|however|though|while|whereas|yet)\b/gi
  const beforeAlias = value.slice(0, alias.index)
  const leftBoundary = [...beforeAlias.matchAll(boundaryPattern)].at(-1)
  const rightBoundary = afterAlias.match(
    /[,;:]|\b(?:although|and|because|but|however|though|while|whereas|yet)\b/i,
  )
  const scopeStart = leftBoundary
    ? leftBoundary.index + leftBoundary[0].length
    : 0
  const scopeEnd =
    rightBoundary?.index === undefined
      ? value.length
      : alias.index + alias[0].length + rightBoundary.index
  return hasCredentialClaimContext(value.slice(scopeStart, scopeEnd))
}

function liveStatusMatches(value: string): IndexedRegExpMatch[] {
  const statuses = [
    ...indexedMatches(value, new RegExp(liveStatusPatternSource, 'gi')),
    ...indexedMatches(
      value,
      /\b(?:there\s+(?:is|are|was|were)|has|have|had)\b/gi,
    ).filter((status) =>
      existentialStatusClaimsCredentialEvidence(value, status),
    ),
  ]
  const uniqueStatuses = new Map<string, IndexedRegExpMatch>()
  for (const status of statuses) {
    uniqueStatuses.set(`${status.index}:${status[0].toLowerCase()}`, status)
  }
  return [...uniqueStatuses.values()].sort(
    (left, right) => left.index - right.index,
  )
}

function existentialStatusClaimsCredentialEvidence(
  value: string,
  status: IndexedRegExpMatch,
): boolean {
  const scope =
    value
      .slice(status.index + status[0].length)
      .split(/[.;!?]/, 1)[0]
      ?.trim() ?? ''
  const evidence = scope.match(/\b(?:evidence|proof|records?)\b/i)
  if (evidence?.index === undefined) {
    return false
  }
  const beforeEvidence = scope.slice(0, evidence.index)
  if (
    /\b(?:intent|need|no|not|plan(?:ned|s)?|proposal|request|requirement)\b/i.test(
      beforeEvidence,
    )
  ) {
    return false
  }
  return hasCredentialClaimContext(scope)
}

function indexedMatches(value: string, pattern: RegExp): IndexedRegExpMatch[] {
  const matches: IndexedRegExpMatch[] = []
  for (const match of value.matchAll(pattern)) {
    if (match.index === undefined) {
      throw new Error('global regular-expression match omitted its index')
    }
    matches.push(match as IndexedRegExpMatch)
  }
  return matches
}

function hasAffirmativeLiveStatus(value: string): boolean {
  return liveStatusMatches(value).length > 0
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasTrackedRolloutFlag(value: string): boolean {
  return rolloutFlags.some((flag) =>
    new RegExp(`\\b${escapeRegExp(flag)}\\b`, 'i').test(value),
  )
}

function hasExplicitLocalRolloutContext(value: string): boolean {
  for (const match of value.matchAll(
    /\b(?:fixture|harness|local|loopback|synthetic)\b/gi,
  )) {
    if (match.index === undefined) {
      throw new Error('local rollout context match omitted its index')
    }
    const scopedPrefix = rolloutPredicateScope(value.slice(0, match.index))
      .replace(/\bnot\s+only\b/gi, '')
      .trim()
    if (
      /\b(?:no|not|never)\b/i.test(scopedPrefix) ||
      /\b\w+n['’]t\b/i.test(scopedPrefix) ||
      /\bnon[-\s]*$/i.test(scopedPrefix)
    ) {
      continue
    }
    return true
  }
  return false
}

function hasScopedLocalRolloutContext(value: string): boolean {
  // Bare "local" is not enough to drop production pending context.
  return (
    /\b(?:fixture|harness|loopback|synthetic)\b/i.test(value) ||
    /\blocal(?:[-\s]+only)?[-\s]+(?:fixture|harness|runtime|tests?)\b/i.test(
      value,
    )
  )
}

function hasLocalSectionHeadingContext(value: string): boolean {
  return (
    /\b(?:fixture|loopback|synthetic)\b/i.test(value) ||
    /\blocal(?:[-\s]+only)?[-\s]+(?:fixture|harness|runtime|tests?)\b/i.test(
      value,
    )
  )
}

function hasInheritableCredentialHeadingContext(value: string): boolean {
  return (
    hasCredentialClaimContext(value) &&
    !/\b(?:closeout|documentation|evidence|index|limitations?|packet|registry|summary)\b/i.test(
      value,
    )
  )
}

function unsupportedLiveCredentialClaim(text: string): boolean {
  const normalized = normalizeCredentialSpellings(text)
    .replaceAll('|', ' ')
    // Appositive status after a comma: "Production password change, verified."
    .replace(
      /,\s*(?=(?:verified|validated|proven|recorded|enabled|disabled|activated|active|approved|available|complete|completed|deployed|documented|live|operational|passed|ready|released|shipped|confirmed|demonstrated|true|yes|ok)\b)/gi,
      ' is ',
    )
    .replace(/\s+/g, ' ')
    .trim()
  if (commandFragmentIsInstruction(normalized)) {
    return false
  }
  const clauses = normalized
    .split(/[.;!]+/)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0)
  const boundedClauses = [...clauses]
  let pendingAdjacentClause: string | undefined
  for (const current of clauses) {
    if (
      pendingAdjacentClause !== undefined &&
      isStandaloneAffirmativeStatus(current) &&
      !/\b(?:fixture|harness|local|loopback|synthetic)\b/i.test(current)
    ) {
      boundedClauses.push(`${pendingAdjacentClause} ${current}`)
      pendingAdjacentClause = undefined
      continue
    }

    if (
      liveEnvironmentMatches(current).length > 0 &&
      hasCredentialClaimContext(current) &&
      !hasAffirmativeLiveStatus(current)
    ) {
      pendingAdjacentClause = current
      continue
    }
    if (
      hasAffirmativeLiveStatus(current) ||
      hasCredentialClaimContext(current) ||
      liveEnvironmentMatches(current).length > 0
    ) {
      pendingAdjacentClause = undefined
    }
  }

  for (const clause of boundedClauses) {
    const environments = liveEnvironmentMatches(clause)
    if (environments.length === 0) {
      continue
    }

    const hasCredentialContext = hasCredentialClaimContext(clause)
    if (hasCredentialContext) {
      const statuses = liveStatusMatches(clause)
      for (const status of statuses) {
        const distinctEnvironmentCandidates =
          status[0].toLowerCase() === 'live'
            ? environments.filter(
                (environment) => environment.index !== status.index,
              )
            : environments
        const bareLiveStatus = bareLiveStatusUsesEnvironmentAlias(
          clause,
          status,
          environments,
        )
        const sameLiveEnvironment = environments.find(
          (environment) => environment.index === status.index,
        )
        const environmentCandidates =
          distinctEnvironmentCandidates.length === 0 &&
          bareLiveStatus &&
          sameLiveEnvironment
            ? [sameLiveEnvironment]
            : distinctEnvironmentCandidates
        if (environmentCandidates.length === 0) {
          continue
        }
        const environment = environmentCandidates.reduce(
          (nearest, candidate) =>
            Math.abs(candidate.index - status.index) <
            Math.abs(nearest.index - status.index)
              ? candidate
              : nearest,
        )
        if (
          !bareLiveStatus &&
          !statusDescribesEnvironmentClaim(
            clause,
            environment.index,
            status.index,
            status[0].length,
          )
        ) {
          continue
        }
        if (
          !liveClaimIsNegated(clause, environment.index, status.index) &&
          !liveClaimIsNonAssertive(
            clause,
            environment.index,
            status.index,
            status[0],
          )
        ) {
          return true
        }
      }
    }

    const proofPattern = new RegExp(
      String.raw`\b(?:packet|registry|closeout|evidence)\s+(?:verifies|proves|records|confirms|demonstrates)\s+(?:tracked\s+)?${liveEnvironmentPatternSource}`,
      'gi',
    )
    for (const match of clause.matchAll(proofPattern)) {
      const environmentOffset = match[0].search(
        new RegExp(liveEnvironmentPatternSource, 'i'),
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

function commandFragmentIsInstruction(value: string): boolean {
  return /^(?:[$>#]\s*)?(?:bun|curl|git|node|npm|npx|pnpm|wrangler|yarn)\b[\s\S]*\s--(?:env|mode)\b/i.test(
    value.trim(),
  )
}

function joinBackslashContinuedLines(lines: string[]): string[] {
  const joined: string[] = []
  let pending = ''
  for (const line of lines) {
    const continuation = /\\[ \t]*$/.test(line)
    const body = continuation ? line.replace(/\\[ \t]*$/, '') : line
    pending = pending.length === 0 ? body : `${pending} ${body.trimStart()}`
    if (!continuation) {
      joined.push(pending)
      pending = ''
    }
  }
  if (pending.length > 0) {
    joined.push(pending)
  }
  return joined
}

function htmlElementProse(value: string): string {
  const attributeValues: string[] = []
  for (const match of value.matchAll(
    /\b(?:title|alt|aria-label)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"'=]+))/gi,
  )) {
    attributeValues.push(match[1] ?? match[2] ?? match[3] ?? '')
  }
  return [...attributeValues, value.replace(/<[^>]*>/g, ' ')].join(' ')
}

function bareLiveStatusUsesEnvironmentAlias(
  clause: string,
  status: IndexedRegExpMatch,
  environments: IndexedRegExpMatch[],
): boolean {
  if (
    status[0].toLowerCase() !== 'live' ||
    !environments.some((environment) => environment.index === status.index)
  ) {
    return false
  }
  const beforeStatus = clause.slice(0, status.index)
  return (
    /\b(?:(?:is|are|was|were|has\s+been|have\s+been)\s+(?:(?:currently|now|already|fully)\s+)?|(?:goes|went|became|becomes|has\s+gone|have\s+gone|has\s+become|have\s+become)\s+)$/i.test(
      beforeStatus,
    ) && hasCredentialClaimContext(beforeStatus)
  )
}

function statusDescribesEnvironmentClaim(
  clause: string,
  environmentIndex: number,
  statusIndex: number,
  statusLength: number,
): boolean {
  const beforeStatus = clause.slice(0, statusIndex)
  const linkingVerb = beforeStatus.match(
    /\b(?:is|are|was|were|has\s+been|have\s+been)\s*$/i,
  )
  if (linkingVerb?.index !== undefined) {
    const beforeSubject = beforeStatus.slice(0, linkingVerb.index)
    const boundaries = [
      ...beforeSubject.matchAll(
        /[,;:]|\b(?:after|although|and|because|before|but|however|if|once|though|until|when|while|whereas|yet)\b/gi,
      ),
    ]
    const boundary = boundaries.at(-1)
    const subject = beforeSubject.slice(
      boundary ? boundary.index + boundary[0].length : 0,
    )
    const afterStatus = clause.slice(statusIndex + statusLength)
    const predicateComplement =
      afterStatus.split(
        /[,;:]|\b(?:although|and|because|but|however|though|while|whereas|yet)\b/i,
      )[0] ?? ''
    return (
      hasCredentialClaimContext(subject) ||
      hasCredentialClaimContext(predicateComplement)
    )
  }

  const start = Math.min(environmentIndex, statusIndex)
  const end = Math.max(environmentIndex, statusIndex)
  const relation = clause.slice(start, end)
  const boundaryPattern =
    /[,;]|\b(?:although|and|because|but|however|though|while|whereas|yet)\b/gi
  if (boundaryPattern.test(relation)) {
    return false
  }

  const beforeRelation = clause.slice(0, start)
  const leftBoundary = [
    ...beforeRelation.matchAll(
      /[,;:]|\b(?:although|and|because|but|however|though|while|whereas|yet)\b/gi,
    ),
  ].at(-1)
  const afterRelation = clause.slice(end)
  const statusIntroducesTrailingLabel =
    statusIndex < environmentIndex &&
    /^(?:status\s*:\s*)?$/i.test(clause.slice(0, statusIndex))
  const rightBoundary = afterRelation.match(
    statusIntroducesTrailingLabel
      ? /[,;]|\b(?:although|and|because|but|however|though|while|whereas|yet)\b/i
      : /[,;:]|\b(?:although|and|because|but|however|though|while|whereas|yet)\b/i,
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
  const normalizedClause = normalizeCredentialSpellings(clause)
  if (
    registryCredentialSpellings.some(({ prose }) =>
      normalizedClause.toLowerCase().includes(prose.toLowerCase()),
    )
  ) {
    return true
  }
  if (
    /\b(?:(?:master[-\s]+)?password[-\s]+(?:changes?|updates?|resets?|verify|verification|mutation|rotation)|kdf(?:[-\s]+mutation)?|account[-\s]+key(?:[-\s]+(?:initialization|rotation|read))?|user[-\s]+key(?:[-\s]+rotation)?|credential[-\s]+writer|writer|recovery|disabled[-\s]+writers?|writers?[-\s]+disabled|forward[-\s]+generation)\b/i.test(
      normalizedClause,
    )
  ) {
    return true
  }
  if (
    /\brestor(?:e|es|ed|ation)\b/i.test(normalizedClause) &&
    /\b(?:account|backup|credential|d1|r2|recovery|vault|writer)\b/i.test(
      normalizedClause,
    )
  ) {
    return true
  }
  if (
    /\bcredential\b/i.test(normalizedClause) &&
    /\b(?:activation|evidence|writer|run|operation|lifecycle|mutation|rotation|readback|recovery|backup|restore|restoration|generation)\b/i.test(
      normalizedClause,
    )
  ) {
    return true
  }
  return (
    /\bbackup[-\s]+export\b/i.test(normalizedClause) &&
    /\b(?:staging|prod(?:uction)?|live|cloudflare|real[-\s]+account)\b/i.test(
      normalizedClause,
    )
  )
}

function hasLiveEnvironmentContext(value: string): boolean {
  return (
    new RegExp(liveEnvironmentPatternSource, 'i').test(value) ||
    /^(?:live|cloudflare)(?:[-\s]+(?:account|credential|deployment|environment|production|rollout|runtime|settings?|workers?)){0,3}$/i.test(
      value.trim(),
    )
  )
}

function liveClaimIsNegated(
  clause: string,
  environmentIndex: number,
  statusIndex: number,
): boolean {
  const beforeStatus = clause.slice(0, statusIndex)
  const beforeEnvironment = clause.slice(0, environmentIndex)
  if (
    /\b(?:not|never)(?:\s+(?:actually|currently|ever|yet|fully|completely|independently))?(?:\s+been)?(?:\s+an?)?\s*$/i.test(
      beforeStatus,
    )
  ) {
    return true
  }
  if (/\b(?:unexecuted|unperformed)(?:\s+future)?\s*$/i.test(beforeStatus)) {
    return true
  }
  if (
    /\b(?:(?:ain|are|ca|could|did|do|does|had|has|have|is|might|must|need|should|was|were|wo|would)n['’]t)(?:\s+(?:actually|currently|ever|yet|fully|completely|independently))?(?:\s+been)?(?:\s+an?)?\s*$/i.test(
      beforeStatus,
    )
  ) {
    return true
  }
  const neither = [...beforeStatus.matchAll(/\bneither\b/gi)].at(-1)
  if (neither?.index !== undefined) {
    const beforeNeither = beforeStatus.slice(0, neither.index)
    const neitherScope = beforeStatus.slice(neither.index + neither[0].length)
    const hasScopeBreak =
      /[,;:]|\b(?:although|and|because|but|however|that|though|whereas|yet)\b/i.test(
        neitherScope,
      )
    const predicateNegation =
      neither.index > environmentIndex &&
      /\b(?:are|had(?:\s+been)?|has(?:\s+been)?|have(?:\s+been)?|is|was|were)\s*$/i.test(
        beforeNeither,
      )
    const coordinatedSubjectNegation =
      neither.index <= environmentIndex &&
      /\bnor\b/i.test(neitherScope) &&
      /\b(?:are|had(?:\s+been)?|has(?:\s+been)?|have(?:\s+been)?|is|was|were)\s*$/i.test(
        neitherScope,
      )
    if (!hasScopeBreak && (predicateNegation || coordinatedSubjectNegation)) {
      return true
    }
  }

  const negator = [...beforeEnvironment.matchAll(/\bno\b/gi)].at(-1)
  if (!negator) {
    return false
  }
  const scope = beforeEnvironment
    .slice(negator.index + negator[0].length)
    .trim()
  if (
    /[,;:]|\b(?:after|although|and|because|before|but|however|if|once|that|though|until|when|while|whereas|yet)\b/i.test(
      scope,
    )
  ) {
    return false
  }
  if (scope.length === 0) {
    return true
  }
  if (
    /^(?:(?:any|current|documented|live|official|real|remote|staging|the|tracked)\s*)+$/i.test(
      scope,
    )
  ) {
    return true
  }
  if (
    (hasLiveEnvironmentContext(scope) || /\blive\b/i.test(scope)) &&
    !/\b(?:am|are|be|been|being|can|could|did|do|does|had|has|have|is|may|might|must|need(?:s|ed)?|remain(?:s|ed)?|require(?:s|d)?|should|show(?:s|ed)?|was|were|will|would)\b/i.test(
      scope,
    )
  ) {
    return true
  }
  if (
    /^(?:any\s+)?(?:claim|evidence|proof|record)\b[\w\s-]{0,80}\b(?:confirms?|demonstrates?|documents?|proves?|records?|validates?|verifies?)\s*$/i.test(
      scope,
    )
  ) {
    return true
  }
  if (
    /\b(?:nor|or)\s*$/i.test(scope) &&
    /\b(?:client|fixture|harness|local|settings?|tests?|ui)\b/i.test(scope) &&
    !/\b(?:doubt|question|reason)\b/i.test(scope)
  ) {
    return true
  }
  return hasCredentialClaimContext(scope) && /\b(?:nor|or)\s*$/i.test(scope)
}

function liveClaimIsNonAssertive(
  clause: string,
  environmentIndex: number,
  statusIndex: number,
  status = '',
): boolean {
  const beforeStatus = clause.slice(0, statusIndex)
  if (commandFragmentIsInstruction(clause)) {
    return true
  }
  if (/\?\s*$/.test(clause)) {
    return true
  }
  if (
    /^(?:approved|available|documented)\s+(?:(?:recovery|rollback)\s+)?(?:command|plan|procedure|strategy)\b/i.test(
      clause.slice(statusIndex).trim(),
    )
  ) {
    return true
  }
  if (
    /\bremains?\s+(?:intentionally\s+)?(?:unexecuted|unperformed)\b/i.test(
      clause.slice(statusIndex + status.length),
    )
  ) {
    return true
  }
  if (
    /\b(?:will|would|must|should|could|may|might|needs?\s+to)(?:\s+(?:be|have\s+been|go|become))?\s*$/i.test(
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
  const afterStatus = clause.slice(statusIndex + status.length)
  if (
    /\b(?:has|have)\s+been\s*$/i.test(beforeStatus) &&
    /^\s*(?:\b(?:for|in|on|with)\b[^,;.!?]{1,80})?,\s*(?:archive|attach|continue|create|deploy|disable|enable|keep|mark|merge|move|proceed|promote|publish|record|run|update|write)\b/i.test(
      afterStatus,
    )
  ) {
    return true
  }
  if (
    /\b(?:was|were|has\s+been|have\s+been|had\s+been)\s*$/i.test(
      beforeStatus,
    ) ||
    /^(?:was|were)\s+present\b/i.test(clause.slice(statusIndex))
  ) {
    return false
  }
  if (
    /^(?:activated|approved|completed|confirmed|demonstrated|deployed|documented|functioned|passed|proven|recorded|released|rolled\s+out|shipped|succeeded|tested(?:\s+successfully)?|validated|verified|worked)$/i.test(
      status,
    ) &&
    !/\b(?:are|be|being|become|becomes|gets?|is)\s*$/i.test(beforeStatus)
  ) {
    return false
  }
  if (
    /^(?:active|available|complete|live|operational|ready|successful)$/i.test(
      status,
    ) &&
    /\b(?:became|has\s+become|has\s+gone|went)\s*$/i.test(beforeStatus)
  ) {
    return false
  }
  return (
    (hasLiveEnvironmentContext(scope) && hasCredentialClaimContext(scope)) ||
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
  if (node.type === 'break') {
    return ' '
  }
  if (node.type === 'image' || node.type === 'imageReference') {
    return node.alt ?? ''
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

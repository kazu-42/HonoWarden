import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// @ts-expect-error repository verifier intentionally ships as plain ESM.
import * as credentialEvidence from '../../scripts/honowarden-credential-evidence.mjs'

const {
  credentialEvidenceLevels,
  credentialEvidenceSources,
  credentialOperations,
  loadCredentialEvidenceRegistry,
  validateCredentialEvidenceRegistry,
} = credentialEvidence

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const registryPath = fileURLToPath(
  new URL('../../compat/credential-evidence.json', import.meta.url).toString(),
)
const schemaPath = fileURLToPath(
  new URL(
    '../../compat/credential-evidence.schema.json',
    import.meta.url,
  ).toString(),
)

describe('credential evidence contract', () => {
  it('loads the canonical registry with exact conservative evidence levels', () => {
    const registry = loadCredentialEvidenceRegistry({ repoRoot })

    expect(registry.schemaVersion).toBe(1)
    expect(registry.evidenceLevels).toEqual(credentialEvidenceLevels)
    expect(registry.sources).toEqual(credentialEvidenceSources)
    expect(
      registry.claims.map((claim: { operation: string }) => claim.operation),
    ).toEqual(credentialOperations)
    expect(registry.claims).toHaveLength(11)
    expect(
      registry.claims.some(
        (claim: { evidenceLevel: string }) =>
          claim.evidenceLevel === 'staging' ||
          claim.evidenceLevel === 'production',
      ),
    ).toBe(false)
  })

  it('binds every claim to an exact source generation, artifact, and limitation', () => {
    const registry = loadCredentialEvidenceRegistry({ repoRoot })

    for (const claim of registry.claims) {
      expect(claim.id).toMatch(/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/)
      expect(claim.sourceGeneration.commit).toMatch(/^[0-9a-f]{40}$/)
      expect(['merge_commit', 'reviewed_head']).toContain(
        claim.sourceGeneration.kind,
      )
      expect(claim.artifacts.length).toBeGreaterThan(0)
      expect(claim.limitations.length).toBeGreaterThan(0)
      expect(
        claim.artifacts.some((artifact: { requiredMarkers: string[] }) =>
          artifact.requiredMarkers.includes(claim.sourceGeneration.commit),
        ),
      ).toBe(true)
    }
  })

  it('records pinned client metadata only for official-client claims', () => {
    const registry = loadCredentialEvidenceRegistry({ repoRoot })

    for (const claim of registry.claims) {
      if (claim.evidenceLevel === 'local_official_client') {
        expect(claim.executionLevel).toBe('local_api')
        expect(claim.clientEvidence.length).toBeGreaterThan(0)
        expect(
          claim.artifacts.some(
            (artifact: { evidenceLevel: string }) =>
              artifact.evidenceLevel === 'local_official_client',
          ),
        ).toBe(true)
      } else {
        expect(claim.clientEvidence).toBeUndefined()
      }
    }
  })

  it('ships a closed JSON schema for the registry surface', async () => {
    const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as {
      $schema: string
      additionalProperties: boolean
      required: string[]
      properties: {
        evidenceLevels: { items: { properties: { id: { enum: string[] } } } }
        claims: {
          items: {
            additionalProperties: boolean
            properties: { operation: { enum: string[] } }
          }
        }
      }
      $defs: {
        artifact: { properties: { path: { pattern: string } } }
      }
    }

    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(schema.additionalProperties).toBe(false)
    expect(schema.required).toEqual([
      'schemaVersion',
      'evidenceLevels',
      'sources',
      'claims',
    ])
    expect(schema.properties.evidenceLevels.items.properties.id.enum).toEqual(
      credentialEvidenceLevels.map((level: { id: string }) => level.id),
    )
    expect(schema.properties.claims.items.properties.operation.enum).toEqual(
      credentialOperations,
    )
    expect(schema.properties.claims.items.additionalProperties).toBe(false)
    const artifactPath = new RegExp(
      schema.$defs.artifact.properties.path.pattern,
    )
    expect(artifactPath.test('docs/release/evidence.md')).toBe(true)
    expect(artifactPath.test('../outside.md')).toBe(false)
    expect(artifactPath.test('docs/../outside.md')).toBe(false)
  })

  it.each([
    [
      'unknown operation',
      (registry: Registry) => {
        requiredClaim(registry, 0).operation = 'account.unknown'
      },
      /unknown operation/,
    ],
    [
      'duplicate claim id',
      (registry: Registry) => {
        requiredClaim(registry, 1).id = requiredClaim(registry, 0).id
      },
      /duplicate claim id/,
    ],
    [
      'duplicate operation',
      (registry: Registry) => {
        requiredClaim(registry, 1).operation = requiredClaim(
          registry,
          0,
        ).operation
      },
      /duplicate operation/,
    ],
    [
      'evidence-level inflation',
      (registry: Registry) => {
        requiredClaim(registry, 0).evidenceLevel = 'staging'
      },
      /staging claim requires staging environment evidence/,
    ],
    [
      'invalid live evidence timestamp',
      (registry: Registry) => {
        const claim = requiredClaim(registry, 0)
        claim.evidenceLevel = 'staging'
        requiredArtifact(claim, 0).evidenceLevel = 'staging'
        claim.environmentEvidence = {
          environment: 'staging',
          deploymentRef: 'deployment-reference',
          recordedAt: '2026-13-40T00:00:00Z',
        }
      },
      /recordedAt must be an exact UTC timestamp/,
    ],
    [
      'unbound live environment metadata',
      (registry: Registry) => {
        const claim = requiredClaim(registry, 0)
        claim.evidenceLevel = 'staging'
        requiredArtifact(claim, 0).evidenceLevel = 'staging'
        claim.environmentEvidence = {
          environment: 'staging',
          deploymentRef: 'deployment-reference',
          recordedAt: '2026-07-22T00:00:00Z',
        }
      },
      /live environment evidence must be artifact-bound/,
    ],
    [
      'missing source generation',
      (registry: Registry) => {
        requiredClaim(registry, 0).sourceGeneration.commit = 'f'.repeat(40)
      },
      /source generation is not an exact artifact marker/,
    ],
    [
      'local API artifact for official client claim',
      (registry: Registry) => {
        const claim = registry.claims.find(
          (candidate) => candidate.evidenceLevel === 'local_official_client',
        )
        if (!claim) throw new Error('official client fixture missing')
        for (const artifact of claim.artifacts) {
          artifact.evidenceLevel = 'local_api'
        }
      },
      /requires an exact local_official_client artifact/,
    ],
    [
      'missing official client metadata',
      (registry: Registry) => {
        const claim = registry.claims.find(
          (candidate) => candidate.evidenceLevel === 'local_official_client',
        )
        if (!claim) throw new Error('official client fixture missing')
        delete claim.clientEvidence
      },
      /requires clientEvidence/,
    ],
    [
      'path escape',
      (registry: Registry) => {
        requiredArtifact(requiredClaim(registry, 0), 0).path = '../outside.md'
      },
      /artifact path is not canonical/,
    ],
    [
      'missing tracked artifact',
      (registry: Registry) => {
        requiredArtifact(requiredClaim(registry, 0), 0).path =
          'docs/release/missing.md'
      },
      /artifact is not tracked/,
    ],
    [
      'missing artifact marker',
      (registry: Registry) => {
        requiredArtifact(requiredClaim(registry, 0), 0).requiredMarkers.push(
          'marker-that-does-not-exist',
        )
      },
      /artifact marker is missing/,
    ],
    [
      'inconsistent client source',
      (registry: Registry) => {
        const claim = registry.claims.find(
          (candidate) => candidate.clientEvidence?.length,
        )
        if (!claim?.clientEvidence) throw new Error('client fixture missing')
        const clientEvidence = claim.clientEvidence[0]
        if (!clientEvidence) throw new Error('client fixture missing')
        clientEvidence.sourceId = 'unknown-client'
      },
      /unknown client source/,
    ],
    [
      'unpinned client source metadata',
      (registry: Registry) => {
        const client = registry.sources.clients[0]
        if (!client) throw new Error('client source fixture missing')
        client.sourceRef = `cli-v2026.6.0@${'f'.repeat(40)}`
      },
      /sources do not match the canonical pins/,
    ],
  ])('rejects %s', (_name, mutate, expected) => {
    const registry = readRegistryFixture()
    mutate(registry)

    expect(() =>
      validateCredentialEvidenceRegistry(registry, { repoRoot }),
    ).toThrow(expected)
  })

  it('prints only a bounded verification summary from the CLI', async () => {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ['scripts/honowarden-credential-evidence.mjs'],
      { cwd: repoRoot },
    )
    const report = JSON.parse(stdout) as {
      schemaVersion: number
      status: string
      levels: number
      claims: number
      artifacts: number
      limitations: string[]
    }

    expect(stderr).toBe('')
    expect(report).toMatchObject({
      schemaVersion: 1,
      status: 'passed',
      levels: 5,
      claims: 11,
    })
    expect(report.artifacts).toBeGreaterThanOrEqual(4)
    expect(report.limitations).toEqual([
      'The registry verifies committed metadata and artifact markers; it does not rerun the recorded local lifecycle.',
      'No claim in this registry proves staging or production activation.',
    ])
    expect(stdout).not.toContain('requiredMarkers')
    expect(stdout).not.toContain('artifactContents')
  })
})

type Registry = {
  sources: {
    repository: { programBaseCommit: string }
    clients: Array<{
      id: string
      surface: string
      version: string
      sourceRef: string
      assetSha256: string
    }>
  }
  claims: Array<{
    id: string
    operation: string
    executionLevel: string
    evidenceLevel: string
    sourceGeneration: { kind: string; commit: string }
    artifacts: Array<{
      path: string
      evidenceLevel: string
      requiredMarkers: string[]
    }>
    clientEvidence?: Array<{ sourceId: string; operations: string[] }>
    environmentEvidence?: {
      environment: string
      deploymentRef: string
      recordedAt: string
    }
    limitations: string[]
  }>
}

function readRegistryFixture(): Registry {
  return JSON.parse(
    // The registry is intentionally read synchronously by the production helper;
    // this fixture keeps mutation tests independent from module caching.
    credentialEvidence.readCredentialEvidenceRegistryText(registryPath),
  ) as Registry
}

function requiredClaim(
  registry: Registry,
  index: number,
): Registry['claims'][number] {
  const claim = registry.claims[index]
  if (!claim) throw new Error(`claim fixture ${index} is missing`)
  return claim
}

function requiredArtifact(
  claim: Registry['claims'][number],
  index: number,
): Registry['claims'][number]['artifacts'][number] {
  const artifact = claim.artifacts[index]
  if (!artifact) throw new Error(`artifact fixture ${index} is missing`)
  return artifact
}

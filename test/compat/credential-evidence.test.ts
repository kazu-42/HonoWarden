import { execFile } from 'node:child_process'
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'

// @ts-expect-error repository verifier intentionally ships as plain ESM.
import * as credentialEvidence from '../../scripts/honowarden-credential-evidence.mjs'

const {
  credentialArtifactDigests,
  credentialClaimDigests,
  credentialClaimProvenance,
  credentialEvidenceLevels,
  credentialEvidenceSources,
  credentialOperations,
  loadCredentialEvidenceRegistry,
  summarizeCredentialEvidenceLimitations,
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
    expect(Object.keys(credentialArtifactDigests).sort()).toEqual(
      [
        ...new Set(
          registry.claims.flatMap((claim: Registry['claims'][number]) =>
            claim.artifacts.map((artifact) => artifact.path),
          ),
        ),
      ].sort(),
    )
    for (const claim of registry.claims) {
      for (const artifact of claim.artifacts) {
        expect(artifact.contentSha256).toBe(
          credentialArtifactDigests[artifact.path],
        )
      }
    }
    expect(Object.keys(credentialClaimDigests)).toEqual(credentialOperations)
    for (const digest of Object.values(credentialClaimDigests)) {
      expect(digest).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(
      Object.fromEntries(
        registry.claims.map((claim: Registry['claims'][number]) => [
          claim.operation,
          {
            executionLevel: claim.executionLevel,
            evidenceLevel: claim.evidenceLevel,
            sourceGeneration: claim.sourceGeneration,
            artifacts: claim.artifacts.map(
              ({ path, evidenceLevel, contentSha256 }) => ({
                path,
                evidenceLevel,
                contentSha256,
              }),
            ),
            clientEvidence: claim.clientEvidence ?? null,
          },
        ]),
      ),
    ).toEqual(credentialClaimProvenance)
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
        artifact: {
          required: string[]
          properties: {
            path: { pattern: string }
            contentSha256: { $ref: string }
          }
        }
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
    expect(schema.$defs.artifact.required).toContain('contentSha256')
    expect(schema.$defs.artifact.properties.contentSha256.$ref).toBe(
      '#/$defs/sha256',
    )
  })

  it('rejects level-inconsistent claims at the JSON schema boundary', async () => {
    const schema = JSON.parse(await readFile(schemaPath, 'utf8'))
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
      schema,
    )
    const registry = loadCredentialEvidenceRegistry({ repoRoot }) as Registry

    expect(validate(registry), JSON.stringify(validate.errors)).toBe(true)

    const mutations: Array<[string, (candidate: Registry) => void]> = [
      [
        'client evidence on a local API claim',
        (candidate) => {
          requiredClaim(candidate, 0).clientEvidence = [
            { sourceId: 'cli.release', operations: ['login'] },
          ]
        },
      ],
      [
        'missing client evidence on an official-client claim',
        (candidate) => {
          delete requiredClaim(candidate, 1).clientEvidence
        },
      ],
      [
        'non-API execution on an official-client claim',
        (candidate) => {
          requiredClaim(candidate, 1).executionLevel = 'fixture'
        },
      ],
      [
        'environment evidence on a local claim',
        (candidate) => {
          requiredClaim(candidate, 0).environmentEvidence = {
            environment: 'staging',
            deploymentRef: 'deployment-1',
            recordedAt: '2026-07-22T00:00:00Z',
          }
        },
      ],
      [
        'live evidence without environment evidence',
        (candidate) => {
          requiredClaim(candidate, 0).evidenceLevel = 'staging'
        },
      ],
      [
        'staging evidence bound to a production environment',
        (candidate) => {
          const claim = requiredClaim(candidate, 0)
          claim.evidenceLevel = 'staging'
          claim.environmentEvidence = {
            environment: 'production',
            deploymentRef: 'deployment-1',
            recordedAt: '2026-07-22T00:00:00Z',
          }
        },
      ],
      [
        'reviewed head source on a non-live claim',
        (candidate) => {
          requiredClaim(candidate, 0).sourceGeneration.kind = 'reviewed_head'
        },
      ],
    ]

    for (const [label, mutate] of mutations) {
      const candidate = structuredClone(registry)
      mutate(candidate)
      expect(
        validate(candidate),
        `${label}: ${JSON.stringify(validate.errors)}`,
      ).toBe(false)
    }
  })

  it('pins LF checkout bytes for every digest-bound artifact', async () => {
    const attributes = new Set(
      (await readFile(join(repoRoot, '.gitattributes'), 'utf8'))
        .split(/\r?\n/)
        .filter(Boolean),
    )

    expect(
      Object.keys(credentialArtifactDigests).filter(
        (path) => !attributes.has(`${path} text eol=lf`),
      ),
    ).toEqual([])
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
      'canonical claim payload drift',
      (registry: Registry) => {
        requiredClaim(registry, 0).assertion =
          'A different but non-empty evidence assertion.'
      },
      /claim payload does not match canonical digest/,
    ],
    [
      'evidence-level inflation',
      (registry: Registry) => {
        requiredClaim(registry, 0).evidenceLevel = 'staging'
      },
      /staging claim requires staging environment evidence/,
    ],
    [
      'local artifact relabeled as official-client evidence',
      (registry: Registry) => {
        const claim = requiredClaim(registry, 0)
        claim.evidenceLevel = 'local_official_client'
        requiredArtifact(claim, 0).evidenceLevel = 'local_official_client'
        claim.clientEvidence = [
          { sourceId: 'cli.release', operations: ['lock'] },
        ]
      },
      /claim levels do not match canonical provenance/,
    ],
    [
      'local artifact relabeled as staging evidence',
      (registry: Registry) => {
        const claim = requiredClaim(registry, 0)
        claim.evidenceLevel = 'staging'
        const artifact = requiredArtifact(claim, 0)
        artifact.evidenceLevel = 'staging'
        artifact.requiredMarkers.push('2026-07-21T04:23:48Z')
        claim.environmentEvidence = {
          environment: 'staging',
          deploymentRef: claim.sourceGeneration.commit,
          recordedAt: '2026-07-21T04:23:48Z',
        }
      },
      /claim levels do not match canonical provenance/,
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
        const claim = requiredClaim(registry, 0)
        const removed = requiredArtifact(claim, 0).requiredMarkers.shift()
        if (removed !== claim.sourceGeneration.commit) {
          throw new Error('source marker fixture missing')
        }
      },
      /source generation is not an exact artifact marker/,
    ],
    [
      'noncanonical source generation already present in the artifact',
      (registry: Registry) => {
        const claim = requiredClaim(registry, 0)
        claim.sourceGeneration.commit =
          'bc51cbdc9b89c365fdcc36e542e1ebff63615770'
        requiredArtifact(claim, 0).requiredMarkers[0] =
          claim.sourceGeneration.commit
      },
      /source generation does not match canonical provenance/,
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
      'claim-agnostic official client operations',
      (registry: Registry) => {
        const claim = requiredClaim(registry, 1)
        const clientEvidence = claim.clientEvidence?.[0]
        if (!clientEvidence) throw new Error('client fixture missing')
        clientEvidence.operations = ['lock']
      },
      /client evidence does not match canonical provenance/,
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

  it.each([
    [
      'top-level duplicate keys',
      (text: string) =>
        text.replace(
          '  "schemaVersion": 1,',
          '  "schemaVersion": 999,\n  "schemaVersion": 1,',
        ),
    ],
    [
      'escaped-equivalent nested duplicate keys',
      (text: string) =>
        text.replace(
          '      "evidenceLevel": "local_api",',
          '      "evidence\\u004cevel": "production",\n      "evidenceLevel": "local_api",',
        ),
    ],
  ])('rejects %s before JSON materialization', (_name, mutate) => {
    const isolatedRoot = mkdtempSync(join(tmpdir(), 'credential-registry-'))
    const isolatedRegistry = join(isolatedRoot, 'registry.json')
    try {
      writeFileSync(
        isolatedRegistry,
        mutate(
          credentialEvidence.readCredentialEvidenceRegistryText(registryPath),
        ),
      )

      expect(() =>
        loadCredentialEvidenceRegistry({
          repoRoot,
          registryPath: isolatedRegistry,
        }),
      ).toThrow(/duplicate object key/)
    } finally {
      rmSync(isolatedRoot, { recursive: true, force: true })
    }
  })

  it('rejects tracked artifact content drift even when all markers remain', () => {
    const registry = readRegistryFixture()
    const paths = [
      ...new Set(
        registry.claims.flatMap((claim) =>
          claim.artifacts.map((artifact) => artifact.path),
        ),
      ),
    ]
    const isolatedRoot = mkdtempSync(join(tmpdir(), 'credential-evidence-'))
    try {
      for (const path of paths) {
        const target = join(isolatedRoot, path)
        mkdirSync(dirname(target), { recursive: true })
        copyFileSync(join(repoRoot, path), target)
      }
      appendFileSync(
        join(
          isolatedRoot,
          requiredArtifact(requiredClaim(registry, 0), 0).path,
        ),
        '\nContradictory post-hoc text that preserves every marker.\n',
      )

      expect(() =>
        validateCredentialEvidenceRegistry(registry, {
          repoRoot: isolatedRoot,
          trackedPaths: paths,
        }),
      ).toThrow(/artifact content digest mismatch/)
    } finally {
      rmSync(isolatedRoot, { recursive: true, force: true })
    }
  })

  it('accepts equivalent CRLF checkout bytes without accepting content drift', () => {
    const registry = readRegistryFixture()
    const paths = [
      ...new Set(
        registry.claims.flatMap((claim) =>
          claim.artifacts.map((artifact) => artifact.path),
        ),
      ),
    ]
    const isolatedRoot = mkdtempSync(
      join(tmpdir(), 'credential-evidence-crlf-'),
    )
    try {
      for (const path of paths) {
        const target = join(isolatedRoot, path)
        mkdirSync(dirname(target), { recursive: true })
        const content = readFileSync(join(repoRoot, path), 'utf8')
        expect(content).not.toContain('\r')
        writeFileSync(target, content.replaceAll('\n', '\r\n'))
      }

      expect(
        validateCredentialEvidenceRegistry(registry, {
          repoRoot: isolatedRoot,
          trackedPaths: paths,
        }),
      ).toMatchObject({ status: 'passed', artifacts: 8 })

      const driftTarget = join(
        isolatedRoot,
        requiredArtifact(requiredClaim(registry, 0), 0).path,
      )
      const crlfContent = readFileSync(driftTarget, 'utf8')
      writeFileSync(driftTarget, crlfContent.replace('\r\n', '\r'))
      expect(() =>
        validateCredentialEvidenceRegistry(registry, {
          repoRoot: isolatedRoot,
          trackedPaths: paths,
        }),
      ).toThrow(/unsupported line endings/)

      writeFileSync(driftTarget, crlfContent)
      appendFileSync(driftTarget, 'Contradictory post-hoc text.\r\n')
      expect(() =>
        validateCredentialEvidenceRegistry(registry, {
          repoRoot: isolatedRoot,
          trackedPaths: paths,
        }),
      ).toThrow(/artifact content digest mismatch/)
    } finally {
      rmSync(isolatedRoot, { recursive: true, force: true })
    }
  })

  it('does not include a missing marker value in verifier errors', () => {
    const registry = readRegistryFixture()
    const secretMarker = 'SUPER-SECRET-MARKER-DO-NOT-LOG'
    requiredArtifact(requiredClaim(registry, 0), 0).requiredMarkers.push(
      secretMarker,
    )

    let thrown
    try {
      validateCredentialEvidenceRegistry(registry, { repoRoot })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toMatch(/artifact marker is missing/)
    expect((thrown as Error).message).not.toContain(secretMarker)
  })

  it.each([
    {
      name: 'unknown operation',
      secret: 'SUPER-SECRET-OPERATION-DO-NOT-LOG',
      mutate: (registry: Registry, secret: string) => {
        requiredClaim(registry, 0).operation = secret
      },
      expected: /unknown operation/,
    },
    {
      name: 'unknown object field',
      secret: 'SUPER-SECRET-FIELD-DO-NOT-LOG',
      mutate: (registry: Registry, secret: string) => {
        Object.assign(requiredClaim(registry, 0), { [secret]: true })
      },
      expected: /unknown field/,
    },
  ])('does not reflect $name values in verifier errors', (fixture) => {
    const registry = readRegistryFixture()
    fixture.mutate(registry, fixture.secret)

    let thrown
    try {
      validateCredentialEvidenceRegistry(registry, { repoRoot })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toMatch(fixture.expected)
    expect((thrown as Error).message).not.toContain(fixture.secret)
  })

  it('derives live-evidence limitations from validated claim levels', () => {
    const localOnly = summarizeCredentialEvidenceLimitations([
      { evidenceLevel: 'local_api' },
    ])
    const staging = summarizeCredentialEvidenceLimitations([
      { evidenceLevel: 'staging' },
    ])
    const stagingAndProduction = summarizeCredentialEvidenceLimitations([
      { evidenceLevel: 'staging' },
      { evidenceLevel: 'production' },
    ])

    expect(localOnly).toContain(
      'No claim in this registry proves staging or production activation.',
    )
    expect(staging).toContain(
      'No claim in this registry proves production activation.',
    )
    expect(staging.join('\n')).not.toContain('proves staging activation')
    expect(stagingAndProduction.join('\n')).not.toContain(
      'No claim in this registry proves',
    )
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
      liveEvidenceLevels: string[]
      limitations: string[]
    }

    expect(stderr).toBe('')
    expect(report).toMatchObject({
      schemaVersion: 1,
      status: 'passed',
      levels: 5,
      claims: 11,
      liveEvidenceLevels: [],
    })
    expect(report.artifacts).toBeGreaterThanOrEqual(4)
    expect(report.limitations).toEqual([
      'The registry verifies committed metadata and artifact markers; it does not rerun the recorded local lifecycle.',
      'No claim in this registry proves staging or production activation.',
    ])
    expect(stdout).not.toContain('requiredMarkers')
    expect(stdout).not.toContain('artifactContents')
  })

  it('prints a fixed non-disclosing CLI failure', async () => {
    mkdirSync(join(repoRoot, 'test/.tmp'), { recursive: true })
    const isolatedRoot = mkdtempSync(
      join(repoRoot, 'test/.tmp/credential-evidence-cli-'),
    )
    const secret = 'SUPER-SECRET-CLI-OPERATION-DO-NOT-LOG'
    try {
      mkdirSync(join(isolatedRoot, 'scripts'), { recursive: true })
      mkdirSync(join(isolatedRoot, 'compat'), { recursive: true })
      copyFileSync(
        join(repoRoot, 'scripts/honowarden-credential-evidence.mjs'),
        join(isolatedRoot, 'scripts/honowarden-credential-evidence.mjs'),
      )
      const registry = readRegistryFixture()
      requiredClaim(registry, 0).operation = secret
      writeFileSync(
        join(isolatedRoot, 'compat/credential-evidence.json'),
        `${JSON.stringify(registry, null, 2)}\n`,
      )
      await execFileAsync('git', ['-C', isolatedRoot, 'init', '--quiet'])

      let rejected: (Error & { stdout?: string; stderr?: string }) | undefined
      try {
        await execFileAsync(
          process.execPath,
          ['scripts/honowarden-credential-evidence.mjs'],
          { cwd: isolatedRoot },
        )
      } catch (error) {
        rejected = error as Error & { stdout?: string; stderr?: string }
      }

      expect(rejected).toBeDefined()
      expect(rejected?.stdout).toBe('')
      expect(rejected?.stderr).toBe('credential evidence verification failed\n')
      expect(rejected?.stderr).not.toContain(secret)
    } finally {
      rmSync(isolatedRoot, { recursive: true, force: true })
    }
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
    assertion: string
    executionLevel: string
    evidenceLevel: string
    sourceGeneration: { kind: string; commit: string }
    artifacts: Array<{
      path: string
      evidenceLevel: string
      contentSha256?: string
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

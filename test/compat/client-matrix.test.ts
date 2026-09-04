import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  inspectClientMatrix,
  isCanonicalUtcInstant,
  isRegularRepositoryEvidenceFile,
  isSafeClientEvidencePath,
} from '../../scripts/honowarden-client-matrix-policy.mjs'

type ClientMatrix = {
  schemaVersion: number
  releaseTarget?: string
  snapshotKind?: string
  sourceTag?: string
  sourceCommit?: string
  sourceMatrixPath?: string
  sourceMatrixSha256?: string
  evidenceManifest?: Array<{
    sourcePath: string
    snapshotPath: string
    bytes: number
    sha256: string
  }>
  checkedAt: string
  sourceKind: string
  metadataRefresh?: {
    cadenceDays: number
    requiredBeforeRelease: boolean
    staleAfterDays: number
  }
  entries: ClientMatrixEntry[]
}

type ClientMatrixEntry = {
  surface: string
  version: string
  build?: string
  releaseTag: string
  releasePublishedAt: string
  metadataSource: {
    kind: string
    repositoryRef: string
    releaseSelector: string
  }
  verificationLevel: string
  liveEvidence?: {
    path: string
    additionalPaths?: string[]
    status: string
    recordedAt: string
    clientVersion: string
    flows: string[]
  }
  coveredFlows: string[]
  knownIssues: string[]
}

type FixtureFlowManifest = {
  schemaVersion: number
  flows: FixtureFlow[]
}

type FixtureFlow = {
  id: string
  fixtures: string[]
}

const matrixPath = fileURLToPath(
  new URL('../../compat/client-matrix.json', import.meta.url).toString(),
)
const publishedAlphaMatrixPath = fileURLToPath(
  new URL(
    '../../compat/releases/v0.1.0-alpha-client-matrix.json',
    import.meta.url,
  ).toString(),
)
const publishedAlphaCliEvidencePath = fileURLToPath(
  new URL(
    '../../docs/release/snapshots/v0.1.0-alpha/live-client-evidence.md',
    import.meta.url,
  ).toString(),
)
const credentialEvidencePath = fileURLToPath(
  new URL('../../compat/credential-evidence.json', import.meta.url).toString(),
)
const credentialCloseoutPacketPath = fileURLToPath(
  new URL(
    '../../compat/credential-closeout-packet.json',
    import.meta.url,
  ).toString(),
)
const fixtureFlowsPath = fileURLToPath(
  new URL('../../compat/fixture-flows.json', import.meta.url).toString(),
)
const compatibilityDocPath = fileURLToPath(
  new URL('../../docs/compatibility.md', import.meta.url).toString(),
)
const compatibilityMatrixDocPath = fileURLToPath(
  new URL('../../docs/compatibility-matrix.md', import.meta.url).toString(),
)
const fixturesRoot = fileURLToPath(
  new URL('../../compat/fixtures', import.meta.url).toString(),
)

const requiredSurfaces = [
  'browser_extension',
  'desktop',
  'mobile_android',
  'mobile_ios',
  'cli',
] as const

const requiredFlows = [
  'config',
  'prelogin',
  'password_grant',
  'refresh_grant',
  'empty_sync',
  'account_profile',
  'account_profile_update',
  'account_revision',
  'password_verify',
  'password_change',
  'account_keys',
  'direct_read',
  'metadata_read',
  'device_read',
  'device_update',
  'device_keys_update',
  'device_bulk_trust_update',
  'known_device_preflight',
  'folder_crud',
  'cipher_create',
  'cipher_lifecycle',
  'revision_conflict',
  'device_revoke',
  'session_revoke',
  'totp_login',
  'sync_with_items',
  'attachment_metadata',
  'webauthn_enrollment',
] as const

describe('client compatibility matrix', () => {
  it.each([
    ['missing entries', {}],
    ['non-array entries', { entries: {} }],
    ['malformed entry', { entries: [{}] }],
    [
      'non-array known issues',
      {
        entries: [
          {
            surface: 'cli',
            version: '2026.7.0',
            verificationLevel: 'fixture_only',
            knownIssues: 'none',
          },
        ],
      },
    ],
  ])('rejects a structurally invalid matrix: %s', (_name, candidate) => {
    expect(() => inspectClientMatrix(candidate)).toThrow(
      'Client matrix structure is invalid',
    )
  })

  const matrix = readMatrix()
  const fixtureFlows = readFixtureFlows()

  it('records release metadata provenance', () => {
    expect(matrix.schemaVersion).toBe(1)
    expect(matrix.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    expect(matrix.sourceKind).toBe('official-upstream-release-metadata')
    expect(matrix.metadataRefresh).toEqual({
      cadenceDays: 14,
      requiredBeforeRelease: true,
      staleAfterDays: 21,
    })
  })

  it('covers required client surfaces with exact versions', () => {
    expect(new Set(matrix.entries.map((entry) => entry.surface))).toEqual(
      new Set(requiredSurfaces),
    )

    for (const entry of matrix.entries) {
      expect(entry.version).toMatch(/^\d{4}\.\d+\.\d+$/)
      expect(entry.releaseTag).toContain(entry.version)
      expect(entry.releasePublishedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
      )
      expect(Date.parse(entry.releasePublishedAt)).toBeLessThanOrEqual(
        Date.parse(matrix.checkedAt),
      )
      expect(entry.metadataSource.kind).toBe('official-upstream-github-release')
      expect(entry.metadataSource.releaseSelector).toMatch(
        /latest non-draft, non-prerelease/,
      )
      expect(['fixture_only', 'live_smoke', 'live_regression']).toContain(
        entry.verificationLevel,
      )
      expect(entry.knownIssues.length).toBeGreaterThanOrEqual(1)

      if (
        entry.verificationLevel === 'live_smoke' ||
        entry.verificationLevel === 'live_regression'
      ) {
        expect(entry.liveEvidence).toMatchObject({
          status: 'passed',
          clientVersion: entry.version,
        })
        for (const evidencePath of matrixLiveEvidencePaths(entry)) {
          expect(evidencePath).toMatch(/^docs\/release\/[A-Za-z0-9/_-]+\.md$/)
        }
        expect(entry.liveEvidence?.recordedAt).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
        )
        expect(entry.liveEvidence?.flows.length).toBeGreaterThan(0)
      }

      if (entry.verificationLevel === 'live_regression') {
        expect(entry.liveEvidence?.path).toContain(
          'docs/release/live-regression-evidence/',
        )
        expect(entry.liveEvidence?.flows).toEqual(
          expect.arrayContaining([
            'config',
            'prelogin',
            'password_grant',
            'initial_sync',
            'post_mutation_sync',
            'cipher_create',
            'cipher_update',
            'cipher_soft_delete',
            'cipher_permanent_delete',
            'refresh_grant',
            'session_revoke',
          ]),
        )
      }

      for (const issue of entry.knownIssues) {
        expect(issue.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('pins the 2026-08-16 official latest releases conservatively', () => {
    expect(matrix.checkedAt).toMatch(/^2026-08-16T/)
    expect(
      Object.fromEntries(
        matrix.entries.map((entry) => [
          entry.surface,
          {
            version: entry.version,
            build: entry.build,
            releaseTag: entry.releaseTag,
            releasePublishedAt: entry.releasePublishedAt,
            verificationLevel: entry.verificationLevel,
          },
        ]),
      ),
    ).toEqual({
      browser_extension: {
        version: '2026.7.0',
        build: undefined,
        releaseTag: 'browser-v2026.7.0',
        releasePublishedAt: '2026-07-23T16:49:59Z',
        verificationLevel: 'fixture_only',
      },
      desktop: {
        version: '2026.7.0',
        build: undefined,
        releaseTag: 'desktop-v2026.7.0',
        releasePublishedAt: '2026-07-23T15:20:46Z',
        verificationLevel: 'fixture_only',
      },
      mobile_android: {
        version: '2026.7.1',
        build: '21803',
        releaseTag: 'v2026.7.1-bwpm',
        releasePublishedAt: '2026-08-07T22:20:51Z',
        verificationLevel: 'fixture_only',
      },
      mobile_ios: {
        version: '2026.7.1',
        build: '3432',
        releaseTag: 'v2026.7.1-bwpm',
        releasePublishedAt: '2026-08-07T22:12:38Z',
        verificationLevel: 'fixture_only',
      },
      cli: {
        version: '2026.7.0',
        build: undefined,
        releaseTag: 'cli-v2026.7.0',
        releasePublishedAt: '2026-07-23T21:16:13Z',
        verificationLevel: 'fixture_only',
      },
    })

    for (const entry of matrix.entries) {
      expect(entry.liveEvidence).toBeUndefined()
    }
  })

  it('keeps tag-time and post-tag client evidence claims distinct', () => {
    const issuesBySurface = Object.fromEntries(
      matrix.entries.map((entry) => [
        entry.surface,
        entry.knownIssues.join('\n'),
      ]),
    )

    for (const surface of ['browser_extension', 'desktop', 'mobile_android']) {
      expect(issuesBySurface[surface]).toContain('post-tag')
      expect(issuesBySurface[surface]).toContain(
        'not part of the sealed published-alpha snapshot',
      )
      expect(issuesBySurface[surface]).not.toContain(
        'remains in the published alpha snapshot',
      )
    }

    expect(issuesBySurface.cli).toContain(
      'sealed published-alpha snapshot contains CLI 2026.6.0 login, sync, and item lifecycle evidence only',
    )
    expect(issuesBySurface.cli).toContain(
      'refresh and TOTP evidence is post-tag',
    )
  })

  it('preserves the exact tag-time alpha client evidence as an immutable snapshot', () => {
    const snapshot = readMatrix(publishedAlphaMatrixPath)
    const snapshotSha256 = createHash('sha256')
      .update(readFileSync(publishedAlphaMatrixPath))
      .digest('hex')

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      releaseTarget: 'v0.1.0-alpha',
      snapshotKind: 'tag-time-client-evidence',
      sourceTag: 'v0.1.0-alpha',
      sourceCommit: 'e7a3c5ea9e51030143736bb0e7a36cb7a8babfce',
      sourceMatrixPath: 'compat/client-matrix.json',
      sourceMatrixSha256:
        '8076ec9d4fd9179b9f0616f6f6b5489acacae291058ba95854e4591be56c3491',
      checkedAt: '2026-07-06T11:35:37Z',
      evidenceManifest: [
        {
          sourcePath: 'docs/release/live-client-evidence.md',
          snapshotPath:
            'docs/release/snapshots/v0.1.0-alpha/live-client-evidence.md',
          bytes: 5231,
          sha256:
            '3b2bc4c0b76ec7789f4833f7eed35b9cb764c90d4e72a0726d01e847e16af1ca',
        },
      ],
    })
    expect(snapshotSha256).toBe(
      '82ee5193499716331a7dfc46216f99f74569cb5bf89ec28548a4042daa7d9550',
    )
    expect(
      createHash('sha256')
        .update(readFileSync(publishedAlphaCliEvidencePath))
        .digest('hex'),
    ).toBe('3b2bc4c0b76ec7789f4833f7eed35b9cb764c90d4e72a0726d01e847e16af1ca')
    expect(readFileSync(publishedAlphaCliEvidencePath)).toHaveLength(5231)
    expect(
      Object.fromEntries(
        snapshot.entries.map((entry) => [
          entry.surface,
          {
            version: entry.version,
            build: entry.build,
            releaseTag: entry.releaseTag,
            verificationLevel: entry.verificationLevel,
            evidenceVersion: entry.liveEvidence?.clientVersion,
          },
        ]),
      ),
    ).toEqual({
      browser_extension: {
        version: '2026.6.1',
        build: undefined,
        releaseTag: 'browser-v2026.6.1',
        verificationLevel: 'fixture_only',
        evidenceVersion: undefined,
      },
      desktop: {
        version: '2026.6.1',
        build: undefined,
        releaseTag: 'desktop-v2026.6.1',
        verificationLevel: 'fixture_only',
        evidenceVersion: undefined,
      },
      mobile_android: {
        version: '2026.6.0',
        build: '21686',
        releaseTag: 'v2026.6.0-bwpm',
        verificationLevel: 'fixture_only',
        evidenceVersion: undefined,
      },
      mobile_ios: {
        version: '2026.6.0',
        build: '3325',
        releaseTag: 'v2026.6.0-bwpm',
        verificationLevel: 'fixture_only',
        evidenceVersion: undefined,
      },
      cli: {
        version: '2026.6.0',
        build: undefined,
        releaseTag: 'cli-v2026.6.0',
        verificationLevel: 'live_smoke',
        evidenceVersion: '2026.6.0',
      },
    })
  })

  it('rejects version-mismatched evidence and evidence-free promotions', () => {
    const snapshot = readMatrix(publishedAlphaMatrixPath)
    const mismatchedEvidence = structuredClone(snapshot)
    const mismatchedCli = mismatchedEvidence.entries.find(
      (entry) => entry.surface === 'cli',
    )
    if (!mismatchedCli) {
      throw new Error('CLI snapshot row is required')
    }
    mismatchedCli.version = '2026.7.0'

    expect(
      inspectClientMatrix(mismatchedEvidence, {
        evidenceIsRegularFile: () => true,
      }).promotedRowsWithoutEvidence,
    ).toContain('cli')

    const evidenceFreePromotion = structuredClone(matrix)
    const currentCli = evidenceFreePromotion.entries.find(
      (entry) => entry.surface === 'cli',
    )
    if (!currentCli) {
      throw new Error('CLI current row is required')
    }
    currentCli.verificationLevel = 'live_smoke'

    expect(
      inspectClientMatrix(evidenceFreePromotion, {
        evidenceIsRegularFile: () => true,
      }).promotedRowsWithoutEvidence,
    ).toContain('cli')

    const staleEvidenceOnFixtureRow = structuredClone(matrix)
    const staleCurrentCli = staleEvidenceOnFixtureRow.entries.find(
      (entry) => entry.surface === 'cli',
    )
    const historicalCli = snapshot.entries.find(
      (entry) => entry.surface === 'cli',
    )
    if (!staleCurrentCli || !historicalCli?.liveEvidence) {
      throw new Error('Current and historical CLI rows are required')
    }
    staleCurrentCli.liveEvidence = structuredClone(historicalCli.liveEvidence)

    expect(
      inspectClientMatrix(staleEvidenceOnFixtureRow, {
        evidenceIsRegularFile: () => true,
      }).fixtureOnlyRowsWithLiveEvidence,
    ).toContain('cli')
  })

  it('rejects unsafe evidence paths and non-canonical UTC timestamps', () => {
    const snapshot = readMatrix(publishedAlphaMatrixPath)
    const mutateCliEvidence = (
      mutation: (entry: ClientMatrixEntry) => void,
    ): ClientMatrix => {
      const candidate = structuredClone(snapshot)
      const cliEntry = candidate.entries.find(
        (entry) => entry.surface === 'cli',
      )
      if (!cliEntry?.liveEvidence) {
        throw new Error('Promoted CLI snapshot row is required')
      }
      mutation(cliEntry)
      return candidate
    }

    for (const unsafePath of [
      '',
      ' ',
      '/docs/release/live-client-evidence.md',
      '../docs/release/live-client-evidence.md',
      'docs/release/../release/live-client-evidence.md',
      'docs/release//live-client-evidence.md',
      'docs/release',
      'docs/release/live-client-evidence.json',
      'docs\\release\\live-client-evidence.md',
    ]) {
      const candidate = mutateCliEvidence((entry) => {
        if (!entry.liveEvidence) {
          throw new Error('CLI evidence is required')
        }
        entry.liveEvidence.path = unsafePath
        entry.liveEvidence.additionalPaths = []
      })

      expect(
        inspectClientMatrix(candidate, {
          evidenceIsRegularFile: () => true,
        }).promotedRowsWithoutEvidence,
        unsafePath,
      ).toContain('cli')
    }

    const unsafeAdditionalPath = mutateCliEvidence((entry) => {
      if (!entry.liveEvidence) {
        throw new Error('CLI evidence is required')
      }
      entry.liveEvidence.additionalPaths = ['../outside.md']
    })
    expect(
      inspectClientMatrix(unsafeAdditionalPath, {
        evidenceIsRegularFile: () => true,
      }).promotedRowsWithoutEvidence,
    ).toContain('cli')

    for (const invalidTimestamp of [
      '2026-99-99T99:99:99Z',
      '2026-02-29T00:00:00Z',
      '2026-04-31T00:00:00Z',
      '2026-01-01T24:00:00Z',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00+00:00',
    ]) {
      const candidate = mutateCliEvidence((entry) => {
        if (!entry.liveEvidence) {
          throw new Error('CLI evidence is required')
        }
        entry.liveEvidence.recordedAt = invalidTimestamp
      })

      expect(
        inspectClientMatrix(candidate, {
          evidenceIsRegularFile: () => true,
        }).promotedRowsWithoutEvidence,
        invalidTimestamp,
      ).toContain('cli')
    }

    const preReleaseEvidence = mutateCliEvidence((entry) => {
      if (!entry.liveEvidence) {
        throw new Error('CLI evidence is required')
      }
      entry.liveEvidence.recordedAt = '2026-06-25T18:32:51Z'
    })
    expect(
      inspectClientMatrix(preReleaseEvidence, {
        evidenceIsRegularFile: () => true,
      }).promotedRowsWithoutEvidence,
    ).toContain('cli')

    const validPostReleaseLeapDay = mutateCliEvidence((entry) => {
      if (!entry.liveEvidence) {
        throw new Error('CLI evidence is required')
      }
      entry.liveEvidence.recordedAt = '2028-02-29T23:59:59Z'
    })
    expect(
      inspectClientMatrix(validPostReleaseLeapDay, {
        evidenceIsRegularFile: () => true,
      }).promotedRowsWithoutEvidence,
    ).not.toContain('cli')

    expect(isCanonicalUtcInstant('2024-02-29T23:59:59Z')).toBe(true)
    expect(isSafeClientEvidencePath('docs/release/evidence/summary.md')).toBe(
      true,
    )
  })

  it('requires evidence paths to resolve to regular non-symlink files', () => {
    const repositoryRoot = mkdtempSync(
      join(tmpdir(), 'honowarden-client-evidence-policy-'),
    )

    try {
      const releaseRoot = join(repositoryRoot, 'docs/release')
      mkdirSync(releaseRoot, { recursive: true })
      writeFileSync(join(releaseRoot, 'valid.md'), '# Valid evidence\n')
      mkdirSync(join(releaseRoot, 'directory.md'))
      symlinkSync('valid.md', join(releaseRoot, 'symlink.md'))
      mkdirSync(join(releaseRoot, 'real-directory'))
      writeFileSync(
        join(releaseRoot, 'real-directory/nested.md'),
        '# Nested evidence\n',
      )
      symlinkSync('real-directory', join(releaseRoot, 'linked-directory'))

      expect(
        isRegularRepositoryEvidenceFile(
          repositoryRoot,
          'docs/release/valid.md',
        ),
      ).toBe(true)
      for (const nonRegularPath of [
        'docs/release/missing.md',
        'docs/release/directory.md',
        'docs/release/symlink.md',
        'docs/release/linked-directory/nested.md',
      ]) {
        expect(
          isRegularRepositoryEvidenceFile(repositoryRoot, nonRegularPath),
          nonRegularPath,
        ).toBe(false)
      }

      const snapshot = readMatrix(publishedAlphaMatrixPath)
      const cliEntry = snapshot.entries.find((entry) => entry.surface === 'cli')
      if (!cliEntry?.liveEvidence) {
        throw new Error('Promoted CLI snapshot row is required')
      }
      cliEntry.liveEvidence.additionalPaths = []

      for (const evidencePath of [
        'docs/release/directory.md',
        'docs/release/symlink.md',
        'docs/release/missing.md',
        'docs/release/linked-directory/nested.md',
      ]) {
        cliEntry.liveEvidence.path = evidencePath
        expect(
          inspectClientMatrix(snapshot, {
            evidenceIsRegularFile: (candidatePath) =>
              isRegularRepositoryEvidenceFile(repositoryRoot, candidatePath),
          }).promotedRowsWithoutEvidence,
          evidencePath,
        ).toContain('cli')
      }

      cliEntry.liveEvidence.path = 'docs/release/valid.md'
      expect(
        inspectClientMatrix(snapshot, {
          evidenceIsRegularFile: (candidatePath) =>
            isRegularRepositoryEvidenceFile(repositoryRoot, candidatePath),
        }).promotedRowsWithoutEvidence,
      ).not.toContain('cli')
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true })
    }
  })

  it('keeps historical credential evidence pinned to its recorded clients', () => {
    const credentialEvidence = readFileSync(credentialEvidencePath, 'utf8')
    const closeoutPacket = readFileSync(credentialCloseoutPacketPath, 'utf8')

    for (const historicalRef of [
      'cli-v2026.6.0@e6293ff2bc85123e9baaa998cf1543030ec5d9f0',
      'browser-v2026.6.1@723c075bf8b9f45c901e56195be8e94e43ed75a2',
    ]) {
      expect(credentialEvidence).toContain(historicalRef)
      expect(closeoutPacket).toContain(historicalRef)
    }
  })

  it('records the common currently covered protocol flows', () => {
    for (const entry of matrix.entries) {
      expect(new Set(entry.coveredFlows)).toEqual(new Set(requiredFlows))
    }
  })

  it('maps every covered flow to existing fixture files', () => {
    expect(fixtureFlows.schemaVersion).toBe(1)

    const manifestFlowIds = fixtureFlows.flows.map((flow) => flow.id)
    expect(new Set(manifestFlowIds)).toEqual(new Set(requiredFlows))

    for (const flow of fixtureFlows.flows) {
      expect(flow.fixtures.length).toBeGreaterThan(0)

      for (const fixturePath of flow.fixtures) {
        expect(fixturePath).toMatch(/^[A-Za-z0-9/_-]+\.json$/)
        expect(
          existsSync(join(fixturesRoot, fixturePath)),
          `${flow.id} missing ${fixturePath}`,
        ).toBe(true)
      }
    }

    for (const entry of matrix.entries) {
      expect(new Set(entry.coveredFlows)).toEqual(new Set(manifestFlowIds))
    }
  })

  it('keeps mobile build numbers explicit', () => {
    const mobileEntries = matrix.entries.filter((entry) =>
      entry.surface.startsWith('mobile_'),
    )

    expect(mobileEntries).toHaveLength(2)
    for (const entry of mobileEntries) {
      expect(entry.build).toMatch(/^\d+$/)
    }
  })

  it('records release source refs for every tracked surface', () => {
    expect(
      Object.fromEntries(
        matrix.entries.map((entry) => [
          entry.surface,
          entry.metadataSource.repositoryRef,
        ]),
      ),
    ).toEqual({
      browser_extension: 'client-apps',
      desktop: 'client-apps',
      mobile_android: 'android-mobile-apps',
      mobile_ios: 'ios-mobile-apps',
      cli: 'client-apps',
    })
  })

  it('keeps Web Vault outside the alpha compatibility surface', () => {
    const compatibilityDoc = readFileSync(compatibilityDocPath, 'utf8')
    const compatibilityMatrixDoc = readFileSync(
      compatibilityMatrixDocPath,
      'utf8',
    )

    expect(compatibilityDoc).toContain('## Web Vault Boundary')
    expect(compatibilityDoc).toContain('does not expose a Web Vault')
    expect(compatibilityDoc).toContain('new ADR')
    expect(compatibilityDoc).toContain('CSP')
    expect(compatibilityMatrixDoc).toContain(
      'There is intentionally no Web Vault row',
    )
    expect(matrix.entries.map((entry) => entry.surface)).not.toContain(
      'web_vault',
    )
  })

  it('records the slice-based Organizations compatibility boundary', () => {
    const compatibilityDoc = readFileSync(compatibilityDocPath, 'utf8')
    const compatibilityMatrixDoc = readFileSync(
      compatibilityMatrixDocPath,
      'utf8',
    )

    expect(compatibilityDoc).toContain(
      '## Organizations And Shared Vault Product Line',
    )
    expect(compatibilityDoc).toContain('ADR 0005')
    expect(compatibilityDoc).toContain('ADR 0010')
    expect(compatibilityDoc).toMatch(/organization\s+foundation/i)
    expect(compatibilityDoc).toMatch(/collection\s+CRUD/i)
    expect(compatibilityDoc).toContain('membership')
    expect(compatibilityDoc).toMatch(/cross-user\s+isolation/i)
    expect(compatibilityMatrixDoc).toMatch(
      /not yet a broad Organizations or shared vault verification row/i,
    )
    expect(compatibilityMatrixDoc).toMatch(/slice-specific evidence/i)
    expect(matrix.entries.map((entry) => entry.surface)).not.toContain(
      'organizations',
    )
    expect(matrix.entries.map((entry) => entry.surface)).not.toContain(
      'shared_vault',
    )
  })

  it('keeps policy management outside the alpha compatibility surface', () => {
    const compatibilityDoc = readFileSync(compatibilityDocPath, 'utf8')
    const compatibilityMatrixDoc = readFileSync(
      compatibilityMatrixDocPath,
      'utf8',
    )

    expect(compatibilityDoc).toContain('## Policy Management Boundary')
    expect(compatibilityDoc).toContain('ADR 0006')
    expect(compatibilityDoc).toContain('empty policy metadata reads')
    expect(compatibilityMatrixDoc).toContain(
      'Policy metadata remains fixture-covered',
    )
    expect(compatibilityMatrixDoc).toMatch(
      /Policy mutation and organization policy enforcement are\s+not compatibility claims/,
    )
    expect(matrix.entries.map((entry) => entry.surface)).not.toContain(
      'policy_management',
    )
  })

  it('records implemented organization collection CRUD without broad promotion', () => {
    const compatibilityDoc = readFileSync(compatibilityDocPath, 'utf8')
    const compatibilityMatrixDoc = readFileSync(
      compatibilityMatrixDocPath,
      'utf8',
    )

    expect(compatibilityDoc).toContain('## Collection Mutation Boundary')
    expect(compatibilityDoc).toMatch(/ADR\s+0010/)
    expect(compatibilityDoc).toMatch(/organization collection\s+CRUD/i)
    expect(compatibilityDoc).toContain('Organization cipher')
    expect(compatibilityMatrixDoc).toMatch(/route-tested source capabilities/i)
    expect(compatibilityMatrixDoc).toMatch(/cipher assignment/i)
    expect(matrix.entries.map((entry) => entry.surface)).not.toContain(
      'collection_mutation',
    )
  })

  it('keeps Send and public sharing outside the alpha compatibility surface', () => {
    const compatibilityDoc = readFileSync(compatibilityDocPath, 'utf8')
    const compatibilityMatrixDoc = readFileSync(
      compatibilityMatrixDocPath,
      'utf8',
    )

    expect(compatibilityDoc).toContain('## Send And Public Sharing Boundary')
    expect(compatibilityDoc).toContain('ADR 0011')
    expect(compatibilityDoc).toContain('accepted future Send product line')
    expect(compatibilityDoc).toContain('runtime support')
    expect(compatibilityDoc).toContain('send-enabled: false')
    expect(compatibilityDoc).toContain('501')
    expect(compatibilityMatrixDoc).toContain(
      'There is intentionally no Send or public file-sharing row',
    )
    expect(compatibilityMatrixDoc).toContain('ADR 0011')
    expect(matrix.entries.map((entry) => entry.surface)).not.toContain('send')
  })

  it('keeps Emergency Access outside the alpha compatibility surface', () => {
    const compatibilityDoc = readFileSync(compatibilityDocPath, 'utf8')
    const compatibilityMatrixDoc = readFileSync(
      compatibilityMatrixDocPath,
      'utf8',
    )

    expect(compatibilityDoc).toContain('## Emergency Access Boundary')
    expect(compatibilityDoc).toContain('ADR 0004')
    expect(compatibilityDoc).toMatch(/Delegated\s+recovery/i)
    expect(compatibilityDoc).toContain('cryptographic handoff')
    expect(compatibilityMatrixDoc).toContain(
      'There is intentionally no Emergency Access row',
    )
    expect(matrix.entries.map((entry) => entry.surface)).not.toContain(
      'emergency_access',
    )
  })

  it('re-evaluates live evidence requirements when metadata advances', () => {
    const androidEntry = matrix.entries.find(
      (entry) => entry.surface === 'mobile_android',
    )

    expect(androidEntry).toMatchObject({
      version: '2026.7.1',
      build: '21803',
      releaseTag: 'v2026.7.1-bwpm',
      releasePublishedAt: '2026-08-07T22:20:51Z',
      verificationLevel: 'fixture_only',
    })
    expect(androidEntry?.knownIssues.join('\n')).toContain(
      'No official Android 2026.7.1 build 21803 live smoke is recorded',
    )
  })

  it('keeps every current row fixture-only until exact-version live evidence exists', () => {
    for (const entry of matrix.entries) {
      expect(entry.verificationLevel).toBe('fixture_only')
      expect(entry.liveEvidence).toBeUndefined()
    }

    const compatibilityMatrixDoc = readFileSync(
      compatibilityMatrixDocPath,
      'utf8',
    )
    for (const entry of matrix.entries) {
      const tableLine = compatibilityMatrixDoc
        .split('\n')
        .find((line) => line.startsWith(`| ${entry.surface} `))
      const cells = tableLine
        ?.split('|')
        .slice(1, -1)
        .map((cell) => cell.trim())

      expect(cells?.slice(0, 6)).toEqual([
        entry.surface,
        entry.version,
        entry.build ?? '',
        entry.releaseTag,
        entry.releasePublishedAt,
        entry.verificationLevel,
      ])
    }
    expect(compatibilityMatrixDoc).toContain('v0.1.0-alpha-client-matrix.json')
    expect(compatibilityMatrixDoc).toContain(
      'Sealed `v0.1.0-alpha` Tag-Time Evidence',
    )
    expect(compatibilityMatrixDoc).toContain('Post-Tag Historical Evidence')
  })

  it('documents repeatable live regression promotion requirements', () => {
    const compatibilityMatrixDoc = readFileSync(
      compatibilityMatrixDocPath,
      'utf8',
    )

    expect(compatibilityMatrixDoc).toContain('live_regression')
    expect(compatibilityMatrixDoc).toContain('login, sync')
    expect(compatibilityMatrixDoc).toContain('refresh, session revoke')
    expect(compatibilityMatrixDoc).toContain('selected auth lifecycle')
    expect(compatibilityMatrixDoc).toContain('live-regression-matrix.md')
  })
})

function readMatrix(path = matrixPath): ClientMatrix {
  return JSON.parse(readFileSync(path, 'utf8')) as ClientMatrix
}

function readFixtureFlows(): FixtureFlowManifest {
  return JSON.parse(
    readFileSync(fixtureFlowsPath, 'utf8'),
  ) as FixtureFlowManifest
}

function matrixLiveEvidencePaths(entry: ClientMatrixEntry): string[] {
  if (!entry.liveEvidence) {
    return []
  }

  return [
    entry.liveEvidence.path,
    ...(entry.liveEvidence.additionalPaths ?? []),
  ]
}

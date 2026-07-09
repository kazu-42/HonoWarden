import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

type ClientMatrix = {
  schemaVersion: number
  checkedAt: string
  sourceKind: string
  metadataRefresh: {
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
] as const

describe('client compatibility matrix', () => {
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
        expect(entry.liveEvidence?.path).toMatch(
          /^docs\/release\/[A-Za-z0-9/_-]+\.md$/,
        )
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

  it('keeps Organizations and shared vaults outside the alpha compatibility surface', () => {
    const compatibilityDoc = readFileSync(compatibilityDocPath, 'utf8')
    const compatibilityMatrixDoc = readFileSync(
      compatibilityMatrixDocPath,
      'utf8',
    )

    expect(compatibilityDoc).toContain(
      '## Organizations And Shared Vault Boundary',
    )
    expect(compatibilityDoc).toContain('ADR 0005')
    expect(compatibilityDoc).toContain('membership')
    expect(compatibilityDoc).toContain('cross-user isolation')
    expect(compatibilityMatrixDoc).toContain(
      'There is intentionally no Organizations or shared vault row',
    )
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

  it('keeps collection mutation outside the alpha compatibility surface', () => {
    const compatibilityDoc = readFileSync(compatibilityDocPath, 'utf8')
    const compatibilityMatrixDoc = readFileSync(
      compatibilityMatrixDocPath,
      'utf8',
    )

    expect(compatibilityDoc).toContain('## Collection Mutation Boundary')
    expect(compatibilityDoc).toMatch(/ADR\s+0007/)
    expect(compatibilityDoc).toContain('empty collection metadata reads')
    expect(compatibilityDoc).toContain('cipher assignment')
    expect(compatibilityMatrixDoc).toContain(
      'Collection metadata remains fixture-covered',
    )
    expect(compatibilityMatrixDoc).toMatch(
      /Collection mutation and cipher assignment are\s+not\s+compatibility claims/,
    )
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
    expect(compatibilityDoc).toContain('ADR 0003')
    expect(compatibilityDoc).toContain('unauthenticated access')
    expect(compatibilityDoc).toContain('rate limiting')
    expect(compatibilityMatrixDoc).toContain(
      'There is intentionally no Send or public file-sharing row',
    )
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
      version: '2026.6.1',
      build: '21713',
      releaseTag: 'v2026.6.1-bwpm',
      releasePublishedAt: '2026-07-09T16:57:30Z',
      verificationLevel: 'fixture_only',
    })
    expect(androidEntry?.knownIssues.join('\n')).toContain(
      'live mobile evidence must be re-run before any promotion',
    )
  })

  it('records live smoke rows while keeping unproven surfaces conservative', () => {
    const browserEntry = matrix.entries.find(
      (entry) => entry.surface === 'browser_extension',
    )
    expect(browserEntry?.verificationLevel).toBe('live_smoke')
    expect(browserEntry?.liveEvidence?.path).toBe(
      'docs/release/browser-extension-live-client-evidence.md',
    )
    expect(browserEntry?.liveEvidence?.flows).toEqual(
      expect.arrayContaining([
        'config',
        'prelogin',
        'password_grant',
        'empty_sync',
        'account_profile',
      ]),
    )

    const cliEntry = matrix.entries.find((entry) => entry.surface === 'cli')
    expect(cliEntry?.verificationLevel).toBe('live_smoke')
    expect(cliEntry?.liveEvidence?.path).toBe(
      'docs/release/live-client-evidence.md',
    )

    const nonCliEntries = matrix.entries.filter(
      (entry) => !['browser_extension', 'cli'].includes(entry.surface),
    )
    for (const entry of nonCliEntries) {
      expect(entry.verificationLevel).toBe('fixture_only')
    }

    const compatibilityMatrixDoc = readFileSync(
      compatibilityMatrixDocPath,
      'utf8',
    )
    expect(compatibilityMatrixDoc).toContain(
      'browser-extension-live-client-evidence.md',
    )
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

function readMatrix(): ClientMatrix {
  return JSON.parse(readFileSync(matrixPath, 'utf8')) as ClientMatrix
}

function readFixtureFlows(): FixtureFlowManifest {
  return JSON.parse(
    readFileSync(fixtureFlowsPath, 'utf8'),
  ) as FixtureFlowManifest
}

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

type ClientMatrix = {
  schemaVersion: number
  checkedAt: string
  sourceKind: string
  entries: ClientMatrixEntry[]
}

type ClientMatrixEntry = {
  surface: string
  version: string
  build?: string
  releaseTag: string
  releasePublishedAt: string
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
  'account_revision',
  'direct_read',
  'metadata_read',
  'device_read',
  'known_device_preflight',
  'folder_crud',
  'cipher_create',
  'cipher_lifecycle',
  'revision_conflict',
  'device_revoke',
  'session_revoke',
  'totp_login',
  'sync_with_items',
] as const

describe('client compatibility matrix', () => {
  const matrix = readMatrix()
  const fixtureFlows = readFixtureFlows()

  it('records release metadata provenance', () => {
    expect(matrix.schemaVersion).toBe(1)
    expect(matrix.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    expect(matrix.sourceKind).toBe('official-upstream-release-metadata')
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
      expect(['fixture_only', 'live_smoke']).toContain(entry.verificationLevel)
      expect(entry.knownIssues.length).toBeGreaterThanOrEqual(1)

      if (entry.verificationLevel === 'live_smoke') {
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

  it('records the alpha CLI live smoke while keeping other surfaces conservative', () => {
    const cliEntry = matrix.entries.find((entry) => entry.surface === 'cli')
    expect(cliEntry?.verificationLevel).toBe('live_smoke')
    expect(cliEntry?.liveEvidence?.path).toBe(
      'docs/release/live-client-evidence.md',
    )

    const nonCliEntries = matrix.entries.filter(
      (entry) => entry.surface !== 'cli',
    )
    for (const entry of nonCliEntries) {
      expect(entry.verificationLevel).toBe('fixture_only')
    }
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

import { readFileSync } from 'node:fs'
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
  coveredFlows: string[]
  knownIssues: string[]
}

const matrixPath = fileURLToPath(
  new URL('../../compat/client-matrix.json', import.meta.url).toString(),
)

const requiredSurfaces = [
  'browser_extension',
  'desktop',
  'mobile_android',
  'mobile_ios',
  'cli',
] as const

const requiredFlows = [
  'prelogin',
  'password_grant',
  'refresh_grant',
  'empty_sync',
  'folder_crud',
  'cipher_create',
  'cipher_lifecycle',
  'revision_conflict',
  'device_revoke',
] as const

describe('client compatibility matrix', () => {
  const matrix = readMatrix()

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
      expect(entry.verificationLevel).toBe('fixture_only')
      expect(entry.knownIssues.length).toBeGreaterThanOrEqual(1)

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

  it('keeps mobile build numbers explicit', () => {
    const mobileEntries = matrix.entries.filter((entry) =>
      entry.surface.startsWith('mobile_'),
    )

    expect(mobileEntries).toHaveLength(2)
    for (const entry of mobileEntries) {
      expect(entry.build).toMatch(/^\d+$/)
    }
  })
})

function readMatrix(): ClientMatrix {
  return JSON.parse(readFileSync(matrixPath, 'utf8')) as ClientMatrix
}

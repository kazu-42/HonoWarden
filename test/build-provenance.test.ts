import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  resolveBuildProvenance,
  type BuildProvenanceFailureReason,
} from '../src/build-provenance'

const validMetadata: WorkerVersionMetadata = {
  id: 'opaque-cloudflare-version-id',
  tag: '52ef7293615702b399cf5b3bcac7e607f191e51f',
  timestamp: '2026-08-16T00:00:00.000Z',
}

describe('build provenance', () => {
  it('keeps the config-bound claimed source SHA separate from the Worker version id', () => {
    expect(resolveBuildProvenance(validMetadata, 'staging')).toEqual({
      ok: true,
      build: {
        gitSha: validMetadata.tag,
        workerVersionId: validMetadata.id,
        createdAt: validMetadata.timestamp,
      },
    })
  })

  it('documents the version-metadata tag as a claim rather than deployed-byte proof', () => {
    const runbook = readFileSync(
      'docs/operations/deploy-provenance-runbook.md',
      'utf8',
    )

    expect(runbook).toContain('config-bound claimed source SHA')
    expect(runbook).toMatch(/does not\s+cryptographically bind/u)
    expect(runbook).toMatch(/external build\/deploy\s+record/u)
    expect(runbook).toContain('independent version and traffic readback')
  })

  it.each<{
    name: string
    metadata: WorkerVersionMetadata | undefined
    reason: BuildProvenanceFailureReason
  }>([
    {
      name: 'missing binding',
      metadata: undefined,
      reason: 'metadata_missing',
    },
    {
      name: 'empty Worker version id',
      metadata: { ...validMetadata, id: '   ' },
      reason: 'worker_version_id_invalid',
    },
    {
      name: 'empty tag',
      metadata: { ...validMetadata, tag: '' },
      reason: 'git_sha_invalid',
    },
    {
      name: 'placeholder tag',
      metadata: { ...validMetadata, tag: 'honowarden' },
      reason: 'git_sha_invalid',
    },
    {
      name: 'all-zero placeholder SHA',
      metadata: { ...validMetadata, tag: '0'.repeat(40) },
      reason: 'git_sha_invalid',
    },
    {
      name: 'short SHA',
      metadata: { ...validMetadata, tag: validMetadata.tag.slice(0, 12) },
      reason: 'git_sha_invalid',
    },
    {
      name: 'non-hex SHA',
      metadata: { ...validMetadata, tag: 'z'.repeat(40) },
      reason: 'git_sha_invalid',
    },
    {
      name: 'uppercase SHA',
      metadata: { ...validMetadata, tag: validMetadata.tag.toUpperCase() },
      reason: 'git_sha_invalid',
    },
    {
      name: 'invalid timestamp',
      metadata: { ...validMetadata, timestamp: 'not-a-timestamp' },
      reason: 'timestamp_invalid',
    },
    {
      name: 'non-ISO parseable timestamp',
      metadata: { ...validMetadata, timestamp: 'August 16, 2026 UTC' },
      reason: 'timestamp_invalid',
    },
    {
      name: 'normalized impossible calendar date',
      metadata: { ...validMetadata, timestamp: '2026-02-31T00:00:00.000Z' },
      reason: 'timestamp_invalid',
    },
  ])('rejects $name without inventing provenance', ({ metadata, reason }) => {
    expect(resolveBuildProvenance(metadata, 'production')).toEqual({
      ok: false,
      environment: 'production',
      reason,
      fatal: true,
    })
  })

  it('makes missing development metadata explicit without treating it as deployed provenance', () => {
    expect(resolveBuildProvenance(undefined, 'development')).toEqual({
      ok: false,
      environment: 'development',
      reason: 'metadata_missing',
      fatal: false,
    })
  })
})

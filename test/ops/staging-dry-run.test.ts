import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const dryRunScript = join(repoRoot, 'scripts/honowarden-staging-dry-run.mjs')

type StagingDryRunReport = {
  schemaVersion: number
  status: 'passed' | 'failed'
  mode: string
  command: string
  worker: {
    name: string
    environment: string
    databaseIdPlaceholder: boolean
  }
  bindings: {
    d1: {
      binding: string
      databaseName: string
    }
    r2: {
      binding: string
      bucketName: string
    }
  }
  bundle: {
    path: string
    bytes: number
    sha256: string
  }
  checks: Array<{
    id: string
    status: 'pass' | 'fail'
    detail: string
  }>
  limitations: string[]
}

describe('staging deploy dry run', () => {
  it('bundles the staging worker and records conservative evidence', async () => {
    const workDir = join('test/.tmp', `staging-dry-run-${randomUUID()}`)
    const reportPath = join(workDir, 'report.json')
    const result = await execFileAsync('node', [
      dryRunScript,
      '--out',
      join(workDir, 'bundle'),
      '--json',
      reportPath,
    ])
    const stdoutReport = JSON.parse(result.stdout) as StagingDryRunReport
    const fileReport = JSON.parse(
      readFileSync(join(repoRoot, reportPath), 'utf8'),
    ) as StagingDryRunReport

    expect(stdoutReport).toEqual(fileReport)
    expect(fileReport.schemaVersion).toBe(1)
    expect(fileReport.status).toBe('passed')
    expect(fileReport.mode).toBe('staging deploy dry-run')
    expect(fileReport.command).toContain('wrangler deploy --env staging')
    expect(fileReport.command).toContain('--dry-run')
    expect(fileReport.worker).toEqual({
      name: 'honowarden-staging',
      environment: 'staging',
      databaseIdPlaceholder: false,
    })
    expect(fileReport.bindings.d1).toEqual({
      binding: 'DB',
      databaseName: 'honowarden-staging',
    })
    expect(fileReport.bindings.r2).toEqual({
      binding: 'VAULT_OBJECTS',
      bucketName: 'honowarden-staging-vault-objects',
    })
    expect(fileReport.checks).toContainEqual({
      id: 'staging_refresh_token_retention_enabled',
      status: 'pass',
      detail: 'true',
    })
    expect(fileReport.checks).toContainEqual({
      id: 'production_refresh_token_retention_fail_closed',
      status: 'pass',
      detail: 'false',
    })
    expect(fileReport.bundle.bytes).toBeGreaterThan(0)
    expect(fileReport.bundle.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(existsSync(join(repoRoot, fileReport.bundle.path))).toBe(true)
    expect(fileReport.limitations).toContain(
      'Remote Cloudflare deploy was not performed.',
    )
    expect(fileReport.limitations).toContain(
      'Staging database_id is configured; resource creation evidence is recorded separately.',
    )
  }, 15_000)
})

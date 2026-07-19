import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const lifecycleScript = join(
  repoRoot,
  'scripts/honowarden-kdf-change-lifecycle.mjs',
)

type LifecycleReport = {
  schemaVersion: number
  status: 'passed' | 'failed'
  mode: string
  upstreamPins: {
    server: string
    client: string
  }
  routes: Record<string, number>
  readback: {
    kdfChangeAuditCount: number
    firstRevisionDate: string
    finalRevisionDate: string
  }
  checks: Array<{ id: string; status: 'pass' | 'fail' }>
  limitations: string[]
}

describe('account KDF-change local D1 lifecycle', () => {
  it('proves a PBKDF2 and Argon2id round trip with revision readback', async () => {
    const result = await execFileAsync('node', [lifecycleScript], {
      cwd: repoRoot,
      timeout: 90_000,
      maxBuffer: 2 * 1024 * 1024,
    })
    const report = JSON.parse(result.stdout) as LifecycleReport

    expect(report).toMatchObject({
      schemaVersion: 1,
      status: 'passed',
      mode: 'wrangler-local-d1-synthetic',
      upstreamPins: {
        server: 'v2026.6.1@a09c7edb03ae6d4fdece784f1250c67be73d5fe0',
        client: 'web-v2026.6.1@39f07436ca60e3f25eac47777671754f288a98f1',
      },
      routes: {
        prelogin: 200,
        unknownPreloginBeforeChange: 200,
        oldLoginBeforeChange: 200,
        verifyBeforeChange: 200,
        kdfChange: 200,
        preloginAfterChange: 200,
        unknownPreloginAfterChange: 200,
        oldAccessAfterChange: 401,
        oldRefreshAfterChange: 400,
        oldLoginAfterChange: 400,
        newLoginAfterChange: 200,
        syncAfterChange: 200,
        profileAfterChange: 200,
        refreshAfterChange: 200,
        verifyAfterChange: 200,
        kdfChangeBackToPbkdf2: 200,
        preloginAfterRoundTrip: 200,
        unknownPreloginAfterRoundTrip: 200,
        argonAccessAfterRoundTrip: 401,
        argonRefreshAfterRoundTrip: 400,
        argonLoginAfterRoundTrip: 400,
        pbkdf2LoginAfterRoundTrip: 200,
        syncAfterRoundTrip: 200,
        profileAfterRoundTrip: 200,
        refreshAfterRoundTrip: 200,
        verifyAfterRoundTrip: 200,
      },
      readback: {
        kdfChangeAuditCount: 2,
        firstRevisionDate: expect.any(String),
        finalRevisionDate: expect.any(String),
      },
    })
    expect(Date.parse(report.readback.firstRevisionDate)).toBeGreaterThan(
      Date.parse('2026-07-19T00:00:00.000Z'),
    )
    expect(Date.parse(report.readback.finalRevisionDate)).toBeGreaterThan(
      Date.parse(report.readback.firstRevisionDate),
    )
    expect(report.checks).not.toContainEqual(
      expect.objectContaining({ status: 'fail' }),
    )
    expect(report.checks).toContainEqual({
      id: 'kdf_changed_to_argon2id',
      status: 'pass',
    })
    expect(report.checks).toContainEqual({
      id: 'kdf_population_tracks_argon2id_generation',
      status: 'pass',
    })
    expect(report.checks).toContainEqual({
      id: 'unknown_prelogin_tracks_stored_distribution',
      status: 'pass',
    })
    expect(report.checks).toContainEqual({
      id: 'kdf_changed_back_to_pbkdf2',
      status: 'pass',
    })
    expect(report.checks).toContainEqual({
      id: 'kdf_population_tracks_final_pbkdf2_generation',
      status: 'pass',
    })
    expect(report.checks).toContainEqual({
      id: 'account_revision_advanced_each_generation',
      status: 'pass',
    })
    expect(report.checks).toContainEqual({
      id: 'old_argon_refresh_token_rejected',
      status: 'pass',
    })
    expect(report.limitations).toContain(
      'No remote Cloudflare resource, production deployment, real user, or official client UI was used.',
    )
    expect(result.stdout).not.toContain(
      'synthetic-hon204-old-authentication-hash',
    )
    expect(result.stdout).not.toContain(
      'synthetic-hon204-new-authentication-hash',
    )
    expect(result.stdout).not.toContain('2.synthetic-hon204-new-user-key')
    expect(result.stdout).not.toContain(
      'synthetic-hon204-final-pbkdf2-authentication-hash',
    )
    expect(result.stdout).not.toContain(
      '2.synthetic-hon204-final-pbkdf2-user-key',
    )
  }, 90_000)
})

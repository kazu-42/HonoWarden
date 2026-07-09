import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const reportScript = join(repoRoot, 'scripts/honowarden-abuse-report.mjs')

describe('abuse report CLI', () => {
  it('plans secret-safe request quota and auth-defense metric queries', async () => {
    const result = await execFileAsync('node', [
      reportScript,
      '--database',
      'honowarden',
      '--mode',
      'local',
    ])
    const output = JSON.parse(result.stdout) as {
      action: string
      executed: boolean
      commands: string[][]
      evidence: {
        plaintextClientAddresses: string
        bucketIdentifier: string
      }
      queries: Array<{ id: string; sql: string }>
    }

    expect(output).toMatchObject({
      action: 'abuse-report',
      executed: false,
      evidence: {
        plaintextClientAddresses: 'excluded',
        bucketIdentifier: 'hashed_prefix_only',
      },
    })
    expect(output.commands[0]).toEqual([
      'wrangler',
      'd1',
      'execute',
      'honowarden',
      '--local',
      '--command',
      expect.stringContaining('request_quota_buckets'),
    ])
    expect(output.queries.map((query) => query.id)).toEqual([
      'request_quota_summary',
      'request_quota_top_buckets',
      'auth_failure_summary',
      'auth_failure_top_buckets',
    ])
    const serialized = JSON.stringify(output)
    expect(serialized).not.toContain('203.0.113.10')
    expect(serialized).not.toContain('ip_address')
    expect(serialized).not.toContain('client_ip')
  })
})

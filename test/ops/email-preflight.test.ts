import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const preflightScript = join(repoRoot, 'scripts/honowarden-email-preflight.mjs')

type EmailPreflightReport = {
  schemaVersion: 1
  status: 'ready' | 'not_ready'
  domain: string
  checks: Array<{
    id: string
    status: 'pass' | 'fail'
    detail: string
  }>
  routes: Array<{
    address: string
    envVar: string
    destinationConfigured: boolean
  }>
  limitations: string[]
}

describe('email routing preflight', () => {
  it('reports missing Cloudflare and destination inputs without failing by default', async () => {
    const result = await execFileAsync('node', [preflightScript], {
      env: cleanEnv(),
    })
    const report = JSON.parse(result.stdout) as EmailPreflightReport

    expect(report.schemaVersion).toBe(1)
    expect(report.status).toBe('not_ready')
    expect(report.domain).toBe('honowarden.com')
    expect(statusById(report, 'cloudflare_api_token')).toBe('fail')
    expect(statusById(report, 'cloudflare_account_id')).toBe('fail')
    expect(statusById(report, 'cloudflare_zone_id')).toBe('fail')
    expect(report.routes).toHaveLength(6)
    expect(report.routes.every((route) => !route.destinationConfigured)).toBe(
      true,
    )
    expect(report.limitations).toContain(
      'This preflight does not call Cloudflare APIs or send email.',
    )
  })

  it('reports ready when every local input is configured without printing secret values', async () => {
    const env = {
      ...cleanEnv(),
      CLOUDFLARE_API_TOKEN: 'cf-secret-token',
      CLOUDFLARE_ACCOUNT_ID: 'account-id',
      CLOUDFLARE_ZONE_ID_HONOWARDEN_COM: 'zone-id',
      HONOWARDEN_SECURITY_FORWARD_TO: 'security-destination@example.test',
      HONOWARDEN_SUPPORT_FORWARD_TO: 'support-destination@example.test',
      HONOWARDEN_GENERAL_FORWARD_TO: 'hello-destination@example.test',
      HONOWARDEN_ADMIN_FORWARD_TO: 'admin-destination@example.test',
      HONOWARDEN_POSTMASTER_FORWARD_TO: 'postmaster-destination@example.test',
      HONOWARDEN_ABUSE_FORWARD_TO: 'abuse-destination@example.test',
    }
    const result = await execFileAsync('node', [preflightScript], { env })
    const report = JSON.parse(result.stdout) as EmailPreflightReport

    expect(report.status).toBe('ready')
    expect(report.routes.every((route) => route.destinationConfigured)).toBe(
      true,
    )
    expect(result.stdout).not.toContain('cf-secret-token')
    expect(result.stdout).not.toContain('security-destination@example.test')
    expect(result.stdout).not.toContain('support-destination@example.test')
  })

  it('fails strict mode when required inputs are missing', async () => {
    await expect(
      execFileAsync('node', [preflightScript, '--strict'], {
        env: cleanEnv(),
      }),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining('"status": "not_ready"'),
    })
  })
})

function statusById(report: EmailPreflightReport, id: string) {
  return report.checks.find((check) => check.id === id)?.status
}

function cleanEnv() {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
  }
}

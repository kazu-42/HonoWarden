import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const preflightScript = join(repoRoot, 'scripts/honowarden-email-preflight.mjs')
let isolatedHome = ''

beforeAll(async () => {
  isolatedHome = await mkdtemp(
    join(tmpdir(), 'honowarden-email-preflight-empty-home-'),
  )
})

afterAll(async () => {
  await rm(isolatedHome, { recursive: true, force: true })
})

type EmailPreflightReport = {
  schemaVersion: 2
  status: 'ready' | 'not_ready'
  domain: string
  checks: Array<{
    id: string
    status: 'pass' | 'fail' | 'warning'
    detail: string
    present?: boolean | null
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

    expect(report.schemaVersion).toBe(2)
    expect(report.status).toBe('not_ready')
    expect(report.domain).toBe('honowarden.com')
    expect(statusById(report, 'cloudflare_api_token')).toBe('fail')
    expect(report.checks).toContainEqual({
      id: 'wrangler_oauth_session',
      status: 'pass',
      present: false,
      detail: 'No Wrangler auth profile detected at standard auth locations',
    })
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

  it('rejects global-key-only auth as break-glass-only without printing secret values', async () => {
    const env = {
      ...cleanEnv(),
      CLOUDFLARE_GLOBAL_API_KEY: 'cf-global-secret-key',
      CLOUDFLARE_EMAIL: 'operator@example.test',
      CLOUDFLARE_ACCOUNT_ID: 'account-id',
      CLOUDFLARE_ZONE_ID_HONOWARDEN_COM: 'zone-id',
      HONOWARDEN_SECURITY_FORWARD_TO: 'shared-destination@example.test',
      HONOWARDEN_SUPPORT_FORWARD_TO: 'shared-destination@example.test',
      HONOWARDEN_GENERAL_FORWARD_TO: 'shared-destination@example.test',
      HONOWARDEN_ADMIN_FORWARD_TO: 'shared-destination@example.test',
      HONOWARDEN_POSTMASTER_FORWARD_TO: 'shared-destination@example.test',
      HONOWARDEN_ABUSE_FORWARD_TO: 'shared-destination@example.test',
    }
    const result = await execFileAsync('node', [preflightScript], { env })
    const report = JSON.parse(result.stdout) as EmailPreflightReport

    expect(report.status).toBe('not_ready')
    expect(report.checks).toContainEqual({
      id: 'cloudflare_api_token',
      status: 'fail',
      detail: expect.stringContaining(
        'Cloudflare global API key auth is break-glass only and is not accepted for routine Email Routing workflows',
      ),
    })
    expect(result.stdout).not.toContain('cf-global-secret-key')
    expect(result.stdout).not.toContain('operator@example.test')
    expect(result.stdout).not.toContain('shared-destination@example.test')
  })

  it('rejects a global key even when the scoped Email Routing token is configured', async () => {
    const env = {
      ...cleanEnv(),
      CLOUDFLARE_HONOWARDEN_EMAIL_ROUTING_TOKEN: 'email-routing-token',
      CLOUDFLARE_GLOBAL_API_KEY: 'cf-global-secret-key',
      CLOUDFLARE_EMAIL: 'operator@example.test',
      CLOUDFLARE_ACCOUNT_ID: 'account-id',
      CLOUDFLARE_ZONE_ID_HONOWARDEN_COM: 'zone-id',
      HONOWARDEN_SECURITY_FORWARD_TO: 'shared-destination@example.test',
      HONOWARDEN_SUPPORT_FORWARD_TO: 'shared-destination@example.test',
      HONOWARDEN_GENERAL_FORWARD_TO: 'shared-destination@example.test',
      HONOWARDEN_ADMIN_FORWARD_TO: 'shared-destination@example.test',
      HONOWARDEN_POSTMASTER_FORWARD_TO: 'shared-destination@example.test',
      HONOWARDEN_ABUSE_FORWARD_TO: 'shared-destination@example.test',
    }
    const result = await execFileAsync('node', [preflightScript], { env })
    const report = JSON.parse(result.stdout) as EmailPreflightReport

    expect(report.status).toBe('not_ready')
    expect(report.checks).toContainEqual({
      id: 'cloudflare_api_token',
      status: 'fail',
      detail: expect.stringContaining(
        'global API key auth is break-glass only',
      ),
    })
    expect(result.stdout).not.toContain('email-routing-token')
    expect(result.stdout).not.toContain('cf-global-secret-key')
    expect(result.stdout).not.toContain('operator@example.test')
  })

  it('accepts the dedicated Email Routing scoped token', async () => {
    const env = {
      ...cleanEnv(),
      CLOUDFLARE_HONOWARDEN_EMAIL_ROUTING_TOKEN: 'email-routing-token',
      CLOUDFLARE_ACCOUNT_ID: 'account-id',
      CLOUDFLARE_ZONE_ID_HONOWARDEN_COM: 'zone-id',
      HONOWARDEN_SECURITY_FORWARD_TO: 'shared-destination@example.test',
      HONOWARDEN_SUPPORT_FORWARD_TO: 'shared-destination@example.test',
      HONOWARDEN_GENERAL_FORWARD_TO: 'shared-destination@example.test',
      HONOWARDEN_ADMIN_FORWARD_TO: 'shared-destination@example.test',
      HONOWARDEN_POSTMASTER_FORWARD_TO: 'shared-destination@example.test',
      HONOWARDEN_ABUSE_FORWARD_TO: 'shared-destination@example.test',
    }
    const result = await execFileAsync('node', [preflightScript], { env })
    const report = JSON.parse(result.stdout) as EmailPreflightReport

    expect(report.status).toBe('ready')
    expect(report.checks).toContainEqual({
      id: 'cloudflare_api_token',
      status: 'pass',
      detail: 'CLOUDFLARE_HONOWARDEN_EMAIL_ROUTING_TOKEN configured',
    })
    expect(result.stdout).not.toContain('email-routing-token')
    expect(result.stdout).not.toContain('shared-destination@example.test')
  })

  it('warns when Wrangler OAuth configuration exists without reading or exposing it', async () => {
    const configHome = await mkdtemp(
      join(tmpdir(), 'honowarden-email-preflight-xdg-'),
    )
    const configDirectory = join(configHome, '.wrangler', 'config')
    const oauthToken = 'oauth-access-value-must-not-print'
    const refreshToken = 'oauth-refresh-value-must-not-print'
    const expirationTime = 'oauth-expiry-value-must-not-print'
    await mkdir(configDirectory, { recursive: true })
    await writeFile(
      join(configDirectory, 'broad-operator-profile.toml'),
      `oauth_token = "${oauthToken}"\nrefresh_token = "${refreshToken}"\nexpiration_time = "${expirationTime}"\nscopes = ["workers:write"]\n`,
    )

    const env = {
      ...cleanEnv(),
      XDG_CONFIG_HOME: configHome,
      CLOUDFLARE_ACCOUNT_ID: 'account-id',
      CLOUDFLARE_ZONE_ID_HONOWARDEN_COM: 'zone-id',
      HONOWARDEN_SECURITY_FORWARD_TO: 'shared-destination@example.test',
      HONOWARDEN_SUPPORT_FORWARD_TO: 'shared-destination@example.test',
      HONOWARDEN_GENERAL_FORWARD_TO: 'shared-destination@example.test',
      HONOWARDEN_ADMIN_FORWARD_TO: 'shared-destination@example.test',
      HONOWARDEN_POSTMASTER_FORWARD_TO: 'shared-destination@example.test',
      HONOWARDEN_ABUSE_FORWARD_TO: 'shared-destination@example.test',
    }
    const oauthOnlyResult = await execFileAsync('node', [preflightScript], {
      env,
    })
    const oauthOnlyReport = JSON.parse(
      oauthOnlyResult.stdout,
    ) as EmailPreflightReport

    expect(oauthOnlyReport.status).toBe('not_ready')
    expect(statusById(oauthOnlyReport, 'cloudflare_api_token')).toBe('fail')

    const result = await execFileAsync('node', [preflightScript], {
      env: {
        ...env,
        CLOUDFLARE_HONOWARDEN_EMAIL_ROUTING_TOKEN: 'email-routing-token',
      },
    })
    const report = JSON.parse(result.stdout) as EmailPreflightReport
    const oauthCheck = report.checks.find(
      (entry) => entry.id === 'wrangler_oauth_session',
    )

    expect(oauthCheck).toMatchObject({
      status: 'warning',
      present: true,
      detail: expect.stringContaining(
        'a successful Wrangler command does not prove scoped-only operation',
      ),
    })
    expect(report.status).toBe('ready')
    expect(result.stdout).not.toContain(oauthToken)
    expect(oauthOnlyResult.stdout).not.toContain(oauthToken)
    expect(result.stdout).not.toContain(refreshToken)
    expect(oauthOnlyResult.stdout).not.toContain(refreshToken)
    expect(result.stdout).not.toContain(expirationTime)
    expect(oauthOnlyResult.stdout).not.toContain(expirationTime)
    expect(result.stdout).not.toContain('workers:write')
    expect(result.stdout).not.toContain('broad-operator-profile.toml')
    expect(result.stdout).not.toContain('email-routing-token')
  })

  it('detects Windows named profiles and warns when no config root is knowable', async () => {
    const appData = await mkdtemp(
      join(tmpdir(), 'honowarden-email-preflight-appdata-'),
    )
    const configDirectory = join(appData, 'xdg.config', '.wrangler', 'config')
    await mkdir(configDirectory, { recursive: true })
    await writeFile(
      join(configDirectory, 'windows-operator-profile.enc'),
      'synthetic encrypted profile fixture',
    )

    const windowsResult = await execFileAsync('node', [preflightScript], {
      env: {
        PATH: process.env.PATH,
        HOME: '',
        USERPROFILE: '',
        XDG_CONFIG_HOME: '',
        APPDATA: appData,
      },
    })
    const windowsReport = JSON.parse(
      windowsResult.stdout,
    ) as EmailPreflightReport

    expect(
      windowsReport.checks.find(
        (entry) => entry.id === 'wrangler_oauth_session',
      ),
    ).toMatchObject({ status: 'warning', present: true })
    expect(windowsResult.stdout).not.toContain('windows-operator-profile.enc')

    const unknownResult = await execFileAsync('node', [preflightScript], {
      env: {
        PATH: process.env.PATH,
        HOME: '',
        USERPROFILE: '',
        XDG_CONFIG_HOME: '',
        APPDATA: '',
      },
    })
    const unknownReport = JSON.parse(
      unknownResult.stdout,
    ) as EmailPreflightReport

    expect(
      unknownReport.checks.find(
        (entry) => entry.id === 'wrangler_oauth_session',
      ),
    ).toMatchObject({ status: 'warning', present: null })
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

  it('handles npm-style -- separator before strict mode and exits with non-zero status', async () => {
    await expect(
      execFileAsync('node', [preflightScript, '--', '--strict'], {
        env: cleanEnv(),
      }),
    ).rejects.toMatchObject({
      code: 1,
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
    HOME: isolatedHome,
    XDG_CONFIG_HOME: '',
    APPDATA: '',
  }
}

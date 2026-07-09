import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const releaseDocs = [
  'index.md',
  'feature-freeze-checklist.md',
  'fresh-deploy-guide.md',
  'upgrade-guide.md',
  'rollback-guide.md',
  'migration-freeze.md',
  'release-gate-preflight.md',
  'tagging-runbook.md',
  'publication-gate.md',
  'live-client-evidence.md',
  'backup-restore-drill-evidence.md',
  'remote-backup-evidence.md',
  'staging-deploy-evidence.md',
  'cloudflare-resource-evidence.md',
  'log-retention-evidence.md',
  'v0.1.0-alpha-release-notes.md',
] as const

const releaseDocsRoot = fileURLToPath(
  new URL('../docs/release', import.meta.url).toString(),
)
const migrationsRoot = fileURLToPath(
  new URL('../migrations', import.meta.url).toString(),
)
const packageJsonPath = fileURLToPath(
  new URL('../package.json', import.meta.url).toString(),
)

describe('release feature-freeze docs', () => {
  it('keeps the required release documents present', () => {
    for (const docPath of releaseDocs) {
      const fullPath = join(releaseDocsRoot, docPath)
      expect(existsSync(fullPath), `${docPath} should exist`).toBe(true)
      expect(readFileSync(fullPath, 'utf8').trim().length).toBeGreaterThan(500)
    }
  })

  it('pins every migration file in the migration freeze document', () => {
    const freezeDoc = readReleaseDoc('migration-freeze.md')
    const migrationFiles = readdirSync(migrationsRoot)
      .filter((entry) => entry.endsWith('.sql'))
      .sort()

    expect(migrationFiles.length).toBeGreaterThan(0)
    for (const migrationFile of migrationFiles) {
      const migrationPath = join(migrationsRoot, migrationFile)
      const migrationRepoPath = `migrations/${basename(migrationPath)}`
      const hash = createHash('sha256')
        .update(readFileSync(migrationPath))
        .digest('hex')

      expect(freezeDoc).toContain(migrationRepoPath)
      expect(freezeDoc).toContain(hash)
    }
  })

  it('keeps release notes explicit about alpha exclusions and gates', () => {
    const releaseNotes = readReleaseDoc('v0.1.0-alpha-release-notes.md')

    expect(releaseNotes).toContain('HonoWarden is pre-alpha')
    expect(releaseNotes).toContain('Web Vault')
    expect(releaseNotes).toContain('browser session surface')
    expect(releaseNotes).toContain('public registration')
    expect(releaseNotes).toContain('organization membership')
    expect(releaseNotes).toContain('public file-sharing')
    expect(releaseNotes).toContain('delegated recovery')
    expect(releaseNotes).toContain('independent security audit')
    expect(releaseNotes).toContain('fixture_only')
    expect(releaseNotes).toContain('D1 audit-event persistence')
    expect(releaseNotes).toContain('vault mutation audit event coverage')
  })

  it('aligns the package version with the alpha target', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      version?: string
    }

    expect(packageJson.version).toBe('0.1.0-alpha')
  })

  it('keeps tag creation approval-gated', () => {
    const runbook = readReleaseDoc('tagging-runbook.md')

    expect(runbook).toContain('requires explicit operator approval')
    expect(runbook).toContain(
      'pnpm release:tag:preflight -- --strict --check-remote',
    )
    expect(runbook).toContain('pnpm release:evidence:bundle -- --strict')
    expect(runbook).toContain('pnpm release:post-tag:packet -- --strict')
    expect(runbook).toContain('pnpm release:publish:packet -- --strict')
    expect(runbook).toContain('pnpm release:published:packet -- --strict')
    expect(runbook).toContain('pnpm release:status:packet -- --strict')
    expect(runbook).toContain('pnpm release:tag:recovery -- --strict')
    expect(runbook).toContain('--force-with-lease')
    expect(runbook).toContain('git tag -a v0.1.0-alpha')
    expect(runbook).toContain('git push origin v0.1.0-alpha')
    expect(runbook).toContain('Do not silently retag')
  })

  it('keeps release publication proof and the original approval gate auditable', () => {
    const runbook = readReleaseDoc('publication-gate.md')

    expect(runbook).toContain('Status: published verified')
    expect(runbook).toContain('Published at: `2026-07-08T01:37:46Z`')
    expect(runbook).toContain('Status packet: `phase: "published_verified"`')
    expect(runbook).toContain(
      'e7a3c5ea9e51030143736bb0e7a36cb7a8babfce の v0.1.0-alpha draft prerelease を公開してよい',
    )
    expect(runbook).toContain(
      'pnpm release:status:packet -- --strict --tag-workflow-run-id 28863312935',
    )
    expect(runbook).toContain(
      'gh release edit v0.1.0-alpha --draft=false --prerelease --verify-tag --repo kazu-42/HonoWarden',
    )
    expect(runbook).toContain(
      'pnpm release:published:packet -- --strict --tag-workflow-run-id 28863312935',
    )
    expect(runbook).toContain(
      'pnpm release:completion:audit -- --strict --tag-workflow-run-id 28863312935',
    )
    expect(runbook).toContain(
      'pnpm ops:readiness:packet -- --tag-workflow-run-id 28863312935',
    )
    expect(runbook).toContain(
      'blockingReason: "release_publication_approval_required"',
    )
    expect(runbook).toContain('Expected post-publication state')
    expect(runbook).toContain('Do not deploy from this release')
  })

  it('keeps post-alpha operations evidence statuses honest', () => {
    const index = readReleaseDoc('index.md')
    const workerEvidence = readReleaseDoc('worker-live-smoke-evidence.md')
    const websiteEvidence = readReleaseDoc('website-live-evidence.md')
    const emailEvidence = readReleaseDoc('email-routing-evidence.md')
    const logRetentionEvidence = readReleaseDoc('log-retention-evidence.md')
    const rollbackEvidence = readReleaseDoc('ops-rollback-evidence.md')

    expect(index).toContain('worker-live-smoke-evidence.md')
    expect(index).toContain('website-live-evidence.md')
    expect(index).toContain('log-retention-evidence.md')
    expect(index).toContain('email-routing-evidence.md')
    expect(index).toContain('ops-rollback-evidence.md')

    expect(workerEvidence).toMatch(/^Status:\s*passed\.?\s*$/m)
    expect(workerEvidence).toContain('e7a3c5ea9e51030143736bb0e7a36cb7a8babfce')
    expect(workerEvidence).toContain('Candidate previous version ID')
    expect(workerEvidence).toContain('Approved recovery strategy')
    expect(workerEvidence).toContain('ops-rollback-evidence.md')
    expect(workerEvidence).toContain('synthetic prelogin: HTTP `403`')

    expect(websiteEvidence).toMatch(/^Status:\s*passed\.?\s*$/m)
    expect(websiteEvidence).toContain(
      '36b8171f7afd55bf306e5482cca454a0b3822a39',
    )
    expect(websiteEvidence).toContain(
      '97095812384b47e5a1798108d77d8224f75509f2',
    )
    expect(websiteEvidence).toContain('b408a4e2-4279-4a57-8172-698b1c77c6ab')
    expect(websiteEvidence).toContain('1c3fc838-3e84-448a-ba36-a8181f3e6eed')
    expect(websiteEvidence).toContain('eef4ab71-d6e8-401f-93c3-27e7bd2bcd91')
    expect(websiteEvidence).toContain('0f398ae5-6d01-42a8-bbe4-35378661ce81')
    expect(websiteEvidence).toContain('HTTPS smoke')
    expect(websiteEvidence).toContain(
      'https://github.com/kazu-42/HonoWarden/releases/tag/v0.1.0-alpha',
    )
    expect(websiteEvidence).toContain(
      'https://github.com/kazu-42/HonoWarden/blob/main/SECURITY.md',
    )
    expect(websiteEvidence).toContain('mailto:security@honowarden.com')
    expect(websiteEvidence).toContain('Contact: mailto:security@honowarden.com')
    expect(websiteEvidence).toContain('Preferred-Languages: en, ja')
    expect(websiteEvidence).toContain('Expires: 2027-07-08T00:00:00Z')
    expect(websiteEvidence).toContain('HTTP `308`, redirects')
    expect(websiteEvidence).toMatch(/does\s+not record private forwarding/)
    expect(websiteEvidence).toContain(
      'pnpm exec wrangler rollback eef4ab71-d6e8-401f-93c3-27e7bd2bcd91 --name honowarden-website --yes',
    )

    expect(emailEvidence).toMatch(/^Status:\s*passed\.?\s*$/m)
    expect(emailEvidence).toContain('approval')
    expect(emailEvidence).toContain('Current Readback: 2026-07-09')
    expect(emailEvidence).toMatch(/Cloudflare[\s\S]+global\s+API key auth/)
    expect(emailEvidence).toContain('API readback: `enabled: true`')
    expect(emailEvidence).toContain('API status: `ready`')
    expect(emailEvidence).toContain('Destination hash tag: `e732fc786e52`')
    expect(emailEvidence).toContain('Configured routes: `6/6`')
    expect(emailEvidence).toContain('c303ee9d52e94355a6a5c0680163927c')
    expect(emailEvidence).toContain('905639146eeaf7449af796d7bef2a8ab')
    expect(emailEvidence).toContain('Inbound smoke')
    expect(emailEvidence).toContain('Status: `passed`')
    expect(emailEvidence).toContain('redacted external mailbox')
    expect(emailEvidence).toContain('Subject: `テスト`')
    expect(emailEvidence).toContain('Cloudflare status for all six')
    expect(emailEvidence).toContain('Message ID hash tag')
    expect(emailEvidence).toContain('visible in the verified')
    expect(emailEvidence).toContain('rollback')

    expect(logRetentionEvidence).toMatch(/^Status:\s*passed\.?\s*$/m)
    expect(logRetentionEvidence).toContain('workers_trace_events')
    expect(logRetentionEvidence).toContain('honowarden-worker-logpush')
    expect(logRetentionEvidence).toContain(
      'honowarden-workers-trace-events-to-r2',
    )
    expect(logRetentionEvidence).toContain('Job ID: `1780267`')
    expect(logRetentionEvidence).toContain('logpush: true')
    expect(logRetentionEvidence).toContain('35 days')
    expect(logRetentionEvidence).toContain('hon49-logpush-smoke')
    expect(logRetentionEvidence).toContain('20260709T211217Z')
    expect(logRetentionEvidence).toContain('/REDACTED/staging')
    expect(logRetentionEvidence).toContain('/REDACTED/production')
    expect(logRetentionEvidence).not.toContain('secret-access-key=')

    expect(rollbackEvidence).toMatch(/^Status:\s*passed\.?\s*$/m)
    expect(rollbackEvidence).toContain('Approved recovery command')
    expect(rollbackEvidence).toContain(
      'e7a3c5ea9e51030143736bb0e7a36cb7a8babfce',
    )
    expect(rollbackEvidence).toContain(
      'pnpm exec wrangler deploy --env staging --dry-run',
    )
    expect(rollbackEvidence).toContain(
      'pnpm exec wrangler deploy --env production --dry-run',
    )
    expect(rollbackEvidence).toContain(
      'Do not run `pnpm exec wrangler rollback',
    )
    expect(rollbackEvidence).toContain('pre-correction `main` deployments')
    expect(rollbackEvidence).toContain('API Worker Rollback Rehearsal')
    expect(rollbackEvidence).toContain('Decision: `continue`')
    expect(rollbackEvidence).toContain('schemaVersion=0003')
    expect(rollbackEvidence).toContain('error.code=prelogin_not_allowed')
    expect(rollbackEvidence).toContain('b408a4e2-4279-4a57-8172-698b1c77c6ab')
    expect(rollbackEvidence).toContain('1c3fc838-3e84-448a-ba36-a8181f3e6eed')
    expect(rollbackEvidence).toContain('eef4ab71-d6e8-401f-93c3-27e7bd2bcd91')
    expect(rollbackEvidence).toContain('0f398ae5-6d01-42a8-bbe4-35378661ce81')
    expect(rollbackEvidence).toContain('Inbound smoke status: `passed`')
    expect(rollbackEvidence).toContain('Email Routing Rollback Handle')
    expect(rollbackEvidence).toContain('c303ee9d52e94355a6a5c0680163927c')
    expect(rollbackEvidence).toContain('905639146eeaf7449af796d7bef2a8ab')
    expect(rollbackEvidence).toContain(
      'Actual API Worker traffic-changing rollback or redeploy was not performed',
    )
    expect(rollbackEvidence).toContain('rollback')
  })
})

function readReleaseDoc(
  docPath:
    | (typeof releaseDocs)[number]
    | 'worker-live-smoke-evidence.md'
    | 'website-live-evidence.md'
    | 'email-routing-evidence.md'
    | 'log-retention-evidence.md'
    | 'ops-rollback-evidence.md',
): string {
  return readFileSync(join(releaseDocsRoot, docPath), 'utf8')
}

#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { error as logError, log } from 'node:console'
import process from 'node:process'

import { parse } from 'jsonc-parser'

const repoRoot = fileURLToPath(new URL('..', import.meta.url).toString())

const requiredReleaseDocs = [
  'index.md',
  'feature-freeze-checklist.md',
  'fresh-deploy-guide.md',
  'upgrade-guide.md',
  'rollback-guide.md',
  'migration-freeze.md',
  'release-gate-preflight.md',
  'tagging-runbook.md',
  'live-client-evidence.md',
  'v0.1.0-alpha-release-notes.md',
]

const requiredWorkflowSlugs = [
  'week-20-backup-restore',
  'week-21-audit-observability',
  'week-22-compat-regression-suite',
  'week-23-user-isolation',
  'week-24-security-review-materials',
  'week-25-feature-freeze',
  'week-26-linear-tracking-setup',
  'week-26-release-gate-preflight',
  'week-26-backup-restore-drill-evidence',
  'week-26-staging-dry-run-evidence',
  'week-26-cloudflare-resource-evidence',
  'week-26-live-client-evidence',
  'week-26-cli-item-live-smoke',
  'week-26-ops-surface-plan',
  'week-26-totp-disable',
  'week-26-totp-setup-guard',
  'week-26-operator-env-guard',
  'week-26-email-routing-preflight',
  'week-26-device-list-api',
  'week-26-known-device-api',
  'week-26-alpha-version-alignment',
  'week-26-alpha-tag-preflight',
  'week-26-tagging-runbook',
  'week-26-remote-tag-preflight',
  'week-26-release-tag-workflow',
  'week-26-github-release-plan',
  'week-26-release-approval-packet',
  'week-26-post-tag-release-packet',
]

function buildReleaseGateReport() {
  const checks = [
    checkReleaseDocs(),
    checkPackageVersion(),
    checkMigrationFreeze(),
    checkDependencyAuditEvidence(),
    checkWorkflowEvidence(),
    checkCompatibilityMatrix(),
    checkLiveClientEvidence(),
    checkBackupRestoreDrillEvidence(),
    checkStagingDeployEvidence(),
    checkCloudflareResourceEvidence(),
    checkLinearSeed(),
  ]
  const summary = summarize(checks)

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    target: 'v0.1.0-alpha',
    overall: summary.block > 0 ? 'not_ready' : 'ready',
    summary,
    checks,
  }
}

function checkReleaseDocs() {
  const missing = []
  const tooShort = []

  for (const docPath of requiredReleaseDocs) {
    const fullPath = repoPath('docs/release', docPath)
    if (!existsSync(fullPath)) {
      missing.push(`docs/release/${docPath}`)
      continue
    }

    const content = readText('docs/release', docPath).trim()
    if (content.length <= 500) {
      tooShort.push(`docs/release/${docPath}`)
    }
  }

  if (missing.length > 0 || tooShort.length > 0) {
    return {
      id: 'release_docs_present',
      status: 'block',
      title: 'Release documents are present and substantive',
      evidence: ['docs/release/**'],
      details: { missing, tooShort },
      nextAction: 'Restore the required release documents before tagging.',
    }
  }

  return {
    id: 'release_docs_present',
    status: 'pass',
    title: 'Release documents are present and substantive',
    evidence: requiredReleaseDocs.map((docPath) => `docs/release/${docPath}`),
  }
}

function checkPackageVersion() {
  const packageJson = readJson('package.json')
  const expectedVersion = '0.1.0-alpha'

  if (packageJson.version !== expectedVersion) {
    return {
      id: 'package_version',
      status: 'block',
      title: 'Package version matches the alpha release target',
      evidence: ['package.json'],
      details: {
        expectedVersion,
        actualVersion: packageJson.version ?? null,
      },
      nextAction: 'Set package.json version to 0.1.0-alpha before tagging.',
    }
  }

  return {
    id: 'package_version',
    status: 'pass',
    title: 'Package version matches the alpha release target',
    evidence: ['package.json'],
    details: {
      version: packageJson.version,
    },
  }
}

function checkMigrationFreeze() {
  const freezeDoc = readText('docs/release/migration-freeze.md')
  const migrationFiles = readdirSync(repoPath('migrations'))
    .filter((entry) => entry.endsWith('.sql'))
    .sort()
  const missing = []

  for (const migrationFile of migrationFiles) {
    const migrationPath = repoPath('migrations', migrationFile)
    const repoMigrationPath = `migrations/${basename(migrationPath)}`
    const hash = createHash('sha256')
      .update(readFileSync(migrationPath))
      .digest('hex')

    if (!freezeDoc.includes(repoMigrationPath) || !freezeDoc.includes(hash)) {
      missing.push({ path: repoMigrationPath, sha256: hash })
    }
  }

  if (missing.length > 0) {
    return {
      id: 'migration_freeze_hashes',
      status: 'block',
      title: 'Migration freeze hashes match migrations on disk',
      evidence: ['docs/release/migration-freeze.md', 'migrations/*.sql'],
      details: { missing },
      nextAction: 'Update the migration freeze document in the same change.',
    }
  }

  return {
    id: 'migration_freeze_hashes',
    status: 'pass',
    title: 'Migration freeze hashes match migrations on disk',
    evidence: ['docs/release/migration-freeze.md', 'migrations/*.sql'],
    details: { migrations: migrationFiles.length },
  }
}

function checkDependencyAuditEvidence() {
  const auditDoc = readText('docs/security/dependency-audit.md')
  const lockfileHash = createHash('sha256')
    .update(readFileSync(repoPath('pnpm-lock.yaml')))
    .digest('hex')
  const hasHash = auditDoc.includes(lockfileHash)
  const hasCleanResult = auditDoc.includes('No known vulnerabilities found')

  if (!hasHash || !hasCleanResult) {
    return {
      id: 'dependency_audit_evidence',
      status: 'block',
      title: 'Dependency audit evidence matches the current lockfile',
      evidence: ['docs/security/dependency-audit.md', 'pnpm-lock.yaml'],
      details: { hasHash, hasCleanResult, currentLockfileSha256: lockfileHash },
      nextAction:
        'Run pnpm audit --audit-level low and update the dependency audit evidence.',
    }
  }

  return {
    id: 'dependency_audit_evidence',
    status: 'pass',
    title: 'Dependency audit evidence matches the current lockfile',
    evidence: ['docs/security/dependency-audit.md', 'pnpm-lock.yaml'],
    details: { lockfileSha256: lockfileHash },
  }
}

function checkWorkflowEvidence() {
  const failed = []

  for (const slug of requiredWorkflowSlugs) {
    const statePath = `.workflow/${slug}/state.json`
    const state = readJson(statePath)
    if (
      state.status !== 'completed' ||
      state.verification?.status !== 'passed' ||
      !hasCiEvidence(state.verification?.checks)
    ) {
      failed.push({
        slug,
        status: state.status,
        verification: state.verification?.status,
      })
    }
  }

  if (failed.length > 0) {
    return {
      id: 'workflow_evidence',
      status: 'block',
      title: 'Required Week 20-26 workflows are complete with CI evidence',
      evidence: requiredWorkflowSlugs.map(
        (slug) => `.workflow/${slug}/state.json`,
      ),
      details: { failed },
      nextAction: 'Complete workflow verification and record CI evidence.',
    }
  }

  return {
    id: 'workflow_evidence',
    status: 'pass',
    title: 'Required Week 20-26 workflows are complete with CI evidence',
    evidence: requiredWorkflowSlugs.map(
      (slug) => `.workflow/${slug}/state.json`,
    ),
  }
}

function hasCiEvidence(checks) {
  if (!Array.isArray(checks)) {
    return false
  }

  return checks.some((check) => {
    if (typeof check === 'string') {
      return check.startsWith('GitHub Actions CI run ')
    }

    return (
      check &&
      typeof check === 'object' &&
      check.name === 'GitHub Actions CI' &&
      check.status === 'passed' &&
      typeof check.run === 'string' &&
      check.run.length > 0
    )
  })
}

function checkCompatibilityMatrix() {
  const matrix = readJson('compat/client-matrix.json')
  const allowedVerificationLevels = new Set(['fixture_only', 'live_smoke'])
  const invalidVerificationRows = matrix.entries.filter(
    (entry) => !allowedVerificationLevels.has(entry.verificationLevel),
  )
  const promotedRows = matrix.entries.filter(
    (entry) => entry.verificationLevel !== 'fixture_only',
  )
  const promotedRowsWithoutEvidence = promotedRows.filter(
    (entry) => !hasMatrixLiveEvidence(entry),
  )
  const rowsWithoutKnownIssues = matrix.entries.filter(
    (entry) =>
      !Array.isArray(entry.knownIssues) || entry.knownIssues.length < 1,
  )

  if (
    invalidVerificationRows.length > 0 ||
    promotedRowsWithoutEvidence.length > 0 ||
    rowsWithoutKnownIssues.length > 0
  ) {
    return {
      id: 'compatibility_matrix_conservative',
      status: 'block',
      title: 'Compatibility matrix promotions are backed by live evidence',
      evidence: ['compat/client-matrix.json'],
      details: {
        invalidVerificationRows: invalidVerificationRows.map(
          (entry) => entry.surface,
        ),
        promotedRowsWithoutEvidence: promotedRowsWithoutEvidence.map(
          (entry) => entry.surface,
        ),
        rowsWithoutKnownIssues: rowsWithoutKnownIssues.map(
          (entry) => entry.surface,
        ),
      },
      nextAction:
        'Keep rows at fixture_only or attach complete liveEvidence before promotion.',
    }
  }

  return {
    id: 'compatibility_matrix_conservative',
    status: 'pass',
    title: 'Compatibility matrix promotions are backed by live evidence',
    evidence: ['compat/client-matrix.json'],
    details: {
      entries: matrix.entries.length,
      promotedRows: promotedRows.map((entry) => entry.surface),
    },
  }
}

function checkLiveClientEvidence() {
  const matrix = readJson('compat/client-matrix.json')
  const cliEntry = matrix.entries.find((entry) => entry.surface === 'cli')
  const evidencePath =
    typeof cliEntry?.liveEvidence?.path === 'string'
      ? cliEntry.liveEvidence.path
      : 'docs/release/live-client-evidence.md'

  if (
    !cliEntry ||
    cliEntry.verificationLevel !== 'live_smoke' ||
    !hasMatrixLiveEvidence(cliEntry)
  ) {
    return {
      id: 'live_client_evidence',
      status: 'block',
      title:
        'Synthetic CLI live-client evidence is recorded before alpha tagging',
      evidence: ['compat/client-matrix.json', evidencePath],
      details: {
        cliVerificationLevel: cliEntry?.verificationLevel ?? null,
        liveEvidence: cliEntry?.liveEvidence ?? null,
      },
      nextAction:
        'Run the synthetic CLI login and sync smoke, then link redacted evidence before tagging.',
    }
  }

  const evidenceDoc = readText(evidencePath)
  const requiredEvidence = [
    'Status: passed',
    'Mode: local synthetic CLI live smoke',
    'Client surface: `cli`',
    'Client version: `2026.6.0`',
    'Server: local wrangler dev worker',
    'Proxy: local HTTPS compression-stripping proxy',
    'Flow: `/identity/accounts/prelogin/password`',
    'Flow: `/identity/connect/token`',
    'Flow: `/api/sync`',
    'Flow: `/api/config`',
    'Flow: `/api/accounts/revision-date`',
    'Login result: session key length 88',
    'Sync result: `Syncing complete.`',
    'Non-TLS stderr lines: `0`',
    'Real secrets: none',
  ]
  const missingEvidence = requiredEvidence.filter(
    (required) => !evidenceDoc.includes(required),
  )

  if (missingEvidence.length > 0) {
    return {
      id: 'live_client_evidence',
      status: 'block',
      title:
        'Synthetic CLI live-client evidence is recorded before alpha tagging',
      evidence: ['compat/client-matrix.json', evidencePath],
      details: { missingEvidence },
      nextAction:
        'Complete the live-client evidence with flow, client, server, redaction, and result fields.',
    }
  }

  return {
    id: 'live_client_evidence',
    status: 'pass',
    title:
      'Synthetic CLI live-client evidence is recorded before alpha tagging',
    evidence: ['compat/client-matrix.json', evidencePath],
  }
}

function hasMatrixLiveEvidence(entry) {
  const evidence = entry.liveEvidence

  return (
    evidence &&
    evidence.status === 'passed' &&
    evidence.clientVersion === entry.version &&
    typeof evidence.path === 'string' &&
    existsSync(repoPath(evidence.path)) &&
    typeof evidence.recordedAt === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(evidence.recordedAt) &&
    Array.isArray(evidence.flows) &&
    evidence.flows.length > 0
  )
}

function checkBackupRestoreDrillEvidence() {
  const evidencePath = 'docs/release/backup-restore-drill-evidence.md'

  if (!existsSync(repoPath(evidencePath))) {
    return {
      id: 'backup_restore_drill_evidence',
      status: 'block',
      title: 'Backup export and fresh-target restore drill evidence exists',
      evidence: ['docs/operations/backup-restore.md'],
      details: { expectedEvidencePath: evidencePath },
      nextAction:
        'Run a synthetic backup/restore drill and record source, target, commands, and verification result.',
    }
  }

  const evidenceDoc = readText(evidencePath)
  const requiredEvidence = [
    'Status: passed',
    'Mode: local synthetic drill',
    'Source commit:',
    'Wrangler version:',
    'Export command:',
    'Restore command:',
    'D1 SQL SHA-256:',
    'Verification result:',
  ]
  const missingEvidence = requiredEvidence.filter(
    (required) => !evidenceDoc.includes(required),
  )

  if (missingEvidence.length > 0) {
    return {
      id: 'backup_restore_drill_evidence',
      status: 'block',
      title: 'Backup export and fresh-target restore drill evidence exists',
      evidence: [evidencePath],
      details: { missingEvidence },
      nextAction:
        'Complete the backup/restore drill evidence with source, target, commands, checksum, and verification result.',
    }
  }

  return {
    id: 'backup_restore_drill_evidence',
    status: 'pass',
    title: 'Backup export and fresh-target restore drill evidence exists',
    evidence: [evidencePath],
  }
}

function checkStagingDeployEvidence() {
  const evidencePath = 'docs/release/staging-deploy-evidence.md'

  if (!existsSync(repoPath(evidencePath))) {
    return {
      id: 'staging_deploy_evidence',
      status: 'block',
      title: 'Staging fresh deploy smoke evidence exists',
      evidence: ['docs/release/fresh-deploy-guide.md'],
      details: { expectedEvidencePath: evidencePath },
      nextAction:
        'Deploy to staging or run the documented staging dry-run and record smoke results.',
    }
  }

  const evidenceDoc = readText(evidencePath)
  const requiredEvidence = [
    'Status: passed',
    'Mode: staging deploy dry-run',
    'Source commit:',
    'Wrangler version:',
    'Dry-run command:',
    'Worker name: `honowarden-staging`',
    'D1 binding: `DB -> honowarden-staging`',
    'R2 binding: `VAULT_OBJECTS -> honowarden-staging-vault-objects`',
    'Bundle SHA-256:',
    'Local smoke checks:',
    'Remote deploy: not performed',
    'Database ID placeholder: false',
  ]
  const missingEvidence = requiredEvidence.filter(
    (required) => !evidenceDoc.includes(required),
  )

  if (missingEvidence.length > 0) {
    return {
      id: 'staging_deploy_evidence',
      status: 'block',
      title: 'Staging fresh deploy smoke evidence exists',
      evidence: [evidencePath],
      details: { missingEvidence },
      nextAction:
        'Complete staging dry-run evidence with command, bindings, bundle hash, smoke checks, and explicit limitations.',
    }
  }

  return {
    id: 'staging_deploy_evidence',
    status: 'pass',
    title: 'Staging fresh deploy smoke evidence exists',
    evidence: [evidencePath],
  }
}

function checkCloudflareResourceEvidence() {
  const evidencePath = 'docs/release/cloudflare-resource-evidence.md'
  const wranglerConfig = readJsonc('wrangler.jsonc')
  const databaseIds = [
    wranglerConfig.d1_databases?.[0]?.database_id,
    wranglerConfig.env?.staging?.d1_databases?.[0]?.database_id,
    wranglerConfig.env?.production?.d1_databases?.[0]?.database_id,
  ].filter(Boolean)
  const placeholderDatabaseIds = databaseIds.filter(
    (id) => id === '00000000-0000-0000-0000-000000000000',
  )

  if (!existsSync(repoPath(evidencePath))) {
    return {
      id: 'cloudflare_resource_evidence',
      status: 'block',
      title: 'Cloudflare staging and production resource evidence exists',
      evidence: ['docs/release/fresh-deploy-guide.md', 'wrangler.jsonc'],
      details: { expectedEvidencePath: evidencePath },
      nextAction:
        'Create or verify Cloudflare D1/R2/Worker resources and record non-secret names, ids, and rollback notes.',
    }
  }

  const evidenceDoc = readText(evidencePath)
  const requiredEvidence = [
    'Status: passed',
    'Mode: Cloudflare resource creation and verification',
    'Account name: `gHive`',
    'Account ID: `7e31a4cfe4ffd2cfff49c04236261de8`',
    'Staging D1: `honowarden-staging`',
    'Staging D1 ID: `95cd44de-809f-473c-9972-f892fa32ceb8`',
    'Production D1: `honowarden`',
    'Production D1 ID: `21ef7fa8-f26d-4024-82cb-c7b88ee02433`',
    'Staging R2: `honowarden-staging-vault-objects`',
    'Production R2: `honowarden-vault-objects`',
    'Staging remote migrations: `0001`, `0002`, `0003`',
    'Worker deploy: not performed',
    'Secret writes: not performed',
    'Route writes: not performed',
    'Rollback:',
  ]
  const missingEvidence = requiredEvidence.filter(
    (required) => !evidenceDoc.includes(required),
  )

  if (placeholderDatabaseIds.length > 0 || missingEvidence.length > 0) {
    return {
      id: 'cloudflare_resource_evidence',
      status: 'block',
      title: 'Cloudflare staging and production resource evidence exists',
      evidence: [evidencePath, 'wrangler.jsonc'],
      details: { placeholderDatabaseIds, missingEvidence },
      nextAction:
        'Complete Cloudflare resource evidence and replace placeholder D1 database IDs.',
    }
  }

  return {
    id: 'cloudflare_resource_evidence',
    status: 'pass',
    title: 'Cloudflare staging and production resource evidence exists',
    evidence: [evidencePath],
  }
}

function checkLinearSeed() {
  const seed = readJson('ops/linear/honowarden.seed.json')
  const hasViews = Array.isArray(seed.views) && seed.views.length >= 5
  const hasIssues = Array.isArray(seed.issues) && seed.issues.length >= 12

  if (seed.workspaceSlug !== 'honowarden' || !hasViews || !hasIssues) {
    return {
      id: 'linear_tracking_seed',
      status: 'block',
      title: 'Linear tracking seed is ready to apply to the workspace',
      evidence: ['ops/linear/honowarden.seed.json'],
      details: {
        workspaceSlug: seed.workspaceSlug,
        views: seed.views?.length ?? 0,
        issues: seed.issues?.length ?? 0,
      },
      nextAction: 'Fix the Linear seed before applying it to the workspace.',
    }
  }

  return {
    id: 'linear_tracking_seed',
    status: 'pass',
    title: 'Linear tracking seed is ready to apply to the workspace',
    evidence: ['ops/linear/honowarden.seed.json'],
    details: { views: seed.views.length, issues: seed.issues.length },
  }
}

function summarize(checks) {
  return checks.reduce(
    (summary, check) => {
      summary[check.status] += 1
      return summary
    },
    { pass: 0, manual: 0, block: 0 },
  )
}

function readJson(path) {
  return JSON.parse(readText(path))
}

function readJsonc(path) {
  return parse(readText(path))
}

function readText(...parts) {
  return readFileSync(repoPath(...parts), 'utf8')
}

function repoPath(...parts) {
  return join(repoRoot, ...parts)
}

function main(argv = process.argv.slice(2)) {
  const strict = argv.includes('--strict')
  const report = buildReleaseGateReport()
  log(JSON.stringify(report, null, 2))

  if (strict && report.overall !== 'ready') {
    logError(
      `release gate is not ready: ${report.summary.block} blocking check(s)`,
    )
    process.exitCode = 1
  }
}

main()

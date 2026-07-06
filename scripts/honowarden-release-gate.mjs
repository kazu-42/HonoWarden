#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { error as logError, log } from 'node:console'
import process from 'node:process'

const repoRoot = fileURLToPath(new URL('..', import.meta.url).toString())

const requiredReleaseDocs = [
  'index.md',
  'feature-freeze-checklist.md',
  'fresh-deploy-guide.md',
  'upgrade-guide.md',
  'rollback-guide.md',
  'migration-freeze.md',
  'release-gate-preflight.md',
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
]

function buildReleaseGateReport() {
  const checks = [
    checkReleaseDocs(),
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
      !state.verification?.checks?.some((check) =>
        check.startsWith('GitHub Actions CI run '),
      )
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

function checkCompatibilityMatrix() {
  const matrix = readJson('compat/client-matrix.json')
  const nonFixtureRows = matrix.entries.filter(
    (entry) => entry.verificationLevel !== 'fixture_only',
  )
  const rowsWithoutKnownIssues = matrix.entries.filter(
    (entry) =>
      !Array.isArray(entry.knownIssues) || entry.knownIssues.length < 1,
  )

  if (nonFixtureRows.length > 0 || rowsWithoutKnownIssues.length > 0) {
    return {
      id: 'compatibility_matrix_conservative',
      status: 'block',
      title: 'Compatibility matrix remains conservative until live evidence',
      evidence: ['compat/client-matrix.json'],
      details: {
        nonFixtureRows: nonFixtureRows.map((entry) => entry.surface),
        rowsWithoutKnownIssues: rowsWithoutKnownIssues.map(
          (entry) => entry.surface,
        ),
      },
      nextAction:
        'Do not promote matrix rows without linked synthetic live-client evidence.',
    }
  }

  return {
    id: 'compatibility_matrix_conservative',
    status: 'pass',
    title: 'Compatibility matrix remains conservative until live evidence',
    evidence: ['compat/client-matrix.json'],
    details: { entries: matrix.entries.length },
  }
}

function checkLiveClientEvidence() {
  const matrix = readJson('compat/client-matrix.json')
  const fixtureOnly = matrix.entries.filter(
    (entry) => entry.verificationLevel === 'fixture_only',
  )

  if (fixtureOnly.length > 0) {
    return {
      id: 'live_client_evidence',
      status: 'block',
      title: 'Synthetic live-client evidence is recorded before alpha tagging',
      evidence: ['compat/client-matrix.json'],
      details: {
        fixtureOnlySurfaces: fixtureOnly.map((entry) => entry.surface),
      },
      nextAction:
        'Run synthetic live-client login and sync checks, then link redacted evidence before tagging.',
    }
  }

  return {
    id: 'live_client_evidence',
    status: 'pass',
    title: 'Synthetic live-client evidence is recorded before alpha tagging',
    evidence: ['compat/client-matrix.json'],
  }
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

  return {
    id: 'staging_deploy_evidence',
    status: 'pass',
    title: 'Staging fresh deploy smoke evidence exists',
    evidence: [evidencePath],
  }
}

function checkCloudflareResourceEvidence() {
  const evidencePath = 'docs/release/cloudflare-resource-evidence.md'

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

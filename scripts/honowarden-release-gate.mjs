#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { error as logError, log } from 'node:console'
import process from 'node:process'

import { parse } from 'jsonc-parser'

import {
  hasClientMatrixLiveEvidence,
  inspectClientMatrix,
  isRegularRepositoryEvidenceFile,
  matrixLiveEvidencePaths as clientMatrixLiveEvidencePaths,
} from './honowarden-client-matrix-policy.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url).toString())
const publishedAlphaClientMatrixPath =
  'compat/releases/v0.1.0-alpha-client-matrix.json'
const publishedAlphaClientMatrixSha256 =
  '82ee5193499716331a7dfc46216f99f74569cb5bf89ec28548a4042daa7d9550'
const publishedAlphaSourceCommit = 'e7a3c5ea9e51030143736bb0e7a36cb7a8babfce'
const publishedAlphaSourceMatrixSha256 =
  '8076ec9d4fd9179b9f0616f6f6b5489acacae291058ba95854e4591be56c3491'
const publishedAlphaEvidenceManifest = [
  {
    sourcePath: 'docs/release/live-client-evidence.md',
    snapshotPath: 'docs/release/snapshots/v0.1.0-alpha/live-client-evidence.md',
    bytes: 5231,
    sha256: '3b2bc4c0b76ec7789f4833f7eed35b9cb764c90d4e72a0726d01e847e16af1ca',
  },
]
const publishedAlphaArchiveCheckIds = new Set([
  'compatibility_matrix_conservative',
  'live_client_evidence',
])

const requiredReleaseDocs = [
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
  'totp-recent-auth-live-evidence.md',
  'live-regression-matrix.md',
  'two-user-dogfood-evidence.md',
  'remote-backup-evidence.md',
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
  'week-26-release-evidence-shared-brand-scan',
  'week-26-email-routing-preflight',
  'week-26-device-list-api',
  'week-26-known-device-api',
  'week-26-device-metadata-update-api',
  'week-26-alpha-version-alignment',
  'week-26-alpha-tag-preflight',
  'week-26-tagging-runbook',
  'week-26-remote-tag-preflight',
  'week-26-release-tag-workflow',
  'week-26-release-tag-recovery',
  'week-26-github-release-plan',
  'week-26-retention-cleanup-cron-trigger',
  'week-26-release-approval-packet',
  'week-26-post-tag-release-packet',
  'week-26-release-publish-packet',
  'week-26-release-published-packet',
  'week-26-release-status-packet',
  'week-26-post-alpha-ops-readiness-packet',
  'week-26-ops-evidence-templates',
  'week-26-ops-readiness-release-approval-gate',
  'week-26-release-command-repo-scope',
  'week-26-publication-gate-runbook',
  'week-26-alpha-completion-audit',
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
  const publishedAlphaArchive = summarizeEvidenceLayer(
    checks.filter((check) => publishedAlphaArchiveCheckIds.has(check.id)),
  )
  const currentTree = summarizeEvidenceLayer(
    checks.filter((check) => !publishedAlphaArchiveCheckIds.has(check.id)),
  )

  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    target: 'v0.1.0-alpha',
    scope: 'repository_release_evidence',
    evidenceStatus: summary.block > 0 ? 'inconsistent' : 'consistent',
    executionStatus: 'not_admitted',
    overall: summary.block > 0 ? 'not_ready' : 'ready',
    layers: {
      currentTree,
      publishedAlphaArchive,
    },
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

    if (!check || typeof check !== 'object') {
      return false
    }

    const isGhRunView =
      typeof check.command === 'string' &&
      check.command.includes('gh run view ')
    const hasRunMetadata =
      (typeof check.run === 'string' && check.run.length > 0) ||
      (typeof check.runId === 'number' && check.runId > 0) ||
      (typeof check.runId === 'string' && check.runId.length > 0) ||
      (typeof check.url === 'string' && check.url.length > 0)

    return (
      check.status === 'passed' &&
      hasRunMetadata &&
      (check.name === 'GitHub Actions CI' || isGhRunView)
    )
  })
}

function checkCompatibilityMatrix() {
  const matrix = readJson(publishedAlphaClientMatrixPath)
  const snapshotSha256 = createHash('sha256')
    .update(readFileSync(repoPath(publishedAlphaClientMatrixPath)))
    .digest('hex')
  const evidenceManifest = inspectPublishedAlphaEvidenceManifest(matrix)
  const inspection = inspectClientMatrix(matrix, {
    evidenceIsRegularFile: (evidencePath) =>
      evidenceManifest.valid &&
      Object.hasOwn(evidenceManifest.resolvedPaths, evidencePath),
  })
  const reconstructedSourceMatrixSha256 = createHash('sha256')
    .update(
      `${JSON.stringify(
        {
          schemaVersion: matrix.schemaVersion,
          checkedAt: matrix.checkedAt,
          sourceKind: matrix.sourceKind,
          entries: matrix.entries,
        },
        null,
        2,
      )}\n`,
    )
    .digest('hex')
  const snapshotMetadataValid =
    matrix.releaseTarget === 'v0.1.0-alpha' &&
    matrix.snapshotKind === 'tag-time-client-evidence' &&
    matrix.sourceTag === 'v0.1.0-alpha' &&
    matrix.sourceCommit === publishedAlphaSourceCommit &&
    matrix.sourceMatrixPath === 'compat/client-matrix.json' &&
    matrix.sourceMatrixSha256 === publishedAlphaSourceMatrixSha256 &&
    reconstructedSourceMatrixSha256 === publishedAlphaSourceMatrixSha256
  const snapshotIntegrityValid =
    snapshotSha256 === publishedAlphaClientMatrixSha256

  if (
    !snapshotMetadataValid ||
    !snapshotIntegrityValid ||
    !evidenceManifest.valid ||
    inspection.invalidVerificationRows.length > 0 ||
    inspection.fixtureOnlyRowsWithLiveEvidence.length > 0 ||
    inspection.promotedRowsWithoutEvidence.length > 0 ||
    inspection.rowsWithoutKnownIssues.length > 0
  ) {
    return {
      id: 'compatibility_matrix_conservative',
      status: 'block',
      title:
        'Published alpha compatibility snapshot promotions are backed by live evidence',
      evidence: [publishedAlphaClientMatrixPath],
      details: {
        snapshotMetadataValid,
        snapshotIntegrityValid,
        expectedSha256: publishedAlphaClientMatrixSha256,
        actualSha256: snapshotSha256,
        reconstructedSourceMatrixSha256,
        expectedSourceMatrixSha256: publishedAlphaSourceMatrixSha256,
        evidenceManifestValid: evidenceManifest.valid,
        evidenceManifestFiles: evidenceManifest.files,
        invalidVerificationRows: inspection.invalidVerificationRows,
        fixtureOnlyRowsWithLiveEvidence:
          inspection.fixtureOnlyRowsWithLiveEvidence,
        promotedRowsWithoutEvidence: inspection.promotedRowsWithoutEvidence,
        rowsWithoutKnownIssues: inspection.rowsWithoutKnownIssues,
      },
      nextAction:
        'Restore the immutable tag-time alpha matrix and archived evidence bytes before accepting a historical promotion.',
    }
  }

  return {
    id: 'compatibility_matrix_conservative',
    status: 'pass',
    title:
      'Tag-time alpha compatibility promotions are backed by sealed live evidence',
    evidence: [
      publishedAlphaClientMatrixPath,
      ...publishedAlphaEvidenceManifest.map((entry) => entry.snapshotPath),
    ],
    details: {
      entries: matrix.entries.length,
      releaseTarget: matrix.releaseTarget,
      snapshotSha256,
      sourceCommit: matrix.sourceCommit,
      sourceMatrixSha256: reconstructedSourceMatrixSha256,
      promotedRows: inspection.promotedRows,
    },
  }
}

function checkLiveClientEvidence() {
  const matrix = readJson(publishedAlphaClientMatrixPath)
  const evidenceManifest = inspectPublishedAlphaEvidenceManifest(matrix)
  const promotedRows = matrix.entries.filter(
    (entry) => entry.verificationLevel !== 'fixture_only',
  )
  const promotedRowsWithoutEvidence = promotedRows.filter(
    (entry) => !hasMatrixLiveEvidence(entry, matrix),
  )
  const sourceEvidencePaths = Array.from(
    new Set(promotedRows.flatMap((entry) => matrixLiveEvidencePaths(entry))),
  )
  const evidencePaths = sourceEvidencePaths.map(
    (evidencePath) =>
      evidenceManifest.resolvedPaths[evidencePath] ?? evidencePath,
  )
  const cliEntry = matrix.entries.find((entry) => entry.surface === 'cli')
  const cliEvidenceSourcePath =
    typeof cliEntry?.liveEvidence?.path === 'string'
      ? cliEntry.liveEvidence.path
      : 'docs/release/live-client-evidence.md'
  const cliEvidencePath =
    evidenceManifest.resolvedPaths[cliEvidenceSourcePath] ??
    cliEvidenceSourcePath
  const cliEvidencePaths = matrixLiveEvidencePaths(cliEntry)
  const cliTotpEvidencePath = 'docs/release/totp-recent-auth-live-evidence.md'
  const browserEntry = matrix.entries.find(
    (entry) => entry.surface === 'browser_extension',
  )
  const browserEvidencePath =
    typeof browserEntry?.liveEvidence?.path === 'string'
      ? browserEntry.liveEvidence.path
      : 'docs/release/browser-extension-live-client-evidence.md'

  if (
    promotedRowsWithoutEvidence.length > 0 ||
    !cliEntry ||
    cliEntry.verificationLevel !== 'live_smoke' ||
    !hasMatrixLiveEvidence(cliEntry, matrix)
  ) {
    return {
      id: 'live_client_evidence',
      status: 'block',
      title: 'Tag-time synthetic CLI evidence is sealed for v0.1.0-alpha',
      evidence: [publishedAlphaClientMatrixPath, ...evidencePaths],
      details: {
        promotedRowsWithoutEvidence: promotedRowsWithoutEvidence.map(
          (entry) => entry.surface,
        ),
        cliVerificationLevel: cliEntry?.verificationLevel ?? null,
        liveEvidence: cliEntry?.liveEvidence ?? null,
      },
      nextAction:
        'Restore the sealed tag-time CLI evidence archive and its manifest entry.',
    }
  }

  const cliEvidenceDoc = readText(cliEvidencePath)
  const requiredCliEvidence = [
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
  const missingCliEvidence = requiredCliEvidence.filter(
    (required) => !cliEvidenceDoc.includes(required),
  )
  const requiresCliTotpEvidence =
    Array.isArray(cliEntry?.liveEvidence?.flows) &&
    cliEntry.liveEvidence.flows.includes('totp_login')
  const missingCliTotpEvidence = []
  if (requiresCliTotpEvidence) {
    if (!cliEvidencePaths.includes(cliTotpEvidencePath)) {
      missingCliTotpEvidence.push(
        `Linked evidence path: ${cliTotpEvidencePath}`,
      )
    } else {
      const cliTotpEvidenceDoc = readText(cliTotpEvidencePath)
      const requiredCliTotpEvidence = [
        'Status: passed',
        'Mode: local synthetic CLI plus HTTP auth lifecycle smoke',
        'Client surface: `cli`',
        'Client version: `2026.6.0`',
        'Flow: official CLI one-step TOTP password grant',
        'Flow: `/identity/accounts/totp/setup`',
        'Flow: `/identity/accounts/totp/change`',
        'Flow: `/identity/accounts/totp/disable`',
        'Flow: `/api/devices/revoke-all`',
        'Recent-auth rejection: refresh-auth token returned `reauth_required`',
        'CLI login result: session key length 88',
        'Real secrets: none',
      ]
      missingCliTotpEvidence.push(
        ...requiredCliTotpEvidence.filter(
          (required) => !cliTotpEvidenceDoc.includes(required),
        ),
      )
    }
  }
  const browserEvidenceDoc =
    browserEntry?.verificationLevel === 'live_smoke'
      ? readText(browserEvidencePath)
      : ''
  const requiredBrowserEvidence =
    browserEntry?.verificationLevel === 'live_smoke'
      ? [
          'Status: passed',
          'Mode: local synthetic browser-extension live smoke',
          'Client surface: `browser_extension`',
          'Client version: `2026.6.1`',
          'Server: local wrangler dev worker',
          'Flow: self-hosted environment selection',
          'Flow: `/identity/accounts/prelogin/password`',
          'Flow: `/identity/connect/token`',
          'Flow: `/api/sync`',
          'Flow: `/api/accounts/profile`',
          'Console and runtime exceptions: `0`',
          'Real secrets: none',
        ]
      : []
  const missingBrowserEvidence = requiredBrowserEvidence.filter(
    (required) => !browserEvidenceDoc.includes(required),
  )

  if (
    missingCliEvidence.length > 0 ||
    missingCliTotpEvidence.length > 0 ||
    missingBrowserEvidence.length > 0
  ) {
    return {
      id: 'live_client_evidence',
      status: 'block',
      title: 'Tag-time synthetic CLI evidence is sealed for v0.1.0-alpha',
      evidence: [publishedAlphaClientMatrixPath, ...evidencePaths],
      details: {
        missingCliEvidence,
        missingCliTotpEvidence,
        missingBrowserEvidence,
      },
      nextAction:
        'Complete the live-client evidence with flow, client, server, redaction, and result fields.',
    }
  }

  return {
    id: 'live_client_evidence',
    status: 'pass',
    title: 'Tag-time synthetic CLI evidence is sealed for v0.1.0-alpha',
    evidence: [publishedAlphaClientMatrixPath, ...evidencePaths],
  }
}

function matrixLiveEvidencePaths(entry) {
  return clientMatrixLiveEvidencePaths(entry)
}

function hasMatrixLiveEvidence(entry, matrix) {
  const evidenceManifest = inspectPublishedAlphaEvidenceManifest(matrix)
  return hasClientMatrixLiveEvidence(entry, {
    evidenceIsRegularFile: (evidencePath) =>
      evidenceManifest.valid &&
      Object.hasOwn(evidenceManifest.resolvedPaths, evidencePath),
  })
}

function inspectPublishedAlphaEvidenceManifest(matrix) {
  const metadataValid =
    JSON.stringify(matrix.evidenceManifest) ===
    JSON.stringify(publishedAlphaEvidenceManifest)
  const files = publishedAlphaEvidenceManifest.map((entry) => {
    let regularFile
    let actualBytes = null
    let actualSha256 = null
    try {
      regularFile = isRegularRepositoryEvidenceFile(
        repoRoot,
        entry.snapshotPath,
      )
      if (regularFile) {
        const contents = readFileSync(repoPath(entry.snapshotPath))
        actualBytes = contents.byteLength
        actualSha256 = createHash('sha256').update(contents).digest('hex')
      }
    } catch {
      regularFile = false
    }
    return {
      ...entry,
      regularFile,
      actualBytes,
      actualSha256,
      valid:
        regularFile &&
        actualBytes === entry.bytes &&
        actualSha256 === entry.sha256,
    }
  })
  const valid = metadataValid && files.every((entry) => entry.valid)
  return {
    valid,
    metadataValid,
    files,
    resolvedPaths: Object.fromEntries(
      publishedAlphaEvidenceManifest.map((entry) => [
        entry.sourcePath,
        entry.snapshotPath,
      ]),
    ),
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
      title: 'Published alpha staging dry-run evidence is sealed',
      evidence: ['docs/release/fresh-deploy-guide.md'],
      details: { expectedEvidencePath: evidencePath },
      nextAction:
        'Restore the historical repository-local staging dry-run evidence artifact.',
    }
  }

  const evidenceDoc = readText(evidencePath)
  const requiredEvidence = [
    'HISTORICAL EVIDENCE — NOT CURRENT EXECUTION AUTHORITY',
    'Historical target: `v0.1.0-alpha`',
    'Historical status: passed',
    'Historical mode: staging deploy dry-run',
    'Source commit:',
    'Wrangler version:',
    'Historical evidence command',
    'Historical Wrangler dry-run command',
    'Worker name: `honowarden-staging`',
    'D1 binding: `DB -> honowarden-staging`',
    'R2 binding: `VAULT_OBJECTS -> honowarden-staging-vault-objects`',
    'Bundle SHA-256:',
    'Recorded local smoke checks:',
    '`staging:dry-run` entrypoint is a static blocker',
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
      title: 'Published alpha staging dry-run evidence is sealed',
      evidence: [evidencePath],
      details: {
        evidenceKind: 'historical_repository_local_dry_run',
        currentExecutionAuthority: false,
        missingEvidence,
      },
      nextAction:
        'Restore the sealed historical dry-run record with its identity, bindings, bundle hash, smoke checks, and non-authority boundary.',
    }
  }

  return {
    id: 'staging_deploy_evidence',
    status: 'pass',
    title: 'Published alpha staging dry-run evidence is sealed',
    evidence: [evidencePath],
    details: {
      evidenceKind: 'historical_repository_local_dry_run',
      currentExecutionAuthority: false,
    },
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

function summarizeEvidenceLayer(checks) {
  const summary = summarize(checks)
  return {
    status: summary.block > 0 ? 'inconsistent' : 'consistent',
    summary,
    checkIds: checks.map((check) => check.id),
  }
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

#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { isAbsolute, join, normalize, relative } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'

const repoRoot = fileURLToPath(new URL('..', import.meta.url).toString())
const matrixPath = 'compat/client-matrix.json'
const allowedEnvironments = new Set(['local', 'staging', 'production'])
const evidenceRoot = 'docs/release/live-regression-evidence'
const requiredRegressionGroups = [
  {
    id: 'login',
    title: 'Login',
    flows: ['config', 'prelogin', 'password_grant'],
  },
  {
    id: 'sync',
    title: 'Sync',
    flows: ['initial_sync', 'post_mutation_sync'],
  },
  {
    id: 'item_lifecycle',
    title: 'Item lifecycle',
    flows: [
      'cipher_create',
      'cipher_update',
      'cipher_soft_delete',
      'cipher_permanent_delete',
    ],
  },
  {
    id: 'refresh',
    title: 'Refresh',
    flows: ['refresh_grant'],
  },
  {
    id: 'session_revoke',
    title: 'Session revoke',
    flows: ['session_revoke'],
  },
  {
    id: 'selected_auth_lifecycle',
    title: 'Selected auth lifecycle',
    anyOf: [
      'totp_login',
      'device_revoke',
      'revoke_all_other_sessions',
      'disabled_user_denied',
    ],
  },
]

function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv)
  const report = buildLiveRegressionPacket(options)

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

  if (options.strict && report.status !== 'ready') {
    process.stderr.write(
      `live regression packet is not ready: ${report.blockingReason}\n`,
    )
    process.exitCode = 1
  }
}

function buildLiveRegressionPacket(options) {
  const matrix = readJson(matrixPath)
  const matrixEntry = matrix.entries.find(
    (entry) => entry.surface === options.surface,
  )
  const clientVersion = options.clientVersion ?? matrixEntry?.version ?? null
  const clientBuild = options.clientBuild ?? matrixEntry?.build ?? null
  const sourceCommit = options.sourceCommit ?? gitRevParseShortHead()
  const runId = options.runId ?? defaultRunId(options.generatedAt)
  const evidenceDir =
    options.evidenceDir ?? `${evidenceRoot}/${options.surface}/${runId}`
  const observedFlows = [...new Set(options.flows)].sort()
  const flowGroups = requiredRegressionGroups.map((group) =>
    evaluateFlowGroup(group, observedFlows),
  )
  const requirements = [
    requirement({
      id: 'surface_tracked',
      passed: Boolean(matrixEntry),
      blocker: 'surface_not_tracked',
      evidence: [`surface: ${options.surface}`],
      nextAction:
        'Use one of the surfaces from compat/client-matrix.json before recording regression evidence.',
    }),
    requirement({
      id: 'client_version_recorded',
      passed: isNonEmptyString(clientVersion),
      blocker: 'client_version_missing',
      evidence: [
        `clientVersion: ${clientVersion ?? 'missing'}`,
        `clientBuild: ${clientBuild ?? 'none'}`,
      ],
      nextAction:
        'Pass --client-version or choose a tracked matrix surface with a recorded version.',
    }),
    requirement({
      id: 'environment_recorded',
      passed:
        allowedEnvironments.has(options.environment) &&
        isSafeServerUrl(options.serverUrl, options.environment),
      blocker: 'environment_or_server_url_invalid',
      evidence: [
        `environment: ${options.environment}`,
        `serverUrl: ${redactUrl(options.serverUrl) ?? 'missing'}`,
      ],
      nextAction:
        'Pass --environment local|staging|production and --server-url without credentials or query tokens.',
    }),
    requirement({
      id: 'source_commit_recorded',
      passed: /^[0-9a-f]{7,40}$/i.test(sourceCommit ?? ''),
      blocker: 'source_commit_missing',
      evidence: [`sourceCommit: ${sourceCommit ?? 'missing'}`],
      nextAction: 'Pass --source-commit with the server commit under test.',
    }),
    requirement({
      id: 'evidence_dir_safe',
      passed: isSafeEvidenceDir(evidenceDir),
      blocker: 'evidence_dir_outside_release_evidence',
      evidence: [`evidenceDir: ${evidenceDir}`],
      nextAction: `Use a path under ${evidenceRoot}/ so evidence stays in the expected release evidence tree.`,
    }),
    ...flowGroups.map((group) =>
      requirement({
        id: `flow_${group.id}`,
        passed: group.status === 'pass',
        blocker: `${group.id}_flow_missing`,
        evidence: group.evidence,
        nextAction: group.nextAction,
      }),
    ),
    requirement({
      id: 'synthetic_data_only',
      passed: options.syntheticDataOnly === true,
      blocker: 'synthetic_data_policy_missing',
      evidence: [`syntheticDataOnly: ${options.syntheticDataOnly}`],
      nextAction:
        'Keep runs synthetic-only. Do not record real vault secrets, real passwords, tokens, or personal data.',
    }),
  ]
  const failed = requirements.filter(
    (requirementEntry) => requirementEntry.status !== 'pass',
  )

  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt,
    status: failed.length === 0 ? 'ready' : 'not_ready',
    blockingReason: failed[0]?.blocker ?? null,
    targetVerificationLevel: 'live_regression',
    matrix: {
      path: matrixPath,
      surface: options.surface,
      currentVerificationLevel: matrixEntry?.verificationLevel ?? null,
      currentVersion: matrixEntry?.version ?? null,
      promotionRule:
        'Promote a matrix row to live_regression only after this packet is ready and the linked redacted evidence file is committed.',
    },
    client: {
      surface: options.surface,
      version: clientVersion,
      build: clientBuild,
      releaseTag: matrixEntry?.releaseTag ?? null,
    },
    environment: {
      kind: options.environment,
      serverUrl: redactUrl(options.serverUrl),
      sourceCommit,
      runId,
      evidenceDir,
    },
    flowCoverage: {
      observedFlows,
      groups: flowGroups,
    },
    requirements,
    evidenceTemplate: {
      summaryPath: `${evidenceDir}/summary.md`,
      requestLogPath: `${evidenceDir}/requests.redacted.jsonl`,
      responseLogPath: `${evidenceDir}/responses.redacted.jsonl`,
      serverLogPath: `${evidenceDir}/server.redacted.log`,
      matrixPatchPath: `${evidenceDir}/matrix-patch.json`,
      prohibitedContent: [
        'real vault data',
        'passwords',
        'access tokens',
        'refresh tokens',
        'session keys',
        'private keys',
        'seed phrases',
        'raw request bodies',
        'raw response bodies',
      ],
    },
    commands: {
      packet:
        'pnpm live:regression:packet -- --surface <surface> --client-version <version> --environment <local|staging|production> --server-url <url> --flow <flow>',
      matrixValidation: 'pnpm compat:test',
      releaseGate: 'pnpm release:gate -- --strict',
    },
    limitations: [
      'This packet generator does not run a live client binary.',
      'This packet generator does not deploy Workers, apply migrations, change Cloudflare resources, or mutate vault data.',
      'A ready packet is evidence shape validation; matrix promotion still requires the redacted run evidence referenced by the packet.',
    ],
  }
}

function evaluateFlowGroup(group, observedFlows) {
  if (Array.isArray(group.flows)) {
    const missing = group.flows.filter((flow) => !observedFlows.includes(flow))
    return {
      id: group.id,
      title: group.title,
      status: missing.length === 0 ? 'pass' : 'fail',
      requiredFlows: group.flows,
      observedFlows: group.flows.filter((flow) => observedFlows.includes(flow)),
      missingFlows: missing,
      evidence: [
        `required: ${group.flows.join(', ')}`,
        `missing: ${missing.length === 0 ? 'none' : missing.join(', ')}`,
      ],
      nextAction:
        missing.length === 0
          ? null
          : `Run and record missing flows: ${missing.join(', ')}`,
    }
  }

  const observed = group.anyOf.filter((flow) => observedFlows.includes(flow))
  return {
    id: group.id,
    title: group.title,
    status: observed.length > 0 ? 'pass' : 'fail',
    anyOf: group.anyOf,
    observedFlows: observed,
    missingFlows: observed.length > 0 ? [] : group.anyOf,
    evidence: [
      `anyOf: ${group.anyOf.join(', ')}`,
      `observed: ${observed.length === 0 ? 'none' : observed.join(', ')}`,
    ],
    nextAction:
      observed.length > 0
        ? null
        : `Run and record at least one auth lifecycle flow: ${group.anyOf.join(', ')}`,
  }
}

function requirement({ id, passed, blocker, evidence, nextAction }) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    blocker: passed ? null : blocker,
    evidence,
    nextAction: passed ? null : nextAction,
  }
}

function parseOptions(argv) {
  const options = {
    strict: false,
    surface: 'cli',
    clientVersion: null,
    clientBuild: null,
    environment: 'local',
    serverUrl: null,
    sourceCommit: null,
    runId: null,
    evidenceDir: null,
    flows: [],
    syntheticDataOnly: true,
    generatedAt: new Date().toISOString(),
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    switch (arg) {
      case '--':
        break
      case '--strict':
        options.strict = true
        break
      case '--surface':
        options.surface = takeValue(argv, (index += 1), arg)
        break
      case '--client-version':
        options.clientVersion = takeValue(argv, (index += 1), arg)
        break
      case '--client-build':
        options.clientBuild = takeValue(argv, (index += 1), arg)
        break
      case '--environment':
        options.environment = takeValue(argv, (index += 1), arg)
        break
      case '--server-url':
        options.serverUrl = takeValue(argv, (index += 1), arg)
        break
      case '--source-commit':
        options.sourceCommit = takeValue(argv, (index += 1), arg)
        break
      case '--run-id':
        options.runId = takeValue(argv, (index += 1), arg)
        break
      case '--evidence-dir':
        options.evidenceDir = takeValue(argv, (index += 1), arg)
        break
      case '--flow':
        options.flows.push(takeValue(argv, (index += 1), arg))
        break
      case '--generated-at':
        options.generatedAt = takeValue(argv, (index += 1), arg)
        break
      case '--allow-real-data':
        options.syntheticDataOnly = false
        break
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }

  return options
}

function takeValue(argv, index, optionName) {
  const value = argv[index]
  if (!value || value.startsWith('--')) {
    throw new Error(`${optionName} requires a value`)
  }
  return value
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isSafeServerUrl(value, environment) {
  if (!isNonEmptyString(value)) {
    return false
  }

  let url
  try {
    url = new URL(value)
  } catch {
    return false
  }

  if (url.username || url.password || url.search) {
    return false
  }

  if (environment === 'local') {
    return ['http:', 'https:'].includes(url.protocol)
  }

  return url.protocol === 'https:'
}

function redactUrl(value) {
  if (!isNonEmptyString(value)) {
    return null
  }

  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return '<invalid-url>'
  }
}

function isSafeEvidenceDir(value) {
  if (!isNonEmptyString(value) || isAbsolute(value)) {
    return false
  }

  const normalized = normalize(value)
  if (normalized.startsWith('..')) {
    return false
  }

  const relativeToRoot = relative(evidenceRoot, normalized)
  return (
    normalized === evidenceRoot ||
    (!relativeToRoot.startsWith('..') && !isAbsolute(relativeToRoot))
  )
}

function defaultRunId(generatedAt) {
  return generatedAt
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '')
    .replace('T', 'T')
    .replace('Z', 'Z')
}

function gitRevParseShortHead() {
  const result = spawnSync('git', ['rev-parse', '--short=12', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    return null
  }

  return result.stdout.trim()
}

function readJson(path) {
  return JSON.parse(readFileSync(repoPath(path), 'utf8'))
}

function repoPath(path) {
  return join(repoRoot, path)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}

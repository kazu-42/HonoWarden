#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { isAbsolute, join, normalize, relative } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'

const repoRoot = fileURLToPath(new URL('..', import.meta.url).toString())
const packagePath = 'package.json'
const allowedEnvironments = new Set(['local', 'staging', 'production'])
const evidenceRoot = 'docs/release/two-user-dogfood-evidence'
const requiredDogfoodGroups = [
  {
    id: 'bootstrap',
    title: 'Two synthetic users bootstrapped',
    flows: ['bootstrap_user_a', 'bootstrap_user_b'],
  },
  {
    id: 'isolation',
    title: 'Two-user personal vault isolation',
    flows: [
      'user_a_initial_sync',
      'user_b_initial_sync',
      'cross_user_sync_isolation',
      'cross_user_read_denied',
      'cross_user_mutation_denied',
    ],
  },
  {
    id: 'disabled_lifecycle',
    title: 'Disabled-user lifecycle denial',
    flows: [
      'disable_user',
      'disabled_password_grant_denied',
      'disabled_refresh_grant_denied',
      'disabled_sync_denied',
      'disabled_vault_crud_denied',
    ],
  },
  {
    id: 'rollback',
    title: 'Operator rollback path recorded',
    flows: ['enable_user_rollback_plan'],
  },
]

function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv)
  const report = buildDogfoodEvidencePacket(options)

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

  if (options.strict && report.status !== 'ready') {
    process.stderr.write(
      `dogfood evidence packet is not ready: ${report.blockingReason}\n`,
    )
    process.exitCode = 1
  }
}

function buildDogfoodEvidencePacket(options) {
  const packageJson = readJson(packagePath)
  const sourceCommit = options.sourceCommit ?? gitRevParseShortHead()
  const runId = options.runId ?? defaultRunId(options.generatedAt)
  const evidenceDir = options.evidenceDir ?? `${evidenceRoot}/${runId}`
  const observedFlows = [...new Set(options.flows)].sort()
  const syntheticUsers =
    options.syntheticUsers.length > 0
      ? [...new Set(options.syntheticUsers)]
      : ['synthetic-user-a', 'synthetic-user-b']
  const flowGroups = requiredDogfoodGroups.map((group) =>
    evaluateFlowGroup(group, observedFlows),
  )
  const requirements = [
    requirement({
      id: 'target_version_recorded',
      passed: packageJson.version === '0.1.0-alpha',
      blocker: 'target_version_mismatch',
      evidence: [`packageVersion: ${packageJson.version ?? 'missing'}`],
      nextAction:
        'Run the packet from the release branch that targets v0.1.0-alpha.',
    }),
    requirement({
      id: 'two_synthetic_users_recorded',
      passed:
        syntheticUsers.length === 2 &&
        syntheticUsers.every((user) => isSafeSyntheticUserTag(user)),
      blocker: 'synthetic_user_tags_invalid',
      evidence: syntheticUsers.map((user) => `syntheticUser: ${user}`),
      nextAction:
        'Record exactly two synthetic user tags. Do not use real email addresses or personal identifiers.',
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
        'Keep dogfood evidence synthetic-only. Do not record real vault payloads, real passwords, tokens, or personal data.',
    }),
  ]
  const failed = requirements.filter((entry) => entry.status !== 'pass')

  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt,
    status: failed.length === 0 ? 'ready' : 'not_ready',
    blockingReason: failed[0]?.blocker ?? null,
    targetEvidenceLevel: 'synthetic_dogfood',
    release: {
      packagePath,
      version: packageJson.version ?? null,
      target: 'v0.1.0-alpha',
    },
    environment: {
      kind: options.environment,
      serverUrl: redactUrl(options.serverUrl),
      sourceCommit,
      runId,
      evidenceDir,
    },
    subjects: {
      syntheticUsers,
      containsRealUserData: options.syntheticDataOnly !== true,
    },
    flowCoverage: {
      observedFlows,
      groups: flowGroups,
    },
    requirements,
    evidenceTemplate: {
      summaryPath: `${evidenceDir}/summary.md`,
      packetPath: `${evidenceDir}/dogfood-packet.json`,
      appTestPath: 'test/ops/dogfood-synthetic-lifecycle.test.ts',
      lifecyclePlanPath: `${evidenceDir}/account-lifecycle-plan.redacted.json`,
      httpSummaryPath: `${evidenceDir}/http-statuses.redacted.json`,
      prohibitedContent: [
        'real vault data',
        'real passwords',
        'access tokens',
        'refresh tokens',
        'session keys',
        'private keys',
        'seed phrases',
        'raw request bodies',
        'raw response bodies',
        'personal email addresses',
      ],
    },
    commands: {
      appEvidence:
        'pnpm vitest run test/ops/dogfood-synthetic-lifecycle.test.ts',
      packet:
        'pnpm dogfood:evidence:packet -- --strict --environment <local|staging|production> --server-url <url> --flow <flow>',
      accountLifecyclePlan:
        'pnpm account:lifecycle -- disable --email <synthetic-email> --database <db> --mode <local|remote> --reason <reason>',
      releaseGate: 'pnpm release:gate -- --strict',
    },
    limitations: [
      'This packet generator does not create accounts, run a client binary, deploy Workers, or mutate Cloudflare resources.',
      'The default packet is for local synthetic evidence; production account lifecycle execution remains operator-gated.',
      'A ready packet validates evidence shape and flow coverage; keep the referenced redacted evidence files with the run record.',
    ],
  }
}

function evaluateFlowGroup(group, observedFlows) {
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
    environment: 'local',
    serverUrl: null,
    sourceCommit: null,
    runId: null,
    evidenceDir: null,
    flows: [],
    syntheticUsers: [],
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
      case '--synthetic-user':
        options.syntheticUsers.push(takeValue(argv, (index += 1), arg))
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

function isSafeSyntheticUserTag(value) {
  return (
    typeof value === 'string' &&
    /^[a-z0-9][a-z0-9._-]{1,63}$/i.test(value) &&
    !value.includes('@')
  )
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

#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { error as logError, log } from 'node:console'
import { createHash } from 'node:crypto'
import process from 'node:process'

const defaultSeedPath = 'ops/linear/honowarden.seed.json'

async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv)
  const seed = await readJson(options.seedPath ?? defaultSeedPath)
  const preflightReport = options.preflightReportPath
    ? await readJson(options.preflightReportPath)
    : null
  const report = buildApplyPlan(seed, preflightReport)

  log(JSON.stringify(report, null, 2))

  if (options.strict && report.status !== 'ready') {
    process.exitCode = 1
  }
}

function parseOptions(argv) {
  const options = {
    seedPath: null,
    preflightReportPath: null,
    strict: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--') {
      continue
    }

    if (arg === '--strict') {
      options.strict = true
      continue
    }

    if (arg === '--seed') {
      const seedPath = argv[index + 1]
      if (!seedPath) {
        throw new Error('--seed requires a path')
      }

      options.seedPath = seedPath
      index += 1
      continue
    }

    if (arg === '--preflight-report') {
      const preflightReportPath = argv[index + 1]
      if (!preflightReportPath) {
        throw new Error('--preflight-report requires a path')
      }

      options.preflightReportPath = preflightReportPath
      index += 1
      continue
    }

    throw new Error(`Unknown option: ${arg}`)
  }

  return options
}

function buildApplyPlan(seed, preflightReport) {
  const generatedAt = new Date().toISOString()
  const seedSummary = summarizeSeed(seed)
  const seedFingerprint = fingerprintJson(seed)
  const expectedWorkspaceSlug = stringValue(seed.workspaceSlug)
  const expectedTeam = {
    key: stringValue(seed.team?.key),
    name: stringValue(seed.team?.name),
  }
  const baseChecks = [
    check(
      'seed_workspace',
      expectedWorkspaceSlug !== null,
      expectedWorkspaceSlug
        ? `seed workspaceSlug is ${expectedWorkspaceSlug}`
        : 'seed workspaceSlug is required',
    ),
    check(
      'seed_team',
      expectedTeam.key !== null && expectedTeam.name !== null,
      expectedTeam.key && expectedTeam.name
        ? `seed team is ${expectedTeam.key} / ${expectedTeam.name}`
        : 'seed team.key and team.name are required',
    ),
  ]
  const baseReport = {
    schemaVersion: 1,
    generatedAt,
    status: 'blocked',
    blockingReason: null,
    mode: 'plan',
    seed: seedSummary,
    preflight: summarizePreflight(preflightReport),
    checks: baseChecks,
    summary: null,
    operations: [],
    limitations: [
      'This apply plan is local-only and does not call Linear.',
      'It does not read LINEAR_API_KEY or any other credential.',
      'It is not proof that any Linear object has been created or updated.',
      'Pulse settings and project-scoped views still require manual or API-specific confirmation.',
    ],
  }

  if (!expectedWorkspaceSlug) {
    return finalizeReport(
      baseReport,
      'linear_seed_workspace_missing',
      buildOperations(seed, null, false),
    )
  }

  if (!expectedTeam.key || !expectedTeam.name) {
    return finalizeReport(
      baseReport,
      'linear_seed_team_missing',
      buildOperations(seed, null, false),
    )
  }

  if (!preflightReport) {
    return finalizeReport(
      {
        ...baseReport,
        checks: [
          ...baseChecks,
          check('linear_preflight_report', false, 'preflight report missing'),
        ],
      },
      'linear_preflight_report_missing',
      buildOperations(seed, null, false),
    )
  }

  const preflightChecks = [
    ...baseChecks,
    check('linear_preflight_report', true, 'preflight report supplied'),
    check(
      'linear_preflight_status',
      preflightReport.status === 'ready',
      preflightReport.status === 'ready'
        ? 'preflight report is ready'
        : `preflight report status is ${stringValue(preflightReport.status) ?? 'unknown'}`,
    ),
  ]

  if (preflightReport.status !== 'ready') {
    return finalizeReport(
      { ...baseReport, checks: preflightChecks },
      `linear_preflight_${stringValue(preflightReport.blockingReason) ?? 'not_ready'}`,
      buildOperations(seed, preflightReport, false),
    )
  }

  const preflightWorkspaceSlug = stringValue(preflightReport.workspace?.urlKey)
  const seedMatches = preflightSeedMatches(preflightReport, seedFingerprint)
  const preflightTeam = {
    id: stringValue(preflightReport.team?.id),
    key: stringValue(preflightReport.team?.key),
    name: stringValue(preflightReport.team?.name),
  }
  const workspaceMatches = preflightWorkspaceSlug === expectedWorkspaceSlug
  const teamMatches =
    preflightTeam.id !== null &&
    preflightTeam.key === expectedTeam.key &&
    preflightTeam.name === expectedTeam.name
  const readyChecks = [
    ...preflightChecks,
    check(
      'workspace',
      workspaceMatches,
      workspaceMatches
        ? `preflight workspace matched ${expectedWorkspaceSlug}`
        : `preflight workspace did not match ${expectedWorkspaceSlug}`,
    ),
    check(
      'seed_fingerprint',
      seedMatches,
      seedMatches
        ? 'preflight report seed fingerprint matches current seed'
        : 'preflight report was not generated for the current seed',
    ),
    check(
      'team',
      teamMatches,
      teamMatches
        ? `preflight team matched ${expectedTeam.key} / ${expectedTeam.name}`
        : `preflight team did not include ${expectedTeam.key} / ${expectedTeam.name} with an id`,
    ),
  ]

  if (!workspaceMatches) {
    return finalizeReport(
      { ...baseReport, checks: readyChecks },
      'linear_preflight_workspace_mismatch',
      buildOperations(seed, preflightReport, false),
    )
  }

  if (!teamMatches) {
    return finalizeReport(
      { ...baseReport, checks: readyChecks },
      'linear_preflight_team_missing',
      buildOperations(seed, preflightReport, false),
    )
  }

  if (!seedMatches) {
    return finalizeReport(
      { ...baseReport, checks: readyChecks },
      'linear_preflight_seed_mismatch',
      buildOperations(seed, preflightReport, false),
    )
  }

  const inventoryMismatches = collectInventoryMismatches(seed, preflightReport)
  const incompleteInventory = collectIncompleteInventory(preflightReport)
  const inventoryChecks = [
    ...readyChecks,
    check(
      'inventory_complete',
      incompleteInventory.length === 0,
      incompleteInventory.length === 0
        ? 'preflight inventory pages are complete for classified object types'
        : `preflight inventory incomplete: ${incompleteInventory.join(', ')}`,
    ),
    check(
      'inventory_seed',
      inventoryMismatches.length === 0,
      inventoryMismatches.length === 0
        ? 'preflight inventory expected names match current seed'
        : `preflight inventory mismatch: ${inventoryMismatches.join(', ')}`,
    ),
  ]

  if (incompleteInventory.length > 0) {
    return finalizeReport(
      { ...baseReport, checks: inventoryChecks },
      'linear_preflight_inventory_incomplete',
      buildOperations(seed, preflightReport, false),
    )
  }

  if (inventoryMismatches.length > 0) {
    return finalizeReport(
      { ...baseReport, checks: inventoryChecks },
      'linear_preflight_inventory_mismatch',
      buildOperations(seed, preflightReport, false),
    )
  }

  return finalizeReport(
    {
      ...baseReport,
      status: 'ready',
      checks: inventoryChecks,
    },
    null,
    buildOperations(seed, preflightReport, true),
  )
}

function buildOperations(seed, preflightReport, ready) {
  const inventory = ready ? preflightReport?.inventory : null
  const operations = []
  const projectNameToKey = new Map(
    arrayValue(seed.projects)
      .filter(
        (project) => stringValue(project.name) && stringValue(project.key),
      )
      .map((project) => [project.name, project.key]),
  )

  for (const label of arrayValue(seed.labels)) {
    operations.push({
      id: `linear:label:${label.name}`,
      kind: 'label',
      name: label.name,
      action: classifyInventoryName(label.name, inventory?.labels, ready),
      dependencies: [],
      fields: compactObject({
        color: label.color,
        description: label.description,
      }),
    })
  }

  const initiativeName = stringValue(seed.initiative?.name)
  if (initiativeName) {
    operations.push({
      id: `linear:initiative:${initiativeName}`,
      kind: 'initiative',
      name: initiativeName,
      action: classifyInventoryName(
        initiativeName,
        inventory?.initiative,
        ready,
      ),
      dependencies: [],
      seedKey: seed.initiative?.key,
      fields: compactObject({
        summary: seed.initiative?.summary,
        targetDate: seed.initiative?.targetDate,
        priority: seed.initiative?.priority,
      }),
    })
  }

  for (const project of arrayValue(seed.projects)) {
    operations.push({
      id: `linear:project:${project.key}`,
      kind: 'project',
      seedKey: project.key,
      name: project.name,
      action: classifyInventoryName(project.name, inventory?.projects, ready),
      dependencies: [
        ...(initiativeName ? [`linear:initiative:${initiativeName}`] : []),
        ...arrayValue(project.labels).map((label) => `linear:label:${label}`),
      ],
      fields: compactObject({
        summary: project.summary,
        description: project.description,
        startDate: project.startDate,
        targetDate: project.targetDate,
        priority: project.priority,
      }),
    })
  }

  for (const milestone of arrayValue(seed.milestones)) {
    operations.push({
      id: `linear:milestone:${milestone.projectKey}:${milestone.name}`,
      kind: 'milestone',
      name: milestone.name,
      action: ready ? 'create_or_update' : 'pending_preflight',
      dependencies: [`linear:project:${milestone.projectKey}`],
      fields: compactObject({
        projectKey: milestone.projectKey,
        targetDate: milestone.targetDate,
      }),
    })
  }

  for (const issue of arrayValue(seed.issues)) {
    operations.push({
      id: `linear:issue:${issue.key}`,
      kind: 'issue',
      seedKey: issue.key,
      title: issue.title,
      action: ready ? 'create_or_update' : 'pending_preflight',
      dependencies: issueDependencies(issue),
      fields: compactObject({
        projectKey: issue.projectKey,
        milestone: issue.milestone,
        priority: issue.priority,
        estimate: issue.estimate,
        stateType: issue.stateType,
        labels: issue.labels,
        blockedBy: issue.blockedBy,
        description: issue.description,
      }),
    })
  }

  for (const document of arrayValue(seed.documents)) {
    operations.push({
      id: `linear:document:${document.title}`,
      kind: 'document',
      title: document.title,
      action: classifyInventoryName(
        document.title,
        inventory?.documents,
        ready,
      ),
      dependencies: [`linear:project:${document.projectKey}`],
      fields: compactObject({
        projectKey: document.projectKey,
        content: document.content,
      }),
    })
  }

  for (const view of arrayValue(seed.views)) {
    const manualScope = view.scope === 'project' || view.scope === 'initiative'

    operations.push({
      id: `linear:view:${view.name}`,
      kind: 'view',
      name: view.name,
      action: !ready
        ? 'pending_preflight'
        : manualScope
          ? 'manual_confirm'
          : classifyInventoryName(view.name, inventory?.views, ready),
      dependencies: viewDependencies(view, projectNameToKey),
      fields: compactObject({
        scope: view.scope,
        type: view.type,
        layout: view.layout,
        filters: view.filters,
        groupBy: view.groupBy,
        orderBy: view.orderBy,
      }),
    })
  }

  if (seed.pulse?.workspaceDefaultCadence) {
    operations.push({
      id: 'linear:pulse:workspace-default',
      kind: 'pulse',
      name: 'Workspace Pulse defaults',
      action: ready ? 'manual_confirm' : 'pending_preflight',
      dependencies: [],
      fields: compactObject({
        workspaceDefaultCadence: seed.pulse.workspaceDefaultCadence,
        summaryDelivery: seed.pulse.summaryDelivery,
      }),
    })
  }

  if (seed.pulse?.projectUpdateReminder) {
    operations.push({
      id: 'linear:pulse:project-update-reminder',
      kind: 'pulse',
      name: 'Project update reminders',
      action: ready ? 'manual_confirm' : 'pending_preflight',
      dependencies: arrayValue(seed.projects).map(
        (project) => `linear:project:${project.key}`,
      ),
      fields: compactObject({
        projectUpdateReminder: seed.pulse.projectUpdateReminder,
      }),
    })
  }

  if (seed.pulse?.firstUpdate) {
    operations.push({
      id: `linear:pulse:first-update:${seed.pulse.firstUpdate.projectKey}`,
      kind: 'project_update',
      name: 'First project update',
      action: ready ? 'create_or_update' : 'pending_preflight',
      dependencies: [`linear:project:${seed.pulse.firstUpdate.projectKey}`],
      fields: compactObject({
        projectKey: seed.pulse.firstUpdate.projectKey,
        health: seed.pulse.firstUpdate.health,
        body: seed.pulse.firstUpdate.body,
      }),
    })
  }

  return operations
}

function issueDependencies(issue) {
  return [
    `linear:project:${issue.projectKey}`,
    ...(issue.milestone
      ? [`linear:milestone:${issue.projectKey}:${issue.milestone}`]
      : []),
    ...arrayValue(issue.labels).map((label) => `linear:label:${label}`),
    ...arrayValue(issue.blockedBy).map((key) => `linear:issue:${key}`),
  ]
}

function viewDependencies(view, projectNameToKey) {
  const filters = view.filters ?? {}

  return [
    ...arrayValue(filters.project).map((projectName) =>
      projectNameToKey.has(projectName)
        ? `linear:project:${projectNameToKey.get(projectName)}`
        : `linear:project-name:${projectName}`,
    ),
    ...arrayValue(filters.label).map((label) => `linear:label:${label}`),
    ...arrayValue(filters.labelAny).map((label) => `linear:label:${label}`),
  ]
}

function classifyInventoryName(name, inventorySummary, ready) {
  if (!ready) {
    return 'pending_preflight'
  }

  if (Array.isArray(inventorySummary?.missingNames)) {
    if (!Array.isArray(inventorySummary.expectedNames)) {
      return 'create_or_update'
    }

    if (!inventorySummary.expectedNames.includes(name)) {
      return 'create_or_update'
    }

    return inventorySummary.missingNames.includes(name)
      ? 'create'
      : 'confirm_existing'
  }

  if (inventorySummary?.missing === 0) {
    return 'confirm_existing'
  }

  return 'create_or_update'
}

function finalizeReport(report, blockingReason, operations) {
  return {
    ...report,
    blockingReason,
    summary: summarizeOperations(operations),
    operations,
  }
}

function summarizeOperations(operations) {
  return {
    total: operations.length,
    byKind: countBy(operations, 'kind'),
    byAction: countBy(operations, 'action'),
  }
}

function countBy(items, field) {
  const counts = {}

  for (const item of items) {
    counts[item[field]] = (counts[item[field]] ?? 0) + 1
  }

  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  )
}

function check(id, passed, detail) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    detail,
  }
}

function summarizePreflight(preflightReport) {
  if (!preflightReport) {
    return null
  }

  return {
    status: stringValue(preflightReport.status),
    blockingReason: stringValue(preflightReport.blockingReason),
    workspaceSlug: stringValue(preflightReport.workspace?.urlKey),
    seedFingerprint: summarizeFingerprint(preflightReport.seedFingerprint),
    team: {
      id: stringValue(preflightReport.team?.id),
      key: stringValue(preflightReport.team?.key),
      name: stringValue(preflightReport.team?.name),
    },
  }
}

function summarizeSeed(seed) {
  const labels = arrayValue(seed.labels)
  const projects = arrayValue(seed.projects)
  const milestones = arrayValue(seed.milestones)
  const issues = arrayValue(seed.issues)
  const views = arrayValue(seed.views)
  const documents = arrayValue(seed.documents)

  return {
    workspaceSlug: stringValue(seed.workspaceSlug),
    team: {
      key: stringValue(seed.team?.key),
      name: stringValue(seed.team?.name),
    },
    seedFingerprint: fingerprintJson(seed),
    counts: {
      labels: labels.length,
      projects: projects.length,
      milestones: milestones.length,
      issues: issues.length,
      views: views.length,
      documents: documents.length,
      pulse: seed.pulse ? 1 : 0,
    },
  }
}

function collectInventoryMismatches(seed, preflightReport) {
  const inventory = preflightReport.inventory ?? {}
  const expected = {
    labels: arrayValue(seed.labels).map((label) => label.name),
    projects: arrayValue(seed.projects).map((project) => project.name),
    initiative: [seed.initiative?.name].filter(Boolean),
    documents: arrayValue(seed.documents).map((document) => document.title),
    views: arrayValue(seed.views)
      .filter((view) => view.scope !== 'project' && view.scope !== 'initiative')
      .map((view) => view.name),
  }

  return Object.entries(expected)
    .filter(
      ([kind, expectedNames]) =>
        !sameStringSet(inventory[kind]?.expectedNames, expectedNames),
    )
    .map(([kind]) => kind)
}

function collectIncompleteInventory(preflightReport) {
  const inventory = preflightReport.inventory ?? {}

  return ['labels', 'projects', 'initiative', 'documents', 'views'].filter(
    (kind) => inventory[kind]?.complete !== true,
  )
}

function sameStringSet(actual, expected) {
  if (!Array.isArray(actual)) {
    return false
  }

  const normalizedActual = actual.filter(Boolean).sort()
  const normalizedExpected = expected.filter(Boolean).sort()

  return (
    normalizedActual.length === normalizedExpected.length &&
    normalizedActual.every(
      (value, index) => value === normalizedExpected[index],
    )
  )
}

function preflightSeedMatches(preflightReport, seedFingerprint) {
  return (
    preflightReport.seedFingerprint?.algorithm === seedFingerprint.algorithm &&
    preflightReport.seedFingerprint?.value === seedFingerprint.value
  )
}

function summarizeFingerprint(fingerprint) {
  if (
    fingerprint?.algorithm !== 'sha256' ||
    typeof fingerprint.value !== 'string'
  ) {
    return null
  }

  return {
    algorithm: 'sha256',
    value: fingerprint.value,
  }
}

function fingerprintJson(value) {
  return {
    algorithm: 'sha256',
    value: createHash('sha256').update(stableJson(value)).digest('hex'),
  }
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`
  }

  return JSON.stringify(value)
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined),
  )
}

function arrayValue(value) {
  return Array.isArray(value) ? value : []
}

function stringValue(value) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

main().catch((error) => {
  logError(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { error as logError, log } from 'node:console'
import process from 'node:process'

const supportedKindToIntent = {
  label: 'ensure_label',
  initiative: 'ensure_initiative',
  project: 'ensure_project',
  milestone: 'ensure_milestone',
  issue: 'ensure_issue',
  document: 'ensure_document',
  view: 'ensure_view',
  pulse: 'ensure_pulse_setting',
  project_update: 'ensure_project_update',
}

const supportedKinds = new Set(Object.keys(supportedKindToIntent))

const supportedMutationActions = new Set(['create', 'create_or_update'])

async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv)
  const mutationPacket = await readJsonFile(options.mutationPacketPath)
  const report = buildRequestPlan(mutationPacket)

  log(JSON.stringify(report, null, 2))

  if (options.strict && report.status !== 'ready') {
    logError(
      `linear request plan is not ready: ${report.blockingReason ?? 'mutation packet is not ready'}`,
    )
    process.exitCode = 1
  }
}

function parseOptions(argv) {
  const options = {
    mutationPacketPath: null,
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

    if (arg === '--mutation-packet') {
      const mutationPacketPath = argv[index + 1]
      if (!mutationPacketPath) {
        throw new Error('--mutation-packet requires a path')
      }

      options.mutationPacketPath = mutationPacketPath
      index += 1
      continue
    }

    throw new Error(`Unknown option: ${arg}`)
  }

  if (!options.mutationPacketPath) {
    throw new Error('--mutation-packet is required')
  }

  return options
}

async function readJsonFile(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function buildRequestPlan(mutationPacket) {
  const generatedAt = new Date().toISOString()
  const normalizedPacket = normalizeMutationPacket(mutationPacket)

  const unsupportedMutationSteps = collectUnsupportedMutationSteps(
    normalizedPacket.mutationSteps,
  )
  const malformedMutationSteps = collectMalformedMutationSteps(
    normalizedPacket.mutationSteps,
  )

  const readiness = evaluatePacketReadiness(
    normalizedPacket,
    unsupportedMutationSteps,
    malformedMutationSteps,
  )

  const requestSteps = []
  const confirmations = []
  const manualConfirmations = []

  if (readiness.ready) {
    for (const step of normalizedPacket.mutationSteps) {
      requestSteps.push(buildRequestStep(step))
    }

    for (const confirmation of normalizedPacket.confirmations) {
      confirmations.push(pickStep(confirmation))
    }

    for (const manualConfirmation of normalizedPacket.manualConfirmations) {
      manualConfirmations.push(pickStep(manualConfirmation))
    }
  }

  return {
    schemaVersion: 1,
    generatedAt,
    mode: 'request_plan',
    status: readiness.ready ? 'ready' : 'blocked',
    blockingReason: readiness.ready ? null : readiness.reason,
    summary: summarizeSteps([
      ...normalizedPacket.mutationSteps,
      ...normalizedPacket.confirmations,
      ...normalizedPacket.manualConfirmations,
    ]),
    requestSteps,
    confirmations,
    manualConfirmations,
    unsupportedMutationSteps,
    malformedMutationSteps,
    limitations: [
      'This request plan is local-only and does not read credentials, fetch, or perform network calls.',
      'No mutations are executed and no external Linear identifiers are modified.',
      'The output uses local intent names for the later writer contract.',
    ],
  }
}

function evaluatePacketReadiness(
  normalizedPacket,
  unsupportedMutationSteps,
  malformedMutationSteps,
) {
  if (normalizedPacket.schemaVersion !== 1) {
    return {
      ready: false,
      reason: `schemaVersion mismatch: expected 1, got ${
        normalizedPacket.schemaVersion ?? 'missing'
      }`,
    }
  }

  if (normalizedPacket.status !== 'ready') {
    return {
      ready: false,
      reason: `status mismatch: expected "ready", got ${
        normalizedPacket.status === null
          ? 'missing'
          : `"${normalizedPacket.status}"`
      }`,
    }
  }

  if (!normalizedPacket.hasMutationStepsArray) {
    return { ready: false, reason: 'mutationSteps array missing' }
  }

  if (unsupportedMutationSteps.length > 0) {
    const unsupportedList = unsupportedMutationSteps
      .map(
        (step) =>
          `${step.id ?? 'missing-id'}:${step.kind ?? 'missing-kind'}:${step.action ?? 'missing-action'}`,
      )
      .join(', ')

    return {
      ready: false,
      reason: `unsupported mutation steps: ${unsupportedList}`,
    }
  }

  if (malformedMutationSteps.length > 0) {
    const malformedList = malformedMutationSteps
      .map(
        (step) =>
          `${step.id ?? 'missing-id'}:${step.kind ?? 'missing-kind'}:${step.malformedReasons.join('+')}`,
      )
      .join(', ')

    return {
      ready: false,
      reason: `malformed mutation steps: ${malformedList}`,
    }
  }

  return { ready: true, reason: null }
}

function collectUnsupportedMutationSteps(mutationSteps) {
  return mutationSteps.filter(
    (step) =>
      !supportedKinds.has(step.kind) ||
      !supportedMutationActions.has(step.action),
  )
}

function collectMalformedMutationSteps(mutationSteps) {
  return mutationSteps
    .filter(
      (step) =>
        supportedKinds.has(step.kind) &&
        supportedMutationActions.has(step.action) &&
        malformedMutationStepReasons(step).length > 0,
    )
    .map((step) => ({
      ...pickStep(step),
      malformedReasons: malformedMutationStepReasons(step),
    }))
}

function malformedMutationStepReasons(step) {
  return [
    step.id ? null : 'missing-id',
    step.kind ? null : 'missing-kind',
    step.action ? null : 'missing-action',
    step.hasDependenciesArray ? null : 'missing-dependencies',
    step.hasFieldsObject ? null : 'missing-fields',
  ].filter(Boolean)
}

function buildRequestStep(step) {
  return {
    ...pickStep(step),
    intent: intentForKind(step.kind),
    requires: resolveRequires(step.kind, step.dependencies, step.fields),
  }
}

function pickStep(step) {
  return {
    id: step.id,
    seedKey: step.seedKey,
    kind: step.kind,
    name: step.name,
    title: step.title,
    action: step.action,
    dependencies: step.dependencies,
    fields: step.fields,
  }
}

function intentForKind(kind) {
  return supportedKindToIntent[kind]
}

function resolveRequires(kind, dependencies, fields) {
  const normalizedDependencies = dependencies ?? []
  const requires = []
  const hasDependency = (target) =>
    normalizedDependencies.some((dependency) =>
      dependency.startsWith(`linear:${target}:`),
    )

  const push = (value) => {
    if (!requires.includes(value)) {
      requires.push(value)
    }
  }

  const hasLabels = Object.prototype.hasOwnProperty.call(fields, 'labels')
  const hasBlockedBy = Object.prototype.hasOwnProperty.call(fields, 'blockedBy')
  const filters = objectValue(fields.filters) ?? {}

  if (kind === 'label') {
    push('teamId')
  }

  if (kind === 'initiative') {
    push('workspaceId')
  }

  if (kind === 'project') {
    push('teamId')
    if (hasDependency('initiative')) {
      push('initiativeId')
    }
    if (hasDependency('label') || (hasLabels && Array.isArray(fields.labels))) {
      push('labelIds')
    }
  }

  if (kind === 'milestone') {
    push('projectId')
  }

  if (kind === 'issue') {
    push('teamId')
    push('projectId')

    if (
      hasDependency('milestone') ||
      Object.prototype.hasOwnProperty.call(fields, 'milestone')
    ) {
      push('milestoneId')
    }

    if (Object.prototype.hasOwnProperty.call(fields, 'stateType')) {
      push('stateId')
    }

    if (hasLabels && Array.isArray(fields.labels)) {
      push('labelIds')
    }

    if (
      hasDependency('issue') ||
      (hasBlockedBy && Array.isArray(fields.blockedBy))
    ) {
      push('blockedByIssueIds')
    }
  }

  if (kind === 'document') {
    push('projectId')
  }

  if (kind === 'view') {
    const scope = stringValue(fields.scope)
    if (scope === 'team') {
      push('teamId')
    }

    if (scope === 'project') {
      push('projectId')
    }

    if (scope === 'initiative') {
      push('initiativeId')
    }

    if (hasDependency('initiative')) {
      push('initiativeId')
    }

    if (hasDependency('project') || Array.isArray(filters.project)) {
      push('projectId')
    }

    if (
      hasDependency('label') ||
      Array.isArray(filters.label) ||
      Array.isArray(filters.labelAny)
    ) {
      push('labelIds')
    }

    if (Array.isArray(filters.statusType) || Array.isArray(filters.status)) {
      push('stateIds')
    }
  }

  if (kind === 'pulse') {
    push('workspaceId')
  }

  if (kind === 'project_update') {
    push('projectId')
  }

  return requires
}

function summarizeSteps(steps) {
  const summary = {
    total: steps.length,
    byAction: Object.create(null),
    byKind: Object.create(null),
  }

  for (const step of steps) {
    const action = step.action ?? 'unknown'
    const kind = step.kind ?? 'unknown'
    summary.byAction[action] = (summary.byAction[action] ?? 0) + 1
    summary.byKind[kind] = (summary.byKind[kind] ?? 0) + 1
  }

  return summary
}

function normalizeMutationPacket(packet) {
  const hasMutationStepsArray = Array.isArray(packet?.mutationSteps)
  const hasMutationSteps = hasMutationStepsArray ? packet.mutationSteps : []

  return {
    schemaVersion: numberValue(packet?.schemaVersion),
    status: stringValue(packet?.status),
    hasMutationStepsArray,
    mutationSteps: hasMutationSteps.map(normalizeStep),
    confirmations: Array.isArray(packet?.confirmations)
      ? packet.confirmations.map(normalizeStep)
      : [],
    manualConfirmations: Array.isArray(packet?.manualConfirmations)
      ? packet.manualConfirmations.map(normalizeStep)
      : [],
  }
}

function normalizeStep(step) {
  const fields = objectValue(step?.fields) ?? {}

  return {
    id: stringValue(step?.id),
    seedKey: stringValue(step?.seedKey),
    kind: stringValue(step?.kind),
    name: typeof step?.name === 'string' ? step.name : null,
    title: typeof step?.title === 'string' ? step.title : null,
    action: stringValue(step?.action),
    hasDependenciesArray: Array.isArray(step?.dependencies),
    hasFieldsObject: objectValue(step?.fields) !== null,
    dependencies: Array.isArray(step?.dependencies)
      ? step.dependencies.filter(
          (dependency) => stringValue(dependency) !== null,
        )
      : [],
    fields,
  }
}

function stringValue(value) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function numberValue(value) {
  return typeof value === 'number' ? value : null
}

function objectValue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value
}

main().catch((error) => {
  logError(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

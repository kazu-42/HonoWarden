#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { error as logError, log } from 'node:console'
import process from 'node:process'

const supportedActions = new Set([
  'create',
  'create_or_update',
  'confirm_existing',
  'manual_confirm',
])

async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv)
  const applyPlan = await readJsonFile(options.applyPlanPath)
  const packet = buildMutationPacket(applyPlan)

  log(JSON.stringify(packet, null, 2))

  if (options.strict && packet.status !== 'ready') {
    logError(
      `linear mutation packet is not ready: ${packet.blockingReason ?? 'apply plan is not ready'}`,
    )
    process.exitCode = 1
  }
}

function parseOptions(argv) {
  const options = {
    applyPlanPath: null,
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

    if (arg === '--apply-plan') {
      const applyPlanPath = argv[index + 1]
      if (!applyPlanPath) {
        throw new Error('--apply-plan requires a path')
      }

      options.applyPlanPath = applyPlanPath
      index += 1
      continue
    }

    throw new Error(`Unknown option: ${arg}`)
  }

  if (!options.applyPlanPath) {
    throw new Error('--apply-plan is required')
  }

  return options
}

async function readJsonFile(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function buildMutationPacket(applyPlan) {
  const generatedAt = new Date().toISOString()
  const normalizedPlan = normalizeApplyPlan(applyPlan)
  const operations = normalizedPlan.operations
  const inspectOperationShape =
    normalizedPlan.status === 'ready' && normalizedPlan.hasOperationsArray
  const unsupportedOperations = inspectOperationShape
    ? collectUnsupportedOperations(operations)
    : []
  const malformedOperations = inspectOperationShape
    ? collectMalformedOperations(operations)
    : []
  const statusAndReason = evaluatePlanReadiness(
    normalizedPlan,
    unsupportedOperations,
    malformedOperations,
  )
  const mutationSteps = []
  const confirmations = []
  const manualConfirmations = []

  if (statusAndReason.ready) {
    for (const operation of operations) {
      if (
        operation.action === 'create' ||
        operation.action === 'create_or_update'
      ) {
        mutationSteps.push(pickOperation(operation))
        continue
      }

      if (operation.action === 'confirm_existing') {
        confirmations.push(pickOperation(operation))
        continue
      }

      if (operation.action === 'manual_confirm') {
        manualConfirmations.push(pickOperation(operation))
      }
    }
  }

  return {
    schemaVersion: 1,
    generatedAt,
    status: statusAndReason.ready ? 'ready' : 'blocked',
    blockingReason: statusAndReason.ready ? null : statusAndReason.reason,
    summary: summarizeOperations(operations),
    unsupportedOperations,
    malformedOperations,
    mutationSteps,
    confirmations,
    manualConfirmations,
    limitations: [
      'This packet is local-only, does not read credentials, and does not call network APIs.',
      'Blocked packets intentionally omit mutation steps and confirmations.',
      'Linear IDs and lookup resolution are still required before any writes are executed.',
      'Live Linear writes still require a separate guarded executor with explicit credentials and runtime approval.',
    ],
  }
}

function evaluatePlanReadiness(
  plan,
  unsupportedOperations,
  malformedOperations,
) {
  if (plan.schemaVersion !== 1) {
    return {
      ready: false,
      reason: `schemaVersion mismatch: expected 1, got ${plan.schemaVersion ?? 'missing'}`,
    }
  }

  if (plan.mode !== 'plan') {
    return {
      ready: false,
      reason: `mode mismatch: expected "plan", got ${plan.mode === null ? 'missing' : `"${plan.mode}"`}`,
    }
  }

  if (plan.status !== 'ready') {
    return {
      ready: false,
      reason: `status mismatch: expected "ready", got ${plan.status === null ? 'missing' : `"${plan.status}"`}`,
    }
  }

  if (!plan.hasOperationsArray) {
    return {
      ready: false,
      reason: 'operations array missing',
    }
  }

  if (unsupportedOperations.length > 0) {
    return {
      ready: false,
      reason: `unsupported operation actions: ${unsupportedOperations
        .map(
          (operation) =>
            `${operation.id ?? 'missing-id'}:${operation.action ?? 'missing-action'}`,
        )
        .join(', ')}`,
    }
  }

  if (malformedOperations.length > 0) {
    return {
      ready: false,
      reason: `malformed operations: ${malformedOperations
        .map(
          (operation) =>
            `${operation.id ?? 'missing-id'}:${operation.kind ?? 'missing-kind'}:${operation.malformedReasons.join('+')}`,
        )
        .join(', ')}`,
    }
  }

  return { ready: true, reason: null }
}

function collectUnsupportedOperations(operations) {
  return operations
    .filter((operation) => !supportedActions.has(operation.action))
    .map(pickOperation)
}

function collectMalformedOperations(operations) {
  return operations
    .filter(
      (operation) =>
        supportedActions.has(operation.action) &&
        malformedOperationReasons(operation).length > 0,
    )
    .map((operation) => ({
      ...pickOperation(operation),
      malformedReasons: malformedOperationReasons(operation),
    }))
}

function malformedOperationReasons(operation) {
  return [
    operation.id ? null : 'missing-id',
    operation.kind ? null : 'missing-kind',
    operation.hasDependenciesArray ? null : 'missing-dependencies',
    operation.hasFieldsObject ? null : 'missing-fields',
    ...payloadValidationReasons(operation),
  ].filter(Boolean)
}

function payloadValidationReasons(operation) {
  if (!supportedActions.has(operation.action)) {
    return []
  }

  const fields = operation.fields ?? {}

  switch (operation.kind) {
    case 'label':
      return [
        stringValue(operation.name) ? null : 'missing-name',
        stringValue(fields.color) ? null : 'missing-fields.color',
        stringValue(fields.description) ? null : 'missing-fields.description',
      ]
    case 'initiative':
      return [
        stringValue(operation.name) ? null : 'missing-name',
        stringValue(operation.seedKey) ? null : 'missing-seedKey',
        stringValue(fields.summary) ? null : 'missing-fields.summary',
        stringValue(fields.targetDate) ? null : 'missing-fields.targetDate',
        numberValue(fields.priority) === null
          ? 'missing-fields.priority'
          : null,
      ]
    case 'project':
      return [
        stringValue(operation.name) ? null : 'missing-name',
        stringValue(operation.seedKey) ? null : 'missing-seedKey',
        stringValue(fields.summary) ? null : 'missing-fields.summary',
        stringValue(fields.description) ? null : 'missing-fields.description',
        stringValue(fields.startDate) ? null : 'missing-fields.startDate',
        stringValue(fields.targetDate) ? null : 'missing-fields.targetDate',
        numberValue(fields.priority) === null
          ? 'missing-fields.priority'
          : null,
      ]
    case 'milestone':
      return [
        stringValue(operation.name) ? null : 'missing-name',
        stringValue(fields.projectKey) ? null : 'missing-fields.projectKey',
        stringValue(fields.targetDate) ? null : 'missing-fields.targetDate',
      ]
    case 'issue':
      return [
        stringValue(operation.title) ? null : 'missing-title',
        stringValue(operation.seedKey) ? null : 'missing-seedKey',
        stringValue(fields.projectKey) ? null : 'missing-fields.projectKey',
        numberValue(fields.priority) === null
          ? 'missing-fields.priority'
          : null,
        numberValue(fields.estimate) === null
          ? 'missing-fields.estimate'
          : null,
        stringValue(fields.stateType) ? null : 'missing-fields.stateType',
        Array.isArray(fields.labels) ? null : 'missing-fields.labels',
        stringValue(fields.description) ? null : 'missing-fields.description',
      ]
    case 'document':
      return [
        stringValue(operation.title) ? null : 'missing-title',
        stringValue(fields.projectKey) ? null : 'missing-fields.projectKey',
        stringValue(fields.content) ? null : 'missing-fields.content',
      ]
    case 'view':
      return [
        stringValue(operation.name) ? null : 'missing-name',
        stringValue(fields.scope) ? null : 'missing-fields.scope',
        stringValue(fields.type) ? null : 'missing-fields.type',
        stringValue(fields.layout) ? null : 'missing-fields.layout',
        objectValue(fields.filters) ? null : 'missing-fields.filters',
      ]
    case 'pulse':
      return [
        stringValue(operation.name) ? null : 'missing-name',
        stringValue(fields.workspaceDefaultCadence) ||
        stringValue(fields.projectUpdateReminder)
          ? null
          : 'missing-fields.pulseSetting',
      ]
    case 'project_update':
      return [
        stringValue(operation.name) ? null : 'missing-name',
        stringValue(fields.projectKey) ? null : 'missing-fields.projectKey',
        stringValue(fields.health) ? null : 'missing-fields.health',
        stringValue(fields.body) ? null : 'missing-fields.body',
      ]
    default:
      return ['unsupported-kind']
  }
}

function summarizeOperations(operations) {
  const summary = {
    total: operations.length,
    byAction: Object.create(null),
    byKind: Object.create(null),
  }

  for (const operation of operations) {
    const action = stringValue(operation.action) ?? 'unknown'
    const kind = stringValue(operation.kind) ?? 'unknown'
    summary.byAction[action] = (summary.byAction[action] ?? 0) + 1
    summary.byKind[kind] = (summary.byKind[kind] ?? 0) + 1
  }

  return summary
}

function normalizeApplyPlan(applyPlan) {
  const hasOperationsArray = Array.isArray(applyPlan?.operations)
  const operations = hasOperationsArray ? applyPlan.operations : []

  return {
    schemaVersion: numberValue(applyPlan?.schemaVersion),
    mode: stringValue(applyPlan?.mode),
    status: stringValue(applyPlan?.status),
    hasOperationsArray,
    operations: operations.map((operation) => ({
      ...operation,
      action: stringValue(operation?.action),
      kind: stringValue(operation?.kind),
      id: stringValue(operation?.id),
      seedKey: stringValue(operation?.seedKey),
      name: typeof operation?.name === 'string' ? operation.name : null,
      title: typeof operation?.title === 'string' ? operation.title : null,
      hasDependenciesArray: Array.isArray(operation?.dependencies),
      hasFieldsObject: objectValue(operation?.fields) !== null,
      dependencies: Array.isArray(operation?.dependencies)
        ? operation.dependencies
        : [],
      fields: objectValue(operation?.fields),
    })),
  }
}

function pickOperation(operation) {
  return {
    id: operation.id,
    seedKey: operation.seedKey,
    kind: operation.kind,
    name: operation.name,
    title: operation.title,
    action: operation.action,
    dependencies: operation.dependencies,
    fields: operation.fields,
  }
}

function stringValue(value) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function objectValue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value
}

function numberValue(value) {
  return typeof value === 'number' ? value : null
}

main().catch((error) => {
  logError(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

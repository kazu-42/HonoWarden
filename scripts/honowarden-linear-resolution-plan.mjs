#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { error as logError, log } from 'node:console'
import process from 'node:process'

const supportedRequirementToField = new Set([
  'workspaceId',
  'teamId',
  'initiativeId',
  'projectId',
  'milestoneId',
  'stateId',
  'stateIds',
  'labelIds',
  'blockedByIssueIds',
])

const workspaceRequirement = 'workspaceId'
const teamRequirement = 'teamId'
const initiativeRequirement = 'initiativeId'
const projectRequirement = 'projectId'
const milestoneRequirement = 'milestoneId'
const stateRequirement = 'stateId'
const stateIdsRequirement = 'stateIds'
const labelIdsRequirement = 'labelIds'
const blockedByIssueIdsRequirement = 'blockedByIssueIds'

async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv)
  const requestPlan = await readJsonFile(options.requestPlanPath)
  const resolutionMap = options.resolutionMapPath
    ? await readJsonFile(options.resolutionMapPath)
    : null
  const report = buildResolutionPlan(requestPlan, resolutionMap)

  log(JSON.stringify(report, null, 2))

  if (options.strict && report.status !== 'ready') {
    logError(
      `linear resolution plan is not ready: ${report.blockingReason ?? 'resolution plan is not ready'}`,
    )
    process.exitCode = 1
  }
}

function parseOptions(argv) {
  const options = {
    requestPlanPath: null,
    resolutionMapPath: null,
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

    if (arg === '--request-plan') {
      const requestPlanPath = argv[index + 1]
      if (!requestPlanPath) {
        throw new Error('--request-plan requires a path')
      }

      options.requestPlanPath = requestPlanPath
      index += 1
      continue
    }

    if (arg === '--resolution-map') {
      const resolutionMapPath = argv[index + 1]
      if (!resolutionMapPath) {
        throw new Error('--resolution-map requires a path')
      }

      options.resolutionMapPath = resolutionMapPath
      index += 1
      continue
    }

    throw new Error(`Unknown option: ${arg}`)
  }

  if (!options.requestPlanPath) {
    throw new Error('--request-plan is required')
  }

  return options
}

async function readJsonFile(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function buildResolutionPlan(requestPlan, resolutionMap) {
  const generatedAt = new Date().toISOString()
  const normalizedRequestPlan = normalizeRequestPlan(requestPlan)
  const inspectRequestSteps =
    normalizedRequestPlan.status === 'ready' &&
    normalizedRequestPlan.hasRequestStepsArray
  const unsupportedRequirements = inspectRequestSteps
    ? collectUnsupportedRequirements(normalizedRequestPlan.requestSteps)
    : []
  const malformedRequestSteps = inspectRequestSteps
    ? collectMalformedRequestSteps(normalizedRequestPlan.requestSteps)
    : []
  const planReadiness = evaluateRequestPlanReadiness(
    normalizedRequestPlan,
    unsupportedRequirements,
    malformedRequestSteps,
  )
  const summary = summarizeSteps(normalizedRequestPlan.requestSteps)

  if (!planReadiness.ready) {
    return buildBaseReport({
      generatedAt,
      status: 'blocked',
      blockingReason: planReadiness.reason,
      summary,
      resolvedRequestSteps: [],
      confirmations: [],
      manualConfirmations: [],
      missingResolutions: [],
      unsupportedRequirements,
      malformedRequestSteps,
    })
  }

  if (resolutionMap === null) {
    return buildBaseReport({
      generatedAt,
      status: 'blocked',
      blockingReason: 'resolution_map_missing',
      summary,
      resolvedRequestSteps: [],
      confirmations: [],
      manualConfirmations: [],
      missingResolutions: [],
      unsupportedRequirements,
      malformedRequestSteps,
    })
  }

  const normalizedResolutionMap = normalizeResolutionMap(resolutionMap)
  const mapReadiness = evaluateResolutionMapReadiness(normalizedResolutionMap)
  if (!mapReadiness.ready) {
    return buildBaseReport({
      generatedAt,
      status: 'blocked',
      blockingReason: mapReadiness.reason,
      summary,
      resolvedRequestSteps: [],
      confirmations: [],
      manualConfirmations: [],
      missingResolutions: [],
      unsupportedRequirements,
      malformedRequestSteps,
    })
  }

  const resolution = resolveRequestSteps(
    normalizedRequestPlan.requestSteps,
    normalizedResolutionMap,
  )

  if (resolution.missingResolutions.length > 0) {
    return buildBaseReport({
      generatedAt,
      status: 'blocked',
      blockingReason: `missing linear resolutions: ${resolution.missingResolutions.length} missing groups`,
      summary,
      resolvedRequestSteps: [],
      confirmations: [],
      manualConfirmations: [],
      missingResolutions: resolution.missingResolutions,
      unsupportedRequirements,
      malformedRequestSteps,
    })
  }

  return {
    schemaVersion: 1,
    generatedAt,
    mode: 'resolution_plan',
    status: 'ready',
    blockingReason: null,
    summary,
    resolvedRequestSteps: resolution.resolvedRequestSteps,
    confirmations: normalizedRequestPlan.confirmations.map((confirmation) =>
      pickRequestStep(confirmation),
    ),
    manualConfirmations: normalizedRequestPlan.manualConfirmations.map(
      (manualConfirmation) => pickRequestStep(manualConfirmation),
    ),
    missingResolutions: [],
    unsupportedRequirements,
    malformedRequestSteps,
    limitations: [
      'This resolution plan is local-only and does not read credentials, fetch, or perform network calls.',
      'No mutations are executed and no external Linear identifiers are modified.',
      'This output resolves required IDs for a future guarded writer.',
    ],
  }
}

function buildBaseReport({
  generatedAt,
  status,
  blockingReason,
  summary,
  resolvedRequestSteps,
  confirmations,
  manualConfirmations,
  missingResolutions,
  unsupportedRequirements = [],
  malformedRequestSteps = [],
}) {
  return {
    schemaVersion: 1,
    generatedAt,
    mode: 'resolution_plan',
    status,
    blockingReason,
    summary,
    resolvedRequestSteps,
    confirmations,
    manualConfirmations,
    missingResolutions,
    unsupportedRequirements,
    malformedRequestSteps,
    limitations: [
      'This resolution plan is local-only and does not read credentials, fetch, or perform network calls.',
      'No mutations are executed and no external Linear identifiers are modified.',
      'This output resolves required IDs for a future guarded writer.',
    ],
  }
}

function evaluateRequestPlanReadiness(
  normalizedRequestPlan,
  unsupportedRequirements,
  malformedRequestSteps,
) {
  if (normalizedRequestPlan.schemaVersion !== 1) {
    return {
      ready: false,
      reason: `schemaVersion mismatch: expected 1, got ${
        normalizedRequestPlan.schemaVersion ?? 'missing'
      }`,
    }
  }

  if (normalizedRequestPlan.mode !== 'request_plan') {
    return {
      ready: false,
      reason: `mode mismatch: expected "request_plan", got ${
        normalizedRequestPlan.mode === null
          ? 'missing'
          : `"${normalizedRequestPlan.mode}"`
      }`,
    }
  }

  if (normalizedRequestPlan.status !== 'ready') {
    return {
      ready: false,
      reason: `status mismatch: expected "ready", got ${
        normalizedRequestPlan.status === null
          ? 'missing'
          : `"${normalizedRequestPlan.status}"`
      }`,
    }
  }

  if (!normalizedRequestPlan.hasRequestStepsArray) {
    return { ready: false, reason: 'requestSteps array missing' }
  }

  if (unsupportedRequirements.length > 0) {
    const unsupportedList = unsupportedRequirements
      .map(
        (entry) =>
          `${entry.stepId ?? 'missing-id'}:${entry.requirement ?? 'missing-requirement'}`,
      )
      .join(', ')

    return {
      ready: false,
      reason: `unsupported request requirements: ${unsupportedList}`,
    }
  }

  if (malformedRequestSteps.length > 0) {
    const malformedList = malformedRequestSteps
      .map(
        (step) =>
          `${step.id ?? 'missing-id'}:${step.kind ?? 'missing-kind'}:${step.malformedReasons.join('+')}`,
      )
      .join(', ')

    return {
      ready: false,
      reason: `malformed request steps: ${malformedList}`,
    }
  }

  return { ready: true, reason: null }
}

function collectUnsupportedRequirements(requestSteps) {
  return requestSteps.flatMap((step, index) =>
    step.requires
      .filter((requirement) => !supportedRequirementToField.has(requirement))
      .map((requirement) => ({
        stepId: step.id,
        seedKey: step.seedKey,
        stepIndex: index + 1,
        requirement,
      })),
  )
}

function collectMalformedRequestSteps(requestSteps) {
  return requestSteps
    .filter((step) => malformedRequestStepReasons(step).length > 0)
    .map((step) => ({
      ...pickRequestStep(step),
      malformedReasons: malformedRequestStepReasons(step),
    }))
}

function malformedRequestStepReasons(step) {
  return [
    step.id ? null : 'missing-id',
    step.kind ? null : 'missing-kind',
    step.action ? null : 'missing-action',
    step.intent ? null : 'missing-intent',
    step.hasDependenciesArray ? null : 'missing-dependencies',
    step.hasFieldsObject ? null : 'missing-fields',
    step.hasRequiresArray ? null : 'missing-requires',
  ].filter(Boolean)
}

function evaluateResolutionMapReadiness(normalizedResolutionMap) {
  if (normalizedResolutionMap.schemaVersion !== 1) {
    return {
      ready: false,
      reason: `resolution map schemaVersion mismatch: expected 1, got ${
        normalizedResolutionMap.schemaVersion ?? 'missing'
      }`,
    }
  }

  return { ready: true, reason: null }
}

function normalizeRequestPlan(requestPlan) {
  const hasRequestStepsArray = Array.isArray(requestPlan?.requestSteps)

  return {
    schemaVersion: numberValue(requestPlan?.schemaVersion),
    mode: stringValue(requestPlan?.mode),
    status: stringValue(requestPlan?.status),
    hasRequestStepsArray,
    requestSteps: hasRequestStepsArray
      ? requestPlan.requestSteps.map(normalizeRequestStep)
      : [],
    confirmations: Array.isArray(requestPlan?.confirmations)
      ? requestPlan.confirmations.map(normalizeRequestStep)
      : [],
    manualConfirmations: Array.isArray(requestPlan?.manualConfirmations)
      ? requestPlan.manualConfirmations.map(normalizeRequestStep)
      : [],
  }
}

function normalizeRequestStep(step) {
  return {
    id: stringValue(step?.id),
    seedKey: stringValue(step?.seedKey),
    kind: stringValue(step?.kind),
    name: typeof step?.name === 'string' ? step.name : null,
    title: typeof step?.title === 'string' ? step.title : null,
    action: stringValue(step?.action),
    hasDependenciesArray: Array.isArray(step?.dependencies),
    hasFieldsObject: objectValue(step?.fields) !== null,
    hasRequiresArray: Array.isArray(step?.requires),
    dependencies: Array.isArray(step?.dependencies)
      ? step.dependencies.filter(
          (dependency) => stringValue(dependency) !== null,
        )
      : [],
    fields: objectValue(step?.fields) ?? {},
    intent: stringValue(step?.intent),
    requires: Array.isArray(step?.requires)
      ? step.requires
          .map((requirement) => stringValue(requirement))
          .filter((requirement) => requirement !== null)
      : [],
  }
}

function normalizeResolutionMap(resolutionMap) {
  const refs = objectValue(resolutionMap?.refs)
  const stateIds = objectValue(resolutionMap?.stateIds)

  return {
    schemaVersion: numberValue(resolutionMap?.schemaVersion),
    workspaceId: stringValue(resolutionMap?.workspaceId),
    teamId: stringValue(resolutionMap?.teamId),
    refs: refs ?? {},
    stateIds: stateIds ?? {},
  }
}

function resolveRequestSteps(requestSteps, resolutionMap) {
  const resolvedRequestSteps = []
  const missingResolutions = []

  for (const [index, step] of requestSteps.entries()) {
    const stepResolution = {
      workspaceId: null,
      teamId: null,
      initiativeId: null,
      projectId: null,
      projectIds: null,
      milestoneId: null,
      stateId: null,
      stateIds: null,
      labelIds: null,
      blockedByIssueIds: null,
    }
    const stepMissingResolutions = []

    const pushMissing = (requirement, reference) => {
      const next = {
        stepId: step.id,
        seedKey: step.seedKey,
        stepIndex: index + 1,
        requirement,
        reference,
      }

      stepMissingResolutions.push(next)
    }

    for (const requirement of step.requires) {
      const result = resolveStepRequirement(
        step,
        requirement,
        resolutionMap,
        pushMissing,
      )

      switch (requirement) {
        case workspaceRequirement:
          stepResolution.workspaceId = result.value
          break
        case teamRequirement:
          stepResolution.teamId = result.value
          break
        case initiativeRequirement:
          stepResolution.initiativeId = result.value
          break
        case projectRequirement:
          stepResolution.projectId = result.value
          stepResolution.projectIds = result.values
          break
        case milestoneRequirement:
          stepResolution.milestoneId = result.value
          break
        case stateRequirement:
          stepResolution.stateId = result.value
          break
        case stateIdsRequirement:
          stepResolution.stateIds = result.values
          break
        case labelIdsRequirement:
          stepResolution.labelIds = result.values
          break
        case blockedByIssueIdsRequirement:
          stepResolution.blockedByIssueIds = result.values
          break
        default:
          break
      }
    }

    if (stepMissingResolutions.length > 0) {
      missingResolutions.push(...stepMissingResolutions)
      continue
    }

    resolvedRequestSteps.push({
      ...pickRequestStep(step),
      ...stepResolution,
    })
  }

  return {
    resolvedRequestSteps: resolvedRequestSteps.map((step) => ({
      ...step,
      projectIds: step.projectIds ?? [],
      stateIds: step.stateIds ?? [],
      labelIds: step.labelIds ?? [],
      blockedByIssueIds: step.blockedByIssueIds ?? [],
    })),
    missingResolutions,
  }
}

function resolveStepRequirement(step, requirement, resolutionMap, pushMissing) {
  if (requirement === workspaceRequirement) {
    if (!resolutionMap.workspaceId) {
      pushMissing(requirement, workspaceRequirement)
      return { value: null, values: null }
    }

    return { value: resolutionMap.workspaceId, values: null }
  }

  if (requirement === teamRequirement) {
    if (!resolutionMap.teamId) {
      pushMissing(requirement, teamRequirement)
      return { value: null, values: null }
    }

    return { value: resolutionMap.teamId, values: null }
  }

  if (requirement === initiativeRequirement) {
    const candidates = resolveCandidatesFromDependencies(step, 'initiative')
    const resolution = resolveSingleFromRefs(
      'initiativeId',
      candidates,
      resolutionMap,
    )
    if (!resolution) {
      pushMissingCandidateRefs(
        requirement,
        candidates,
        pushMissing,
        `${initiativeRequirement}:dependency-or-field`,
      )
      return { value: null, values: null }
    }

    return { value: resolution, values: null }
  }

  if (requirement === projectRequirement) {
    const candidateGroups = resolveProjectCandidateGroups(step)
    const resolution = resolveAllFromRefGroups(
      requirement,
      candidateGroups,
      resolutionMap,
      pushMissing,
      `${projectRequirement}:dependency-or-field`,
    )
    if (resolution.missing) {
      return { value: null, values: null }
    }

    return { value: resolution.values[0] ?? null, values: resolution.values }
  }

  if (requirement === milestoneRequirement) {
    const candidates = resolveMilestoneCandidates(step)
    const resolution = resolveSingleFromRefs(
      'milestoneId',
      candidates,
      resolutionMap,
    )
    if (!resolution) {
      pushMissingCandidateRefs(
        requirement,
        candidates,
        pushMissing,
        `${milestoneRequirement}:dependency-or-fields`,
      )
      return { value: null, values: null }
    }

    return { value: resolution, values: null }
  }

  if (requirement === stateRequirement) {
    const stateType = stringValue(step.fields.stateType)
    if (!stateType) {
      pushMissing(requirement, 'stateType')
      return { value: null, values: null }
    }

    const stateId = stringValue(resolutionMap.stateIds[stateType])
    if (!stateId) {
      pushMissing(requirement, stateType)
      return { value: null, values: null }
    }

    return { value: stateId, values: null }
  }

  if (requirement === stateIdsRequirement) {
    const statuses = [
      ...(asStringArray(step.fields?.filters?.statusType) ?? []),
      ...(asStringArray(step.fields?.filters?.status) ?? []),
    ]

    const values = []
    const missingValues = []

    for (const status of statuses) {
      const stateId = stringValue(resolutionMap.stateIds[status])
      if (stateId) {
        values.push(stateId)
        continue
      }

      missingValues.push(status)
      pushMissing(requirement, `${stateIdsRequirement}:${status}`)
    }

    if (missingValues.length > 0) {
      return { value: null, values: null }
    }

    return { value: null, values }
  }

  if (requirement === labelIdsRequirement) {
    const labelRefs = [
      ...resolveDependencyRefs(step.dependencies, 'label'),
      ...asStringArray(step.fields?.labels).map((label) =>
        keyFromTypeAndName('label', label),
      ),
      ...asStringArray(step.fields?.filters?.label).map((label) =>
        keyFromTypeAndName('label', label),
      ),
      ...asStringArray(step.fields?.filters?.labelAny).map((label) =>
        keyFromTypeAndName('label', label),
      ),
    ]

    const values = []
    const missingValues = []
    const seen = new Set()

    for (const labelRef of labelRefs) {
      const labelId = stringValue(resolutionMap.refs[labelRef])
      if (!labelId || seen.has(labelId)) {
        if (!labelId) {
          missingValues.push(labelRef)
          pushMissing(requirement, labelRef)
        }
        continue
      }

      seen.add(labelId)
      values.push(labelId)
    }

    if (missingValues.length > 0) {
      return { value: null, values: null }
    }

    return { value: null, values }
  }

  if (requirement === blockedByIssueIdsRequirement) {
    const issueRefs = [
      ...resolveDependencyRefs(step.dependencies, 'issue'),
      ...asStringArray(step.fields?.blockedBy).map((issue) =>
        keyFromTypeAndName('issue', issue),
      ),
    ]

    const values = []
    const missingValues = []
    const seen = new Set()

    for (const issueRef of issueRefs) {
      const issueId = stringValue(resolutionMap.refs[issueRef])
      if (!issueId || seen.has(issueId)) {
        if (!issueId) {
          missingValues.push(issueRef)
          pushMissing(requirement, issueRef)
        }
        continue
      }

      seen.add(issueId)
      values.push(issueId)
    }

    if (missingValues.length > 0) {
      return { value: null, values: null }
    }

    return { value: null, values }
  }

  return { value: null, values: null }
}

function resolveDependencyRefs(dependencies, target) {
  const prefixes = {
    initiative: 'linear:initiative:',
    label: 'linear:label:',
    issue: 'linear:issue:',
    project: 'linear:project:',
    milestone: 'linear:milestone:',
  }

  return dependencies.filter(
    (dependency) =>
      typeof dependency === 'string' && dependency.startsWith(prefixes[target]),
  )
}

function resolveCandidatesFromDependencies(step, target) {
  return resolveDependencyRefs(step.dependencies, target)
}

function keyFromTypeAndName(type, name) {
  return `linear:${type}:${name}`
}

function resolveSingleFromRefs(requirement, candidates, resolutionMap) {
  for (const candidate of candidates) {
    const value = stringValue(resolutionMap.refs[candidate])
    if (value) {
      return value
    }
  }

  return null
}

function resolveProjectCandidateGroups(step) {
  const groups = []
  const seen = new Set()
  const pushProjectGroup = (candidate) => {
    const aliases = projectAliases(candidate)
    const key = aliases.join('\u0000')
    if (seen.has(key)) {
      return
    }

    seen.add(key)
    groups.push(aliases)
  }

  for (const dependency of resolveDependencyRefs(
    step.dependencies,
    'project',
  )) {
    pushProjectGroup(dependency)
  }

  for (const project of asStringArray(step.fields?.projectKey)) {
    pushProjectGroup(keyFromTypeAndName('project', project))
  }

  for (const project of asStringArray(step.fields?.project)) {
    pushProjectGroup(keyFromTypeAndName('project', project))
  }

  for (const project of asStringArray(step.fields?.projectName)) {
    pushProjectGroup(keyFromTypeAndName('project-name', project))
  }

  for (const project of asStringArray(step.fields?.filters?.project)) {
    pushProjectGroup(keyFromTypeAndName('project-name', project))
  }

  return groups
}

function projectAliases(candidate) {
  if (candidate.startsWith('linear:project:')) {
    const value = candidate.slice('linear:project:'.length)
    return [candidate, `linear:project-name:${value}`]
  }

  if (candidate.startsWith('linear:project-name:')) {
    const value = candidate.slice('linear:project-name:'.length)
    return [candidate, `linear:project:${value}`]
  }

  return [candidate]
}

function resolveAllFromRefGroups(
  requirement,
  candidateGroups,
  resolutionMap,
  pushMissing,
  fallbackReference,
) {
  if (candidateGroups.length === 0) {
    pushMissing(requirement, fallbackReference)
    return { missing: true, values: [] }
  }

  const values = []
  const seenValues = new Set()
  let missing = false

  for (const candidateGroup of candidateGroups) {
    const value = candidateGroup
      .map((candidate) => stringValue(resolutionMap.refs[candidate]))
      .find((candidateValue) => candidateValue !== null)

    if (!value) {
      missing = true
      pushMissing(requirement, candidateGroup[0] ?? fallbackReference)
      continue
    }

    if (!seenValues.has(value)) {
      seenValues.add(value)
      values.push(value)
    }
  }

  return { missing, values }
}

function pushMissingCandidateRefs(
  requirement,
  candidates,
  pushMissing,
  fallbackReference,
) {
  const seen = new Set()
  const uniqueCandidates = candidates.filter((candidate) => {
    if (seen.has(candidate)) {
      return false
    }

    seen.add(candidate)
    return true
  })

  if (uniqueCandidates.length === 0) {
    pushMissing(requirement, fallbackReference)
    return
  }

  for (const candidate of uniqueCandidates) {
    pushMissing(requirement, candidate)
  }
}

function resolveMilestoneCandidates(step) {
  const milestoneName = stringValue(step.fields.milestone)
  const candidates = [...resolveDependencyRefs(step.dependencies, 'milestone')]

  const fromDependencies = resolveDependencyRefs(step.dependencies, 'project')

  if (milestoneName) {
    candidates.push(keyFromTypeAndName('milestone', milestoneName))
    for (const projectName of asStringArray(step.fields?.projectKey)) {
      candidates.push(`linear:milestone:${projectName}:${milestoneName}`)
    }

    for (const projectName of fromDependencies) {
      candidates.push(
        `linear:milestone:${projectName.slice('linear:project:'.length)}:${milestoneName}`,
      )
    }
  }

  return candidates
}

function summarizeSteps(requestSteps) {
  const summary = {
    total: requestSteps.length,
    byAction: Object.create(null),
    byKind: Object.create(null),
  }

  for (const step of requestSteps) {
    const action = step.action ?? 'unknown'
    const kind = step.kind ?? 'unknown'
    summary.byAction[action] = (summary.byAction[action] ?? 0) + 1
    summary.byKind[kind] = (summary.byKind[kind] ?? 0) + 1
  }

  return summary
}

function pickRequestStep(step) {
  return {
    id: step.id,
    seedKey: step.seedKey,
    kind: step.kind,
    name: step.name,
    title: step.title,
    action: step.action,
    dependencies: step.dependencies,
    fields: step.fields,
    intent: step.intent,
    requires: step.requires,
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

function asStringArray(value) {
  if (!value) {
    return []
  }

  if (Array.isArray(value)) {
    return value.filter((entry) => stringValue(entry) !== null)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? [trimmed] : []
  }

  return []
}

main().catch((error) => {
  logError(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

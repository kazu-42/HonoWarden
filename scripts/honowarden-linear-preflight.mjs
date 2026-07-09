#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { error as logError, log } from 'node:console'
import { createHash } from 'node:crypto'
import process from 'node:process'
import { URL } from 'node:url'

const defaultSeedPath = 'ops/linear/honowarden.seed.json'
const defaultEndpoint = 'https://api.linear.app/graphql'

const linearPreflightQueries = [
  {
    name: 'identity',
    query: `
query HonoWardenLinearPreflightIdentity {
  organization {
    id
    name
    urlKey
  }
  viewer {
    id
    name
    organization {
      id
      name
      urlKey
    }
  }
}
`,
  },
  {
    name: 'teams',
    query: `
query HonoWardenLinearPreflightTeams {
  teams(first: 250) {
    pageInfo {
      hasNextPage
    }
    nodes {
      id
      name
      key
    }
  }
}
`,
  },
  {
    name: 'workflowStates',
    connection: 'workflowStates',
    paginated: true,
    query: `
query HonoWardenLinearPreflightWorkflowStates($after: String) {
  workflowStates(first: 250, after: $after) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      id
      name
      type
      team {
        key
        name
      }
    }
  }
}
`,
  },
  {
    name: 'projects',
    query: `
query HonoWardenLinearPreflightProjects {
  projects(first: 50) {
    pageInfo {
      hasNextPage
    }
    nodes {
      id
      name
    }
  }
}
`,
  },
  {
    name: 'initiatives',
    query: `
query HonoWardenLinearPreflightInitiatives {
  initiatives(first: 50) {
    pageInfo {
      hasNextPage
    }
    nodes {
      id
      name
    }
  }
}
`,
  },
  {
    name: 'issueLabels',
    query: `
query HonoWardenLinearPreflightIssueLabels {
  issueLabels(first: 250) {
    pageInfo {
      hasNextPage
    }
    nodes {
      id
      name
      team {
        key
      }
    }
  }
}
`,
  },
  {
    name: 'documents',
    query: `
query HonoWardenLinearPreflightDocuments {
  documents(first: 250) {
    pageInfo {
      hasNextPage
    }
    nodes {
      id
      title
      team {
        key
      }
      project {
        name
      }
    }
  }
}
`,
  },
  {
    name: 'customViews',
    query: `
query HonoWardenLinearPreflightCustomViews {
  customViews(first: 250) {
    pageInfo {
      hasNextPage
    }
    nodes {
      id
      name
      team {
        key
      }
    }
  }
}
`,
  },
]

async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseOptions(argv)
  const seedPath = options.seedPath ?? defaultSeedPath
  const seed = JSON.parse(await readFile(seedPath, 'utf8'))
  const report = await buildLinearPreflightReport(seed, env, options)

  log(JSON.stringify(report, null, 2))

  if (options.strict && report.status !== 'ready') {
    process.exitCode = 1
  }
}

function parseOptions(argv) {
  const options = {
    strict: false,
    seedPath: null,
    endpoint: null,
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

    if (arg === '--endpoint') {
      const endpoint = argv[index + 1]
      if (!endpoint) {
        throw new Error('--endpoint requires a URL')
      }

      options.endpoint = endpoint
      index += 1
      continue
    }

    throw new Error(`Unknown option: ${arg}`)
  }

  return options
}

async function buildLinearPreflightReport(seed, env, options = {}) {
  const generatedAt = new Date().toISOString()
  const apiKey = stringValue(env.LINEAR_API_KEY)
  const endpoint =
    stringValue(options.endpoint) ??
    stringValue(env.HONOWARDEN_LINEAR_GRAPHQL_ENDPOINT) ??
    defaultEndpoint
  const configuredWorkspaceSlug = stringValue(
    env.HONOWARDEN_LINEAR_WORKSPACE_SLUG,
  )
  const expectedWorkspaceSlug = stringValue(seed.workspaceSlug)
  const expectedLinearUrl =
    expectedWorkspaceSlug !== null
      ? `https://linear.app/${expectedWorkspaceSlug}/`
      : null
  const expectedTeam = {
    key: stringValue(seed.team?.key),
    name: stringValue(seed.team?.name),
  }
  const seedSummary = summarizeSeed(seed)
  const seedFingerprint = fingerprintJson(seed)
  const baseReport = {
    schemaVersion: 1,
    generatedAt,
    status: 'not_ready',
    blockingReason: null,
    endpoint: endpoint === defaultEndpoint ? defaultEndpoint : 'custom',
    expected: {
      workspaceSlug: expectedWorkspaceSlug,
      linearUrl: expectedLinearUrl,
      team: expectedTeam,
    },
    seed: seedSummary,
    seedFingerprint,
    workspace: null,
    viewer: null,
    team: null,
    inventory: null,
    checks: [],
    limitations: [
      'This preflight is read-only and does not create or update Linear objects.',
      'It verifies the Linear API key workspace before any future seed application.',
      'Pulse defaults and shared view rendering still require manual or UI/API-specific verification.',
    ],
  }

  if (!apiKey) {
    return withStatus(baseReport, 'linear_api_key_missing', [
      check('linear_api_key', false, 'LINEAR_API_KEY missing'),
    ])
  }

  const apiKeyValidation = validateLinearApiKey(apiKey)
  if (!apiKeyValidation.ok) {
    return withStatus(baseReport, 'linear_api_key_invalid', [
      check('linear_api_key', false, apiKeyValidation.detail),
    ])
  }

  const endpointValidation = validateLinearEndpoint(endpoint)
  if (!endpointValidation.ok) {
    return withStatus(baseReport, 'linear_endpoint_not_allowed', [
      check('linear_api_key', true, 'LINEAR_API_KEY configured'),
      check('linear_endpoint', false, endpointValidation.detail),
    ])
  }

  if (expectedWorkspaceSlug === null) {
    return withStatus(baseReport, 'linear_seed_workspace_missing', [
      check('linear_api_key', true, 'LINEAR_API_KEY configured'),
      check('linear_endpoint', true, 'Linear GraphQL endpoint is allowed'),
      check('seed_workspace', false, 'seed workspaceSlug is required'),
    ])
  }

  if (
    configuredWorkspaceSlug !== null &&
    configuredWorkspaceSlug !== expectedWorkspaceSlug
  ) {
    return withStatus(baseReport, 'linear_workspace_env_mismatch', [
      check('linear_api_key', true, 'LINEAR_API_KEY configured'),
      check('linear_endpoint', true, 'Linear GraphQL endpoint is allowed'),
      check(
        'workspace_env',
        false,
        'HONOWARDEN_LINEAR_WORKSPACE_SLUG must match seed workspaceSlug',
      ),
    ])
  }

  if (!expectedTeam.key || !expectedTeam.name) {
    return withStatus(baseReport, 'linear_seed_team_missing', [
      check('linear_api_key', true, 'LINEAR_API_KEY configured'),
      check('linear_endpoint', true, 'Linear GraphQL endpoint is allowed'),
      check('workspace_env', true, 'workspace environment matches seed'),
      check('seed_team', false, 'seed team.key and team.name are required'),
    ])
  }

  const remote = await fetchLinearGraphql(endpoint, apiKey)
  if (!remote.ok) {
    return withStatus(baseReport, remote.reason, [
      check('linear_api_key', true, 'LINEAR_API_KEY configured'),
      check('linear_endpoint', true, 'Linear GraphQL endpoint is allowed'),
      check('workspace_env', true, 'workspace environment matches seed'),
      check('seed_team', true, 'seed team.key and team.name configured'),
      check('linear_graphql_read', false, remote.detail),
    ])
  }

  const data = normalizeLinearPreflightData(remote.data)
  const organization = data.organization ?? data.viewer?.organization ?? null
  const teams = data.teams?.nodes ?? []
  const matchingTeam = findMatchingTeam(teams, expectedTeam)
  const workflowStateTypes = new Set(
    (matchingTeam?.states?.nodes ?? []).map((state) => state.type),
  )
  const missingWorkflowStateTypes =
    seedSummary.requiredWorkflowStateTypes.filter(
      (stateType) => !workflowStateTypes.has(stateType),
    )
  const workspaceMatches = organization?.urlKey === expectedWorkspaceSlug
  const teamFound = Boolean(matchingTeam)
  const stateTypesResolvable =
    teamFound && missingWorkflowStateTypes.length === 0
  const checks = [
    check('linear_api_key', true, 'LINEAR_API_KEY configured'),
    check('linear_endpoint', true, 'Linear GraphQL endpoint is allowed'),
    check('workspace_env', true, 'workspace environment matches seed'),
    check('seed_team', true, 'seed team.key and team.name configured'),
    check('linear_graphql_read', true, 'Linear GraphQL read succeeded'),
    check(
      'workspace_slug',
      workspaceMatches,
      workspaceMatches
        ? `workspace urlKey matched ${expectedWorkspaceSlug}`
        : `expected workspace urlKey ${expectedWorkspaceSlug}`,
    ),
    check(
      'team',
      teamFound,
      teamFound
        ? `team ${expectedTeam.key} / ${expectedTeam.name} found`
        : `team ${expectedTeam.key} / ${expectedTeam.name} missing`,
    ),
    check(
      'workflow_state_types',
      stateTypesResolvable,
      stateTypesResolvable
        ? 'all required seed workflow state types have matching team workflow states'
        : `missing state types: ${missingWorkflowStateTypes.join(', ')}`,
    ),
  ]

  const report = {
    ...baseReport,
    workspace: organization
      ? {
          id: organization.id,
          name: organization.name,
          urlKey: organization.urlKey,
        }
      : null,
    viewer: data.viewer
      ? {
          id: data.viewer.id,
          name: data.viewer.name,
        }
      : null,
    team: matchingTeam
      ? {
          id: matchingTeam.id,
          key: matchingTeam.key,
          name: matchingTeam.name,
          workflowStateTypes: [...workflowStateTypes].sort(),
          missingStateTypes: missingWorkflowStateTypes,
        }
      : {
          id: null,
          key: expectedTeam.key,
          name: expectedTeam.name,
          workflowStateTypes: [],
          missingStateTypes: seedSummary.requiredWorkflowStateTypes,
        },
    inventory: summarizeInventory(seed, data, expectedTeam),
    checks,
  }

  if (!workspaceMatches) {
    return withStatus(report, 'linear_workspace_mismatch', checks)
  }

  if (!teamFound) {
    return withStatus(report, 'linear_team_missing', checks)
  }

  if (!stateTypesResolvable) {
    return withStatus(report, 'linear_workflow_state_missing', checks)
  }

  return {
    ...report,
    status: 'ready',
    blockingReason: null,
  }
}

async function fetchLinearGraphql(endpoint, apiKey) {
  const data = {}

  for (const request of linearPreflightQueries) {
    const response = request.paginated
      ? await fetchLinearGraphqlPages(endpoint, apiKey, request)
      : await fetchLinearGraphqlRequest(endpoint, apiKey, request)
    if (!response.ok) {
      return response
    }

    Object.assign(data, response.data)
  }

  return { ok: true, data }
}

async function fetchLinearGraphqlPages(endpoint, apiKey, request) {
  const nodes = []
  let pageInfo = { hasNextPage: false, endCursor: null }
  let after = null

  for (let page = 0; page < 20; page += 1) {
    const response = await fetchLinearGraphqlRequest(
      endpoint,
      apiKey,
      request,
      {
        after,
      },
    )
    if (!response.ok) {
      return response
    }

    const connection = response.data[request.connection]
    nodes.push(...(connection?.nodes ?? []))
    pageInfo = connection?.pageInfo ?? pageInfo

    if (!pageInfo.hasNextPage) {
      return {
        ok: true,
        data: {
          [request.connection]: {
            ...connection,
            pageInfo,
            nodes,
          },
        },
      }
    }

    after = stringValue(pageInfo.endCursor)
    if (!after) {
      return {
        ok: false,
        reason: 'linear_graphql_pagination_error',
        detail: `Linear GraphQL ${request.name} pageInfo was missing endCursor`,
      }
    }
  }

  return {
    ok: false,
    reason: 'linear_graphql_pagination_error',
    detail: `Linear GraphQL ${request.name} exceeded pagination limit`,
  }
}

async function fetchLinearGraphqlRequest(
  endpoint,
  apiKey,
  request,
  variables = {},
) {
  let response

  try {
    response = await globalThis.fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: apiKey,
      },
      body: JSON.stringify({ query: request.query, variables }),
    })
  } catch (error) {
    return {
      ok: false,
      reason: 'linear_graphql_request_failed',
      detail: `${request.name}: ${
        error instanceof Error ? error.message : 'request failed'
      }`,
    }
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    return {
      ok: false,
      reason: 'linear_graphql_invalid_response',
      detail: `Linear GraphQL ${request.name} returned HTTP ${response.status} with non-JSON body`,
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      reason:
        response.status === 401
          ? 'linear_api_auth_failed'
          : 'linear_graphql_http_error',
      detail: `Linear GraphQL ${request.name} returned HTTP ${response.status}`,
    }
  }

  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    return {
      ok: false,
      reason: 'linear_graphql_errors',
      detail: `Linear GraphQL ${request.name} returned ${payload.errors.length} error(s)`,
    }
  }

  return { ok: true, data: payload.data ?? {} }
}

function normalizeLinearPreflightData(data) {
  const workflowStates = data.workflowStates?.nodes ?? []
  const teams = data.teams?.nodes ?? []
  const normalizedTeams = teams.map((team) => {
    const embeddedStates = team.states?.nodes
    if (Array.isArray(embeddedStates)) {
      return team
    }

    return {
      ...team,
      states: {
        nodes: workflowStates.filter(
          (state) =>
            (!team.key || state.team?.key === team.key) &&
            (!team.name || state.team?.name === team.name),
        ),
      },
    }
  })

  return {
    ...data,
    teams: {
      ...(data.teams ?? {}),
      nodes: normalizedTeams,
    },
  }
}

function validateLinearApiKey(apiKey) {
  for (const character of apiKey) {
    const codePoint = character.charCodeAt(0)

    if (codePoint <= 31 || codePoint === 127) {
      return {
        ok: false,
        detail: 'LINEAR_API_KEY contains unsupported control characters',
      }
    }
  }

  return { ok: true }
}

function validateLinearEndpoint(endpoint) {
  let url

  try {
    url = new URL(endpoint)
  } catch {
    return {
      ok: false,
      detail: 'Linear GraphQL endpoint URL is invalid',
    }
  }

  if (url.href !== new URL(defaultEndpoint).href) {
    return {
      ok: false,
      detail: 'Linear GraphQL endpoint must be https://api.linear.app/graphql',
    }
  }

  return { ok: true }
}

function summarizeSeed(seed) {
  const issues = Array.isArray(seed.issues) ? seed.issues : []
  const views = Array.isArray(seed.views) ? seed.views : []
  const labels = Array.isArray(seed.labels) ? seed.labels : []
  const projects = Array.isArray(seed.projects) ? seed.projects : []
  const milestones = Array.isArray(seed.milestones) ? seed.milestones : []
  const documents = Array.isArray(seed.documents) ? seed.documents : []
  const issueStateTypes = collectUniqueStrings(
    issues.map((issue) => stringValue(issue.stateType)),
  )
  const viewStatusTypes = collectUniqueStrings(
    views.flatMap((view) =>
      Array.isArray(view.filters?.statusType)
        ? view.filters.statusType.map((stateType) => stringValue(stateType))
        : [],
    ),
  )

  return {
    labels: labels.length,
    projects: projects.length,
    milestones: milestones.length,
    issues: issues.length,
    views: views.length,
    documents: documents.length,
    issueStateTypes,
    viewStatusTypes,
    requiredWorkflowStateTypes: collectUniqueStrings([
      ...issueStateTypes,
      ...viewStatusTypes,
    ]),
  }
}

function summarizeInventory(seed, data, expectedTeam) {
  const teamKey = expectedTeam.key
  const remoteProjects = data.projects?.nodes ?? []
  const remoteInitiatives = data.initiatives?.nodes ?? []
  const remoteLabels = data.issueLabels?.nodes ?? []
  const remoteDocuments = data.documents?.nodes ?? []
  const remoteViews = data.customViews?.nodes ?? []

  const seedViews = seed.views ?? []
  const remotelyComparableViews = seedViews.filter(
    (view) => view.scope !== 'project' && view.scope !== 'initiative',
  )
  const manuallyVerifiedViews = seedViews.filter(
    (view) => view.scope === 'project' || view.scope === 'initiative',
  )

  const viewInventory = matchByName(
    remotelyComparableViews.map((view) => view.name),
    remoteViews
      .filter((view) => view.team?.key === teamKey || view.team === null)
      .map((view) => view.name),
    data.customViews?.pageInfo?.hasNextPage === false,
  )

  return {
    projects: matchByName(
      (seed.projects ?? []).map((project) => project.name),
      remoteProjects.map((project) => project.name),
      data.projects?.pageInfo?.hasNextPage === false,
    ),
    initiative: matchByName(
      [seed.initiative?.name].filter(Boolean),
      remoteInitiatives.map((initiative) => initiative.name),
      data.initiatives?.pageInfo?.hasNextPage === false,
    ),
    labels: matchByName(
      (seed.labels ?? []).map((label) => label.name),
      remoteLabels
        .filter((label) => label.team?.key === teamKey || label.team === null)
        .map((label) => label.name),
      data.issueLabels?.pageInfo?.hasNextPage === false,
    ),
    documents: matchByName(
      (seed.documents ?? []).map((document) => document.title),
      remoteDocuments
        .filter(
          (document) =>
            document.team?.key === teamKey ||
            (seed.projects ?? []).some(
              (project) => project.name === document.project?.name,
            ),
        )
        .map((document) => document.title),
      data.documents?.pageInfo?.hasNextPage === false,
    ),
    views: {
      ...viewInventory,
      manualProjectScoped: manuallyVerifiedViews.length,
      manualProjectScopedNames: manuallyVerifiedViews
        .map((view) => view.name)
        .filter(Boolean)
        .sort(),
    },
  }
}

function collectUniqueStrings(values) {
  return [...new Set(values.filter((value) => value !== null))].sort()
}

function matchByName(expected, actual, complete) {
  const actualSet = new Set(actual.filter(Boolean))
  const expectedNames = expected.filter(Boolean).sort()
  const matched = expectedNames.filter((name) => actualSet.has(name)).sort()
  const missing = expectedNames.filter((name) => !actualSet.has(name)).sort()

  return {
    expected: expectedNames.length,
    expectedNames,
    complete,
    matched: matched.length,
    matchedNames: matched,
    missing: missing.length,
    missingNames: missing,
  }
}

function findMatchingTeam(teams, expectedTeam) {
  return (
    teams.find(
      (team) =>
        (!expectedTeam.key || team.key === expectedTeam.key) &&
        (!expectedTeam.name || team.name === expectedTeam.name),
    ) ?? null
  )
}

function withStatus(report, blockingReason, checks) {
  return {
    ...report,
    status: 'not_ready',
    blockingReason,
    checks,
  }
}

function check(id, passed, detail) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    detail,
  }
}

function stringValue(value) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
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

main().catch((error) => {
  logError(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

#!/usr/bin/env node

import { error as logError, log } from 'node:console'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { parse as parseJsonc } from 'jsonc-parser'

import { officialClientPins } from './honowarden-official-client-harness.mjs'

const scriptPath = fileURLToPath(import.meta.url)
const defaultRepoRoot = resolve(dirname(scriptPath), '..')

export const routeInventoryClassifications = Object.freeze([
  'implemented',
  'planned',
  'client_local',
  'hosted_only',
  'rejected',
])

export const routeInventoryRequirementKinds = Object.freeze([
  'protocol',
  'upstream_ui',
  'cloud_commerce',
  'client_local',
  'optional_integration',
  'operator',
])

export const routeInventoryEvidenceLevels = Object.freeze([
  'none',
  'fixture',
  'local_api',
  'local_official_client',
  'live_smoke',
  'live_regression',
])

export const routeInventorySchemaVersion = 1
export const officialSurfaceCatalogSchemaVersion = 1
export const lastReviewDatePattern = /^\d{4}-\d{2}-\d{2}$/
export const linearIssuePattern = /^HON-\d+$/
export const sendRuntimeSupportForbiddenReason =
  'send_runtime_support_forbidden'

export function defaultRouteInventoryPaths(repoRoot = defaultRepoRoot) {
  return {
    repoRoot,
    inventoryPath: join(repoRoot, 'compat/route-inventory.json'),
    catalogPath: join(repoRoot, 'compat/official-surface-catalog.json'),
    schemaPath: join(repoRoot, 'compat/route-inventory.schema.json'),
    appPath: join(repoRoot, 'src/app.ts'),
    tokensPath: join(repoRoot, 'src/domain/tokens.ts'),
    configPath: join(repoRoot, 'src/protocol/config.ts'),
    wranglerPath: join(repoRoot, 'wrangler.jsonc'),
    roadmapPath: join(repoRoot, 'ROADMAP.md'),
    migrationsDir: join(repoRoot, 'migrations'),
    adrDir: join(repoRoot, 'docs/adr'),
    fixturesDir: join(repoRoot, 'compat/fixtures'),
    inventoryDocPath: join(repoRoot, 'docs/compatibility-inventory.md'),
    compatibilityDocPath: join(repoRoot, 'docs/compatibility.md'),
  }
}

export function extractHonoRoutes(source) {
  const routes = []
  const seen = new Set()

  const add = (method, path) => {
    if (!method || !path || path === 'path') {
      return
    }

    const key = `${method} ${path}`
    if (seen.has(key)) {
      return
    }

    seen.add(key)
    routes.push({ method, path })
  }

  for (const match of source.matchAll(
    /app\.(get|post|put|delete|patch|all)\(\s*'([^']+)'/g,
  )) {
    add(match[1].toUpperCase(), match[2])
  }

  for (const match of source.matchAll(
    /app\.on\(\s*\[([^\]]+)\]\s*,\s*'([^']+)'/g,
  )) {
    const methods = [...match[1].matchAll(/'([A-Za-z]+)'/g)].map((item) =>
      item[1].toUpperCase(),
    )
    for (const method of methods) {
      add(method, match[2])
    }
  }

  if (
    source.includes('for (const path of accountLifecycleRoutePaths)') &&
    /app\.get\(path,/.test(source)
  ) {
    for (const path of extractAccountLifecyclePaths(source)) {
      add('GET', path)
    }
  }

  return routes.sort(compareMethodPath)
}

export function extractAccountLifecyclePaths(source) {
  const block = source.match(
    /const accountLifecycleRoutePaths = new Set\(\[([\s\S]*?)\]\)/,
  )
  if (!block) {
    return []
  }

  return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
}

export function extractTokenGrants(appSource, tokensSource) {
  const grants = new Set()
  if (tokensSource.includes("'password'")) {
    grants.add('password')
  }
  if (tokensSource.includes("'refresh_token'")) {
    grants.add('refresh_token')
  }
  if (appSource.includes("grant_type') === 'send_access'")) {
    grants.add('send_access')
  }
  if (appSource.includes("'webauthn'") || tokensSource.includes("'webauthn'")) {
    grants.add('webauthn')
  }

  return [...grants].sort()
}

export function extractConfigFeatureStates(source) {
  const block = source.match(/featureStates:\s*\{([^}]+)\}/)
  if (!block) {
    return []
  }

  return [...block[1].matchAll(/'([^']+)':/g)].map((match) => match[1]).sort()
}

export function extractReturnedObjectKeys(source, functionName) {
  const match = source.match(
    new RegExp(
      `function ${functionName}\\([\\s\\S]*?\\n\\s*return \\{([\\s\\S]*?)\\n\\s*\\}`,
    ),
  )
  if (!match) {
    return []
  }

  return [...match[1].matchAll(/^\s*([A-Za-z0-9_]+)(?:,|:)/gm)].map(
    (item) => item[1],
  )
}

export function extractSyncFields(source) {
  return extractReturnedObjectKeys(source, 'buildSyncResponse')
}

export function extractProfileFlags(source) {
  return extractReturnedObjectKeys(source, 'buildSyncProfileResponse').filter(
    (key) =>
      key === 'premium' ||
      /premium|Enabled|Verified|force|uses|connector|Reset/i.test(key),
  )
}

export function extractMigrationIds(migrationsDir) {
  if (!existsSync(migrationsDir)) {
    return []
  }

  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
}

export function extractAdrIds(adrDir) {
  if (!existsSync(adrDir)) {
    return []
  }

  return readdirSync(adrDir)
    .filter((name) => /^\d{4}-.+\.md$/.test(name))
    .sort()
}

export function extractRoadmapNonGoals(markdown) {
  const heading = '## Explicit Non-Goals For The First Six Months'
  const start = markdown.indexOf(heading)
  if (start === -1) {
    return []
  }

  const rest = markdown.slice(start + heading.length)
  const until = rest.split(/\n## /)[0]
  return [...until.matchAll(/^- (.+)$/gm)].map((match) => match[1].trim())
}

export function extractWranglerTrueFlags(config) {
  const enabled = []
  const environments = [
    ['default', config.vars ?? {}],
    ...Object.entries(config.env ?? {}).map(([name, value]) => [
      name,
      value?.vars ?? {},
    ]),
  ]

  for (const [envName, vars] of environments) {
    for (const [flag, value] of Object.entries(vars)) {
      if (
        typeof value === 'string' &&
        value.trim().toLowerCase() === 'true' &&
        flag.startsWith('HONOWARDEN_')
      ) {
        enabled.push({ env: envName, flag })
      }
    }
  }

  return enabled.sort(
    (left, right) =>
      left.env.localeCompare(right.env) || left.flag.localeCompare(right.flag),
  )
}

export function extractFixtureEndpoints(fixturesDir) {
  if (!existsSync(fixturesDir)) {
    return []
  }

  const endpoints = []
  walkJsonFiles(fixturesDir, (fullPath) => {
    const fixture = JSON.parse(readFileSync(fullPath, 'utf8'))
    const method = fixture?.endpoint?.method
    const path = fixture?.endpoint?.path
    if (method && path) {
      endpoints.push({ method, path, file: fullPath })
    }
  })
  return endpoints
}

export function pathMatches(pattern, path) {
  if (pattern === path) {
    return true
  }

  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2)
    return path === prefix || path.startsWith(`${prefix}/`)
  }

  if (pattern.endsWith('*')) {
    return path.startsWith(pattern.slice(0, -1))
  }

  const patternParts = pattern.split('/')
  const pathParts = path.split('/')
  if (patternParts.length !== pathParts.length) {
    return false
  }

  return patternParts.every(
    (part, index) =>
      part === pathParts[index] ||
      part.startsWith(':') ||
      pathParts[index].startsWith(':') ||
      part === '*' ||
      pathParts[index] === '*',
  )
}

export function methodMatches(patternMethod, method) {
  return (
    patternMethod === '*' ||
    patternMethod === 'ALL' ||
    patternMethod === method ||
    method === 'ALL'
  )
}

export function routeCovered(route, entry) {
  const covers = entry.covers ?? []
  return covers.some(
    (cover) =>
      methodMatches(cover.method, route.method) &&
      pathMatches(cover.path, route.path),
  )
}

export function controllerMatches(controller, entry) {
  const matchers = entry.controllerMatchers ?? []
  return matchers.some(
    (matcher) =>
      matcher.tree === controller.tree &&
      controller.path.startsWith(matcher.pathPrefix),
  )
}

export function observeRepository(paths) {
  const appSource = readFileSync(paths.appPath, 'utf8')
  const tokensSource = readFileSync(paths.tokensPath, 'utf8')
  const configSource = readFileSync(paths.configPath, 'utf8')
  const wranglerConfig = parseJsonc(readFileSync(paths.wranglerPath, 'utf8'))
  const roadmap = readFileSync(paths.roadmapPath, 'utf8')

  return {
    routes: extractHonoRoutes(appSource),
    tokenGrants: extractTokenGrants(appSource, tokensSource),
    configFlags: extractConfigFeatureStates(configSource),
    syncFields: extractSyncFields(appSource),
    profileFlags: extractProfileFlags(appSource),
    migrations: extractMigrationIds(paths.migrationsDir),
    adrs: extractAdrIds(paths.adrDir),
    roadmapNonGoals: extractRoadmapNonGoals(roadmap),
    enabledFlags: extractWranglerTrueFlags(wranglerConfig),
    fixtureEndpoints: extractFixtureEndpoints(paths.fixturesDir),
  }
}

export function loadRouteInventory(inventoryPath) {
  return JSON.parse(readFileSync(inventoryPath, 'utf8'))
}

export function loadOfficialSurfaceCatalog(catalogPath) {
  return JSON.parse(readFileSync(catalogPath, 'utf8'))
}

export function validateInventoryShape(inventory) {
  const errors = []
  if (inventory.schemaVersion !== routeInventorySchemaVersion) {
    errors.push('inventory schemaVersion must be 1')
  }
  if (!Array.isArray(inventory.entries) || inventory.entries.length < 1) {
    errors.push('inventory entries must be a non-empty array')
  }

  const ids = new Set()
  for (const entry of inventory.entries ?? []) {
    if (!entry?.id || typeof entry.id !== 'string') {
      errors.push('inventory entry is missing id')
      continue
    }
    if (ids.has(entry.id)) {
      errors.push(`duplicate inventory id ${entry.id}`)
    }
    ids.add(entry.id)

    if (!routeInventoryClassifications.includes(entry.classification)) {
      errors.push(`${entry.id} has unknown classification`)
    }
    if (!routeInventoryRequirementKinds.includes(entry.requirementKind)) {
      errors.push(`${entry.id} has unknown requirementKind`)
    }
    if (!routeInventoryEvidenceLevels.includes(entry.evidenceLevel)) {
      errors.push(`${entry.id} has unknown evidenceLevel`)
    }
    if (!lastReviewDatePattern.test(entry.lastReviewedAt ?? '')) {
      errors.push(`${entry.id} is missing lastReviewedAt`)
    }
    if (!entry.ownerIssue && !entry.rationale) {
      errors.push(`${entry.id} needs ownerIssue or rationale`)
    }
    if (entry.ownerIssue && !linearIssuePattern.test(entry.ownerIssue)) {
      errors.push(`${entry.id} ownerIssue must be a HON issue id`)
    }
    if (!entry.sourcePin && entry.requirementKind === 'protocol') {
      errors.push(`${entry.id} protocol surface needs a source pin`)
    }
  }

  return errors
}

export function validateCatalogPins(catalog) {
  const errors = []
  if (catalog.schemaVersion !== officialSurfaceCatalogSchemaVersion) {
    errors.push('catalog schemaVersion must be 1')
  }
  if (catalog.refresh?.mode !== 'reviewed_diff') {
    errors.push('catalog refresh must open a reviewed diff')
  }
  if (catalog.refresh?.doesNotMutateClassifications !== true) {
    errors.push('catalog refresh must not mutate classifications')
  }

  for (const surface of ['server', 'web', 'browser', 'cli']) {
    const catalogPin = catalog.pins?.[surface]
    const harnessPin = officialClientPins[surface]
    if (
      catalogPin?.repository !== harnessPin.repository ||
      catalogPin?.tag !== harnessPin.tag ||
      catalogPin?.commit !== harnessPin.commit
    ) {
      errors.push(`catalog pin for ${surface} does not match harness pins`)
    }
  }

  if (!Array.isArray(catalog.controllers) || catalog.controllers.length < 1) {
    errors.push('catalog controllers must be a non-empty array')
  }

  return errors
}

export function reconcileRouteInventory({
  observed,
  inventory,
  catalog,
  evidenceExists = defaultEvidenceExists,
}) {
  const unclassified = []
  const staleSupportClaims = []
  const orphanRoadmapEntries = []
  const enabledWithoutEvidence = []

  for (const route of observed.routes) {
    if (!inventory.entries.some((entry) => routeCovered(route, entry))) {
      unclassified.push({
        kind: 'route',
        key: `${route.method} ${route.path}`,
      })
    }
  }

  for (const grant of observed.tokenGrants) {
    if (
      !inventory.entries.some(
        (entry) => entry.kind === 'token_grant' && entry.grant === grant,
      )
    ) {
      unclassified.push({ kind: 'token_grant', key: grant })
    }
  }

  for (const flag of observed.configFlags) {
    if (
      !inventory.entries.some(
        (entry) => entry.kind === 'config_flag' && entry.flag === flag,
      )
    ) {
      unclassified.push({ kind: 'config_flag', key: flag })
    }
  }

  for (const field of observed.syncFields) {
    if (
      !inventory.entries.some(
        (entry) => entry.kind === 'sync_field' && entry.field === field,
      )
    ) {
      unclassified.push({ kind: 'sync_field', key: field })
    }
  }

  for (const field of observed.profileFlags) {
    if (
      !inventory.entries.some(
        (entry) => entry.kind === 'profile_flag' && entry.field === field,
      )
    ) {
      unclassified.push({ kind: 'profile_flag', key: field })
    }
  }

  for (const controller of catalog.controllers ?? []) {
    if (
      !inventory.entries.some((entry) => controllerMatches(controller, entry))
    ) {
      unclassified.push({
        kind: 'official_controller',
        key: `${controller.tree}:${controller.path}`,
      })
    }
  }

  for (const route of catalog.routes ?? []) {
    const coveredByOfficialId = inventory.entries.some((entry) =>
      (entry.officialIds ?? []).includes(route.id),
    )
    const coveredByRoute = inventory.entries.some((entry) =>
      routeCovered(route, entry),
    )
    if (!coveredByOfficialId && !coveredByRoute) {
      unclassified.push({ kind: 'official_route', key: route.id })
    }
  }

  for (const grant of catalog.tokenGrants ?? []) {
    if (
      !inventory.entries.some(
        (entry) =>
          entry.kind === 'token_grant' &&
          (entry.grant === grant.id || entry.grant === grant.grant),
      )
    ) {
      unclassified.push({
        kind: 'official_token_grant',
        key: grant.id ?? grant.grant,
      })
    }
  }

  const migrationEntry = inventory.entries.find(
    (entry) => entry.kind === 'migration_set',
  )
  if (!sameStringSet(migrationEntry?.migrations ?? [], observed.migrations)) {
    unclassified.push({
      kind: 'migration_set',
      key: 'migrations',
      expected: observed.migrations,
      recorded: migrationEntry?.migrations ?? [],
    })
  }

  const adrEntry = inventory.entries.find((entry) => entry.kind === 'adr_set')
  if (!sameStringSet(adrEntry?.adrs ?? [], observed.adrs)) {
    unclassified.push({
      kind: 'adr_set',
      key: 'adrs',
      expected: observed.adrs,
      recorded: adrEntry?.adrs ?? [],
    })
  }

  for (const entry of inventory.entries) {
    if (claimsSendRuntimeSupport(entry)) {
      staleSupportClaims.push({
        id: entry.id,
        reason: sendRuntimeSupportForbiddenReason,
      })
    }

    if (entry.supportClaim === true) {
      if (entry.classification !== 'implemented') {
        staleSupportClaims.push({
          id: entry.id,
          reason: 'support_claim_on_non_implemented',
        })
      }
      if (
        entry.evidenceLevel === 'none' ||
        !Array.isArray(entry.evidence) ||
        entry.evidence.length < 1 ||
        entry.evidence.some((item) => !evidenceExists(item))
      ) {
        staleSupportClaims.push({
          id: entry.id,
          reason: 'support_claim_without_evidence',
        })
      }
    }

    if (entry.classification === 'implemented' && entry.kind === 'route') {
      const covered = observed.routes.filter((route) =>
        routeCovered(route, entry),
      )
      if (covered.length === 0) {
        staleSupportClaims.push({
          id: entry.id,
          reason: 'implemented_route_missing',
        })
      }
    }
  }

  const anchors = new Set(
    inventory.entries.flatMap((entry) => entry.roadmapAnchors ?? []),
  )
  for (const goal of observed.roadmapNonGoals) {
    if (!anchors.has(goal)) {
      orphanRoadmapEntries.push(goal)
    }
  }

  for (const enabled of observed.enabledFlags) {
    const capability = inventory.entries.find((entry) =>
      (entry.runtimeFlags ?? []).includes(enabled.flag),
    )
    if (!capability) {
      unclassified.push({
        kind: 'runtime_flag',
        key: `${enabled.env}:${enabled.flag}`,
      })
      continue
    }

    if (
      capability.classification === 'rejected' ||
      capability.classification === 'planned'
    ) {
      enabledWithoutEvidence.push({
        env: enabled.env,
        flag: enabled.flag,
        id: capability.id,
        reason: 'non_implemented_capability_enabled',
      })
      continue
    }

    if (
      capability.evidenceLevel === 'none' ||
      !Array.isArray(capability.evidence) ||
      capability.evidence.length < 1 ||
      capability.evidence.some((item) => !evidenceExists(item))
    ) {
      enabledWithoutEvidence.push({
        env: enabled.env,
        flag: enabled.flag,
        id: capability.id,
        reason: 'enabled_capability_without_evidence',
      })
    }
  }

  const sendFlag = observed.configFlags.includes('send-enabled')
    ? inventory.entries.find(
        (entry) =>
          entry.kind === 'config_flag' && entry.flag === 'send-enabled',
      )
    : null
  if (sendFlag?.honowardenValue !== false) {
    staleSupportClaims.push({
      id: sendFlag?.id ?? 'config.send-enabled',
      reason: 'send_enabled_must_remain_false',
    })
  }

  return {
    unclassified,
    staleSupportClaims,
    orphanRoadmapEntries,
    enabledWithoutEvidence,
  }
}

export function verifyRouteInventory({
  repoRoot = defaultRepoRoot,
  inventory,
  catalog,
  observed,
  evidenceExists,
} = {}) {
  const paths = defaultRouteInventoryPaths(repoRoot)
  const loadedInventory = inventory ?? loadRouteInventory(paths.inventoryPath)
  const loadedCatalog = catalog ?? loadOfficialSurfaceCatalog(paths.catalogPath)
  const loadedObserved = observed ?? observeRepository(paths)
  const shapeErrors = [
    ...validateInventoryShape(loadedInventory),
    ...validateCatalogPins(loadedCatalog),
  ]
  const report = reconcileRouteInventory({
    observed: loadedObserved,
    inventory: loadedInventory,
    catalog: loadedCatalog,
    evidenceExists:
      evidenceExists ?? ((item) => defaultEvidenceExists(item, paths.repoRoot)),
  })

  const ok =
    shapeErrors.length === 0 &&
    report.unclassified.length === 0 &&
    report.staleSupportClaims.length === 0 &&
    report.orphanRoadmapEntries.length === 0 &&
    report.enabledWithoutEvidence.length === 0

  return {
    ok,
    shapeErrors,
    observed: summarizeObserved(loadedObserved),
    ...report,
  }
}

export function refreshOfficialCatalog({
  catalog,
  officialSourceRoot,
  writeClassifications = false,
} = {}) {
  if (writeClassifications) {
    throw new Error('catalog refresh must not mutate inventory classifications')
  }

  if (!officialSourceRoot) {
    return {
      mode: 'reviewed_diff',
      status: 'pin_only',
      message:
        'No official source checkout provided. Checked-in catalog remains the pin; refresh emits a reviewed diff and does not change classifications.',
      catalog,
      proposedControllers: catalog.controllers,
      changed: false,
    }
  }

  const proposedControllers = scanOfficialControllers(officialSourceRoot)
  const current = new Set(
    (catalog.controllers ?? []).map(
      (controller) => `${controller.tree}:${controller.path}`,
    ),
  )
  const proposed = new Set(
    proposedControllers.map(
      (controller) => `${controller.tree}:${controller.path}`,
    ),
  )
  const added = [...proposed].filter((key) => !current.has(key)).sort()
  const removed = [...current].filter((key) => !proposed.has(key)).sort()

  return {
    mode: 'reviewed_diff',
    status: added.length === 0 && removed.length === 0 ? 'unchanged' : 'diff',
    message:
      'Official source refresh produced a catalog diff. Classify newly observed surfaces in a reviewed inventory change; do not silently update support claims.',
    added,
    removed,
    proposedControllers,
    changed: added.length > 0 || removed.length > 0,
  }
}

export function scanOfficialControllers(officialSourceRoot) {
  const controllers = []
  const ossRoot = officialSourceRoot
  const commercialRoot = join(officialSourceRoot, 'commercial_license')
  collectControllers(ossRoot, ossRoot, 'oss', controllers)
  if (existsSync(commercialRoot)) {
    collectControllers(
      commercialRoot,
      commercialRoot,
      'commercial',
      controllers,
    )
  }

  return controllers.sort((left, right) =>
    `${left.tree}:${left.path}`.localeCompare(`${right.tree}:${right.path}`),
  )
}

function collectControllers(root, current, tree, controllers) {
  if (!existsSync(current)) {
    return
  }

  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const fullPath = join(current, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'test' || entry.name === 'tests') {
        continue
      }
      collectControllers(root, fullPath, tree, controllers)
      continue
    }

    if (!entry.isFile() || !entry.name.endsWith('Controller.cs')) {
      continue
    }

    const relativePath = relative(root, fullPath).split('\\').join('/')
    if (relativePath.split('/').includes('test')) {
      continue
    }

    controllers.push({ tree, path: relativePath })
  }
}

function compareMethodPath(left, right) {
  return (
    left.path.localeCompare(right.path) ||
    left.method.localeCompare(right.method)
  )
}

function sameStringSet(left, right) {
  if (left.length !== right.length) {
    return false
  }

  const expected = [...left].sort()
  const actual = [...right].sort()
  return expected.every((value, index) => value === actual[index])
}

function claimsSendRuntimeSupport(entry) {
  if (entry.supportClaim !== true) {
    return false
  }

  if (entry.grant === 'send_access' || entry.flag === 'send-enabled') {
    return true
  }

  const sendRoute = (entry.covers ?? []).some((cover) =>
    /(^|\/)sends(\/|$|\*)/.test(cover.path),
  )
  const sendOfficialId = (entry.officialIds ?? []).some((id) =>
    id.startsWith('official.sends.'),
  )
  return sendRoute || sendOfficialId
}

function defaultEvidenceExists(item, repoRoot = defaultRepoRoot) {
  if (typeof item !== 'string' || item.length === 0) {
    return false
  }

  if (item.startsWith('test:') || item.startsWith('flow:')) {
    return true
  }

  return existsSync(join(repoRoot, item))
}

function walkJsonFiles(dir, visit) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      walkJsonFiles(fullPath, visit)
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.json')) {
      visit(fullPath)
    }
  }
}

function summarizeObserved(observed) {
  return {
    routeCount: observed.routes.length,
    tokenGrants: observed.tokenGrants,
    configFlags: observed.configFlags,
    syncFields: observed.syncFields,
    profileFlags: observed.profileFlags,
    migrationCount: observed.migrations.length,
    adrCount: observed.adrs.length,
    roadmapNonGoals: observed.roadmapNonGoals,
    enabledFlags: observed.enabledFlags,
  }
}

function parseArgs(argv) {
  const options = {
    command: 'verify',
    officialSourceRoot: null,
    writeClassifications: false,
    json: false,
  }

  const args = [...argv]
  if (args[0] === 'verify' || args[0] === 'refresh-catalog') {
    options.command = args.shift()
  }

  while (args.length > 0) {
    const arg = args.shift()
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '--write-classifications') {
      options.writeClassifications = true
      continue
    }
    if (arg === '--official-source') {
      options.officialSourceRoot = args.shift() ?? null
      continue
    }
    throw new Error(`Unknown option: ${arg}`)
  }

  return options
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const paths = defaultRouteInventoryPaths()
  const inventory = loadRouteInventory(paths.inventoryPath)
  const catalog = loadOfficialSurfaceCatalog(paths.catalogPath)

  if (options.command === 'refresh-catalog') {
    const refresh = refreshOfficialCatalog({
      catalog,
      officialSourceRoot: options.officialSourceRoot,
      writeClassifications: options.writeClassifications,
    })
    log(JSON.stringify(refresh, null, 2))
    if (refresh.changed) {
      process.exitCode = 1
    }
    return
  }

  const result = verifyRouteInventory({
    repoRoot: paths.repoRoot,
    inventory,
    catalog,
  })
  if (options.json || !result.ok) {
    log(JSON.stringify(result, null, 2))
  }
  if (!result.ok) {
    logError('route inventory verification failed')
    process.exitCode = 1
  }
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  try {
    main()
  } catch (caught) {
    logError(caught instanceof Error ? caught.message : `${caught}`)
    process.exitCode = 1
  }
}

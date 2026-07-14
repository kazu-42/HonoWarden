#!/usr/bin/env node
/* global fetch, setTimeout */

import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

const cloudflareApiBase = 'https://api.cloudflare.com/client/v4'
const defaultSecretFile = '~/.config/honowarden/cloudflare-scoped.env'
const oneDayMs = 24 * 60 * 60 * 1000

const tokenSpecs = [
  {
    id: 'deploy',
    name: 'HonoWarden deploy worker scoped token',
    envVar: 'CLOUDFLARE_HONOWARDEN_DEPLOY_TOKEN',
    purpose:
      'Worker script deploys, route attachment, and deployment readback.',
    accountPermissions: ['Workers Scripts Write'],
    zonePermissions: ['Zone Read', 'Workers Routes Write'],
    verify: [
      {
        id: 'workers_services_read',
        method: 'GET',
        path: ({ accountId }) => `/accounts/${accountId}/workers/services`,
      },
      {
        id: 'workers_routes_read',
        method: 'GET',
        path: ({ zoneId }) => `/zones/${zoneId}/workers/routes?per_page=1`,
      },
    ],
  },
  {
    id: 'dns_routes',
    name: 'HonoWarden DNS and routes scoped token',
    envVar: 'CLOUDFLARE_HONOWARDEN_DNS_ROUTES_TOKEN',
    purpose:
      'DNS record changes and approved Worker route changes for honowarden.com.',
    accountPermissions: [],
    zonePermissions: ['Zone Read', 'DNS Write', 'Workers Routes Write'],
    verify: [
      {
        id: 'dns_records_read',
        method: 'GET',
        path: ({ zoneId }) => `/zones/${zoneId}/dns_records?per_page=1`,
      },
      {
        id: 'workers_routes_read',
        method: 'GET',
        path: ({ zoneId }) => `/zones/${zoneId}/workers/routes?per_page=1`,
      },
    ],
  },
  {
    id: 'email_routing',
    name: 'HonoWarden Email Routing scoped token',
    envVar: 'CLOUDFLARE_HONOWARDEN_EMAIL_ROUTING_TOKEN',
    purpose:
      'Email Routing rules and destination-address operations for honowarden.com.',
    accountPermissions: [
      'Email Routing Addresses Read',
      'Email Routing Addresses Write',
    ],
    zonePermissions: ['Zone Read', 'DNS Read', 'Email Routing Rules Write'],
    verify: [
      {
        id: 'email_routing_rules_read',
        method: 'GET',
        path: ({ zoneId }) => `/zones/${zoneId}/email/routing/rules`,
      },
      {
        id: 'dns_records_read',
        method: 'GET',
        path: ({ zoneId }) => `/zones/${zoneId}/dns_records?per_page=1`,
      },
    ],
  },
  {
    id: 'd1_r2',
    name: 'HonoWarden D1 and R2 scoped token',
    envVar: 'CLOUDFLARE_HONOWARDEN_D1_R2_TOKEN',
    purpose: 'D1 migrations/readback and R2 object backup/restore operations.',
    accountPermissions: [
      'D1 Metadata Read',
      'D1 Read',
      'D1 Write',
      'Workers R2 Storage Metadata Read',
      'Workers R2 Storage Read',
      'Workers R2 Storage Write',
    ],
    zonePermissions: [],
    verify: [
      {
        id: 'd1_databases_read',
        method: 'GET',
        path: ({ accountId }) => `/accounts/${accountId}/d1/database`,
      },
      {
        id: 'r2_buckets_read',
        method: 'GET',
        path: ({ accountId }) => `/accounts/${accountId}/r2/buckets`,
      },
    ],
  },
  {
    id: 'readonly',
    name: 'HonoWarden read-only evidence scoped token',
    envVar: 'CLOUDFLARE_HONOWARDEN_READONLY_TOKEN',
    purpose:
      'Read-only account, zone, Worker, DNS, Email Routing, D1, R2, and token evidence.',
    accountPermissions: [
      'Account API Tokens Read',
      'Account Settings Read',
      'D1 Metadata Read',
      'D1 Read',
      'Workers Observability Read',
      'Workers R2 Storage Metadata Read',
      'Workers R2 Storage Read',
      'Workers Scripts Read',
    ],
    zonePermissions: [
      'Zone Read',
      'DNS Read',
      'Email Routing Rules Read',
      'Workers Routes Read',
    ],
    verify: [
      {
        id: 'account_tokens_read',
        method: 'GET',
        path: ({ accountId }) => `/accounts/${accountId}/tokens`,
      },
      {
        id: 'dns_records_read',
        method: 'GET',
        path: ({ zoneId }) => `/zones/${zoneId}/dns_records?per_page=1`,
      },
    ],
  },
]

async function main(argv = process.argv.slice(2), env = process.env) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv
  const [command = 'plan', ...rest] = normalizedArgv
  const options = parseOptions(rest)

  if (command === 'plan') {
    writeJson(buildStaticPlan(env, options))
    return
  }

  if (command === 'apply') {
    writeJson(await applyTokenPlan(env, options))
    return
  }

  if (command === 'verify') {
    writeJson(await verifyScopedTokens(env, options))
    return
  }

  printUsage()
  process.exitCode = 1
}

function parseOptions(argv) {
  const options = {
    execute: false,
    strict: false,
    expiresOn: defaultExpiresOn(),
    secretsOut: defaultSecretFile,
    auth: 'auto',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--') {
      continue
    }

    if (arg === '--execute') {
      options.execute = true
      continue
    }

    if (arg === '--strict') {
      options.strict = true
      continue
    }

    if (arg === '--expires-on') {
      options.expiresOn = requireNext(argv, (index += 1), arg)
      continue
    }

    if (arg === '--secrets-out') {
      options.secretsOut = requireNext(argv, (index += 1), arg)
      continue
    }

    if (arg === '--auth') {
      options.auth = requireNext(argv, (index += 1), arg)
      if (!['auto', 'token', 'global'].includes(options.auth)) {
        throw new Error('--auth must be auto, token, or global')
      }
      continue
    }

    throw new Error(`Unknown option: ${arg}`)
  }

  return options
}

function buildStaticPlan(env, options) {
  const config = readCloudflareConfig(env)
  const checks = [
    check(
      'cloudflare_account_id',
      Boolean(config.accountId),
      config.accountId
        ? 'CLOUDFLARE_ACCOUNT_ID configured'
        : 'CLOUDFLARE_ACCOUNT_ID missing',
    ),
    check(
      'cloudflare_zone_id',
      Boolean(config.zoneId),
      config.zoneId
        ? 'CLOUDFLARE_ZONE_ID_HONOWARDEN_COM configured'
        : 'CLOUDFLARE_ZONE_ID_HONOWARDEN_COM missing',
    ),
    check(
      'cloudflare_auth',
      Boolean(resolveAuthMode(env, options.auth, { allowMissing: true })),
      'Cloudflare token or global-key auth available',
    ),
  ]

  return {
    schemaVersion: 1,
    action: 'cloudflare_token_remediation_plan',
    generatedAt: new Date().toISOString(),
    status: checks.every((entry) => entry.status === 'pass')
      ? 'ready'
      : 'not_ready',
    executeRequiredForMutation: true,
    expiresOn: options.expiresOn,
    secretsOut: redactHomePath(options.secretsOut),
    tokenClasses: tokenSpecs.map(publicTokenSpec),
    checks,
    safetyBoundaries: [
      'Token values are never printed.',
      'apply without --execute performs live readback only and does not create tokens.',
      'apply --execute writes one-time token values only to the configured home-directory env file.',
      'Account-level 2FA enforcement is intentionally not mutated by this script.',
    ],
  }
}

async function applyTokenPlan(env, options) {
  const config = requireCloudflareConfig(env)
  const auth = resolveAuthMode(env, options.auth)
  const client = new CloudflareClient(env, auth)
  const permissionGroups = await client.getPermissionGroups()
  const groupByName = new Map(
    permissionGroups.map((group) => [group.name, group]),
  )
  const missingPermissionGroups = missingGroups(groupByName)
  if (missingPermissionGroups.length > 0) {
    throw new Error(
      `Missing Cloudflare permission groups: ${missingPermissionGroups.join(', ')}`,
    )
  }

  const existingTokens = await client.listAccountTokens(config.accountId)
  const existingByName = new Map(
    existingTokens.map((token) => [token.name, token]),
  )
  const createdSecrets = new Map()
  const results = []

  for (const spec of tokenSpecs) {
    const existing = existingByName.get(spec.name)
    const tokenPayload = buildTokenPayload(spec, groupByName, config, options)

    if (existing) {
      results.push({
        id: spec.id,
        name: spec.name,
        envVar: spec.envVar,
        action: 'kept_existing',
        tokenTag: hashTag(existing.id),
        status: existing.status ?? 'unknown',
        expiresOn: existing.expires_on ?? null,
        verification: [],
      })
      continue
    }

    if (!options.execute) {
      results.push({
        id: spec.id,
        name: spec.name,
        envVar: spec.envVar,
        action: 'would_create',
        expiresOn: options.expiresOn,
        policyCount: tokenPayload.policies.length,
        verification: [],
      })
      continue
    }

    const created = await client.createAccountToken(
      config.accountId,
      tokenPayload,
    )
    const secretValue = created.value
    if (typeof secretValue !== 'string' || secretValue.length === 0) {
      throw new Error(
        `Cloudflare did not return a one-time value for ${spec.name}`,
      )
    }

    createdSecrets.set(spec.envVar, secretValue)
    const verification = await verifySpecWithToken(spec, secretValue, config)
    results.push({
      id: spec.id,
      name: spec.name,
      envVar: spec.envVar,
      action: 'created',
      tokenTag: hashTag(created.id),
      status: created.status ?? 'active',
      expiresOn: created.expires_on ?? options.expiresOn,
      verification,
    })
  }

  let secretFile = null
  if (createdSecrets.size > 0) {
    secretFile = await writeSecretFile(options.secretsOut, createdSecrets)
  }

  const report = {
    schemaVersion: 1,
    action: 'cloudflare_token_remediation_apply',
    generatedAt: new Date().toISOString(),
    executed: options.execute,
    authMode: auth.mode,
    status: results.every((result) =>
      result.verification.every((entry) => entry.status === 'pass'),
    )
      ? 'ready'
      : 'not_ready',
    expiresOn: options.expiresOn,
    secretFile: secretFile ? redactHomePath(secretFile) : null,
    tokenResults: results,
    remainingOperatorActions: [
      'Enable 2FA on every Cloudflare operator account before enforcing account-level 2FA.',
      'Retire or explicitly re-accept older broad/no-expiry user tokens after owner review.',
      'Rotate the global key break-glass path during HON-60 after scoped-token adoption is confirmed.',
    ],
  }

  if (options.strict && report.status !== 'ready') {
    process.exitCode = 1
  }

  return report
}

async function verifyScopedTokens(env, options) {
  const config = requireCloudflareConfig(env)
  const secretFileValues = await readEnvFileValues(options.secretsOut)
  const tokenResults = []

  for (const spec of tokenSpecs) {
    const tokenValue =
      stringValue(env[spec.envVar]) ?? secretFileValues.get(spec.envVar)
    if (!tokenValue) {
      tokenResults.push({
        id: spec.id,
        envVar: spec.envVar,
        status: 'not_ready',
        verification: [
          check('token_configured', false, `${spec.envVar} missing`),
        ],
      })
      continue
    }

    const verification = await verifySpecWithToken(spec, tokenValue, config)
    tokenResults.push({
      id: spec.id,
      envVar: spec.envVar,
      status: verification.every((entry) => entry.status === 'pass')
        ? 'ready'
        : 'not_ready',
      tokenValueTag: hashTag(tokenValue),
      verification,
    })
  }

  const report = {
    schemaVersion: 1,
    action: 'cloudflare_token_remediation_verify',
    generatedAt: new Date().toISOString(),
    status: tokenResults.every((result) => result.status === 'ready')
      ? 'ready'
      : 'not_ready',
    tokenResults,
  }

  if (options.strict && report.status !== 'ready') {
    process.exitCode = 1
  }

  return report
}

function buildTokenPayload(spec, groupByName, config, options) {
  const policies = []

  if (spec.accountPermissions.length > 0) {
    policies.push({
      effect: 'allow',
      resources: {
        [`com.cloudflare.api.account.${config.accountId}`]: '*',
      },
      permission_groups: spec.accountPermissions.map((name) =>
        permissionGroup(groupByName, name),
      ),
    })
  }

  if (spec.zonePermissions.length > 0) {
    policies.push({
      effect: 'allow',
      resources: {
        [`com.cloudflare.api.account.zone.${config.zoneId}`]: '*',
      },
      permission_groups: spec.zonePermissions.map((name) =>
        permissionGroup(groupByName, name),
      ),
    })
  }

  return {
    name: spec.name,
    policies,
    not_before: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    expires_on: options.expiresOn,
  }
}

function permissionGroup(groupByName, name) {
  const group = groupByName.get(name)
  if (!group) {
    throw new Error(`Missing permission group: ${name}`)
  }

  return {
    id: group.id,
    name: group.name,
  }
}

function missingGroups(groupByName) {
  return [
    ...new Set(
      tokenSpecs.flatMap((spec) => [
        ...spec.accountPermissions,
        ...spec.zonePermissions,
      ]),
    ),
  ].filter((name) => !groupByName.has(name))
}

async function verifySpecWithToken(spec, tokenValue, config) {
  const client = new CloudflareClient(
    { CLOUDFLARE_API_TOKEN: tokenValue },
    'token',
  )
  const checks = []

  const verify = await requestWithRetry(
    client,
    `/accounts/${config.accountId}/tokens/verify`,
  )
  checks.push(
    check(
      'account_token_verify',
      verify.ok,
      verify.ok
        ? 'Cloudflare account token verify passed'
        : `Cloudflare account token verify failed with ${verify.status}`,
    ),
  )

  for (const probe of spec.verify) {
    const response = await requestWithRetry(client, probe.path(config), {
      method: probe.method,
    })
    checks.push(
      check(
        probe.id,
        response.ok,
        response.ok
          ? `${probe.method} ${probe.id} passed`
          : `${probe.method} ${probe.id} failed with ${response.status}`,
      ),
    )
  }

  return checks
}

async function requestWithRetry(client, path, options = {}) {
  let response = null

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    response = await client.request(path, {
      ...options,
      allowFailure: true,
    })
    if (response.ok || ![401, 403, 429].includes(response.status)) {
      return response
    }

    await sleep(attempt * 1000)
  }

  return response
}

class CloudflareClient {
  constructor(env, auth) {
    this.env = env
    this.auth = typeof auth === 'string' ? { mode: auth } : auth
  }

  async getPermissionGroups() {
    const response = await this.request('/user/tokens/permission_groups')
    return response.json.result
  }

  async listAccountTokens(accountId) {
    const response = await this.request(`/accounts/${accountId}/tokens`)
    return response.json.result
  }

  async createAccountToken(accountId, payload) {
    const response = await this.request(`/accounts/${accountId}/tokens`, {
      method: 'POST',
      body: payload,
    })
    return response.json.result
  }

  async request(path, options = {}) {
    const response = await fetch(`${cloudflareApiBase}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...this.headers(),
        'content-type': 'application/json',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    })
    const json = await response.json().catch(() => ({}))
    const ok = response.ok && json.success !== false

    if (!ok && !options.allowFailure) {
      const code = json.errors?.[0]?.code ?? response.status
      const message = json.errors?.[0]?.message ?? response.statusText
      throw new Error(`Cloudflare API failed: ${path}: ${code} ${message}`)
    }

    return {
      ok,
      status: response.status,
      json,
    }
  }

  headers() {
    if (this.auth.mode === 'token') {
      const token = stringValue(this.env.CLOUDFLARE_API_TOKEN)
      if (!token) {
        throw new Error('CLOUDFLARE_API_TOKEN missing')
      }

      return {
        authorization: `Bearer ${token}`,
      }
    }

    const email =
      stringValue(this.env.CLOUDFLARE_API_EMAIL) ??
      stringValue(this.env.CLOUDFLARE_EMAIL)
    const key =
      stringValue(this.env.CLOUDFLARE_GLOBAL_API_KEY) ??
      stringValue(this.env.CLOUDFLARE_API_KEY)
    if (!email || !key) {
      throw new Error('Cloudflare global key auth requires email and key')
    }

    return {
      'X-Auth-Email': email,
      'X-Auth-Key': key,
    }
  }
}

async function writeSecretFile(path, values) {
  const resolved = expandHome(path)
  const existing = await readOptionalFile(resolved)
  const managedVars = new Set(values.keys())
  const retainedLines = existing
    .split(/\r?\n/)
    .filter((line) => {
      const match = line.match(/^(?:export\s+)?([A-Z0-9_]+)=/)
      return !match || !managedVars.has(match[1])
    })
    .filter(
      (line, index, lines) =>
        line.trim() !== '' || lines[index + 1]?.trim() !== '',
    )

  const generated = [
    '',
    '# HonoWarden scoped Cloudflare account tokens.',
    '# Generated by scripts/honowarden-cloudflare-token-remediation.mjs.',
    '# Do not commit or paste these values.',
    ...[...values.entries()].map(
      ([name, value]) => `export ${name}=${shellQuote(value)}`,
    ),
    '',
  ]

  await mkdir(dirname(resolved), { recursive: true, mode: 0o700 })
  await writeFile(resolved, [...retainedLines, ...generated].join('\n'), {
    mode: 0o600,
  })
  await chmod(resolved, 0o600)

  return resolved
}

async function readEnvFileValues(path) {
  const contents = await readOptionalFile(expandHome(path))
  const values = new Map()

  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^(?:export\s+)?([A-Z0-9_]+)=(.*)$/)
    if (!match) {
      continue
    }

    values.set(match[1], unquoteShellValue(match[2].trim()))
  }

  return values
}

async function readOptionalFile(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return ''
    }

    throw error
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function unquoteShellValue(value) {
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("'\\''", "'")
  }

  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1)
  }

  return value
}

function readCloudflareConfig(env) {
  return {
    accountId: stringValue(env.CLOUDFLARE_ACCOUNT_ID),
    zoneId: stringValue(env.CLOUDFLARE_ZONE_ID_HONOWARDEN_COM),
  }
}

function requireCloudflareConfig(env) {
  const config = readCloudflareConfig(env)
  if (!config.accountId) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID missing')
  }
  if (!config.zoneId) {
    throw new Error('CLOUDFLARE_ZONE_ID_HONOWARDEN_COM missing')
  }

  return config
}

// Global-key auth is intentionally confined to this remediation tool so it can
// bootstrap scoped routine tokens; it is never a routine workflow fallback.
function resolveAuthMode(env, requested, options = {}) {
  if (requested === 'token') {
    if (stringValue(env.CLOUDFLARE_API_TOKEN)) {
      return { mode: 'token' }
    }
    if (options.allowMissing) {
      return null
    }
    throw new Error('CLOUDFLARE_API_TOKEN missing')
  }

  if (requested === 'global') {
    return hasGlobalAuth(env)
      ? { mode: 'global' }
      : missingAuth(options, 'Cloudflare global key auth missing')
  }

  if (stringValue(env.CLOUDFLARE_API_TOKEN)) {
    return { mode: 'token' }
  }

  if (hasGlobalAuth(env)) {
    return { mode: 'global' }
  }

  return missingAuth(options, 'Cloudflare API token or global key auth missing')
}

function hasGlobalAuth(env) {
  const hasEmail =
    stringValue(env.CLOUDFLARE_API_EMAIL) !== null ||
    stringValue(env.CLOUDFLARE_EMAIL) !== null
  const hasKey =
    stringValue(env.CLOUDFLARE_GLOBAL_API_KEY) !== null ||
    stringValue(env.CLOUDFLARE_API_KEY) !== null

  return hasEmail && hasKey
}

function missingAuth(options, message) {
  if (options.allowMissing) {
    return null
  }

  throw new Error(message)
}

function publicTokenSpec(spec) {
  return {
    id: spec.id,
    name: spec.name,
    envVar: spec.envVar,
    purpose: spec.purpose,
    accountPermissions: spec.accountPermissions,
    zonePermissions: spec.zonePermissions,
    verifyChecks: spec.verify.map((probe) => probe.id),
  }
}

function defaultExpiresOn(now = new Date()) {
  return new Date(now.getTime() + 90 * oneDayMs)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
}

function requireNext(argv, index, option) {
  const value = argv[index]
  if (!value) {
    throw new Error(`${option} requires a value`)
  }

  return value
}

function expandHome(path) {
  if (path === '~') {
    return homedir()
  }

  if (path.startsWith('~/')) {
    return resolve(homedir(), path.slice(2))
  }

  return resolve(path)
}

function redactHomePath(path) {
  const resolved = expandHome(path)
  const home = homedir()
  return resolved.startsWith(`${home}/`)
    ? `~/${resolved.slice(home.length + 1)}`
    : resolved
}

function hashTag(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12)
}

function check(id, passed, detail) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    detail,
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms)
  })
}

function stringValue(value) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function printUsage() {
  process.stderr.write(`Usage:
  node scripts/honowarden-cloudflare-token-remediation.mjs plan [--expires-on ISO] [--secrets-out PATH]
  node scripts/honowarden-cloudflare-token-remediation.mjs apply [--execute] [--auth auto|token|global] [--expires-on ISO] [--secrets-out PATH] [--strict]
  node scripts/honowarden-cloudflare-token-remediation.mjs verify [--secrets-out PATH] [--strict]
`)
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})

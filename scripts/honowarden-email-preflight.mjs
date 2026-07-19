#!/usr/bin/env node

import { readdirSync } from 'node:fs'
import { log } from 'node:console'
import { join } from 'node:path'
import process from 'node:process'

const defaultDomain = 'honowarden.com'

const routeSpecs = [
  {
    localPart: 'security',
    envVar: 'HONOWARDEN_SECURITY_FORWARD_TO',
    purpose: 'vulnerability reports',
  },
  {
    localPart: 'support',
    envVar: 'HONOWARDEN_SUPPORT_FORWARD_TO',
    purpose: 'operational support',
  },
  {
    localPart: 'hello',
    envVar: 'HONOWARDEN_GENERAL_FORWARD_TO',
    purpose: 'general project contact',
  },
  {
    localPart: 'admin',
    envVar: 'HONOWARDEN_ADMIN_FORWARD_TO',
    purpose: 'domain and service operations',
  },
  {
    localPart: 'postmaster',
    envVar: 'HONOWARDEN_POSTMASTER_FORWARD_TO',
    purpose: 'required domain operations contact',
  },
  {
    localPart: 'abuse',
    envVar: 'HONOWARDEN_ABUSE_FORWARD_TO',
    purpose: 'required abuse contact',
  },
]

function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseOptions(argv)
  const report = buildEmailPreflightReport(env)

  log(JSON.stringify(report, null, 2))

  if (options.strict && report.status !== 'ready') {
    process.exitCode = 1
  }
}

function parseOptions(argv) {
  const options = {
    strict: false,
  }

  for (const arg of argv) {
    if (arg === '--') {
      continue
    }

    if (arg === '--strict') {
      options.strict = true
      continue
    }

    throw new Error(`Unknown option: ${arg}`)
  }

  return options
}

function buildEmailPreflightReport(env) {
  const domain = stringValue(env.HONOWARDEN_DOMAIN) ?? defaultDomain
  const routes = routeSpecs.map((route) => ({
    address: `${route.localPart}@${domain}`,
    envVar: route.envVar,
    purpose: route.purpose,
    destinationConfigured: stringValue(env[route.envVar]) !== null,
  }))
  const checks = [
    cloudflareApiAuthCheck(env),
    wranglerOauthSessionCheck(env),
    configuredCheck(
      'cloudflare_account_id',
      env.CLOUDFLARE_ACCOUNT_ID,
      'CLOUDFLARE_ACCOUNT_ID',
    ),
    configuredCheck(
      'cloudflare_zone_id',
      env.CLOUDFLARE_ZONE_ID_HONOWARDEN_COM,
      'CLOUDFLARE_ZONE_ID_HONOWARDEN_COM',
    ),
    ...routes.map((route) =>
      check(
        `destination_${route.address.split('@')[0]}`,
        route.destinationConfigured,
        route.destinationConfigured
          ? `${route.envVar} configured`
          : `${route.envVar} missing`,
      ),
    ),
  ]
  const ready = checks.every((entry) => entry.status !== 'fail')

  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    status: ready ? 'ready' : 'not_ready',
    domain,
    requiredCloudflareCapabilities: [
      'zone read access for honowarden.com',
      'DNS write access for MX/SPF records',
      'Email Routing write access for routes and destination handling',
    ],
    checks,
    routes,
    limitations: [
      'This preflight does not call Cloudflare APIs or send email.',
      'Cloudflare token scopes must be verified with Cloudflare before writes.',
      'Wrangler OAuth auth profiles are detected by filename only and their contents are never read by this preflight.',
      'Destination inboxes must be verified in Cloudflare before routes are created.',
    ],
  }
}

function configuredCheck(id, value, envVar) {
  return check(
    id,
    stringValue(value) !== null,
    stringValue(value) === null ? `${envVar} missing` : `${envVar} configured`,
  )
}

function cloudflareApiAuthCheck(env) {
  // These variables are inspected only to reject break-glass auth explicitly.
  // Wrangler prefers complete global-key auth over API tokens, so its presence
  // must fail before either scoped-token path can pass.
  const hasGlobalKey =
    stringValue(env.CLOUDFLARE_API_KEY) !== null ||
    stringValue(env.CLOUDFLARE_GLOBAL_API_KEY) !== null

  if (hasGlobalKey) {
    return check(
      'cloudflare_api_token',
      false,
      'Cloudflare global API key auth is break-glass only and is not accepted for routine Email Routing workflows; Wrangler gives complete global-key auth precedence over API tokens, so unset CLOUDFLARE_API_KEY/CLOUDFLARE_GLOBAL_API_KEY before using CLOUDFLARE_HONOWARDEN_EMAIL_ROUTING_TOKEN or a workflow-scoped CLOUDFLARE_API_TOKEN',
    )
  }

  const hasWorkflowToken =
    stringValue(env.CLOUDFLARE_HONOWARDEN_EMAIL_ROUTING_TOKEN) !== null
  const hasGenericToken = stringValue(env.CLOUDFLARE_API_TOKEN) !== null

  if (hasWorkflowToken) {
    return check(
      'cloudflare_api_token',
      true,
      'CLOUDFLARE_HONOWARDEN_EMAIL_ROUTING_TOKEN configured',
    )
  }

  if (hasGenericToken) {
    return check(
      'cloudflare_api_token',
      true,
      'CLOUDFLARE_API_TOKEN configured',
    )
  }

  return check(
    'cloudflare_api_token',
    false,
    'CLOUDFLARE_HONOWARDEN_EMAIL_ROUTING_TOKEN or a workflow-scoped CLOUDFLARE_API_TOKEN is required',
  )
}

function wranglerOauthSessionCheck(env) {
  const present = wranglerAuthProfilePresence(env)

  if (present) {
    return {
      id: 'wrangler_oauth_session',
      status: 'warning',
      present: true,
      detail:
        'Wrangler auth profile detected on disk and may contain a broad OAuth session; while it exists, a successful Wrangler command does not prove scoped-only operation',
    }
  }

  if (present === null) {
    return {
      id: 'wrangler_oauth_session',
      status: 'warning',
      present: null,
      detail:
        'Wrangler OAuth auth-profile presence could not be determined at every standard location; a successful Wrangler command does not prove scoped-only operation',
    }
  }

  return {
    id: 'wrangler_oauth_session',
    status: 'pass',
    present: false,
    detail: 'No Wrangler auth profile detected at standard auth locations',
  }
}

function wranglerAuthProfilePresence(env) {
  let unreadableLocation = false
  const configDirectories = wranglerAuthConfigDirectories(env)

  if (configDirectories.length === 0) {
    return null
  }

  for (const directory of configDirectories) {
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
        continue
      }

      unreadableLocation = true
      continue
    }

    const hasAuthProfile = entries.some(
      (entry) =>
        (entry.isFile() || entry.isSymbolicLink()) &&
        (entry.name.endsWith('.toml') || entry.name.endsWith('.enc')),
    )
    if (hasAuthProfile) {
      return true
    }
  }

  return unreadableLocation ? null : false
}

function wranglerAuthConfigDirectories(env) {
  const home = stringValue(env.HOME)
  const userProfile = stringValue(env.USERPROFILE)
  const xdgConfigHome = stringValue(env.XDG_CONFIG_HOME)
  const appData = stringValue(env.APPDATA)
  const homeDirectories = [...new Set([home, userProfile].filter(Boolean))]
  const authDirectories = [
    ...homeDirectories.flatMap((directory) => [
      join(directory, '.wrangler'),
      join(directory, '.config', '.wrangler'),
      join(directory, 'Library', 'Preferences', '.wrangler'),
    ]),
    ...(xdgConfigHome ? [join(xdgConfigHome, '.wrangler')] : []),
    ...(appData
      ? [join(appData, '.wrangler'), join(appData, 'xdg.config', '.wrangler')]
      : []),
  ]

  return [...new Set(authDirectories)].map((directory) =>
    join(directory, 'config'),
  )
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

main()

#!/usr/bin/env node

import { log } from 'node:console'
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
    configuredCheck(
      'cloudflare_api_token',
      env.CLOUDFLARE_API_TOKEN,
      'CLOUDFLARE_API_TOKEN',
    ),
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
  const ready = checks.every((entry) => entry.status === 'pass')

  return {
    schemaVersion: 1,
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

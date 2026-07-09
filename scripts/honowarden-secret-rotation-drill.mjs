#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

const schemaVersion = 1

const secretClasses = [
  {
    id: 'bootstrap_token',
    envVars: ['HONOWARDEN_BOOTSTRAP_TOKEN'],
    owner: 'HonoWarden operator',
    blastRadius:
      'restricted account bootstrap only; route should remain disabled outside approved bootstrap windows',
    rotationTrigger:
      'suspected exposure, operator change, or completion of a bootstrap window',
    dryRunEvidence: [
      'confirm HONOWARDEN_BOOTSTRAP_ENABLED is false by default',
      'confirm bootstrap denial still returns forbidden when disabled',
    ],
    liveRotationShape: [
      'generate a new high-entropy bootstrap token outside the repository',
      'set HONOWARDEN_BOOTSTRAP_TOKEN with wrangler secret put per environment',
      'keep HONOWARDEN_BOOTSTRAP_ENABLED false unless an approved bootstrap window exists',
    ],
    verificationCommands: [
      'pnpm exec vitest run test/domain/bootstrap.test.ts test/app.test.ts',
      'pnpm check',
      'live bootstrap disabled smoke with redacted response metadata',
    ],
    rollbackPath:
      'restore the previous bootstrap token only if the bootstrap window is still approved; otherwise keep bootstrap disabled',
  },
  {
    id: 'token_secret',
    envVars: ['HONOWARDEN_TOKEN_SECRET'],
    owner: 'HonoWarden operator',
    blastRadius:
      'refresh-token hash lookup, legacy no-kid access-token verification, and forced re-login behavior',
    rotationTrigger:
      'suspected refresh-token hash secret exposure or environment compromise',
    dryRunEvidence: [
      'document forced re-login requirement before live rotation',
      'confirm staged access-token keyring can separate access-token signing rotation from refresh-token secret rotation',
    ],
    liveRotationShape: [
      'freeze deploys and record incident/change window',
      'set new HONOWARDEN_TOKEN_SECRET with wrangler secret put',
      'invalidate existing refresh sessions or require forced re-login',
    ],
    verificationCommands: [
      'pnpm exec vitest run test/domain/tokens.test.ts test/app.test.ts',
      'pnpm check',
      'synthetic password grant, refresh grant denial for old sessions, and authenticated sync smoke',
    ],
    rollbackPath:
      'restore the prior secret only if old refresh sessions are intentionally preserved; otherwise continue forced re-login',
  },
  {
    id: 'access_token_keyring',
    envVars: [
      'HONOWARDEN_ACCESS_TOKEN_ACTIVE_KID',
      'HONOWARDEN_ACCESS_TOKEN_ACTIVE_SECRET',
      'HONOWARDEN_ACCESS_TOKEN_PREVIOUS_KEYS',
    ],
    owner: 'HonoWarden operator',
    blastRadius:
      'access-token signing and verification for tokens carrying a JWT kid',
    rotationTrigger:
      'planned staged access-token signing key rotation or suspected signing-key exposure',
    dryRunEvidence: [
      'confirm access-token key rotation runbook exists',
      'confirm unknown kid values fail closed in tests',
    ],
    liveRotationShape: [
      'set new active kid and secret',
      'move the prior active key into HONOWARDEN_ACCESS_TOKEN_PREVIOUS_KEYS',
      'retire previous keys after access-token TTL plus safety window',
    ],
    verificationCommands: [
      'pnpm exec vitest run test/domain/tokens.test.ts test/app.test.ts test/ops/access-token-key-rotation.test.ts',
      'new tokens include the new kid',
      'old previous-key tokens verify only during the approved window',
    ],
    rollbackPath:
      'restore last known-good active kid/secret and previous-key JSON; avoid removing the whole keyring unless legacy fallback is intended',
  },
  {
    id: 'totp_wrapping_secret',
    envVars: [
      'HONOWARDEN_TOTP_SECRET',
      'HONOWARDEN_TOTP_OLD_SECRET',
      'HONOWARDEN_TOTP_NEW_SECRET',
    ],
    owner: 'HonoWarden operator',
    blastRadius:
      'TOTP setup/login for users with encrypted active or pending TOTP secrets',
    rotationTrigger:
      'suspected wrapping-secret exposure or planned TOTP re-enrollment event',
    dryRunEvidence: [
      'run TOTP rotation CLI without --execute against the target mode before any live secret change',
      'confirm dry-run packet redacts mutation SQL and secret values',
    ],
    liveRotationShape: [
      'run pnpm totp:rotate-secret dry-run with old/new local-only inputs',
      'execute rewrap only after ready packet and approval',
      'set runtime HONOWARDEN_TOTP_SECRET after D1 envelopes are rewrapped',
    ],
    verificationCommands: [
      'pnpm exec vitest run test/domain/totp.test.ts test/domain/totp-secret.test.ts test/ops/totp-secret-rotation.test.ts',
      'synthetic TOTP setup/login smoke with redacted evidence',
    ],
    rollbackPath:
      'rewrap in the opposite direction before runtime change; after runtime change restore prior runtime secret and reverse rewrap or restore from backup',
  },
  {
    id: 'cloudflare_scoped_tokens',
    envVars: [
      'CLOUDFLARE_HONOWARDEN_DEPLOY_TOKEN',
      'CLOUDFLARE_HONOWARDEN_DNS_ROUTES_TOKEN',
      'CLOUDFLARE_HONOWARDEN_EMAIL_ROUTING_TOKEN',
      'CLOUDFLARE_HONOWARDEN_D1_R2_TOKEN',
      'CLOUDFLARE_HONOWARDEN_READONLY_TOKEN',
    ],
    owner: 'HonoWarden operator',
    blastRadius:
      'Worker deploys, DNS/routes, Email Routing, D1/R2 operations, and read-only evidence automation',
    rotationTrigger:
      'scheduled token expiration, suspected local env exposure, operator change, or Cloudflare account incident',
    dryRunEvidence: [
      'run pnpm cloudflare:tokens -- apply --auth global without --execute',
      'run pnpm cloudflare:tokens -- verify --strict for current scoped tokens',
    ],
    liveRotationShape: [
      'create replacement scoped tokens with expiration',
      'write one-time values only to the home-directory scoped env file',
      'verify replacements before revoking old tokens',
    ],
    verificationCommands: [
      'pnpm cloudflare:tokens -- verify --strict',
      'command-local wrangler readback using each scoped token class',
    ],
    rollbackPath:
      'keep previous scoped tokens active until replacements verify; if replacement fails, remove only the failed new token and keep read-only default',
  },
  {
    id: 'cloudflare_global_key_break_glass',
    envVars: ['CLOUDFLARE_GLOBAL_API_KEY', 'CLOUDFLARE_API_KEY'],
    owner: 'HonoWarden operator',
    blastRadius:
      'account-wide Cloudflare break-glass mutation fallback; highest operational risk',
    rotationTrigger:
      'after scoped-token adoption, suspected exposure, operator change, or Cloudflare account incident',
    dryRunEvidence: [
      'confirm scoped tokens cover normal operations before using or rotating the global key',
      'confirm break-glass reason, target, rollback, and readback would be recorded before use',
    ],
    liveRotationShape: [
      'use a trusted human browser session to rotate the global key',
      'update only the home-directory cloudflare.env file',
      'run scoped token verification and one global-key readback after rotation',
    ],
    verificationCommands: [
      'pnpm cloudflare:tokens -- verify --strict',
      'Cloudflare user/account readback with redacted account tag only',
    ],
    rollbackPath:
      'global keys cannot be recovered after rotation; keep scoped tokens verified before rotation and avoid using global auth for normal operations',
  },
  {
    id: 'github_token',
    envVars: ['GITHUB_TOKEN'],
    owner: 'HonoWarden operator',
    blastRadius:
      'GitHub repository automation when gh auth is insufficient or unavailable',
    rotationTrigger:
      'suspected exposure, GitHub account incident, or token scope review',
    dryRunEvidence: [
      'confirm gh auth status resolves to the intended operator without printing token values',
      'prefer GitHub CLI keychain auth over a long-lived env token',
    ],
    liveRotationShape: [
      'create a replacement GitHub token with minimum repository scope',
      'update ignored local env or CI secret storage',
      'revoke the old token after gh auth/readback works',
    ],
    verificationCommands: [
      'gh auth status',
      'gh repo view kazu-42/HonoWarden --json nameWithOwner,defaultBranchRef',
    ],
    rollbackPath:
      'restore prior keychain auth if still valid; otherwise pause GitHub writes until a replacement token is verified',
  },
  {
    id: 'linear_api_key',
    envVars: ['LINEAR_API_KEY'],
    owner: 'HonoWarden operator',
    blastRadius:
      'Linear issue, comment, project, and status automation for HonoWarden',
    rotationTrigger:
      'suspected exposure, workspace access change, or operator key review',
    dryRunEvidence: [
      'run pnpm linear:preflight -- --strict',
      'confirm workspace urlKey and HON team readback without printing the key',
    ],
    liveRotationShape: [
      'create a replacement Linear API key from the HonoWarden workspace',
      'update ignored local env storage',
      'run preflight before revoking the old key',
    ],
    verificationCommands: [
      'pnpm linear:preflight -- --strict',
      'read-only GraphQL query for HON team and workflow states',
    ],
    rollbackPath:
      'keep the old key active until the replacement preflight passes; if replacement fails, revoke only the failed new key',
  },
  {
    id: 'email_forwarding_destinations',
    envVars: [
      'HONOWARDEN_SECURITY_FORWARD_TO',
      'HONOWARDEN_SUPPORT_FORWARD_TO',
      'HONOWARDEN_GENERAL_FORWARD_TO',
      'HONOWARDEN_ADMIN_FORWARD_TO',
      'HONOWARDEN_POSTMASTER_FORWARD_TO',
      'HONOWARDEN_ABUSE_FORWARD_TO',
    ],
    owner: 'HonoWarden operator',
    blastRadius:
      'private destination inboxes for public honowarden.com contact aliases',
    rotationTrigger:
      'destination compromise, operator mailbox change, or Email Routing incident',
    dryRunEvidence: [
      'run pnpm email:preflight -- --strict without printing destination values',
      'confirm Cloudflare destination verification out of band',
    ],
    liveRotationShape: [
      'verify new destination addresses in Cloudflare',
      'update Worker secrets or Email Routing actions in a reversible change window',
      'send only harmless route smoke messages and record metadata-only evidence',
    ],
    verificationCommands: [
      'pnpm email:preflight -- --strict',
      'Cloudflare Email Routing route readback with destination values redacted',
    ],
    rollbackPath:
      'restore the prior verified destination or disable only the affected route if delivery cannot be trusted',
  },
]

async function main(argv = process.argv.slice(2), env = process.env) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv
  const [command = 'dry-run', ...rest] = normalizedArgv
  const options = parseOptions(rest)

  if (command !== 'dry-run') {
    printUsage()
    process.exitCode = 1
    return
  }

  const report = buildDryRunReport(env)

  if (options.out) {
    await writeReport(options.out, report)
  }

  writeJson(report)

  if (options.strict && report.status !== 'ready') {
    process.exitCode = 1
  }
}

function parseOptions(argv) {
  const options = {
    out: null,
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

    if (arg === '--out') {
      options.out = requireNext(argv, (index += 1), arg)
      continue
    }

    throw new Error(`Unknown option: ${arg}`)
  }

  return options
}

function buildDryRunReport(env) {
  const generatedAt = new Date().toISOString()
  const classes = secretClasses.map((secretClass) => {
    const envStatus = secretClass.envVars.map((envVar) => ({
      name: envVar,
      configured: isConfigured(env[envVar]),
    }))

    return {
      id: secretClass.id,
      owner: secretClass.owner,
      envStatus,
      blastRadius: secretClass.blastRadius,
      rotationTrigger: secretClass.rotationTrigger,
      dryRunEvidence: secretClass.dryRunEvidence,
      liveRotationShape: secretClass.liveRotationShape,
      verificationCommands: secretClass.verificationCommands,
      rollbackPath: secretClass.rollbackPath,
      status: 'covered',
    }
  })

  return {
    schemaVersion,
    action: 'formal_secret_rotation_dry_run',
    generatedAt,
    status: 'ready',
    mode: 'dry_run',
    liveMutationPerformed: false,
    realSecretRotationPerformed: false,
    classes,
    globalSafetyRules: [
      'Do not print or paste secret values into Linear, GitHub, chat, docs, or shell transcripts.',
      'Record credential classes, hash tags, command shapes, timestamps, and readback status only.',
      'Run read-only or dry-run verification before any live mutation.',
      'Keep old credentials active until replacements verify, except during confirmed compromise.',
      'Use fresh-target restore for backup/data incidents; never restore over alpha production in place.',
    ],
  }
}

async function writeReport(path, report) {
  const resolved = resolve(path)
  await mkdir(dirname(resolved), { recursive: true })
  await writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`)
}

function requireNext(argv, index, option) {
  const value = argv[index]
  if (!value) {
    throw new Error(`${option} requires a value`)
  }

  return value
}

function isConfigured(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function printUsage() {
  process.stderr.write(`Usage:
  node scripts/honowarden-secret-rotation-drill.mjs dry-run [--out PATH] [--strict]
`)
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})

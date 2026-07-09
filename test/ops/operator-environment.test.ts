import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())

const trackedEnvDefaults = [
  'HONOWARDEN_DOMAIN',
  'HONOWARDEN_REPOSITORY_URL',
  'HONOWARDEN_WEBSITE_REPOSITORY_NAME',
  'HONOWARDEN_WEBSITE_REPOSITORY_URL',
  'HONOWARDEN_LINEAR_URL',
  'HONOWARDEN_LINEAR_WORKSPACE_SLUG',
  'HONOWARDEN_CLOUDFLARE_ZONE_NAME',
] as const

const localSecretPlaceholders = [
  'LINEAR_API_KEY',
  'GITHUB_TOKEN',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_API_KEY',
  'CLOUDFLARE_GLOBAL_API_KEY',
  'CLOUDFLARE_EMAIL',
  'CLOUDFLARE_API_EMAIL',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_ZONE_ID_HONOWARDEN_COM',
  'HONOWARDEN_SECURITY_FORWARD_TO',
  'HONOWARDEN_SUPPORT_FORWARD_TO',
  'HONOWARDEN_GENERAL_FORWARD_TO',
  'HONOWARDEN_ADMIN_FORWARD_TO',
  'HONOWARDEN_POSTMASTER_FORWARD_TO',
  'HONOWARDEN_ABUSE_FORWARD_TO',
  'HONOWARDEN_BOOTSTRAP_TOKEN',
  'HONOWARDEN_ACCESS_TOKEN_ACTIVE_KID',
  'HONOWARDEN_ACCESS_TOKEN_ACTIVE_SECRET',
  'HONOWARDEN_ACCESS_TOKEN_PREVIOUS_KEYS',
  'HONOWARDEN_TOKEN_SECRET',
  'HONOWARDEN_TOTP_SECRET',
] as const

describe('operator environment policy', () => {
  it('keeps tracked direnv defaults non-secret and reloadable', () => {
    const envrc = readRepoFile('.envrc')
    const exportedNames = [...envrc.matchAll(/^export\s+([A-Z0-9_]+)=/gm)].map(
      (match) => match[1],
    )

    expect(exportedNames.sort()).toEqual([...trackedEnvDefaults].sort())
    for (const secretName of localSecretPlaceholders) {
      expect(envrc).not.toMatch(new RegExp(`^export\\s+${secretName}=`, 'm'))
    }

    expect(envrc).toContain('watch_file .env.local')
    expect(envrc).toContain('watch_file .envrc.local')
    expect(envrc).toContain('dotenv_if_exists .env.local')
    expect(envrc).toContain('source_env_if_exists .envrc.local')
  })

  it('keeps local secret files ignored and example placeholders empty', () => {
    const gitignore = readRepoFile('.gitignore')
    const envExample = readRepoFile('.env.example')

    expect(gitignore).toContain('.env')
    expect(gitignore).toContain('.env.*')
    expect(gitignore).toContain('!.env.example')
    expect(gitignore).toContain('*.local')
    expect(gitignore).toContain('.dev.vars')

    for (const secretName of localSecretPlaceholders) {
      expect(envExample).toMatch(new RegExp(`^${secretName}=$`, 'm'))
    }
  })

  it('documents external write gates for local operator automation', () => {
    const operatorDocs = readRepoFile('docs/operations/operator-environment.md')

    expect(operatorDocs).toContain('direnv Setup')
    expect(operatorDocs).toContain('LINEAR_API_KEY')
    expect(operatorDocs).toContain('CLOUDFLARE_API_TOKEN')
    expect(operatorDocs).toContain('Cloudflare Access-Control Review')
    expect(operatorDocs).toContain('External Write Gates')
    expect(operatorDocs).toContain('Current Linear Access')
  })

  it('documents Cloudflare account access review without secret values', () => {
    const accessReview = readRepoFile(
      'docs/operations/cloudflare-access-control.md',
    )

    expect(accessReview).toContain('Status: reviewed')
    expect(accessReview).toContain('Redacted Readback')
    expect(accessReview).toContain('Super Administrator - All Privileges')
    expect(accessReview).toContain('Least-Privilege Token Plan')
    expect(accessReview).toContain('Break-Glass Process')
    expect(accessReview).toContain('Stale Credential Decision')
    expect(accessReview).toContain('Review Cadence And Owner')
    expect(accessReview).toContain('HON-64')
    expect(accessReview).toContain('HON-60')
    expect(accessReview).toContain('global key')
    expect(accessReview).not.toContain('X-Auth-Key')
    expect(accessReview).not.toContain('CLOUDFLARE_GLOBAL_API_KEY=')
    expect(accessReview).not.toMatch(
      /[A-Z0-9._%+-]+@(?!honowarden\.com\b)[A-Z0-9.-]+\.[A-Z]{2,}/i,
    )
  })
})

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}

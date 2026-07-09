import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const scriptPath = join(
  repoRoot,
  'scripts/honowarden-cloudflare-token-remediation.mjs',
)

describe('Cloudflare scoped token remediation', () => {
  it('plans scoped tokens without printing configured secret values', () => {
    const secretValues = {
      CLOUDFLARE_GLOBAL_API_KEY: 'secret_global_key_should_not_print',
      CLOUDFLARE_API_EMAIL: 'operator@example.test',
    }
    const output = execFileSync(
      process.execPath,
      [
        scriptPath,
        'plan',
        '--secrets-out',
        '~/.config/honowarden/cloudflare-scoped.env',
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          ...secretValues,
          CLOUDFLARE_API_TOKEN: '',
          CLOUDFLARE_ACCOUNT_ID: 'account_id_for_test',
          CLOUDFLARE_ZONE_ID_HONOWARDEN_COM: 'zone_id_for_test',
        },
      },
    )
    const report = JSON.parse(output)

    expect(report).toMatchObject({
      action: 'cloudflare_token_remediation_plan',
      status: 'ready',
      executeRequiredForMutation: true,
      secretsOut: '~/.config/honowarden/cloudflare-scoped.env',
    })
    expect(report.tokenClasses).toHaveLength(5)
    expect(output).toContain('CLOUDFLARE_HONOWARDEN_DEPLOY_TOKEN')
    expect(output).toContain('CLOUDFLARE_HONOWARDEN_READONLY_TOKEN')
    expect(output).not.toContain(secretValues.CLOUDFLARE_GLOBAL_API_KEY)
    expect(output).not.toContain(secretValues.CLOUDFLARE_API_EMAIL)
  })

  it('documents the scoped-token workflow and non-automated 2FA boundary', () => {
    const accessReview = readRepoFile(
      'docs/operations/cloudflare-access-control.md',
    )
    const operatorDocs = readRepoFile('docs/operations/operator-environment.md')
    const envExample = readRepoFile('.env.example')
    const packageJson = JSON.parse(readRepoFile('package.json'))

    expect(packageJson.scripts['cloudflare:tokens']).toBe(
      'node scripts/honowarden-cloudflare-token-remediation.mjs',
    )
    for (const envVar of [
      'CLOUDFLARE_HONOWARDEN_DEPLOY_TOKEN',
      'CLOUDFLARE_HONOWARDEN_DNS_ROUTES_TOKEN',
      'CLOUDFLARE_HONOWARDEN_EMAIL_ROUTING_TOKEN',
      'CLOUDFLARE_HONOWARDEN_D1_R2_TOKEN',
      'CLOUDFLARE_HONOWARDEN_READONLY_TOKEN',
    ]) {
      expect(envExample).toMatch(new RegExp(`^${envVar}=$`, 'm'))
      expect(accessReview).toContain(envVar)
    }

    expect(accessReview).toContain('Scoped Token Remediation Workflow')
    expect(accessReview).toContain(
      'Account-level 2FA enforcement is intentionally not automated',
    )
    expect(operatorDocs).toContain('~/.config/honowarden/cloudflare-scoped.env')
    expect(operatorDocs).toContain('pnpm cloudflare:tokens -- verify')
  })
})

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}

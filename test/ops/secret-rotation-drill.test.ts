import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const scriptPath = join(
  repoRoot,
  'scripts/honowarden-secret-rotation-drill.mjs',
)

type DrillPacket = {
  schemaVersion: number
  action: string
  status: string
  mode: string
  liveMutationPerformed: boolean
  realSecretRotationPerformed: boolean
  classes: Array<{
    id: string
    envStatus: Array<{
      name: string
      configured: boolean
    }>
    status: string
    verificationCommands: string[]
    rollbackPath: string
  }>
  globalSafetyRules: string[]
}

describe('formal secret rotation drill', () => {
  it('emits a ready dry-run packet without printing secret values', () => {
    const env = {
      ...process.env,
      HONOWARDEN_TOKEN_SECRET: 'test_token_secret_should_not_print',
      HONOWARDEN_ACCESS_TOKEN_ACTIVE_SECRET:
        'test_access_secret_should_not_print',
      HONOWARDEN_TOTP_SECRET: 'test_totp_secret_should_not_print',
      CLOUDFLARE_GLOBAL_API_KEY: 'test_global_key_should_not_print',
      CLOUDFLARE_API_KEY: 'test_legacy_key_should_not_print',
      CLOUDFLARE_HONOWARDEN_READONLY_TOKEN:
        'test_readonly_token_should_not_print',
      GITHUB_TOKEN: 'test_github_token_should_not_print',
      LINEAR_API_KEY: 'test_linear_key_should_not_print',
      HONOWARDEN_SECURITY_FORWARD_TO: 'operator@example.test',
    }

    const output = execFileSync(
      process.execPath,
      [scriptPath, 'dry-run', '--strict'],
      {
        encoding: 'utf8',
        env,
      },
    )
    const packet = JSON.parse(output) as DrillPacket

    expect(packet).toMatchObject({
      schemaVersion: 1,
      action: 'formal_secret_rotation_dry_run',
      status: 'ready',
      mode: 'dry_run',
      liveMutationPerformed: false,
      realSecretRotationPerformed: false,
    })
    expect(packet.classes.map((entry) => entry.id)).toEqual([
      'bootstrap_token',
      'token_secret',
      'access_token_keyring',
      'totp_wrapping_secret',
      'cloudflare_scoped_tokens',
      'cloudflare_global_key_break_glass',
      'github_token',
      'linear_api_key',
      'email_forwarding_destinations',
    ])
    expect(packet.classes.every((entry) => entry.status === 'covered')).toBe(
      true,
    )
    expect(
      packet.classes.every(
        (entry) =>
          entry.verificationCommands.length > 0 &&
          entry.rollbackPath.trim().length > 0,
      ),
    ).toBe(true)
    expect(output).toContain('HONOWARDEN_TOKEN_SECRET')
    for (const secretValue of Object.values(env)) {
      if (secretValue?.includes('should_not_print')) {
        expect(output).not.toContain(secretValue)
      }
    }
    expect(output).not.toContain('operator@example.test')
  })

  it('writes the same redacted packet to an evidence path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'honowarden-secret-drill-'))
    const outPath = join(dir, 'packet.json')
    const output = execFileSync(
      process.execPath,
      [scriptPath, '--', 'dry-run', '--strict', '--out', outPath],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          HONOWARDEN_BOOTSTRAP_TOKEN: 'bootstrap_should_not_print',
        },
      },
    )

    const stdoutPacket = JSON.parse(output) as DrillPacket
    const filePacket = JSON.parse(readFileSync(outPath, 'utf8')) as DrillPacket

    expect(filePacket).toEqual(stdoutPacket)
    expect(output).not.toContain('bootstrap_should_not_print')
    expect(readFileSync(outPath, 'utf8')).not.toContain(
      'bootstrap_should_not_print',
    )
  })

  it('documents the dry-run boundary without claiming live rotation', () => {
    const packageJson = JSON.parse(readRepoFile('package.json')) as {
      scripts: Record<string, string>
    }
    const runbook = readRepoFile('docs/operations/secret-rotation-drill.md')
    const evidence = readRepoFile(
      'docs/release/secret-rotation-drill-evidence.md',
    )
    const secretsInventory = readRepoFile('docs/security/secrets-inventory.md')
    const knownLimitations = readRepoFile('docs/security/known-limitations.md')
    const reviewIndex = readRepoFile('docs/security/review-index.md')
    const currentState = readRepoFile('docs/current-state.md')

    expect(packageJson.scripts['secret:rotation:drill']).toBe(
      'node scripts/honowarden-secret-rotation-drill.mjs',
    )
    expect(runbook).toContain('Status: dry-run-supported')
    expect(runbook).toContain('No real production secret value was rotated')
    expect(runbook).toContain('pnpm secret:rotation:drill -- dry-run --strict')
    expect(evidence).toContain('Status: passed dry-run')
    expect(evidence).toContain('No live mutation')
    expect(secretsInventory).toContain('Formal Secret Rotation Drill')
    expect(knownLimitations).toMatch(
      /formal secret\s+rotation\s+dry-run evidence exists/,
    )
    expect(reviewIndex).toContain('Secret Rotation Drill Evidence')
    expect(currentState).toContain('Week 26 Formal Secret Rotation Dry-Run')
    expect(currentState).not.toContain('no formal secret rotation drill')
  })
})

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}

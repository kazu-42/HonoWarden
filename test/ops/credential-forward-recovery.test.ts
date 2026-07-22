import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const forwardRecoveryScript = join(
  repoRoot,
  'scripts/honowarden-credential-forward-recovery.mjs',
)
const credentialLifecycleScript = join(
  repoRoot,
  'scripts/honowarden-credential-lifecycle.mjs',
)
const credentialRestoreLifecycleScript = join(
  repoRoot,
  'scripts/honowarden-credential-restore-lifecycle.mjs',
)

describe('credential forward-recovery lifecycle', () => {
  it('plans one same-target disabled proof and forward generation without secrets', async () => {
    const result = await execFileAsync(
      'node',
      [
        forwardRecoveryScript,
        'plan',
        '--at',
        '2026-07-22T00:00:00.000Z',
        '--run-root',
        'test/.tmp/hon-226-plan',
      ],
      { cwd: repoRoot, timeout: 10_000 },
    )
    const packet = JSON.parse(result.stdout)

    expect(packet).toMatchObject({
      schemaVersion: 1,
      action: 'plan',
      generatedAt: '2026-07-22T00:00:00.000Z',
      executed: false,
      status: 'planned',
      mode: 'wrangler-local-restored-target-forward-recovery-official-cli-synthetic',
      runRoot: 'test/.tmp/hon-226-plan',
      sequence: [
        'complete_generation_bound_fresh_restore',
        'capture_canonical_d1_r2_identity',
        'reject_four_disabled_writers_before_auth_or_d1',
        'compare_identity_after_every_disabled_request',
        'reenable_same_target_without_reset',
        'commit_exactly_one_forward_password_generation',
        'reject_retry_and_all_prior_generations',
        'verify_official_cli_decrypt_after_restart',
        'bounded_cleanup',
      ],
      safety: {
        localSyntheticOnly: true,
        sameRestoredTargetRequired: true,
        canonicalIdentityRequired: true,
        remoteResourcesAllowed: false,
        realCredentialsAllowed: false,
        deploymentAllowed: false,
        printsSecrets: false,
        trackedSecretEvidenceAllowed: false,
      },
    })
    expect(packet.next.command).toContain(
      '--execute --confirm credential-forward-recovery',
    )
    expect(result.stdout).not.toMatch(
      /masterPassword|authenticationHash|wrappedUserKey|access_token|refresh_token|BW_SESSION/,
    )
  })

  it('does not reflect rejected option values to stderr', async () => {
    const secretLikeOption = '--do-not-reflect-private-input'
    let rejected: unknown

    try {
      await execFileAsync(
        'node',
        [forwardRecoveryScript, 'plan', secretLikeOption],
        { cwd: repoRoot, timeout: 10_000 },
      )
    } catch (error) {
      rejected = error
    }

    expect(rejected).toMatchObject({
      code: 1,
      stderr: 'unknown credential forward-recovery option\n',
    })
    expect((rejected as { stderr: string }).stderr).not.toContain(
      secretLikeOption,
    )
  })

  it('wires the package command and official forward stage', async () => {
    const [
      packageSource,
      harnessSource,
      lifecycleSource,
      harnessDocs,
      currentState,
    ] = await Promise.all([
      readFile(join(repoRoot, 'package.json'), 'utf8'),
      readFile(
        join(repoRoot, 'scripts/honowarden-official-client-harness.mjs'),
        'utf8',
      ),
      readFile(credentialLifecycleScript, 'utf8'),
      readFile(
        join(repoRoot, 'docs/operations/official-client-credential-harness.md'),
        'utf8',
      ),
      readFile(join(repoRoot, 'docs/current-state.md'), 'utf8'),
    ])
    const packageJson = JSON.parse(packageSource)

    expect(packageJson.scripts['account:credential-forward-recovery']).toBe(
      'node scripts/honowarden-credential-forward-recovery.mjs',
    )
    expect(harnessSource).toContain('id: "forward_recovery"')
    expect(harnessSource).toContain('passwords.forwardRecovery')
    expect(lifecycleSource).toContain('rejectPriorProfiles')
    expect(lifecycleSource).toContain(
      'rejectedProfilesAfterRestart === recoveryContext.stale.length + 1',
    )
    expect(lifecycleSource).not.toContain(
      "check('all_five_prior_generations_remain_rejected', true)",
    )
    expect(harnessDocs).toContain('account:credential-forward-recovery')
    expect(harnessDocs).toContain('same restored target')
    expect(harnessDocs).toContain('HON-226')
    expect(currentState).toContain('Disabled Writers And Forward Recovery')
    expect(currentState).toContain('canonical D1/R2 identity')
  })

  it('fails closed when canonical D1 or R2 identity changes', async () => {
    const { assertPersistenceIdentityUnchanged } = await import(
      pathToFileURL(credentialLifecycleScript).href
    )
    const baseline = {
      d1Sha256: 'a'.repeat(64),
      r2Sha256: 'b'.repeat(64),
      combinedSha256: 'c'.repeat(64),
    }

    expect(() =>
      assertPersistenceIdentityUnchanged(baseline, baseline, 'account keys'),
    ).not.toThrow()
    expect(() =>
      assertPersistenceIdentityUnchanged(
        baseline,
        { ...baseline, d1Sha256: 'd'.repeat(64) },
        'password change',
      ),
    ).toThrow('password change changed canonical D1/R2 identity')
    expect(() =>
      assertPersistenceIdentityUnchanged(
        baseline,
        { ...baseline, r2Sha256: 'invalid' },
        'KDF mutation',
      ),
    ).toThrow('KDF mutation canonical persistence identity was invalid')
  })

  it('binds the backup to the exact completed lifecycle manifest', async () => {
    const { assertGenerationBoundExportPacket } = await import(
      pathToFileURL(credentialRestoreLifecycleScript).href
    )
    const lifecycleManifestSha256 = 'a'.repeat(64)
    const packet = {
      action: 'export',
      executed: true,
      audit: { resultStatus: 'executed' },
    }
    const manifest = {
      credentialGeneration: {
        lifecycleManifestSha256,
        manifestSha256: 'b'.repeat(64),
        sourceStateSha256: 'c'.repeat(64),
      },
      d1: { sha256: 'd'.repeat(64) },
      r2: { objects: [{ sha256: 'e'.repeat(64) }] },
    }

    expect(() =>
      assertGenerationBoundExportPacket(
        packet,
        manifest,
        lifecycleManifestSha256,
      ),
    ).not.toThrow()
    expect(() =>
      assertGenerationBoundExportPacket(packet, manifest, 'f'.repeat(64)),
    ).toThrow('generation-bound export lifecycle digest mismatch')
  })
})

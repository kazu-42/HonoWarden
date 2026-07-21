import { execFile } from 'node:child_process'
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import {
  matchesUserKeyRotationCredentialGeneration,
  parseUserKeyRotationBody,
} from '../../src/domain/user-key-rotation'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const lifecycleScript = join(
  repoRoot,
  'scripts/honowarden-credential-lifecycle.mjs',
)
const lifecycleStateScript = join(
  repoRoot,
  'scripts/honowarden-credential-lifecycle-state.mjs',
)
const restoreLifecycleScript = join(
  repoRoot,
  'scripts/honowarden-credential-restore-lifecycle.mjs',
)
const browserReadbackScript = join(
  repoRoot,
  'scripts/honowarden-browser-extension-readback.mjs',
)

describe('aggregate official-client credential lifecycle', () => {
  it('plans one same-account forward generation chain without secret output', async () => {
    const result = await execFileAsync(
      'node',
      [
        lifecycleScript,
        'plan',
        '--at',
        '2026-07-20T12:00:00.000Z',
        '--harness-root',
        'test/.tmp/hon-207-official-client',
      ],
      {
        cwd: repoRoot,
        timeout: 10_000,
      },
    )
    const packet = JSON.parse(result.stdout)

    expect(packet).toMatchObject({
      schemaVersion: 1,
      action: 'plan',
      generatedAt: '2026-07-20T12:00:00.000Z',
      executed: false,
      status: 'planned',
      mode: 'wrangler-local-d1-r2-official-cli-synthetic',
      harnessRoot: 'test/.tmp/hon-207-official-client',
      stages: [
        { id: 'baseline', kdf: 'pbkdf2', userKeyGeneration: 1 },
        { id: 'account_keys', kdf: 'pbkdf2', userKeyGeneration: 1 },
        { id: 'password_change', kdf: 'pbkdf2', userKeyGeneration: 1 },
        { id: 'argon2id', kdf: 'argon2id', userKeyGeneration: 1 },
        { id: 'pbkdf2_return', kdf: 'pbkdf2', userKeyGeneration: 1 },
        { id: 'user_key_rotation', kdf: 'pbkdf2', userKeyGeneration: 2 },
        {
          id: 'restart_readback',
          kdf: 'pbkdf2',
          userKeyGeneration: 2,
        },
      ],
      safety: {
        productionSupported: false,
        remoteResourcesAllowed: false,
        realCredentialsAllowed: false,
        normalBrowserProfileAllowed: false,
        printsSecrets: false,
      },
    })
    expect(packet.next.command).toContain(
      '--execute --confirm credential-lifecycle',
    )
    expect(result.stdout).not.toMatch(
      /masterPassword|authenticationHash|wrappedUserKey|BW_SESSION/,
    )
  })

  it('keeps the implementation wired to the official harness and package command', async () => {
    const [scriptSource, restoreSource, packageSource] = await Promise.all([
      readFile(lifecycleScript, 'utf8'),
      readFile(restoreLifecycleScript, 'utf8'),
      readFile(join(repoRoot, 'package.json'), 'utf8'),
    ])
    const packageJson = JSON.parse(packageSource)

    expect(packageJson.scripts['account:credential-lifecycle']).toBe(
      'node scripts/honowarden-credential-lifecycle.mjs',
    )
    expect(packageJson.scripts['account:credential-restore:lifecycle']).toBe(
      'node scripts/honowarden-credential-restore-lifecycle.mjs',
    )
    expect(scriptSource).toContain('generateOfficialCredentialFixture')
    expect(scriptSource).toContain('runOfficialCli')
    expect(scriptSource).toContain('readGenerationSnapshot')
    expect(scriptSource).toContain('assertStaleProfileRejected')
    expect(scriptSource).toContain('snapshotRecoveryProfile')
    expect(scriptSource).toContain('cloneOfficialProfile')
    expect(scriptSource).toContain('requireRecoveryProfile')
    expect(scriptSource).toContain('generationManifestSha256')
    expect(scriptSource.indexOf('const baselineState')).toBeLessThan(
      scriptSource.indexOf('const accountKeys = await postAccountKeys'),
    )
    expect(scriptSource).toContain('expectAccountKeys: false')
    expect(scriptSource).toContain('executeCredentialLifecycleForRecovery')
    expect(scriptSource).toContain('verifyRestoredCredentialGeneration')
    expect(scriptSource).not.toContain("'/api/profile'")
    expect(restoreSource).toContain(
      'assertCredentialLifecycleCompletionAttestation',
    )
    expect(restoreSource).toContain('--expected-generation-manifest-sha256')
  })

  it('plans a verified fresh-target restore without secret output', async () => {
    const result = await execFileAsync(
      'node',
      [
        restoreLifecycleScript,
        'plan',
        '--at',
        '2026-07-21T00:00:00.000Z',
        '--run-root',
        'test/.tmp/hon-225-plan',
      ],
      { cwd: repoRoot, timeout: 10_000 },
    )
    const packet = JSON.parse(result.stdout)

    expect(packet).toMatchObject({
      schemaVersion: 1,
      action: 'plan',
      generatedAt: '2026-07-21T00:00:00.000Z',
      executed: false,
      status: 'planned',
      mode: 'wrangler-local-generation-bound-fresh-restore-official-cli-synthetic',
      runRoot: 'test/.tmp/hon-225-plan',
      sequence: [
        'complete_source_generation',
        'attest_source_state',
        'export_generation_bound_backup',
        'claim_fresh_target',
        'restore_and_compare_d1_r2',
        'reject_stale_generations',
        'verify_current_official_client',
        'restart_and_repeat',
        'bounded_cleanup',
      ],
      safety: {
        localSyntheticOnly: true,
        verifiedFreshTargetRequired: true,
        generationApprovalPinsRequired: true,
        sourceTargetSeparationRequired: true,
        remoteResourcesAllowed: false,
        realCredentialsAllowed: false,
        deploymentAllowed: false,
        printsSecrets: false,
        trackedSecretEvidenceAllowed: false,
      },
    })
    expect(packet.next.command).toContain(
      '--execute --confirm credential-restore-lifecycle',
    )
    expect(result.stdout).not.toMatch(
      /masterPassword|authenticationHash|wrappedUserKey|access_token|refresh_token|BW_SESSION/,
    )
  })

  it('fails closed on unsafe restore lifecycle execution and packet fields', async () => {
    await expect(
      execFileAsync(
        'node',
        [
          restoreLifecycleScript,
          'run',
          '--run-root',
          'test/.tmp/hon-225-invalid-run',
        ],
        { cwd: repoRoot, timeout: 10_000 },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('run requires --execute'),
    })
    await expect(
      execFileAsync(
        'node',
        [
          restoreLifecycleScript,
          'plan',
          '--run-root',
          'test/.tmp/nested/hon-225-invalid',
        ],
        { cwd: repoRoot, timeout: 10_000 },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        '--run-root must be one direct child of test/.tmp',
      ),
    })

    const { assertSecretSafePacket } = await import(
      pathToFileURL(restoreLifecycleScript).href
    )
    expect(() =>
      assertSecretSafePacket({ nested: { access_token: 'private' } }),
    ).toThrow('credential restore packet contained a secret field')
  })

  it('plans an optional isolated Chrome for Testing closeout gate', async () => {
    const executable =
      '/tmp/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
    const result = await execFileAsync(
      'node',
      [
        lifecycleScript,
        'plan',
        '--browser-executable',
        executable,
        '--at',
        '2026-07-20T12:00:00.000Z',
      ],
      {
        cwd: repoRoot,
        timeout: 10_000,
      },
    )
    const packet = JSON.parse(result.stdout)

    expect(packet.browserExtension).toEqual({
      requested: true,
      host: 'chrome-for-testing',
      freshProfileRequired: true,
    })
    expect(packet.next.command).toContain(
      `--browser-executable '${executable}'`,
    )
    expect(packet.safety.normalBrowserProfileAllowed).toBe(false)
  })

  it('fails closed when browser route or decrypted-field evidence is incomplete', async () => {
    const {
      categorizeConsoleMessage,
      classifyBrowserDiagnostics,
      classifyBrowserRuntimeExceptions,
      validateBrowserExtensionEvidence,
    } = await import(pathToFileURL(browserReadbackScript).href)
    const evidence = completeBrowserEvidence()

    expect(validateBrowserExtensionEvidence(evidence)).toEqual({
      requiredRouteCount: 5,
      decryptedFieldCount: 6,
      runtimeExceptionCount: 0,
    })
    expect(() =>
      validateBrowserExtensionEvidence({
        ...evidence,
        routeStatuses: {
          ...evidence.routeStatuses,
          '/api/sync': [503],
        },
      }),
    ).toThrow('official browser route /api/sync did not return 200')
    expect(() =>
      validateBrowserExtensionEvidence({
        ...evidence,
        decryptedFields: {
          ...evidence.decryptedFields,
          attachmentFileName: false,
        },
      }),
    ).toThrow('official browser did not decrypt attachmentFileName')
    expect(() =>
      validateBrowserExtensionEvidence({
        ...evidence,
        runtimeExceptions: ['synthetic runtime failure'],
      }),
    ).toThrow('official browser emitted a runtime exception')

    const hostException = {
      surface: 'background',
      description:
        'Error: Could not establish connection. Receiving end does not exist.',
      url: 'chrome-extension://fixture/background.js',
    }
    expect(classifyBrowserRuntimeExceptions([hostException])).toEqual({
      expectedHostIntegration: [hostException],
      unexpected: [],
    })
    expect(
      classifyBrowserRuntimeExceptions([
        { ...hostException, surface: 'popup' },
        {
          ...hostException,
          description: `${hostException.description} unexpected suffix`,
        },
      ]),
    ).toMatchObject({
      expectedHostIntegration: [],
      unexpected: [{ surface: 'popup' }, { surface: 'background' }],
    })
    const blockedBootstrapFrame = {
      surface: 'background',
      description: 'Error: Frame with ID 0 is showing error page',
      text: 'Uncaught (in promise)',
      url: 'chrome-extension://fixture/background.js',
    }
    expect(
      classifyBrowserRuntimeExceptions([blockedBootstrapFrame]),
    ).toMatchObject({
      expectedHostIntegration: [],
      unexpected: [blockedBootstrapFrame],
    })
    expect(
      classifyBrowserRuntimeExceptions([blockedBootstrapFrame], {
        allowBlockedBootstrapFrame: true,
      }),
    ).toMatchObject({
      expectedHostIntegration: [blockedBootstrapFrame],
      unexpected: [],
    })
    expect(
      categorizeConsoleMessage(
        'Unchecked runtime.lastError: No tab with id: 12345.',
      ),
    ).toBe('closed_bootstrap_tab')
    expect(
      categorizeConsoleMessage(
        'Unchecked runtime.lastError: No tab with id: 12345. unexpected',
      ),
    ).toBe('unknown')
    const localOrigin = 'https://localhost:43123'
    const upstreamApiOrigin = pinnedUpstreamApiOrigin()
    expect(
      categorizeConsoleMessage(
        "WebSocket connection to 'wss://localhost:43123/notifications/hub?access_token=synthetic' failed:",
        localOrigin,
      ),
    ).toBe('notifications_websocket_failure')
    expect(
      categorizeConsoleMessage(
        "WebSocket connection to 'wss://external.example/notifications/hub?access_token=synthetic' failed:",
        localOrigin,
      ),
    ).toBe('unknown')
    expect(
      categorizeConsoleMessage(
        `Unable to fetch ServerConfig from ${upstreamApiOrigin} TypeError: Failed to fetch\n    at synthetic`,
        localOrigin,
      ),
    ).toBe('server_config_fetch_failure')
    expect(
      categorizeConsoleMessage(
        `Unable to fetch ServerConfig from ${upstreamApiOrigin} Error: request failed`,
        localOrigin,
      ),
    ).toBe('unknown')
    const signalRStartFailure =
      '[SignalR] Failed to start the connection: Error: WebSocket failed to connect. The connection could not be found on the server, either the endpoint may not be a SignalR endpoint, the connection ID is not present on the server, or there is a proxy blocking WebSockets. If you have multiple servers check that sticky sessions are enabled.'
    expect(categorizeConsoleMessage(signalRStartFailure, localOrigin)).toBe(
      'notifications_signalr_start_failure',
    )
    expect(
      categorizeConsoleMessage(
        `${signalRStartFailure} unexpected`,
        localOrigin,
      ),
    ).toBe('unknown')
    expect(
      categorizeConsoleMessage(
        'Failed to set badge state Error: No tab with id: 1963437702.',
        localOrigin,
      ),
    ).toBe('closed_browser_tab_badge_state')
    expect(
      categorizeConsoleMessage(
        'Failed to set badge state Error: No tab with id: synthetic.',
        localOrigin,
      ),
    ).toBe('unknown')

    const diagnostics = knownBrowserDiagnostics()
    expect(classifyBrowserDiagnostics(diagnostics)).toMatchObject({
      expectedHostIntegration: {
        consoleErrors: expect.arrayContaining(diagnostics.consoleErrors),
        loadingFailures: expect.arrayContaining(diagnostics.loadingFailures),
        nonSuccessResponses: [],
      },
      unexpected: [],
    })
    expect(
      classifyBrowserDiagnostics({
        ...diagnostics,
        loadingFailures: [
          ...diagnostics.loadingFailures,
          {
            errorText: 'net::ERR_FAILED',
            location: '/api/sync',
            surface: 'background',
            type: 'Fetch',
          },
        ],
      }),
    ).toMatchObject({
      unexpected: [{ location: '/api/sync' }],
    })
    expect(
      classifyBrowserDiagnostics({
        ...diagnostics,
        consoleErrors: [
          ...diagnostics.consoleErrors,
          {
            category: 'resource_load_failure',
            location: 'chrome-extension://[extension]/background.js',
            messageSha256: 'c'.repeat(64),
            surface: 'background',
          },
        ],
      }),
    ).toMatchObject({
      unexpected: [
        {
          kind: 'console_error',
          surface: 'background',
        },
      ],
    })
    expect(
      classifyBrowserDiagnostics({
        ...diagnostics,
        loadingFailures: diagnostics.loadingFailures.map((entry) =>
          entry.location === '/notifications/hub'
            ? { ...entry, errorText: 'net::ERR_CONNECTION_REFUSED' }
            : entry,
        ),
      }),
    ).toMatchObject({
      unexpected: expect.arrayContaining([
        expect.objectContaining({
          category: 'notifications_signalr_start_failure',
          kind: 'console_error',
        }),
        expect.objectContaining({
          errorText: 'net::ERR_CONNECTION_REFUSED',
          kind: 'loading_failure',
          location: '/notifications/hub',
        }),
      ]),
    })
    expect(
      classifyBrowserDiagnostics({
        ...diagnostics,
        consoleErrors: diagnostics.consoleErrors.map((entry) =>
          entry.category === 'closed_bootstrap_tab'
            ? { ...entry, source: 'console-api' }
            : entry,
        ),
      }),
    ).toMatchObject({
      unexpected: [
        {
          category: 'closed_bootstrap_tab',
          source: 'console-api',
        },
      ],
    })
  })

  it('rejects stderr from every successful official CLI command', async () => {
    const { assertOfficialCommandSuccess } = await import(
      pathToFileURL(lifecycleScript).href
    )
    const cleanResult = {
      exitCode: 0,
      timedOut: false,
      stderr: { bytes: 0 },
    }

    expect(() =>
      assertOfficialCommandSuccess(cleanResult, 'clean login'),
    ).not.toThrow()
    expect(() =>
      assertOfficialCommandSuccess(
        {
          ...cleanResult,
          stderr: { bytes: 84 },
        },
        'noisy login',
      ),
    ).toThrow('noisy login emitted unexpected stderr')
    expect(() =>
      assertOfficialCommandSuccess(
        {
          ...cleanResult,
          configuration: {
            read: {
              ...cleanResult,
              stderr: { bytes: 12 },
            },
            write: null,
          },
        },
        'nested read',
      ),
    ).toThrow('nested read configuration read emitted unexpected stderr')
    expect(() =>
      assertOfficialCommandSuccess(
        {
          ...cleanResult,
          configuration: {
            read: cleanResult,
            write: {
              ...cleanResult,
              stderr: { bytes: 7 },
            },
          },
        },
        'nested write',
      ),
    ).toThrow('nested write configuration write emitted unexpected stderr')
  })

  it('namespaces every official CLI profile per lifecycle run', async () => {
    const {
      buildCredentialLifecycleProfiles,
      buildRestoredStaleProfileName,
      validateRecoveryOfficialOrigin,
    } = await import(pathToFileURL(lifecycleScript).href)
    const first = buildCredentialLifecycleProfiles('a'.repeat(12))
    const second = buildCredentialLifecycleProfiles('b'.repeat(12))

    expect(Object.keys(first)).toEqual([
      'baseline',
      'accountKeys',
      'passwordChange',
      'passwordChangeRestart',
      'argon2id',
      'argon2idRestart',
      'pbkdf2Return',
      'pbkdf2ReturnRestart',
      'userKeyRotation',
      'restartReadback',
    ])
    expect(new Set(Object.values(first)).size).toBe(10)
    expect(
      Object.values(first).some((profile) =>
        Object.values(second).includes(profile),
      ),
    ).toBe(false)
    expect(() => buildCredentialLifecycleProfiles('../shared-profile')).toThrow(
      'credential lifecycle run id was invalid',
    )
    const restoredNames = [0, 1, 2, 3].flatMap((index) =>
      ['before-restart', 'after-restart'].map((phase) =>
        buildRestoredStaleProfileName('c'.repeat(12), index, phase),
      ),
    )
    expect(new Set(restoredNames).size).toBe(8)
    expect(restoredNames.every((name) => name.length <= 64)).toBe(true)
    expect(() =>
      buildRestoredStaleProfileName('c'.repeat(12), 4, 'before-restart'),
    ).toThrow('restored stale profile coordinates were invalid')
    expect(validateRecoveryOfficialOrigin('https://localhost:32123')).toEqual({
      origin: 'https://localhost:32123',
      port: 32123,
    })
    for (const origin of [
      'http://localhost:32123',
      'https://127.0.0.1:32123',
      'https://localhost',
      'https://example.com:32123',
    ]) {
      expect(() => validateRecoveryOfficialOrigin(origin)).toThrow()
    }
  })

  it('builds a complete rotation request accepted by the domain parser', async () => {
    const { normalizeCredentialMaterial, userKeyRotationBody } = await import(
      pathToFileURL(lifecycleScript).href
    )
    const current = credentialStage('current', 1)
    const next = credentialStage('next', 2)
    const parsed = parseUserKeyRotationBody(
      userKeyRotationBody('hon220@example.invalid', current, next),
    )

    expect(parsed).toMatchObject({
      ok: true,
      credentialMetadata: {
        salt: 'hon220@example.invalid',
        kdf: {
          kdfType: 0,
          iterations: 600000,
          memory: null,
          parallelism: null,
        },
      },
      folders: [{ id: '22000000-0000-4220-8220-000000000002' }],
      ciphers: [{ id: '22000000-0000-4220-8220-000000000003' }],
    })
    expect(
      parsed.ok &&
        matchesUserKeyRotationCredentialGeneration(parsed, {
          emailNormalized: 'hon220@example.invalid',
          kdfAlgorithm: 'pbkdf2-sha256',
          kdfIterations: 600000,
          kdfMemory: null,
          kdfParallelism: null,
          userKey: current.masterKeyEncryptedUserKey,
          publicKey: current.accountKeys.accountPublicKey,
          privateKey: current.accountKeys.userKeyEncryptedAccountPrivateKey,
        }),
    ).toBe(true)

    const staleWrappedBody = userKeyRotationBody(
      'hon220@example.invalid',
      next,
      current,
    )
    const staleWrappedParsed = parseUserKeyRotationBody(staleWrappedBody)
    expect(staleWrappedBody.oldMasterKeyAuthenticationHash).toBe(
      next.masterPasswordAuthenticationHash,
    )
    expect(staleWrappedParsed).toMatchObject({ ok: true })
    expect(
      staleWrappedParsed.ok &&
        matchesUserKeyRotationCredentialGeneration(staleWrappedParsed, {
          emailNormalized: 'hon220@example.invalid',
          kdfAlgorithm: 'pbkdf2-sha256',
          kdfIterations: 600000,
          kdfMemory: null,
          kdfParallelism: null,
          userKey: next.masterKeyEncryptedUserKey,
          publicKey: next.accountKeys.accountPublicKey,
          privateKey: next.accountKeys.userKeyEncryptedAccountPrivateKey,
        }),
    ).toBe(true)

    const officialFixture = process.env.HONOWARDEN_CREDENTIAL_FIXTURE
    if (officialFixture) {
      const response = JSON.parse(await readFile(officialFixture, 'utf8'))
      const material = normalizeCredentialMaterial(response.material)
      const actualCurrent = material.stages.pbkdf2_return
      const actualParsed = parseUserKeyRotationBody(
        userKeyRotationBody(
          material.email,
          actualCurrent,
          material.stages.user_key_rotation,
        ),
      )
      expect(actualParsed).toMatchObject({ ok: true })
      expect(
        actualParsed.ok &&
          matchesUserKeyRotationCredentialGeneration(actualParsed, {
            emailNormalized: material.email,
            kdfAlgorithm: 'pbkdf2-sha256',
            kdfIterations: 600000,
            kdfMemory: null,
            kdfParallelism: null,
            userKey: actualCurrent.masterKeyEncryptedUserKey,
            publicKey: actualCurrent.accountKeys.accountPublicKey,
            privateKey:
              actualCurrent.accountKeys.userKeyEncryptedAccountPrivateKey,
          }),
      ).toBe(true)
    }
  })

  it('isolates lifecycle and browser subprocesses from ambient credentials', async () => {
    const { isolatedLifecycleEnvironment } = await import(
      pathToFileURL(lifecycleScript).href
    )
    const { isolatedBrowserEnvironment } = await import(
      pathToFileURL(browserReadbackScript).href
    )
    const source = {
      PATH: '/synthetic/bin',
      HOME: '/synthetic/home',
      TMPDIR: '/synthetic/tmp',
      LANG: 'C.UTF-8',
      BW_SESSION: 'ambient-session',
      BW_PASSWORD: 'ambient-password',
      CLOUDFLARE_API_TOKEN: 'ambient-cloudflare-token',
      LINEAR_API_KEY: 'ambient-linear-key',
      GH_TOKEN: 'ambient-github-token',
      OPENAI_API_KEY: 'ambient-openai-key',
      RANDOM_SECRET: 'ambient-random-secret',
    }

    for (const environment of [
      isolatedLifecycleEnvironment(source),
      isolatedBrowserEnvironment(source),
    ]) {
      expect(environment).toMatchObject({
        PATH: '/synthetic/bin',
        HOME: '/synthetic/home',
        TMPDIR: '/synthetic/tmp',
        LANG: 'C.UTF-8',
        CI: 'true',
        NO_COLOR: '1',
        pnpm_config_verify_deps_before_run: 'false',
      })
      expect(environment).not.toHaveProperty('BW_SESSION')
      expect(environment).not.toHaveProperty('BW_PASSWORD')
      expect(environment).not.toHaveProperty('CLOUDFLARE_API_TOKEN')
      expect(environment).not.toHaveProperty('LINEAR_API_KEY')
      expect(environment).not.toHaveProperty('GH_TOKEN')
      expect(environment).not.toHaveProperty('OPENAI_API_KEY')
      expect(environment).not.toHaveProperty('RANDOM_SECRET')
    }
  })

  it('rejects symlinked and non-private lifecycle persistence roots', async () => {
    const { prepareCredentialLifecyclePersistPath } = await import(
      pathToFileURL(lifecycleScript).href
    )
    const fixtureParent = await makeRepoFixtureDirectory(
      'hon220-persist-boundary-',
    )
    const externalRoot = await mkdtemp(
      join(tmpdir(), 'hon220-persist-external-'),
    )
    const linkedRoot = join(fixtureParent, 'linked')
    const publicRoot = join(fixtureParent, 'public')
    try {
      await symlink(externalRoot, linkedRoot)
      await mkdir(publicRoot, { mode: 0o700 })
      await chmod(publicRoot, 0o755)

      await expect(
        prepareCredentialLifecyclePersistPath(linkedRoot),
      ).rejects.toThrow('persist-to must not contain symlinks')
      await expect(
        prepareCredentialLifecyclePersistPath(publicRoot),
      ).rejects.toThrow('persist-to directory permissions must be 0700')
    } finally {
      await Promise.all([
        rm(fixtureParent, { recursive: true, force: true }),
        rm(externalRoot, { recursive: true, force: true }),
      ])
    }
  })

  it('requires an explicit persistence root when keeping lifecycle state', async () => {
    await expect(
      execFileAsync('node', [lifecycleScript, 'plan', '--keep-state'], {
        cwd: repoRoot,
        timeout: 10_000,
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        '--keep-state requires an explicit --persist-to path',
      ),
    })
  })

  it('owns an empty persistence root and removes it unless keep-state is explicit', async () => {
    const {
      cleanupCredentialLifecycleState,
      prepareCredentialLifecyclePersistPath,
    } = await import(pathToFileURL(lifecycleScript).href)
    const parent = await makeRepoFixtureDirectory('hon220-persist-ownership-')
    const disposable = join(parent, 'disposable')
    const retained = join(parent, 'retained')
    const foreign = join(parent, 'foreign')
    try {
      await mkdir(disposable, { mode: 0o700 })
      await prepareCredentialLifecyclePersistPath(disposable)
      expect(await readdir(disposable)).toEqual([
        '.honowarden-credential-lifecycle-owned',
      ])
      await writeFile(join(disposable, 'state.sqlite'), 'synthetic', {
        mode: 0o600,
      })
      await cleanupCredentialLifecycleState(disposable, false)
      await expect(access(disposable)).rejects.toThrow()

      await mkdir(retained, { mode: 0o700 })
      await prepareCredentialLifecyclePersistPath(retained)
      await cleanupCredentialLifecycleState(retained, true)
      await expect(access(retained)).resolves.toBeUndefined()

      await mkdir(foreign, { mode: 0o700 })
      await writeFile(join(foreign, 'operator-owned.txt'), 'do not delete', {
        mode: 0o600,
      })
      await expect(
        prepareCredentialLifecyclePersistPath(foreign),
      ).rejects.toThrow('persist-to directory must be empty')
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })

  it('attests completed state, ignores SQLite shared memory, and rejects durable drift', async () => {
    const {
      assertCredentialLifecycleCompletionAttestation,
      writeCredentialLifecycleCompletionAttestation,
    } = await import(pathToFileURL(lifecycleStateScript).href)
    const parent = await makeRepoFixtureDirectory('hon220-completion-state-')
    const state = join(parent, 'state')
    const generationManifestSha256 = 'a'.repeat(64)
    try {
      await mkdir(state, { mode: 0o700 })
      await writeFile(join(state, 'state.sqlite'), 'completed-state', {
        mode: 0o600,
      })
      await writeFile(join(state, 'state.sqlite-shm'), 'runtime-index-a', {
        mode: 0o600,
      })

      const attestation = await writeCredentialLifecycleCompletionAttestation(
        state,
        generationManifestSha256,
      )
      expect(attestation).toEqual({
        schemaVersion: 1,
        generationManifestSha256,
        stateTreeSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
      expect(
        (
          await lstat(
            join(state, '.honowarden-credential-lifecycle-complete.json'),
          )
        ).mode & 0o777,
      ).toBe(0o600)
      await expect(
        assertCredentialLifecycleCompletionAttestation(
          state,
          generationManifestSha256,
        ),
      ).resolves.toEqual(attestation)

      await expect(
        assertCredentialLifecycleCompletionAttestation(state, 'b'.repeat(64)),
      ).rejects.toThrow(
        'credential lifecycle completion manifest digest mismatch',
      )

      await writeFile(join(state, 'state.sqlite-shm'), 'runtime-index-b')
      await expect(
        assertCredentialLifecycleCompletionAttestation(
          state,
          generationManifestSha256,
        ),
      ).resolves.toEqual(attestation)

      await writeFile(join(state, 'state.sqlite-wal'), 'durable-wal-state', {
        mode: 0o600,
      })
      await expect(
        assertCredentialLifecycleCompletionAttestation(
          state,
          generationManifestSha256,
        ),
      ).rejects.toThrow('credential lifecycle completion state digest mismatch')
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })

  it('accepts only an authentication-specific stale official CLI failure', async () => {
    const { assertStaleOfficialProfileRejected } = await import(
      pathToFileURL(lifecycleScript).href
    )
    const cleanCommand = {
      exitCode: 0,
      timedOut: false,
      stderr: { bytes: 0 },
    }
    const staleResult = {
      exitCode: 1,
      timedOut: false,
      stderr: { bytes: 180 },
      configuration: {
        read: cleanCommand,
        write: null,
      },
    }
    const expectedStderr = Buffer.from(
      [
        "error: 'invalid_grant'",
        "Message: 'Invalid username or password.'",
        'statusCode: 400',
        'Syncing failed: Invalid username or password.',
      ].join('\n'),
    )

    expect(() =>
      assertStaleOfficialProfileRejected(
        staleResult,
        expectedStderr,
        'stale profile',
      ),
    ).not.toThrow()
    for (const stderr of [
      'connect ECONNREFUSED 127.0.0.1',
      'unable to verify the first certificate',
      'server returned statusCode: 503',
      'Syncing failed: unexpected error',
    ]) {
      expect(() =>
        assertStaleOfficialProfileRejected(
          { ...staleResult, stderr: { bytes: Buffer.byteLength(stderr) } },
          Buffer.from(stderr),
          'stale profile',
        ),
      ).toThrow('stale profile did not fail for invalidated credentials')
    }
    expect(() =>
      assertStaleOfficialProfileRejected(
        {
          ...staleResult,
          configuration: {
            read: { ...cleanCommand, stderr: { bytes: 1 } },
            write: null,
          },
        },
        expectedStderr,
        'stale profile',
      ),
    ).toThrow('stale profile configuration read emitted unexpected stderr')
  })

  it('fails closed on foreign-key violations and stale wrapped generations', async () => {
    const {
      assertNoForeignKeyViolations,
      assertStaleWrappedGenerationResponse,
    } = await import(pathToFileURL(lifecycleScript).href)

    expect(() =>
      assertNoForeignKeyViolations({ foreignKeyViolations: 0 }, 'clean'),
    ).not.toThrow()
    expect(() =>
      assertNoForeignKeyViolations({ foreignKeyViolations: 1 }, 'orphaned'),
    ).toThrow('orphaned D1 foreign-key check returned 1 violation')
    expect(() =>
      assertNoForeignKeyViolations(
        { foreignKeyViolations: Number.NaN },
        'invalid',
      ),
    ).toThrow('invalid D1 foreign-key check was invalid')

    expect(() =>
      assertStaleWrappedGenerationResponse({
        status: 400,
        body: { error: { code: 'invalid_request' } },
      }),
    ).not.toThrow()
    expect(() => assertStaleWrappedGenerationResponse({ status: 401 })).toThrow(
      'stale wrapped generation returned 401, expected 400 invalid_request',
    )
  })

  it('detects exact issued tokens and fail-closed token shapes in audit contexts', async () => {
    const { findSecretAuditMatches } = await import(
      pathToFileURL(lifecycleScript).href
    )
    const issuedAccessToken = [
      `eyJ${'a'.repeat(16)}`,
      'b'.repeat(24),
      'c'.repeat(32),
    ].join('.')
    const issuedRefreshToken = 'd'.repeat(43)
    const browserAccessToken = [
      `eyJ${'e'.repeat(16)}`,
      'f'.repeat(24),
      'g'.repeat(32),
    ].join('.')
    const browserRefreshToken = 'h'.repeat(43)
    const stage = credentialStage('audit', 1)
    const material = {
      email: 'audit@example.invalid',
      plaintext: {
        itemName: 'audit-item-name',
        itemUsername: 'audit-item-username',
        itemPassword: 'audit-item-password',
        itemUri: 'https://audit.example.invalid',
        itemNotes: 'audit-item-notes',
        attachmentFileName: 'audit-file.txt',
      },
      stages: { baseline: stage },
    }
    const contexts = [
      {
        contextJson: JSON.stringify({
          exactAccess: issuedAccessToken,
          exactRefresh: issuedRefreshToken,
          browserAccess: browserAccessToken,
          browserRefresh: browserRefreshToken,
        }),
      },
    ]

    expect(
      findSecretAuditMatches(contexts, material, [
        issuedAccessToken,
        issuedRefreshToken,
      ]),
    ).toEqual({
      credentialOrVault: 0,
      issuedTokens: 2,
      accessTokenShapes: 2,
      refreshTokenShapes: 2,
      total: 6,
    })

    expect(
      findSecretAuditMatches(
        [
          {
            contextJson: JSON.stringify({
              embeddedAccess: `session_${browserAccessToken}_failed`,
              embeddedRefresh: `session-${browserRefreshToken}-failed`,
            }),
          },
        ],
        material,
      ),
    ).toMatchObject({
      accessTokenShapes: 1,
      refreshTokenShapes: 1,
      total: 2,
    })
  })

  it('includes wrapper history in D1 generation equality', async () => {
    const { generationStateEqual } = await import(
      pathToFileURL(lifecycleScript).href
    )
    const snapshot = {
      user: { revisionDate: '2026-07-20T00:00:00.000Z' },
      folder: { revisionDate: '2026-07-20T00:00:00.000Z' },
      cipher: { revisionDate: '2026-07-20T00:00:00.000Z' },
      attachment: { revisionDate: '2026-07-20T00:00:00.000Z' },
      devices: { activeCount: 0, revokedCount: 1 },
      refreshTokens: { activeCount: 0, revokedCount: 1 },
      auditContexts: [],
      wrapperHistory: [
        {
          wrapperKind: 'user_key',
          wrapperSha256: 'a'.repeat(64),
        },
      ],
      foreignKeyViolations: 0,
    }

    expect(generationStateEqual(snapshot, structuredClone(snapshot))).toBe(true)
    expect(
      generationStateEqual(snapshot, {
        ...structuredClone(snapshot),
        wrapperHistory: [
          ...snapshot.wrapperHistory,
          {
            wrapperKind: 'private_key',
            wrapperSha256: 'b'.repeat(64),
          },
        ],
      }),
    ).toBe(false)
  })

  it('blocks external browser traffic and observes a popup before navigation', async () => {
    const {
      buildIsolatedBrowserLaunchArgs,
      classifyBrowserRequestUrl,
      createEventRecorder,
      enableAndNavigateEvidenceClient,
      validateIsolatedBrowserBootstrap,
    } = await import(pathToFileURL(browserReadbackScript).href)
    const localOrigin = 'https://localhost:43123'

    expect(
      classifyBrowserRequestUrl(`${localOrigin}/api/sync`, localOrigin),
    ).toMatchObject({ allowed: true, location: '/api/sync' })
    expect(
      classifyBrowserRequestUrl(
        'chrome-extension://fixture/popup/index.html',
        localOrigin,
      ),
    ).toMatchObject({
      allowed: true,
      location: 'chrome-extension://[extension]/popup/index.html',
    })
    expect(
      classifyBrowserRequestUrl('https://example.com/leak', localOrigin),
    ).toMatchObject({
      allowed: false,
      location: expect.stringMatching(/^external-origin-sha256:/),
    })
    expect(
      classifyBrowserRequestUrl(
        'wss://localhost:43123/notifications/hub?access_token=synthetic',
        localOrigin,
      ),
    ).toMatchObject({ allowed: true, location: '/notifications/hub' })
    expect(
      classifyBrowserRequestUrl(
        'wss://external.example/notifications/hub',
        localOrigin,
      ),
    ).toMatchObject({
      allowed: false,
      location: expect.stringMatching(/^external-origin-sha256:/),
    })

    expect(buildIsolatedBrowserLaunchArgs(['--fixture'])).toEqual(
      expect.arrayContaining([
        '--fixture',
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost',
        '--proxy-server=http://127.0.0.1:9',
        '--proxy-bypass-list=localhost;127.0.0.1;[::1]',
      ]),
    )
    expect(
      validateIsolatedBrowserBootstrap({
        externalRequests: [
          {
            location: 'external-origin-sha256:fixture',
            surface: 'popup',
            type: 'Fetch',
          },
        ],
        externalResponses: [],
        loadingFailures: [
          {
            errorText: 'net::ERR_PROXY_CONNECTION_FAILED',
            location: 'external-origin-sha256:fixture',
            surface: 'popup',
            type: 'Fetch',
          },
        ],
      }),
    ).toEqual({
      blockedExternalRequestCount: 1,
      externalResponseCount: 0,
    })
    expect(() =>
      validateIsolatedBrowserBootstrap({
        externalRequests: [],
        externalResponses: [],
        consoleErrors: [],
        loadingFailures: [],
        nonSuccessResponses: [],
      }),
    ).toThrow('official browser bootstrap did not observe an external request')
    expect(
      validateIsolatedBrowserBootstrap({
        externalRequests: [
          {
            location: 'external-origin-sha256:fixture',
            surface: 'background',
            type: 'Fetch',
          },
          {
            location: 'external-origin-sha256:fixture',
            surface: 'popup',
            type: 'Fetch',
          },
        ],
        externalResponses: [],
        consoleErrors: [
          {
            category: 'server_config_fetch_failure',
            location: 'chrome-extension://[extension]/background.js',
            relatedLocation: 'external-origin-sha256:fixture',
            messageSha256: 'a'.repeat(64),
            source: 'console-api',
            surface: 'background',
          },
          {
            category: 'resource_load_failure',
            location: 'external-origin-sha256:fixture',
            messageSha256: 'b'.repeat(64),
            source: 'network',
            surface: 'popup',
          },
          {
            category: 'server_config_fetch_failure',
            location: 'chrome-extension://[extension]/popup/main.js',
            relatedLocation: 'external-origin-sha256:fixture',
            messageSha256: 'c'.repeat(64),
            source: 'console-api',
            surface: 'popup',
          },
          {
            category: 'server_config_fetch_failure',
            location: 'chrome-extension://[extension]/background.js',
            relatedLocation: '/api',
            messageSha256: 'd'.repeat(64),
            source: 'console-api',
            surface: 'background',
          },
        ],
        loadingFailures: [
          {
            errorText: 'net::ERR_PROXY_CONNECTION_FAILED',
            location: 'external-origin-sha256:fixture',
            surface: 'background',
            type: 'Fetch',
          },
          {
            errorText: 'net::ERR_PROXY_CONNECTION_FAILED',
            location: 'external-origin-sha256:fixture',
            surface: 'popup',
            type: 'Fetch',
          },
          {
            errorText: 'net::ERR_CERT_AUTHORITY_INVALID',
            location: '/api/config',
            surface: 'background',
            type: 'Fetch',
          },
        ],
        nonSuccessResponses: [],
      }),
    ).toEqual({
      blockedExternalRequestCount: 2,
      externalResponseCount: 0,
    })
    expect(() =>
      validateIsolatedBrowserBootstrap({
        externalRequests: [
          {
            location: 'external-origin-sha256:fixture',
            surface: 'popup',
            type: 'Fetch',
          },
        ],
        externalResponses: [],
        consoleErrors: [
          {
            category: 'server_config_fetch_failure',
            location: 'chrome-extension://[extension]/popup/main.js',
            relatedLocation: 'external-origin-sha256:other',
            messageSha256: 'e'.repeat(64),
            source: 'console-api',
            surface: 'popup',
          },
        ],
        loadingFailures: [
          {
            errorText: 'net::ERR_PROXY_CONNECTION_FAILED',
            location: 'external-origin-sha256:fixture',
            surface: 'popup',
            type: 'Fetch',
          },
        ],
        nonSuccessResponses: [],
      }),
    ).toThrow('official browser bootstrap emitted an unexpected diagnostic')
    expect(() =>
      validateIsolatedBrowserBootstrap({
        externalRequests: [
          {
            location: 'external-origin-sha256:fixture',
            surface: 'popup',
            type: 'Fetch',
          },
        ],
        externalResponses: [
          {
            location: 'external-origin-sha256:fixture',
            status: 200,
            surface: 'popup',
          },
        ],
        loadingFailures: [],
      }),
    ).toThrow('official browser bootstrap reached an external origin')
    expect(() =>
      validateIsolatedBrowserBootstrap({
        externalRequests: [],
        externalResponses: [],
        consoleErrors: [
          {
            category: 'unknown',
            location: 'chrome-extension://[extension]/background.js',
            messageSha256: 'a'.repeat(64),
            source: 'console-api',
            surface: 'background',
          },
        ],
        loadingFailures: [],
        nonSuccessResponses: [],
      }),
    ).toThrow('official browser bootstrap emitted an unexpected diagnostic')
    expect(() =>
      validateIsolatedBrowserBootstrap({
        externalRequests: [
          {
            location: 'external-origin-sha256:fixture',
            surface: 'popup',
            type: 'Fetch',
          },
        ],
        externalResponses: [],
        consoleErrors: [],
        loadingFailures: [
          {
            errorText: 'net::ERR_PROXY_CONNECTION_FAILED',
            location: 'external-origin-sha256:fixture',
            surface: 'popup',
            type: 'Fetch',
          },
          {
            errorText: 'net::ERR_FAILED',
            location: '/api/config',
            surface: 'background',
            type: 'Fetch',
          },
        ],
        nonSuccessResponses: [],
      }),
    ).toThrow('official browser bootstrap emitted an unexpected diagnostic')

    const diagnostics = {
      consoleErrors: [],
      externalRequests: [],
      externalResponses: [],
      loadingFailures: [],
      nonSuccessResponses: [],
    }
    const runtimeExceptions: unknown[] = []
    const recordEvent = createEventRecorder({
      baseUrl: localOrigin,
      diagnostics,
      redactedValues: ['synthetic-browser-secret'],
      routeStatuses: {},
      runtimeExceptions,
      startedAtMs: 1_000,
    })
    recordEvent(
      {
        method: 'Runtime.consoleAPICalled',
        params: {
          type: 'error',
          args: [{ value: 'historical console error' }],
          timestamp: 999,
        },
      },
      'background',
    )
    recordEvent(
      {
        method: 'Runtime.consoleAPICalled',
        params: {
          type: 'error',
          args: [{ value: 'unknown synthetic-browser-secret' }],
          stackTrace: {
            callFrames: [
              {
                url: 'chrome-extension://fixture/background.js',
              },
            ],
          },
        },
      },
      'background',
    )
    recordEvent(
      {
        method: 'Runtime.consoleAPICalled',
        params: {
          type: 'error',
          args: [
            {
              value: `Unable to fetch ServerConfig from ${pinnedUpstreamApiOrigin()} TypeError: Failed to fetch\n    at synthetic`,
            },
          ],
          stackTrace: {
            callFrames: [
              {
                url: 'chrome-extension://fixture/background.js',
              },
            ],
          },
        },
      },
      'background',
    )
    recordEvent(
      {
        method: 'Network.webSocketCreated',
        params: {
          requestId: 'external-websocket',
          url: 'wss://external.example/socket?access_token=synthetic',
        },
      },
      'background',
    )
    recordEvent(
      {
        method: 'Network.webSocketHandshakeResponseReceived',
        params: {
          requestId: 'external-websocket',
          response: {
            status: 101,
            url: 'wss://external.example/socket?access_token=synthetic',
          },
        },
      },
      'background',
    )
    recordEvent(
      {
        method: 'Network.webSocketCreated',
        params: {
          requestId: 'local-websocket',
          url: 'wss://localhost:43123/notifications/hub?access_token=synthetic',
        },
      },
      'background',
    )
    recordEvent(
      {
        method: 'Network.webSocketHandshakeResponseReceived',
        params: {
          requestId: 'local-websocket',
          response: {
            status: 503,
          },
        },
      },
      'background',
    )
    recordEvent(
      {
        method: 'Network.webSocketFrameError',
        params: {
          requestId: 'local-websocket',
          errorMessage: 'net::ERR_CONNECTION_REFUSED synthetic-browser-secret',
        },
      },
      'background',
    )
    expect(JSON.stringify(diagnostics)).not.toContain(
      'synthetic-browser-secret',
    )
    expect(diagnostics).toMatchObject({
      consoleErrors: [
        {
          category: 'unknown',
          source: 'console-api',
          surface: 'background',
        },
        {
          category: 'server_config_fetch_failure',
          relatedLocation: expect.stringMatching(/^external-origin-sha256:/),
          source: 'console-api',
          surface: 'background',
        },
      ],
      externalRequests: [
        {
          location: expect.stringMatching(/^external-origin-sha256:/),
          surface: 'background',
          type: 'WebSocket',
        },
      ],
      externalResponses: [
        {
          location: expect.stringMatching(/^external-origin-sha256:/),
          status: 101,
          surface: 'background',
        },
      ],
      loadingFailures: [
        {
          errorText: 'net::ERR_CONNECTION_REFUSED',
          location: '/notifications/hub',
          surface: 'background',
          type: 'WebSocket',
        },
      ],
      nonSuccessResponses: [
        {
          location: '/notifications/hub',
          status: 503,
          surface: 'background',
          type: 'WebSocket',
        },
      ],
    })

    const calls: Array<{ method: string; params?: unknown }> = []
    const client = {
      call: async (method: string, params?: unknown) => {
        calls.push({ method, params })
        return { result: {} }
      },
    }
    await enableAndNavigateEvidenceClient(
      client,
      'chrome-extension://fixture/popup/index.html#/login',
    )
    expect(calls.map((entry) => entry.method)).toEqual([
      'Network.enable',
      'Runtime.enable',
      'Log.enable',
      'Page.enable',
      'Page.navigate',
    ])
  })

  it('redacts every runtime-exception field and bounds CDP calls', async () => {
    const {
      CdpClient,
      classifyBootstrapRuntimeExceptions,
      redactBrowserRuntimeException,
    } = await import(pathToFileURL(browserReadbackScript).href)
    const secret = 'synthetic-runtime-secret'
    const exception = redactBrowserRuntimeException(
      {
        exception: { description: `Error: ${secret}` },
        text: `Uncaught ${secret}`,
        url: `chrome-extension://fixture/${secret}/background.js`,
        lineNumber: 12,
        columnNumber: 34,
      },
      'background',
      [secret],
    )

    expect(JSON.stringify(exception)).not.toContain(secret)
    expect(exception).toMatchObject({
      description: 'Error: [redacted]',
      text: 'Uncaught [redacted]',
      url: 'chrome-extension://fixture/[redacted]/background.js',
    })
    const blockedBootstrapException = {
      surface: 'background',
      description: 'Error: Frame with ID 0 is showing error page',
      text: 'Uncaught (in promise)',
      url: 'chrome-extension://fixture/background.js',
    }
    expect(
      classifyBootstrapRuntimeExceptions([blockedBootstrapException]),
    ).toEqual({
      expectedNetworkIsolation: [blockedBootstrapException],
      unexpected: [],
    })
    expect(
      classifyBootstrapRuntimeExceptions([
        {
          ...blockedBootstrapException,
          description: `${blockedBootstrapException.description} unexpected`,
        },
      ]),
    ).toMatchObject({
      expectedNetworkIsolation: [],
      unexpected: [{ surface: 'background' }],
    })

    class SilentSocket extends EventTarget {
      readyState = 1

      send() {}

      close() {
        this.readyState = 3
        this.dispatchEvent(new Event('close'))
      }
    }
    const client = new CdpClient(new SilentSocket(), () => undefined)
    await expect(client.call('Runtime.evaluate', {}, 20)).rejects.toThrow(
      'official browser CDP command timed out',
    )
    expect(client.pending.size).toBe(0)
    client.close()

    const eventSocket = new SilentSocket()
    const eventClient = new CdpClient(eventSocket, () => {
      throw new Error('synthetic event failure')
    })
    eventSocket.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ method: 'Runtime.consoleAPICalled' }),
      }),
    )
    expect(() => eventClient.assertHealthy()).toThrow(
      'official browser CDP event validation failed',
    )
    eventClient.close()
  })

  it('keeps the operator runbook synchronized with current runtime pins', async () => {
    const runbook = await readFile(
      join(repoRoot, 'docs/operations/official-client-credential-harness.md'),
      'utf8',
    )

    expect(runbook).toContain(
      '1a38398906d268c61ad40b79310d4810125f25d056052404fb0b8dfc23cd6601',
    )
    expect(runbook).toContain(
      '2f7ee0a87f78bb69366c6780ea57f8a8940a7f7d268f18854ceff96a3111d71b',
    )
  })
})

async function makeRepoFixtureDirectory(prefix: string): Promise<string> {
  const fixtureRoot = join(repoRoot, 'test/.tmp')
  await mkdir(fixtureRoot, { recursive: true, mode: 0o700 })
  return mkdtemp(join(fixtureRoot, prefix))
}

function credentialStage(label: string, userKeyGeneration: number) {
  const encrypted = (field: string) => `2.${label}-${field}`
  return {
    id: label,
    password: `${label}-password-that-is-long-enough`,
    kdf: { pBKDF2: { iterations: 600000 } },
    kdfId: 'pbkdf2',
    userKeyGeneration,
    masterPasswordAuthenticationHash: `${label}-authentication-hash`,
    masterKeyEncryptedUserKey: encrypted('wrapped-user-key'),
    accountKeys: {
      accountPublicKey: 'shared-public-key',
      userKeyEncryptedAccountPrivateKey: encrypted('private-key'),
    },
    vault: {
      folderName: encrypted('folder'),
      cipher: {
        name: encrypted('name'),
        username: encrypted('username'),
        password: encrypted('password'),
        uri: encrypted('uri'),
        notes: encrypted('notes'),
      },
      attachment: {
        fileName: encrypted('file-name'),
        key: encrypted('attachment-key'),
      },
    },
  }
}

function completeBrowserEvidence() {
  return {
    routeStatuses: {
      '/identity/accounts/prelogin/password': [200],
      '/identity/connect/token': [200],
      '/api/config': [200],
      '/api/accounts/profile': [200],
      '/api/sync': [200],
    },
    decryptedFields: {
      itemName: true,
      itemUsername: true,
      itemPassword: true,
      itemNotes: true,
      attachmentFileName: true,
      cipherRoute: true,
    },
    runtimeExceptions: [],
  }
}

function pinnedUpstreamApiOrigin() {
  return `https://api.${['bit', 'warden'].join('')}.com`
}

function knownBrowserDiagnostics() {
  return {
    consoleErrors: [
      {
        category: 'notifications_websocket_failure',
        location: 'chrome-extension://[extension]/background.js',
        messageSha256: 'a'.repeat(64),
        surface: 'background',
      },
      {
        category: 'closed_bootstrap_tab',
        location: 'unknown',
        messageSha256: 'd'.repeat(64),
        source: 'other',
        surface: 'background',
      },
      {
        category: 'notifications_signalr_start_failure',
        location: 'chrome-extension://[extension]/background.js',
        messageSha256: 'e'.repeat(64),
        source: 'console-api',
        surface: 'background',
      },
      {
        category: 'closed_browser_tab_badge_state',
        location: 'chrome-extension://[extension]/background.js',
        messageSha256: 'f'.repeat(64),
        source: 'console-api',
        surface: 'background',
      },
      {
        category: 'certificate_resource_load_failure',
        location: 'chrome-extension://[extension]/background.js',
        messageSha256: 'b'.repeat(64),
        surface: 'background',
      },
      {
        category: 'resource_load_failure',
        location: '/icons/[redacted]/icon.png',
        messageSha256: 'c'.repeat(64),
        surface: 'popup',
      },
    ],
    loadingFailures: [
      {
        errorText: 'net::ERR_CERT_AUTHORITY_INVALID',
        location: '/api/config',
        surface: 'background',
        type: 'Fetch',
      },
      {
        errorText: 'net::ERR_CERT_AUTHORITY_INVALID',
        location: '/notifications/hub',
        surface: 'background',
        type: 'WebSocket',
      },
      {
        errorText: 'net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin',
        location: '/icons/[redacted]/icon.png',
        surface: 'popup',
        type: 'Image',
      },
    ],
    nonSuccessResponses: [],
  }
}

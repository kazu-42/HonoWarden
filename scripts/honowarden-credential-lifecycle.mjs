#!/usr/bin/env node

import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { request as requestHttp } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  cloneOfficialProfile,
  generateOfficialCredentialFixture,
  resolveHarnessRoot,
  runOfficialCli,
  validateLoopbackOrigin,
} from './honowarden-official-client-harness.mjs'
import {
  cleanupOfficialBrowserExtensionResources,
  runOfficialBrowserExtensionReadback,
} from './honowarden-browser-extension-readback.mjs'
import {
  createIdempotentCleanup,
  installSignalCleanup,
  runBoundedCommand,
  runCleanupSteps,
  stopDetachedProcessTree,
  stopTrackedProcesses,
} from './honowarden-signal-cleanup.mjs'
import {
  credentialLifecycleStateOwnershipMarker as stateOwnershipMarker,
  credentialLifecycleStateOwnershipMarkerBody as stateOwnershipMarkerBody,
  writeCredentialLifecycleCompletionAttestation,
} from './honowarden-credential-lifecycle-state.mjs'

const schemaVersion = 1
const confirmation = 'credential-lifecycle'
const repoRoot = fileURLToPath(new globalThis.URL('..', import.meta.url))
const defaultHarnessRoot = 'test/.tmp/hon-207-official-client'
const fixtureRoot = join(repoRoot, 'test/.tmp')
const databaseName = 'honowarden'
const r2BucketName = 'honowarden-vault-objects'
const tokenSecret = 'synthetic-hon220-token-secret-with-at-least-32-bytes'
const initialRevision = '2026-07-20T12:00:00.000Z'
const lifecycleEnvironmentKeys = Object.freeze([
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOGNAME',
  'NODE_EXTRA_CA_CERTS',
  'PATH',
  'SHELL',
  'SSL_CERT_FILE',
  'TEMP',
  'TMP',
  'TMPDIR',
  'TZ',
  'USER',
])
const actor = Object.freeze({
  userId: '22000000-0000-4220-8220-000000000001',
  folderId: '22000000-0000-4220-8220-000000000002',
  cipherId: '22000000-0000-4220-8220-000000000003',
  attachmentId: '22000000-0000-4220-8220-000000000004',
  r2ObjectKey: 'attachments/hon220-immutable-ciphertext',
})
const r2SentinelBody = Buffer.from(
  'synthetic-hon220-r2-body::opaque-attachment-ciphertext',
)
const stagePlan = Object.freeze([
  Object.freeze({
    id: 'baseline',
    kdf: 'pbkdf2',
    userKeyGeneration: 1,
  }),
  Object.freeze({
    id: 'account_keys',
    kdf: 'pbkdf2',
    userKeyGeneration: 1,
  }),
  Object.freeze({
    id: 'password_change',
    kdf: 'pbkdf2',
    userKeyGeneration: 1,
  }),
  Object.freeze({
    id: 'argon2id',
    kdf: 'argon2id',
    userKeyGeneration: 1,
  }),
  Object.freeze({
    id: 'pbkdf2_return',
    kdf: 'pbkdf2',
    userKeyGeneration: 1,
  }),
  Object.freeze({
    id: 'user_key_rotation',
    kdf: 'pbkdf2',
    userKeyGeneration: 2,
  }),
  Object.freeze({
    id: 'restart_readback',
    kdf: 'pbkdf2',
    userKeyGeneration: 2,
  }),
])

async function main(argv = process.argv.slice(2)) {
  const normalized = argv[0] === '--' ? argv.slice(1) : argv
  const [action, ...rest] = normalized
  if (action !== 'plan' && action !== 'run') {
    throw new Error('action must be plan or run')
  }
  const options = parseOptions(rest)
  if (options.keepState && !options.persistTo) {
    throw new Error('--keep-state requires an explicit --persist-to path')
  }
  if (options.execute && action !== 'run') {
    throw new Error('--execute is only allowed for run')
  }
  if (action === 'run' && !options.execute) {
    throw new Error('run requires --execute')
  }
  if (options.execute && options.confirm !== confirmation) {
    throw new Error(`--confirm ${confirmation} is required before --execute`)
  }
  const packet = buildPacket(action, options)
  if (options.execute) {
    packet.readback = await executeLifecycle(options, packet.generatedAt)
    packet.executed = true
    packet.status = packet.readback.status
    delete packet.next.command
  }
  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`)
}

function buildPacket(action, options) {
  const generatedAt = parseTimestamp(options.at)
  const harnessRoot = resolveHarnessRoot(
    options.harnessRoot ?? defaultHarnessRoot,
  )
  const persistTo = options.persistTo
    ? resolvePersistPath(options.persistTo)
    : null
  return {
    schemaVersion,
    action,
    generatedAt,
    executed: false,
    status: 'planned',
    mode: options.browserExecutable
      ? 'wrangler-local-d1-r2-official-cli-browser-extension-synthetic'
      : 'wrangler-local-d1-r2-official-cli-synthetic',
    harnessRoot: harnessRoot.relative,
    persistTo: persistTo?.relative ?? null,
    stages: stagePlan,
    browserExtension: {
      requested: Boolean(options.browserExecutable),
      host: 'chrome-for-testing',
      freshProfileRequired: true,
    },
    readback: null,
    next: {
      confirmation,
      command: buildExecutionCommand(options, generatedAt, harnessRoot),
    },
    safety: {
      productionSupported: false,
      remoteResourcesAllowed: false,
      realCredentialsAllowed: false,
      normalBrowserProfileAllowed: false,
      printsSecrets: false,
      forwardGenerationOnly: true,
      isolatedOfficialProfiles: true,
    },
  }
}

async function executeLifecycle(options, generatedAt, onCompletedState = null) {
  if (onCompletedState && !options.keepState) {
    throw new Error('credential recovery callback requires retained state')
  }
  const harnessRoot = resolveHarnessRoot(
    options.harnessRoot ?? defaultHarnessRoot,
  )
  const profiles = buildCredentialLifecycleProfiles(
    randomUUID().replaceAll('-', '').slice(0, 12),
  )
  const persistTo = options.persistTo
    ? (await prepareCredentialLifecyclePersistPath(options.persistTo)).absolute
    : await prepareTemporaryCredentialLifecycleState()
  let worker = null
  let proxy = null
  const commandProcesses = new Set()
  const browserResources = { commands: new Set() }
  const cleanup = createIdempotentCleanup(async () => {
    await runCleanupSteps(
      [
        () => cleanupOfficialBrowserExtensionResources(browserResources),
        () =>
          stopTrackedProcesses(
            commandProcesses,
            'credential lifecycle command cleanup',
          ),
        async () => {
          const activeProxy = proxy
          proxy = null
          if (activeProxy) await stopTlsProxy(activeProxy)
        },
        async () => {
          const activeWorker = worker
          worker = null
          if (activeWorker) await stopDetachedProcessTree(activeWorker)
        },
        () => cleanupCredentialLifecycleState(persistTo, options.keepState),
      ],
      'credential lifecycle cleanup',
    )
  })
  const removeSignalCleanup = installSignalCleanup(cleanup)
  let result
  let recoveryContext

  try {
    const fixture = await generateOfficialCredentialFixture(harnessRoot, {
      timeoutMs: options.timeoutMs,
    })
    const material = normalizeCredentialMaterial(fixture.material)
    await initializeState(persistTo, material, generatedAt, commandProcesses)
    const tls = await prepareTlsCertificate(persistTo, commandProcesses)

    const ports = await findDistinctFreePorts(3)
    worker = startWorker({
      persistTo,
      port: ports[0],
      inspectorPort: ports[1],
      email: material.email,
    })
    let baseUrl = `http://127.0.0.1:${ports[0]}`
    await waitForHealth(baseUrl, worker)
    proxy = await startTlsProxy({
      backendPort: ports[0],
      certificatePath: tls.certificatePath,
      keyPath: tls.keyPath,
      port: ports[2],
    })
    let officialBaseUrl = `https://localhost:${ports[2]}`

    result = await runGenerationSequence({
      baseUrl,
      caPath: tls.certificatePath,
      commandProcesses,
      fixtureReadback: fixture.readback,
      harnessRoot,
      material,
      officialBaseUrl,
      persistTo,
      profiles,
      runBrowserExtension: options.browserExecutable
        ? async (currentOfficialBaseUrl) =>
            runOfficialBrowserExtensionReadback({
              baseUrl: currentOfficialBaseUrl,
              browserExecutable: options.browserExecutable,
              cipherId: actor.cipherId,
              material,
              resources: browserResources,
              timeoutMs: parseTimeout(options.timeoutMs ?? '120000'),
            })
        : null,
      restartWorker: async () => {
        const activeProxy = proxy
        const activeWorker = worker
        proxy = null
        worker = null
        await runCleanupSteps(
          [
            async () => {
              if (activeProxy) await stopTlsProxy(activeProxy)
            },
            async () => {
              if (activeWorker) {
                await stopDetachedProcessTree(activeWorker)
              }
            },
          ],
          'credential lifecycle restart cleanup',
        )
        worker = startWorker({
          persistTo,
          port: ports[0],
          inspectorPort: ports[1],
          email: material.email,
        })
        baseUrl = `http://127.0.0.1:${ports[0]}`
        await waitForHealth(baseUrl, worker)
        proxy = await startTlsProxy({
          backendPort: ports[0],
          certificatePath: tls.certificatePath,
          keyPath: tls.keyPath,
          port: ports[2],
        })
        officialBaseUrl = `https://localhost:${ports[2]}`
        return { baseUrl, officialBaseUrl }
      },
      captureRecoveryContext: onCompletedState
        ? (context) => {
            if (recoveryContext) {
              throw new Error('credential recovery context was captured twice')
            }
            recoveryContext = context
          }
        : null,
    })
  } finally {
    try {
      await cleanup()
    } finally {
      removeSignalCleanup()
    }
  }

  if (options.keepState) {
    await writeCredentialLifecycleCompletionAttestation(
      persistTo,
      result.generationManifestSha256,
    )
  }
  if (onCompletedState) {
    if (!recoveryContext) {
      throw new Error('credential recovery context was not captured')
    }
    result = {
      ...result,
      recovery: await onCompletedState({
        persistTo,
        readback: result,
        recoveryContext,
      }),
    }
    recoveryContext = undefined
  }
  return result
}

export async function executeCredentialLifecycleForRecovery({
  options,
  generatedAt,
  onCompletedState,
}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('credential recovery options were invalid')
  }
  if (typeof onCompletedState !== 'function') {
    throw new TypeError('credential recovery callback is required')
  }
  return executeLifecycle(
    { ...options, keepState: true },
    parseTimestamp(generatedAt),
    onCompletedState,
  )
}

function assertValidRecoveryContext(recoveryContext) {
  if (
    !recoveryContext?.material ||
    !recoveryContext?.officialOrigin ||
    !recoveryContext?.current?.stage ||
    !recoveryContext?.current?.tokens ||
    !Array.isArray(recoveryContext?.stale) ||
    recoveryContext.stale.length !== 4
  ) {
    throw new Error('restored credential recovery context was invalid')
  }
}

export async function verifyRestoredCredentialGeneration({
  persistTo,
  harnessRoot,
  recoveryContext,
  timeoutMs = '120000',
}) {
  assertValidRecoveryContext(recoveryContext)
  const normalizedHarnessRoot = resolveHarnessRoot(harnessRoot)
  const timeout = parseTimeout(timeoutMs)
  const commandProcesses = new Set()
  let worker = null
  let proxy = null
  const cleanup = createIdempotentCleanup(async () => {
    await runCleanupSteps(
      [
        () =>
          stopTrackedProcesses(
            commandProcesses,
            'restored credential command cleanup',
          ),
        async () => {
          const activeProxy = proxy
          proxy = null
          if (activeProxy) await stopTlsProxy(activeProxy)
        },
        async () => {
          const activeWorker = worker
          worker = null
          if (activeWorker) await stopDetachedProcessTree(activeWorker)
        },
      ],
      'restored credential cleanup',
    )
  })
  const removeSignalCleanup = installSignalCleanup(cleanup)
  const material = recoveryContext.material
  const recoveryOrigin = validateRecoveryOfficialOrigin(
    recoveryContext.officialOrigin,
  )
  const runId = sha256(`${persistTo}\n${Date.now()}`).slice(0, 12)
  let tls
  let ports
  let baseUrl
  let officialBaseUrl

  const start = async () => {
    worker = startWorker({
      persistTo,
      port: ports[0],
      inspectorPort: ports[1],
      email: material.email,
    })
    baseUrl = `http://127.0.0.1:${ports[0]}`
    await waitForHealth(baseUrl, worker)
    proxy = await startTlsProxy({
      backendPort: ports[0],
      certificatePath: tls.certificatePath,
      keyPath: tls.keyPath,
      port: recoveryOrigin.port,
    })
    officialBaseUrl = recoveryOrigin.origin
  }

  const stop = async () => {
    const activeProxy = proxy
    const activeWorker = worker
    proxy = null
    worker = null
    await runCleanupSteps(
      [
        async () => {
          if (activeProxy) await stopTlsProxy(activeProxy)
        },
        async () => {
          if (activeWorker) await stopDetachedProcessTree(activeWorker)
        },
      ],
      'restored credential restart cleanup',
    )
  }

  const rejectStale = async (phase) => {
    for (const [index, stale] of recoveryContext.stale.entries()) {
      await assertDirectGenerationRejected({
        baseUrl,
        material,
        previous: stale.previous,
        tokens: stale.tokens,
        label: `${stale.label}-${phase}`,
      })
      const restoredProfile = buildRestoredStaleProfileName(runId, index, phase)
      await cloneOfficialProfile(
        normalizedHarnessRoot,
        stale.profile,
        restoredProfile,
      )
      await assertStaleProfileRejected({
        baseUrl: officialBaseUrl,
        caPath: tls.certificatePath,
        harnessRoot: normalizedHarnessRoot,
        profile: restoredProfile,
        session: stale.session,
        label: `${stale.label}-${phase}`,
        timeoutMs: timeout,
      })
    }
  }

  try {
    tls = await prepareTlsCertificate(persistTo, commandProcesses)
    ports = await findDistinctFreePorts(2, [recoveryOrigin.port])
    await start()
    await rejectStale('before-restart')
    const currentAccess = await authorizedJson(
      baseUrl,
      '/api/sync',
      recoveryContext.current.tokens.accessToken,
    )
    assertStatus(currentAccess, 200, 'restored current access token')
    const currentRefresh = await refreshGrant(
      baseUrl,
      recoveryContext.current.tokens.refreshToken,
    )
    assertStatus(currentRefresh, 200, 'restored current refresh token')
    const refreshedTokens = readTokens(currentRefresh, 'restored-current')
    const beforeRestartOfficial = await verifyOfficialStage({
      baseUrl: officialBaseUrl,
      caPath: tls.certificatePath,
      harnessRoot: normalizedHarnessRoot,
      material,
      profile: `hon225-${runId}-before-restart`,
      stage: recoveryContext.current.stage,
      timeoutMs: timeout,
    })

    await stop()
    await start()
    await rejectStale('after-restart')
    const currentAccessAfterRestart = await authorizedJson(
      baseUrl,
      '/api/sync',
      refreshedTokens.accessToken,
    )
    assertStatus(
      currentAccessAfterRestart,
      200,
      'restored current access token after restart',
    )
    const afterRestartOfficial = await verifyOfficialStage({
      baseUrl: officialBaseUrl,
      caPath: tls.certificatePath,
      harnessRoot: normalizedHarnessRoot,
      material,
      profile: `hon225-${runId}-after-restart`,
      stage: recoveryContext.current.stage,
      timeoutMs: timeout,
    })
    const restoredState = await generationStateCheckpoint({
      id: 'restored_restart_readback',
      expectedStage: recoveryContext.current.stage,
      persistTo,
      commandProcesses,
    })
    const checks = [
      check('restored_stale_generations_rejected', true),
      check('restored_current_access_and_refresh_accepted', true),
      check(
        'restored_official_client_decrypts',
        beforeRestartOfficial.itemRead,
      ),
      check(
        'restored_restart_preserves_rejection_and_decrypt',
        afterRestartOfficial.itemRead,
      ),
    ]
    if (checks.some((entry) => entry.status !== 'pass')) {
      throw new Error('restored credential generation checks failed')
    }
    return {
      status: 'passed',
      rejectionCounts: {
        passwords: recoveryContext.stale.length,
        accessTokens: recoveryContext.stale.length,
        refreshTokens: recoveryContext.stale.length,
        profiles: recoveryContext.stale.length,
      },
      restartRejectionCounts: {
        passwords: recoveryContext.stale.length,
        accessTokens: recoveryContext.stale.length,
        refreshTokens: recoveryContext.stale.length,
        profiles: recoveryContext.stale.length,
      },
      currentSession: {
        accessAccepted: true,
        refreshAccepted: true,
        accessAcceptedAfterRestart: true,
      },
      officialClient: {
        beforeRestart: redactOfficialReadback(beforeRestartOfficial),
        afterRestart: redactOfficialReadback(afterRestartOfficial),
      },
      final: restoredState,
      checks,
    }
  } finally {
    try {
      await cleanup()
    } finally {
      removeSignalCleanup()
    }
  }
}

export async function verifyCredentialForwardRecovery({
  persistTo,
  harnessRoot,
  recoveryContext,
  readPersistenceIdentity,
  timeoutMs = '120000',
}) {
  assertValidRecoveryContext(recoveryContext)
  if (typeof readPersistenceIdentity !== 'function') {
    throw new TypeError('canonical persistence identity reader is required')
  }
  const normalizedHarnessRoot = resolveHarnessRoot(harnessRoot)
  const timeout = parseTimeout(timeoutMs)
  const commandProcesses = new Set()
  let worker = null
  let proxy = null
  const cleanup = createIdempotentCleanup(async () => {
    await runCleanupSteps(
      [
        () =>
          stopTrackedProcesses(
            commandProcesses,
            'credential forward-recovery command cleanup',
          ),
        async () => {
          const activeProxy = proxy
          proxy = null
          if (activeProxy) await stopTlsProxy(activeProxy)
        },
        async () => {
          const activeWorker = worker
          worker = null
          if (activeWorker) await stopDetachedProcessTree(activeWorker)
        },
      ],
      'credential forward-recovery cleanup',
    )
  })
  const removeSignalCleanup = installSignalCleanup(cleanup)
  const material = recoveryContext.material
  const currentStage = recoveryContext.current.stage
  const forwardStage = material.stages.forward_recovery
  if (
    currentStage?.digests?.credential !==
      material.stages.user_key_rotation?.digests?.credential ||
    forwardStage?.digests?.userKey !== currentStage?.digests?.userKey ||
    forwardStage?.digests?.vault !== currentStage?.digests?.vault ||
    forwardStage?.digests?.accountKeys !== currentStage?.digests?.accountKeys
  ) {
    throw new Error('forward-recovery credential stages were inconsistent')
  }
  const recoveryOrigin = validateRecoveryOfficialOrigin(
    recoveryContext.officialOrigin,
  )
  const runId = sha256(`${persistTo}\nforward\n${Date.now()}`).slice(0, 12)
  let tls
  let ports
  let baseUrl
  let officialBaseUrl

  const start = async ({ writersEnabled, quotaEnabled, withProxy }) => {
    worker = startWorker({
      persistTo,
      port: ports[0],
      inspectorPort: ports[1],
      email: material.email,
      credentialWritersEnabled: writersEnabled,
      globalRequestQuotaEnabled: quotaEnabled,
    })
    baseUrl = `http://127.0.0.1:${ports[0]}`
    await waitForHealth(baseUrl, worker)
    if (withProxy) {
      proxy = await startTlsProxy({
        backendPort: ports[0],
        certificatePath: tls.certificatePath,
        keyPath: tls.keyPath,
        port: recoveryOrigin.port,
      })
      officialBaseUrl = recoveryOrigin.origin
    } else {
      officialBaseUrl = null
    }
  }

  const stop = async () => {
    const activeProxy = proxy
    const activeWorker = worker
    proxy = null
    worker = null
    await runCleanupSteps(
      [
        async () => {
          if (activeProxy) await stopTlsProxy(activeProxy)
        },
        async () => {
          if (activeWorker) await stopDetachedProcessTree(activeWorker)
        },
      ],
      'credential forward-recovery restart cleanup',
    )
  }

  const rejectPriorGenerations = async (phase, currentTokens) => {
    for (const stale of recoveryContext.stale) {
      await assertDirectGenerationRejected({
        baseUrl,
        material,
        previous: stale.previous,
        tokens: stale.tokens,
        label: `${stale.label}-forward-${phase}`,
      })
    }
    await assertDirectGenerationRejected({
      baseUrl,
      material,
      previous: currentStage,
      tokens: currentTokens,
      label: `pre-recovery-forward-${phase}`,
    })
    return recoveryContext.stale.length + 1
  }

  const rejectPriorSessions = async (phase, currentTokens) => {
    const priorSessions = [
      ...recoveryContext.stale.map((stale) => ({
        label: stale.label,
        tokens: stale.tokens,
      })),
      { label: 'pre-recovery', tokens: currentTokens },
    ]
    for (const prior of priorSessions) {
      const access = await authorizedJson(
        baseUrl,
        '/api/sync',
        prior.tokens.accessToken,
      )
      const refresh = await refreshGrant(baseUrl, prior.tokens.refreshToken)
      assertStatus(access, 401, `${prior.label} ${phase} old access session`)
      assertStatus(refresh, 400, `${prior.label} ${phase} old refresh session`)
    }
  }

  const rejectPriorProfiles = async (phase) => {
    let rejectedProfiles = 0
    for (const [index, stale] of recoveryContext.stale.entries()) {
      const profile = `hon226-${runId}-prior-${index}-${phase}`
      await cloneOfficialProfile(normalizedHarnessRoot, stale.profile, profile)
      await assertStaleProfileRejected({
        baseUrl: officialBaseUrl,
        caPath: tls.certificatePath,
        harnessRoot: normalizedHarnessRoot,
        profile,
        session: stale.session,
        label: `${stale.label}-forward-${phase}`,
        timeoutMs: timeout,
      })
      rejectedProfiles += 1
    }
    return rejectedProfiles
  }

  try {
    tls = await prepareTlsCertificate(persistTo, commandProcesses)
    ports = await findDistinctFreePorts(2, [recoveryOrigin.port])
    const baselineIdentity = await readPersistenceIdentity('baseline')
    assertPersistenceIdentityUnchanged(
      baselineIdentity,
      baselineIdentity,
      'baseline',
    )
    const disabledWriters = [
      {
        id: 'account_keys',
        path: '/api/accounts/keys',
        message: 'Account keys are not activated on this server.',
      },
      {
        id: 'password_change',
        path: '/api/accounts/password',
        message: 'Password change is not activated on this server.',
      },
      {
        id: 'kdf_mutation',
        path: '/api/accounts/kdf',
        message: 'KDF mutation is not activated on this server.',
      },
      {
        id: 'user_key_rotation',
        path: '/api/accounts/key-management/rotate-user-account-keys',
        message: 'User-key rotation is not activated on this server.',
      },
    ]
    const disabledReadbacks = []
    for (const writer of disabledWriters) {
      await start({
        writersEnabled: false,
        quotaEnabled: true,
        withProxy: false,
      })
      let response
      try {
        response = await requestJson(baseUrl, writer.path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      } finally {
        await stop()
      }
      assertStatus(response, 501, `${writer.id} disabled writer`)
      assert(
        response.body?.error?.code === 'unsupported_feature' &&
          response.body?.error?.message === writer.message,
        `${writer.id} disabled writer response was inconsistent`,
      )
      const identity = await readPersistenceIdentity(writer.id)
      assertPersistenceIdentityUnchanged(baselineIdentity, identity, writer.id)
      disabledReadbacks.push({
        id: writer.id,
        status: response.status,
        identity,
      })
    }

    await start({
      writersEnabled: true,
      quotaEnabled: false,
      withProxy: true,
    })
    const currentLogin = await passwordGrant(
      baseUrl,
      material,
      currentStage,
      'forward-current-api',
    )
    assertStatus(currentLogin, 200, 'forward current API login')
    const currentTokens = readTokens(currentLogin, 'forward-current')
    const preRecoveryProfile = `hon226-${runId}-pre-recovery`
    const staleProfileAfterMutation = `${preRecoveryProfile}-stale-mutation`
    const staleProfileAfterRestart = `${preRecoveryProfile}-stale-restart`
    const preRecoveryOfficial = await verifyOfficialStage({
      baseUrl: officialBaseUrl,
      caPath: tls.certificatePath,
      harnessRoot: normalizedHarnessRoot,
      material,
      profile: preRecoveryProfile,
      stage: currentStage,
      timeoutMs: timeout,
    })
    await cloneOfficialProfile(
      normalizedHarnessRoot,
      preRecoveryProfile,
      staleProfileAfterMutation,
    )
    await cloneOfficialProfile(
      normalizedHarnessRoot,
      preRecoveryProfile,
      staleProfileAfterRestart,
    )
    const before = await readGenerationSnapshot(persistTo, commandProcesses)
    const r2Before = await readR2Sentinel(
      persistTo,
      'forward-recovery-before',
      commandProcesses,
    )
    const mutationBody = passwordChangeBody(
      material.email,
      currentStage,
      forwardStage,
    )
    const concurrentResponses = await Promise.all([
      postCredentialJson(
        baseUrl,
        '/api/accounts/password',
        currentTokens.accessToken,
        mutationBody,
      ),
      postCredentialJson(
        baseUrl,
        '/api/accounts/password',
        currentTokens.accessToken,
        mutationBody,
      ),
    ])
    const concurrentStatuses = concurrentResponses
      .map((response) => response.status)
      .sort((left, right) => left - right)
    assert(
      concurrentStatuses.filter((status) => status === 200).length === 1 &&
        concurrentStatuses.every((status) => [200, 401, 409].includes(status)),
      `forward recovery concurrency returned ${concurrentStatuses.join(',')}`,
    )
    const after = await readGenerationSnapshot(persistTo, commandProcesses)
    assertNoForeignKeyViolations(after, 'forward recovery')
    assertGenerationMatches(after, forwardStage, 'forward recovery')
    const r2After = await readR2Sentinel(
      persistTo,
      'forward-recovery-after',
      commandProcesses,
    )
    assert(
      r2After.equals(r2Before),
      'forward recovery changed immutable R2 bytes',
    )
    const auditDelta = after.auditContexts.slice(before.auditContexts.length)
    assert(
      after.user.securityStamp !== before.user.securityStamp &&
        after.user.revisionDate > before.user.revisionDate &&
        auditDelta.length === 1 &&
        auditDelta[0]?.name === 'account.password.change' &&
        after.wrapperHistory.length === before.wrapperHistory.length + 1,
      'forward recovery did not commit exactly one credential generation',
    )
    assert(
      findSecretAuditMatches(after.auditContexts, material, [
        currentTokens.accessToken,
        currentTokens.refreshToken,
      ]).total === 0,
      'forward recovery audit context contained private material',
    )

    const replay = await postCredentialJson(
      baseUrl,
      '/api/accounts/password',
      currentTokens.accessToken,
      mutationBody,
    )
    assert(
      replay.status === 401 || replay.status === 409,
      `forward recovery replay returned ${replay.status}`,
    )
    const afterReplay = await readGenerationSnapshot(
      persistTo,
      commandProcesses,
    )
    const r2AfterReplay = await readR2Sentinel(
      persistTo,
      'forward-recovery-replay',
      commandProcesses,
    )
    assert(
      generationStateEqual(after, afterReplay) && r2AfterReplay.equals(r2After),
      'forward recovery replay changed D1/R2 state',
    )

    const forwardLogin = await passwordGrant(
      baseUrl,
      material,
      forwardStage,
      'forward-recovery-api',
    )
    assertStatus(forwardLogin, 200, 'forward recovery API login')
    const forwardTokens = readTokens(forwardLogin, 'forward-recovery')
    const forwardOfficial = await verifyOfficialStage({
      baseUrl: officialBaseUrl,
      caPath: tls.certificatePath,
      harnessRoot: normalizedHarnessRoot,
      material,
      profile: `hon226-${runId}-forward`,
      stage: forwardStage,
      timeoutMs: timeout,
    })
    const forwardState = await generationStateCheckpoint({
      id: 'forward_recovery',
      expectedStage: forwardStage,
      persistTo,
      commandProcesses,
    })
    await rejectPriorSessions('before-restart', currentTokens)
    await assertStaleProfileRejected({
      baseUrl: officialBaseUrl,
      caPath: tls.certificatePath,
      harnessRoot: normalizedHarnessRoot,
      profile: staleProfileAfterMutation,
      session: preRecoveryOfficial.session,
      label: 'pre-recovery-official-before-restart',
      timeoutMs: timeout,
    })

    await stop()
    await start({
      writersEnabled: true,
      quotaEnabled: false,
      withProxy: true,
    })
    const forwardAccess = await authorizedJson(
      baseUrl,
      '/api/sync',
      forwardTokens.accessToken,
    )
    assertStatus(forwardAccess, 200, 'forward recovery access after restart')
    const forwardRefresh = await refreshGrant(
      baseUrl,
      forwardTokens.refreshToken,
    )
    assertStatus(forwardRefresh, 200, 'forward recovery refresh after restart')
    const forwardRestartOfficial = await verifyOfficialStage({
      baseUrl: officialBaseUrl,
      caPath: tls.certificatePath,
      harnessRoot: normalizedHarnessRoot,
      material,
      profile: `hon226-${runId}-forward-restart`,
      stage: forwardStage,
      timeoutMs: timeout,
    })
    const rejectedHistoricalProfilesAfterRestart =
      await rejectPriorProfiles('after-restart')
    await assertStaleProfileRejected({
      baseUrl: officialBaseUrl,
      caPath: tls.certificatePath,
      harnessRoot: normalizedHarnessRoot,
      profile: staleProfileAfterRestart,
      session: preRecoveryOfficial.session,
      label: 'pre-recovery-official-after-restart',
      timeoutMs: timeout,
    })
    const rejectedProfilesAfterRestart =
      rejectedHistoricalProfilesAfterRestart + 1
    const rejectedGenerationsAfterRestart = await rejectPriorGenerations(
      'after-restart',
      currentTokens,
    )
    const finalState = await generationStateCheckpoint({
      id: 'forward_recovery_restart',
      expectedStage: forwardStage,
      persistTo,
      commandProcesses,
    })
    const checks = [
      check(
        'all_disabled_writers_are_canonical_no_ops',
        disabledReadbacks.length === 4,
      ),
      check(
        'same_target_reenabled_without_restore_reset',
        disabledReadbacks.every(
          (entry) =>
            entry.identity.combinedSha256 === baselineIdentity.combinedSha256,
        ),
      ),
      check(
        'concurrent_forward_recovery_commits_exactly_once',
        concurrentStatuses.filter((status) => status === 200).length === 1 &&
          auditDelta.length === 1,
      ),
      check(
        'retry_cannot_commit_second_generation',
        replay.status === 401 || replay.status === 409,
      ),
      check(
        'all_five_prior_generations_remain_rejected',
        rejectedGenerationsAfterRestart === recoveryContext.stale.length + 1 &&
          rejectedProfilesAfterRestart === recoveryContext.stale.length + 1,
      ),
      check(
        'official_client_decrypts_forward_generation_after_restart',
        forwardOfficial.itemRead && forwardRestartOfficial.itemRead,
      ),
      check('forward_recovery_preserves_r2', r2After.equals(r2Before)),
      check(
        'forward_recovery_foreign_keys_remain_valid',
        forwardState.d1.foreignKeyViolations === 0 &&
          finalState.d1.foreignKeyViolations === 0,
      ),
    ]
    if (checks.some((entry) => entry.status !== 'pass')) {
      throw new Error('credential forward-recovery checks failed')
    }
    return {
      status: 'passed',
      disabled: {
        writerCount: disabledReadbacks.length,
        baselineIdentity,
        requests: disabledReadbacks,
      },
      mutation: {
        concurrentStatuses,
        replayStatus: replay.status,
        securityStampChanged: true,
        revisionAdvanced: true,
        auditDelta: auditDelta.length,
        wrapperHistoryDelta:
          after.wrapperHistory.length - before.wrapperHistory.length,
        r2Unchanged: true,
      },
      rejectedPriorSessions: {
        beforeRestart: recoveryContext.stale.length + 1,
      },
      rejectedPriorGenerations: {
        afterRestart: rejectedGenerationsAfterRestart,
        profilesAfterRestart: rejectedProfilesAfterRestart,
      },
      officialClient: {
        beforeRestart: redactOfficialReadback(forwardOfficial),
        afterRestart: redactOfficialReadback(forwardRestartOfficial),
      },
      forward: forwardState,
      final: finalState,
      checks,
    }
  } finally {
    try {
      await cleanup()
    } finally {
      removeSignalCleanup()
    }
  }
}

function redactOfficialReadback(official) {
  return {
    itemRead: official.itemRead,
    commandDigests: official.commandDigests,
  }
}

function requireRecoveryProfile(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('credential recovery profile snapshot was missing')
  }
  return value
}

export function buildCredentialLifecycleProfiles(runId) {
  if (typeof runId !== 'string' || !/^[a-f0-9]{12}$/.test(runId)) {
    throw new Error('credential lifecycle run id was invalid')
  }
  const prefix = `hon220-${runId}`
  return {
    baseline: `${prefix}-baseline`,
    accountKeys: `${prefix}-account-keys`,
    passwordChange: `${prefix}-password-change`,
    passwordChangeRestart: `${prefix}-password-change-restart`,
    argon2id: `${prefix}-argon2id`,
    argon2idRestart: `${prefix}-argon2id-restart`,
    pbkdf2Return: `${prefix}-pbkdf2-return`,
    pbkdf2ReturnRestart: `${prefix}-pbkdf2-return-restart`,
    userKeyRotation: `${prefix}-user-key-rotation`,
    restartReadback: `${prefix}-restart-readback`,
  }
}

export function buildRestoredStaleProfileName(runId, index, phase) {
  if (
    typeof runId !== 'string' ||
    !/^[a-f0-9]{12}$/.test(runId) ||
    !Number.isInteger(index) ||
    index < 0 ||
    index > 3 ||
    !['before-restart', 'after-restart'].includes(phase)
  ) {
    throw new Error('restored stale profile coordinates were invalid')
  }
  return `hon225-${runId}-stale-${index}-${phase}`
}

export function validateRecoveryOfficialOrigin(value) {
  const origin = validateLoopbackOrigin(value)
  const parsed = new globalThis.URL(origin)
  const port = Number.parseInt(parsed.port, 10)
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'localhost' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw new Error(
      'credential recovery origin must be explicit localhost HTTPS',
    )
  }
  return { origin, port }
}

export function normalizeCredentialMaterial(value) {
  const stages = value?.credentialStages
  const expected = [
    ['baseline', 'pbkdf2', 1],
    ['password_change', 'pbkdf2', 1],
    ['argon2id', 'argon2id', 1],
    ['pbkdf2_return', 'pbkdf2', 1],
    ['user_key_rotation', 'pbkdf2', 2],
    ['forward_recovery', 'pbkdf2', 2],
  ]
  if (
    typeof value?.email !== 'string' ||
    !value.email.endsWith('@example.invalid') ||
    !Array.isArray(stages) ||
    stages.length !== expected.length ||
    typeof value?.plaintext !== 'object' ||
    value.plaintext === null
  ) {
    throw new Error('official credential material was invalid')
  }
  const stageMap = {}
  for (let index = 0; index < expected.length; index += 1) {
    const [id, kdfId, userKeyGeneration] = expected[index]
    const stage = stages[index]
    if (
      stage?.id !== id ||
      stage?.kdfId !== kdfId ||
      stage?.userKeyGeneration !== userKeyGeneration ||
      !nonEmpty(stage?.password) ||
      !nonEmpty(stage?.masterPasswordAuthenticationHash) ||
      !nonEmpty(stage?.masterKeyEncryptedUserKey) ||
      !nonEmpty(stage?.accountKeys?.accountPublicKey) ||
      !nonEmpty(stage?.accountKeys?.userKeyEncryptedAccountPrivateKey) ||
      !isVaultMaterial(stage?.vault) ||
      !isDigestSet(stage?.digests)
    ) {
      throw new Error('official credential stage was invalid')
    }
    stageMap[id] = stage
  }
  for (const key of [
    'folderName',
    'itemName',
    'itemUsername',
    'itemPassword',
    'itemUri',
    'itemNotes',
    'attachmentFileName',
    'attachmentKey',
  ]) {
    if (!nonEmpty(value.plaintext[key])) {
      throw new Error('official credential plaintext was invalid')
    }
  }
  return {
    email: value.email,
    plaintext: value.plaintext,
    stages: stageMap,
  }
}

function isVaultMaterial(value) {
  return [
    value?.folderName,
    value?.cipher?.name,
    value?.cipher?.username,
    value?.cipher?.password,
    value?.cipher?.uri,
    value?.cipher?.notes,
    value?.attachment?.fileName,
    value?.attachment?.key,
  ].every((field) => nonEmpty(field) && field.startsWith('2.'))
}

function isDigestSet(value) {
  return [
    value?.userKey,
    value?.wrappedUserKey,
    value?.accountKeys,
    value?.vault,
    value?.credential,
  ].every(isSha256)
}

async function initializeState(
  persistTo,
  material,
  generatedAt,
  commandProcesses,
) {
  await runWrangler(
    [
      'd1',
      'migrations',
      'apply',
      databaseName,
      '--local',
      '--persist-to',
      persistTo,
    ],
    commandProcesses,
  )
  await runWrangler(
    [
      'd1',
      'execute',
      databaseName,
      '--local',
      '--persist-to',
      persistTo,
      '--command',
      seedSql(material, generatedAt),
      '--yes',
      '--json',
    ],
    commandProcesses,
  )
  await putR2Sentinel(persistTo, commandProcesses)
}

function seedSql(material, generatedAt) {
  const baseline = material.stages.baseline
  return `
    INSERT INTO users (
      id, email, email_normalized, display_name, kdf_algorithm,
      kdf_iterations, kdf_memory, kdf_parallelism, master_password_hash,
      user_key, public_key, private_key, security_stamp, revision_date,
      created_at, updated_at
    ) VALUES (
      ${sql(actor.userId)}, ${sql(material.email)}, ${sql(material.email)},
      'HON-220 Official Credential Lifecycle', 'pbkdf2-sha256', 600000,
      NULL, NULL, ${sql(baseline.masterPasswordAuthenticationHash)},
      ${sql(baseline.masterKeyEncryptedUserKey)}, NULL, NULL,
      ${sql(randomUUID())}, ${sql(initialRevision)}, ${sql(generatedAt)},
      ${sql(generatedAt)}
    );
    INSERT INTO folders (
      id, user_id, encrypted_name, revision_date, created_at, updated_at
    ) VALUES (
      ${sql(actor.folderId)}, ${sql(actor.userId)},
      ${sql(baseline.vault.folderName)}, ${sql(initialRevision)},
      ${sql(generatedAt)}, ${sql(generatedAt)}
    );
    INSERT INTO ciphers (
      id, user_id, folder_id, type, favorite, encrypted_json, revision_date,
      created_at, updated_at, organization_id, cipher_key
    ) VALUES (
      ${sql(actor.cipherId)}, ${sql(actor.userId)}, ${sql(actor.folderId)},
      1, 0, ${sql(JSON.stringify(storedCipherPayload(baseline)))},
      ${sql(initialRevision)}, ${sql(generatedAt)}, ${sql(generatedAt)},
      NULL, NULL
    );
    INSERT INTO cipher_attachments (
      id, user_id, cipher_id, object_key, file_name, attachment_key, size,
      content_type, revision_date, created_at, updated_at
    ) VALUES (
      ${sql(actor.attachmentId)}, ${sql(actor.userId)}, ${sql(actor.cipherId)},
      ${sql(actor.r2ObjectKey)}, ${sql(baseline.vault.attachment.fileName)},
      ${sql(baseline.vault.attachment.key)}, ${r2SentinelBody.byteLength},
      'application/octet-stream', ${sql(initialRevision)},
      ${sql(generatedAt)}, ${sql(generatedAt)}
    );
    CREATE TRIGGER hon220_fail_rotation_audit
    BEFORE INSERT ON audit_events
    WHEN NEW.name = 'account.keys.rotate'
      AND NEW.actor_user_id = ${sql(actor.userId)}
    BEGIN
      SELECT RAISE(ABORT, 'synthetic HON-220 required-audit failure');
    END;
  `
}

function storedCipherPayload(stage) {
  return {
    type: 1,
    folderId: actor.folderId,
    organizationId: null,
    favorite: false,
    reprompt: 0,
    archivedDate: null,
    name: stage.vault.cipher.name,
    notes: stage.vault.cipher.notes,
    key: null,
    login: {
      username: stage.vault.cipher.username,
      password: stage.vault.cipher.password,
      totp: null,
      passwordRevisionDate: initialRevision,
      autofillOnPageLoad: false,
      uris: [
        {
          uri: stage.vault.cipher.uri,
          match: 0,
          uriChecksum: null,
        },
      ],
      fido2Credentials: [],
    },
    secureNote: null,
    card: null,
    identity: null,
    sshKey: null,
    bankAccount: null,
    driversLicense: null,
    passport: null,
    fields: [],
    passwordHistory: [],
  }
}

function rotationCipherPayload(stage) {
  return {
    id: actor.cipherId,
    encryptedFor: actor.userId,
    ...storedCipherPayload(stage),
    attachments: {
      [actor.attachmentId]: stage.vault.attachment.fileName,
    },
    attachments2: {
      [actor.attachmentId]: {
        fileName: stage.vault.attachment.fileName,
        key: stage.vault.attachment.key,
        lastKnownRevisionDate: initialRevision,
      },
    },
    lastKnownRevisionDate: initialRevision,
  }
}

async function runGenerationSequence(context) {
  const {
    fixtureReadback,
    harnessRoot,
    material,
    caPath,
    commandProcesses,
    persistTo,
    profiles,
    restartWorker,
    runBrowserExtension,
  } = context
  let baseUrl = context.baseUrl
  let officialBaseUrl = context.officialBaseUrl
  const generationManifest = []
  const rejected = {
    passwords: [],
    accessTokens: [],
    refreshTokens: [],
    profiles: [],
  }
  const issuedTokens = []
  const recoveryProfileSnapshots = new Map()
  const snapshotRecoveryProfile = async (generation, profile) => {
    if (!context.captureRecoveryContext) return
    const snapshot = `${profile}-recovery-snapshot`
    await cloneOfficialProfile(harnessRoot, profile, snapshot)
    recoveryProfileSnapshots.set(generation, snapshot)
  }

  const baselineLogin = await passwordGrant(
    baseUrl,
    material,
    material.stages.baseline,
    'baseline-api',
  )
  assertStatus(baselineLogin, 200, 'baseline API login')
  const baselineTokens = readTokens(baselineLogin, 'baseline', issuedTokens)
  const missingKeys = await authorizedJson(
    baseUrl,
    '/api/accounts/keys',
    baselineTokens.accessToken,
  )
  assertStatus(missingKeys, 409, 'missing account keys')

  const baselineState = await generationStateCheckpoint({
    id: 'baseline',
    expectedStage: material.stages.baseline,
    expectAccountKeys: false,
    persistTo,
    commandProcesses,
  })

  const baselinePair = material.stages.baseline.accountKeys
  const accountKeys = await postAccountKeys(
    baseUrl,
    baselineTokens.accessToken,
    baselinePair,
  )
  assertStatus(accountKeys, 200, 'account-key initialization')
  const accountKeysRead = await authorizedJson(
    baseUrl,
    '/api/accounts/keys',
    baselineTokens.accessToken,
  )
  assertStatus(accountKeysRead, 200, 'account-key read')
  assertAccountKeys(accountKeysRead.body, baselinePair)
  const accountKeysReplay = await postAccountKeys(
    baseUrl,
    baselineTokens.accessToken,
    baselinePair,
  )
  assertStatus(accountKeysReplay, 200, 'account-key exact replay')
  const conflictingKeys = await postAccountKeys(
    baseUrl,
    baselineTokens.accessToken,
    material.stages.user_key_rotation.accountKeys,
  )
  assertStatus(conflictingKeys, 409, 'account-key conflicting replacement')
  const baselineOfficial = await verifyOfficialStage({
    baseUrl: officialBaseUrl,
    caPath,
    harnessRoot,
    material,
    profile: profiles.baseline,
    stage: material.stages.baseline,
  })
  await snapshotRecoveryProfile('baseline', profiles.baseline)
  generationManifest.push(
    attachOfficialGenerationEvidence(baselineState, baselineOfficial, {
      accountKeysInitializedAtRead: true,
    }),
  )
  const accountKeysOfficial = await verifyOfficialStage({
    baseUrl: officialBaseUrl,
    caPath,
    harnessRoot,
    material,
    profile: profiles.accountKeys,
    stage: material.stages.baseline,
  })
  generationManifest.push(
    await generationCheckpoint({
      id: 'account_keys',
      expectedStage: material.stages.baseline,
      official: accountKeysOfficial,
      persistTo,
      commandProcesses,
    }),
  )

  const passwordMutation = await postCredentialJson(
    baseUrl,
    '/api/accounts/password',
    baselineTokens.accessToken,
    passwordChangeBody(
      material.email,
      material.stages.baseline,
      material.stages.password_change,
    ),
  )
  assertStatus(passwordMutation, 200, 'password change')
  await assertDirectGenerationRejected({
    baseUrl,
    material,
    previous: material.stages.baseline,
    tokens: baselineTokens,
    label: 'password-change',
    rejected,
  })
  await assertStaleProfileRejected({
    baseUrl: officialBaseUrl,
    caPath,
    harnessRoot,
    profile: profiles.accountKeys,
    session: accountKeysOfficial.session,
    label: 'password-change',
    rejected,
  })
  const passwordOfficial = await verifyOfficialStage({
    baseUrl: officialBaseUrl,
    caPath,
    harnessRoot,
    material,
    profile: profiles.passwordChange,
    stage: material.stages.password_change,
  })
  const passwordLogin = await passwordGrant(
    baseUrl,
    material,
    material.stages.password_change,
    'password-change-api',
  )
  assertStatus(passwordLogin, 200, 'password-change API login')
  const passwordTokens = readTokens(
    passwordLogin,
    'password-change',
    issuedTokens,
  )
  generationManifest.push(
    await generationCheckpoint({
      id: 'password_change',
      expectedStage: material.stages.password_change,
      official: passwordOfficial,
      persistTo,
      commandProcesses,
    }),
  )
  const passwordRestartOfficial = await verifyOfficialStage({
    baseUrl: officialBaseUrl,
    caPath,
    harnessRoot,
    material,
    profile: profiles.passwordChangeRestart,
    stage: material.stages.password_change,
  })
  await snapshotRecoveryProfile(
    'password_change',
    profiles.passwordChangeRestart,
  )

  const argonMutation = await postCredentialJson(
    baseUrl,
    '/api/accounts/kdf',
    passwordTokens.accessToken,
    kdfChangeBody(
      material.email,
      material.stages.password_change,
      material.stages.argon2id,
    ),
  )
  assertStatus(argonMutation, 200, 'Argon2id change')
  await assertDirectGenerationRejected({
    baseUrl,
    material,
    previous: material.stages.password_change,
    tokens: passwordTokens,
    label: 'argon2id',
    rejected,
  })
  await assertStaleProfileRejected({
    baseUrl: officialBaseUrl,
    caPath,
    harnessRoot,
    profile: profiles.passwordChange,
    session: passwordOfficial.session,
    label: 'argon2id',
    rejected,
  })
  ;({ baseUrl, officialBaseUrl } = await restartWorker())
  const argonOfficial = await verifyOfficialStage({
    baseUrl: officialBaseUrl,
    caPath,
    harnessRoot,
    material,
    profile: profiles.argon2id,
    stage: material.stages.argon2id,
  })
  const argonLogin = await passwordGrant(
    baseUrl,
    material,
    material.stages.argon2id,
    'argon2id-api',
  )
  assertStatus(argonLogin, 200, 'Argon2id API login')
  const argonTokens = readTokens(argonLogin, 'argon2id', issuedTokens)
  generationManifest.push(
    await generationCheckpoint({
      id: 'argon2id',
      expectedStage: material.stages.argon2id,
      official: argonOfficial,
      persistTo,
      commandProcesses,
    }),
  )
  const argonRestartOfficial = await verifyOfficialStage({
    baseUrl: officialBaseUrl,
    caPath,
    harnessRoot,
    material,
    profile: profiles.argon2idRestart,
    stage: material.stages.argon2id,
  })
  await snapshotRecoveryProfile('argon2id', profiles.argon2idRestart)

  const pbkdf2Mutation = await postCredentialJson(
    baseUrl,
    '/api/accounts/kdf',
    argonTokens.accessToken,
    kdfChangeBody(
      material.email,
      material.stages.argon2id,
      material.stages.pbkdf2_return,
    ),
  )
  assertStatus(pbkdf2Mutation, 200, 'PBKDF2 return')
  await assertDirectGenerationRejected({
    baseUrl,
    material,
    previous: material.stages.argon2id,
    tokens: argonTokens,
    label: 'pbkdf2-return',
    rejected,
  })
  await assertStaleProfileRejected({
    baseUrl: officialBaseUrl,
    caPath,
    harnessRoot,
    profile: profiles.argon2id,
    session: argonOfficial.session,
    label: 'pbkdf2-return',
    rejected,
  })
  const pbkdf2Official = await verifyOfficialStage({
    baseUrl: officialBaseUrl,
    caPath,
    harnessRoot,
    material,
    profile: profiles.pbkdf2Return,
    stage: material.stages.pbkdf2_return,
  })
  const pbkdf2Login = await passwordGrant(
    baseUrl,
    material,
    material.stages.pbkdf2_return,
    'pbkdf2-return-api',
  )
  assertStatus(pbkdf2Login, 200, 'PBKDF2 return API login')
  const pbkdf2Tokens = readTokens(pbkdf2Login, 'pbkdf2-return', issuedTokens)
  generationManifest.push(
    await generationCheckpoint({
      id: 'pbkdf2_return',
      expectedStage: material.stages.pbkdf2_return,
      official: pbkdf2Official,
      persistTo,
      commandProcesses,
    }),
  )
  const pbkdf2RestartOfficial = await verifyOfficialStage({
    baseUrl: officialBaseUrl,
    caPath,
    harnessRoot,
    material,
    profile: profiles.pbkdf2ReturnRestart,
    stage: material.stages.pbkdf2_return,
  })
  await snapshotRecoveryProfile('pbkdf2_return', profiles.pbkdf2ReturnRestart)

  const beforeRollback = await readGenerationSnapshot(
    persistTo,
    commandProcesses,
  )
  assertNoForeignKeyViolations(beforeRollback, 'before rollback')
  const beforeRollbackR2 = await readR2Sentinel(
    persistTo,
    'before-rollback',
    commandProcesses,
  )
  const rotationBody = userKeyRotationBody(
    material.email,
    material.stages.pbkdf2_return,
    material.stages.user_key_rotation,
  )
  const rollbackRotation = await postRotation(
    baseUrl,
    pbkdf2Tokens.accessToken,
    rotationBody,
    'rollback',
  )
  assertStatus(rollbackRotation, 503, 'required-audit rotation rollback')
  const afterRollback = await readGenerationSnapshot(
    persistTo,
    commandProcesses,
  )
  assertNoForeignKeyViolations(afterRollback, 'after rollback')
  const afterRollbackR2 = await readR2Sentinel(
    persistTo,
    'after-rollback',
    commandProcesses,
  )
  assert(
    generationStateEqual(beforeRollback, afterRollback),
    'required-audit failure changed D1 generation state',
  )
  assert(
    beforeRollbackR2.equals(afterRollbackR2),
    'required-audit failure changed R2 bytes',
  )
  const rollbackAccess = await authorizedJson(
    baseUrl,
    '/api/sync',
    pbkdf2Tokens.accessToken,
  )
  assertStatus(rollbackAccess, 200, 'access after required-audit rollback')
  await assertProfileStillValid({
    baseUrl: officialBaseUrl,
    caPath,
    harnessRoot,
    profile: profiles.pbkdf2Return,
    session: pbkdf2Official.session,
  })

  await executeLocalSql(
    persistTo,
    'DROP TRIGGER hon220_fail_rotation_audit;',
    commandProcesses,
  )
  const concurrentRotations = await Promise.all([
    postRotation(
      baseUrl,
      pbkdf2Tokens.accessToken,
      rotationBody,
      'concurrent-first',
    ),
    postRotation(
      baseUrl,
      pbkdf2Tokens.accessToken,
      rotationBody,
      'concurrent-second',
    ),
  ])
  const concurrentStatuses = concurrentRotations
    .map((response) => response.status)
    .sort((left, right) => left - right)
  assert(
    concurrentStatuses.filter((status) => status === 200).length === 1 &&
      concurrentStatuses.every((status) =>
        [200, 400, 401, 409].includes(status),
      ),
    'concurrent rotation did not commit exactly one generation',
  )
  const currentGenerationLogin = await passwordGrant(
    baseUrl,
    material,
    material.stages.user_key_rotation,
    'stale-wrapped-generation-api',
  )
  assertStatus(currentGenerationLogin, 200, 'current-generation API login')
  const currentGenerationTokens = readTokens(
    currentGenerationLogin,
    'current-generation',
    issuedTokens,
  )
  const staleRotationBody = userKeyRotationBody(
    material.email,
    material.stages.user_key_rotation,
    material.stages.pbkdf2_return,
  )
  const beforeStaleWrapped = await readGenerationSnapshot(
    persistTo,
    commandProcesses,
  )
  const beforeStaleWrappedR2 = await readR2Sentinel(
    persistTo,
    'before-stale-wrapped',
    commandProcesses,
  )
  const staleWrappedGeneration = await postRotation(
    baseUrl,
    currentGenerationTokens.accessToken,
    staleRotationBody,
    'stale-wrapped-generation',
  )
  assertStaleWrappedGenerationResponse(staleWrappedGeneration)
  const afterStaleWrapped = await readGenerationSnapshot(
    persistTo,
    commandProcesses,
  )
  const afterStaleWrappedR2 = await readR2Sentinel(
    persistTo,
    'after-stale-wrapped',
    commandProcesses,
  )
  assert(
    generationStateEqual(beforeStaleWrapped, afterStaleWrapped),
    'stale wrapped generation changed D1 generation state',
  )
  assert(
    beforeStaleWrappedR2.equals(afterStaleWrappedR2),
    'stale wrapped generation changed R2 bytes',
  )
  await assertDirectGenerationRejected({
    baseUrl,
    material,
    previous: material.stages.pbkdf2_return,
    tokens: pbkdf2Tokens,
    label: 'user-key-rotation',
    rejected,
  })
  await assertStaleProfileRejected({
    baseUrl: officialBaseUrl,
    caPath,
    harnessRoot,
    profile: profiles.pbkdf2Return,
    session: pbkdf2Official.session,
    label: 'user-key-rotation',
    rejected,
  })
  const rotationOfficial = await verifyOfficialStage({
    baseUrl: officialBaseUrl,
    caPath,
    harnessRoot,
    material,
    profile: profiles.userKeyRotation,
    stage: material.stages.user_key_rotation,
  })
  generationManifest.push(
    await generationCheckpoint({
      id: 'user_key_rotation',
      expectedStage: material.stages.user_key_rotation,
      official: rotationOfficial,
      persistTo,
      commandProcesses,
    }),
  )

  ;({ baseUrl, officialBaseUrl } = await restartWorker())
  const staleGenerationsAfterRestart = [
    {
      label: 'baseline-after-restart',
      previous: material.stages.baseline,
      profile: profiles.baseline,
      recoveryProfile: recoveryProfileSnapshots.get('baseline'),
      session: baselineOfficial.session,
      tokens: baselineTokens,
    },
    {
      label: 'password-change-after-restart',
      previous: material.stages.password_change,
      profile: profiles.passwordChangeRestart,
      recoveryProfile: recoveryProfileSnapshots.get('password_change'),
      session: passwordRestartOfficial.session,
      tokens: passwordTokens,
    },
    {
      label: 'argon2id-after-restart',
      previous: material.stages.argon2id,
      profile: profiles.argon2idRestart,
      recoveryProfile: recoveryProfileSnapshots.get('argon2id'),
      session: argonRestartOfficial.session,
      tokens: argonTokens,
    },
    {
      label: 'pbkdf2-return-after-restart',
      previous: material.stages.pbkdf2_return,
      profile: profiles.pbkdf2ReturnRestart,
      recoveryProfile: recoveryProfileSnapshots.get('pbkdf2_return'),
      session: pbkdf2RestartOfficial.session,
      tokens: pbkdf2Tokens,
    },
  ]
  for (const stale of staleGenerationsAfterRestart) {
    await assertDirectGenerationRejected({
      baseUrl,
      material,
      previous: stale.previous,
      tokens: stale.tokens,
      label: stale.label,
    })
    await assertStaleProfileRejected({
      baseUrl: officialBaseUrl,
      caPath,
      harnessRoot,
      profile: stale.profile,
      session: stale.session,
      label: stale.label,
    })
  }
  const staleWrappedAfterRestart = await postRotation(
    baseUrl,
    currentGenerationTokens.accessToken,
    staleRotationBody,
    'stale-wrapped-generation-after-restart',
  )
  assertStaleWrappedGenerationResponse(staleWrappedAfterRestart)
  const restartOfficial = await verifyOfficialStage({
    baseUrl: officialBaseUrl,
    caPath,
    harnessRoot,
    material,
    profile: profiles.restartReadback,
    stage: material.stages.user_key_rotation,
  })
  generationManifest.push(
    await generationCheckpoint({
      id: 'restart_readback',
      expectedStage: material.stages.user_key_rotation,
      official: restartOfficial,
      persistTo,
      commandProcesses,
    }),
  )

  const browserExtension = runBrowserExtension
    ? await runBrowserExtension(officialBaseUrl)
    : null
  const finalR2 = await readR2Sentinel(persistTo, 'final', commandProcesses)
  const finalSnapshot = await readGenerationSnapshot(
    persistTo,
    commandProcesses,
  )
  assertNoForeignKeyViolations(finalSnapshot, 'final')
  assert(
    finalR2.equals(r2SentinelBody),
    'final R2 sentinel bytes were inconsistent',
  )
  assertGenerationMatches(
    finalSnapshot,
    material.stages.user_key_rotation,
    'final',
  )
  assert(
    finalSnapshot.wrapperHistory.length === 7 &&
      new Set(finalSnapshot.wrapperHistory.map((entry) => entry.wrapperSha256))
        .size === 7 &&
      finalSnapshot.wrapperHistory.every(
        (entry) =>
          ['user_key', 'private_key'].includes(entry.wrapperKind) &&
          /^[a-f0-9]{64}$/u.test(entry.wrapperSha256),
      ),
    'final wrapper history was incomplete or inconsistent',
  )
  const auditSecretMatches = findSecretAuditMatches(
    finalSnapshot.auditContexts,
    material,
    issuedTokens,
  )
  assertNoSecretAuditMaterial(auditSecretMatches)
  finalSnapshot.auditSecretMatches = auditSecretMatches.total

  const safeManifest = {
    schemaVersion,
    sameAccountTag: sha256(material.email.toLowerCase()),
    officialFixture: fixtureReadback,
    generations: generationManifest,
    rejectionCounts: {
      passwords: rejected.passwords.length,
      accessTokens: rejected.accessTokens.length,
      refreshTokens: rejected.refreshTokens.length,
      profiles: rejected.profiles.length,
    },
    rollback: {
      requiredAuditStatus: rollbackRotation.status,
      concurrentStatuses,
      staleWrappedGenerationStatus: staleWrappedGeneration.status,
      staleWrappedGenerationAfterRestartStatus: staleWrappedAfterRestart.status,
      d1Unchanged: true,
      r2Unchanged: true,
      staleWrappedD1Unchanged: true,
      staleWrappedR2Unchanged: true,
    },
    restartRejectionCounts: {
      passwords: staleGenerationsAfterRestart.length,
      accessTokens: staleGenerationsAfterRestart.length,
      refreshTokens: staleGenerationsAfterRestart.length,
      profiles: staleGenerationsAfterRestart.length,
    },
    final: redactGenerationSnapshot(finalSnapshot),
  }
  const generationManifestSha256 = sha256(JSON.stringify(safeManifest))
  const checks = [
    check(
      'same_account_forward_generation_chain',
      generationManifest.length === stagePlan.length,
    ),
    check(
      'fresh_official_cli_decrypts_every_generation',
      generationManifest.every(
        (entry) => entry.officialClient.itemRead === true,
      ),
    ),
    check(
      'old_password_access_refresh_and_profiles_rejected',
      rejected.passwords.length === 4 &&
        rejected.accessTokens.length === 4 &&
        rejected.refreshTokens.length === 4 &&
        rejected.profiles.length === 4,
    ),
    check(
      'required_audit_failure_rolls_back_d1_and_preserves_r2',
      rollbackRotation.status === 503,
    ),
    check(
      'concurrent_rotation_commits_one_generation',
      concurrentStatuses.filter((status) => status === 200).length === 1,
    ),
    check(
      'stale_wrapped_generation_rejected_with_current_token',
      staleWrappedGeneration.status === 400 &&
        staleWrappedGeneration.body?.error?.code === 'invalid_request',
    ),
    check(
      'restart_preserves_final_generation',
      staleGenerationsAfterRestart.length === 4 &&
        staleWrappedAfterRestart.status === 400 &&
        generationManifest.at(-1)?.id === 'restart_readback',
    ),
    check(
      'audit_contexts_are_secret_free',
      finalSnapshot.auditSecretMatches === 0,
    ),
    check(
      'wrapper_history_covers_every_superseded_generation',
      finalSnapshot.wrapperHistory.length === 7,
    ),
    check(
      'foreign_keys_remain_valid',
      generationManifest.every(
        (entry) => entry.d1.foreignKeyViolations === 0,
      ) && finalSnapshot.foreignKeyViolations === 0,
    ),
  ]
  if (browserExtension) {
    checks.push(
      check('fresh_browser_extension_decrypts_final_generation', true),
    )
  }
  if (checks.some((entry) => entry.status !== 'pass')) {
    throw new Error('credential lifecycle checks failed')
  }

  context.captureRecoveryContext?.({
    material,
    officialOrigin: officialBaseUrl,
    current: {
      stage: material.stages.user_key_rotation,
      tokens: currentGenerationTokens,
    },
    stale: staleGenerationsAfterRestart.map((entry) => ({
      label: entry.label,
      previous: entry.previous,
      profile: requireRecoveryProfile(entry.recoveryProfile),
      session: entry.session,
      tokens: entry.tokens,
    })),
  })

  const browserMode = Boolean(browserExtension)
  return {
    schemaVersion,
    status: 'passed',
    mode: browserMode
      ? 'wrangler-local-d1-r2-official-cli-browser-extension-synthetic'
      : 'wrangler-local-d1-r2-official-cli-synthetic',
    upstreamPins: {
      server: 'v2026.6.1@a09c7edb03ae6d4fdece784f1250c67be73d5fe0',
      cli: 'cli-v2026.6.0@e6293ff2bc85123e9baaa998cf1543030ec5d9f0',
      ...(browserMode
        ? {
            browser:
              'browser-v2026.6.1@723c075bf8b9f45c901e56195be8e94e43ed75a2',
          }
        : {}),
    },
    generationManifestSha256,
    generationManifest: safeManifest,
    checks,
    ...(browserExtension ? { browserExtension } : {}),
    limitations: browserMode
      ? [
          'Local synthetic D1/R2 and pinned official CLI/browser-extension evidence only.',
          'No remote Cloudflare resource, real account, normal browser profile, staging, or production resource was used.',
        ]
      : [
          'Local synthetic D1/R2 and pinned official CLI evidence only.',
          'No remote Cloudflare resource, real account, normal browser profile, staging, or production resource was used.',
          'The browser-extension clean-profile readback remains a separate HON-220 closeout gate.',
        ],
  }
}

function passwordChangeBody(email, current, next) {
  const kdf = {
    kdfType: 0,
    iterations: 600000,
    memory: null,
    parallelism: null,
  }
  return {
    masterPasswordHash: current.masterPasswordAuthenticationHash,
    newMasterPasswordHash: next.masterPasswordAuthenticationHash,
    key: next.masterKeyEncryptedUserKey,
    masterPasswordHint: '',
    authenticationData: {
      kdf,
      masterPasswordAuthenticationHash: next.masterPasswordAuthenticationHash,
      salt: email,
    },
    unlockData: {
      kdf,
      masterKeyWrappedUserKey: next.masterKeyEncryptedUserKey,
      salt: email,
    },
  }
}

function kdfChangeBody(email, current, next) {
  const kdf =
    next.kdfId === 'argon2id'
      ? {
          kdfType: 1,
          iterations: 3,
          memory: 64,
          parallelism: 4,
        }
      : {
          kdfType: 0,
          iterations: 600000,
          memory: null,
          parallelism: null,
        }
  return {
    masterPasswordHash: current.masterPasswordAuthenticationHash,
    authenticationData: {
      kdf,
      masterPasswordAuthenticationHash: next.masterPasswordAuthenticationHash,
      salt: email,
    },
    unlockData: {
      kdf,
      masterKeyWrappedUserKey: next.masterKeyEncryptedUserKey,
      salt: email,
    },
  }
}

export function userKeyRotationBody(email, current, next) {
  return {
    oldMasterKeyAuthenticationHash: current.masterPasswordAuthenticationHash,
    accountUnlockData: {
      masterPasswordUnlockData: {
        kdfType: 0,
        kdfIterations: 600000,
        email,
        masterKeyAuthenticationHash: next.masterPasswordAuthenticationHash,
        masterKeyEncryptedUserKey: next.masterKeyEncryptedUserKey,
      },
      emergencyAccessUnlockData: [],
      organizationAccountRecoveryUnlockData: [],
      passkeyUnlockData: [],
      deviceKeyUnlockData: [],
    },
    accountKeys: {
      userKeyEncryptedAccountPrivateKey:
        next.accountKeys.userKeyEncryptedAccountPrivateKey,
      accountPublicKey: next.accountKeys.accountPublicKey,
      publicKeyEncryptionKeyPair: {
        wrappedPrivateKey: next.accountKeys.userKeyEncryptedAccountPrivateKey,
        publicKey: next.accountKeys.accountPublicKey,
        signedPublicKey: null,
      },
      signatureKeyPair: null,
      securityState: null,
    },
    accountData: {
      ciphers: [rotationCipherPayload(next)],
      folders: [{ id: actor.folderId, name: next.vault.folderName }],
      sends: [],
    },
  }
}

async function verifyOfficialStage({
  baseUrl,
  caPath,
  harnessRoot,
  material,
  profile,
  stage,
  timeoutMs = 60_000,
}) {
  const login = await runOfficialCommand({
    args: [
      'login',
      material.email,
      '--passwordenv',
      'BW_PASSWORD',
      '--raw',
      '--nointeraction',
    ],
    baseUrl,
    caPath,
    harnessRoot,
    password: stage.password,
    profile,
    timeoutMs,
  })
  assertOfficialCommandSuccess(login, `${profile} login`)
  const loginSession = readOfficialSession(
    await readOfficialOutput(harnessRoot, login.stdout),
    `${profile} login`,
  )

  const lock = await runOfficialCommand({
    args: ['lock'],
    baseUrl,
    caPath,
    harnessRoot,
    profile,
    session: loginSession,
    timeoutMs,
  })
  assertOfficialCommandSuccess(lock, `${profile} lock`)
  const unlock = await runOfficialCommand({
    args: [
      'unlock',
      '--passwordenv',
      'BW_PASSWORD',
      '--raw',
      '--nointeraction',
    ],
    baseUrl,
    caPath,
    harnessRoot,
    password: stage.password,
    profile,
    timeoutMs,
  })
  assertOfficialCommandSuccess(unlock, `${profile} unlock`)
  const session = readOfficialSession(
    await readOfficialOutput(harnessRoot, unlock.stdout),
    `${profile} unlock`,
  )
  const sync = await runOfficialCommand({
    args: ['sync', '--force'],
    baseUrl,
    caPath,
    harnessRoot,
    profile,
    session,
    timeoutMs,
  })
  assertOfficialCommandSuccess(sync, `${profile} sync`)
  const itemRead = await runOfficialCommand({
    args: ['get', 'item', actor.cipherId],
    baseUrl,
    caPath,
    harnessRoot,
    profile,
    session,
    timeoutMs,
  })
  assertOfficialCommandSuccess(itemRead, `${profile} item read`)
  const itemBytes = await readOfficialOutput(harnessRoot, itemRead.stdout)
  let item
  try {
    item = JSON.parse(itemBytes.toString('utf8'))
  } catch {
    throw new Error(`${profile} item read was not JSON`)
  }
  assertDecryptedItem(item, material.plaintext, profile)

  return {
    profile,
    session,
    itemRead: true,
    commandDigests: {
      login: login.stdout.sha256,
      lock: lock.stdout.sha256,
      unlock: unlock.stdout.sha256,
      sync: sync.stdout.sha256,
      item: itemRead.stdout.sha256,
    },
  }
}

async function runOfficialCommand({
  args,
  baseUrl,
  caPath,
  harnessRoot,
  password,
  profile,
  session,
  timeoutMs = 60_000,
}) {
  const sourceEnvironment = {
    ...isolatedLifecycleEnvironment(),
    NODE_EXTRA_CA_CERTS: caPath,
    ...(password ? { HONOWARDEN_SYNTHETIC_BW_PASSWORD: password } : {}),
    ...(session ? { HONOWARDEN_SYNTHETIC_BW_SESSION: session } : {}),
  }
  return runOfficialCli(harnessRoot, {
    origin: baseUrl,
    passthrough: args,
    profile,
    sourceEnvironment,
    timeoutMs,
  })
}

async function readOfficialOutput(harnessRoot, summary) {
  const path = join(harnessRoot.absolute, 'output', summary.file)
  const bytes = await readFile(path)
  if (bytes.length !== summary.bytes || sha256(bytes) !== summary.sha256) {
    throw new Error('official CLI output changed before lifecycle readback')
  }
  return bytes
}

function readOfficialSession(bytes, label) {
  const session = bytes.toString('utf8').trim()
  if (
    session.length < 32 ||
    session.length > 4096 ||
    /[\r\n\0]/.test(session)
  ) {
    throw new Error(`${label} session output was invalid`)
  }
  return session
}

function assertDecryptedItem(item, plaintext, label) {
  assert(item?.id === actor.cipherId, `${label} item id was inconsistent`)
  assert(
    item?.name === plaintext.itemName,
    `${label} item name did not decrypt`,
  )
  assert(
    item?.notes === plaintext.itemNotes,
    `${label} item notes did not decrypt`,
  )
  assert(
    item?.login?.username === plaintext.itemUsername,
    `${label} item username did not decrypt`,
  )
  assert(
    item?.login?.password === plaintext.itemPassword,
    `${label} item password did not decrypt`,
  )
  assert(
    item?.login?.uris?.some((entry) => entry?.uri === plaintext.itemUri),
    `${label} item URI did not decrypt`,
  )
  assert(
    item?.attachments?.some(
      (entry) =>
        entry?.id === actor.attachmentId &&
        entry?.fileName === plaintext.attachmentFileName,
    ),
    `${label} attachment metadata did not decrypt`,
  )
}

export function assertOfficialCommandSuccess(result, label) {
  assertCapturedOfficialCommandSuccess(result, label)
  if (result.configuration?.read) {
    assertCapturedOfficialCommandSuccess(
      result.configuration.read,
      `${label} configuration read`,
    )
  }
  if (result.configuration?.write) {
    assertCapturedOfficialCommandSuccess(
      result.configuration.write,
      `${label} configuration write`,
    )
  }
}

function assertCapturedOfficialCommandSuccess(result, label) {
  assert(
    result.exitCode === 0 && result.timedOut === false,
    `${label} failed with exit ${String(result.exitCode)}`,
  )
  assert(result.stderr?.bytes === 0, `${label} emitted unexpected stderr`)
}

async function assertStaleProfileRejected({
  baseUrl,
  caPath,
  harnessRoot,
  profile,
  session,
  label,
  rejected,
  timeoutMs = 60_000,
}) {
  const result = await runOfficialCommand({
    args: ['sync', '--force'],
    baseUrl,
    caPath,
    harnessRoot,
    profile,
    session,
    timeoutMs,
  })
  const stderr = await readOfficialOutput(harnessRoot, result.stderr)
  assertStaleOfficialProfileRejected(result, stderr, label)
  rejected?.profiles.push(label)
}

export function assertStaleOfficialProfileRejected(result, stderr, label) {
  if (result.configuration?.read) {
    assertCapturedOfficialCommandSuccess(
      result.configuration.read,
      `${label} configuration read`,
    )
  }
  if (result.configuration?.write) {
    assertCapturedOfficialCommandSuccess(
      result.configuration.write,
      `${label} configuration write`,
    )
  }
  assert(
    result.exitCode !== 0 && result.timedOut === false,
    `${label} stale official profile remained usable`,
  )
  const message = Buffer.isBuffer(stderr)
    ? stderr.toString('utf8')
    : String(stderr)
  const authenticationMarkers = [
    "error: 'invalid_grant'",
    "Message: 'Invalid username or password.'",
    'statusCode: 400',
    'Syncing failed: Invalid username or password.',
  ]
  assert(
    authenticationMarkers.every((marker) => message.includes(marker)),
    `${label} did not fail for invalidated credentials`,
  )
}

async function assertProfileStillValid({
  baseUrl,
  caPath,
  harnessRoot,
  profile,
  session,
}) {
  const result = await runOfficialCommand({
    args: ['sync', '--force'],
    baseUrl,
    caPath,
    harnessRoot,
    profile,
    session,
  })
  assertOfficialCommandSuccess(result, `${profile} rollback continuity`)
}

async function assertDirectGenerationRejected({
  baseUrl,
  material,
  previous,
  tokens,
  label,
  rejected,
}) {
  const access = await authorizedJson(baseUrl, '/api/sync', tokens.accessToken)
  const refresh = await refreshGrant(baseUrl, tokens.refreshToken)
  const password = await passwordGrant(
    baseUrl,
    material,
    previous,
    `${label}-rejected-password`,
  )
  assertStatus(access, 401, `${label} old access`)
  assertStatus(refresh, 400, `${label} old refresh`)
  assertStatus(password, 400, `${label} old password`)
  rejected?.accessTokens.push(label)
  rejected?.refreshTokens.push(label)
  rejected?.passwords.push(label)
}

function readTokens(login, label, issuedTokens = null) {
  const tokens = {
    accessToken: requiredString(
      login.body.access_token,
      `${label} access token`,
    ),
    refreshToken: requiredString(
      login.body.refresh_token,
      `${label} refresh token`,
    ),
  }
  issuedTokens?.push(tokens.accessToken, tokens.refreshToken)
  return tokens
}

export function assertStaleWrappedGenerationResponse(response) {
  assert(
    response?.status === 400 &&
      response?.body?.error?.code === 'invalid_request',
    `stale wrapped generation returned ${String(
      response?.status,
    )}, expected 400 invalid_request`,
  )
}

async function generationCheckpoint({
  id,
  expectedStage,
  expectAccountKeys = true,
  official,
  persistTo,
  commandProcesses,
}) {
  const state = await generationStateCheckpoint({
    id,
    expectedStage,
    expectAccountKeys,
    persistTo,
    commandProcesses,
  })
  return attachOfficialGenerationEvidence(state, official)
}

async function generationStateCheckpoint({
  id,
  expectedStage,
  expectAccountKeys = true,
  persistTo,
  commandProcesses,
}) {
  const snapshot = await readGenerationSnapshot(persistTo, commandProcesses)
  assertNoForeignKeyViolations(snapshot, id)
  assertGenerationMatches(snapshot, expectedStage, id, expectAccountKeys)
  const r2 = await readR2Sentinel(
    persistTo,
    `checkpoint-${id}`,
    commandProcesses,
  )
  assert(r2.equals(r2SentinelBody), `${id} R2 bytes were inconsistent`)
  return {
    id,
    kdf: expectedStage.kdfId,
    userKeyGeneration: expectedStage.userKeyGeneration,
    credentialDigest: expectedStage.digests.credential,
    vaultDigest: expectedStage.digests.vault,
    d1: redactGenerationSnapshot(snapshot),
    r2Sha256: sha256(r2),
  }
}

function attachOfficialGenerationEvidence(state, official, timing = {}) {
  return {
    ...state,
    officialClient: {
      profile: official.profile,
      itemRead: official.itemRead,
      commandDigests: official.commandDigests,
      ...timing,
    },
  }
}

function assertGenerationMatches(
  snapshot,
  expectedStage,
  label,
  expectAccountKeys = true,
) {
  const expectedAlgorithm =
    expectedStage.kdfId === 'argon2id' ? 'argon2id' : 'pbkdf2-sha256'
  assert(
    snapshot.user.masterPasswordHash ===
      expectedStage.masterPasswordAuthenticationHash,
    `${label} authentication hash was inconsistent`,
  )
  assert(
    snapshot.user.userKey === expectedStage.masterKeyEncryptedUserKey,
    `${label} wrapped user key was inconsistent`,
  )
  assert(
    snapshot.user.kdfAlgorithm === expectedAlgorithm,
    `${label} KDF algorithm was inconsistent`,
  )
  if (expectAccountKeys) {
    assert(
      snapshot.user.publicKey === expectedStage.accountKeys.accountPublicKey &&
        snapshot.user.privateKey ===
          expectedStage.accountKeys.userKeyEncryptedAccountPrivateKey,
      `${label} account keys were inconsistent`,
    )
  } else {
    assert(
      snapshot.user.publicKey === null && snapshot.user.privateKey === null,
      `${label} account keys were initialized too early`,
    )
  }
  assert(
    snapshot.folder.encryptedName === expectedStage.vault.folderName,
    `${label} folder generation was inconsistent`,
  )
  assert(
    snapshot.cipher.encryptedJson ===
      JSON.stringify(
        expectedStage.userKeyGeneration === 2
          ? rotationCipherPayload(expectedStage)
          : storedCipherPayload(expectedStage),
      ),
    `${label} cipher generation was inconsistent`,
  )
  assert(
    snapshot.attachment.fileName === expectedStage.vault.attachment.fileName &&
      snapshot.attachment.attachmentKey ===
        expectedStage.vault.attachment.key &&
      snapshot.attachment.objectKey === actor.r2ObjectKey,
    `${label} attachment generation was inconsistent`,
  )
}

async function readGenerationSnapshot(persistTo, commandProcesses) {
  const query = `
    SELECT
      kdf_algorithm as kdfAlgorithm,
      kdf_iterations as kdfIterations,
      kdf_memory as kdfMemory,
      kdf_parallelism as kdfParallelism,
      master_password_hash as masterPasswordHash,
      user_key as userKey,
      public_key as publicKey,
      private_key as privateKey,
      security_stamp as securityStamp,
      revision_date as revisionDate
    FROM users WHERE id = ${sql(actor.userId)};
    SELECT encrypted_name as encryptedName, revision_date as revisionDate
    FROM folders WHERE id = ${sql(actor.folderId)};
    SELECT encrypted_json as encryptedJson, revision_date as revisionDate
    FROM ciphers WHERE id = ${sql(actor.cipherId)};
    SELECT
      object_key as objectKey,
      file_name as fileName,
      attachment_key as attachmentKey,
      size,
      content_type as contentType,
      revision_date as revisionDate
    FROM cipher_attachments WHERE id = ${sql(actor.attachmentId)};
    SELECT
      SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) as activeCount,
      SUM(CASE WHEN revoked_at IS NOT NULL THEN 1 ELSE 0 END) as revokedCount
    FROM devices WHERE user_id = ${sql(actor.userId)};
    SELECT
      SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END) as activeCount,
      SUM(CASE WHEN revoked_at IS NOT NULL THEN 1 ELSE 0 END) as revokedCount
    FROM refresh_tokens WHERE user_id = ${sql(actor.userId)};
    SELECT name, context_json as contextJson
    FROM audit_events
    WHERE actor_user_id = ${sql(actor.userId)}
    ORDER BY created_at, id;
    SELECT
      wrapper_kind as wrapperKind,
      wrapper_sha256 as wrapperSha256
    FROM user_key_rotation_wrapper_history
    WHERE user_id = ${sql(actor.userId)}
    ORDER BY wrapper_sha256;
    SELECT COUNT(*) as count FROM pragma_foreign_key_check;
  `
  const result = await runWrangler(
    [
      'd1',
      'execute',
      databaseName,
      '--local',
      '--persist-to',
      persistTo,
      '--command',
      query,
      '--yes',
      '--json',
    ],
    commandProcesses,
  )
  const executions = JSON.parse(result.stdout)
  const rows = executions.map((execution) => execution.results ?? [])
  const user = rows[0]?.[0]
  const folder = rows[1]?.[0]
  const cipher = rows[2]?.[0]
  const attachment = rows[3]?.[0]
  if (!user || !folder || !cipher || !attachment) {
    throw new Error('credential lifecycle D1 readback was incomplete')
  }
  return {
    user,
    folder,
    cipher,
    attachment,
    devices: rows[4]?.[0] ?? {},
    refreshTokens: rows[5]?.[0] ?? {},
    auditContexts: rows[6] ?? [],
    wrapperHistory: rows[7] ?? [],
    foreignKeyViolations: Number(rows[8]?.[0]?.count ?? -1),
  }
}

export function assertNoForeignKeyViolations(snapshot, label) {
  const count = snapshot?.foreignKeyViolations
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`${label} D1 foreign-key check was invalid`)
  }
  if (count !== 0) {
    throw new Error(
      `${label} D1 foreign-key check returned ${count} violation${
        count === 1 ? '' : 's'
      }`,
    )
  }
}

function redactGenerationSnapshot(snapshot) {
  return {
    kdf: {
      algorithm: snapshot.user.kdfAlgorithm,
      iterations: Number(snapshot.user.kdfIterations),
      memory:
        snapshot.user.kdfMemory === null
          ? null
          : Number(snapshot.user.kdfMemory),
      parallelism:
        snapshot.user.kdfParallelism === null
          ? null
          : Number(snapshot.user.kdfParallelism),
    },
    revisionDate: snapshot.user.revisionDate,
    securityStampSha256: sha256(snapshot.user.securityStamp),
    authenticationHashSha256: sha256(snapshot.user.masterPasswordHash),
    wrappedUserKeySha256: sha256(snapshot.user.userKey),
    publicKeySha256: snapshot.user.publicKey
      ? sha256(snapshot.user.publicKey)
      : null,
    privateKeySha256: snapshot.user.privateKey
      ? sha256(snapshot.user.privateKey)
      : null,
    folderSha256: sha256(snapshot.folder.encryptedName),
    cipherSha256: sha256(snapshot.cipher.encryptedJson),
    attachmentMetadataSha256: sha256(
      JSON.stringify({
        objectKey: snapshot.attachment.objectKey,
        fileName: snapshot.attachment.fileName,
        attachmentKey: snapshot.attachment.attachmentKey,
        size: Number(snapshot.attachment.size),
        contentType: snapshot.attachment.contentType,
      }),
    ),
    activeDevices: Number(snapshot.devices.activeCount ?? 0),
    revokedDevices: Number(snapshot.devices.revokedCount ?? 0),
    activeRefreshTokens: Number(snapshot.refreshTokens.activeCount ?? 0),
    revokedRefreshTokens: Number(snapshot.refreshTokens.revokedCount ?? 0),
    auditCount: snapshot.auditContexts.length,
    wrapperHistoryCount: snapshot.wrapperHistory.length,
    wrapperHistorySha256: sha256(JSON.stringify(snapshot.wrapperHistory)),
    foreignKeyViolations: snapshot.foreignKeyViolations,
  }
}

export function generationStateEqual(left, right) {
  return (
    JSON.stringify({
      user: left.user,
      folder: left.folder,
      cipher: left.cipher,
      attachment: left.attachment,
      devices: left.devices,
      refreshTokens: left.refreshTokens,
      auditContexts: left.auditContexts,
      wrapperHistory: left.wrapperHistory,
      foreignKeyViolations: left.foreignKeyViolations,
    }) ===
    JSON.stringify({
      user: right.user,
      folder: right.folder,
      cipher: right.cipher,
      attachment: right.attachment,
      devices: right.devices,
      refreshTokens: right.refreshTokens,
      auditContexts: right.auditContexts,
      wrapperHistory: right.wrapperHistory,
      foreignKeyViolations: right.foreignKeyViolations,
    })
  )
}

export function assertPersistenceIdentityUnchanged(expected, actual, label) {
  const identities = [expected, actual]
  if (
    typeof label !== 'string' ||
    label.length === 0 ||
    identities.some(
      (identity) =>
        !isSha256(identity?.d1Sha256) ||
        !isSha256(identity?.r2Sha256) ||
        !isSha256(identity?.combinedSha256),
    )
  ) {
    throw new Error(`${label} canonical persistence identity was invalid`)
  }
  if (
    expected.d1Sha256 !== actual.d1Sha256 ||
    expected.r2Sha256 !== actual.r2Sha256 ||
    expected.combinedSha256 !== actual.combinedSha256
  ) {
    throw new Error(`${label} changed canonical D1/R2 identity`)
  }
}

export function findSecretAuditMatches(contexts, material, issuedTokens = []) {
  const serialized = JSON.stringify(contexts)
  const secretValues = [
    material.email,
    ...Object.values(material.plaintext),
    ...Object.values(material.stages).flatMap((stage) => [
      stage.password,
      stage.masterPasswordAuthenticationHash,
      stage.masterKeyEncryptedUserKey,
      stage.accountKeys.accountPublicKey,
      stage.accountKeys.userKeyEncryptedAccountPrivateKey,
      ...vaultSecretValues(stage.vault),
    ]),
  ]
  const credentialOrVault = [...new Set(secretValues.filter(nonEmpty))].filter(
    (value) => serialized.includes(value),
  ).length
  const issuedTokenMatches = [...new Set(issuedTokens.filter(nonEmpty))].filter(
    (value) => serialized.includes(value),
  ).length
  const accessTokenShapes = [
    ...serialized.matchAll(
      /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/gu,
    ),
  ].length
  const refreshTokenShapes = [...serialized.matchAll(/[A-Za-z0-9_-]{43,}/gu)]
    .length
  return {
    credentialOrVault,
    issuedTokens: issuedTokenMatches,
    accessTokenShapes,
    refreshTokenShapes,
    total:
      credentialOrVault +
      issuedTokenMatches +
      accessTokenShapes +
      refreshTokenShapes,
  }
}

function assertNoSecretAuditMaterial(matches) {
  if (matches.total > 0) {
    throw new Error('audit context contained credential or vault material')
  }
}

function vaultSecretValues(vault) {
  return [
    vault.folderName,
    vault.cipher.name,
    vault.cipher.username,
    vault.cipher.password,
    vault.cipher.uri,
    vault.cipher.notes,
    vault.attachment.fileName,
    vault.attachment.key,
  ]
}

function passwordGrant(baseUrl, material, stage, deviceIdentifier) {
  return requestJson(baseUrl, '/identity/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new globalThis.URLSearchParams({
      grant_type: 'password',
      username: material.email,
      password: stage.masterPasswordAuthenticationHash,
      scope: 'api offline_access',
      deviceIdentifier: `hon220-${deviceIdentifier}`,
      deviceName: 'HON-220 Synthetic Credential Lifecycle',
      deviceType: '8',
    }),
  })
}

function refreshGrant(baseUrl, refreshToken) {
  return requestJson(baseUrl, '/identity/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new globalThis.URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })
}

function authorizedJson(baseUrl, path, accessToken, init = {}) {
  return requestJson(baseUrl, path, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${accessToken}`,
    },
  })
}

function postCredentialJson(baseUrl, path, accessToken, body) {
  return authorizedJson(baseUrl, path, accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function postAccountKeys(baseUrl, accessToken, pair) {
  return postCredentialJson(baseUrl, '/api/accounts/keys', accessToken, {
    publicKey: pair.accountPublicKey,
    encryptedPrivateKey: pair.userKeyEncryptedAccountPrivateKey,
  })
}

function postRotation(baseUrl, accessToken, body, requestId) {
  return requestJson(
    baseUrl,
    '/api/accounts/key-management/rotate-user-account-keys',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Request-Id': `hon220-${requestId}`,
      },
      body: JSON.stringify(body),
    },
  )
}

async function requestJson(baseUrl, path, init = {}) {
  const response = await globalThis.fetch(`${baseUrl}${path}`, {
    ...init,
    signal: globalThis.AbortSignal.timeout(20_000),
  })
  const text = await response.text()
  let body = {}
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  return { status: response.status, body }
}

function assertAccountKeys(body, pair) {
  assert(
    body?.publicKey === pair.accountPublicKey &&
      body?.privateKey === pair.userKeyEncryptedAccountPrivateKey,
    'account-key readback was inconsistent',
  )
}

async function prepareTlsCertificate(persistTo, commandProcesses) {
  const directory = await ensureDirectory(join(persistTo, 'evidence', 'tls'))
  const keyPath = join(directory, 'localhost.key.pem')
  const certificatePath = join(directory, 'localhost.cert.pem')
  await runCommand(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-sha256',
      '-nodes',
      '-days',
      '2',
      '-keyout',
      keyPath,
      '-out',
      certificatePath,
      '-subj',
      '/CN=localhost',
      '-addext',
      'basicConstraints=critical,CA:TRUE',
      '-addext',
      'keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ],
    commandProcesses,
  )
  await Promise.all([chmod(keyPath, 0o600), chmod(certificatePath, 0o600)])
  return { keyPath, certificatePath }
}

async function startTlsProxy({ backendPort, certificatePath, keyPath, port }) {
  const [certificate, key] = await Promise.all([
    readFile(certificatePath),
    readFile(keyPath),
  ])
  const server = createHttpsServer(
    { cert: certificate, key },
    (request, response) => {
      const headers = { ...request.headers }
      delete headers['accept-encoding']
      headers['x-forwarded-proto'] = 'https'
      const upstream = requestHttp(
        {
          host: '127.0.0.1',
          port: backendPort,
          method: request.method,
          path: request.url,
          headers,
        },
        (upstreamResponse) => {
          response.writeHead(
            upstreamResponse.statusCode ?? 502,
            upstreamResponse.headers,
          )
          upstreamResponse.pipe(response)
        },
      )
      upstream.once('error', () => {
        if (!response.headersSent) {
          response.writeHead(502, { 'Content-Type': 'text/plain' })
        }
        response.end('local proxy upstream failed')
      })
      request.pipe(upstream)
    },
  )
  server.on('clientError', (error, socket) => {
    void error
    socket.destroy()
  })
  await new Promise((resolveListen, rejectListen) => {
    const onError = (error) => {
      server.off('listening', onListening)
      rejectListen(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolveListen()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
  return server
}

async function stopTlsProxy(server) {
  if (!server) return
  server.closeAllConnections?.()
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
        rejectClose(error)
      } else {
        resolveClose()
      }
    })
  })
}

function startWorker({
  persistTo,
  port,
  inspectorPort,
  email,
  credentialWritersEnabled = true,
  globalRequestQuotaEnabled = false,
}) {
  if (
    typeof credentialWritersEnabled !== 'boolean' ||
    typeof globalRequestQuotaEnabled !== 'boolean'
  ) {
    throw new TypeError('credential Worker rollout policy was invalid')
  }
  const writerFlag = credentialWritersEnabled ? 'true' : 'false'
  const quotaFlag = globalRequestQuotaEnabled ? 'true' : 'false'
  const child = spawn(
    'pnpm',
    [
      'exec',
      'wrangler',
      'dev',
      '--local',
      '--local-protocol',
      'http',
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--inspector-port',
      String(inspectorPort),
      '--persist-to',
      persistTo,
      '--log-level',
      'error',
      '--var',
      `HONOWARDEN_ALLOWED_EMAILS:${email}`,
      '--var',
      `HONOWARDEN_TOKEN_SECRET:${tokenSecret}`,
      '--var',
      `HONOWARDEN_ACCOUNT_KEYS_ENABLED:${writerFlag}`,
      '--var',
      `HONOWARDEN_KDF_MUTATION_ENABLED:${writerFlag}`,
      '--var',
      `HONOWARDEN_PASSWORD_CHANGE_ENABLED:${writerFlag}`,
      '--var',
      `HONOWARDEN_USER_KEY_ROTATION_ENABLED:${writerFlag}`,
      '--var',
      `HONOWARDEN_GLOBAL_REQUEST_QUOTA:${quotaFlag}`,
      '--var',
      'HONOWARDEN_DURABLE_NOTIFICATIONS_ENABLED:false',
      '--var',
      'HONOWARDEN_AUDIT_LOGS:false',
    ],
    {
      cwd: repoRoot,
      detached: true,
      env: isolatedLifecycleEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  child.output = ''
  child.stdout.on('data', (chunk) => appendWorkerOutput(child, chunk))
  child.stderr.on('data', (chunk) => appendWorkerOutput(child, chunk))
  return child
}

function appendWorkerOutput(child, chunk) {
  child.output = `${child.output}${chunk.toString()}`.slice(-40_000)
}

async function waitForHealth(baseUrl, worker) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) {
      throw new Error(
        `wrangler dev exited early (${worker.exitCode})\n${worker.output}`,
      )
    }
    try {
      const response = await globalThis.fetch(`${baseUrl}/health`, {
        signal: globalThis.AbortSignal.timeout(1_000),
      })
      if (response.status === 200) return
    } catch {
      // The local Worker is still starting.
    }
    await delay(100)
  }
  throw new Error(`wrangler dev did not become healthy\n${worker.output}`)
}

async function putR2Sentinel(persistTo, commandProcesses) {
  const evidenceDirectory = await ensureDirectory(join(persistTo, 'evidence'))
  const sourcePath = join(evidenceDirectory, 'r2-sentinel-source.bin')
  await writeFile(sourcePath, r2SentinelBody, { mode: 0o600 })
  await runWrangler(
    [
      'r2',
      'object',
      'put',
      `${r2BucketName}/${actor.r2ObjectKey}`,
      '--local',
      '--persist-to',
      persistTo,
      '--file',
      sourcePath,
      '--force',
    ],
    commandProcesses,
  )
}

async function readR2Sentinel(persistTo, label, commandProcesses) {
  const outputPath = join(persistTo, 'evidence', `r2-${label}.bin`)
  await runWrangler(
    [
      'r2',
      'object',
      'get',
      `${r2BucketName}/${actor.r2ObjectKey}`,
      '--local',
      '--persist-to',
      persistTo,
      '--file',
      outputPath,
    ],
    commandProcesses,
  )
  return readFile(outputPath)
}

function executeLocalSql(persistTo, command, commandProcesses) {
  return runWrangler(
    [
      'd1',
      'execute',
      databaseName,
      '--local',
      '--persist-to',
      persistTo,
      '--command',
      command,
      '--yes',
      '--json',
    ],
    commandProcesses,
  )
}

function runWrangler(args, commandProcesses) {
  return runCommand('pnpm', ['exec', 'wrangler', ...args], commandProcesses)
}

function runCommand(command, args, commandProcesses) {
  return runBoundedCommand(command, args, {
    activeProcesses: commandProcesses,
    cwd: repoRoot,
    env: isolatedLifecycleEnvironment(),
    label: `credential lifecycle ${command}`,
    timeoutMs: 120_000,
  })
}

export function isolatedLifecycleEnvironment(source = process.env) {
  const environment = {}
  for (const key of lifecycleEnvironmentKeys) {
    if (source[key] !== undefined) environment[key] = source[key]
  }
  environment.CI = 'true'
  environment.NO_COLOR = '1'
  environment.pnpm_config_verify_deps_before_run = 'false'
  return environment
}

function findFreePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createNetServer()
    server.once('error', rejectPort)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close((error) => {
        if (error) rejectPort(error)
        else if (port) resolvePort(port)
        else rejectPort(new Error('failed to allocate a local port'))
      })
    })
  })
}

async function findDistinctFreePorts(count = 2, excluded = []) {
  const ports = []
  const blocked = new Set(excluded)
  while (ports.length < count) {
    const port = await findFreePort()
    if (!ports.includes(port) && !blocked.has(port)) ports.push(port)
  }
  return ports
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} was missing`)
  }
  return value
}

function assertStatus(result, expected, label) {
  assert(
    result.status === expected,
    `${label} returned ${result.status}, expected ${expected}`,
  )
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function check(id, passed) {
  return { id, status: passed ? 'pass' : 'fail' }
}

function nonEmpty(value) {
  return typeof value === 'string' && value.length > 0
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => {
    globalThis.setTimeout(resolveDelay, milliseconds)
  })
}

function parseOptions(args) {
  const options = {
    execute: false,
    keepState: false,
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--execute') {
      options.execute = true
      continue
    }
    if (arg === '--keep-state') {
      options.keepState = true
      continue
    }
    if (
      arg === '--confirm' ||
      arg === '--at' ||
      arg === '--harness-root' ||
      arg === '--persist-to' ||
      arg === '--timeout-ms' ||
      arg === '--browser-executable'
    ) {
      const value = args[index + 1]
      if (!value) throw new Error(`${arg} requires a value`)
      const key = arg
        .slice(2)
        .replace(/-([a-z])/g, (_, character) => character.toUpperCase())
      options[key] = value
      index += 1
      continue
    }
    throw new Error('unknown credential lifecycle option')
  }
  return options
}

function buildExecutionCommand(options, generatedAt, harnessRoot) {
  const timeout = options.timeoutMs
    ? ` --timeout-ms ${String(parseTimeout(options.timeoutMs))}`
    : ''
  const persist = options.persistTo
    ? ` --persist-to ${shellQuote(resolvePersistPath(options.persistTo).relative)}`
    : ''
  const keepState = options.keepState ? ' --keep-state' : ''
  const browser = options.browserExecutable
    ? ` --browser-executable ${shellQuote(options.browserExecutable)}`
    : ''
  return `pnpm account:credential-lifecycle -- run --harness-root ${shellQuote(harnessRoot.relative)} --at ${shellQuote(generatedAt)}${timeout}${persist}${keepState}${browser} --execute --confirm ${confirmation}`
}

function parseTimestamp(value) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) throw new Error('--at must be ISO-8601')
  return date.toISOString()
}

function parseTimeout(value) {
  if (!/^[0-9]+$/.test(String(value))) {
    throw new Error('--timeout-ms must be an integer')
  }
  const parsed = Number(value)
  if (parsed < 100 || parsed > 300_000) {
    throw new Error('--timeout-ms must be between 100 and 300000')
  }
  return parsed
}

function resolvePersistPath(value) {
  const absolute = isAbsolute(value) ? resolve(value) : resolve(repoRoot, value)
  const insideFixtureRoot = relative(fixtureRoot, absolute)
  if (
    insideFixtureRoot.length === 0 ||
    insideFixtureRoot === '..' ||
    insideFixtureRoot.startsWith(`..${sep}`) ||
    isAbsolute(insideFixtureRoot)
  ) {
    throw new Error('persist-to must be inside test/.tmp')
  }
  return {
    absolute,
    relative: relative(repoRoot, absolute),
    insideFixtureRoot,
  }
}

export async function prepareCredentialLifecyclePersistPath(value) {
  const root = resolvePersistPath(value)
  await mkdir(fixtureRoot, { recursive: true, mode: 0o700 })
  const [resolvedRepo, resolvedFixtureRoot] = await Promise.all([
    realpath(repoRoot),
    realpath(fixtureRoot),
  ])
  if (resolvedFixtureRoot !== join(resolvedRepo, 'test/.tmp')) {
    throw new Error('test/.tmp must not be a symlink')
  }
  const fixtureInfo = await lstat(fixtureRoot)
  if (!fixtureInfo.isDirectory() || (fixtureInfo.mode & 0o777) !== 0o700) {
    throw new Error('test/.tmp directory permissions must be 0700')
  }

  let current = resolvedFixtureRoot
  for (const component of root.insideFixtureRoot.split(sep)) {
    current = join(current, component)
    let info
    try {
      info = await lstat(current)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      try {
        await mkdir(current, { mode: 0o700 })
      } catch (mkdirError) {
        if (mkdirError?.code !== 'EEXIST') throw mkdirError
      }
      info = await lstat(current)
    }
    if (info.isSymbolicLink()) {
      throw new Error('persist-to must not contain symlinks')
    }
    if (!info.isDirectory()) {
      throw new Error('persist-to path must be a directory')
    }
    if ((info.mode & 0o777) !== 0o700) {
      throw new Error('persist-to directory permissions must be 0700')
    }
  }

  const resolvedPersistRoot = await realpath(root.absolute)
  const insideResolvedFixture = relative(
    resolvedFixtureRoot,
    resolvedPersistRoot,
  )
  if (
    insideResolvedFixture.length === 0 ||
    insideResolvedFixture === '..' ||
    insideResolvedFixture.startsWith(`..${sep}`) ||
    isAbsolute(insideResolvedFixture)
  ) {
    throw new Error('persist-to escaped test/.tmp')
  }
  if ((await readdir(root.absolute)).length !== 0) {
    throw new Error('persist-to directory must be empty')
  }
  await writeStateOwnershipMarker(root.absolute)
  return root
}

async function prepareTemporaryCredentialLifecycleState() {
  const path = await mkdtemp(join(tmpdir(), 'honowarden-hon220-'))
  await chmod(path, 0o700)
  await writeStateOwnershipMarker(path)
  return path
}

async function writeStateOwnershipMarker(path) {
  await writeFile(join(path, stateOwnershipMarker), stateOwnershipMarkerBody, {
    flag: 'wx',
    mode: 0o600,
  })
}

export async function cleanupCredentialLifecycleState(path, keepState) {
  if (keepState) return
  const markerPath = join(path, stateOwnershipMarker)
  const markerInfo = await lstat(markerPath)
  if (
    markerInfo.isSymbolicLink() ||
    !markerInfo.isFile() ||
    (markerInfo.mode & 0o777) !== 0o600 ||
    (await readFile(markerPath, 'utf8')) !== stateOwnershipMarkerBody
  ) {
    throw new Error('credential lifecycle state ownership marker was invalid')
  }
  await rm(path, { recursive: true, force: true })
}

function shellQuote(value) {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`
}

async function ensureDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 })
  return path
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'credential lifecycle failed'}\n`,
    )
    process.exitCode = 1
  })
}

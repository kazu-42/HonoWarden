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
  generateOfficialCredentialFixture,
  resolveHarnessRoot,
  runOfficialCli,
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

async function executeLifecycle(options, generatedAt) {
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
  return result
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

export function normalizeCredentialMaterial(value) {
  const stages = value?.credentialStages
  const expected = [
    ['baseline', 'pbkdf2', 1],
    ['password_change', 'pbkdf2', 1],
    ['argon2id', 'argon2id', 1],
    ['pbkdf2_return', 'pbkdf2', 1],
    ['user_key_rotation', 'pbkdf2', 2],
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
      session: baselineOfficial.session,
      tokens: baselineTokens,
    },
    {
      label: 'password-change-after-restart',
      previous: material.stages.password_change,
      profile: profiles.passwordChangeRestart,
      session: passwordRestartOfficial.session,
      tokens: passwordTokens,
    },
    {
      label: 'argon2id-after-restart',
      previous: material.stages.argon2id,
      profile: profiles.argon2idRestart,
      session: argonRestartOfficial.session,
      tokens: argonTokens,
    },
    {
      label: 'pbkdf2-return-after-restart',
      previous: material.stages.pbkdf2_return,
      profile: profiles.pbkdf2ReturnRestart,
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
  })
  assertOfficialCommandSuccess(sync, `${profile} sync`)
  const itemRead = await runOfficialCommand({
    args: ['get', 'item', actor.cipherId],
    baseUrl,
    caPath,
    harnessRoot,
    profile,
    session,
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
    timeoutMs: 60_000,
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
}) {
  const result = await runOfficialCommand({
    args: ['sync', '--force'],
    baseUrl,
    caPath,
    harnessRoot,
    profile,
    session,
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

function startWorker({ persistTo, port, inspectorPort, email }) {
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
      'HONOWARDEN_ACCOUNT_KEYS_ENABLED:true',
      '--var',
      'HONOWARDEN_KDF_MUTATION_ENABLED:true',
      '--var',
      'HONOWARDEN_USER_KEY_ROTATION_ENABLED:true',
      '--var',
      'HONOWARDEN_GLOBAL_REQUEST_QUOTA:false',
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

async function findDistinctFreePorts(count = 2) {
  const ports = []
  while (ports.length < count) {
    const port = await findFreePort()
    if (!ports.includes(port)) ports.push(port)
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

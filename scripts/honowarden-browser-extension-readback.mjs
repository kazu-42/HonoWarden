import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'

import {
  runBoundedCommand,
  runCleanupSteps,
  stopDetachedProcessTree,
  stopTrackedProcesses,
} from './honowarden-signal-cleanup.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const browserProfileConfirmation = 'clean-browser-profile'
const requiredRoutePaths = Object.freeze([
  '/identity/accounts/prelogin/password',
  '/identity/connect/token',
  '/api/config',
  '/api/accounts/profile',
  '/api/sync',
])
const decryptedFieldNames = Object.freeze([
  'itemName',
  'itemUsername',
  'itemPassword',
  'itemNotes',
  'attachmentFileName',
  'cipherRoute',
])
const browserEnvironmentKeys = Object.freeze([
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
const browserNetworkIsolationArgs = Object.freeze([
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost',
  '--proxy-server=http://127.0.0.1:9',
  '--proxy-bypass-list=localhost;127.0.0.1;[::1]',
])
const browserNetworkSwitches = Object.freeze([
  '--host-resolver-rules=',
  '--proxy-server=',
  '--proxy-bypass-list=',
])
const defaultCdpTimeoutMs = 10_000
const notificationsSignalRStartFailureMessage =
  '[SignalR] Failed to start the connection: Error: WebSocket failed to connect. The connection could not be found on the server, either the endpoint may not be a SignalR endpoint, the connection ID is not present on the server, or there is a proxy blocking WebSockets. If you have multiple servers check that sticky sessions are enabled.'

export async function runOfficialBrowserExtensionReadback({
  baseUrl,
  browserExecutable,
  cipherId,
  material,
  resources = {},
  timeoutMs = 120_000,
}) {
  validateInputs({
    baseUrl,
    browserExecutable,
    cipherId,
    material,
  })
  resources.commands ??= new Set()

  const profileRoot = `test/.tmp/hon220-browser-${randomUUID()}`
  let cleanupReadback
  let evidence
  try {
    resources.profile = { root: profileRoot, browserExecutable }
    const profilePacket = await prepareBrowserProfile(
      profileRoot,
      browserExecutable,
      resources.commands,
    )

    const browser = startBrowser(profilePacket.launch)
    resources.process = browser
    const browserReadiness = await waitForBrowser(
      browser,
      profilePacket.paths.profile,
      timeoutMs,
    )
    const { cdpEndpoint, version } = browserReadiness
    resources.cdpEndpoint = cdpEndpoint
    const backgroundTarget = await waitForBackgroundTarget(
      cdpEndpoint,
      browser,
      timeoutMs,
    )
    const extensionId = new URL(backgroundTarget.url).host
    const certificateTarget = await acceptLocalCertificate(
      cdpEndpoint,
      baseUrl,
      timeoutMs,
    )
    await closeTarget(cdpEndpoint, certificateTarget.id)

    const routeStatuses = Object.fromEntries(
      requiredRoutePaths.map((path) => [path, []]),
    )
    const networkBootstrap = await configureIsolatedSelfHostedOrigin({
      backgroundTarget,
      baseUrl,
      cdpEndpoint,
      extensionId,
      material,
      routeStatuses,
      timeoutMs,
    })
    const runtimeExceptions = []
    const diagnostics = {
      consoleErrors: [],
      externalRequests: [],
      externalResponses: [],
      loadingFailures: [],
      nonSuccessResponses: [],
    }
    const startedAtMs = Date.now()
    const recordEvent = createEventRecorder({
      baseUrl,
      diagnostics,
      redactedValues: collectSensitiveStrings(material),
      routeStatuses,
      runtimeExceptions,
      startedAtMs,
    })
    const background = await CdpClient.connect(
      backgroundTarget.webSocketDebuggerUrl,
      (message) => recordEvent(message, 'background'),
    )
    let popup = null
    let popupTarget = null
    try {
      await enableEvidenceDomains(background)

      popupTarget = await createBlankTarget(cdpEndpoint)
      popup = await CdpClient.connect(
        popupTarget.webSocketDebuggerUrl,
        (message) => recordEvent(message, 'popup'),
      )
      await enableAndNavigateEvidenceClient(
        popup,
        `chrome-extension://${extensionId}/popup/index.html#/login`,
      )
      await waitForExpression(
        popup,
        'document.readyState === "complete"',
        'official browser popup did not load',
        timeoutMs,
      )
      await reachLoginForm(popup, timeoutMs)
      await submitCredentials(popup, material, timeoutMs)
      await waitForExpression(
        popup,
        `location.hash.startsWith("#/tabs/vault")`,
        'official browser did not reach the vault',
        timeoutMs,
      )
      await waitForExpression(
        popup,
        `document.querySelector("[data-testid=item-name]") !== null`,
        'official browser did not render a vault item',
        timeoutMs,
      )
      await openExpectedItem(popup, material.plaintext.itemName, timeoutMs)
      const decryptedFields = await readDecryptedFields(
        popup,
        material.plaintext,
        cipherId,
      )
      await waitForRequiredRoutes(routeStatuses, timeoutMs)
      await waitForBrowserEventQuiescence(
        diagnostics,
        runtimeExceptions,
        timeoutMs,
      )
      background.assertHealthy()
      popup.assertHealthy()
      const classifiedExceptions = classifyBrowserRuntimeExceptions(
        runtimeExceptions,
        {
          allowBlockedBootstrapFrame:
            networkBootstrap.blockedExternalRequestCount > 0,
        },
      )
      const classifiedDiagnostics = classifyBrowserDiagnostics(diagnostics)
      if (classifiedDiagnostics.unexpected.length > 0) {
        throw new Error(
          `official browser emitted an unexpected diagnostic: ${JSON.stringify(
            classifiedDiagnostics.unexpected,
          )}`,
        )
      }
      const validation = validateBrowserExtensionEvidence({
        routeStatuses,
        decryptedFields,
        runtimeExceptions: classifiedExceptions.unexpected,
      })
      const screenshot = await captureScreenshot(popup, profileRoot)

      evidence = {
        status: 'passed',
        host: {
          name: profilePacket.launch.browser,
          version: profilePacket.launch.version,
          remoteDebuggingAddress: '127.0.0.1',
        },
        extension: {
          release: profilePacket.release.tag,
          assetSha256: profilePacket.readback.assetSha256,
          manifestVersion: profilePacket.readback.manifestVersion,
          manifestFormat: profilePacket.readback.manifestFormat,
          backgroundServiceWorker:
            profilePacket.readback.backgroundServiceWorker,
          extensionIdSha256: sha256(extensionId),
        },
        profile: {
          fresh: profilePacket.readback.profileUntouched === true,
          normalProfileUsed: false,
        },
        networkIsolation: {
          ...networkBootstrap,
          evidenceExternalRequestCount: diagnostics.externalRequests.length,
          evidenceExternalResponseCount: diagnostics.externalResponses.length,
        },
        routes: Object.fromEntries(
          requiredRoutePaths.map((path) => [
            path,
            [...new Set(routeStatuses[path])],
          ]),
        ),
        vaultReadback: {
          cipherId,
          decryptedFields,
          requiredRouteCount: validation.requiredRouteCount,
          decryptedFieldCount: validation.decryptedFieldCount,
        },
        runtime: {
          runtimeExceptionCount: validation.runtimeExceptionCount,
          hostIntegrationExceptionCount:
            classifiedExceptions.expectedHostIntegration.length,
          hostIntegrationExceptionSha256: [
            ...new Set(
              classifiedExceptions.expectedHostIntegration.map(
                (entry) => entry.sha256,
              ),
            ),
          ],
          consoleErrorCount: diagnostics.consoleErrors.length,
          consoleErrors:
            classifiedDiagnostics.expectedHostIntegration.consoleErrors,
          externalRequestCount: diagnostics.externalRequests.length,
          loadingFailureCount: diagnostics.loadingFailures.length,
          loadingFailures:
            classifiedDiagnostics.expectedHostIntegration.loadingFailures,
          nonSuccessResponses:
            classifiedDiagnostics.expectedHostIntegration.nonSuccessResponses,
          unexpectedDiagnosticCount: 0,
        },
        screenshot,
        cdp: {
          browserProtocolVersion: requiredString(
            version['Protocol-Version'],
            'browser protocol version',
          ),
          backgroundTargetObserved: true,
          popupTargetObserved: true,
        },
      }
    } finally {
      popup?.close()
      background.close()
      if (popupTarget) {
        await closeTarget(cdpEndpoint, popupTarget.id).catch(() => undefined)
      }
    }
  } finally {
    cleanupReadback = await cleanupOfficialBrowserExtensionResources(resources)
  }

  return {
    ...evidence,
    cleanup: cleanupReadback,
  }
}

async function configureIsolatedSelfHostedOrigin({
  backgroundTarget,
  baseUrl,
  cdpEndpoint,
  extensionId,
  material,
  routeStatuses,
  timeoutMs,
}) {
  const runtimeExceptions = []
  const diagnostics = {
    consoleErrors: [],
    externalRequests: [],
    externalResponses: [],
    loadingFailures: [],
    nonSuccessResponses: [],
  }
  const startedAtMs = Date.now()
  const recordEvent = createEventRecorder({
    baseUrl,
    diagnostics,
    redactedValues: collectSensitiveStrings(material),
    routeStatuses,
    runtimeExceptions,
    startedAtMs,
  })
  const background = await CdpClient.connect(
    backgroundTarget.webSocketDebuggerUrl,
    (message) => recordEvent(message, 'background'),
  )
  let popup = null
  let popupTarget = null
  try {
    await enableEvidenceDomains(background)
    popupTarget = await createBlankTarget(cdpEndpoint)
    popup = await CdpClient.connect(
      popupTarget.webSocketDebuggerUrl,
      (message) => recordEvent(message, 'popup'),
    )
    await enableAndNavigateEvidenceClient(
      popup,
      `chrome-extension://${extensionId}/popup/index.html#/login`,
    )
    await waitForExpression(
      popup,
      'document.readyState === "complete"',
      'official browser bootstrap popup did not load',
      timeoutMs,
    )
    await reachLoginForm(popup, timeoutMs)
    await configureSelfHostedOrigin(popup, baseUrl, timeoutMs)
    await waitForIsolatedBrowserBootstrap(diagnostics, timeoutMs)
    await waitForBrowserEventQuiescence(
      diagnostics,
      runtimeExceptions,
      timeoutMs,
    )
    background.assertHealthy()
    popup.assertHealthy()
    const network = validateIsolatedBrowserBootstrap(diagnostics)
    const classifiedExceptions =
      classifyBrowserRuntimeExceptions(runtimeExceptions)
    const classifiedBootstrapExceptions = classifyBootstrapRuntimeExceptions(
      classifiedExceptions.unexpected,
    )
    if (classifiedBootstrapExceptions.unexpected.length > 0) {
      throw new Error(
        `official browser bootstrap emitted a runtime exception: ${JSON.stringify(
          classifiedBootstrapExceptions.unexpected,
        )}`,
      )
    }
    return {
      ...network,
      runtimeExceptionCount: 0,
      hostIntegrationExceptionCount:
        classifiedExceptions.expectedHostIntegration.length,
      networkIsolationExceptionCount:
        classifiedBootstrapExceptions.expectedNetworkIsolation.length,
      consoleErrorCount: diagnostics.consoleErrors.length,
      loadingFailureCount: diagnostics.loadingFailures.length,
    }
  } finally {
    popup?.close()
    background.close()
    if (popupTarget) {
      await closeTarget(cdpEndpoint, popupTarget.id).catch(() => undefined)
    }
  }
}

async function waitForIsolatedBrowserBootstrap(diagnostics, timeoutMs) {
  await delay(500)
  const deadline = Date.now() + Math.min(timeoutMs, 5_000)
  let lastError
  while (Date.now() < deadline) {
    try {
      return validateIsolatedBrowserBootstrap(diagnostics)
    } catch (error) {
      if (diagnostics.externalResponses.length > 0) throw error
      lastError = error
      await delay(100)
    }
  }
  throw lastError ?? new Error('official browser bootstrap did not settle')
}

async function waitForBrowserEventQuiescence(
  diagnostics,
  runtimeExceptions,
  timeoutMs,
) {
  const deadline = Date.now() + Math.min(timeoutMs, 10_000)
  let stableSince = Date.now()
  let previous = browserBootstrapEventCount(diagnostics, runtimeExceptions)
  while (Date.now() < deadline) {
    await delay(100)
    const current = browserBootstrapEventCount(diagnostics, runtimeExceptions)
    if (current !== previous) {
      previous = current
      stableSince = Date.now()
      continue
    }
    if (Date.now() - stableSince >= 1_500) return
  }
  throw new Error('official browser bootstrap did not become quiescent')
}

function browserBootstrapEventCount(diagnostics, runtimeExceptions) {
  return (
    (diagnostics?.consoleErrors?.length ?? 0) +
    (diagnostics?.externalRequests?.length ?? 0) +
    (diagnostics?.externalResponses?.length ?? 0) +
    (diagnostics?.loadingFailures?.length ?? 0) +
    (diagnostics?.nonSuccessResponses?.length ?? 0) +
    runtimeExceptions.length
  )
}

export function validateIsolatedBrowserBootstrap(diagnostics) {
  const externalRequests = diagnostics?.externalRequests ?? []
  const externalResponses = diagnostics?.externalResponses ?? []
  if (externalResponses.length > 0) {
    throw new Error('official browser bootstrap reached an external origin')
  }
  const failures = [...(diagnostics?.loadingFailures ?? [])]
  const blockedExternalRequests = []
  for (const request of externalRequests) {
    const matchIndex = failures.findIndex(
      (failure) =>
        failure?.errorText === 'net::ERR_PROXY_CONNECTION_FAILED' &&
        failure?.location === request?.location &&
        failure?.surface === request?.surface &&
        failure?.type === request?.type,
    )
    if (matchIndex < 0) {
      throw new Error(
        'official browser bootstrap external request was not blocked',
      )
    }
    blockedExternalRequests.push(request)
    failures.splice(matchIndex, 1)
  }
  const classified = classifyBrowserDiagnostics(
    {
      consoleErrors: diagnostics?.consoleErrors ?? [],
      externalRequests: [],
      externalResponses: [],
      loadingFailures: failures,
      nonSuccessResponses: diagnostics?.nonSuccessResponses ?? [],
    },
    {
      blockedExternalRequests,
    },
  )
  if (classified.unexpected.length > 0) {
    throw new Error(
      `official browser bootstrap emitted an unexpected diagnostic: ${JSON.stringify(
        classified.unexpected,
      )}`,
    )
  }
  if (externalRequests.length === 0) {
    throw new Error(
      'official browser bootstrap did not observe an external request',
    )
  }
  return {
    blockedExternalRequestCount: externalRequests.length,
    externalResponseCount: externalResponses.length,
  }
}

export function validateBrowserExtensionEvidence(value) {
  for (const path of requiredRoutePaths) {
    const statuses = value?.routeStatuses?.[path]
    if (
      !Array.isArray(statuses) ||
      statuses.length === 0 ||
      statuses.some((status) => status !== 200)
    ) {
      throw new Error(`official browser route ${path} did not return 200`)
    }
  }
  for (const field of decryptedFieldNames) {
    if (value?.decryptedFields?.[field] !== true) {
      throw new Error(`official browser did not decrypt ${field}`)
    }
  }
  if (
    !Array.isArray(value?.runtimeExceptions) ||
    value.runtimeExceptions.length !== 0
  ) {
    throw new Error(
      `official browser emitted a runtime exception: ${JSON.stringify(
        value?.runtimeExceptions ?? [],
      )}`,
    )
  }
  return {
    requiredRouteCount: requiredRoutePaths.length,
    decryptedFieldCount: decryptedFieldNames.length,
    runtimeExceptionCount: value.runtimeExceptions.length,
  }
}

export function classifyBrowserRuntimeExceptions(exceptions, options = {}) {
  const expectedHostIntegration = []
  const unexpected = []
  for (const exception of exceptions) {
    const expectedConnectionError =
      exception?.surface === 'background' &&
      exception?.description ===
        'Error: Could not establish connection. Receiving end does not exist.' &&
      typeof exception?.url === 'string' &&
      exception.url.startsWith('chrome-extension://') &&
      exception.url.endsWith('/background.js')
    const expectedBlockedBootstrapFrame =
      options.allowBlockedBootstrapFrame === true &&
      exception?.surface === 'background' &&
      exception?.description ===
        'Error: Frame with ID 0 is showing error page' &&
      exception?.text === 'Uncaught (in promise)' &&
      typeof exception?.url === 'string' &&
      exception.url.startsWith('chrome-extension://') &&
      exception.url.endsWith('/background.js')
    if (expectedConnectionError || expectedBlockedBootstrapFrame) {
      expectedHostIntegration.push(exception)
    } else {
      unexpected.push(exception)
    }
  }
  return { expectedHostIntegration, unexpected }
}

export function classifyBootstrapRuntimeExceptions(exceptions) {
  const expectedNetworkIsolation = []
  const unexpected = []
  for (const exception of exceptions) {
    if (
      exception?.surface === 'background' &&
      exception?.description ===
        'Error: Frame with ID 0 is showing error page' &&
      exception?.text === 'Uncaught (in promise)' &&
      typeof exception?.url === 'string' &&
      exception.url.startsWith('chrome-extension://') &&
      exception.url.endsWith('/background.js')
    ) {
      expectedNetworkIsolation.push(exception)
    } else {
      unexpected.push(exception)
    }
  }
  return { expectedNetworkIsolation, unexpected }
}

export function classifyBrowserDiagnostics(diagnostics, options = {}) {
  const expectedHostIntegration = {
    consoleErrors: [],
    externalRequests: [],
    externalResponses: [],
    loadingFailures: [],
    nonSuccessResponses: [],
  }
  const unexpected = []
  const loadingFailures = diagnostics?.loadingFailures ?? []
  const consoleErrors = diagnostics?.consoleErrors ?? []
  const blockedExternalRequests = options.blockedExternalRequests ?? []
  const hasLoadingFailure = (entry, expected) =>
    loadingFailures.some(
      (failure) =>
        failure?.surface === entry?.surface &&
        failure?.location === expected.location &&
        failure?.type === expected.type &&
        failure?.errorText === expected.errorText,
    )
  const hasBlockedExternalRequest = (entry, location) =>
    typeof location === 'string' &&
    location.startsWith('external-origin-sha256:') &&
    blockedExternalRequests.some(
      (request) =>
        request?.surface === entry?.surface &&
        request?.location === location &&
        request?.type === 'Fetch',
    )

  for (const entry of diagnostics?.consoleErrors ?? []) {
    const notificationFailure =
      entry?.surface === 'background' &&
      entry?.location === 'chrome-extension://[extension]/background.js' &&
      entry?.category === 'notifications_websocket_failure'
    const closedBootstrapTab =
      entry?.surface === 'background' &&
      entry?.location === 'unknown' &&
      entry?.source === 'other' &&
      entry?.category === 'closed_bootstrap_tab'
    const certificateFailure =
      entry?.surface === 'background' &&
      entry?.location === 'chrome-extension://[extension]/background.js' &&
      entry?.category === 'certificate_resource_load_failure' &&
      hasLoadingFailure(entry, {
        errorText: 'net::ERR_CERT_AUTHORITY_INVALID',
        location: '/api/config',
        type: 'Fetch',
      })
    const iconFailure =
      entry?.surface === 'popup' &&
      entry?.location === '/icons/[redacted]/icon.png' &&
      entry?.category === 'resource_load_failure' &&
      hasLoadingFailure(entry, {
        errorText: 'net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin',
        location: '/icons/[redacted]/icon.png',
        type: 'Image',
      })
    const localServerConfigFailure =
      entry?.category === 'server_config_fetch_failure' &&
      entry?.relatedLocation === '/api' &&
      hasLoadingFailure(entry, {
        errorText: 'net::ERR_CERT_AUTHORITY_INVALID',
        location: '/api/config',
        type: 'Fetch',
      })
    const blockedServerConfigFailure =
      entry?.category === 'server_config_fetch_failure' &&
      hasBlockedExternalRequest(entry, entry?.relatedLocation)
    const blockedResourceFailure =
      entry?.category === 'resource_load_failure' &&
      hasBlockedExternalRequest(entry, entry?.location)
    const notificationSignalRFailure =
      entry?.surface === 'background' &&
      entry?.location === 'chrome-extension://[extension]/background.js' &&
      entry?.category === 'notifications_signalr_start_failure' &&
      hasLoadingFailure(entry, {
        errorText: 'net::ERR_CERT_AUTHORITY_INVALID',
        location: '/notifications/hub',
        type: 'WebSocket',
      }) &&
      consoleErrors.some(
        (consoleEntry) =>
          consoleEntry?.surface === entry.surface &&
          consoleEntry?.category === 'notifications_websocket_failure',
      )
    const closedBrowserTabBadgeState =
      entry?.surface === 'background' &&
      entry?.location === 'chrome-extension://[extension]/background.js' &&
      entry?.category === 'closed_browser_tab_badge_state'
    const expected =
      notificationFailure ||
      closedBootstrapTab ||
      certificateFailure ||
      iconFailure ||
      localServerConfigFailure ||
      blockedServerConfigFailure ||
      blockedResourceFailure ||
      notificationSignalRFailure ||
      closedBrowserTabBadgeState
    if (expected) {
      expectedHostIntegration.consoleErrors.push(entry)
    } else {
      unexpected.push({ ...entry, kind: 'console_error' })
    }
  }

  for (const entry of diagnostics?.externalRequests ?? []) {
    unexpected.push({ ...entry, kind: 'external_request' })
  }

  for (const entry of diagnostics?.externalResponses ?? []) {
    unexpected.push({ ...entry, kind: 'external_response' })
  }

  for (const entry of diagnostics?.loadingFailures ?? []) {
    const notificationCertificateFailure =
      entry?.surface === 'background' &&
      entry?.location === '/notifications/hub' &&
      entry?.type === 'WebSocket' &&
      entry?.errorText === 'net::ERR_CERT_AUTHORITY_INVALID' &&
      consoleErrors.some(
        (consoleEntry) =>
          consoleEntry?.surface === entry.surface &&
          consoleEntry?.category === 'notifications_websocket_failure',
      )
    const expected =
      (entry?.surface === 'background' &&
        entry?.location === '/api/config' &&
        entry?.type === 'Fetch' &&
        entry?.errorText === 'net::ERR_CERT_AUTHORITY_INVALID') ||
      (entry?.surface === 'popup' &&
        entry?.location === '/icons/[redacted]/icon.png' &&
        entry?.type === 'Image' &&
        entry?.errorText === 'net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin') ||
      notificationCertificateFailure
    if (expected) {
      expectedHostIntegration.loadingFailures.push(entry)
    } else {
      unexpected.push({ ...entry, kind: 'loading_failure' })
    }
  }

  for (const entry of diagnostics?.nonSuccessResponses ?? []) {
    unexpected.push({ ...entry, kind: 'non_success_response' })
  }

  return { expectedHostIntegration, unexpected }
}

export function cleanupOfficialBrowserExtensionResources(resources) {
  if (resources.cleanupPromise) return resources.cleanupPromise
  if (resources.cleanupReadback) {
    return Promise.resolve(resources.cleanupReadback)
  }

  const cleanupPromise = performOfficialBrowserExtensionCleanup(resources)
    .then((readback) => {
      resources.cleanupReadback = readback
      return readback
    })
    .finally(() => {
      if (resources.cleanupPromise === cleanupPromise) {
        resources.cleanupPromise = null
      }
    })
  resources.cleanupPromise = cleanupPromise
  return cleanupPromise
}

async function performOfficialBrowserExtensionCleanup(resources) {
  let browserStopped = !resources.process
  let profile = {
    rootExists: false,
    clipboardCleared: true,
  }
  resources.commands ??= new Set()
  await runCleanupSteps(
    [
      async () => {
        const browser = resources.process
        if (!browser) return
        await requestBrowserClose(resources.cdpEndpoint).catch(() => undefined)
        await waitForChildExit(browser, 3_000)
        await stopDetachedProcessTree(browser)
        resources.process = null
        resources.cdpEndpoint = null
        browserStopped = true
      },
      () =>
        stopTrackedProcesses(
          resources.commands,
          'official browser command cleanup',
        ),
      async () => {
        const currentProfile = resources.profile
        if (!currentProfile) return
        const packet = await cleanupBrowserProfile(
          currentProfile.root,
          currentProfile.browserExecutable,
          resources.commands,
        )
        resources.profile = null
        profile = packet.readback
      },
    ],
    'official browser cleanup',
  )
  return {
    browserStopped,
    profileRemoved: profile.rootExists === false,
    clipboardCleared: profile.clipboardCleared === true,
  }
}

async function waitForChildExit(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return true
    await delay(50)
  }
  return child.exitCode !== null || child.signalCode !== null
}

async function prepareBrowserProfile(root, browserExecutable, commands) {
  const result = await runCommand(
    'pnpm',
    [
      'client:browser-profile',
      '--',
      'prepare',
      '--root',
      root,
      '--browser',
      'chrome-for-testing',
      '--browser-executable',
      browserExecutable,
      '--execute',
      '--confirm',
      browserProfileConfirmation,
    ],
    commands,
  )
  const packet = JSON.parse(result.stdout)
  if (
    packet?.status !== 'prepared' ||
    packet?.readback?.profileUntouched !== true ||
    packet?.readback?.containsCredentials !== false ||
    packet?.launch?.remoteDebuggingPort !== 0
  ) {
    throw new Error('official browser profile prepare readback was invalid')
  }
  return packet
}

async function cleanupBrowserProfile(root, browserExecutable, commands) {
  const result = await runCommand(
    'pnpm',
    [
      'client:browser-profile',
      '--',
      'cleanup',
      '--root',
      root,
      '--browser',
      'chrome-for-testing',
      '--browser-executable',
      browserExecutable,
      '--execute',
      '--confirm',
      browserProfileConfirmation,
    ],
    commands,
  )
  const packet = JSON.parse(result.stdout)
  if (
    packet?.status !== 'clean' ||
    packet?.readback?.rootExists !== false ||
    packet?.readback?.clipboardCleared !== true
  ) {
    throw new Error('official browser profile cleanup readback was invalid')
  }
  return packet
}

function startBrowser(launch) {
  const browser = spawn(
    launch.executable,
    buildIsolatedBrowserLaunchArgs(launch.args),
    {
      cwd: repoRoot,
      detached: true,
      env: isolatedBrowserEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  browser.output = ''
  browser.spawnError = null
  const capture = (chunk) => {
    browser.output = `${browser.output}${chunk.toString()}`.slice(-40_000)
  }
  browser.stdout.on('data', capture)
  browser.stderr.on('data', capture)
  browser.once('error', (error) => {
    browser.spawnError = error
  })
  return browser
}

export function buildIsolatedBrowserLaunchArgs(args) {
  if (
    !Array.isArray(args) ||
    args.some(
      (arg) =>
        typeof arg !== 'string' ||
        browserNetworkSwitches.some((prefix) => arg.startsWith(prefix)),
    )
  ) {
    throw new Error('official browser launch arguments were unsafe')
  }
  return [...args, ...browserNetworkIsolationArgs]
}

export function isolatedBrowserEnvironment(source = process.env) {
  const environment = {}
  for (const key of browserEnvironmentKeys) {
    if (source[key] !== undefined) environment[key] = source[key]
  }
  environment.CI = 'true'
  environment.NO_COLOR = '1'
  environment.pnpm_config_verify_deps_before_run = 'false'
  return environment
}

async function waitForBrowser(browser, profilePath, timeoutMs) {
  const deadline = Date.now() + Math.min(timeoutMs, 30_000)
  let cdpEndpoint = null
  while (Date.now() < deadline) {
    if (browser.spawnError) {
      throw new Error('official browser process failed to start')
    }
    if (browser.exitCode !== null) {
      throw new Error(
        `official browser exited early (${browser.exitCode})\n${browser.output}`,
      )
    }
    if (!cdpEndpoint) {
      try {
        cdpEndpoint = await readDevToolsActivePortEndpoint(profilePath)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
        await delay(100)
        continue
      }
    }
    try {
      const version = await readOwnedBrowserVersion(cdpEndpoint, 1_000)
      return { cdpEndpoint, version }
    } catch (error) {
      if (!browserVersionReadbackIsRetryable(error)) throw error
      // Chrome for Testing is still starting.
    }
    await delay(100)
  }
  throw new Error('official browser CDP endpoint did not become ready')
}

function browserVersionReadbackIsRetryable(error) {
  const message = error instanceof Error ? error.message : ''
  return !(
    message.includes('ownership mismatch') ||
    message.includes('CDP endpoint was invalid')
  )
}

async function waitForBackgroundTarget(cdpEndpoint, browser, timeoutMs) {
  const deadline = Date.now() + Math.min(timeoutMs, 30_000)
  while (Date.now() < deadline) {
    if (browser.exitCode !== null) {
      throw new Error('official browser exited before extension startup')
    }
    const targets = await readTargets(cdpEndpoint)
    const target = targets.find(
      (entry) =>
        entry.type === 'service_worker' &&
        entry.url.startsWith('chrome-extension://') &&
        entry.url.endsWith('/background.js'),
    )
    if (target) return target
    await delay(100)
  }
  throw new Error('official browser extension service worker was not observed')
}

async function acceptLocalCertificate(cdpEndpoint, baseUrl, timeoutMs) {
  const target = await createBlankTarget(cdpEndpoint)
  const client = await CdpClient.connect(target.webSocketDebuggerUrl)
  try {
    await enableAndNavigateEvidenceClient(client, `${baseUrl}/health`)
    await waitForExpression(
      client,
      'document.readyState === "complete"',
      'local certificate page did not load',
      timeoutMs,
    )
    const location = await evaluateValue(client, 'location.href')
    if (location.startsWith('chrome-error://')) {
      const proceeded = await evaluateValue(
        client,
        `(() => {
          const link = document.querySelector("#proceed-link")
          if (!link) return false
          link.click()
          return true
        })()`,
      )
      if (proceeded !== true) {
        throw new Error('local certificate exception control was unavailable')
      }
    }
    await waitForExpression(
      client,
      `location.href === ${JSON.stringify(`${baseUrl}/health`)}`,
      'local certificate exception was not accepted',
      timeoutMs,
    )
    return target
  } finally {
    client.close()
  }
}

async function reachLoginForm(client, timeoutMs) {
  const deadline = Date.now() + Math.min(timeoutMs, 30_000)
  while (Date.now() < deadline) {
    if (await expressionMatches(client, 'document.querySelector("#email")')) {
      return
    }
    await clickButtonByLabels(client, ['Log in', 'ログイン'], false)
    await delay(250)
  }
  const diagnostic = await evaluateValue(
    client,
    `({
      location: location.href,
      text: document.body.innerText.slice(0, 1000),
      buttons: [...document.querySelectorAll("button")]
        .filter((entry) => entry.offsetParent !== null)
        .map((entry) => entry.textContent.trim()),
    })`,
  )
  throw new Error(
    `official browser login form did not render: ${JSON.stringify(diagnostic)}`,
  )
}

async function configureSelfHostedOrigin(client, baseUrl, timeoutMs) {
  const officialCloudLabel = ['bit', 'warden.com'].join('')
  const environmentOpened = await evaluateValue(
    client,
    `(() => {
      const button = [...document.querySelectorAll("button")].find(
        (entry) =>
          entry.offsetParent !== null &&
          entry.textContent.trim() === ${JSON.stringify(officialCloudLabel)},
      )
      if (!button) return false
      button.click()
      return true
    })()`,
  )
  if (environmentOpened !== true) {
    throw new Error('official browser environment selector was unavailable')
  }
  await waitForExpression(
    client,
    `document.body.innerText.includes("Self-hosted") ||
      document.body.innerText.includes("自己ホスト型")`,
    'official browser self-hosted option did not render',
    timeoutMs,
  )
  await clickButtonByLabels(client, ['Self-hosted', '自己ホスト型'])
  await waitForExpression(
    client,
    `document.querySelector(
      "#self_hosted_env_settings_form_input_base_url",
    ) !== null`,
    'official browser self-hosted form did not render',
    timeoutMs,
  )
  await setInputValue(
    client,
    'self_hosted_env_settings_form_input_base_url',
    baseUrl,
  )
  const saved = await evaluateValue(
    client,
    `(() => {
      const input = document.querySelector(
        "#self_hosted_env_settings_form_input_base_url",
      )
      const scope = input?.closest("form") ?? input?.closest("[role=dialog]")
      const button = [...(scope?.querySelectorAll("button") ?? [])].find(
        (entry) => entry.type === "submit" && entry.offsetParent !== null,
      )
      if (!button) return false
      button.click()
      return true
    })()`,
  )
  if (saved !== true) {
    throw new Error('official browser self-hosted form was not submitted')
  }
  await waitForExpression(
    client,
    `document.querySelector(
      "#self_hosted_env_settings_form_input_base_url",
    ) === null`,
    'official browser self-hosted form did not close',
    timeoutMs,
  )
}

async function submitCredentials(client, material, timeoutMs) {
  await setInputValue(client, 'email', material.email)
  await clickButtonByLabels(client, ['Continue', '続ける'])
  await waitForExpression(
    client,
    'document.querySelector("#masterPassword") !== null',
    'official browser password form did not render',
    timeoutMs,
  )
  await setInputValue(
    client,
    'masterPassword',
    material.stages.user_key_rotation.password,
  )
  const submitted = await evaluateValue(
    client,
    `(() => {
      const input = document.querySelector("#masterPassword")
      const scope = input?.closest("form") ?? document
      const button = [...scope.querySelectorAll("button")].find(
        (entry) => entry.type === "submit" && entry.offsetParent !== null,
      )
      if (!button) return false
      button.click()
      return true
    })()`,
  )
  if (submitted !== true) {
    throw new Error('official browser credentials were not submitted')
  }
}

async function openExpectedItem(client, itemName, timeoutMs) {
  const opened = await evaluateValue(
    client,
    `(() => {
      const name = [...document.querySelectorAll("[data-testid=item-name]")]
        .find((entry) => entry.textContent.trim() === ${JSON.stringify(itemName)})
      const button = name?.closest("button")
      if (!button) return false
      button.click()
      return true
    })()`,
  )
  if (opened !== true) {
    throw new Error('official browser expected vault item was unavailable')
  }
  await waitForExpression(
    client,
    'location.hash.startsWith("#/view-cipher")',
    'official browser item detail did not open',
    timeoutMs,
  )
}

async function readDecryptedFields(client, plaintext, cipherId) {
  return evaluateValue(
    client,
    `(() => {
      const body = document.body.innerText
      const parameters = new URLSearchParams(location.hash.split("?")[1] ?? "")
      return {
        itemName: body.includes(${JSON.stringify(plaintext.itemName)}),
        itemUsername:
          document.querySelector("#userName")?.value ===
          ${JSON.stringify(plaintext.itemUsername)},
        itemPassword:
          document.querySelector("#password")?.value ===
          ${JSON.stringify(plaintext.itemPassword)},
        itemNotes:
          document.querySelector("#notes")?.value ===
          ${JSON.stringify(plaintext.itemNotes)},
        attachmentFileName: body.includes(
          ${JSON.stringify(plaintext.attachmentFileName)},
        ),
        cipherRoute: parameters.get("cipherId") === ${JSON.stringify(cipherId)},
      }
    })()`,
  )
}

async function captureScreenshot(client, profileRoot) {
  const result = await client.call('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
  })
  const bytes = Buffer.from(result.result.data, 'base64')
  const path = join(repoRoot, profileRoot, 'item-readback.png')
  await writeFile(path, bytes, { mode: 0o600, flag: 'wx' })
  return {
    file: basename(path),
    bytes: bytes.length,
    sha256: sha256(bytes),
    retained: false,
  }
}

export function createEventRecorder({
  baseUrl,
  diagnostics,
  redactedValues,
  routeStatuses,
  runtimeExceptions,
  startedAtMs,
}) {
  const origin = new URL(baseUrl).origin
  const requestBoundaries = new Map()
  return (message, surface) => {
    if (isHistoricalRuntimeEvent(message, startedAtMs)) return
    if (message.method === 'Network.requestWillBeSent') {
      const boundary = classifyBrowserRequestUrl(
        message.params.request.url,
        origin,
      )
      requestBoundaries.set(message.params.requestId, boundary)
      if (!boundary.allowed) {
        diagnostics.externalRequests.push({
          location: boundary.location,
          surface,
          type: String(message.params.type ?? 'unknown'),
        })
      }
      return
    }
    if (message.method === 'Network.webSocketCreated') {
      const boundary = classifyBrowserRequestUrl(message.params.url, origin)
      requestBoundaries.set(message.params.requestId, boundary)
      if (!boundary.allowed) {
        diagnostics.externalRequests.push({
          location: boundary.location,
          surface,
          type: 'WebSocket',
        })
      }
      return
    }
    if (message.method === 'Network.webSocketHandshakeResponseReceived') {
      const responseUrl = message.params.response?.url ?? message.params.url
      const boundary = responseUrl
        ? classifyBrowserRequestUrl(responseUrl, origin)
        : (requestBoundaries.get(message.params.requestId) ?? {
            allowed: false,
            location: 'unknown',
          })
      const status = Number(message.params.response?.status)
      if (!boundary.allowed) {
        diagnostics.externalResponses.push({
          location: boundary.location,
          status,
          surface,
        })
      } else if (status !== 101) {
        diagnostics.nonSuccessResponses.push({
          location: boundary.location,
          status,
          surface,
          type: 'WebSocket',
        })
      }
      return
    }
    if (message.method === 'Network.webSocketFrameError') {
      const rawMessage = String(
        message.params.errorMessage ?? 'websocket frame error',
      )
      diagnostics.loadingFailures.push({
        errorText:
          rawMessage.match(/net::[A-Z0-9_.-]+/u)?.[0] ??
          'websocket_frame_error',
        location:
          requestBoundaries.get(message.params.requestId)?.location ??
          'unknown',
        surface,
        type: 'WebSocket',
      })
      return
    }
    if (message.method === 'Network.responseReceived') {
      const url = new URL(message.params.response.url)
      const boundary = classifyBrowserRequestUrl(url.href, origin)
      if (!boundary.allowed) {
        diagnostics.externalResponses.push({
          location: boundary.location,
          status: Number(message.params.response.status),
          surface,
        })
      }
      if (url.origin === origin && Object.hasOwn(routeStatuses, url.pathname)) {
        routeStatuses[url.pathname].push(message.params.response.status)
      }
      if (
        url.origin === origin &&
        (message.params.response.status < 200 ||
          message.params.response.status >= 300)
      ) {
        diagnostics.nonSuccessResponses.push({
          location: safeNetworkLocation(url.href, origin),
          status: message.params.response.status,
          surface,
        })
      }
      return
    }
    if (message.method === 'Network.loadingFailed') {
      diagnostics.loadingFailures.push({
        errorText: String(message.params.errorText),
        location:
          requestBoundaries.get(message.params.requestId)?.location ??
          'unknown',
        surface,
        type: String(message.params.type),
      })
      return
    }
    if (message.method === 'Runtime.exceptionThrown') {
      runtimeExceptions.push(
        redactBrowserRuntimeException(
          message.params.exceptionDetails ?? {},
          surface,
          redactedValues,
        ),
      )
      return
    }
    if (
      message.method === 'Runtime.consoleAPICalled' &&
      ['error', 'assert'].includes(String(message.params.type))
    ) {
      const rawMessage = (message.params.args ?? [])
        .map((argument) =>
          argument?.value === undefined
            ? String(argument?.description ?? '')
            : String(argument.value),
        )
        .join(' ')
        .trim()
      const stackUrl =
        message.params.stackTrace?.callFrames?.[0]?.url ?? 'unknown'
      const serverConfigTarget = serverConfigFailureTarget(rawMessage)
      const diagnostic = {
        category: categorizeConsoleMessage(rawMessage, origin),
        location: safeNetworkLocation(stackUrl, origin),
        messageSha256: sha256(rawMessage),
        source: 'console-api',
        surface,
      }
      if (serverConfigTarget) {
        diagnostic.relatedLocation = safeNetworkLocation(
          serverConfigTarget,
          origin,
        )
      }
      diagnostics.consoleErrors.push(diagnostic)
      return
    }
    if (
      message.method === 'Log.entryAdded' &&
      message.params.entry?.level === 'error'
    ) {
      const rawMessage = String(message.params.entry.text ?? 'console error')
      const category = categorizeConsoleMessage(rawMessage, origin)
      const diagnostic = {
        category,
        location: safeNetworkLocation(message.params.entry.url, origin),
        messageSha256: sha256(rawMessage),
        source: String(message.params.entry.source ?? 'unknown'),
        surface,
      }
      const serverConfigTarget = serverConfigFailureTarget(rawMessage)
      if (serverConfigTarget) {
        diagnostic.relatedLocation = safeNetworkLocation(
          serverConfigTarget,
          origin,
        )
      }
      diagnostics.consoleErrors.push(diagnostic)
    }
  }
}

function isHistoricalRuntimeEvent(message, startedAtMs) {
  if (!Number.isFinite(startedAtMs)) return false
  let timestamp
  if (
    message?.method === 'Runtime.consoleAPICalled' ||
    message?.method === 'Runtime.exceptionThrown'
  ) {
    timestamp = Number(message.params?.timestamp)
  } else if (message?.method === 'Log.entryAdded') {
    timestamp = Number(message.params?.entry?.timestamp)
  } else {
    return false
  }
  return Number.isFinite(timestamp) && timestamp < startedAtMs
}

export function redactBrowserRuntimeException(
  details,
  surface,
  redactedValues,
) {
  const description = String(
    details?.exception?.description ?? details?.text ?? 'runtime exception',
  )
  const text = String(details?.text ?? 'runtime exception')
  return {
    surface,
    sha256: sha256(description),
    description: redact(description, redactedValues).slice(0, 2000),
    text: redact(text, redactedValues).slice(0, 2000),
    url: safeRuntimeUrl(details?.url, redactedValues),
    lineNumber: Number(details?.lineNumber ?? -1),
    columnNumber: Number(details?.columnNumber ?? -1),
  }
}

function collectSensitiveStrings(value) {
  const strings = []
  const visit = (entry) => {
    if (typeof entry === 'string') {
      if (entry.length >= 8) strings.push(entry)
      return
    }
    if (Array.isArray(entry)) {
      entry.forEach(visit)
      return
    }
    if (entry && typeof entry === 'object') {
      Object.values(entry).forEach(visit)
    }
  }
  visit(value)
  return [...new Set(strings)].sort((left, right) => right.length - left.length)
}

function redact(value, redactedValues) {
  let output = value
  for (const sensitive of redactedValues) {
    output = output.replaceAll(sensitive, '[redacted]')
  }
  return output
    .replace(/access_token=[^&'"\s]+/giu, 'access_token=[redacted]')
    .replace(
      /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/gu,
      '[redacted-jwt]',
    )
    .replace(/[A-Za-z0-9_-]{43,}/gu, '[redacted-token]')
}

export function categorizeConsoleMessage(value, localOrigin) {
  if (value === notificationsSignalRStartFailureMessage) {
    return 'notifications_signalr_start_failure'
  }
  const notificationTarget = String(value).match(
    /WebSocket connection to ['"]([^'"]+)['"]/u,
  )?.[1]
  if (
    notificationTarget &&
    localNotificationTargetMatchesOrigin(notificationTarget, localOrigin)
  ) {
    return 'notifications_websocket_failure'
  }
  if (/^Unchecked runtime\.lastError: No tab with id: \d+\.$/u.test(value)) {
    return 'closed_bootstrap_tab'
  }
  if (/^Failed to set badge state Error: No tab with id: \d+\.$/u.test(value)) {
    return 'closed_browser_tab_badge_state'
  }
  if (serverConfigFailureTarget(value)) {
    return 'server_config_fetch_failure'
  }
  if (value === 'Failed to load resource: net::ERR_CERT_AUTHORITY_INVALID') {
    return 'certificate_resource_load_failure'
  }
  if (value.startsWith('Failed to load resource:')) {
    return 'resource_load_failure'
  }
  return 'unknown'
}

function serverConfigFailureTarget(value) {
  const match = String(value).match(
    /^Unable to fetch ServerConfig from (https?:\/\/\S+) TypeError: Failed to fetch(?:\n|$)/u,
  )
  if (!match) return null
  try {
    const target = new URL(match[1])
    return ['/', '/api'].includes(target.pathname) &&
      !target.search &&
      !target.hash
      ? target.href
      : null
  } catch {
    return null
  }
}

function localNotificationTargetMatchesOrigin(value, localOrigin) {
  try {
    const target = new URL(value)
    const local = new URL(localOrigin)
    const expectedProtocol = local.protocol === 'https:' ? 'wss:' : 'ws:'
    return (
      target.protocol === expectedProtocol &&
      target.host === local.host &&
      target.pathname === '/notifications/hub' &&
      target.searchParams.has('access_token')
    )
  } catch {
    return false
  }
}

function safeRuntimeUrl(value, redactedValues) {
  try {
    const url = new URL(String(value))
    return redact(
      `${url.protocol}//${url.host}${url.pathname}`,
      redactedValues,
    ).slice(0, 2000)
  } catch {
    return 'unknown'
  }
}

export function classifyBrowserRequestUrl(value, localOrigin) {
  let url
  try {
    url = new URL(String(value))
  } catch {
    return { allowed: false, location: 'unknown' }
  }
  const localNetworkOrigin = normalizedNetworkOrigin(url)
  const allowed =
    localNetworkOrigin === localOrigin ||
    url.protocol === 'chrome-extension:' ||
    url.protocol === 'data:' ||
    url.protocol === 'about:' ||
    (url.protocol === 'blob:' &&
      (url.origin === localOrigin ||
        url.origin.startsWith('chrome-extension://')))
  return {
    allowed,
    location: safeNetworkLocation(url.href, localOrigin),
  }
}

function safeNetworkLocation(value, localOrigin) {
  try {
    const url = new URL(String(value))
    if (normalizedNetworkOrigin(url) === localOrigin) {
      if (url.pathname.startsWith('/icons/')) {
        return '/icons/[redacted]/icon.png'
      }
      return url.pathname
    }
    if (url.protocol === 'chrome-extension:') {
      return `chrome-extension://[extension]${url.pathname}`
    }
    return `external-origin-sha256:${sha256(url.origin)}`
  } catch {
    return 'unknown'
  }
}

function normalizedNetworkOrigin(url) {
  if (url.protocol === 'wss:' || url.protocol === 'ws:') {
    const equivalent = new URL(url.href)
    equivalent.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
    return equivalent.origin
  }
  return url.origin
}

async function enableEvidenceDomains(client, pageRequired = false) {
  await client.call('Network.enable')
  await client.call('Runtime.enable')
  await client.call('Log.enable')
  if (pageRequired) {
    await client.call('Page.enable')
  } else {
    await client.call('Page.enable').catch(() => undefined)
  }
}

export async function enableAndNavigateEvidenceClient(client, url) {
  await enableEvidenceDomains(client, true)
  await client.call('Page.navigate', { url })
}

async function waitForRequiredRoutes(routeStatuses, timeoutMs) {
  const deadline = Date.now() + Math.min(timeoutMs, 30_000)
  while (Date.now() < deadline) {
    if (
      requiredRoutePaths.every(
        (path) =>
          routeStatuses[path].length > 0 &&
          routeStatuses[path].every((status) => status === 200),
      )
    ) {
      return
    }
    await delay(100)
  }
}

async function clickButtonByLabels(client, labels, required = true) {
  const clicked = await evaluateValue(
    client,
    `(() => {
      const labels = ${JSON.stringify(labels)}
      const button = [...document.querySelectorAll("button")].find(
        (entry) =>
          entry.offsetParent !== null &&
          labels.includes(entry.textContent.trim()),
      )
      if (!button) return false
      button.click()
      return true
    })()`,
  )
  if (clicked !== true && required) {
    throw new Error(
      `official browser control ${labels.join('/')} was unavailable`,
    )
  }
  return clicked === true
}

async function setInputValue(client, id, value) {
  const changed = await evaluateValue(
    client,
    `(() => {
      const input = document.getElementById(${JSON.stringify(id)})
      if (!(input instanceof HTMLInputElement)) return false
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set
      setter.call(input, ${JSON.stringify(value)})
      input.dispatchEvent(new Event("input", { bubbles: true }))
      input.dispatchEvent(new Event("change", { bubbles: true }))
      return input.value === ${JSON.stringify(value)}
    })()`,
  )
  if (changed !== true) {
    throw new Error(`official browser input ${id} was unavailable`)
  }
}

async function waitForExpression(client, expression, message, timeoutMs) {
  const deadline = Date.now() + Math.min(timeoutMs, 30_000)
  while (Date.now() < deadline) {
    if (await expressionMatches(client, expression)) return
    await delay(100)
  }
  throw new Error(message)
}

async function expressionMatches(client, expression) {
  try {
    return Boolean(await evaluateValue(client, `Boolean(${expression})`))
  } catch {
    return false
  }
}

async function evaluateValue(client, expression) {
  const response = await client.call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (response.result.exceptionDetails) {
    throw new Error('official browser evaluation failed')
  }
  return response.result.result.value
}

export function parseDevToolsActivePortFile(value) {
  if (typeof value !== 'string') {
    throw new Error('official browser DevToolsActivePort was invalid')
  }
  const lines = value.replace(/\r\n/gu, '\n').split('\n')
  const portText = lines[0]
  const browserPath = lines[1]
  const trailing = lines.slice(2).filter((line) => line.length > 0)
  if (
    !/^[0-9]+$/u.test(portText ?? '') ||
    typeof browserPath !== 'string' ||
    trailing.length > 0
  ) {
    throw new Error('official browser DevToolsActivePort was invalid')
  }

  const port = Number(portText)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('official browser DevToolsActivePort port was invalid')
  }
  if (
    !browserPath.startsWith('/devtools/browser/') ||
    browserPath.includes('?') ||
    browserPath.includes('#') ||
    /\s/u.test(browserPath)
  ) {
    throw new Error('official browser DevToolsActivePort path was invalid')
  }

  return Object.freeze({
    address: '127.0.0.1',
    browserPath,
    origin: `http://127.0.0.1:${port}`,
    port,
    webSocketDebuggerUrl: `ws://127.0.0.1:${port}${browserPath}`,
  })
}

export async function readDevToolsActivePortEndpoint(profilePath) {
  const profileDirectory = resolve(repoRoot, profilePath)
  const activePortPath = join(profileDirectory, 'DevToolsActivePort')
  const profileInfo = await lstat(profileDirectory)
  if (profileInfo.isSymbolicLink() || !profileInfo.isDirectory()) {
    throw new Error('official browser profile directory was invalid')
  }
  if ((profileInfo.mode & 0o077) !== 0) {
    throw new Error('official browser profile directory was not private')
  }

  const activePortInfo = await lstat(activePortPath)
  if (activePortInfo.isSymbolicLink() || !activePortInfo.isFile()) {
    throw new Error('official browser DevToolsActivePort was invalid')
  }

  const [realProfileDirectory, realActivePortPath] = await Promise.all([
    realpath(profileDirectory),
    realpath(activePortPath),
  ])
  const relativeActivePort = relative(realProfileDirectory, realActivePortPath)
  if (
    relativeActivePort !== 'DevToolsActivePort' ||
    relativeActivePort.startsWith(`..${sep}`) ||
    relativeActivePort === '..'
  ) {
    throw new Error('official browser DevToolsActivePort escaped the profile')
  }

  return parseDevToolsActivePortFile(await readFile(activePortPath, 'utf8'))
}

export async function readOwnedBrowserVersion(cdpEndpoint, timeoutMs = 5_000) {
  const response = await globalThis.fetch(
    cdpEndpointUrl(cdpEndpoint, '/json/version'),
    {
      signal: globalThis.AbortSignal.timeout(timeoutMs),
    },
  )
  if (!response.ok) {
    throw new Error('official browser version readback failed')
  }
  const version = await response.json()
  if (version?.webSocketDebuggerUrl !== cdpEndpoint.webSocketDebuggerUrl) {
    throw new Error('official browser CDP endpoint ownership mismatch')
  }
  return version
}

export async function createBlankTarget(cdpEndpoint) {
  const response = await globalThis.fetch(
    cdpEndpointUrl(cdpEndpoint, '/json/new?about:blank'),
    {
      method: 'PUT',
      signal: globalThis.AbortSignal.timeout(5_000),
    },
  )
  if (!response.ok) {
    throw new Error('official browser target creation failed')
  }
  return response.json()
}

export async function closeTarget(cdpEndpoint, id) {
  const response = await globalThis.fetch(
    cdpEndpointUrl(cdpEndpoint, `/json/close/${encodeURIComponent(id)}`),
    {
      signal: globalThis.AbortSignal.timeout(5_000),
    },
  )
  if (!response.ok) {
    throw new Error('official browser target cleanup failed')
  }
}

export async function readTargets(cdpEndpoint) {
  const response = await globalThis.fetch(
    cdpEndpointUrl(cdpEndpoint, '/json/list'),
    {
      signal: globalThis.AbortSignal.timeout(5_000),
    },
  )
  if (!response.ok) {
    throw new Error('official browser target readback failed')
  }
  return response.json()
}

async function requestBrowserClose(cdpEndpoint) {
  if (!cdpEndpoint) return
  await readOwnedBrowserVersion(cdpEndpoint, 2_000)
  const client = await CdpClient.connect(cdpEndpoint.webSocketDebuggerUrl)
  try {
    await client.call('Browser.close')
  } finally {
    client.close()
  }
}

function cdpEndpointUrl(cdpEndpoint, path) {
  if (
    !cdpEndpoint ||
    cdpEndpoint.address !== '127.0.0.1' ||
    !Number.isSafeInteger(cdpEndpoint.port) ||
    cdpEndpoint.port < 1 ||
    cdpEndpoint.port > 65_535
  ) {
    throw new Error('official browser CDP endpoint was invalid')
  }
  return `http://127.0.0.1:${cdpEndpoint.port}${path}`
}

function runCommand(command, args, commands) {
  return runBoundedCommand(command, args, {
    activeProcesses: commands,
    cwd: repoRoot,
    env: isolatedBrowserEnvironment(),
    label: `official browser ${command}`,
    timeoutMs: 120_000,
  })
}

function validateInputs({ baseUrl, browserExecutable, cipherId, material }) {
  let url
  try {
    url = new URL(baseUrl)
  } catch {
    throw new Error('official browser base URL was invalid')
  }
  if (
    url.protocol !== 'https:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('official browser base URL must be loopback HTTPS')
  }
  requiredString(browserExecutable, 'browser executable')
  requiredString(cipherId, 'cipher id')
  requiredString(material?.email, 'credential email')
  requiredString(
    material?.stages?.user_key_rotation?.password,
    'rotation password',
  )
  for (const field of [
    'itemName',
    'itemUsername',
    'itemPassword',
    'itemNotes',
    'attachmentFileName',
  ]) {
    requiredString(material?.plaintext?.[field], `plaintext ${field}`)
  }
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} was missing`)
  }
  return value
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => {
    globalThis.setTimeout(resolveDelay, milliseconds)
  })
}

export class CdpClient {
  static async connect(
    url,
    onEvent = () => undefined,
    timeoutMs = defaultCdpTimeoutMs,
  ) {
    const socket = new globalThis.WebSocket(url)
    await new Promise((resolveSocket, rejectSocket) => {
      const timeout = globalThis.setTimeout(() => {
        socket.close()
        rejectSocket(new Error('official browser CDP connection timed out'))
      }, timeoutMs)
      const settle = (callback) => (event) => {
        globalThis.clearTimeout(timeout)
        callback(event)
      }
      socket.addEventListener('open', settle(resolveSocket), { once: true })
      socket.addEventListener('error', settle(rejectSocket), { once: true })
    })
    return new CdpClient(socket, onEvent)
  }

  constructor(socket, onEvent) {
    this.socket = socket
    this.onEvent = onEvent
    this.nextId = 0
    this.pending = new Map()
    this.eventError = null
    this.closing = false
    socket.addEventListener('message', (event) => {
      let message
      try {
        message = JSON.parse(event.data)
      } catch {
        this.failEvents(new Error('official browser CDP event was invalid'))
        return
      }
      if (message.id) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        globalThis.clearTimeout(pending.timeout)
        if (message.error) {
          pending.reject(new Error('official browser CDP command failed'))
        } else {
          pending.resolve(message)
        }
        return
      }
      try {
        this.onEvent(message)
      } catch {
        this.failEvents(
          new Error('official browser CDP event validation failed'),
        )
      }
    })
    socket.addEventListener('close', () => {
      const error = new Error('official browser CDP connection closed')
      if (this.closing) {
        this.rejectPending(error)
      } else {
        this.failEvents(error)
      }
    })
    socket.addEventListener('error', () => {
      if (!this.closing) {
        this.failEvents(new Error('official browser CDP connection failed'))
      }
    })
  }

  failEvents(error) {
    this.eventError ??= error
    this.rejectPending(this.eventError)
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      globalThis.clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
  }

  call(method, params = {}, timeoutMs = defaultCdpTimeoutMs) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 120_000) {
      return Promise.reject(
        new Error('official browser CDP timeout was invalid'),
      )
    }
    if (this.eventError) return Promise.reject(this.eventError)
    const id = (this.nextId += 1)
    return new Promise((resolveCall, rejectCall) => {
      const timeout = globalThis.setTimeout(() => {
        if (!this.pending.delete(id)) return
        rejectCall(new Error('official browser CDP command timed out'))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: resolveCall,
        reject: rejectCall,
        timeout,
      })
      try {
        this.socket.send(JSON.stringify({ id, method, params }))
      } catch {
        globalThis.clearTimeout(timeout)
        this.pending.delete(id)
        rejectCall(new Error('official browser CDP command failed'))
      }
    })
  }

  assertHealthy() {
    if (this.eventError) throw this.eventError
  }

  close() {
    if (
      this.closing ||
      this.socket.readyState >= globalThis.WebSocket.CLOSING
    ) {
      return
    }
    this.closing = true
    this.socket.close()
  }
}

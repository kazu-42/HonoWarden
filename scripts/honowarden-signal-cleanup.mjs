import { spawn } from 'node:child_process'
import process from 'node:process'

const terminationSignals = ['SIGINT', 'SIGTERM']
const workerOutputLimit = 40_000
const signalCleanupCoordinator = {
  activeSignal: null,
  cleanups: new Set(),
  disposed: false,
  listeners: new Map(),
}

export async function runCleanupSteps(steps, label = 'cleanup') {
  if (
    !Array.isArray(steps) ||
    steps.some((step) => typeof step !== 'function')
  ) {
    throw new TypeError('cleanup steps must be functions')
  }

  const errors = []
  for (const step of steps) {
    try {
      await step()
    } catch (error) {
      errors.push(
        error instanceof Error ? error : new Error('unknown cleanup failure'),
      )
    }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      `${label} failed with ${errors.length} errors`,
    )
  }
}

export function createIdempotentCleanup(cleanup) {
  if (typeof cleanup !== 'function') {
    throw new TypeError('cleanup must be a function')
  }

  let cleanupPromise
  return (...args) => {
    cleanupPromise ??= Promise.resolve().then(() => cleanup(...args))
    return cleanupPromise
  }
}

export function installSignalCleanup(cleanup) {
  if (typeof cleanup !== 'function') {
    throw new TypeError('signal cleanup must be a function')
  }

  const registration = { cleanup, disposed: false }
  signalCleanupCoordinator.cleanups.add(registration)
  ensureSignalCoordinatorInstalled()

  return () => {
    if (registration.disposed) return
    registration.disposed = true
    signalCleanupCoordinator.cleanups.delete(registration)
    uninstallSignalCoordinatorIfIdle()
  }
}

export async function stopDetachedProcessTree(worker, options = {}) {
  const processGroupId = worker.pid
  if (!Number.isSafeInteger(processGroupId) || processGroupId <= 0) {
    return
  }

  const platform = options.platform ?? process.platform
  const processKill =
    options.processKill ??
    ((processId, signal) => process.kill(processId, signal))

  try {
    if (platform === 'win32') {
      await stopWindowsProcessTree(processGroupId, {
        processKill,
        runTaskkill: options.runTaskkill ?? runTaskkill,
        timeoutMilliseconds: options.windowsTimeoutMilliseconds ?? 2_000,
        wait: options.wait ?? delay,
      })
      return
    }

    await stopPosixProcessGroup(worker, processGroupId, {
      processKill,
      gracefulTimeoutMilliseconds: options.gracefulTimeoutMilliseconds ?? 5_000,
      forceTimeoutMilliseconds: options.forceTimeoutMilliseconds ?? 2_000,
      wait: options.wait ?? delay,
    })
  } finally {
    worker.stdout?.destroy()
    worker.stderr?.destroy()
  }
}

export async function stopTrackedProcesses(
  activeProcesses,
  label = 'tracked process cleanup',
) {
  if (!(activeProcesses instanceof Set)) {
    throw new TypeError('active processes must be a Set')
  }
  const processes = [...activeProcesses]
  await runCleanupSteps(
    processes.map((child) => async () => {
      try {
        await stopDetachedProcessTree(child)
      } finally {
        activeProcesses.delete(child)
      }
    }),
    label,
  )
}

export async function runBoundedCommand(command, args, options = {}) {
  if (typeof command !== 'string' || command.length === 0) {
    throw new TypeError('bounded command must be a non-empty string')
  }
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw new TypeError('bounded command arguments must be strings')
  }
  const timeoutMs = options.timeoutMs ?? 120_000
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300_000) {
    throw new Error('bounded command timeout must be between 100 and 300000')
  }
  const outputLimit = options.outputLimit ?? 100_000
  if (!Number.isInteger(outputLimit) || outputLimit < 1) {
    throw new Error('bounded command output limit was invalid')
  }
  const activeProcesses = options.activeProcesses ?? new Set()
  if (!(activeProcesses instanceof Set)) {
    throw new TypeError('active processes must be a Set')
  }
  const label = options.label ?? command
  const child = spawn(command, args, {
    cwd: options.cwd,
    detached: options.detached ?? true,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  activeProcesses.add(child)

  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk) => {
    stdout = `${stdout}${chunk.toString()}`.slice(-outputLimit)
  })
  child.stderr?.on('data', (chunk) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-outputLimit)
  })

  let settle
  const completed = new Promise((resolve) => {
    let settled = false
    settle = (outcome) => {
      if (settled) return
      settled = true
      resolve(outcome)
    }
    child.once('error', (error) => settle({ type: 'error', error }))
    child.once('close', (exitCode, signal) =>
      settle({ type: 'close', exitCode, signal }),
    )
  })
  let timeout
  const timedOut = new Promise((resolve) => {
    timeout = globalThis.setTimeout(
      () => resolve({ type: 'timeout' }),
      timeoutMs,
    )
    timeout.unref?.()
  })

  try {
    const outcome = await Promise.race([completed, timedOut])
    if (outcome.type === 'timeout') {
      await stopDetachedProcessTree(child)
      throw new Error(`${label} timed out after ${timeoutMs}ms`)
    }
    if (outcome.type === 'error') {
      if (Number.isSafeInteger(child.pid) && child.pid > 0) {
        await stopDetachedProcessTree(child).catch(() => undefined)
      }
      throw new Error(`${label} could not start`)
    }
    if (outcome.exitCode !== 0) {
      await stopDetachedProcessTree(child).catch(() => undefined)
      throw new Error(
        `${label} failed with exit ${String(outcome.exitCode)}${
          outcome.signal ? ` (${outcome.signal})` : ''
        }`,
      )
    }
    if ((options.platform ?? process.platform) !== 'win32') {
      await stopDetachedProcessTree(child, {
        gracefulTimeoutMilliseconds: options.gracefulTimeoutMilliseconds,
        forceTimeoutMilliseconds: options.forceTimeoutMilliseconds,
        processKill: options.processKill,
        wait: options.wait,
      })
    }
    return {
      stdout,
      stderr,
      exitCode: outcome.exitCode,
      signal: outcome.signal,
    }
  } finally {
    globalThis.clearTimeout(timeout)
    activeProcesses.delete(child)
  }
}

async function stopWindowsProcessTree(
  processId,
  { processKill, runTaskkill, timeoutMilliseconds, wait },
) {
  const result = await runTaskkill(processId)
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim()
    throw new Error(
      detail
        ? `taskkill failed (${result.exitCode}): ${detail}`
        : `taskkill failed (${result.exitCode})`,
    )
  }

  const stopped = await waitForProcessExit(
    processId,
    timeoutMilliseconds,
    processKill,
    wait,
  )
  if (!stopped) {
    throw new Error(`Windows process tree ${processId} did not stop`)
  }
}

async function stopPosixProcessGroup(
  worker,
  processGroupId,
  { processKill, gracefulTimeoutMilliseconds, forceTimeoutMilliseconds, wait },
) {
  signalProcessGroup(worker, processGroupId, 'SIGTERM', processKill)
  let stopped = await waitForProcessGroupExit(
    processGroupId,
    gracefulTimeoutMilliseconds,
    processKill,
    wait,
  )
  if (!stopped) {
    signalProcessGroup(worker, processGroupId, 'SIGKILL', processKill)
    stopped = await waitForProcessGroupExit(
      processGroupId,
      forceTimeoutMilliseconds,
      processKill,
      wait,
    )
  }
  if (!stopped) {
    throw new Error(`process group ${processGroupId} did not stop`)
  }
}

function signalProcessGroup(worker, processGroupId, signal, processKill) {
  try {
    processKill(-processGroupId, signal)
  } catch (error) {
    if (error?.code === 'ESRCH') return
    if (
      worker.exitCode === null &&
      worker.signalCode === null &&
      typeof worker.kill === 'function' &&
      worker.kill(signal)
    ) {
      return
    }
    throw error
  }
}

async function waitForProcessGroupExit(
  processGroupId,
  timeoutMilliseconds,
  processKill,
  wait,
) {
  return waitForProcessExit(
    -processGroupId,
    timeoutMilliseconds,
    processKill,
    wait,
  )
}

async function waitForProcessExit(
  processId,
  timeoutMilliseconds,
  processKill,
  wait,
) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    try {
      processKill(processId, 0)
    } catch (error) {
      if (error?.code === 'ESRCH') {
        return true
      }
      if (error?.code === 'EPERM' && processId < 0) {
        // macOS reports EPERM while a terminated process-group leader is a
        // zombie waiting for Node to reap it. Keep polling; a live group still
        // reaches the bounded timeout and is never treated as stopped.
        await wait(50)
        continue
      }
      throw error
    }
    await wait(50)
  }
  return false
}

function runTaskkill(processId) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'taskkill.exe',
      ['/PID', String(processId), '/T', '/F'],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout = `${stdout}${chunk.toString()}`.slice(-workerOutputLimit)
    })
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-workerOutputLimit)
    })
    child.once('error', reject)
    child.once('close', (exitCode, signal) => {
      resolve({ exitCode, signal, stdout, stderr })
    })
  })
}

function delay(milliseconds) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds))
}

function ensureSignalCoordinatorInstalled() {
  if (signalCleanupCoordinator.listeners.size > 0) return
  signalCleanupCoordinator.disposed = false
  for (const signal of terminationSignals) {
    const listener = () => {
      void handleCoordinatedSignal(signal)
    }
    signalCleanupCoordinator.listeners.set(signal, listener)
    process.on(signal, listener)
  }
}

function uninstallSignalCoordinatorIfIdle() {
  if (
    signalCleanupCoordinator.activeSignal ||
    signalCleanupCoordinator.cleanups.size > 0 ||
    signalCleanupCoordinator.listeners.size === 0
  ) {
    return
  }
  disposeSignalCoordinator()
}

function disposeSignalCoordinator() {
  if (signalCleanupCoordinator.disposed) return
  signalCleanupCoordinator.disposed = true
  for (const [signal, listener] of signalCleanupCoordinator.listeners) {
    process.removeListener(signal, listener)
  }
  signalCleanupCoordinator.listeners.clear()
}

async function handleCoordinatedSignal(signal) {
  if (signalCleanupCoordinator.activeSignal) {
    disposeSignalCoordinator()
    process.kill(process.pid, signal)
    return
  }
  signalCleanupCoordinator.activeSignal = signal
  const registrations = [...signalCleanupCoordinator.cleanups]
  try {
    await runCleanupSteps(
      registrations.map((registration) => async () => {
        await registration.cleanup(signal)
      }),
      'signal cleanup',
    )
  } catch (error) {
    writeSignalCleanupError(error)
  } finally {
    for (const registration of registrations) {
      registration.disposed = true
      signalCleanupCoordinator.cleanups.delete(registration)
    }
    signalCleanupCoordinator.activeSignal = null
    disposeSignalCoordinator()
    process.kill(process.pid, signal)
  }
}

function writeSignalCleanupError(error) {
  if (error instanceof AggregateError) {
    process.stderr.write(`signal cleanup failed: ${error.message}\n`)
    for (const cause of error.errors) {
      const message =
        cause instanceof Error ? cause.message : 'unknown cleanup failure'
      process.stderr.write(`signal cleanup failure: ${message}\n`)
    }
    return
  }
  const message =
    error instanceof Error ? error.message : 'unknown cleanup failure'
  process.stderr.write(`signal cleanup failed: ${message}\n`)
}

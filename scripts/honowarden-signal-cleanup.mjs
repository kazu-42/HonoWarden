import { spawn } from 'node:child_process'
import process from 'node:process'

const terminationSignals = ['SIGINT', 'SIGTERM']
const workerOutputLimit = 40_000

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

  let activeSignal = null
  let disposed = false
  const listeners = new Map()

  const dispose = () => {
    if (disposed) return
    disposed = true
    for (const [signal, listener] of listeners) {
      process.removeListener(signal, listener)
    }
  }

  const finishTermination = async (signal) => {
    try {
      await cleanup(signal)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'unknown cleanup failure'
      process.stderr.write(`signal cleanup failed: ${message}\n`)
    } finally {
      dispose()
      process.kill(process.pid, signal)
    }
  }

  for (const signal of terminationSignals) {
    const listener = () => {
      if (activeSignal) {
        dispose()
        process.kill(process.pid, signal)
        return
      }
      activeSignal = signal
      void finishTermination(signal)
    }
    listeners.set(signal, listener)
    process.on(signal, listener)
  }

  return dispose
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
    throw new Error(`wrangler process group ${processGroupId} did not stop`)
  }
}

function signalProcessGroup(worker, processGroupId, signal, processKill) {
  try {
    processKill(-processGroupId, signal)
  } catch (error) {
    if (error?.code !== 'ESRCH') {
      worker.kill(signal)
    }
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

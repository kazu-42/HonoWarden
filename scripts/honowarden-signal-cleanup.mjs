import process from 'node:process'

const terminationSignals = ['SIGINT', 'SIGTERM']

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

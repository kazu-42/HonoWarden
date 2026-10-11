import { Buffer } from 'node:buffer'
import { setTimeout, clearTimeout } from 'node:timers'
import { URL } from 'node:url'
import { ControllerFailure, ensure, requireCdpEndpoint } from './policy.mjs'

const { fetch, AbortController } = globalThis

// Only an already proved, owned loopback page endpoint may be connected.
export async function connectCdp(
  endpoint,
  port,
  WebSocket,
  { timeoutMs = 5000, maxBytes = 262144 } = {},
) {
  requireCdpEndpoint(endpoint, port)
  ensure(
    typeof WebSocket === 'function' && timeoutMs > 0 && timeoutMs <= 10000,
    'cdp_endpoint_invalid',
  )
  const socket = new WebSocket(endpoint, { maxPayload: maxBytes })
  const pending = new Map()
  let nextId = 0,
    closed = false
  const close = () => {
    if (closed) return
    closed = true
    for (const item of pending.values()) {
      clearTimeout(item.timer)
      item.reject(new ControllerFailure('cdp_closed'))
    }
    pending.clear()
    try {
      socket.terminate()
    } catch {
      /* Closing an already closed owned socket is harmless. */
    }
  }
  socket.on('close', close)
  socket.on('error', close)
  socket.on('message', (raw) => {
    try {
      ensure(raw.length <= maxBytes, 'cdp_malformed')
      const value = JSON.parse(raw.toString())
      if (value.id === undefined) return // No console, network payload, or protocol event is retained.
      ensure(Number.isSafeInteger(value.id), 'cdp_malformed')
      const item = pending.get(value.id)
      if (!item) return
      pending.delete(value.id)
      clearTimeout(item.timer)
      if (value.error) item.reject(new ControllerFailure('cdp_command_failed'))
      else item.resolve(value.result)
    } catch {
      close()
    }
  })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      close()
      reject(new ControllerFailure('cdp_timeout'))
    }, timeoutMs)
    socket.once('open', () => {
      clearTimeout(timer)
      resolve()
    })
    socket.once('error', () => {
      clearTimeout(timer)
      reject(new ControllerFailure('cdp_closed'))
    })
    socket.once('close', () => {
      clearTimeout(timer)
      reject(new ControllerFailure('cdp_closed'))
    })
  })
  function command(method, params = {}) {
    ensure(
      !closed && pending.size < 20 && /^[A-Za-z]+\.[A-Za-z]+$/.test(method),
      'cdp_closed',
    )
    const id = ++nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new ControllerFailure('cdp_timeout'))
        close()
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      try {
        socket.send(JSON.stringify({ id, method, params }))
      } catch {
        close()
      }
    })
  }
  return {
    command,
    close,
    async evaluate(fn, args = []) {
      ensure(
        typeof fn === 'function' && Array.isArray(args),
        'cdp_command_failed',
      )
      const expression = `(${fn.toString()})(...${JSON.stringify(args)})`
      ensure(Buffer.byteLength(expression) <= 65536, 'cdp_command_failed')
      const result = await command('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
      ensure(
        !result?.exceptionDetails &&
          result?.result?.type !== 'undefined' &&
          result?.result?.subtype !== 'error',
        'cdp_command_failed',
      )
      return result.result.value
    },
  }
}

export async function boundedJson(
  url,
  { fetcher = fetch, maxBytes = 65536, timeoutMs = 3000 } = {},
) {
  const address = new URL(url)
  ensure(
    address.protocol === 'http:' &&
      address.hostname === '127.0.0.1' &&
      /^\/json\/(list|version)$/.test(address.pathname) &&
      !address.search &&
      !address.hash &&
      !address.username &&
      !address.password,
    'cdp_endpoint_invalid',
  )
  const abort = new AbortController(),
    timer = setTimeout(() => abort.abort(), timeoutMs)
  let reader
  try {
    const response = await fetcher(address, {
      redirect: 'error',
      signal: abort.signal,
    })
    ensure(response.status === 200, 'cdp_command_failed')
    reader = response.body.getReader()
    let bytes = 0
    const parts = []
    for (;;) {
      const item = await reader.read()
      if (item.done) break
      bytes += item.value.length
      ensure(bytes <= maxBytes, 'cdp_malformed')
      parts.push(Buffer.from(item.value))
    }
    return JSON.parse(Buffer.concat(parts).toString())
  } catch (error) {
    throw new ControllerFailure(error?.code ?? 'cdp_command_failed')
  } finally {
    clearTimeout(timer)
    if (reader) {
      try {
        await reader.cancel()
      } catch {
        // Reader cancellation remains best effort after a command failure.
      }
      reader.releaseLock()
    }
  }
}

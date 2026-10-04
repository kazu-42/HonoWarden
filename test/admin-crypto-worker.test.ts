import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCryptoPort } from '../admin/browser/crypto-client'

class ControlledWorker {
  static current: ControlledWorker
  readonly terminate = vi.fn()
  readonly postMessage = vi.fn()
  private readonly listeners = new Map<string, (() => void)[]>()

  constructor() {
    ControlledWorker.current = this
  }

  addEventListener(name: string, listener: () => void): void {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener])
  }

  fail(name: 'error' | 'messageerror'): void {
    for (const listener of this.listeners.get(name) ?? []) listener()
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('browser crypto worker failure boundary', () => {
  it('reports unavailable construction without falling back to main-thread crypto', () => {
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('Private browser failure')
        }
      },
    )
    expect(() => createCryptoPort()).toThrow(
      expect.objectContaining({ kind: 'crypto', code: 'crypto_unavailable' }),
    )
  })

  it.each(['error', 'messageerror'] as const)(
    'terminates the worker and rejects all pending calls on %s',
    async (event) => {
      vi.stubGlobal('Worker', ControlledWorker)
      const port = createCryptoPort()
      const first = expect(
        port.call({
          action: 'encryptName',
          organizationId: 'org',
          name: 'Public name',
        }),
      ).rejects.toMatchObject({ kind: 'crypto', code: 'crypto_unavailable' })
      const second = expect(
        port.call({
          action: 'wrapMember',
          organizationId: 'org',
          publicKey: 'Public synthetic value',
        }),
      ).rejects.toMatchObject({ kind: 'crypto', code: 'crypto_unavailable' })
      ControlledWorker.current.fail(event)
      await Promise.all([first, second])
      expect(ControlledWorker.current.terminate).toHaveBeenCalledOnce()
      await expect(
        port.call({
          action: 'decryptName',
          organizationId: 'org',
          encrypted: 'Public synthetic value',
        }),
      ).rejects.toMatchObject({ code: 'crypto_unavailable' })
    },
  )

  it('terminates an unresponsive worker and reports a distinct crypto timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('Worker', ControlledWorker)
    const port = createCryptoPort()
    const pending = expect(
      port.call({
        action: 'derive',
        email: 'public@example.test',
        password: 'Public vector password',
        settings: {
          type: 0,
          iterations: 5000,
          memory: null,
          parallelism: null,
        },
      }),
    ).rejects.toMatchObject({ kind: 'crypto', code: 'crypto_timeout' })
    await vi.advanceTimersByTimeAsync(60_000)
    await pending
    expect(ControlledWorker.current.terminate).toHaveBeenCalledOnce()
  })
})

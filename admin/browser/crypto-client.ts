import { AdminError } from './contracts'
import type { KdfSettings } from './crypto/kdf'
import type { WrappedAccount, WrappedOrganization } from './crypto/keyring'

export type CryptoCommand =
  | { action: 'derive'; email: string; password: string; settings: KdfSettings }
  | { action: 'unlock'; account: WrappedAccount }
  | { action: 'organizations'; organizations: WrappedOrganization[] }
  | { action: 'decryptName'; organizationId: string; encrypted: string }
  | { action: 'encryptName'; organizationId: string; name: string }
  | { action: 'wrapMember'; organizationId: string; publicKey: string }
  | {
      action: 'createOrganization'
      input: { name: string; collectionName: string; billingEmail?: string }
    }
export interface CryptoPort {
  call<T>(command: CryptoCommand): Promise<T>
  dispose(): void
}

export function createCryptoPort(): CryptoPort {
  if (globalThis.isSecureContext === false)
    throw new AdminError('crypto', 'secure_context_required')
  let worker: Worker
  try {
    worker = new Worker(new URL('./crypto.worker.ts', import.meta.url), {
      type: 'module',
    })
  } catch {
    throw new AdminError('crypto', 'crypto_unavailable')
  }
  let nextId = 0
  let closed = false
  const pending = new Map<
    number,
    {
      resolve(value: unknown): void
      reject(error: AdminError): void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  const dispose = (
    reason = new AdminError('cancelled', 'operation_cancelled'),
  ) => {
    closed = true
    worker.terminate()
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(reason)
    }
    pending.clear()
  }
  worker.addEventListener(
    'message',
    (
      event: MessageEvent<{
        id: number
        ok: boolean
        value?: unknown
        code?: string
      }>,
    ) => {
      const message = event.data
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      clearTimeout(request.timer)
      if (message.ok) request.resolve(message.value)
      else
        request.reject(
          new AdminError(
            'crypto',
            /^[a-z_]{1,80}$/.test(message.code ?? '')
              ? message.code!
              : 'crypto_unavailable',
          ),
        )
    },
  )
  worker.addEventListener('error', () =>
    dispose(new AdminError('crypto', 'crypto_unavailable')),
  )
  worker.addEventListener('messageerror', () =>
    dispose(new AdminError('crypto', 'crypto_unavailable')),
  )
  return {
    call<T>(command: CryptoCommand): Promise<T> {
      if (closed)
        return Promise.reject(new AdminError('crypto', 'crypto_unavailable'))
      return new Promise((resolve, reject) => {
        const id = ++nextId
        const timer = setTimeout(
          () => dispose(new AdminError('crypto', 'crypto_timeout')),
          60_000,
        )
        pending.set(id, {
          resolve: (value) => resolve(value as T),
          reject,
          timer,
        })
        try {
          worker.postMessage({ id, command })
        } catch {
          dispose(new AdminError('crypto', 'crypto_unavailable'))
        }
      })
    },
    dispose,
  }
}

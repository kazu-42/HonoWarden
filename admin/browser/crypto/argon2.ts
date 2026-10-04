import { argon2id } from 'hash-wasm'
import { AdminError } from '../contracts'
import type { KdfSettings } from './kdf'

export async function deriveArgon2(
  password: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  settings: KdfSettings,
): Promise<Uint8Array<ArrayBuffer>> {
  const hashedSalt = new Uint8Array(await crypto.subtle.digest('SHA-256', salt))
  try {
    const result = await argon2id({
      password,
      salt: hashedSalt,
      iterations: settings.iterations,
      parallelism: settings.parallelism!,
      memorySize: settings.memory! * 1024,
      hashLength: 32,
      outputType: 'binary',
    })
    if (result.length !== 32) throw new Error()
    return new Uint8Array(result)
  } catch {
    throw new AdminError('crypto', 'argon2_unavailable')
  } finally {
    hashedSalt.fill(0)
  }
}

import { AdminError } from '../contracts'
import { concat, encodeBase64 } from './encoding'

export type KdfSettings = {
  type: 0 | 1
  iterations: number
  memory: number | null
  parallelism: number | null
}
export type PasswordMaterial = {
  masterKey: Uint8Array<ArrayBuffer>
  stretchedKey: Uint8Array<ArrayBuffer>
  authenticationHash: string
}
const encoder = new TextEncoder()

export function validateKdf(settings: KdfSettings): void {
  const inRange = (value: number | null, min: number, max: number) =>
    value !== null &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
  if (
    settings.type === 0 &&
    inRange(settings.iterations, 5000, 2_000_000) &&
    settings.memory === null &&
    settings.parallelism === null
  )
    return
  if (
    settings.type === 1 &&
    inRange(settings.iterations, 2, 10) &&
    inRange(settings.memory, 16, 1024) &&
    inRange(settings.parallelism, 1, 16)
  )
    return
  throw new AdminError('crypto', 'kdf_settings_invalid')
}

export async function derivePasswordMaterial(
  email: string,
  password: string,
  settings: KdfSettings,
): Promise<PasswordMaterial> {
  validateKdf(settings)
  const passwordBytes = encoder.encode(password)
  const salt = encoder.encode(email.trim().toLowerCase())
  let masterKey: Uint8Array<ArrayBuffer> | undefined
  try {
    if (settings.type === 0) {
      const imported = await crypto.subtle.importKey(
        'raw',
        passwordBytes,
        'PBKDF2',
        false,
        ['deriveBits'],
      )
      masterKey = new Uint8Array(
        await crypto.subtle.deriveBits(
          {
            name: 'PBKDF2',
            hash: 'SHA-256',
            salt,
            iterations: settings.iterations,
          },
          imported,
          256,
        ),
      )
    } else {
      const { deriveArgon2 } = await import('./argon2')
      masterKey = await deriveArgon2(passwordBytes, salt, settings)
    }
    const importedMaster = await crypto.subtle.importKey(
      'raw',
      masterKey,
      'PBKDF2',
      false,
      ['deriveBits'],
    )
    const hash = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: passwordBytes, iterations: 1 },
        importedMaster,
        256,
      ),
    )
    const hmac = await crypto.subtle.importKey(
      'raw',
      masterKey,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const enc = new Uint8Array(
      await crypto.subtle.sign(
        'HMAC',
        hmac,
        concat(encoder.encode('enc'), new Uint8Array([1])),
      ),
    )
    const mac = new Uint8Array(
      await crypto.subtle.sign(
        'HMAC',
        hmac,
        concat(encoder.encode('mac'), new Uint8Array([1])),
      ),
    )
    const authenticationHash = encodeBase64(hash)
    hash.fill(0)
    const stretchedKey = concat(enc, mac)
    enc.fill(0)
    mac.fill(0)
    return { masterKey, stretchedKey, authenticationHash }
  } catch (error) {
    masterKey?.fill(0)
    if (error instanceof AdminError) throw error
    throw new AdminError('crypto', 'kdf_unavailable')
  } finally {
    passwordBytes.fill(0)
    salt.fill(0)
  }
}

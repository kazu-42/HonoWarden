import { AdminError } from '../contracts'
import { bytes, concat, decodeBase64, encodeBase64 } from './encoding'

function fail(): never {
  throw new AdminError('crypto', 'encrypted_value_invalid')
}
function requireKey(key: Uint8Array) {
  if (key.length !== 64) fail()
}

export async function encryptType2(
  key: Uint8Array,
  plaintext: Uint8Array,
  iv = crypto.getRandomValues(new Uint8Array(16)),
): Promise<string> {
  requireKey(key)
  if (iv.length !== 16 || plaintext.length > 65_536) fail()
  const aes = await crypto.subtle.importKey(
    'raw',
    bytes(key.subarray(0, 32)),
    'AES-CBC',
    false,
    ['encrypt'],
  )
  const hmac = await crypto.subtle.importKey(
    'raw',
    bytes(key.subarray(32)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-CBC', iv: bytes(iv) },
      aes,
      bytes(plaintext),
    ),
  )
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', hmac, concat(iv, ciphertext)),
  )
  return `2.${encodeBase64(iv)}|${encodeBase64(ciphertext)}|${encodeBase64(mac)}`
}

export async function decryptType2(
  key: Uint8Array,
  encrypted: string,
): Promise<Uint8Array<ArrayBuffer>> {
  requireKey(key)
  if (!encrypted.startsWith('2.') || encrypted.length > 90_000) fail()
  const components = encrypted.slice(2).split('|')
  if (components.length !== 3) fail()
  try {
    const iv = decodeBase64(components[0]!, 16)
    const ciphertext = decodeBase64(components[1]!, 65_552)
    const mac = decodeBase64(components[2]!, 32)
    if (
      iv.length !== 16 ||
      mac.length !== 32 ||
      !ciphertext.length ||
      ciphertext.length % 16
    )
      fail()
    const hmac = await crypto.subtle.importKey(
      'raw',
      bytes(key.subarray(32)),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    if (
      !(await crypto.subtle.verify('HMAC', hmac, mac, concat(iv, ciphertext)))
    )
      fail()
    const aes = await crypto.subtle.importKey(
      'raw',
      bytes(key.subarray(0, 32)),
      'AES-CBC',
      false,
      ['decrypt'],
    )
    return new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, aes, ciphertext),
    )
  } catch {
    fail()
  }
}

export async function wrapRsa(
  publicKey: string,
  key: Uint8Array,
  type: 3 | 4 = 3,
): Promise<string> {
  requireKey(key)
  try {
    const imported = await crypto.subtle.importKey(
      'spki',
      decodeBase64(publicKey, 4096),
      { name: 'RSA-OAEP', hash: type === 3 ? 'SHA-256' : 'SHA-1' },
      false,
      ['encrypt'],
    )
    const algorithm = imported.algorithm as {
      name: string
      modulusLength: number
    }
    if (algorithm.modulusLength !== 2048) fail()
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, imported, bytes(key)),
    )
    return `${type}.${encodeBase64(encrypted)}`
  } catch {
    fail()
  }
}

export async function unwrapRsa(
  privateKey: Uint8Array,
  encrypted: string,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!/^[34]\./.test(encrypted)) fail()
  try {
    const ciphertext = decodeBase64(encrypted.slice(2), 256)
    if (ciphertext.length !== 256) fail()
    const imported = await crypto.subtle.importKey(
      'pkcs8',
      bytes(privateKey),
      { name: 'RSA-OAEP', hash: encrypted[0] === '3' ? 'SHA-256' : 'SHA-1' },
      false,
      ['decrypt'],
    )
    if (
      (imported.algorithm as { name: string; modulusLength: number })
        .modulusLength !== 2048
    )
      fail()
    const key = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, imported, ciphertext),
    )
    if (key.length !== 64) {
      key.fill(0)
      fail()
    }
    return key
  } catch {
    fail()
  }
}

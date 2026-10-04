import { AdminError } from '../contracts'

export function encodeBase64(bytes: Uint8Array): string {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value)
}

export function decodeBase64(
  value: string,
  maxBytes = 65_536,
): Uint8Array<ArrayBuffer> {
  if (
    value.length > Math.ceil(maxBytes / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    throw new AdminError('crypto', 'encrypted_value_invalid')
  }
  try {
    const binary = atob(value)
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    )
    if (bytes.length > maxBytes || encodeBase64(bytes) !== value)
      throw new Error()
    return bytes
  } catch {
    throw new AdminError('crypto', 'encrypted_value_invalid')
  }
}

export function bytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value)
}

export function concat(...values: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(
    values.reduce((size, value) => size + value.length, 0),
  )
  let offset = 0
  for (const value of values) {
    result.set(value, offset)
    offset += value.length
  }
  return result
}

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let i = 0; i < left.length; i++) difference |= left[i]! ^ right[i]!
  return difference === 0
}

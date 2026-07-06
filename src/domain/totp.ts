const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export const totpPolicy = {
  digits: 6,
  periodSeconds: 30,
  secretBytes: 20,
  verificationWindow: 1,
} as const

export type TotpVerificationResult =
  | {
      ok: true
      timeStep: number
    }
  | {
      ok: false
      code: 'invalid' | 'replayed'
    }

export function generateTotpSecret(): string {
  const bytes = new Uint8Array(totpPolicy.secretBytes)
  crypto.getRandomValues(bytes)

  return base32EncodeBytes(bytes)
}

export function base32EncodeBytes(bytes: Uint8Array): string {
  let output = ''
  let buffer = 0
  let bitsLeft = 0

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bitsLeft += 8

    while (bitsLeft >= 5) {
      output += base32Alphabet[(buffer >>> (bitsLeft - 5)) & 31]
      bitsLeft -= 5
    }
  }

  if (bitsLeft > 0) {
    output += base32Alphabet[(buffer << (5 - bitsLeft)) & 31]
  }

  return output
}

export async function hotp(
  secretBase32: string,
  counter: number,
  digits = totpPolicy.digits,
): Promise<string> {
  const secret = base32DecodeToBytes(secretBase32)
  if (!secret || !Number.isSafeInteger(counter) || counter < 0) {
    return ''
  }

  const counterBytes = counterToBytes(counter)
  const signature = await hmacSha1(secret, counterBytes)
  const offset = byteAt(signature, signature.length - 1) & 0x0f
  const binary =
    ((byteAt(signature, offset) & 0x7f) << 24) |
    ((byteAt(signature, offset + 1) & 0xff) << 16) |
    ((byteAt(signature, offset + 2) & 0xff) << 8) |
    (byteAt(signature, offset + 3) & 0xff)
  const otp = binary % 10 ** digits

  return String(otp).padStart(digits, '0')
}

export async function verifyTotpCode(input: {
  secretBase32: string
  code: string
  nowUnixSeconds: number
  lastAcceptedStep?: number | null
  periodSeconds?: number
  window?: number
}): Promise<TotpVerificationResult> {
  const code = input.code.trim()
  if (!/^\d{6}$/.test(code)) {
    return {
      ok: false,
      code: 'invalid',
    }
  }

  const periodSeconds = input.periodSeconds ?? totpPolicy.periodSeconds
  const window = input.window ?? totpPolicy.verificationWindow
  const currentStep = Math.floor(input.nowUnixSeconds / periodSeconds)
  const firstStep = Math.max(0, currentStep - window)
  const lastStep = currentStep + window

  for (let step = firstStep; step <= lastStep; step += 1) {
    const expected = await hotp(input.secretBase32, step)
    if (!constantTimeEqual(expected, code)) {
      continue
    }

    if (
      input.lastAcceptedStep !== null &&
      input.lastAcceptedStep !== undefined &&
      step <= input.lastAcceptedStep
    ) {
      return {
        ok: false,
        code: 'replayed',
      }
    }

    return {
      ok: true,
      timeStep: step,
    }
  }

  return {
    ok: false,
    code: 'invalid',
  }
}

function base32DecodeToBytes(value: string): Uint8Array | null {
  const normalized = value.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase()
  if (!normalized || /[^A-Z2-7]/.test(normalized)) {
    return null
  }

  const bytes: number[] = []
  let buffer = 0
  let bitsLeft = 0

  for (const char of normalized) {
    const value = base32Alphabet.indexOf(char)
    if (value < 0) {
      return null
    }

    buffer = (buffer << 5) | value
    bitsLeft += 5

    if (bitsLeft >= 8) {
      bytes.push((buffer >>> (bitsLeft - 8)) & 0xff)
      bitsLeft -= 8
    }
  }

  return new Uint8Array(bytes)
}

function counterToBytes(counter: number): Uint8Array {
  const bytes = new Uint8Array(8)
  const view = new DataView(bytes.buffer)
  const high = Math.floor(counter / 0x100000000)
  const low = counter >>> 0

  view.setUint32(0, high)
  view.setUint32(4, low)

  return bytes
}

function byteAt(bytes: Uint8Array, index: number): number {
  return bytes[index] ?? 0
}

async function hmacSha1(
  keyBytes: Uint8Array,
  value: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    {
      name: 'HMAC',
      hash: 'SHA-1',
    },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, value)

  return new Uint8Array(signature)
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false
  }

  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }

  return difference === 0
}

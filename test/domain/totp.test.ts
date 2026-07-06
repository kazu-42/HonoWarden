import { describe, expect, it } from 'vitest'

import {
  base32EncodeBytes,
  generateTotpSecret,
  hotp,
  verifyTotpCode,
} from '../../src/domain/totp'

const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('totp domain', () => {
  it('generates base32 secrets without padding', () => {
    expect(
      base32EncodeBytes(
        new Uint8Array([
          0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0x10, 0x32,
        ]),
      ),
    ).toBe('AERUKZ4JVPG66EBS')

    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/)
  })

  it('calculates HOTP codes from the standard test vector', async () => {
    await expect(hotp(rfcSecret, 0)).resolves.toBe('755224')
    await expect(hotp(rfcSecret, 1)).resolves.toBe('287082')
  })

  it('verifies TOTP codes for the current time step', async () => {
    const code = await hotp(rfcSecret, 1)

    await expect(
      verifyTotpCode({
        secretBase32: rfcSecret,
        code,
        nowUnixSeconds: 59,
      }),
    ).resolves.toEqual({
      ok: true,
      timeStep: 1,
    })
  })

  it('rejects malformed or stale TOTP codes', async () => {
    await expect(
      verifyTotpCode({
        secretBase32: rfcSecret,
        code: 'abc123',
        nowUnixSeconds: 59,
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'invalid',
    })

    await expect(
      verifyTotpCode({
        secretBase32: rfcSecret,
        code: await hotp(rfcSecret, 9),
        nowUnixSeconds: 59,
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'invalid',
    })
  })

  it('rejects replayed TOTP time steps', async () => {
    await expect(
      verifyTotpCode({
        secretBase32: rfcSecret,
        code: await hotp(rfcSecret, 1),
        nowUnixSeconds: 59,
        lastAcceptedStep: 1,
      }),
    ).resolves.toEqual({
      ok: false,
      code: 'replayed',
    })
  })
})

import { describe, expect, it } from 'vitest'

import { parseOrganizationCipherTransitionRequestBody } from '../src/app'
import { desktopOrganizationCipherRequest } from './support/desktop-organization-cipher-fixture'

const request = () =>
  desktopOrganizationCipherRequest(
    'synthetic-org',
    'synthetic-collection',
    'synthetic-user',
  )

describe('Desktop organization cipher transition parser', () => {
  it.each(['absent', 'null'] as const)('accepts a %s cipher key', (form) => {
    const body = request()
    const cipher = form === 'null' ? { ...body.cipher, key: null } : body.cipher
    const parsed = parseOrganizationCipherTransitionRequestBody(
      { ...body, cipher },
      false,
    )
    expect(parsed).toMatchObject({
      ok: true,
      cipherKey: null,
      encryptedFor: 'synthetic-user',
    })
    if (!parsed.ok) return
    const stored = JSON.parse(parsed.cipher.encryptedJson) as Record<
      string,
      unknown
    >
    expect(stored).not.toHaveProperty('encryptedByKeyId')
    expect(stored).not.toHaveProperty('encryptedFor')
    expect(stored).toHaveProperty('name', '2.synthetic-name')
  })

  it('retains an optional opaque key and requires a revision for share', () => {
    const body = request()
    const cipher = { ...body.cipher, key: '2.synthetic-wrapped-key' }
    expect(
      parseOrganizationCipherTransitionRequestBody({ ...body, cipher }, true),
    ).toMatchObject({
      ok: true,
      cipherKey: '2.synthetic-wrapped-key',
      expectedRevisionDate: body.cipher.lastKnownRevisionDate,
    })
    expect(
      parseOrganizationCipherTransitionRequestBody(
        { ...body, cipher: { ...cipher, lastKnownRevisionDate: null } },
        true,
      ),
    ).toEqual({ ok: false })
  })

  it.each([{}, '', 'é'.repeat(32769)])(
    'rejects malformed present key %#',
    (key) => {
      const body = request()
      expect(
        parseOrganizationCipherTransitionRequestBody(
          { ...body, cipher: { ...body.cipher, key } },
          false,
        ),
      ).toEqual({ ok: false })
    },
  )
})

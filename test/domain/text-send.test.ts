import { describe, expect, it } from 'vitest'

import {
  createTextSendCapability,
  createTextSendCapabilityVerifier,
  createTextSendPasswordVerifier,
  decryptTextSendCapability,
  parseTextSendOwnerRequest,
  resolveTextSendEnvelopeSecret,
  verifyTextSendPassword,
} from '../../src/domain/text-send'

const now = '2026-08-08T00:00:00.000Z'

function validRequest(): Record<string, unknown> {
  return {
    Type: 0,
    Name: 'opaque-name',
    Notes: 'opaque-notes',
    Key: 'opaque-owner-key',
    MaxAccessCount: 5,
    ExpirationDate: '2026-08-10T00:00:00.000Z',
    DeletionDate: '2026-08-20T00:00:00.000Z',
    Text: { Text: 'opaque-text', Hidden: false },
    Password: 'client-derived-hash',
    Emails: null,
    Disabled: false,
    HideEmail: true,
    AuthType: 1,
  }
}

describe('text Send domain', () => {
  it('parses the pinned password-auth text request without inspecting ciphertext', () => {
    expect(
      parseTextSendOwnerRequest(validRequest(), { now, accessCount: 0 }),
    ).toEqual({
      ok: true,
      value: {
        type: 0,
        encryptedName: 'opaque-name',
        encryptedNotes: 'opaque-notes',
        encryptedKey: 'opaque-owner-key',
        encryptedText: 'opaque-text',
        textHidden: false,
        authType: 1,
        clientPasswordHash: 'client-derived-hash',
        maxAccessCount: 5,
        expirationDate: '2026-08-10T00:00:00.000Z',
        deletionDate: '2026-08-20T00:00:00.000Z',
        disabled: false,
        hideEmail: true,
      },
    })
  })

  it('accepts case-insensitive protocol fields but rejects ambiguous duplicates', () => {
    const lower = Object.fromEntries(
      Object.entries(validRequest()).map(([key, value]) => [
        key.charAt(0).toLowerCase() + key.slice(1),
        value,
      ]),
    )
    expect(parseTextSendOwnerRequest(lower, { now, accessCount: 0 }).ok).toBe(
      true,
    )
    expect(
      parseTextSendOwnerRequest(
        { ...validRequest(), type: 0 },
        { now, accessCount: 0 },
      ),
    ).toEqual({ ok: false, code: 'invalid_request' })
  })

  it('normalizes omitted optional fields for none-auth text requests', () => {
    const request = validRequest()
    request.AuthType = 2
    for (const field of [
      'Notes',
      'MaxAccessCount',
      'ExpirationDate',
      'Password',
      'Emails',
    ]) {
      delete request[field]
    }

    expect(
      parseTextSendOwnerRequest(request, { now, accessCount: 0 }),
    ).toMatchObject({
      ok: true,
      value: {
        encryptedNotes: null,
        maxAccessCount: null,
        expirationDate: null,
        clientPasswordHash: null,
        authType: 2,
      },
    })
  })

  it('accepts nested case-insensitive text fields and rejects structural ambiguity or file payloads', () => {
    expect(
      parseTextSendOwnerRequest(
        {
          ...validRequest(),
          Text: { tExT: 'opaque-text', hIdDeN: false },
          File: null,
          FileLength: null,
        },
        { now, accessCount: 0 },
      ).ok,
    ).toBe(true)

    for (const request of [
      {
        ...validRequest(),
        Text: { Text: 'opaque-text', text: 'ambiguous', Hidden: false },
      },
      { ...validRequest(), File: { FileName: 'opaque-file' } },
      { ...validRequest(), FileLength: 1 },
    ]) {
      expect(
        parseTextSendOwnerRequest(request, { now, accessCount: 0 }),
      ).toEqual({ ok: false, code: 'invalid_request' })
    }
  })

  it('rejects email auth, mismatched password state, stale dates, and a reduced maximum', () => {
    for (const request of [
      { ...validRequest(), AuthType: 0, Emails: ['recipient@example.test'] },
      { ...validRequest(), AuthType: 2, Password: 'unexpected' },
      { ...validRequest(), AuthType: 1, Password: null },
      { ...validRequest(), DeletionDate: now },
      {
        ...validRequest(),
        ExpirationDate: '2026-08-21T00:00:00.000Z',
      },
      { ...validRequest(), MaxAccessCount: 2 },
    ]) {
      expect(
        parseTextSendOwnerRequest(request, { now, accessCount: 3 }),
      ).toMatchObject({ ok: false })
    }
  })

  it('encrypts the owner capability and stores only a purpose-separated lookup verifier', async () => {
    const entropy = new Uint8Array(28).fill(7)
    const capability = await createTextSendCapability({
      sendId: 'send-1',
      ownerUserId: 'user-1',
      envelopeKeyId: 'envelope-v1',
      envelopeSecret: 'e'.repeat(32),
      lookupKeyId: 'lookup-v1',
      lookupSecret: 'l'.repeat(32),
      randomBytes: (bytes) => {
        bytes.set(entropy)
        return bytes
      },
    })

    expect(capability.accessId).toMatch(/^[A-Za-z0-9_-]{22}$/u)
    expect(capability.capabilityEnvelope).not.toContain(capability.accessId)
    expect(capability.capabilityVerifier).toMatch(/^[a-f0-9]{64}$/u)
    await expect(
      createTextSendCapabilityVerifier({
        keyId: 'lookup-v1',
        lookupSecret: 'l'.repeat(32),
        accessId: capability.accessId,
      }),
    ).resolves.toBe(capability.capabilityVerifier)
    expect(JSON.stringify(capability.stored)).not.toContain(capability.accessId)
    await expect(
      decryptTextSendCapability({
        sendId: 'send-1',
        ownerUserId: 'user-1',
        envelopeKeyId: 'envelope-v1',
        envelopeSecret: 'e'.repeat(32),
        capabilityEnvelope: capability.capabilityEnvelope,
      }),
    ).resolves.toBe(capability.accessId)
    await expect(
      decryptTextSendCapability({
        sendId: 'send-1',
        ownerUserId: 'user-1',
        envelopeKeyId: 'envelope-v1',
        envelopeSecret: 'x'.repeat(32),
        capabilityEnvelope: capability.capabilityEnvelope,
      }),
    ).rejects.toThrow()
  })

  it('rejects non-canonical envelopes, ciphertext tampering, and AAD substitution', async () => {
    const capability = await createTextSendCapability({
      sendId: 'send-1',
      ownerUserId: 'user-1',
      envelopeKeyId: 'envelope-v1',
      envelopeSecret: 'e'.repeat(32),
      lookupKeyId: 'lookup-v1',
      lookupSecret: 'l'.repeat(32),
      randomBytes: (bytes) => bytes.fill(7),
    })
    const [version, nonce, ciphertext] =
      capability.capabilityEnvelope.split('.')
    if (!version || !nonce || !ciphertext) throw new Error('expected envelope')
    const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    const lastIndex = alphabet.indexOf(ciphertext.at(-1) ?? '')
    if (lastIndex < 0) throw new Error('expected base64url ciphertext')
    const alternateLast =
      alphabet[(lastIndex & 0b111100) | ((lastIndex + 1) & 0b11)]
    const nonCanonicalCiphertext = `${ciphertext.slice(0, -1)}${alternateLast}`

    for (const mutation of [
      {
        sendId: 'send-2',
        ownerUserId: 'user-1',
        envelopeKeyId: 'envelope-v1',
        capabilityEnvelope: capability.capabilityEnvelope,
      },
      {
        sendId: 'send-1',
        ownerUserId: 'user-2',
        envelopeKeyId: 'envelope-v1',
        capabilityEnvelope: capability.capabilityEnvelope,
      },
      {
        sendId: 'send-1',
        ownerUserId: 'user-1',
        envelopeKeyId: 'envelope-v2',
        capabilityEnvelope: capability.capabilityEnvelope,
      },
      {
        sendId: 'send-1',
        ownerUserId: 'user-1',
        envelopeKeyId: 'envelope-v1',
        capabilityEnvelope: `${version}.${nonce}.${ciphertext.slice(0, -1)}A`,
      },
      {
        sendId: 'send-1',
        ownerUserId: 'user-1',
        envelopeKeyId: 'envelope-v1',
        capabilityEnvelope: `${version}.${nonce}.${nonCanonicalCiphertext}`,
      },
      {
        sendId: 'send-1',
        ownerUserId: 'user-1',
        envelopeKeyId: 'envelope-v1',
        capabilityEnvelope: `${version}.${nonce}.${ciphertext}A`,
      },
    ]) {
      await expect(
        decryptTextSendCapability({
          ...mutation,
          envelopeSecret: 'e'.repeat(32),
        }),
      ).rejects.toThrow()
    }
  })

  it('requires independent envelope and lookup roots', async () => {
    await expect(
      createTextSendCapability({
        sendId: 'send-1',
        ownerUserId: 'user-1',
        envelopeKeyId: 'envelope-v1',
        envelopeSecret: 's'.repeat(32),
        lookupKeyId: 'lookup-v1',
        lookupSecret: 's'.repeat(32),
      }),
    ).rejects.toThrow(/independent/u)
  })

  it('resolves the exact active envelope entry and validates every previous key identifier', () => {
    const activeSecret = 'e'.repeat(32)
    expect(
      resolveTextSendEnvelopeSecret('envelope-v2', {
        'envelope-v1': 'o'.repeat(32),
        'envelope-v2': activeSecret,
      }),
    ).toBe(activeSecret)

    for (const previousKeyId of ['', 'previous\0ambiguous', 'あ'.repeat(43)]) {
      expect(() =>
        resolveTextSendEnvelopeSecret('envelope-v2', {
          'envelope-v2': activeSecret,
          [previousKeyId]: 'o'.repeat(32),
        }),
      ).toThrow(/key identifier is invalid/u)
    }
    expect(() =>
      resolveTextSendEnvelopeSecret('Envelope-v2', {
        'envelope-v2': activeSecret,
      }),
    ).toThrow(/key is unavailable/u)
  })

  it('compares encoded root bytes and rejects delimiter-bearing identifiers', async () => {
    await expect(
      createTextSendCapability({
        sendId: 'send-1',
        ownerUserId: 'user-1',
        envelopeKeyId: 'envelope-v1',
        envelopeSecret: '\ud800'.repeat(32),
        lookupKeyId: 'lookup-v1',
        lookupSecret: '\ud801'.repeat(32),
      }),
    ).rejects.toThrow(/independent/u)

    await expect(
      createTextSendCapability({
        sendId: 'send\0ambiguous',
        ownerUserId: 'user-1',
        envelopeKeyId: 'envelope-v1',
        envelopeSecret: 'e'.repeat(32),
        lookupKeyId: 'lookup-v1',
        lookupSecret: 'l'.repeat(32),
      }),
    ).rejects.toThrow(/identifier/u)
  })

  it('normalizes accepted dates to sortable UTC timestamps', () => {
    const request = validRequest()
    request.ExpirationDate = '2026-08-10T09:00:00+09:00'
    request.DeletionDate = '2026-08-20T09:00:00+09:00'

    expect(
      parseTextSendOwnerRequest(request, { now, accessCount: 0 }),
    ).toMatchObject({
      ok: true,
      value: {
        expirationDate: '2026-08-10T00:00:00.000Z',
        deletionDate: '2026-08-20T00:00:00.000Z',
      },
    })
  })

  it.each([
    [
      'non-leap February 29 deletion',
      '2026-02-01T00:00:00.000Z',
      null,
      '2026-02-29T00:00:00.000Z',
    ],
    [
      'April 31 deletion',
      '2026-04-01T00:00:00.000Z',
      null,
      '2026-04-31T00:00:00.000Z',
    ],
    [
      '24 hour deletion',
      '2026-08-01T00:00:00.000Z',
      null,
      '2026-08-20T24:00:00.000Z',
    ],
    [
      'non-leap February 29 expiration',
      '2026-02-01T00:00:00.000Z',
      '2026-02-29T00:00:00.000Z',
      '2026-03-10T00:00:00.000Z',
    ],
    [
      'April 31 expiration',
      '2026-04-01T00:00:00.000Z',
      '2026-04-31T00:00:00.000Z',
      '2026-05-10T00:00:00.000Z',
    ],
    [
      '24 hour expiration',
      '2026-08-01T00:00:00.000Z',
      '2026-08-10T24:00:00.000Z',
      '2026-08-20T00:00:00.000Z',
    ],
  ])(
    'rejects an impossible owner lifecycle instant: %s',
    (_name, current, expiration, deletion) => {
      const request = {
        ...validRequest(),
        ExpirationDate: expiration,
        DeletionDate: deletion,
      }

      expect(
        parseTextSendOwnerRequest(request, {
          now: current,
          accessCount: 0,
        }),
      ).toEqual({ ok: false, code: 'invalid_request' })
    },
  )

  it('rejects an impossible trusted now and accepts a real leap day', () => {
    expect(
      parseTextSendOwnerRequest(validRequest(), {
        now: '2026-02-29T00:00:00.000Z',
        accessCount: 0,
      }),
    ).toEqual({ ok: false, code: 'invalid_request' })

    expect(
      parseTextSendOwnerRequest(
        {
          ...validRequest(),
          ExpirationDate: '2028-02-29T09:00:00+09:00',
          DeletionDate: '2028-03-10T09:00:00+09:00',
        },
        { now: '2028-02-20T00:00:00.000Z', accessCount: 0 },
      ),
    ).toMatchObject({
      ok: true,
      value: {
        expirationDate: '2028-02-29T00:00:00.000Z',
        deletionDate: '2028-03-10T00:00:00.000Z',
      },
    })
  })

  it('uses a keyed Send-scoped verifier and constant-time verification result', async () => {
    const input = {
      sendId: 'send-1',
      keyId: 'lookup-v1',
      lookupSecret: 'l'.repeat(32),
      clientPasswordHash: 'client-derived-hash',
    }
    const verifier = await createTextSendPasswordVerifier(input)

    expect(verifier).toMatch(/^[a-f0-9]{64}$/u)
    expect(verifier).not.toContain(input.clientPasswordHash)
    await expect(
      verifyTextSendPassword({ ...input, expectedVerifier: verifier }),
    ).resolves.toBe(true)
    await expect(
      verifyTextSendPassword({
        ...input,
        clientPasswordHash: 'different-client-hash',
        expectedVerifier: verifier,
      }),
    ).resolves.toBe(false)
  })
})

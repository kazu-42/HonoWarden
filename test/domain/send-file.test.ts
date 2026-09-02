import { describe, expect, it } from 'vitest'

import {
  allocateSendFileObject,
  createSendDownloadTicketMaterial,
  parseFileSendOwnerRequest,
} from '../../src/domain/send-file'

const now = '2026-09-02T06:40:00.000Z'

function validFileRequest(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: 1,
    name: 'opaque-name',
    notes: null,
    key: 'opaque-key',
    file: { fileName: 'opaque-file-name' },
    fileLength: 4096,
    authtype: 2,
    password: null,
    emails: null,
    disabled: false,
    hideemail: true,
    maxaccesscount: 3,
    expirationdate: '2026-09-03T00:00:00.000Z',
    deletiondate: '2026-09-10T00:00:00.000Z',
    ...overrides,
  }
}

describe('file Send domain', () => {
  it('accepts an encrypted file create request without a client object key', () => {
    const parsed = parseFileSendOwnerRequest(validFileRequest(), {
      now,
      accessCount: 0,
    })

    expect(parsed).toEqual({
      ok: true,
      value: {
        type: 1,
        encryptedName: 'opaque-name',
        encryptedNotes: null,
        encryptedKey: 'opaque-key',
        encryptedFileName: 'opaque-file-name',
        expectedSize: 4096,
        authType: 2,
        clientPasswordHash: null,
        maxAccessCount: 3,
        expirationDate: '2026-09-03T00:00:00.000Z',
        deletionDate: '2026-09-10T00:00:00.000Z',
        disabled: false,
        hideEmail: true,
      },
    })
  })

  it('rejects a client-supplied object key or text payload on file create', () => {
    expect(
      parseFileSendOwnerRequest(
        validFileRequest({
          file: { fileName: 'opaque-file-name', objectKey: 'client-key' },
        }),
        { now, accessCount: 0 },
      ),
    ).toEqual({ ok: false, code: 'invalid_request' })
    expect(
      parseFileSendOwnerRequest(
        validFileRequest({ text: { text: 'opaque-text', hidden: false } }),
        { now, accessCount: 0 },
      ),
    ).toEqual({ ok: false, code: 'invalid_request' })
  })

  it('allocates a generation-specific private object key the client cannot choose', () => {
    const first = allocateSendFileObject({
      sendId: 'send-1',
      fileId: 'file-1',
      objectGeneration: 1,
      randomBytes: (bytes) => {
        bytes.fill(7)
        return bytes
      },
    })
    const replacement = allocateSendFileObject({
      sendId: 'send-1',
      fileId: 'file-1',
      objectGeneration: 2,
      randomBytes: (bytes) => {
        bytes.fill(7)
        return bytes
      },
    })

    expect(first.objectKey).not.toBe('client-key')
    expect(first.objectKey).toContain('send-1')
    expect(first.objectKey).toContain('file-1')
    expect(first.objectKey).toContain('g1')
    expect(replacement.objectKey).not.toBe(first.objectKey)
    expect(replacement.objectKey).toContain('g2')
  })

  it('derives a keyed download-ticket verifier without embedding Send or object identifiers', async () => {
    const first = await createSendDownloadTicketMaterial({
      keyId: 'ticket-key-1',
      lookupSecret: 'lookup-secret-1'.padEnd(32, 'x'),
      randomBytes: (bytes) => {
        bytes.fill(9)
        return bytes
      },
    })
    const second = await createSendDownloadTicketMaterial({
      keyId: 'ticket-key-1',
      lookupSecret: 'lookup-secret-2'.padEnd(32, 'x'),
      randomBytes: (bytes) => {
        bytes.fill(9)
        return bytes
      },
    })

    expect(first.ticketId).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(first.ticketVerifier).toMatch(/^[0-9a-f]{64}$/u)
    expect(first.ticketId).not.toContain('send-1')
    expect(first.ticketVerifier).not.toContain('send-1')
    expect(first.ticketVerifier).not.toBe(first.ticketId)
    expect(second.ticketId).toBe(first.ticketId)
    expect(second.ticketVerifier).not.toBe(first.ticketVerifier)
  })
})

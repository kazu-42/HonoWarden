import { describe, expect, it } from 'vitest'

import {
  createOwnerTextSend,
  deleteOwnerTextSend,
  projectTextSendOwnerResponse,
  recoverTextSendOwnerResponse,
  removeOwnerTextSendAuth,
  updateOwnerTextSend,
} from '../src/text-send-owner'
import { createTextSendCapability } from '../src/domain/text-send'
import type { TextSendRow } from '../src/repositories/text-send-repository'

type RecordedStatement = { query: string; bindings: unknown[] }

const fakeMeta = {
  duration: 0,
  size_after: 0,
  rows_read: 0,
  rows_written: 1,
  last_row_id: 1,
  changed_db: true,
  changes: 1,
} satisfies D1Meta & Record<string, unknown>

class OwnerServiceDatabase {
  readonly batchCalls: RecordedStatement[][] = []
  private readonly records = new WeakMap<object, RecordedStatement>()

  constructor(private readonly row: TextSendRow) {}

  prepare(query: string): D1PreparedStatement {
    const record = { query, bindings: [] as unknown[] }
    const statement = {
      bind: (...bindings: unknown[]) => {
        record.bindings = bindings
        return statement as unknown as D1PreparedStatement
      },
    }
    this.records.set(statement, record)
    return statement as unknown as D1PreparedStatement
  }

  async batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    const records = statements.map((statement) => {
      const record = this.records.get(statement as object)
      if (!record) throw new Error('unrecorded statement')
      return record
    })
    this.batchCalls.push(records)
    return [
      { success: true, results: [this.row] as T[], meta: fakeMeta },
      { success: true, results: [], meta: fakeMeta },
    ]
  }
}

class OwnerMutationDatabase {
  readonly calls: RecordedStatement[] = []

  constructor(private readonly selectedRow: TextSendRow) {}

  prepare(query: string): D1PreparedStatement {
    const record = { query, bindings: [] as unknown[] }
    const statement = {
      bind: (...bindings: unknown[]) => {
        record.bindings = bindings
        return statement
      },
      first: async () => {
        this.calls.push(record)
        return /\bSELECT\b/u.test(query) ? this.selectedRow : null
      },
    }
    return statement as unknown as D1PreparedStatement
  }
}

class NoD1Database {
  prepare(): D1PreparedStatement {
    throw new Error('D1 must not be reached')
  }

  batch(): Promise<D1Result[]> {
    throw new Error('D1 must not be reached')
  }
}

const now = '2026-08-08T00:00:00.000Z'
const row: TextSendRow = {
  id: 'send-1',
  ownerUserId: 'user-1',
  type: 0,
  authType: 1,
  lifecycleState: 'active',
  capabilityEnvelope: 'envelope',
  capabilityEnvelopeKeyId: 'envelope-v1',
  capabilityVerifier: 'a'.repeat(64),
  capabilityVerifierKeyId: 'lookup-v1',
  accessGeneration: 1,
  encryptedName: 'opaque-name',
  encryptedNotes: 'opaque-notes',
  encryptedKey: 'opaque-owner-key',
  encryptedText: 'opaque-text',
  textHidden: 0,
  passwordVerifier: 'b'.repeat(64),
  passwordKeyId: 'lookup-v1',
  maxAccessCount: 5,
  accessCount: 0,
  disabled: 0,
  hideEmail: 1,
  expirationAt: '2026-08-10T00:00:00.000Z',
  deletionAt: '2026-08-20T00:00:00.000Z',
  revisionDate: now,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  quarantinedAt: null,
  lastAccessedAt: null,
}

const validBody = {
  Type: 0,
  Name: row.encryptedName,
  Notes: row.encryptedNotes,
  Key: row.encryptedKey,
  MaxAccessCount: row.maxAccessCount,
  ExpirationDate: row.expirationAt,
  DeletionDate: row.deletionAt,
  Text: { Text: row.encryptedText, Hidden: false },
  Password: 'client-derived-hash',
  Emails: null,
  Disabled: false,
  HideEmail: true,
  AuthType: 1,
}

describe('text Send owner application service', () => {
  it('projects the compatibility response without storage verifiers', () => {
    const response = projectTextSendOwnerResponse(row, 'raw-access-id')

    expect(response).toEqual({
      Id: 'send-1',
      AccessId: 'raw-access-id',
      Type: 0,
      AuthType: 1,
      Name: 'opaque-name',
      Notes: 'opaque-notes',
      Text: { Text: 'opaque-text', Hidden: false },
      File: null,
      Key: 'opaque-owner-key',
      MaxAccessCount: 5,
      AccessCount: 0,
      RevisionDate: now,
      ExpirationDate: '2026-08-10T00:00:00.000Z',
      DeletionDate: '2026-08-20T00:00:00.000Z',
      Password: 'configured',
      Emails: null,
      Disabled: false,
      HideEmail: true,
      Object: 'send',
    })
    expect(JSON.stringify(response)).not.toContain(row.capabilityVerifier)
    expect(JSON.stringify(response)).not.toContain(row.passwordVerifier)
  })

  it('creates the row and returns the raw capability without persisting secret inputs', async () => {
    const database = new OwnerServiceDatabase(row)

    const result = await createOwnerTextSend(
      database as unknown as D1Database,
      {
        ownerUserId: 'user-1',
        body: validBody,
        now,
        sendId: 'send-1',
        auditEventId: 'audit-1',
        requestId: 'request-1',
        envelopeKeyId: 'envelope-v1',
        envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
        lookupKeyId: 'lookup-v1',
        lookupSecret: 'l'.repeat(32),
        randomBytes: (bytes) => {
          bytes.fill(7)
          return bytes
        },
      },
    )

    expect(result.status).toBe('created')
    if (result.status !== 'created') throw new Error('expected create')
    expect(result.send.AccessId).toMatch(/^[A-Za-z0-9_-]{22}$/u)
    const writes = JSON.stringify(database.batchCalls)
    expect(writes).not.toContain(result.send.AccessId)
    expect(writes).not.toContain('client-derived-hash')
  })

  it('canonicalizes a valid offset now before every owner write path', async () => {
    const offsetNow = '2026-08-08T09:00:00+09:00'
    const canonicalNow = '2026-08-08T00:00:00.000Z'
    const nextCanonicalRevision = '2026-08-08T00:00:00.001Z'
    const recoverableRow = await createRecoverableRow()
    const createDatabase = new OwnerServiceDatabase(row)
    await createOwnerTextSend(createDatabase as unknown as D1Database, {
      ownerUserId: 'user-1',
      body: validBody,
      now: offsetNow,
      sendId: 'send-1',
      auditEventId: 'audit-1',
      requestId: 'request-1',
      envelopeKeyId: 'envelope-v1',
      envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
      lookupKeyId: 'lookup-v1',
      lookupSecret: 'l'.repeat(32),
      randomBytes: (bytes) => {
        bytes.fill(7)
        return bytes
      },
    })

    const updateDatabase = new OwnerMutationDatabase(recoverableRow)
    await updateOwnerTextSend(updateDatabase as unknown as D1Database, {
      ownerUserId: 'user-1',
      id: 'send-1',
      body: { ...validBody, Password: 'configured' },
      expectedRevisionDate: now,
      now: offsetNow,
      envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
      lookupKeyId: 'lookup-v1',
      lookupSecret: 'l'.repeat(32),
    })
    const removeDatabase = new OwnerMutationDatabase(recoverableRow)
    await removeOwnerTextSendAuth(removeDatabase as unknown as D1Database, {
      ownerUserId: 'user-1',
      id: 'send-1',
      now: offsetNow,
      envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
    })
    const deleteDatabase = new OwnerMutationDatabase(recoverableRow)
    await deleteOwnerTextSend(deleteDatabase as unknown as D1Database, {
      ownerUserId: 'user-1',
      id: 'send-1',
      now: offsetNow,
    })

    expect(JSON.stringify(createDatabase.batchCalls)).toContain(canonicalNow)
    for (const writes of [
      updateDatabase.calls,
      removeDatabase.calls,
      deleteDatabase.calls,
    ]) {
      const serialized = JSON.stringify(writes)
      expect(serialized).toContain(nextCanonicalRevision)
      expect(serialized).not.toContain(offsetNow)
    }
  })

  async function createRecoverableRow(): Promise<TextSendRow> {
    const capability = await createTextSendCapability({
      sendId: row.id,
      ownerUserId: row.ownerUserId,
      envelopeKeyId: row.capabilityEnvelopeKeyId,
      envelopeSecret: 'e'.repeat(32),
      lookupKeyId: row.capabilityVerifierKeyId,
      lookupSecret: 'l'.repeat(32),
      randomBytes: (bytes) => {
        bytes.fill(7)
        return bytes
      },
    })
    return { ...row, capabilityEnvelope: capability.capabilityEnvelope }
  }

  it('reports a post-read remove-auth compare-and-set miss as a conflict', async () => {
    const database = new OwnerMutationDatabase(await createRecoverableRow())

    await expect(
      removeOwnerTextSendAuth(database as unknown as D1Database, {
        ownerUserId: row.ownerUserId,
        id: row.id,
        now,
        envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
      }),
    ).resolves.toEqual({ status: 'conflict' })
  })

  it('reports a post-read delete compare-and-set miss as a conflict', async () => {
    const database = new OwnerMutationDatabase(row)

    await expect(
      deleteOwnerTextSend(database as unknown as D1Database, {
        ownerUserId: row.ownerUserId,
        id: row.id,
        now,
      }),
    ).resolves.toEqual({ status: 'conflict' })
  })

  it.each([
    '2026-02-29T00:00:00.000Z',
    '2026-01-01T24:00:00.000Z',
    '2026-01-01T00:00:00+14:01',
    ' 2026-01-01T00:00:00.000Z',
  ])(
    'rejects invalid trusted now %s before every D1 call',
    async (invalidNow) => {
      const database = new NoD1Database() as unknown as D1Database
      await expect(
        createOwnerTextSend(database, {
          ownerUserId: 'user-1',
          body: validBody,
          now: invalidNow,
          sendId: 'send-1',
          auditEventId: 'audit-1',
          requestId: 'request-1',
          envelopeKeyId: 'envelope-v1',
          envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
          lookupKeyId: 'lookup-v1',
          lookupSecret: 'l'.repeat(32),
        }),
      ).resolves.toEqual({ status: 'invalid_request' })
      await expect(
        updateOwnerTextSend(database, {
          ownerUserId: 'user-1',
          id: 'send-1',
          body: { ...validBody, Password: 'configured' },
          expectedRevisionDate: now,
          now: invalidNow,
          envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
          lookupKeyId: 'lookup-v1',
          lookupSecret: 'l'.repeat(32),
        }),
      ).resolves.toEqual({ status: 'invalid_request' })
      await expect(
        removeOwnerTextSendAuth(database, {
          ownerUserId: 'user-1',
          id: 'send-1',
          now: invalidNow,
          envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
        }),
      ).resolves.toEqual({ status: 'invalid_request' })
      await expect(
        deleteOwnerTextSend(database, {
          ownerUserId: 'user-1',
          id: 'send-1',
          now: invalidNow,
        }),
      ).resolves.toEqual({ status: 'invalid_request' })
    },
  )

  it('recovers an envelope with a bounded previous read key', async () => {
    const capability = await createTextSendCapability({
      sendId: row.id,
      ownerUserId: row.ownerUserId,
      envelopeKeyId: 'envelope-v0',
      envelopeSecret: 'o'.repeat(32),
      lookupKeyId: 'lookup-v1',
      lookupSecret: 'l'.repeat(32),
      randomBytes: (bytes) => {
        bytes.fill(7)
        return bytes
      },
    })

    await expect(
      recoverTextSendOwnerResponse(
        {
          ...row,
          capabilityEnvelope: capability.capabilityEnvelope,
          capabilityEnvelopeKeyId: 'envelope-v0',
        },
        {
          'envelope-v1': 'e'.repeat(32),
          'envelope-v0': 'o'.repeat(32),
        },
      ),
    ).resolves.toMatchObject({ AccessId: capability.accessId })
  })

  it('rejects the full request before any write when owner input is invalid', async () => {
    const database = new OwnerServiceDatabase(row)

    await expect(
      createOwnerTextSend(database as unknown as D1Database, {
        ownerUserId: 'user-1',
        body: { ...validBody, AuthType: 0 },
        now,
        sendId: 'send-1',
        auditEventId: 'audit-1',
        requestId: 'request-1',
        envelopeKeyId: 'envelope-v1',
        envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
        lookupKeyId: 'lookup-v1',
        lookupSecret: 'l'.repeat(32),
      }),
    ).resolves.toEqual({ status: 'invalid_request' })
    expect(database.batchCalls).toHaveLength(0)
  })

  it.each([
    ['deletion', { DeletionDate: '2026-08-20T24:00:00.000Z' }],
    ['expiration', { ExpirationDate: '2026-08-10T24:00:00.000Z' }],
  ])(
    'rejects an impossible %s instant before D1 or audit writes',
    async (_name, dateMutation) => {
      const database = new OwnerServiceDatabase(row)

      await expect(
        createOwnerTextSend(database as unknown as D1Database, {
          ownerUserId: 'user-1',
          body: { ...validBody, ...dateMutation },
          now,
          sendId: 'send-1',
          auditEventId: 'audit-1',
          requestId: 'request-1',
          envelopeKeyId: 'envelope-v1',
          envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
          lookupKeyId: 'lookup-v1',
          lookupSecret: 'l'.repeat(32),
        }),
      ).resolves.toEqual({ status: 'invalid_request' })
      expect(database.batchCalls).toHaveLength(0)
    },
  )
})

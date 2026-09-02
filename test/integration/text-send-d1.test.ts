import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it } from 'vitest'

import {
  consumeTextSendAccess,
  deleteTextSend,
  getOwnerTextSend,
  listOwnerTextSends,
} from '../../src/repositories/text-send-repository'
import {
  createOwnerTextSend,
  deleteOwnerTextSend,
  getOwnerTextSendResponse,
  removeOwnerTextSendAuth,
  updateOwnerTextSend,
} from '../../src/text-send-owner'

const instances: Miniflare[] = []
const now = '2026-08-08T00:00:00.000Z'
const nextRevision = '2026-08-08T00:00:01.000Z'
const ownerUserId = '11111111-1111-4111-8111-111111111111'
const foreignUserId = '22222222-2222-4222-8222-222222222222'

afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => instance.dispose()))
})

describe('text Send foundation on real local D1', () => {
  it('persists only protected capability state and enforces owner and atomic count gates', async () => {
    const database = await createDatabase()
    const created = await createOwnerTextSend(database, {
      ownerUserId,
      body: validBody({ MaxAccessCount: 1 }),
      now,
      sendId: 'send-1',
      auditEventId: 'audit-1',
      requestId: 'request-1',
      envelopeKeyId: 'envelope-v1',
      envelopeSecrets: {
        'envelope-v0': 'o'.repeat(32),
        'envelope-v1': 'e'.repeat(32),
      },
      lookupKeyId: 'lookup-v1',
      lookupSecret: 'l'.repeat(32),
      randomBytes: deterministicEntropy,
    })

    expect(created.status).toBe('created')
    if (created.status !== 'created') throw new Error('expected create')
    const stored = await database
      .prepare(
        `SELECT capability_envelope AS capabilityEnvelope,
          capability_envelope_key_id AS capabilityEnvelopeKeyId,
          capability_verifier AS capabilityVerifier,
          password_verifier AS passwordVerifier,
          access_generation AS accessGeneration
        FROM sends WHERE id = 'send-1'`,
      )
      .first<Record<string, unknown>>()
    expect(stored).toMatchObject({
      capabilityEnvelope: expect.stringMatching(/^v1\./u),
      capabilityEnvelopeKeyId: 'envelope-v1',
      capabilityVerifier: expect.stringMatching(/^[a-f0-9]{64}$/u),
      passwordVerifier: expect.stringMatching(/^[a-f0-9]{64}$/u),
      accessGeneration: 1,
    })
    expect(JSON.stringify(stored)).not.toContain(created.send.AccessId)
    expect(JSON.stringify(stored)).not.toContain('client-derived-hash')
    await expect(
      getOwnerTextSendResponse(database, {
        id: 'send-1',
        ownerUserId,
        envelopeSecrets: {
          'envelope-v0': 'o'.repeat(32),
          'envelope-v1': 'e'.repeat(32),
        },
      }),
    ).resolves.toMatchObject({
      status: 'ok',
      send: { AccessId: created.send.AccessId },
    })
    await expect(
      getOwnerTextSend(database, { id: 'send-1', ownerUserId: foreignUserId }),
    ).resolves.toBeNull()
    await expect(
      getOwnerTextSend(database, { id: 'missing', ownerUserId }),
    ).resolves.toBeNull()

    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        consumeTextSendAccess(database, {
          capabilityVerifier: String(stored?.capabilityVerifier),
          accessGeneration: 1,
          now: nextRevision,
        }),
      ),
    )
    expect(
      attempts.filter((result) => result.status === 'consumed'),
    ).toHaveLength(1)
    expect(
      attempts.filter((result) => result.status === 'unavailable'),
    ).toHaveLength(7)
    await expect(
      database
        .prepare('SELECT access_count AS accessCount FROM sends WHERE id = ?')
        .bind('send-1')
        .first(),
    ).resolves.toEqual({ accessCount: 1 })

    await expect(
      deleteTextSend(database, {
        id: 'send-1',
        ownerUserId: foreignUserId,
        now: nextRevision,
      }),
    ).resolves.toEqual({ status: 'not_found' })
    await expect(
      deleteTextSend(database, {
        id: 'send-1',
        ownerUserId,
        now: nextRevision,
      }),
    ).resolves.toEqual({ status: 'deleted' })
    await expect(
      deleteTextSend(database, {
        id: 'send-1',
        ownerUserId,
        now: '2026-08-08T00:00:02.000Z',
      }),
    ).resolves.toEqual({ status: 'deleted' })
    await expect(
      database
        .prepare(
          `SELECT access_generation AS accessGeneration,
            deleted_at AS deletedAt, revision_date AS revisionDate
          FROM sends WHERE id = ?`,
        )
        .bind('send-1')
        .first(),
    ).resolves.toEqual({
      accessGeneration: 2,
      deletedAt: nextRevision,
      revisionDate: nextRevision,
    })
  })

  it('stores offset owner and lifecycle timestamps as fixed-width UTC across every mutation path', async () => {
    const database = await createDatabase()
    const id = 'send-offset-timestamps'
    const createNow = '2026-08-08T09:00:00+09:00'
    const canonicalCreateNow = '2026-08-08T00:00:00.000Z'
    const createExpiration = '2026-08-10T09:00:00+09:00'
    const canonicalCreateExpiration = '2026-08-10T00:00:00.000Z'
    const createDeletion = '2026-08-20T09:00:00+09:00'
    const canonicalCreateDeletion = '2026-08-20T00:00:00.000Z'

    await expect(
      createOwnerTextSend(database, {
        ownerUserId,
        body: validBody({
          ExpirationDate: createExpiration,
          DeletionDate: createDeletion,
        }),
        now: createNow,
        sendId: id,
        auditEventId: `audit-${id}`,
        requestId: `request-${id}`,
        envelopeKeyId: 'envelope-v1',
        envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
        lookupKeyId: 'lookup-v1',
        lookupSecret: 'l'.repeat(32),
        randomBytes: deterministicEntropy,
      }),
    ).resolves.toMatchObject({
      status: 'created',
      send: {
        RevisionDate: canonicalCreateNow,
        ExpirationDate: canonicalCreateExpiration,
        DeletionDate: canonicalCreateDeletion,
      },
    })

    const createdTimestamps = await readStoredTimestamps(database, id)
    expect(createdTimestamps).toEqual({
      revisionDate: canonicalCreateNow,
      createdAt: canonicalCreateNow,
      updatedAt: canonicalCreateNow,
      expirationAt: canonicalCreateExpiration,
      deletionAt: canonicalCreateDeletion,
      deletedAt: null,
    })
    expectFixedWidthUtcTimestamps(createdTimestamps)
    const createAudit = await database
      .prepare(
        `SELECT name, occurred_at AS occurredAt, target_id AS targetId
        FROM audit_events
        WHERE id = ?`,
      )
      .bind(`audit-${id}`)
      .first<{ name: string; occurredAt: string; targetId: string }>()
    expect(createAudit).toEqual({
      name: 'send.text.create',
      occurredAt: canonicalCreateNow,
      targetId: id,
    })
    expectFixedWidthUtcTimestamps(
      createAudit ? { occurredAt: createAudit.occurredAt } : null,
    )

    const updateNow = '2026-08-08T11:30:00+10:00'
    const canonicalUpdateNow = '2026-08-08T01:30:00.000Z'
    const updateExpiration = '2026-08-10T23:45:00-10:00'
    const canonicalUpdateExpiration = '2026-08-11T09:45:00.000Z'
    const updateDeletion = '2026-08-21T23:45:00-10:00'
    const canonicalUpdateDeletion = '2026-08-22T09:45:00.000Z'
    await expect(
      updateOwnerTextSend(database, {
        ownerUserId,
        id,
        body: validBody({
          Name: 'opaque-offset-update',
          Password: 'configured',
          ExpirationDate: updateExpiration,
          DeletionDate: updateDeletion,
        }),
        expectedRevisionDate: canonicalCreateNow,
        now: updateNow,
        envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
        lookupKeyId: 'lookup-v1',
        lookupSecret: 'l'.repeat(32),
      }),
    ).resolves.toMatchObject({
      status: 'updated',
      send: {
        RevisionDate: canonicalUpdateNow,
        ExpirationDate: canonicalUpdateExpiration,
        DeletionDate: canonicalUpdateDeletion,
      },
    })
    const updatedTimestamps = await readStoredTimestamps(database, id)
    expect(updatedTimestamps).toEqual({
      revisionDate: canonicalUpdateNow,
      createdAt: canonicalCreateNow,
      updatedAt: canonicalUpdateNow,
      expirationAt: canonicalUpdateExpiration,
      deletionAt: canonicalUpdateDeletion,
      deletedAt: null,
    })
    expectFixedWidthUtcTimestamps(updatedTimestamps)

    const removeNow = '2026-08-08T16:00:00+14:00'
    const canonicalRemoveNow = '2026-08-08T02:00:00.000Z'
    await expect(
      removeOwnerTextSendAuth(database, {
        ownerUserId,
        id,
        now: removeNow,
        envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
      }),
    ).resolves.toMatchObject({
      status: 'updated',
      send: { RevisionDate: canonicalRemoveNow },
    })
    const removedTimestamps = await readStoredTimestamps(database, id)
    expect(removedTimestamps).toEqual({
      revisionDate: canonicalRemoveNow,
      createdAt: canonicalCreateNow,
      updatedAt: canonicalRemoveNow,
      expirationAt: canonicalUpdateExpiration,
      deletionAt: canonicalUpdateDeletion,
      deletedAt: null,
    })
    expectFixedWidthUtcTimestamps(removedTimestamps)

    const deleteNow = '2026-08-07T17:30:00-10:00'
    const canonicalDeleteNow = '2026-08-08T03:30:00.000Z'
    await expect(
      deleteOwnerTextSend(database, { ownerUserId, id, now: deleteNow }),
    ).resolves.toEqual({ status: 'deleted' })
    const deletedTimestamps = await readStoredTimestamps(database, id)
    expect(deletedTimestamps).toEqual({
      revisionDate: canonicalDeleteNow,
      createdAt: canonicalCreateNow,
      updatedAt: canonicalDeleteNow,
      expirationAt: canonicalUpdateExpiration,
      deletionAt: canonicalUpdateDeletion,
      deletedAt: canonicalDeleteNow,
    })
    expectFixedWidthUtcTimestamps(deletedTimestamps)

    expect(JSON.stringify(deletedTimestamps)).not.toContain('+')
    expect(JSON.stringify(deletedTimestamps)).not.toContain('-10:00')
  })

  it('orders real D1 owner lists by chronology after canonicalizing lexically misleading offsets', async () => {
    const database = await createDatabase()
    const lexicallyLaterButOlder = '2026-08-08T23:00:00+14:00'
    const lexicallyEarlierButNewer = '2026-08-08T00:30:00-10:00'
    expect(lexicallyLaterButOlder > lexicallyEarlierButNewer).toBe(true)
    expect(
      Date.parse(lexicallyLaterButOlder) < Date.parse(lexicallyEarlierButNewer),
    ).toBe(true)

    for (const [fixtureIndex, fixture] of [
      {
        id: 'send-chronologically-older',
        now: lexicallyLaterButOlder,
      },
      {
        id: 'send-chronologically-newer',
        now: lexicallyEarlierButNewer,
      },
    ].entries()) {
      await createOwnerTextSend(database, {
        ownerUserId,
        body: validBody(),
        now: fixture.now,
        sendId: fixture.id,
        auditEventId: `audit-${fixture.id}`,
        requestId: `request-${fixture.id}`,
        envelopeKeyId: 'envelope-v1',
        envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
        lookupKeyId: 'lookup-v1',
        lookupSecret: 'l'.repeat(32),
        randomBytes: (bytes) => {
          bytes.fill(7 + fixtureIndex)
          return bytes
        },
      })
    }

    const rows = await listOwnerTextSends(database, ownerUserId)
    expect(rows.map(({ id, revisionDate }) => ({ id, revisionDate }))).toEqual([
      {
        id: 'send-chronologically-newer',
        revisionDate: '2026-08-08T10:30:00.000Z',
      },
      {
        id: 'send-chronologically-older',
        revisionDate: '2026-08-08T09:00:00.000Z',
      },
    ])
    for (const row of rows) {
      expectFixedWidthUtcTimestamps({ revisionDate: row.revisionDate })
    }
  })

  it('does not accept the owner-only configured marker as a newly set password', async () => {
    const database = await createDatabase()
    await createOwnerTextSend(database, {
      ownerUserId,
      body: validBody({ AuthType: 2, Password: null }),
      now,
      sendId: 'send-none',
      auditEventId: 'audit-none',
      requestId: 'request-none',
      envelopeKeyId: 'envelope-v1',
      envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
      lookupKeyId: 'lookup-v1',
      lookupSecret: 'l'.repeat(32),
      randomBytes: deterministicEntropy,
    })

    await expect(
      updateOwnerTextSend(database, {
        ownerUserId,
        id: 'send-none',
        body: validBody({ AuthType: 1, Password: 'configured' }),
        expectedRevisionDate: now,
        now: nextRevision,
        envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
        lookupKeyId: 'lookup-v1',
        lookupSecret: 'l'.repeat(32),
      }),
    ).resolves.toEqual({ status: 'invalid_request' })
    await expect(
      database
        .prepare(
          `SELECT auth_type AS authType, password_verifier AS passwordVerifier,
            access_generation AS accessGeneration
          FROM sends WHERE id = ?`,
        )
        .bind('send-none')
        .first(),
    ).resolves.toEqual({
      authType: 2,
      passwordVerifier: null,
      accessGeneration: 1,
    })
  })

  it('rejects lookup-root reuse during password enablement without mutating D1', async () => {
    const database = await createDatabase()
    const id = 'send-root-reuse'
    await createOwnerTextSend(database, {
      ownerUserId,
      body: validBody({ AuthType: 2, Password: null }),
      now,
      sendId: id,
      auditEventId: `audit-${id}`,
      requestId: `request-${id}`,
      envelopeKeyId: 'envelope-v1',
      envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
      lookupKeyId: 'lookup-v1',
      lookupSecret: 'l'.repeat(32),
      randomBytes: deterministicEntropy,
    })
    const before = await readOwnerMutationState(database, id)
    const auditCount = await readAuditCount(database)

    await expect(
      updateOwnerTextSend(database, {
        ownerUserId,
        id,
        body: validBody({ AuthType: 1, Password: 'new-client-hash' }),
        expectedRevisionDate: now,
        now: nextRevision,
        envelopeSecrets: {
          'envelope-v1': 'e'.repeat(32),
          'envelope-v0': 'o'.repeat(32),
        },
        lookupKeyId: 'lookup-v2',
        lookupSecret: 'e'.repeat(32),
      }),
    ).rejects.toThrow(/independent/u)
    await expect(readOwnerMutationState(database, id)).resolves.toEqual(before)
    await expect(readAuditCount(database)).resolves.toBe(auditCount)
  })

  it('rejects lookup-root reuse from a previous create read key before entropy or D1 writes', async () => {
    const database = await createDatabase()
    let entropyCalls = 0
    const previousEnvelopeRoot = '\ud800'.repeat(32)
    const lookupRoot = '\ud801'.repeat(32)
    expect(previousEnvelopeRoot).not.toBe(lookupRoot)
    expect(new TextEncoder().encode(previousEnvelopeRoot)).toEqual(
      new TextEncoder().encode(lookupRoot),
    )
    const input = {
      ownerUserId,
      body: validBody(),
      now,
      sendId: 'send-create-previous-root-reuse',
      auditEventId: 'audit-create-previous-root-reuse',
      requestId: 'request-create-previous-root-reuse',
      envelopeKeyId: 'envelope-v1',
      envelopeSecrets: {
        'envelope-v1': 'e'.repeat(32),
        'envelope-v0': previousEnvelopeRoot,
      },
      lookupKeyId: 'lookup-v2',
      lookupSecret: lookupRoot,
      randomBytes: (bytes: Uint8Array) => {
        entropyCalls += 1
        return deterministicEntropy(bytes)
      },
    }

    await expect(createOwnerTextSend(database, input)).rejects.toThrow(
      /independent/u,
    )
    expect(entropyCalls).toBe(0)
    await expect(readTextSendAndAuditCounts(database)).resolves.toEqual({
      sendCount: 0,
      auditCount: 0,
    })
  })

  it.each([
    {
      name: 'empty',
      envelopeKeyId: 'envelope-v1',
      envelopeSecrets: {},
      error: /keyring is invalid/u,
    },
    {
      name: 'oversized',
      envelopeKeyId: 'envelope-v1',
      envelopeSecrets: {
        'envelope-v1': 'e'.repeat(32),
        'envelope-v0': 'o'.repeat(32),
        'envelope-v2': 'p'.repeat(32),
        'envelope-v3': 'q'.repeat(32),
      },
      error: /keyring is invalid/u,
    },
    {
      name: 'missing-active',
      envelopeKeyId: 'envelope-v1',
      envelopeSecrets: { 'envelope-v0': 'o'.repeat(32) },
      error: /key is unavailable/u,
    },
    {
      name: 'empty-active',
      envelopeKeyId: 'envelope-v1',
      envelopeSecrets: { 'envelope-v1': '' },
      error: /at least 32 bytes/u,
    },
    {
      name: 'short-active',
      envelopeKeyId: 'envelope-v1',
      envelopeSecrets: { 'envelope-v1': 'e'.repeat(31) },
      error: /at least 32 bytes/u,
    },
    {
      name: 'invalid-previous-root',
      envelopeKeyId: 'envelope-v1',
      envelopeSecrets: {
        'envelope-v1': 'e'.repeat(32),
        'envelope-v0': '',
      },
      error: /at least 32 bytes/u,
    },
    {
      name: 'invalid-previous-key-id',
      envelopeKeyId: 'envelope-v1',
      envelopeSecrets: {
        'envelope-v1': 'e'.repeat(32),
        'previous\0invalid': 'o'.repeat(32),
      },
      error: /key identifier is invalid/u,
    },
  ])(
    'rejects an $name create envelope keyring before entropy or D1 writes',
    async ({ name, envelopeKeyId, envelopeSecrets, error }) => {
      const database = await createDatabase()
      let entropyCalls = 0

      await expect(
        createOwnerTextSend(database, {
          ownerUserId,
          body: validBody(),
          now,
          sendId: `send-create-keyring-${name}`,
          auditEventId: `audit-create-keyring-${name}`,
          requestId: `request-create-keyring-${name}`,
          envelopeKeyId,
          envelopeSecrets,
          lookupKeyId: 'lookup-v1',
          lookupSecret: 'l'.repeat(32),
          randomBytes: (bytes) => {
            entropyCalls += 1
            return deterministicEntropy(bytes)
          },
        }),
      ).rejects.toThrow(error)
      expect(entropyCalls).toBe(0)
      await expect(readTextSendAndAuditCounts(database)).resolves.toEqual({
        sendCount: 0,
        auditCount: 0,
      })
    },
  )

  it('rejects the owner-only configured marker on create before entropy or D1 writes', async () => {
    const database = await createDatabase()
    let entropyCalls = 0

    await expect(
      createOwnerTextSend(database, {
        ownerUserId,
        body: validBody({ Password: 'configured' }),
        now,
        sendId: 'send-configured-create',
        auditEventId: 'audit-configured-create',
        requestId: 'request-configured-create',
        envelopeKeyId: 'envelope-v1',
        envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
        lookupKeyId: 'lookup-v1',
        lookupSecret: 'l'.repeat(32),
        randomBytes: (bytes) => {
          entropyCalls += 1
          return deterministicEntropy(bytes)
        },
      }),
    ).resolves.toEqual({ status: 'invalid_request' })
    expect(entropyCalls).toBe(0)
    await expect(
      database
        .prepare(
          `SELECT
            (SELECT COUNT(*) FROM sends) AS sendCount,
            (SELECT COUNT(*) FROM audit_events) AS auditCount`,
        )
        .first(),
    ).resolves.toEqual({ sendCount: 0, auditCount: 0 })
  })

  it.each(['update', 'remove-auth'] as const)(
    'preflights owner capability recovery before %s mutations',
    async (operation) => {
      const database = await createDatabase()
      const cases = [
        { name: 'missing', envelopeSecrets: {} },
        {
          name: 'missing-active-key',
          envelopeSecrets: { 'envelope-v0': 'o'.repeat(32) },
        },
        {
          name: 'empty-active-secret',
          envelopeSecrets: { 'envelope-v1': '' },
        },
        {
          name: 'oversized',
          envelopeSecrets: {
            'envelope-v1': 'e'.repeat(32),
            'envelope-v0': 'o'.repeat(32),
            'envelope-v2': 'p'.repeat(32),
            'envelope-v3': 'q'.repeat(32),
          },
        },
        {
          name: 'wrong',
          envelopeSecrets: { 'envelope-v1': 'x'.repeat(32) },
        },
        {
          name: 'corrupt',
          envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
          corruptEnvelope: true,
        },
      ]

      for (const [caseIndex, fixture] of cases.entries()) {
        const id = `send-preflight-${operation}-${fixture.name}`
        await createOwnerTextSend(database, {
          ownerUserId,
          body: validBody(),
          now,
          sendId: id,
          auditEventId: `audit-${id}`,
          requestId: `request-${id}`,
          envelopeKeyId: 'envelope-v1',
          envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
          lookupKeyId: 'lookup-v1',
          lookupSecret: 'l'.repeat(32),
          randomBytes: (bytes) => {
            bytes.fill(7 + caseIndex)
            return bytes
          },
        })
        if (fixture.corruptEnvelope) {
          await database
            .prepare('UPDATE sends SET capability_envelope = ? WHERE id = ?')
            .bind('v1.invalid.invalid', id)
            .run()
        }
        const before = await readOwnerMutationState(database, id)
        const auditCount = await readAuditCount(database)

        const mutation =
          operation === 'update'
            ? updateOwnerTextSend(database, {
                ownerUserId,
                id,
                body: validBody({
                  Name: `must-not-write-${fixture.name}`,
                  Password: 'configured',
                }),
                expectedRevisionDate: now,
                now: nextRevision,
                envelopeSecrets: fixture.envelopeSecrets,
                lookupKeyId: 'lookup-v1',
                lookupSecret: 'l'.repeat(32),
              })
            : removeOwnerTextSendAuth(database, {
                ownerUserId,
                id,
                now: nextRevision,
                envelopeSecrets: fixture.envelopeSecrets,
              })

        await expect(mutation).rejects.toThrow()
        await expect(readOwnerMutationState(database, id)).resolves.toEqual(
          before,
        )
        await expect(readAuditCount(database)).resolves.toBe(auditCount)
      }
    },
  )

  it('validates an owner update before capability recovery without mutating a corrupt row', async () => {
    const database = await createDatabase()
    const id = 'send-invalid-before-recovery'
    await createOwnerTextSend(database, {
      ownerUserId,
      body: validBody(),
      now,
      sendId: id,
      auditEventId: `audit-${id}`,
      requestId: `request-${id}`,
      envelopeKeyId: 'envelope-v1',
      envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
      lookupKeyId: 'lookup-v1',
      lookupSecret: 'l'.repeat(32),
      randomBytes: deterministicEntropy,
    })
    await database
      .prepare('UPDATE sends SET capability_envelope = ? WHERE id = ?')
      .bind('v1.invalid.invalid', id)
      .run()
    const before = await readOwnerMutationState(database, id)
    const auditCount = await readAuditCount(database)

    await expect(
      updateOwnerTextSend(database, {
        ownerUserId,
        id,
        body: validBody({ Name: null }),
        expectedRevisionDate: now,
        now: nextRevision,
        envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
        lookupKeyId: 'lookup-v1',
        lookupSecret: 'l'.repeat(32),
      }),
    ).resolves.toEqual({ status: 'invalid_request' })
    await expect(readOwnerMutationState(database, id)).resolves.toEqual(before)
    await expect(readAuditCount(database)).resolves.toBe(auditCount)
  })

  it('applies owner revision guards and removes authentication idempotently', async () => {
    const database = await createDatabase()
    await createOwnerTextSend(database, {
      ownerUserId,
      body: validBody(),
      now,
      sendId: 'send-update',
      auditEventId: 'audit-update',
      requestId: 'request-update',
      envelopeKeyId: 'envelope-v1',
      envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
      lookupKeyId: 'lookup-v1',
      lookupSecret: 'l'.repeat(32),
      randomBytes: deterministicEntropy,
    })
    const before = await readAuthState(database, 'send-update')

    await expect(
      updateOwnerTextSend(database, {
        ownerUserId: foreignUserId,
        id: 'send-update',
        body: validBody({ Password: 'configured' }),
        expectedRevisionDate: now,
        now: nextRevision,
        envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
        lookupKeyId: 'lookup-v1',
        lookupSecret: 'l'.repeat(32),
      }),
    ).resolves.toEqual({ status: 'not_found' })
    await expect(
      updateOwnerTextSend(database, {
        ownerUserId,
        id: 'send-update',
        body: validBody({ Password: 'configured' }),
        expectedRevisionDate: '2026-08-07T00:00:00.000Z',
        now: nextRevision,
        envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
        lookupKeyId: 'lookup-v1',
        lookupSecret: 'l'.repeat(32),
      }),
    ).resolves.toEqual({ status: 'conflict' })

    const updated = await updateOwnerTextSend(database, {
      ownerUserId,
      id: 'send-update',
      body: validBody({
        Name: 'opaque-next-name',
        Password: 'configured',
      }),
      expectedRevisionDate: now,
      now: nextRevision,
      envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
      lookupKeyId: 'lookup-v1',
      lookupSecret: 'l'.repeat(32),
    })
    expect(updated).toMatchObject({
      status: 'updated',
      send: { Name: 'opaque-next-name', AuthType: 1 },
    })
    await expect(readAuthState(database, 'send-update')).resolves.toEqual({
      authType: 1,
      passwordVerifier: before?.passwordVerifier,
      accessGeneration: 2,
      revisionDate: nextRevision,
    })

    const removedAt = '2026-08-08T00:00:02.000Z'
    await expect(
      removeOwnerTextSendAuth(database, {
        ownerUserId,
        id: 'send-update',
        now: removedAt,
        envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
      }),
    ).resolves.toMatchObject({
      status: 'updated',
      send: { AuthType: 2, Password: null },
    })
    await expect(
      removeOwnerTextSendAuth(database, {
        ownerUserId,
        id: 'send-update',
        now: '2026-08-08T00:00:03.000Z',
        envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
      }),
    ).resolves.toMatchObject({ status: 'updated' })
    await expect(readAuthState(database, 'send-update')).resolves.toEqual({
      authType: 2,
      passwordVerifier: null,
      accessGeneration: 3,
      revisionDate: removedAt,
    })
  })

  it('advances the revision when trusted now equals the current revision and rejects a stale retry', async () => {
    const database = await createDatabase()
    await createOwnerTextSend(database, {
      ownerUserId,
      body: validBody(),
      now,
      sendId: 'send-monotonic-revision',
      auditEventId: 'audit-monotonic-revision',
      requestId: 'request-monotonic-revision',
      envelopeKeyId: 'envelope-v1',
      envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
      lookupKeyId: 'lookup-v1',
      lookupSecret: 'l'.repeat(32),
      randomBytes: deterministicEntropy,
    })

    await expect(
      updateOwnerTextSend(database, {
        ownerUserId,
        id: 'send-monotonic-revision',
        body: validBody({
          Name: 'opaque-first-update',
          Password: 'configured',
        }),
        expectedRevisionDate: now,
        now,
        envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
        lookupKeyId: 'lookup-v1',
        lookupSecret: 'l'.repeat(32),
      }),
    ).resolves.toMatchObject({
      status: 'updated',
      send: {
        Name: 'opaque-first-update',
        RevisionDate: '2026-08-08T00:00:00.001Z',
      },
    })

    await expect(
      updateOwnerTextSend(database, {
        ownerUserId,
        id: 'send-monotonic-revision',
        body: validBody({
          Name: 'opaque-stale-retry',
          Password: 'configured',
        }),
        expectedRevisionDate: now,
        now,
        envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
        lookupKeyId: 'lookup-v1',
        lookupSecret: 'l'.repeat(32),
      }),
    ).resolves.toEqual({ status: 'conflict' })

    await expect(
      database
        .prepare(
          `SELECT encrypted_name AS encryptedName,
            access_generation AS accessGeneration,
            revision_date AS revisionDate
          FROM sends WHERE id = ?`,
        )
        .bind('send-monotonic-revision')
        .first(),
    ).resolves.toEqual({
      encryptedName: 'opaque-first-update',
      accessGeneration: 2,
      revisionDate: '2026-08-08T00:00:00.001Z',
    })
  })

  it('allows exactly one of two updates with the same observed revision', async () => {
    const database = await createDatabase()
    const id = 'send-concurrent-update'
    await createOwnerTextSend(database, {
      ownerUserId,
      body: validBody(),
      now,
      sendId: id,
      auditEventId: `audit-${id}`,
      requestId: `request-${id}`,
      envelopeKeyId: 'envelope-v1',
      envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
      lookupKeyId: 'lookup-v1',
      lookupSecret: 'l'.repeat(32),
      randomBytes: deterministicEntropy,
    })

    const attempts = await Promise.all(
      ['opaque-update-a', 'opaque-update-b'].map((Name) =>
        updateOwnerTextSend(database, {
          ownerUserId,
          id,
          body: validBody({ Name, Password: 'configured' }),
          expectedRevisionDate: now,
          now,
          envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
          lookupKeyId: 'lookup-v1',
          lookupSecret: 'l'.repeat(32),
        }),
      ),
    )

    expect(attempts.map((result) => result.status).sort()).toEqual([
      'conflict',
      'updated',
    ])
    await expect(
      database
        .prepare(
          `SELECT encrypted_name AS encryptedName,
            access_generation AS accessGeneration,
            revision_date AS revisionDate
          FROM sends WHERE id = ?`,
        )
        .bind(id)
        .first(),
    ).resolves.toEqual({
      encryptedName: expect.stringMatching(/^opaque-update-[ab]$/u),
      accessGeneration: 2,
      revisionDate: '2026-08-08T00:00:00.001Z',
    })
  })

  it.each([
    ['update', 'remove-auth'],
    ['update', 'delete'],
    ['remove-auth', 'delete'],
  ] as const)(
    'reports one conflict for concurrent %s and %s owner mutations',
    async (leftOperation, rightOperation) => {
      const database = await createDatabase()
      const id = `send-race-${leftOperation}-${rightOperation}`
      await createOwnerTextSend(database, {
        ownerUserId,
        body: validBody(),
        now,
        sendId: id,
        auditEventId: `audit-${id}`,
        requestId: `request-${id}`,
        envelopeKeyId: 'envelope-v1',
        envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
        lookupKeyId: 'lookup-v1',
        lookupSecret: 'l'.repeat(32),
        randomBytes: deterministicEntropy,
      })
      const barrierDatabase = new TwoMutationBarrierDatabase(database)
      const run = (operation: 'update' | 'remove-auth' | 'delete') => {
        if (operation === 'update') {
          return updateOwnerTextSend(barrierDatabase as unknown as D1Database, {
            ownerUserId,
            id,
            body: validBody({
              Name: `opaque-${leftOperation}-${rightOperation}`,
              Password: 'configured',
            }),
            expectedRevisionDate: now,
            now,
            envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
            lookupKeyId: 'lookup-v1',
            lookupSecret: 'l'.repeat(32),
          })
        }
        if (operation === 'remove-auth') {
          return removeOwnerTextSendAuth(
            barrierDatabase as unknown as D1Database,
            {
              ownerUserId,
              id,
              now,
              envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
            },
          )
        }
        return deleteOwnerTextSend(barrierDatabase as unknown as D1Database, {
          ownerUserId,
          id,
          now,
        })
      }

      const results = await Promise.all([
        run(leftOperation),
        run(rightOperation),
      ])

      expect(
        results.filter((result) => result.status === 'conflict'),
      ).toHaveLength(1)
      expect(
        results.filter((result) => result.status !== 'conflict'),
      ).toHaveLength(1)
      await expect(
        database
          .prepare(
            `SELECT access_generation AS accessGeneration,
              revision_date AS revisionDate
            FROM sends WHERE id = ?`,
          )
          .bind(id)
          .first(),
      ).resolves.toEqual({
        accessGeneration: 2,
        revisionDate: '2026-08-08T00:00:00.001Z',
      })
    },
  )

  it('advances remove-auth and delete revisions while keeping idempotent retries unchanged', async () => {
    const database = await createDatabase()
    await createOwnerTextSend(database, {
      ownerUserId,
      body: validBody(),
      now,
      sendId: 'send-monotonic-owner-mutations',
      auditEventId: 'audit-monotonic-owner-mutations',
      requestId: 'request-monotonic-owner-mutations',
      envelopeKeyId: 'envelope-v1',
      envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
      lookupKeyId: 'lookup-v1',
      lookupSecret: 'l'.repeat(32),
      randomBytes: deterministicEntropy,
    })

    await expect(
      removeOwnerTextSendAuth(database, {
        ownerUserId,
        id: 'send-monotonic-owner-mutations',
        now,
        envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
      }),
    ).resolves.toMatchObject({
      status: 'updated',
      send: { RevisionDate: '2026-08-08T00:00:00.001Z' },
    })
    await expect(
      removeOwnerTextSendAuth(database, {
        ownerUserId,
        id: 'send-monotonic-owner-mutations',
        now: '2026-08-07T23:59:59.000Z',
        envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
      }),
    ).resolves.toMatchObject({
      status: 'updated',
      send: { RevisionDate: '2026-08-08T00:00:00.001Z' },
    })
    await expect(
      readAuthState(database, 'send-monotonic-owner-mutations'),
    ).resolves.toMatchObject({
      authType: 2,
      accessGeneration: 2,
      revisionDate: '2026-08-08T00:00:00.001Z',
    })

    await expect(
      deleteOwnerTextSend(database, {
        ownerUserId,
        id: 'send-monotonic-owner-mutations',
        now,
      }),
    ).resolves.toEqual({ status: 'deleted' })
    await expect(
      deleteOwnerTextSend(database, {
        ownerUserId,
        id: 'send-monotonic-owner-mutations',
        now: '2026-08-07T23:59:59.000Z',
      }),
    ).resolves.toEqual({ status: 'deleted' })
    await expect(
      database
        .prepare(
          `SELECT access_generation AS accessGeneration,
            deleted_at AS deletedAt, revision_date AS revisionDate,
            updated_at AS updatedAt
          FROM sends WHERE id = ?`,
        )
        .bind('send-monotonic-owner-mutations')
        .first(),
    ).resolves.toEqual({
      accessGeneration: 3,
      deletedAt: '2026-08-08T00:00:00.002Z',
      revisionDate: '2026-08-08T00:00:00.002Z',
      updatedAt: '2026-08-08T00:00:00.002Z',
    })
  })

  it.each([
    { index: 0, lifecycleState: 'active', disabled: 0 },
    { index: 1, lifecycleState: 'deleted', disabled: 0 },
  ])(
    'fails closed on an incomplete retained tombstone $lifecycleState/$disabled',
    async ({ index, lifecycleState, disabled }) => {
      const database = await createDatabase()
      const id = `send-incomplete-tombstone-${index}`
      await createOwnerTextSend(database, {
        ownerUserId,
        body: validBody(),
        now,
        sendId: id,
        auditEventId: `audit-${id}`,
        requestId: `request-${id}`,
        envelopeKeyId: 'envelope-v1',
        envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
        lookupKeyId: 'lookup-v1',
        lookupSecret: 'l'.repeat(32),
        randomBytes: (bytes) => {
          bytes.fill(20 + index)
          return bytes
        },
      })
      await database
        .prepare(
          `UPDATE sends
          SET deleted_at = ?, lifecycle_state = ?, disabled = ?
          WHERE id = ?`,
        )
        .bind(nextRevision, lifecycleState, disabled, id)
        .run()
      const before = await readOwnerMutationState(database, id)
      const auditCount = await readAuditCount(database)

      await expect(
        deleteOwnerTextSend(database, {
          ownerUserId,
          id,
          now: '2026-08-08T00:00:02.000Z',
        }),
      ).resolves.toEqual({ status: 'not_found' })
      await expect(readOwnerMutationState(database, id)).resolves.toEqual(
        before,
      )
      await expect(readAuditCount(database)).resolves.toBe(auditCount)
    },
  )

  it('does not let owner updates release consistent or legacy-inconsistent quarantine state', async () => {
    const database = await createDatabase()

    for (const fixture of [
      { id: 'send-quarantined', quarantinedAt: nextRevision },
      { id: 'send-quarantined-legacy', quarantinedAt: null },
    ]) {
      await createOwnerTextSend(database, {
        ownerUserId,
        body: validBody(),
        now,
        sendId: fixture.id,
        auditEventId: `audit-${fixture.id}`,
        requestId: `request-${fixture.id}`,
        envelopeKeyId: 'envelope-v1',
        envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
        lookupKeyId: 'lookup-v1',
        lookupSecret: 'l'.repeat(32),
      })
      if (fixture.quarantinedAt === null) {
        await database.prepare('PRAGMA ignore_check_constraints = ON').run()
      }
      await database
        .prepare(
          `UPDATE sends
          SET lifecycle_state = 'quarantined', quarantined_at = ?
          WHERE id = ?`,
        )
        .bind(fixture.quarantinedAt, fixture.id)
        .run()
      if (fixture.quarantinedAt === null) {
        await database.prepare('PRAGMA ignore_check_constraints = OFF').run()
      }
      const before = await readLifecycleState(database, fixture.id)

      await expect(
        updateOwnerTextSend(database, {
          ownerUserId,
          id: fixture.id,
          body: validBody({
            Name: 'owner-must-not-release-quarantine',
            Password: 'configured',
          }),
          expectedRevisionDate: now,
          now: '2026-08-08T00:00:02.000Z',
          envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
          lookupKeyId: 'lookup-v1',
          lookupSecret: 'l'.repeat(32),
        }),
      ).resolves.toEqual({ status: 'conflict' })
      await expect(readLifecycleState(database, fixture.id)).resolves.toEqual(
        before,
      )
      const beforeRemove = await readOwnerMutationState(database, fixture.id)
      await expect(
        removeOwnerTextSendAuth(database, {
          ownerUserId,
          id: fixture.id,
          now: '2026-08-08T00:00:03.000Z',
          envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
        }),
      ).resolves.toEqual({ status: 'not_found' })
      await expect(
        readOwnerMutationState(database, fixture.id),
      ).resolves.toEqual(beforeRemove)
    }
  })

  it('rejects quarantined lifecycle state without a quarantine timestamp', async () => {
    const database = await createDatabase()
    await createOwnerTextSend(database, {
      ownerUserId,
      body: validBody(),
      now,
      sendId: 'send-quarantine-check',
      auditEventId: 'audit-quarantine-check',
      requestId: 'request-quarantine-check',
      envelopeKeyId: 'envelope-v1',
      envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
      lookupKeyId: 'lookup-v1',
      lookupSecret: 'l'.repeat(32),
    })
    const before = await readLifecycleState(database, 'send-quarantine-check')

    await expect(
      database
        .prepare(
          `UPDATE sends
          SET lifecycle_state = 'quarantined', quarantined_at = NULL
          WHERE id = ?`,
        )
        .bind('send-quarantine-check')
        .run(),
    ).rejects.toThrow()
    await expect(
      readLifecycleState(database, 'send-quarantine-check'),
    ).resolves.toEqual(before)
  })

  it('keeps every public failure state unavailable and mutation-free', async () => {
    const database = await createDatabase()
    const accessAt = '2026-08-09T00:00:00.000Z'
    const cases = [
      'wrong_verifier',
      'stale_generation',
      'disabled',
      'expiration_boundary',
      'deletion_boundary',
      'quarantined',
      'deleted',
    ] as const

    for (const name of cases) {
      const id = `send-public-${name}`
      await createOwnerTextSend(database, {
        ownerUserId,
        body: validBody({ MaxAccessCount: null, ExpirationDate: null }),
        now,
        sendId: id,
        auditEventId: `audit-public-${name}`,
        requestId: `request-public-${name}`,
        envelopeKeyId: 'envelope-v1',
        envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
        lookupKeyId: 'lookup-v1',
        lookupSecret: 'l'.repeat(32),
      })
      const created = await readPublicAccessState(database, id)
      if (!created) throw new Error(`missing public fixture: ${name}`)

      let verifier = String(created.capabilityVerifier)
      let generation = Number(created.accessGeneration)
      if (name === 'wrong_verifier') {
        verifier = verifier === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64)
      } else if (name === 'stale_generation') {
        generation += 1
      } else if (name === 'disabled') {
        await database
          .prepare(
            `UPDATE sends
            SET lifecycle_state = 'disabled', disabled = 1
            WHERE id = ?`,
          )
          .bind(id)
          .run()
      } else if (name === 'expiration_boundary') {
        await database
          .prepare('UPDATE sends SET expiration_at = ? WHERE id = ?')
          .bind(accessAt, id)
          .run()
      } else if (name === 'deletion_boundary') {
        await database
          .prepare('UPDATE sends SET deletion_at = ? WHERE id = ?')
          .bind(accessAt, id)
          .run()
      } else if (name === 'quarantined') {
        await database
          .prepare(
            `UPDATE sends
            SET lifecycle_state = 'quarantined', quarantined_at = ?
            WHERE id = ?`,
          )
          .bind(nextRevision, id)
          .run()
      } else {
        await database
          .prepare(
            `UPDATE sends
            SET lifecycle_state = 'deleted', disabled = 1, deleted_at = ?
            WHERE id = ?`,
          )
          .bind(nextRevision, id)
          .run()
      }
      const before = await readPublicAccessState(database, id)

      await expect(
        consumeTextSendAccess(database, {
          capabilityVerifier: verifier,
          accessGeneration: generation,
          now: accessAt,
        }),
        name,
      ).resolves.toEqual({ status: 'unavailable' })
      await expect(readPublicAccessState(database, id), name).resolves.toEqual(
        before,
      )
    }
  })

  it('returns the same remove-auth result for cross-owner and missing rows without mutation', async () => {
    const database = await createDatabase()
    await createOwnerTextSend(database, {
      ownerUserId,
      body: validBody(),
      now,
      sendId: 'send-remove-auth-scope',
      auditEventId: 'audit-remove-auth-scope',
      requestId: 'request-remove-auth-scope',
      envelopeKeyId: 'envelope-v1',
      envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
      lookupKeyId: 'lookup-v1',
      lookupSecret: 'l'.repeat(32),
    })
    const before = await readAuthState(database, 'send-remove-auth-scope')

    for (const input of [
      { id: 'send-remove-auth-scope', ownerUserId: foreignUserId },
      { id: 'missing-send', ownerUserId },
    ]) {
      await expect(
        removeOwnerTextSendAuth(database, {
          ...input,
          now: nextRevision,
          envelopeSecrets: { 'envelope-v1': 'e'.repeat(32) },
        }),
      ).resolves.toEqual({ status: 'not_found' })
    }
    await expect(
      readAuthState(database, 'send-remove-auth-scope'),
    ).resolves.toEqual(before)
  })

  it('applies the complete ordered migration chain before Text Send tests', async () => {
    const database = await createDatabase()
    const ledger = await database
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all<{ version: string }>()

    expect(ledger.results.map((entry) => entry.version)).toEqual(
      migrationFiles.map((entry) => entry.slice(0, entry.indexOf('_'))),
    )
  })
})

function validBody(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  }
}

function deterministicEntropy(bytes: Uint8Array): Uint8Array {
  bytes.fill(7)
  return bytes
}

class TwoMutationBarrierDatabase {
  private arrivals = 0
  private release!: () => void
  private readonly gate = new Promise<void>((resolve) => {
    this.release = resolve
  })

  constructor(private readonly database: D1Database) {}

  prepare(query: string): D1PreparedStatement {
    return this.wrap(query, this.database.prepare(query))
  }

  private wrap(
    query: string,
    statement: D1PreparedStatement,
  ): D1PreparedStatement {
    return {
      bind: (...values: unknown[]) =>
        this.wrap(query, statement.bind(...values)),
      first: async () => {
        if (/^\s*UPDATE\s+sends\b/u.test(query)) {
          this.arrivals += 1
          if (this.arrivals === 2) this.release()
          await this.gate
        }
        return statement.first()
      },
    } as unknown as D1PreparedStatement
  }
}

async function readAuthState(database: D1Database, id: string) {
  return database
    .prepare(
      `SELECT auth_type AS authType, password_verifier AS passwordVerifier,
        access_generation AS accessGeneration, revision_date AS revisionDate
      FROM sends WHERE id = ?`,
    )
    .bind(id)
    .first<Record<string, unknown>>()
}

async function readStoredTimestamps(database: D1Database, id: string) {
  return database
    .prepare(
      `SELECT revision_date AS revisionDate,
        created_at AS createdAt,
        updated_at AS updatedAt,
        expiration_at AS expirationAt,
        deletion_at AS deletionAt,
        deleted_at AS deletedAt
      FROM sends WHERE id = ?`,
    )
    .bind(id)
    .first<Record<string, string | null>>()
}

function expectFixedWidthUtcTimestamps(
  timestamps: Record<string, string | null> | null,
): void {
  expect(timestamps).not.toBeNull()
  for (const value of Object.values(timestamps ?? {})) {
    if (value === null) continue
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
    expect(value).toHaveLength(24)
  }
}

async function readOwnerMutationState(database: D1Database, id: string) {
  return database
    .prepare(
      `SELECT encrypted_name AS encryptedName,
        lifecycle_state AS lifecycleState,
        disabled,
        auth_type AS authType,
        password_verifier AS passwordVerifier,
        password_key_id AS passwordKeyId,
        access_generation AS accessGeneration,
        revision_date AS revisionDate,
        updated_at AS updatedAt,
        deleted_at AS deletedAt,
        capability_envelope AS capabilityEnvelope
      FROM sends WHERE id = ?`,
    )
    .bind(id)
    .first<Record<string, unknown>>()
}

async function readAuditCount(database: D1Database): Promise<number> {
  const result = await database
    .prepare('SELECT COUNT(*) AS count FROM audit_events')
    .first<{ count: number }>()
  return result?.count ?? -1
}

async function readTextSendAndAuditCounts(database: D1Database) {
  return database
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM sends) AS sendCount,
        (SELECT COUNT(*) FROM audit_events) AS auditCount`,
    )
    .first<{ sendCount: number; auditCount: number }>()
}

async function readLifecycleState(database: D1Database, id: string) {
  return database
    .prepare(
      `SELECT lifecycle_state AS lifecycleState,
        quarantined_at AS quarantinedAt,
        access_generation AS accessGeneration,
        revision_date AS revisionDate,
        updated_at AS updatedAt,
        encrypted_name AS encryptedName
      FROM sends WHERE id = ?`,
    )
    .bind(id)
    .first<Record<string, unknown>>()
}

async function readPublicAccessState(database: D1Database, id: string) {
  return database
    .prepare(
      `SELECT capability_verifier AS capabilityVerifier,
        access_generation AS accessGeneration,
        access_count AS accessCount,
        last_accessed_at AS lastAccessedAt,
        updated_at AS updatedAt
      FROM sends WHERE id = ?`,
    )
    .bind(id)
    .first<Record<string, unknown>>()
}

async function createDatabase(): Promise<D1Database> {
  const instance = new Miniflare({
    compatibilityDate: '2026-07-21',
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: { DB: crypto.randomUUID() },
  })
  instances.push(instance)
  const database = await instance.getD1Database('DB')
  for (const migration of migrationFiles) {
    for (const statement of splitMigrationStatements(
      readMigration(migration),
    )) {
      await database.prepare(statement).run()
    }
  }
  for (const user of [
    { id: ownerUserId, email: 'owner@example.test' },
    { id: foreignUserId, email: 'foreign@example.test' },
  ]) {
    await database
      .prepare(
        `INSERT INTO users (
          id, email, email_normalized, kdf_algorithm, kdf_iterations,
          master_password_hash, security_stamp, revision_date
        ) VALUES (?, ?, ?, 'pbkdf2-sha256', 600000, 'hash', 'stamp', ?)`,
      )
      .bind(user.id, user.email, user.email, now)
      .run()
  }
  return database
}

const migrationsRoot = fileURLToPath(
  new URL('../../migrations', import.meta.url).toString(),
)
const migrationFiles = readdirSync(migrationsRoot)
  .filter((entry) => entry.endsWith('.sql'))
  .sort()

function splitMigrationStatements(sql: string): string[] {
  const statements: string[] = []
  let lines: string[] = []
  let inTrigger = false

  for (const line of sql.split('\n')) {
    const trimmed = line.trim()
    if (lines.length === 0 && trimmed.length === 0) continue
    if (!inTrigger && /^CREATE\s+TRIGGER\b/iu.test(trimmed)) inTrigger = true
    lines.push(line)
    const completesStatement = inTrigger
      ? /^END;$/iu.test(trimmed)
      : trimmed.endsWith(';')
    if (!completesStatement) continue
    statements.push(lines.join('\n').trim())
    lines = []
    inTrigger = false
  }

  if (lines.some((line) => line.trim().length > 0)) {
    throw new Error('Migration contains an incomplete SQL statement.')
  }
  return statements
}

function readMigration(name: string): string {
  return readFileSync(`${migrationsRoot}/${name}`, 'utf8')
}

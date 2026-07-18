import assert from 'node:assert/strict'
import test from 'node:test'

import { auditBlockRelations } from './account-credential-relation-audit.mjs'

const issue = (id, identifier) => ({ id, identifier })
const relation = (id, source, target, archivedAt = null) => ({
  id,
  type: 'blocks',
  archivedAt,
  issue: source,
  relatedIssue: target,
})

const a = issue('a', 'HON-202')
const b = issue('b', 'HON-203')
const c = issue('c', 'HON-204')
const expectedPairs = [
  {
    blocker: a.identifier,
    blocked: b.identifier,
    sourceId: a.id,
    targetId: b.id,
  },
  {
    blocker: a.identifier,
    blocked: c.identifier,
    sourceId: a.id,
    targetId: c.id,
  },
]
const managedIssueIds = new Set([a.id, b.id, c.id])

test('accepts one exact relation in every expected direction', () => {
  const result = auditBlockRelations({
    expectedPairs,
    relations: [relation('ab', a, b), relation('ac', a, c)],
    managedIssueIds,
  })

  assert.deepEqual(result.errors, [])
  assert.equal(
    result.rows.every((row) => row.exact),
    true,
  )
  assert.deepEqual(result.unexpectedRows, [])
})

test('rejects missing, duplicate, and unresolved relation endpoints', () => {
  const result = auditBlockRelations({
    expectedPairs: [
      expectedPairs[0],
      {
        blocker: 'AUTH-2A',
        blocked: 'AUTH-2D',
        sourceId: null,
        targetId: null,
      },
    ],
    relations: [relation('ab-1', a, b), relation('ab-2', a, b)],
    managedIssueIds,
  })

  assert.deepEqual(result.errors, [
    'HON-202 -> HON-203: 2 duplicate relations',
    'AUTH-2A -> AUTH-2D: relation endpoint missing',
  ])
})

test('rejects unexpected and reversed active relations touching managed issues', () => {
  const external = issue('external', 'HON-10')
  const result = auditBlockRelations({
    expectedPairs,
    relations: [
      relation('ab', a, b),
      relation('ac', a, c),
      relation('reverse', b, a),
      relation('outgoing', c, external),
    ],
    managedIssueIds,
  })

  assert.deepEqual(result.errors, [
    'HON-203 -> HON-202: 1 unexpected managed relation',
    'HON-204 -> HON-10: 1 unexpected managed relation',
  ])
})

test('deduplicates inverse readback by id and ignores archived relations', () => {
  const ab = relation('ab', a, b)
  const result = auditBlockRelations({
    expectedPairs,
    relations: [
      ab,
      { ...ab },
      relation('ac', a, c),
      relation('archived-reverse', b, a, '2026-07-18T00:00:00.000Z'),
    ],
    managedIssueIds,
  })

  assert.deepEqual(result.errors, [])
})

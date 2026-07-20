import assert from 'node:assert/strict'
import test from 'node:test'

import { auditHon207BlockRelations } from './hon-207-relation-audit.mjs'

const issue = (id, identifier) => ({ id, identifier })
const relation = (id, source, target, archivedAt = null) => ({
  id,
  type: 'blocks',
  archivedAt,
  issue: source,
  relatedIssue: target,
})

const first = issue('managed-first', 'HON-219')
const second = issue('managed-second', 'HON-220')
const external = issue('external', 'HON-10')
const expectedPairs = [
  {
    blocker: first.identifier,
    blocked: second.identifier,
    sourceId: first.id,
    targetId: second.id,
  },
]
const managedIssueIds = new Set([first.id, second.id])

test('rejects active block relations in either direction across the managed boundary', () => {
  const result = auditHon207BlockRelations({
    expectedPairs,
    relations: [
      relation('expected', first, second),
      relation('managed-outbound', second, external),
      relation('managed-inbound', external, first),
    ],
    managedIssueIds,
  })

  assert.deepEqual(result.errors, [
    'HON-10 -> HON-219: unexpected relation',
    'HON-220 -> HON-10: unexpected relation',
  ])
  assert.deepEqual(
    result.unexpectedRows.map(({ blocker, blocked }) => ({
      blocker,
      blocked,
    })),
    [
      { blocker: 'HON-10', blocked: 'HON-219' },
      { blocker: 'HON-220', blocked: 'HON-10' },
    ],
  )
})

test('deduplicates inverse readback and ignores archived or unrelated relations', () => {
  const expected = relation('expected', first, second)
  const result = auditHon207BlockRelations({
    expectedPairs,
    relations: [
      expected,
      { ...expected },
      relation(
        'archived-external',
        second,
        external,
        '2026-07-20T00:00:00.000Z',
      ),
      relation('unrelated', external, issue('other', 'HON-11')),
    ],
    managedIssueIds,
  })

  assert.deepEqual(result.errors, [])
  assert.equal(result.rows[0].count, 1)
  assert.deepEqual(result.unexpectedRows, [])
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  accountCredentialPlan,
  canonicalMarker,
} from './account-credential-manifest.mjs'
import {
  buildExpectedRelationPairs,
  discoverManagedChildren,
  selectWorkflowStates,
} from './account-credential-linear-core.mjs'

const definition = accountCredentialPlan.issues[0]

test('discovers only a unique canonical marker and rejects title adoption', () => {
  const canonical = issue({
    id: 'canonical',
    identifier: 'HON-202',
    title: definition.title,
    description: canonicalMarker(definition),
  })

  assert.equal(
    discoverManagedChildren([canonical], [definition], {
      requireAll: true,
    }).issueByKey.get(definition.key).id,
    canonical.id,
  )

  assert.deepEqual(
    discoverManagedChildren(
      [issue({ id: 'collision', title: definition.title })],
      [definition],
      { requireAll: false },
    ).errors,
    [
      `${definition.key}: exact title exists without the canonical marker; manual reconciliation is required`,
    ],
  )
})

test('rejects duplicate markers and marker-title drift', () => {
  const duplicate = [
    issue({ id: 'one', description: canonicalMarker(definition) }),
    issue({ id: 'two', description: canonicalMarker(definition) }),
  ]
  assert.deepEqual(
    discoverManagedChildren(duplicate, [definition], { requireAll: true })
      .errors,
    [`${definition.key}: canonical marker appears on 2 issues`],
  )

  const drift = issue({
    id: 'drift',
    title: 'drifted title',
    description: canonicalMarker(definition),
  })
  assert.deepEqual(
    discoverManagedChildren([drift], [definition], { requireAll: true }).errors,
    [
      `${definition.key}: marker is on ${drift.identifier} with a non-canonical title`,
    ],
  )
})

test('selects exactly named Todo and In Progress workflow states', () => {
  assert.deepEqual(
    selectWorkflowStates([
      { id: 'backlog', name: 'Backlog', type: 'backlog' },
      { id: 'todo', name: 'Todo', type: 'unstarted' },
      { id: 'started', name: 'In Progress', type: 'started' },
    ]),
    {
      unstarted: { id: 'todo', name: 'Todo', type: 'unstarted' },
      started: { id: 'started', name: 'In Progress', type: 'started' },
    },
  )
  assert.throws(
    () =>
      selectWorkflowStates([{ id: 'started', name: 'Doing', type: 'started' }]),
    /Todo and In Progress states are required/,
  )
})

test('builds all nine resolved directed relation pairs', () => {
  const issueByKey = new Map(
    accountCredentialPlan.issues.map((item, index) => [
      item.key,
      issue({
        id: `id-${index}`,
        identifier: `HON-${202 + index}`,
        title: item.title,
        description: canonicalMarker(item),
      }),
    ]),
  )
  const pairs = buildExpectedRelationPairs(accountCredentialPlan, issueByKey)

  assert.equal(pairs.length, 9)
  assert.deepEqual(pairs.at(-1), {
    blocker: 'HON-206',
    blocked: 'HON-207',
    sourceId: 'id-4',
    targetId: 'id-5',
  })
})

function issue(overrides = {}) {
  return {
    id: 'issue-id',
    identifier: 'HON-999',
    title: definition.title,
    description: '',
    priority: 0,
    archivedAt: null,
    parent: { id: 'parent-id', identifier: 'HON-160' },
    project: { id: 'project-id', name: accountCredentialPlan.projectName },
    state: { id: 'state-id', name: 'Todo', type: 'unstarted' },
    ...overrides,
  }
}

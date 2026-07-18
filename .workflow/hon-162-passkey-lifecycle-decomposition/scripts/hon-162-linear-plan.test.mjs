import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canonicalMarker,
  plan,
  renderDescription,
  renderGuardedDescription,
} from '../results/hon-162-linear-plan.mjs'

const expectedKeys = [
  'AUTH-4A',
  'AUTH-4B',
  'AUTH-4C',
  'AUTH-4D',
  'AUTH-4E',
  'AUTH-4F',
  'AUTH-4G',
]

const expectedEdges = [
  ['AUTH-4A', 'AUTH-4B'],
  ['AUTH-4B', 'AUTH-4C'],
  ['AUTH-4B', 'AUTH-4D'],
  ['AUTH-4C', 'AUTH-4E'],
  ['AUTH-4D', 'AUTH-4E'],
  ['AUTH-4E', 'AUTH-4F'],
  ['AUTH-4F', 'AUTH-4G'],
]

test('defines one bounded ordered child set under HON-162', () => {
  assert.equal(plan.parent.identifier, 'HON-162')
  assert.equal(plan.linear.childStateName, 'Todo')
  assert.equal(plan.linear.parentStateName, 'In Progress')
  assert.equal(plan.linear.priority, 0)
  assert.deepEqual(
    plan.children.map((child) => child.key),
    expectedKeys,
  )

  const titles = new Set(plan.children.map((child) => child.title))
  assert.equal(titles.size, plan.children.length)

  for (const child of plan.children) {
    assert.match(child.title, /^WebAuthn A4\.[1-7]: /)
    assert.ok(child.goal.length > 60)
    assert.ok(child.scope.length >= 3)
    assert.ok(child.acceptance.length >= 3)
    assert.ok(child.rollback.length > 80)
    assert.ok(child.evidence.length > 80)
    assert.match(canonicalMarker(child), new RegExp(child.key))
    assert.ok(renderGuardedDescription(child).includes(canonicalMarker(child)))
    assert.ok(renderDescription(child).includes(canonicalMarker(child)))
  }
})

test('defines the intended acyclic blocks graph', () => {
  const keys = new Set(expectedKeys)
  const actualEdges = plan.children.flatMap((child) =>
    child.blockers.map((blocker) => [blocker, child.key]),
  )
  assert.deepEqual(actualEdges, expectedEdges)

  const dependencies = new Map(
    plan.children.map((child) => [child.key, child.blockers]),
  )
  const visiting = new Set()
  const visited = new Set()

  const visit = (key) => {
    assert.ok(keys.has(key), `unknown dependency key: ${key}`)
    assert.ok(!visiting.has(key), `cycle includes ${key}`)
    if (visited.has(key)) {
      return
    }
    visiting.add(key)
    for (const blocker of dependencies.get(key)) {
      visit(blocker)
    }
    visiting.delete(key)
    visited.add(key)
  }

  for (const key of keys) {
    visit(key)
  }
  assert.equal(visited.size, keys.size)
})

test('keeps runtime and live evidence after source implementation', () => {
  const sourceIntegration = plan.children.find(
    (child) => child.key === 'AUTH-4F',
  )
  const liveEvidence = plan.children.find((child) => child.key === 'AUTH-4G')

  assert.deepEqual(sourceIntegration.blockers, ['AUTH-4E'])
  assert.deepEqual(liveEvidence.blockers, ['AUTH-4F'])
  assert.match(sourceIntegration.goal, /without claiming live client support/i)
  assert.match(liveEvidence.scope.join('\n'), /explicit runtime approval/i)
  assert.match(liveEvidence.rollback, /password login/i)
})

test('renders final dependency identifiers without changing markers', () => {
  const identifiers = Object.fromEntries(
    expectedKeys.map((key, index) => [key, `HON-${300 + index}`]),
  )
  const management = plan.children.find((child) => child.key === 'AUTH-4E')
  const rendered = renderDescription(management, identifiers)

  assert.match(rendered, /Blocked by HON-302, HON-303/)
  assert.ok(rendered.endsWith(canonicalMarker(management)))
  assert.doesNotMatch(rendered, /LINEAR_API_KEY|HONOWARDEN_TOKEN_SECRET/)
})

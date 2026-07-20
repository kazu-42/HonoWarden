import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canonicalMarker,
  executionCheckpointMarker,
  hon206LinearPlan,
  renderChildDescription,
  renderExecutionCheckpoint,
  summarizePlan,
  validatePlan,
} from './hon-206-linear-plan.mjs'

test('defines four serialized packets with unique managed markers', () => {
  validatePlan()
  const summary = summarizePlan()

  assert.equal(summary.parent, 'HON-206')
  assert.equal(summary.issues.length, 4)
  assert.deepEqual(summary.relations, [
    { blocker: 'ROT-1', blocked: 'ROT-2' },
    { blocker: 'ROT-2', blocked: 'ROT-3' },
    { blocker: 'ROT-3', blocked: 'ROT-4' },
  ])
  assert.equal(new Set(summary.issues.map((issue) => issue.marker)).size, 4)
  assert.equal(summary.issues[0].stateType, 'completed')
  assert.equal(summary.issues[1].stateType, 'started')
  assert.ok(
    summary.issues.slice(2).every((issue) => issue.stateType === 'unstarted'),
  )
})

test('renders exact child and parent managed markers once', () => {
  const identifiers = {
    'ROT-1': 'HON-301',
    'ROT-2': 'HON-302',
    'ROT-3': 'HON-303',
    'ROT-4': 'HON-304',
  }

  for (const definition of hon206LinearPlan.issues) {
    const description = renderChildDescription(definition, identifiers)
    assert.equal(description.split(canonicalMarker(definition)).length - 1, 1)
    assert.match(description, new RegExp(definition.packet))
  }

  const checkpoint = renderExecutionCheckpoint(identifiers)
  assert.equal(checkpoint.split(executionCheckpointMarker()).length - 1, 1)
  for (const identifier of Object.values(identifiers)) {
    assert.match(checkpoint, new RegExp(identifier))
  }
  assert.match(checkpoint, /folder envelope does not/)
  assert.match(checkpoint, /HON-301 .*Done/)
  assert.match(checkpoint, /HON-302 .*In Progress/)
  assert.match(checkpoint, /trash false/)
})

test('rejects unknown dependencies and cycles', () => {
  const unknown = structuredClone(hon206LinearPlan)
  unknown.issues[1].blockers = ['ROT-X']
  assert.throws(() => validatePlan(unknown), /unknown blocker/)

  const cyclic = structuredClone(hon206LinearPlan)
  cyclic.issues[0].blockers = ['ROT-4']
  assert.throws(() => validatePlan(cyclic), /dependency cycle/)
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canonicalHon221Marker,
  hon221LinearPlan,
  renderHon221ChildDescription,
  renderHon221ExecutionCheckpoint,
  summarizeHon221Plan,
  validateHon221Plan,
} from './hon-221-linear-plan.mjs'

test('defines three serialized recovery packets with one active entry', () => {
  validateHon221Plan()
  assert.equal(hon221LinearPlan.issues.length, 3)
  assert.deepEqual(
    hon221LinearPlan.issues.map((issue) => issue.stateType),
    ['started', 'unstarted', 'unstarted'],
  )
  assert.deepEqual(summarizeHon221Plan().relations, [
    { blocker: 'RECOVERY-1A', blocked: 'RECOVERY-1B' },
    { blocker: 'RECOVERY-1B', blocked: 'RECOVERY-1C' },
  ])
})

test('renders managed markers, live dependencies, and safety boundaries', () => {
  const identifiers = {
    'RECOVERY-1A': 'HON-224',
    'RECOVERY-1B': 'HON-225',
    'RECOVERY-1C': 'HON-226',
  }
  for (const definition of hon221LinearPlan.issues) {
    const body = renderHon221ChildDescription(definition, identifiers)
    assert.ok(body.startsWith(canonicalHon221Marker(definition)))
    assert.equal(body.match(/honowarden-managed:/g)?.length, 1)
    assert.match(body, /Safety boundary/)
    assert.match(body, /forward-only/)
    for (const blocker of definition.blockers) {
      assert.match(body, new RegExp(identifiers[blocker]))
    }
  }

  const checkpoint = renderHon221ExecutionCheckpoint(identifiers)
  assert.equal(
    checkpoint.match(/honowarden-managed:HON-221:execution-plan/g)?.length,
    1,
  )
  assert.match(checkpoint, /only RECOVERY-1A is active/)
  assert.match(checkpoint, /same restored D1\/R2 state/)
  assert.match(checkpoint, /merged-main CI/)
})

test('pins parent, project, labels, and implementation packet paths', () => {
  assert.equal(hon221LinearPlan.parentIdentifier, 'HON-221')
  assert.equal(
    hon221LinearPlan.parentId,
    '7f868193-8232-4d35-b905-f7c73515f889',
  )
  assert.equal(hon221LinearPlan.projectName, 'HonoWarden Post-Alpha Roadmap')
  assert.deepEqual(
    hon221LinearPlan.issues.map((issue) => issue.packet),
    [
      '03a-generation-bound-backup',
      '03b-fresh-restore',
      '03c-disable-forward-recovery',
    ],
  )
  for (const label of [
    'type:feature',
    'area:auth',
    'area:ops',
    'risk:security',
    'evidence:required',
    'agent:codex',
  ]) {
    assert.ok(hon221LinearPlan.labels.includes(label))
  }
})

test('rejects invalid active count, unknown dependencies, and cycles', () => {
  const noActive = globalThis.structuredClone(hon221LinearPlan)
  noActive.issues[0].stateType = 'unstarted'
  assert.throws(
    () => validateHon221Plan(noActive),
    /exactly one started packet/,
  )

  const unknown = globalThis.structuredClone(hon221LinearPlan)
  unknown.issues[1].blockers = ['MISSING']
  assert.throws(() => validateHon221Plan(unknown), /unknown blocker/)

  const cyclic = globalThis.structuredClone(hon221LinearPlan)
  cyclic.issues[0].blockers = ['RECOVERY-1C']
  assert.throws(() => validateHon221Plan(cyclic), /dependency cycle/)
})

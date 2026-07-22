import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canonicalHon222Marker,
  hon222LinearPlan,
  renderHon222ChildDescription,
  renderHon222ExecutionCheckpoint,
  summarizeHon222Plan,
  validateHon222Plan,
} from './hon-222-linear-plan.mjs'

test('defines three serialized evidence packets with one active entry', () => {
  validateHon222Plan()
  assert.deepEqual(
    hon222LinearPlan.issues.map((issue) => issue.stateType),
    ['started', 'unstarted', 'unstarted'],
  )
  assert.deepEqual(summarizeHon222Plan().relations, [
    { blocker: 'EVIDENCE-1A', blocked: 'EVIDENCE-1B' },
    { blocker: 'EVIDENCE-1B', blocked: 'EVIDENCE-1C' },
  ])
})

test('pins exact parent, children, labels, and workflow packets', () => {
  assert.equal(hon222LinearPlan.parentIdentifier, 'HON-222')
  assert.equal(
    hon222LinearPlan.parentId,
    '0879badf-b4b1-4c56-9da5-64d6fb71a994',
  )
  assert.deepEqual(
    hon222LinearPlan.issues.map((issue) => issue.identifier),
    ['HON-227', 'HON-228', 'HON-229'],
  )
  assert.deepEqual(
    hon222LinearPlan.issues.map((issue) => issue.packet),
    [
      '04a-evidence-contract',
      '04b-closeout-packet-secret-scan',
      '04c-docs-index-reconciliation',
    ],
  )
  for (const issue of hon222LinearPlan.issues) {
    assert.ok(issue.labels.includes('evidence:required'))
    assert.ok(issue.labels.includes('risk:security'))
    assert.ok(issue.labels.includes('agent:codex'))
  }
})

test('renders exact managed descriptions and checkpoint dependencies', () => {
  const identifiers = Object.fromEntries(
    hon222LinearPlan.issues.map((issue) => [issue.key, issue.identifier]),
  )
  for (const definition of hon222LinearPlan.issues) {
    const body = renderHon222ChildDescription(definition, identifiers)
    assert.ok(body.startsWith(canonicalHon222Marker(definition)))
    assert.equal(body.match(/honowarden-managed:/g)?.length, 1)
    assert.match(body, /Safety boundary/)
    assert.match(body, /Evidence levels must remain conservative/)
    for (const blocker of definition.blockers) {
      assert.match(body, new RegExp(identifiers[blocker]))
    }
  }

  const checkpoint = renderHon222ExecutionCheckpoint(identifiers)
  assert.equal(
    checkpoint.match(/honowarden-managed:HON-222:execution-plan/g)?.length,
    1,
  )
  assert.match(checkpoint, /only EVIDENCE-1A is active/)
  assert.match(checkpoint, /HON-227 ->|HON-227 \(EVIDENCE-1A\)/)
  assert.match(checkpoint, /lower-level artifact can never satisfy/)
  assert.match(checkpoint, /merged-main CI/)
})

test('rejects invalid active count, unknown blockers, duplicate identity, and cycles', () => {
  const noActive = globalThis.structuredClone(hon222LinearPlan)
  noActive.issues[0].stateType = 'unstarted'
  assert.throws(
    () => validateHon222Plan(noActive),
    /exactly one started packet/,
  )

  const unknown = globalThis.structuredClone(hon222LinearPlan)
  unknown.issues[1].blockers = ['MISSING']
  assert.throws(() => validateHon222Plan(unknown), /unknown blocker/)

  const duplicate = globalThis.structuredClone(hon222LinearPlan)
  duplicate.issues[1].id = duplicate.issues[0].id
  assert.throws(() => validateHon222Plan(duplicate), /duplicate issue id/)

  const cyclic = globalThis.structuredClone(hon222LinearPlan)
  cyclic.issues[0].blockers = ['EVIDENCE-1C']
  assert.throws(() => validateHon222Plan(cyclic), /dependency cycle/)
})

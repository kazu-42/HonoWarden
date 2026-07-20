import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canonicalMarker,
  hon207LinearPlan,
  renderChildDescription,
  renderExecutionCheckpoint,
  summarizePlan,
  validatePlan,
} from './hon-207-linear-plan.mjs'

test('defines five serialized packets with one active entry', () => {
  validatePlan()
  assert.equal(hon207LinearPlan.issues.length, 5)
  assert.deepEqual(
    hon207LinearPlan.issues.map((issue) => issue.stateType),
    ['started', 'unstarted', 'unstarted', 'unstarted', 'unstarted'],
  )
  assert.equal(summarizePlan().relations.length, 4)
  assert.deepEqual(
    hon207LinearPlan.issues.map((issue) => issue.packet),
    [
      '01-official-client-harness',
      '02-credential-lifecycle',
      '03-recovery-restore',
      '04-compatibility-evidence',
      '05-review-closeout',
    ],
  )
})

test('pins exact commits and release asset digests', () => {
  const pins = hon207LinearPlan.sourcePins
  for (const pin of [pins.server, pins.web, pins.browser, pins.cli]) {
    assert.match(pin, /@[0-9a-f]{40}$/)
  }
  for (const digest of Object.values(pins.assets)) {
    assert.match(digest, /^[0-9a-f]{64}$/)
  }
  assert.equal(pins.base, 'a68ec0ccf0c5379ce228dce93f4f8eef05f6d6f3')
})

test('renders exact managed markers, dependencies, and safety boundaries', () => {
  const identifiers = Object.fromEntries(
    hon207LinearPlan.issues.map((issue, index) => [
      issue.key,
      `HON-${219 + index}`,
    ]),
  )
  for (const definition of hon207LinearPlan.issues) {
    const body = renderChildDescription(definition, identifiers)
    assert.equal(body.match(/honowarden-managed:/g)?.length, 1)
    assert.ok(body.startsWith(canonicalMarker(definition)))
    assert.match(body, /Safety boundary/)
    assert.match(body, /forward generation/)
    for (const blocker of definition.blockers) {
      assert.match(body, new RegExp(identifiers[blocker]))
    }
  }

  const checkpoint = renderExecutionCheckpoint(identifiers)
  assert.equal(
    checkpoint.match(/<!-- honowarden-managed:HON-207:execution-plan -->/g)
      ?.length,
    1,
  )
  assert.match(checkpoint, /local official-client/)
  assert.match(checkpoint, /normal Brave/i)
  assert.match(checkpoint, /trash false/)
})

test('rejects unknown dependencies and cycles', () => {
  const unknown = globalThis.structuredClone(hon207LinearPlan)
  unknown.issues[1].blockers = ['MISSING']
  assert.throws(() => validatePlan(unknown), /unknown blocker/)

  const cyclic = globalThis.structuredClone(hon207LinearPlan)
  cyclic.issues[0].blockers = ['CLOSE-1']
  assert.throws(() => validatePlan(cyclic), /dependency cycle/)
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  advanceLinearPlanVerificationStatus,
  assertArchivedPacketsPresent,
  assertImmutableArchivedPacket,
  canonicalMarker,
  hon207LinearPlan,
  renderChildDescription,
  renderExecutionCheckpoint,
  summarizePlan,
  validatePlan,
} from './hon-207-linear-plan.mjs'

test('advances initial Linear sync status without downgrading later verification', () => {
  assert.equal(
    advanceLinearPlanVerificationStatus('plan_authored'),
    'linear_subissues_synced',
  )
  assert.equal(
    advanceLinearPlanVerificationStatus(
      'official_client_harness_verification_passed_review_pending',
    ),
    'official_client_harness_verification_passed_review_pending',
  )
  assert.equal(
    advanceLinearPlanVerificationStatus('future_closeout_status'),
    'future_closeout_status',
  )
})

test('defines five serialized packets with only CLOSE-1 active', () => {
  validatePlan()
  assert.equal(hon207LinearPlan.issues.length, 5)
  assert.deepEqual(
    hon207LinearPlan.issues.map((issue) => issue.stateType),
    ['completed', 'completed', 'completed', 'completed', 'started'],
  )
  assert.deepEqual(
    hon207LinearPlan.issues.map((issue) => issue.archivedAt ?? null),
    [
      '2026-07-20T10:10:30.198Z',
      '2026-07-21T04:28:10.664Z',
      '2026-07-22T02:41:53.724Z',
      '2026-07-28T06:14:05.262Z',
      null,
    ],
  )
  assert.equal(summarizePlan().relations.length, 4)
  assert.deepEqual(summarizePlan().activeRelations, [])
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
  assert.match(checkpoint, /CLOSE-1 is the only active child/)
  assert.match(checkpoint, /HON-222.*2026-07-28T06:14:05\.262Z/)
})

test('rejects unknown dependencies and cycles', () => {
  const unknown = globalThis.structuredClone(hon207LinearPlan)
  unknown.issues[1].blockers = ['MISSING']
  assert.throws(() => validatePlan(unknown), /unknown blocker/)

  const cyclic = globalThis.structuredClone(hon207LinearPlan)
  cyclic.issues[0].blockers = ['CLOSE-1']
  assert.throws(() => validatePlan(cyclic), /dependency cycle/)

  const noActive = globalThis.structuredClone(hon207LinearPlan)
  noActive.issues[4].stateType = 'unstarted'
  assert.throws(() => validatePlan(noActive), /exactly one started packet/)

  const archivedActive = globalThis.structuredClone(hon207LinearPlan)
  archivedActive.issues[4].archivedAt = '2026-07-28T00:00:00.000Z'
  assert.throws(() => validatePlan(archivedActive), /active packet.*archived/)
})

test('refuses to recreate a missing completed and archived packet', () => {
  const discovered = new Map([
    ['CLOSE-1', { identifier: 'HON-223', archivedAt: null }],
  ])

  assert.throws(
    () => assertArchivedPacketsPresent(discovered),
    /CLIENT-1: completed archived packet is missing/,
  )
})

test('rejects completed archived packet drift before any Linear mutation', () => {
  const definition = hon207LinearPlan.issues[0]
  const identifiers = Object.fromEntries(
    hon207LinearPlan.issues.map((issue, index) => [
      issue.key,
      `HON-${219 + index}`,
    ]),
  )
  const expectedDescription = renderChildDescription(definition, identifiers)
  const exact = {
    title: definition.title,
    description: expectedDescription,
    archivedAt: definition.archivedAt,
    state: { id: 'done-state-id', type: 'completed' },
    parent: { id: 'hon-207-id' },
    project: { id: 'roadmap-id' },
    priority: hon207LinearPlan.priority,
  }
  const options = {
    definition,
    issue: exact,
    expectedDescription,
    expectedStateId: 'done-state-id',
    parentId: 'hon-207-id',
    projectId: 'roadmap-id',
    priority: hon207LinearPlan.priority,
  }

  assert.doesNotThrow(() => assertImmutableArchivedPacket(options))
  assert.throws(
    () =>
      assertImmutableArchivedPacket({
        ...options,
        issue: {
          ...exact,
          description: `${expectedDescription}\nunauthorized drift`,
          state: { id: 'different-done-state-id', type: 'completed' },
        },
      }),
    /CLIENT-1: archived managed issue drifted in description, state/,
  )
})

import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { URL } from 'node:url'

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
    ['completed', 'started', 'unstarted'],
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
  assert.deepEqual(hon222LinearPlan.issues[0].closeout, {
    archivedAt: '2026-07-22T10:11:52.647Z',
    pullRequest: 115,
    mergeCommit: '5b67fbdcf6d32942e5786f4cc49684c479778de8',
    mainCiRun: 29910713312,
    tree: '0297ca848869817cbec3e8f077cd61d313faf239',
  })
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
  assert.match(checkpoint, /EVIDENCE-1B is the only active child/)
  assert.match(checkpoint, /PR #115 was squash-merged/)
  assert.match(checkpoint, /HON-227 ->|HON-227 \(EVIDENCE-1A\)/)
  assert.match(checkpoint, /lower-level artifacts cannot satisfy/)
  assert.match(checkpoint, /merged-main CI/)
  assert.equal(checkpoint.endsWith('\n'), true)
  assert.equal(Buffer.byteLength(checkpoint), 1800)
  assert.equal(
    createHash('sha256').update(checkpoint).digest('hex'),
    '254cc8f9fb6e977bcba1c66ec34561870b54251708fa896ae7bdec3f844fdbee',
  )
})

test('pins current workflow state and Linear readback to EVIDENCE-1B', () => {
  const state = JSON.parse(
    readFileSync(new URL('../state.json', import.meta.url), 'utf8'),
  )
  const readback = JSON.parse(
    readFileSync(
      new URL('../results/hon-222-linear-plan-readback.json', import.meta.url),
      'utf8',
    ),
  )
  const evidencePacket = state.packets.find(
    (packet) => packet.id === '04-compatibility-evidence',
  )

  assert.equal(state.active_packet, '04b-closeout-packet-secret-scan')
  assert.deepEqual(
    evidencePacket.subpackets.map((packet) => [
      packet.linear,
      packet.status,
      packet.result,
    ]),
    [
      ['HON-227', 'completed', 'results/04a-evidence-contract.md'],
      ['HON-228', 'in_progress', 'results/04b-closeout-packet-secret-scan.md'],
      ['HON-229', 'pending', null],
    ],
  )
  assert.deepEqual(
    readback.issues.map((issue) => [
      issue.identifier,
      issue.state,
      issue.archivedAt !== null,
    ]),
    [
      ['HON-227', 'Done', true],
      ['HON-228', 'In Progress', false],
      ['HON-229', 'Todo', false],
    ],
  )
  assert.deepEqual(readback.checkpoint, {
    id: '0aead33f-61bd-4223-afd3-cb1c4a382008',
    createdAt: '2026-07-22T02:46:54.160Z',
    updatedAt: '2026-07-22T10:13:58.591Z',
    bytes: 1800,
    sha256: '254cc8f9fb6e977bcba1c66ec34561870b54251708fa896ae7bdec3f844fdbee',
  })
})

test('rejects invalid active count, unknown blockers, duplicate identity, and cycles', () => {
  const noActive = globalThis.structuredClone(hon222LinearPlan)
  noActive.issues[1].stateType = 'unstarted'
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

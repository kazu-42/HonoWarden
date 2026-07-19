import assert from 'node:assert/strict'
import test from 'node:test'

import {
  renderSourceReadyCheckpoint,
  sourceReadyCheckpointIdentity,
  sourceReadyCommentMarker,
} from './auth-2a-source-ready-checkpoint.mjs'

test('renders one deterministic source-ready checkpoint', () => {
  const body = renderSourceReadyCheckpoint()
  const identity = sourceReadyCheckpointIdentity(body)

  assert.ok(body.startsWith(sourceReadyCommentMarker))
  assert.equal(body, renderSourceReadyCheckpoint())
  assert.ok(identity.bytes > 1_000)
  assert.match(identity.sha256, /^[a-f0-9]{64}$/)
})

test('records complete evidence without claiming publication or completion', () => {
  const body = renderSourceReadyCheckpoint()

  assert.match(body, /HON-202 remains In Progress/)
  assert.match(body, /80 files, 787 tests passed/)
  assert.match(body, /17 workflow Node tests/)
  assert.match(body, /Fresh local D1 smoke passed/)
  assert.match(body, /no actionable findings/)
  assert.match(body, /No commit, PR, CI, merge, main-branch readback, deploy/)
  assert.match(body, /HON-203 through HON-205 remain blocked/)
})

test('keeps credentials and private evidence out of the checkpoint', () => {
  const body = renderSourceReadyCheckpoint()

  assert.doesNotMatch(body, /Bearer\s/i)
  assert.doesNotMatch(body, /LINEAR_API_KEY/)
  assert.doesNotMatch(body, /@[a-z0-9.-]+\.[a-z]{2,}/i)
  assert.doesNotMatch(body, /plaintext vault|unwrapped key/i)
})

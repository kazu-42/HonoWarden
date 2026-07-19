import assert from 'node:assert/strict'
import test from 'node:test'

import {
  accountCredentialPlan,
  canonicalMarker,
  renderChildDescription,
  renderDecompositionCheckpoint,
  renderParentDescription,
  summarizePlan,
  validatePlan,
} from './account-credential-manifest.mjs'

const identifiers = {
  'AUTH-2A': 'HON-202',
  'AUTH-2B': 'HON-203',
  'AUTH-2C': 'HON-204',
  'AUTH-2D': 'HON-205',
  'AUTH-2E': 'HON-206',
  'AUTH-2F': 'HON-207',
}

const clonePlan = (plan) => JSON.parse(JSON.stringify(plan))

test('defines six bounded children and nine acyclic block relations', () => {
  assert.doesNotThrow(() => validatePlan(accountCredentialPlan))
  assert.deepEqual(summarizePlan(accountCredentialPlan), {
    status: 'valid',
    parent: 'HON-160',
    issueCount: 6,
    startedCount: 1,
    blockRelationCount: 9,
    sourcePins: accountCredentialPlan.sourcePins,
  })
  assert.deepEqual(
    accountCredentialPlan.issues.map((issue) => issue.key),
    ['AUTH-2A', 'AUTH-2B', 'AUTH-2C', 'AUTH-2D', 'AUTH-2E', 'AUTH-2F'],
  )
  assert.deepEqual(
    accountCredentialPlan.issues
      .filter((issue) => issue.stateType === 'started')
      .map((issue) => issue.key),
    ['AUTH-2A'],
  )
})

test('renders every child with canonical ownership and evidence boundaries', () => {
  for (const issue of accountCredentialPlan.issues) {
    const description = renderChildDescription(issue, identifiers)

    assert.match(description, /^## Goal\n/)
    assert.match(description, /## Scope/)
    assert.match(description, /## Acceptance criteria/)
    assert.match(description, /## Dependencies/)
    assert.match(description, /## Rollback and safety/)
    assert.match(description, /## Evidence/)
    assert.match(description, /No real credentials, plaintext vault data/)
    assert.ok(description.endsWith(canonicalMarker(issue)))
  }
})

test('renders parent execution map and delegates initial password setting', () => {
  const description = renderParentDescription(identifiers)

  assert.match(description, /HON-202.*mutation foundation/)
  assert.match(description, /HON-203.*password verification and change/)
  assert.match(description, /HON-204.*KDF mutation/)
  assert.match(description, /HON-205.*keypair/)
  assert.match(description, /HON-206.*user-key rotation/)
  assert.match(description, /HON-207.*closeout/)
  assert.match(description, /HON-159 owns initial password setting/)
  assert.match(description, /HON-160 -> HON-164/)
  assert.match(description, /HonoWarden capability roadmap key: `AUTH-2`\./)
})

test('renders a deterministic planning checkpoint without completion claims', () => {
  const body = renderDecompositionCheckpoint(identifiers)

  assert.match(
    body,
    /^<!-- honowarden-managed:HON-160:decomposition-checkpoint -->/,
  )
  assert.match(body, /HON-202 is In Progress/)
  assert.match(body, /HON-203 through HON-207 remain Todo/)
  assert.match(
    body,
    /No product source, migration, runtime, or production state/,
  )
  assert.match(body, /GitHub publication remains a separate approval gate/)
})

test('rejects duplicate keys, unknown blockers, and blocker cycles', () => {
  const duplicate = clonePlan(accountCredentialPlan)
  duplicate.issues[1].key = duplicate.issues[0].key
  assert.throws(() => validatePlan(duplicate), /duplicate or empty key/)

  const unknown = clonePlan(accountCredentialPlan)
  unknown.issues[1].blockers = ['AUTH-UNKNOWN']
  assert.throws(() => validatePlan(unknown), /unknown blocker/)

  const cycle = clonePlan(accountCredentialPlan)
  cycle.issues[0].blockers = ['AUTH-2F']
  assert.throws(() => validatePlan(cycle), /blocker cycle/)
})

test('rejects incomplete issue contracts and invalid state layout', () => {
  const incomplete = clonePlan(accountCredentialPlan)
  incomplete.issues[0].acceptance = []
  assert.throws(() => validatePlan(incomplete), /incomplete issue contract/)

  const noStarted = clonePlan(accountCredentialPlan)
  for (const issue of noStarted.issues) {
    issue.stateType = 'unstarted'
  }
  assert.throws(() => validatePlan(noStarted), /exactly AUTH-2A must start/)
})

/* global Buffer, fetch, process */

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { canonicalMarker, plan } from '../results/hon-162-linear-plan.mjs'

const workflowRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const canonicalPath = path.join(
  workflowRoot,
  'results/hon-162-linear-readback.json',
)
const outputPath = path.join(
  workflowRoot,
  'results/hon-162-linear-independent-readback.json',
)
const endpoint = 'https://api.linear.app/graphql'
const apiKey = process.env.LINEAR_API_KEY?.trim()

// eslint-disable-next-line no-control-regex
if (!apiKey || /[\u0000-\u001f\u007f]/.test(apiKey)) {
  throw new Error('a valid LINEAR_API_KEY is required')
}

const expected = JSON.parse(await readFile(canonicalPath, 'utf8'))
if (
  expected.status !== 'exact' ||
  expected.phase !== 'apply' ||
  expected.children.length !== plan.children.length ||
  expected.relations.length !== expected.expectedBlockRelations
) {
  throw new Error('canonical HON-162 apply readback is not exact and complete')
}

const inventory = await readInventory()
const issueById = new Map(inventory.map((issue) => [issue.id, issue]))
const errors = []
const childRows = []

const parent = issueById.get(expected.parent.id)
const parentChecks = {
  identity:
    parent?.id === plan.parent.id &&
    parent?.identifier === plan.parent.identifier,
  title: parent?.title === plan.parent.title,
  descriptionBytes:
    Buffer.byteLength(parent?.description ?? '', 'utf8') ===
    expected.parent.descriptionBytes,
  descriptionSha256:
    sha256(parent?.description ?? '') === expected.parent.descriptionSha256,
  project: parent?.project?.id === plan.linear.projectId,
  state: parent?.state?.id === plan.linear.parentStateId,
  priority: parent?.priority === plan.linear.priority,
  nonArchived: parent?.archivedAt === null,
}
for (const [name, passed] of Object.entries(parentChecks)) {
  if (!passed) errors.push(`${plan.parent.identifier}: ${name} mismatch`)
}

for (const expectedChild of expected.children) {
  const issue = issueById.get(expectedChild.id)
  const definition = plan.children.find(
    (child) => child.key === expectedChild.key,
  )
  if (!issue || !definition) {
    errors.push(`${expectedChild.key}: live issue or definition missing`)
    continue
  }
  const markerMatches = inventory.filter((candidate) =>
    candidate.description?.includes(canonicalMarker(definition)),
  )
  const titleMatches = inventory.filter(
    (candidate) => candidate.title === definition.title,
  )
  const checks = {
    markerIdentity:
      markerMatches.length === 1 && markerMatches[0].id === issue.id,
    titleIdentity: titleMatches.length === 1 && titleMatches[0].id === issue.id,
    title: issue.title === expectedChild.title,
    descriptionBytes:
      Buffer.byteLength(issue.description ?? '', 'utf8') ===
      expectedChild.descriptionBytes,
    descriptionSha256:
      sha256(issue.description ?? '') === expectedChild.descriptionSha256,
    parent: issue.parent?.id === plan.parent.id,
    project: issue.project?.id === plan.linear.projectId,
    state: issue.state?.id === plan.linear.childStateId,
    priority: issue.priority === plan.linear.priority,
    nonArchived: issue.archivedAt === null,
  }
  for (const [name, passed] of Object.entries(checks)) {
    if (!passed) errors.push(`${expectedChild.key}: ${name} mismatch`)
  }
  childRows.push({
    key: expectedChild.key,
    id: issue.id,
    identifier: issue.identifier,
    checks,
  })
}

const managedIds = new Set(expected.children.map((child) => child.id))
const relations = await readManagedRelations(managedIds)
const activeBlocks = relations.filter(
  (relation) => relation.archivedAt === null && relation.type === 'blocks',
)
const expectedDirections = new Set()
const relationRows = []

for (const expectedRelation of expected.relations) {
  const blocker = inventory.find(
    (issue) => issue.identifier === expectedRelation.blocker,
  )
  const blocked = inventory.find(
    (issue) => issue.identifier === expectedRelation.blocked,
  )
  if (!blocker || !blocked) {
    errors.push(
      `${expectedRelation.blocker} -> ${expectedRelation.blocked}: endpoint missing`,
    )
    continue
  }
  const direction = `${blocker.id}->${blocked.id}`
  expectedDirections.add(direction)
  const matches = activeBlocks.filter(
    (relation) =>
      `${relation.issue.id}->${relation.relatedIssue.id}` === direction,
  )
  if (matches.length !== 1) {
    errors.push(
      `${expectedRelation.blocker} -> ${expectedRelation.blocked}: expected 1 relation, found ${matches.length}`,
    )
  }
  if (
    JSON.stringify(matches.map((relation) => relation.id).sort()) !==
    JSON.stringify(expectedRelation.relationIds)
  ) {
    errors.push(
      `${expectedRelation.blocker} -> ${expectedRelation.blocked}: relation identity drift`,
    )
  }
  relationRows.push({
    blocker: expectedRelation.blocker,
    blocked: expectedRelation.blocked,
    count: matches.length,
    relationIds: matches.map((relation) => relation.id).sort(),
  })
}

const unexpectedRelations = activeBlocks
  .filter((relation) => {
    const direction = `${relation.issue.id}->${relation.relatedIssue.id}`
    return (
      (managedIds.has(relation.issue.id) ||
        managedIds.has(relation.relatedIssue.id)) &&
      !expectedDirections.has(direction)
    )
  })
  .map((relation) => ({
    id: relation.id,
    blocker: relation.issue.identifier,
    blocked: relation.relatedIssue.identifier,
  }))
if (unexpectedRelations.length > 0) {
  errors.push(
    `${unexpectedRelations.length} unexpected active blocks relations touch HON-162 children`,
  )
}

const activeChildren = inventory.filter(
  (issue) => issue.parent?.id === plan.parent.id && issue.archivedAt === null,
)
const unexpectedChildren = activeChildren
  .filter((issue) => !managedIds.has(issue.id))
  .map((issue) => issue.identifier)
if (unexpectedChildren.length > 0) {
  errors.push(
    `unexpected active children under ${plan.parent.identifier}: ${unexpectedChildren.join(', ')}`,
  )
}

const inventorySummary = summarizeInventory(inventory)
if (JSON.stringify(inventorySummary) !== JSON.stringify(expected.inventory)) {
  errors.push('inventory summary drifted after canonical apply readback')
}

const readback = {
  generatedAt: new Date().toISOString(),
  status: errors.length === 0 ? 'exact' : 'mismatch',
  inventory: inventorySummary,
  parent: {
    id: parent?.id ?? null,
    identifier: parent?.identifier ?? null,
    checks: parentChecks,
  },
  expectedChildren: plan.children.length,
  verifiedChildren: childRows.filter((row) =>
    Object.values(row.checks).every(Boolean),
  ).length,
  expectedBlockRelations: expected.expectedBlockRelations,
  verifiedBlockRelations: relationRows.filter((row) => row.count === 1).length,
  unexpectedBlockRelations: unexpectedRelations.length,
  unexpectedChildren,
  children: childRows,
  relations: relationRows,
  unexpectedRelations,
  errors,
}

await writeFile(outputPath, `${JSON.stringify(readback, null, 2)}\n`)
console.log(
  JSON.stringify(
    {
      status: readback.status,
      generatedAt: readback.generatedAt,
      inventory: readback.inventory,
      parent: readback.parent.identifier,
      identifiers: readback.children.map((child) => child.identifier),
      verifiedChildren: readback.verifiedChildren,
      verifiedBlockRelations: readback.verifiedBlockRelations,
      unexpectedBlockRelations: readback.unexpectedBlockRelations,
      errors: readback.errors,
      output: outputPath,
    },
    null,
    2,
  ),
)
if (errors.length > 0) process.exitCode = 1

async function readInventory() {
  const query = `query ReadIndependentHon162Inventory($teamId: ID!, $after: String) {
    issues(
      filter: { team: { id: { eq: $teamId } } }
      first: 100
      after: $after
      includeArchived: true
    ) {
      nodes {
        id identifier title description priority archivedAt
        parent { id identifier }
        project { id name }
        state { id name type }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`
  const issues = []
  let after = null
  do {
    const data = await request(query, { teamId: plan.linear.teamId, after })
    issues.push(...data.issues.nodes)
    after = data.issues.pageInfo.hasNextPage
      ? data.issues.pageInfo.endCursor
      : null
  } while (after)
  return issues
}

async function readManagedRelations(managedIds) {
  const byId = new Map()
  for (const issueId of managedIds) {
    for (const relation of await readRelations(issueId)) {
      const existing = byId.get(relation.id)
      if (
        existing &&
        relationSignature(existing) !== relationSignature(relation)
      ) {
        throw new Error(`relation ${relation.id} has conflicting endpoints`)
      }
      byId.set(relation.id, relation)
    }
  }
  return [...byId.values()]
}

async function readRelations(issueId) {
  const query = `query ReadIndependentHon162Relations(
    $id: String!
    $outgoingAfter: String
    $incomingAfter: String
  ) {
    issue(id: $id) {
      relations(first: 100, after: $outgoingAfter) {
        nodes {
          id type archivedAt
          issue { id identifier }
          relatedIssue { id identifier }
        }
        pageInfo { hasNextPage endCursor }
      }
      inverseRelations(first: 100, after: $incomingAfter) {
        nodes {
          id type archivedAt
          issue { id identifier }
          relatedIssue { id identifier }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`
  const relations = []
  let outgoingAfter = null
  let incomingAfter = null
  let readOutgoing = true
  let readIncoming = true
  do {
    const data = await request(query, {
      id: issueId,
      outgoingAfter,
      incomingAfter,
    })
    if (!data.issue) throw new Error(`relation issue missing: ${issueId}`)
    if (readOutgoing) {
      relations.push(...data.issue.relations.nodes)
      readOutgoing = data.issue.relations.pageInfo.hasNextPage
      outgoingAfter = readOutgoing
        ? data.issue.relations.pageInfo.endCursor
        : null
    }
    if (readIncoming) {
      relations.push(...data.issue.inverseRelations.nodes)
      readIncoming = data.issue.inverseRelations.pageInfo.hasNextPage
      incomingAfter = readIncoming
        ? data.issue.inverseRelations.pageInfo.endCursor
        : null
    }
  } while (readOutgoing || readIncoming)
  return relations
}

async function request(query, variables) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })
  const payload = await response.json()
  if (!response.ok || payload.errors) {
    const messages = payload.errors?.map((error) => error.message) ?? [
      `HTTP ${response.status}`,
    ]
    throw new Error(messages.join('; '))
  }
  return payload.data
}

function summarizeInventory(inventory) {
  return {
    total: inventory.length,
    archived: inventory.filter((issue) => issue.archivedAt !== null).length,
    activeUnarchived: inventory.filter(
      (issue) =>
        issue.archivedAt === null &&
        !['completed', 'canceled'].includes(issue.state?.type),
    ).length,
    completedUnarchived: inventory.filter(
      (issue) => issue.archivedAt === null && issue.state?.type === 'completed',
    ).length,
  }
}

function relationSignature(relation) {
  return [
    relation.type,
    relation.issue.id,
    relation.relatedIssue.id,
    relation.archivedAt ?? '',
  ].join(':')
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

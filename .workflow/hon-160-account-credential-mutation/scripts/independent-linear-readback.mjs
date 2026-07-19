import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  accountCredentialPlan,
  canonicalMarker,
  renderChildDescription,
  renderDecompositionCheckpoint,
  renderParentDescription,
  validatePlan,
} from './account-credential-manifest.mjs'

const endpoint = 'https://api.linear.app/graphql'
const commentMarker =
  '<!-- honowarden-managed:HON-160:decomposition-checkpoint -->'
const workflowRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const outputPath = path.join(
  workflowRoot,
  'results',
  'linear-decomposition-independent-readback.json',
)
const apiKey = process.env.LINEAR_API_KEY?.trim()

validatePlan(accountCredentialPlan)
if (!apiKey || [...apiKey].some(isControlCharacter)) {
  throw new Error('a valid LINEAR_API_KEY is required')
}

const parent = await readParent()
const inventory = await readInventory(parent.team.id)
const { children, errors: discoveryErrors } = discoverChildren(inventory)
const identifiers = Object.fromEntries(
  [...children].map(([key, issue]) => [key, issue.identifier]),
)
const errors = [...discoveryErrors]
const childRows = verifyChildren(children, identifiers, parent, errors)
const parentChecks = verifyParent(parent, identifiers, errors)
const relationResult = await verifyRelations(children, errors)
const commentResult = await verifyComment(parent.id, identifiers, errors)

const artifact = {
  generatedAt: new Date().toISOString(),
  mode: 'read-only-independent-graphql',
  status: errors.length === 0 ? 'exact' : 'mismatch',
  inventory: summarizeInventory(inventory),
  parent: {
    identifier: parent.identifier,
    id: parent.id,
    state: parent.state,
    descriptionBytes: byteLength(parent.description),
    descriptionSha256: sha256(parent.description ?? ''),
    checks: parentChecks,
  },
  expectedChildren: accountCredentialPlan.issues.length,
  verifiedChildren: childRows.length,
  issues: childRows,
  expectedBlockRelations: expectedRelations().length,
  verifiedBlockRelations: relationResult.rows.filter((row) => row.exact).length,
  unexpectedBlockRelations: relationResult.unexpected.length,
  relations: relationResult.rows,
  unexpectedRelations: relationResult.unexpected,
  managedComment: commentResult,
  errors,
}

await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
console.log(
  JSON.stringify(
    {
      status: artifact.status,
      generatedAt: artifact.generatedAt,
      inventory: artifact.inventory,
      parentState: artifact.parent.state,
      identifiers,
      verifiedChildren: artifact.verifiedChildren,
      verifiedBlockRelations: artifact.verifiedBlockRelations,
      unexpectedBlockRelations: artifact.unexpectedBlockRelations,
      managedComment: artifact.managedComment,
      errors,
      output: outputPath,
    },
    null,
    2,
  ),
)
if (errors.length > 0) {
  process.exitCode = 1
}

function discoverChildren(issues) {
  const children = new Map()
  const errors = []

  for (const definition of accountCredentialPlan.issues) {
    const marker = canonicalMarker(definition)
    const markerMatches = issues.filter((issue) =>
      issue.description?.includes(marker),
    )
    const titleMatches = issues.filter(
      (issue) => issue.title === definition.title,
    )
    if (markerMatches.length !== 1) {
      errors.push(
        `${definition.key}: expected one canonical marker, found ${markerMatches.length}`,
      )
      continue
    }
    if (
      titleMatches.length !== 1 ||
      titleMatches[0].id !== markerMatches[0].id
    ) {
      errors.push(
        `${definition.key}: canonical title is not unique on marker issue`,
      )
      continue
    }
    children.set(definition.key, markerMatches[0])
  }

  return { children, errors }
}

function verifyChildren(children, identifiers, parent, errors) {
  const rows = []
  for (const definition of accountCredentialPlan.issues) {
    const issue = children.get(definition.key)
    if (!issue) {
      continue
    }
    const expectedState =
      definition.stateType === 'started'
        ? { name: 'In Progress', type: 'started' }
        : { name: 'Todo', type: 'unstarted' }
    const expectedDescription = renderChildDescription(definition, identifiers)
    const checks = {
      title: issue.title === definition.title,
      description: issue.description === expectedDescription,
      descriptionSha256:
        sha256(issue.description ?? '') === sha256(expectedDescription),
      marker: issue.description?.includes(canonicalMarker(definition)) === true,
      parent:
        issue.parent?.id === parent.id &&
        issue.parent?.identifier === parent.identifier,
      project:
        issue.project?.id === parent.project.id &&
        issue.project?.name === accountCredentialPlan.projectName,
      state:
        issue.state?.name === expectedState.name &&
        issue.state?.type === expectedState.type,
      priority: issue.priority === accountCredentialPlan.priority,
      nonArchived: issue.archivedAt === null,
    }
    recordFailures(errors, definition.key, checks)
    rows.push({
      key: definition.key,
      identifier: issue.identifier,
      id: issue.id,
      state: issue.state,
      descriptionBytes: byteLength(issue.description),
      descriptionSha256: sha256(issue.description ?? ''),
      checks,
    })
  }
  return rows
}

function verifyParent(parent, identifiers, errors) {
  const expectedDescription = renderParentDescription(identifiers)
  const checks = {
    identifier: parent.identifier === accountCredentialPlan.parentIdentifier,
    title:
      parent.title ===
      'Account slice A2: password, KDF, keys, and security-stamp mutation',
    description: parent.description === expectedDescription,
    descriptionSha256:
      sha256(parent.description ?? '') === sha256(expectedDescription),
    project: parent.project?.name === accountCredentialPlan.projectName,
    state:
      parent.state?.name === 'In Progress' && parent.state?.type === 'started',
    priority: parent.priority === accountCredentialPlan.priority,
    nonArchived: parent.archivedAt === null,
    capabilityMarker:
      parent.description?.includes(
        'HonoWarden capability roadmap key: `AUTH-2`.',
      ) === true,
  }
  recordFailures(errors, accountCredentialPlan.parentIdentifier, checks)
  return checks
}

async function verifyRelations(children, errors) {
  const byId = new Map()
  for (const issue of children.values()) {
    const relations = [
      ...(await readRelationConnection(issue.id, 'relations')),
      ...(await readRelationConnection(issue.id, 'inverseRelations')),
    ]
    for (const relation of relations) {
      byId.set(relation.id, relation)
    }
  }

  const activeBlocks = [...byId.values()].filter(
    (relation) => relation.archivedAt == null && relation.type === 'blocks',
  )
  const expected = expectedRelations()
  const expectedDirections = new Set()
  const rows = []
  for (const pair of expected) {
    const source = children.get(pair.blocker)
    const target = children.get(pair.blocked)
    if (!source || !target) {
      errors.push(`${pair.blocker} -> ${pair.blocked}: endpoint missing`)
      continue
    }
    const direction = `${source.id}->${target.id}`
    expectedDirections.add(direction)
    const matches = activeBlocks.filter(
      (relation) =>
        relation.issue.id === source.id &&
        relation.relatedIssue.id === target.id,
    )
    const exact = matches.length === 1
    if (!exact) {
      errors.push(
        `${pair.blocker} -> ${pair.blocked}: expected one block relation, found ${matches.length}`,
      )
    }
    rows.push({
      blocker: source.identifier,
      blocked: target.identifier,
      exact,
      relationIds: matches.map((relation) => relation.id).sort(),
    })
  }

  const managedIds = new Set([...children.values()].map((issue) => issue.id))
  const unexpected = activeBlocks
    .filter((relation) => {
      const touchesManaged =
        managedIds.has(relation.issue.id) ||
        managedIds.has(relation.relatedIssue.id)
      const direction = `${relation.issue.id}->${relation.relatedIssue.id}`
      return touchesManaged && !expectedDirections.has(direction)
    })
    .map((relation) => ({
      id: relation.id,
      blocker: relation.issue.identifier,
      blocked: relation.relatedIssue.identifier,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  for (const relation of unexpected) {
    errors.push(
      `${relation.blocker} -> ${relation.blocked}: unexpected block relation ${relation.id}`,
    )
  }

  return { rows, unexpected }
}

async function verifyComment(parentId, identifiers, errors) {
  const comments = await readComments(parentId)
  const managed = comments.filter((comment) =>
    comment.body?.startsWith(commentMarker),
  )
  const expectedBody = renderDecompositionCheckpoint(identifiers)
  const comment = managed[0] ?? null
  const checks = {
    singleManagedComment: managed.length === 1,
    body: comment?.body === expectedBody,
    bytes: byteLength(comment?.body) === byteLength(expectedBody),
    sha256: sha256(comment?.body ?? '') === sha256(expectedBody),
  }
  recordFailures(errors, 'managed checkpoint', checks)
  return {
    id: comment?.id ?? null,
    updatedAt: comment?.updatedAt ?? null,
    bytes: byteLength(comment?.body),
    sha256: sha256(comment?.body ?? ''),
    checks,
  }
}

function expectedRelations() {
  return accountCredentialPlan.issues.flatMap((issue) =>
    issue.blockers.map((blocker) => ({ blocker, blocked: issue.key })),
  )
}

function recordFailures(errors, subject, checks) {
  for (const [name, passed] of Object.entries(checks)) {
    if (!passed) {
      errors.push(`${subject}: ${name} mismatch`)
    }
  }
}

async function readParent() {
  const data = await request(
    `query IndependentCredentialParent($id: String!) {
      issue(id: $id) {
        id identifier title description priority archivedAt
        project { id name }
        state { id name type }
        team { id name }
      }
    }`,
    { id: accountCredentialPlan.parentIdentifier },
  )
  if (!data.issue) {
    throw new Error('HON-160 was not found')
  }
  return data.issue
}

async function readInventory(teamId) {
  const query = `query IndependentCredentialInventory($teamId: ID!, $after: String) {
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
  let hasNextPage = true
  const seenCursors = new Set()
  while (hasNextPage) {
    const data = await request(query, { teamId, after })
    issues.push(...data.issues.nodes)
    hasNextPage = data.issues.pageInfo.hasNextPage
    if (!hasNextPage) {
      break
    }
    const next = data.issues.pageInfo.endCursor
    if (!next || seenCursors.has(next)) {
      throw new Error('invalid Linear inventory cursor')
    }
    seenCursors.add(next)
    after = next
  }
  return issues
}

async function readRelationConnection(issueId, connectionName) {
  if (!['relations', 'inverseRelations'].includes(connectionName)) {
    throw new Error(`unsupported relation connection: ${connectionName}`)
  }
  const query = `query IndependentCredentialRelations($id: String!, $after: String) {
    issue(id: $id) {
      ${connectionName}(first: 50, after: $after) {
        nodes {
          id type archivedAt
          issue { id identifier }
          relatedIssue { id identifier }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`
  return readIssueConnection({ issueId, connectionName, query })
}

async function readComments(issueId) {
  const connectionName = 'comments'
  const query = `query IndependentCredentialComments($id: String!, $after: String) {
    issue(id: $id) {
      comments(first: 100, after: $after) {
        nodes { id body updatedAt }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`
  return readIssueConnection({ issueId, connectionName, query })
}

async function readIssueConnection({ issueId, connectionName, query }) {
  const nodes = []
  const seenCursors = new Set()
  let after = null
  let hasNextPage = true
  while (hasNextPage) {
    const data = await request(query, { id: issueId, after })
    const connection = data.issue?.[connectionName]
    if (!connection) {
      throw new Error(`${connectionName} missing for issue ${issueId}`)
    }
    nodes.push(...connection.nodes)
    hasNextPage = connection.pageInfo.hasNextPage
    if (!hasNextPage) {
      break
    }
    const next = connection.pageInfo.endCursor
    if (!next || seenCursors.has(next)) {
      throw new Error(`invalid ${connectionName} cursor for issue ${issueId}`)
    }
    seenCursors.add(next)
    after = next
  }
  return nodes
}

async function request(query, variables) {
  const response = await globalThis.fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })
  const rawBody = await response.text()
  let payload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    throw new Error(`Linear returned non-JSON HTTP ${response.status}`)
  }
  if (!response.ok || payload.errors) {
    const messages = payload.errors?.map((error) => error.message) ?? [
      `HTTP ${response.status}`,
    ]
    throw new Error(
      `Linear independent readback failed: ${messages.join('; ')}`,
    )
  }
  if (!payload.data) {
    throw new Error('Linear independent readback returned no data')
  }
  return payload.data
}

function summarizeInventory(issues) {
  return {
    total: issues.length,
    archived: issues.filter((issue) => issue.archivedAt !== null).length,
    activeUnarchived: issues.filter(
      (issue) => issue.archivedAt === null && issue.state.type !== 'completed',
    ).length,
    completedUnarchived: issues.filter(
      (issue) => issue.archivedAt === null && issue.state.type === 'completed',
    ).length,
  }
}

function byteLength(value) {
  return Buffer.byteLength(value ?? '', 'utf8')
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function isControlCharacter(character) {
  const code = character.charCodeAt(0)
  return code <= 31 || code === 127
}

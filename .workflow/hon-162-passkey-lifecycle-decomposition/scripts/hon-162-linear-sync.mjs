/* global Buffer, fetch, process */

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  canonicalMarker,
  plan,
  renderDescription,
  renderGuardedDescription,
} from '../results/hon-162-linear-plan.mjs'

const workflowRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const resultDirectory = path.join(workflowRoot, 'results')
const jsonPath = path.join(resultDirectory, 'hon-162-linear-readback.json')
const markdownPath = path.join(resultDirectory, 'hon-162-linear-readback.md')
const endpoint = 'https://api.linear.app/graphql'
const mode = process.argv[2] ?? '--validate'
const allowedModes = new Set([
  '--validate',
  '--render',
  '--apply',
  '--readback',
])

if (!allowedModes.has(mode)) {
  throw new Error(`unsupported mode: ${mode}`)
}

validatePlan()

if (mode === '--validate') {
  console.log(
    JSON.stringify(
      {
        status: 'valid',
        parent: plan.parent.identifier,
        children: plan.children.length,
        blockRelations: expectedRelationKeys().size,
        firstChild: plan.children[0].key,
        lastChild: plan.children.at(-1).key,
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

if (mode === '--render') {
  console.log(
    JSON.stringify(
      plan.children.map((child) => ({
        key: child.key,
        title: child.title,
        blockers: child.blockers,
        description: renderDescription(child),
      })),
      null,
      2,
    ),
  )
  process.exit(0)
}

const apiKey = process.env.LINEAR_API_KEY?.trim()
// eslint-disable-next-line no-control-regex
if (!apiKey || /[\u0000-\u001f\u007f]/.test(apiKey)) {
  throw new Error('a valid LINEAR_API_KEY is required')
}

if (mode === '--apply') {
  try {
    await applyPlan()
  } catch (error) {
    await writeFailureReadback(error)
    throw error
  }
} else {
  const verification = await verifyLiveState()
  await writeReadback(verification, 'readback')
  if (verification.errors.length > 0) {
    process.exitCode = 1
  }
}

async function applyPlan() {
  let inventory = await readInventory()
  const initial = discover(inventory, { requireAllChildren: false })
  assertNoErrors(initial.errors)
  assertParentBeforeApply(initial.parent)

  const missingCount = plan.children.length - initial.childByKey.size
  if (inventory.length + missingCount > 250) {
    throw new Error(
      `issue capacity exceeded: ${inventory.length} existing + ${missingCount} new`,
    )
  }

  for (const definition of plan.children) {
    const existing = initial.childByKey.get(definition.key)
    if (existing) {
      assertChildLocation(existing, definition)
      continue
    }

    const result = await mutate(
      `mutation CreateHon162Child($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier title }
        }
      }`,
      {
        input: {
          teamId: plan.linear.teamId,
          projectId: plan.linear.projectId,
          stateId: plan.linear.childStateId,
          priority: plan.linear.priority,
          parentId: plan.parent.id,
          title: definition.title,
          description: renderGuardedDescription(definition),
        },
      },
    )

    if (!result.issueCreate?.success || !result.issueCreate.issue) {
      throw new Error(`Linear did not create ${definition.key}`)
    }
  }

  inventory = await readInventory()
  const created = discover(inventory, { requireAllChildren: true })
  assertNoErrors(created.errors)
  assertParentBeforeApply(created.parent)
  for (const definition of plan.children) {
    assertChildLocation(created.childByKey.get(definition.key), definition)
  }

  const identifiers = Object.fromEntries(
    [...created.childByKey].map(([key, issue]) => [key, issue.identifier]),
  )

  for (const definition of plan.children) {
    const issue = created.childByKey.get(definition.key)
    const result = await mutate(
      `mutation FinalizeHon162Child($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
        }
      }`,
      {
        id: issue.id,
        input: {
          title: definition.title,
          description: renderDescription(definition, identifiers),
          projectId: plan.linear.projectId,
          stateId: plan.linear.childStateId,
          priority: plan.linear.priority,
          parentId: plan.parent.id,
        },
      },
    )
    if (!result.issueUpdate?.success) {
      throw new Error(`Linear did not finalize ${definition.key}`)
    }
  }

  inventory = await readInventory()
  const finalized = discover(inventory, { requireAllChildren: true })
  assertNoErrors(finalized.errors)
  await ensureRelations(finalized.childByKey)

  const parentUpdate = await mutate(
    `mutation StartHon162($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { success }
    }`,
    {
      id: plan.parent.id,
      input: { stateId: plan.linear.parentStateId },
    },
  )
  if (!parentUpdate.issueUpdate?.success) {
    throw new Error(`Linear did not move ${plan.parent.identifier} In Progress`)
  }

  const verification = await verifyLiveState()
  await writeReadback(verification, 'apply')
  assertNoErrors(verification.errors)
}

async function ensureRelations(childByKey) {
  const managedIds = new Set([...childByKey.values()].map((issue) => issue.id))
  const relations = await readManagedRelations(managedIds)
  const expected = expectedRelationDirections(childByKey)
  const activeBlocks = relations.filter(
    (relation) => relation.archivedAt === null && relation.type === 'blocks',
  )

  for (const relation of activeBlocks) {
    const direction = `${relation.issue.id}->${relation.relatedIssue.id}`
    if (!expected.has(direction)) {
      throw new Error(
        `unexpected relation touches HON-162 child: ${relation.issue.identifier} -> ${relation.relatedIssue.identifier}`,
      )
    }
  }

  for (const [direction, pair] of expected) {
    const matches = activeBlocks.filter(
      (relation) =>
        `${relation.issue.id}->${relation.relatedIssue.id}` === direction,
    )
    if (matches.length > 1) {
      throw new Error(
        `duplicate relation: ${pair.blocker.identifier} -> ${pair.blocked.identifier}`,
      )
    }
    if (matches.length === 1) {
      continue
    }

    const result = await mutate(
      `mutation CreateHon162Relation($input: IssueRelationCreateInput!) {
        issueRelationCreate(input: $input) {
          success
          issueRelation { id }
        }
      }`,
      {
        input: {
          type: 'blocks',
          issueId: pair.blocker.id,
          relatedIssueId: pair.blocked.id,
        },
      },
    )
    if (!result.issueRelationCreate?.success) {
      throw new Error(
        `Linear did not create ${pair.blocker.identifier} -> ${pair.blocked.identifier}`,
      )
    }
  }
}

async function verifyLiveState() {
  const inventory = await readInventory()
  const discovery = discover(inventory, { requireAllChildren: true })
  const errors = [...discovery.errors]
  const childRows = []
  const identifiers = Object.fromEntries(
    [...discovery.childByKey].map(([key, issue]) => [key, issue.identifier]),
  )

  if (discovery.parent) {
    const parentChecks = {
      id: discovery.parent.id === plan.parent.id,
      title: discovery.parent.title === plan.parent.title,
      project: discovery.parent.project?.id === plan.linear.projectId,
      state: discovery.parent.state?.id === plan.linear.parentStateId,
      priority: discovery.parent.priority === plan.linear.priority,
      nonArchived: discovery.parent.archivedAt === null,
    }
    for (const [name, passed] of Object.entries(parentChecks)) {
      if (!passed) {
        errors.push(`${plan.parent.identifier}: ${name} mismatch`)
      }
    }
    discovery.parent.checks = parentChecks
  }

  for (const definition of plan.children) {
    const issue = discovery.childByKey.get(definition.key)
    if (!issue) {
      continue
    }
    const expectedDescription = renderDescription(definition, identifiers)
    const markerMatches = inventory.filter((candidate) =>
      candidate.description?.includes(canonicalMarker(definition)),
    )
    const titleMatches = inventory.filter(
      (candidate) => candidate.title === definition.title,
    )
    const checks = {
      markerIdentity:
        markerMatches.length === 1 && markerMatches[0].id === issue.id,
      titleIdentity:
        titleMatches.length === 1 && titleMatches[0].id === issue.id,
      title: issue.title === definition.title,
      description: issue.description === expectedDescription,
      parent: issue.parent?.id === plan.parent.id,
      project: issue.project?.id === plan.linear.projectId,
      state: issue.state?.id === plan.linear.childStateId,
      priority: issue.priority === plan.linear.priority,
      nonArchived: issue.archivedAt === null,
    }
    for (const [name, passed] of Object.entries(checks)) {
      if (!passed) {
        errors.push(`${definition.key}: ${name} mismatch`)
      }
    }
    childRows.push({
      key: definition.key,
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      blockers: definition.blockers.map((key) => identifiers[key]),
      descriptionBytes: Buffer.byteLength(issue.description ?? '', 'utf8'),
      descriptionSha256: sha256(issue.description ?? ''),
      checks,
    })
  }

  const managedIds = new Set(childRows.map((row) => row.id))
  const relations = await readManagedRelations(managedIds)
  const expectedDirections = expectedRelationDirections(discovery.childByKey)
  const activeBlocks = relations.filter(
    (relation) => relation.archivedAt === null && relation.type === 'blocks',
  )
  const relationRows = []

  for (const [direction, pair] of expectedDirections) {
    const matches = activeBlocks.filter(
      (relation) =>
        `${relation.issue.id}->${relation.relatedIssue.id}` === direction,
    )
    if (matches.length !== 1) {
      errors.push(
        `${pair.blocker.identifier} -> ${pair.blocked.identifier}: expected 1 relation, found ${matches.length}`,
      )
    }
    relationRows.push({
      blocker: pair.blocker.identifier,
      blocked: pair.blocked.identifier,
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
  const managedChildIds = new Set(childRows.map((row) => row.id))
  const unexpectedChildren = activeChildren
    .filter((issue) => !managedChildIds.has(issue.id))
    .map((issue) => issue.identifier)
  if (unexpectedChildren.length > 0) {
    errors.push(
      `unexpected active children under ${plan.parent.identifier}: ${unexpectedChildren.join(', ')}`,
    )
  }

  return {
    generatedAt: new Date().toISOString(),
    status: errors.length === 0 ? 'exact' : 'mismatch',
    sourcePins: plan.sourcePins,
    inventory: summarizeInventory(inventory),
    parent: discovery.parent
      ? {
          id: discovery.parent.id,
          identifier: discovery.parent.identifier,
          title: discovery.parent.title,
          state: discovery.parent.state?.name ?? null,
          descriptionBytes: Buffer.byteLength(
            discovery.parent.description ?? '',
            'utf8',
          ),
          descriptionSha256: sha256(discovery.parent.description ?? ''),
          checks: discovery.parent.checks,
        }
      : null,
    expectedChildren: plan.children.length,
    verifiedChildren: childRows.filter((row) =>
      Object.values(row.checks).every(Boolean),
    ).length,
    expectedBlockRelations: expectedDirections.size,
    verifiedBlockRelations: relationRows.filter((row) => row.count === 1)
      .length,
    unexpectedBlockRelations: unexpectedRelations.length,
    unexpectedChildren,
    children: childRows,
    relations: relationRows,
    unexpectedRelations,
    errors,
  }
}

function discover(inventory, { requireAllChildren }) {
  const errors = []
  const parentMatches = inventory.filter(
    (issue) => issue.identifier === plan.parent.identifier,
  )
  const parent = parentMatches.length === 1 ? parentMatches[0] : null
  if (!parent) {
    errors.push(
      `${plan.parent.identifier}: expected one parent, found ${parentMatches.length}`,
    )
  }

  const childByKey = new Map()
  for (const definition of plan.children) {
    const marker = canonicalMarker(definition)
    const markerMatches = inventory.filter((issue) =>
      issue.description?.includes(marker),
    )
    const titleMatches = inventory.filter(
      (issue) => issue.title === definition.title,
    )
    if (markerMatches.length > 1) {
      errors.push(
        `${definition.key}: marker appears on ${markerMatches.length} issues`,
      )
      continue
    }
    if (markerMatches.length === 1) {
      const issue = markerMatches[0]
      if (issue.title !== definition.title) {
        errors.push(
          `${definition.key}: marker/title mismatch on ${issue.identifier}`,
        )
        continue
      }
      if (titleMatches.length !== 1 || titleMatches[0].id !== issue.id) {
        errors.push(`${definition.key}: title collision outside marker issue`)
        continue
      }
      childByKey.set(definition.key, issue)
      continue
    }
    if (titleMatches.length > 0) {
      errors.push(
        `${definition.key}: exact title exists without canonical marker`,
      )
      continue
    }
    if (requireAllChildren) {
      errors.push(`${definition.key}: canonical child is missing`)
    }
  }

  return { parent, childByKey, errors }
}

function assertParentBeforeApply(parent) {
  const errors = []
  if (!parent || parent.id !== plan.parent.id) errors.push('identity')
  if (parent?.title !== plan.parent.title) errors.push('title')
  if (parent?.project?.id !== plan.linear.projectId) errors.push('project')
  if (parent?.priority !== plan.linear.priority) errors.push('priority')
  if (parent?.archivedAt !== null) errors.push('archived')
  if (!['backlog', 'started'].includes(parent?.state?.type))
    errors.push('state')
  if (errors.length > 0) {
    throw new Error(`${plan.parent.identifier} drifted in ${errors.join(', ')}`)
  }
}

function assertChildLocation(issue, definition) {
  const errors = []
  if (!issue) errors.push('missing')
  if (issue?.parent?.id !== plan.parent.id) errors.push('parent')
  if (issue?.project?.id !== plan.linear.projectId) errors.push('project')
  if (issue?.state?.id !== plan.linear.childStateId) errors.push('state')
  if (issue?.priority !== plan.linear.priority) errors.push('priority')
  if (issue?.archivedAt !== null) errors.push('archived')
  if (errors.length > 0) {
    throw new Error(`${definition.key} drifted in ${errors.join(', ')}`)
  }
}

function validatePlan() {
  if (plan.children.length < 2) {
    throw new Error('HON-162 requires multiple children')
  }
  const keys = new Set()
  const titles = new Set()
  for (const childDefinition of plan.children) {
    if (!childDefinition.key || keys.has(childDefinition.key)) {
      throw new Error(`duplicate or empty key: ${childDefinition.key}`)
    }
    if (!childDefinition.title || titles.has(childDefinition.title)) {
      throw new Error(`duplicate or empty title: ${childDefinition.title}`)
    }
    if (
      !childDefinition.goal ||
      childDefinition.scope.length < 3 ||
      childDefinition.acceptance.length < 3 ||
      !childDefinition.rollback ||
      !childDefinition.evidence
    ) {
      throw new Error(`incomplete child contract: ${childDefinition.key}`)
    }
    keys.add(childDefinition.key)
    titles.add(childDefinition.title)
  }
  for (const childDefinition of plan.children) {
    for (const blocker of childDefinition.blockers) {
      if (!keys.has(blocker)) {
        throw new Error(`unknown blocker ${blocker} for ${childDefinition.key}`)
      }
      if (blocker === childDefinition.key) {
        throw new Error(`self blocker: ${childDefinition.key}`)
      }
    }
  }

  const visiting = new Set()
  const visited = new Set()
  const byKey = new Map(
    plan.children.map((childDefinition) => [
      childDefinition.key,
      childDefinition,
    ]),
  )
  const visit = (key) => {
    if (visiting.has(key)) throw new Error(`blocks cycle includes ${key}`)
    if (visited.has(key)) return
    visiting.add(key)
    for (const blocker of byKey.get(key).blockers) visit(blocker)
    visiting.delete(key)
    visited.add(key)
  }
  for (const key of keys) visit(key)
}

function expectedRelationKeys() {
  return new Set(
    plan.children.flatMap((childDefinition) =>
      childDefinition.blockers.map(
        (blocker) => `${blocker}->${childDefinition.key}`,
      ),
    ),
  )
}

function expectedRelationDirections(childByKey) {
  const directions = new Map()
  for (const definition of plan.children) {
    const blocked = childByKey.get(definition.key)
    for (const blockerKey of definition.blockers) {
      const blocker = childByKey.get(blockerKey)
      if (!blocker || !blocked) continue
      directions.set(`${blocker.id}->${blocked.id}`, { blocker, blocked })
    }
  }
  return directions
}

async function readInventory() {
  const query = `query ReadHon162Inventory($teamId: ID!, $after: String) {
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
  const query = `query ReadHon162Relations(
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

async function mutate(query, variables) {
  return request(query, variables)
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

async function writeReadback(readback, phase) {
  const output = { ...readback, phase }
  await mkdir(resultDirectory, { recursive: true })
  await writeFile(jsonPath, `${JSON.stringify(output, null, 2)}\n`)
  await writeFile(markdownPath, renderReadbackMarkdown(output))
  console.log(
    JSON.stringify(
      {
        status: output.status,
        phase,
        generatedAt: output.generatedAt,
        inventory: output.inventory,
        parent: output.parent?.identifier ?? null,
        verifiedChildren: output.verifiedChildren,
        verifiedBlockRelations: output.verifiedBlockRelations,
        unexpectedBlockRelations: output.unexpectedBlockRelations,
        errors: output.errors,
        output: [jsonPath, markdownPath],
      },
      null,
      2,
    ),
  )
}

async function writeFailureReadback(error) {
  const failure = {
    generatedAt: new Date().toISOString(),
    status: 'apply-failed',
    phase: 'apply',
    sourcePins: plan.sourcePins,
    inventory: null,
    parent: null,
    expectedChildren: plan.children.length,
    verifiedChildren: 0,
    expectedBlockRelations: expectedRelationKeys().size,
    verifiedBlockRelations: 0,
    unexpectedBlockRelations: null,
    unexpectedChildren: [],
    children: [],
    relations: [],
    unexpectedRelations: [],
    errors: [errorMessage(error)],
  }
  await mkdir(resultDirectory, { recursive: true })
  await writeFile(jsonPath, `${JSON.stringify(failure, null, 2)}\n`)
  await writeFile(markdownPath, renderReadbackMarkdown(failure))
}

function renderReadbackMarkdown(readback) {
  const childLines = readback.children
    .map(
      (child) =>
        `- ${child.identifier} (${child.key}): ${child.descriptionBytes} bytes, SHA-256 \`${child.descriptionSha256}\`.`,
    )
    .join('\n')
  const relationLines = readback.relations
    .map((relation) => `- ${relation.blocker} blocks ${relation.blocked}.`)
    .join('\n')
  return `# HON-162 Linear Readback

- Status: \`${readback.status}\`
- Phase: \`${readback.phase}\`
- Generated: \`${readback.generatedAt}\`
- Parent: \`${readback.parent?.identifier ?? 'unverified'}\`
- Children: \`${readback.verifiedChildren}/${readback.expectedChildren}\`
- Required blocks: \`${readback.verifiedBlockRelations}/${readback.expectedBlockRelations}\`
- Unexpected blocks: \`${readback.unexpectedBlockRelations ?? 'unverified'}\`

## Children

${childLines || '- No verified children.'}

## Relations

${relationLines || '- No verified relations.'}

## Errors

${readback.errors.map((error) => `- ${error}`).join('\n') || '- None.'}
`
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

function assertNoErrors(errors) {
  if (errors.length > 0) throw new Error(errors.join('; '))
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  canonicalMarker,
  executionCheckpointMarker,
  hon206LinearPlan,
  renderChildDescription,
  renderExecutionCheckpoint,
  summarizePlan,
  validatePlan,
} from './hon-206-linear-plan.mjs'

const endpoint = 'https://api.linear.app/graphql'
const mode = process.argv[2] ?? '--render'
const allowedModes = new Set(['--render', '--apply', '--verify'])
const workflowRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const resultDirectory = path.join(workflowRoot, 'results')
const jsonOutputPath = path.join(resultDirectory, 'linear-plan-readback.json')
const markdownOutputPath = path.join(resultDirectory, 'linear-plan-readback.md')
const statePath = path.join(workflowRoot, 'state.json')

if (!allowedModes.has(mode)) {
  throw new Error(`unsupported mode: ${mode}`)
}
validatePlan()

if (mode === '--render') {
  const identifiers = Object.fromEntries(
    hon206LinearPlan.issues.map((issue) => [issue.key, issue.key]),
  )
  console.log(
    JSON.stringify(
      {
        plan: summarizePlan(),
        checkpoint: renderExecutionCheckpoint(identifiers),
        descriptions: hon206LinearPlan.issues.map((issue) => ({
          key: issue.key,
          body: renderChildDescription(issue, identifiers),
        })),
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

const apiKey = process.env.LINEAR_API_KEY?.trim()
if (!apiKey || [...apiKey].some(isControlCharacter)) {
  throw new Error('a valid LINEAR_API_KEY is required')
}

try {
  const before = await readContext(false)
  if (mode === '--apply') {
    await applyPlan(before)
  }
  const verification = await verifyFinalState()
  await writeReadback(verification, mode.slice(2))
  if (verification.errors.length === 0) {
    await updateWorkflowState(verification.issueRows)
  } else {
    process.exitCode = 1
  }
} catch (error) {
  await writeFailureArtifact(error)
  throw error
}

async function applyPlan(before) {
  assertParent(before.parent)
  const workflowStates = selectWorkflowStates(before.parent.team.states.nodes)
  const discovery = discoverManagedChildren(before.inventory, false)
  if (discovery.errors.length > 0) {
    throw new Error(discovery.errors.join('; '))
  }

  const missingCount =
    hon206LinearPlan.issues.length - discovery.issueByKey.size
  if (before.inventory.length + missingCount > 250) {
    throw new Error(
      `issue capacity exceeded: ${before.inventory.length} existing + ${missingCount} new`,
    )
  }
  assertExistingChildrenMutable(
    discovery.issueByKey,
    before.parent,
    workflowStates,
  )

  let issueByKey = new Map(discovery.issueByKey)
  for (const definition of hon206LinearPlan.issues) {
    if (issueByKey.has(definition.key)) {
      continue
    }
    const identifiers = identifiersFor(issueByKey)
    const state = expectedState(definition, workflowStates)
    const data = await request(
      `mutation CreateRotationPacket($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id identifier title description priority archivedAt url
            parent { id identifier }
            project { id name }
            state { id name type }
          }
        }
      }`,
      {
        input: {
          teamId: before.parent.team.id,
          projectId: before.parent.project.id,
          parentId: before.parent.id,
          stateId: state.id,
          priority: hon206LinearPlan.priority,
          title: definition.title,
          description: renderChildDescription(definition, identifiers),
        },
      },
    )
    if (!data.issueCreate?.success || !data.issueCreate.issue) {
      throw new Error(`Linear did not create ${definition.key}`)
    }
    issueByKey.set(definition.key, data.issueCreate.issue)
  }

  const createdContext = await readContext(false)
  const createdDiscovery = discoverManagedChildren(
    createdContext.inventory,
    true,
  )
  if (createdDiscovery.errors.length > 0) {
    throw new Error(createdDiscovery.errors.join('; '))
  }
  issueByKey = createdDiscovery.issueByKey
  const identifiers = identifiersFor(issueByKey)

  for (const definition of hon206LinearPlan.issues) {
    const issue = requiredIssue(issueByKey, definition.key)
    const state = expectedState(definition, workflowStates)
    await updateIssue(issue.id, {
      title: definition.title,
      description: renderChildDescription(definition, identifiers),
      parentId: before.parent.id,
      projectId: before.parent.project.id,
      stateId: state.id,
      priority: hon206LinearPlan.priority,
    })
  }

  await ensureRelations(issueByKey)
  await syncManagedComment(
    before.parent.id,
    renderExecutionCheckpoint(identifiers),
  )
}

async function verifyFinalState() {
  const context = await readContext(true)
  const errors = []
  let workflowStates
  try {
    assertParent(context.parent)
    workflowStates = selectWorkflowStates(context.parent.team.states.nodes)
  } catch (error) {
    errors.push(errorMessage(error))
    return emptyVerification(context, errors)
  }

  const discovery = discoverManagedChildren(context.inventory, true)
  errors.push(...discovery.errors)
  const identifiers = identifiersFor(discovery.issueByKey)
  const issueRows = []

  for (const definition of hon206LinearPlan.issues) {
    const issue = discovery.issueByKey.get(definition.key)
    if (!issue) {
      continue
    }
    const state = expectedState(definition, workflowStates)
    const expectedDescription = renderChildDescription(definition, identifiers)
    const checks = {
      marker: issue.description?.includes(canonicalMarker(definition)) === true,
      title: issue.title === definition.title,
      description: issue.description === expectedDescription,
      parent: issue.parent?.id === context.parent.id,
      project: issue.project?.id === context.parent.project.id,
      state: issue.state?.id === state.id,
      priority: issue.priority === hon206LinearPlan.priority,
      nonArchived: issue.archivedAt === null,
    }
    for (const [name, passed] of Object.entries(checks)) {
      if (!passed) {
        errors.push(`${definition.key}: ${name} mismatch`)
      }
    }
    issueRows.push({
      key: definition.key,
      packet: definition.packet,
      identifier: issue.identifier,
      id: issue.id,
      url: issue.url,
      title: issue.title,
      state: issue.state,
      parent: issue.parent,
      project: issue.project,
      priority: issue.priority,
      archivedAt: issue.archivedAt,
      descriptionBytes: Buffer.byteLength(issue.description ?? '', 'utf8'),
      descriptionSha256: sha256(issue.description ?? ''),
      checks,
    })
  }

  const relationVerification = await verifyRelations(discovery.issueByKey)
  errors.push(...relationVerification.errors)
  const expectedComment = renderExecutionCheckpoint(identifiers)
  const comments = context.parentComments
  const managedComments = comments.filter((comment) =>
    comment.body?.startsWith(executionCheckpointMarker()),
  )
  const managedComment = managedComments[0] ?? null
  const commentChecks = {
    single: managedComments.length === 1,
    body: managedComment?.body === expectedComment,
    bytes:
      Buffer.byteLength(managedComment?.body ?? '', 'utf8') ===
      Buffer.byteLength(expectedComment, 'utf8'),
    sha256: sha256(managedComment?.body ?? '') === sha256(expectedComment),
  }
  for (const [name, passed] of Object.entries(commentChecks)) {
    if (!passed) {
      errors.push(`managed checkpoint: ${name} mismatch`)
    }
  }

  return {
    ...context,
    workflowStates,
    identifiers,
    issueRows,
    relationRows: relationVerification.rows,
    unexpectedRelationRows: relationVerification.unexpectedRows,
    managedComment,
    commentChecks,
    errors,
  }
}

async function readContext(includeComments) {
  const parent = await readParent()
  const [inventory, parentComments] = await Promise.all([
    readInventory(parent.team.id),
    includeComments ? readAllComments(parent.id) : Promise.resolve([]),
  ])
  return { parent, inventory, parentComments }
}

async function readParent() {
  const data = await request(
    `query ReadRotationParent($id: String!) {
      issue(id: $id) {
        id identifier title description priority archivedAt url
        parent { id identifier }
        project { id name }
        state { id name type }
        team {
          id name
          states(first: 100) {
            nodes { id name type }
            pageInfo { hasNextPage }
          }
        }
      }
    }`,
    { id: hon206LinearPlan.parentIdentifier },
  )
  if (!data.issue) {
    throw new Error('HON-206 was not found')
  }
  if (data.issue.team.states.pageInfo.hasNextPage) {
    throw new Error('Linear workflow state list exceeds 100 entries')
  }
  return data.issue
}

async function readInventory(teamId) {
  const issues = []
  let after = null
  do {
    const data = await request(
      `query ReadRotationInventory($teamId: ID!, $after: String) {
        issues(
          filter: { team: { id: { eq: $teamId } } }
          first: 100
          after: $after
          includeArchived: true
        ) {
          nodes {
            id identifier title description priority archivedAt url
            parent { id identifier }
            project { id name }
            state { id name type }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { teamId, after },
    )
    issues.push(...data.issues.nodes)
    after = data.issues.pageInfo.hasNextPage
      ? data.issues.pageInfo.endCursor
      : null
  } while (after)
  return issues
}

function discoverManagedChildren(inventory, requireAll) {
  const issueByKey = new Map()
  const errors = []
  for (const definition of hon206LinearPlan.issues) {
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
      if (
        issue.title !== definition.title ||
        titleMatches.length !== 1 ||
        titleMatches[0].id !== issue.id
      ) {
        errors.push(`${definition.key}: marker/title collision`)
        continue
      }
      issueByKey.set(definition.key, issue)
      continue
    }
    if (titleMatches.length > 0) {
      errors.push(
        `${definition.key}: exact title exists without managed marker`,
      )
      continue
    }
    if (requireAll) {
      errors.push(`${definition.key}: managed sub-issue is missing`)
    }
  }
  return { issueByKey, errors }
}

function assertParent(parent) {
  const checks = {
    id: parent.id === hon206LinearPlan.parentId,
    identifier: parent.identifier === hon206LinearPlan.parentIdentifier,
    title: parent.title === hon206LinearPlan.parentTitle,
    project: parent.project?.name === hon206LinearPlan.projectName,
    state: parent.state.type === 'started',
    priority: parent.priority === hon206LinearPlan.priority,
    nonArchived: parent.archivedAt === null,
  }
  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name)
  if (failures.length > 0) {
    throw new Error(`refusing HON-206 mutation: ${failures.join(', ')}`)
  }
}

function selectWorkflowStates(states) {
  const todo = states.filter(
    (state) => state.type === 'unstarted' && state.name === 'Todo',
  )
  const inProgress = states.filter(
    (state) => state.type === 'started' && state.name === 'In Progress',
  )
  if (todo.length !== 1 || inProgress.length !== 1) {
    throw new Error('exactly named Todo and In Progress states are required')
  }
  return { todo: todo[0], inProgress: inProgress[0] }
}

function expectedState(definition, workflowStates) {
  return definition.stateType === 'started'
    ? workflowStates.inProgress
    : workflowStates.todo
}

function assertExistingChildrenMutable(issueByKey, parent, workflowStates) {
  for (const definition of hon206LinearPlan.issues) {
    const issue = issueByKey.get(definition.key)
    if (!issue) {
      continue
    }
    const failures = []
    if (issue.archivedAt !== null) failures.push('archived')
    if (!['unstarted', 'started'].includes(issue.state.type)) {
      failures.push(`terminal state ${issue.state.type}`)
    }
    if (issue.parent?.id !== parent.id) failures.push('parent')
    if (issue.project?.id !== parent.project.id) failures.push('project')
    if (issue.priority !== hon206LinearPlan.priority) failures.push('priority')
    if (!expectedState(definition, workflowStates)?.id) {
      failures.push('workflow state')
    }
    if (failures.length > 0) {
      throw new Error(
        `${definition.key}: managed issue drifted in ${failures.join(', ')}`,
      )
    }
  }
}

async function ensureRelations(issueByKey) {
  const verification = await verifyRelations(issueByKey)
  const unsafe = verification.errors.filter(
    (error) => !error.endsWith(': relation missing'),
  )
  if (unsafe.length > 0) {
    throw new Error(`refusing relation reconciliation: ${unsafe.join('; ')}`)
  }

  for (const pair of expectedRelationPairs(issueByKey)) {
    const row = verification.rows.find(
      (candidate) =>
        candidate.sourceId === pair.sourceId &&
        candidate.targetId === pair.targetId,
    )
    if (row?.exact) {
      continue
    }
    const data = await request(
      `mutation CreateRotationRelation($input: IssueRelationCreateInput!) {
        issueRelationCreate(input: $input) {
          success
          issueRelation {
            id type archivedAt
            issue { id identifier }
            relatedIssue { id identifier }
          }
        }
      }`,
      {
        input: {
          type: 'blocks',
          issueId: pair.sourceId,
          relatedIssueId: pair.targetId,
        },
      },
    )
    if (!data.issueRelationCreate?.success) {
      throw new Error(
        `Linear did not create relation ${pair.blocker} -> ${pair.blocked}`,
      )
    }
  }
}

async function verifyRelations(issueByKey) {
  const expectedPairs = expectedRelationPairs(issueByKey)
  const managedIds = new Set([...issueByKey.values()].map((issue) => issue.id))
  const relationsById = new Map()
  for (const issue of issueByKey.values()) {
    for (const relation of await readRelationsTouchingIssue(issue.id)) {
      relationsById.set(relation.id, relation)
    }
  }
  const activeManagedBlocks = [...relationsById.values()].filter(
    (relation) =>
      relation.archivedAt === null &&
      relation.type === 'blocks' &&
      managedIds.has(relation.issue.id) &&
      managedIds.has(relation.relatedIssue.id),
  )
  const expectedKeys = new Set(
    expectedPairs.map((pair) => relationKey(pair.sourceId, pair.targetId)),
  )
  const rows = expectedPairs.map((pair) => {
    const matches = activeManagedBlocks.filter(
      (relation) =>
        relation.issue.id === pair.sourceId &&
        relation.relatedIssue.id === pair.targetId,
    )
    return { ...pair, count: matches.length, exact: matches.length === 1 }
  })
  const unexpectedRows = activeManagedBlocks
    .filter(
      (relation) =>
        !expectedKeys.has(
          relationKey(relation.issue.id, relation.relatedIssue.id),
        ),
    )
    .map((relation) => ({
      id: relation.id,
      blocker: relation.issue.identifier,
      blocked: relation.relatedIssue.identifier,
    }))
  const errors = rows
    .filter((row) => row.count !== 1)
    .map((row) =>
      row.count === 0
        ? `${row.blocker} -> ${row.blocked}: relation missing`
        : `${row.blocker} -> ${row.blocked}: duplicate relations`,
    )
  errors.push(
    ...unexpectedRows.map(
      (row) => `${row.blocker} -> ${row.blocked}: unexpected relation`,
    ),
  )
  return { rows, unexpectedRows, errors }
}

function expectedRelationPairs(issueByKey) {
  return hon206LinearPlan.issues.flatMap((definition) =>
    definition.blockers.map((blockerKey) => {
      const blocker = requiredIssue(issueByKey, blockerKey)
      const blocked = requiredIssue(issueByKey, definition.key)
      return {
        blocker: blocker.identifier,
        blocked: blocked.identifier,
        sourceId: blocker.id,
        targetId: blocked.id,
      }
    }),
  )
}

async function readRelationsTouchingIssue(issueId) {
  return [
    ...(await readRelationConnection(issueId, 'relations')),
    ...(await readRelationConnection(issueId, 'inverseRelations')),
  ]
}

async function readRelationConnection(issueId, connectionName) {
  if (!['relations', 'inverseRelations'].includes(connectionName)) {
    throw new Error(`unsupported relation connection: ${connectionName}`)
  }
  const relations = []
  const seenCursors = new Set()
  let after = null
  let hasNextPage = true
  while (hasNextPage) {
    const data = await request(
      `query ReadRotationRelations($id: String!, $after: String) {
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
      }`,
      { id: issueId, after },
    )
    const connection = data.issue?.[connectionName]
    if (!connection) {
      throw new Error(`${connectionName} missing for issue ${issueId}`)
    }
    relations.push(...connection.nodes)
    hasNextPage = connection.pageInfo.hasNextPage
    if (!hasNextPage) {
      break
    }
    const cursor = connection.pageInfo.endCursor
    if (!cursor || seenCursors.has(cursor)) {
      throw new Error(`invalid ${connectionName} cursor for ${issueId}`)
    }
    seenCursors.add(cursor)
    after = cursor
  }
  return relations
}

async function syncManagedComment(parentId, body) {
  const comments = await readAllComments(parentId)
  const managed = comments.filter((comment) =>
    comment.body?.startsWith(executionCheckpointMarker()),
  )
  if (managed.length > 1) {
    throw new Error(`duplicate managed HON-206 comments: ${managed.length}`)
  }
  if (managed.length === 1) {
    if (managed[0].body === body) {
      return
    }
    const data = await request(
      `mutation UpdateRotationCheckpoint($id: String!, $input: CommentUpdateInput!) {
        commentUpdate(id: $id, input: $input) {
          success
          comment { id body updatedAt }
        }
      }`,
      { id: managed[0].id, input: { body } },
    )
    if (
      !data.commentUpdate?.success ||
      data.commentUpdate.comment?.body !== body
    ) {
      throw new Error('Linear did not update the managed HON-206 comment')
    }
    return
  }
  const data = await request(
    `mutation CreateRotationCheckpoint($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        success
        comment { id body updatedAt }
      }
    }`,
    { input: { issueId: parentId, body } },
  )
  if (
    !data.commentCreate?.success ||
    data.commentCreate.comment?.body !== body
  ) {
    throw new Error('Linear did not create the managed HON-206 comment')
  }
}

async function readAllComments(issueId) {
  const comments = []
  const seenCursors = new Set()
  let after = null
  let hasNextPage = true
  while (hasNextPage) {
    const data = await request(
      `query ReadRotationComments($id: String!, $after: String) {
        issue(id: $id) {
          comments(first: 100, after: $after) {
            nodes { id body updatedAt }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { id: issueId, after },
    )
    const connection = data.issue?.comments
    if (!connection) {
      throw new Error(`comments missing for issue ${issueId}`)
    }
    comments.push(...connection.nodes)
    hasNextPage = connection.pageInfo.hasNextPage
    if (!hasNextPage) {
      break
    }
    const cursor = connection.pageInfo.endCursor
    if (!cursor || seenCursors.has(cursor)) {
      throw new Error(`invalid comment cursor for ${issueId}`)
    }
    seenCursors.add(cursor)
    after = cursor
  }
  return comments
}

async function updateIssue(id, input) {
  const data = await request(
    `mutation UpdateRotationIssue($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue { id identifier }
      }
    }`,
    { id, input },
  )
  if (!data.issueUpdate?.success) {
    throw new Error(`Linear did not update issue ${id}`)
  }
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
    throw new Error(`HON-206 Linear plan sync failed: ${messages.join('; ')}`)
  }
  return payload.data
}

async function writeReadback(verification, phase) {
  const readback = {
    generatedAt: new Date().toISOString(),
    phase,
    status: verification.errors.length === 0 ? 'exact' : 'mismatch',
    sourcePins: hon206LinearPlan.sourcePins,
    inventory: summarizeInventory(verification.inventory),
    parent: {
      id: verification.parent.id,
      identifier: verification.parent.identifier,
      title: verification.parent.title,
      state: verification.parent.state,
      url: verification.parent.url,
    },
    expectedChildren: hon206LinearPlan.issues.length,
    verifiedChildren: verification.issueRows.length,
    expectedBlockRelations: 3,
    verifiedBlockRelations: verification.relationRows.filter((row) => row.exact)
      .length,
    unexpectedBlockRelations: verification.unexpectedRelationRows.length,
    issues: verification.issueRows,
    relations: verification.relationRows,
    unexpectedRelations: verification.unexpectedRelationRows,
    managedComment: verification.managedComment
      ? {
          id: verification.managedComment.id,
          updatedAt: verification.managedComment.updatedAt,
          bytes: Buffer.byteLength(
            verification.managedComment.body ?? '',
            'utf8',
          ),
          sha256: sha256(verification.managedComment.body ?? ''),
          checks: verification.commentChecks,
        }
      : {
          id: null,
          updatedAt: null,
          bytes: 0,
          sha256: sha256(''),
          checks: verification.commentChecks,
        },
    errors: verification.errors,
  }
  await mkdir(resultDirectory, { recursive: true })
  await writeFile(jsonOutputPath, `${JSON.stringify(readback, null, 2)}\n`)
  await writeFile(markdownOutputPath, renderReadbackMarkdown(readback))
  console.log(
    JSON.stringify(
      {
        status: readback.status,
        phase: readback.phase,
        inventory: readback.inventory,
        parentState: readback.parent.state,
        children: readback.issues.map((issue) => ({
          key: issue.key,
          identifier: issue.identifier,
          state: issue.state.name,
        })),
        verifiedBlockRelations: readback.verifiedBlockRelations,
        unexpectedBlockRelations: readback.unexpectedBlockRelations,
        managedComment: readback.managedComment,
        errors: readback.errors,
        output: [jsonOutputPath, markdownOutputPath],
      },
      null,
      2,
    ),
  )
}

async function writeFailureArtifact(error) {
  await mkdir(resultDirectory, { recursive: true })
  const body = {
    generatedAt: new Date().toISOString(),
    status: 'failed',
    phase: mode.slice(2),
    sourcePins: hon206LinearPlan.sourcePins,
    errors: [errorMessage(error)],
  }
  await writeFile(jsonOutputPath, `${JSON.stringify(body, null, 2)}\n`)
  await writeFile(
    markdownOutputPath,
    `# HON-206 Linear plan readback\n\nStatus: failed.\n\n- ${errorMessage(error)}\n`,
  )
}

async function updateWorkflowState(issueRows) {
  const state = JSON.parse(await readFile(statePath, 'utf8'))
  const byPacket = new Map(issueRows.map((issue) => [issue.packet, issue]))
  for (const packet of state.packets) {
    const issue = byPacket.get(packet.id)
    if (!issue) {
      throw new Error(`workflow state is missing Linear issue for ${packet.id}`)
    }
    packet.linear = issue.identifier
  }
  state.verification.status = 'linear_subissues_synced'
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`)
}

function renderReadbackMarkdown(readback) {
  return [
    '# HON-206 Linear plan readback',
    '',
    `Generated: ${readback.generatedAt}.`,
    '',
    `Status: ${readback.status}.`,
    '',
    `Children: ${readback.verifiedChildren}/${readback.expectedChildren}.`,
    '',
    `Block relations: ${readback.verifiedBlockRelations}/${readback.expectedBlockRelations}; unexpected ${readback.unexpectedBlockRelations}.`,
    '',
    `Managed comment: ${readback.managedComment.id ?? 'missing'}, ${readback.managedComment.bytes} bytes, SHA-256 \`${readback.managedComment.sha256}\`.`,
    '',
    '## Children',
    '',
    ...readback.issues.map(
      (issue) =>
        `- ${issue.key}: ${issue.identifier}, ${issue.state.name}, ${issue.descriptionBytes} bytes, SHA-256 \`${issue.descriptionSha256}\`.`,
    ),
    '',
    '## Errors',
    '',
    ...(readback.errors.length === 0
      ? ['- None.']
      : readback.errors.map((error) => `- ${error}`)),
    '',
  ].join('\n')
}

function emptyVerification(context, errors) {
  return {
    ...context,
    workflowStates: null,
    identifiers: {},
    issueRows: [],
    relationRows: [],
    unexpectedRelationRows: [],
    managedComment: null,
    commentChecks: {},
    errors,
  }
}

function identifiersFor(issueByKey) {
  return Object.fromEntries(
    [...issueByKey].map(([key, issue]) => [key, issue.identifier]),
  )
}

function requiredIssue(issueByKey, key) {
  const issue = issueByKey.get(key)
  if (!issue) {
    throw new Error(`${key}: managed sub-issue is missing`)
  }
  return issue
}

function relationKey(sourceId, targetId) {
  return `${sourceId}->${targetId}`
}

function summarizeInventory(issues) {
  return {
    total: issues.length,
    archived: issues.filter((issue) => issue.archivedAt !== null).length,
    activeUnarchived: issues.filter(
      (issue) =>
        issue.archivedAt === null &&
        issue.state.type !== 'completed' &&
        issue.state.type !== 'canceled',
    ).length,
    completedUnarchived: issues.filter(
      (issue) => issue.archivedAt === null && issue.state.type === 'completed',
    ).length,
  }
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function isControlCharacter(character) {
  const codePoint = character.codePointAt(0) ?? 0
  return codePoint <= 31 || codePoint === 127
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

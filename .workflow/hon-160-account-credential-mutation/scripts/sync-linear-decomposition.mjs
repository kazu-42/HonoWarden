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
  renderGuardedDescription,
  renderParentDescription,
  summarizePlan,
  validatePlan,
} from './account-credential-manifest.mjs'
import {
  buildExpectedRelationPairs,
  discoverManagedChildren,
  expectedStateForDefinition,
  selectWorkflowStates,
} from './account-credential-linear-core.mjs'
import { auditBlockRelations } from './account-credential-relation-audit.mjs'

const workflowRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const resultDirectory = path.join(workflowRoot, 'results')
const jsonOutputPath = path.join(
  resultDirectory,
  'linear-decomposition-readback.json',
)
const markdownOutputPath = path.join(
  resultDirectory,
  'linear-decomposition-readback.md',
)
const endpoint = 'https://api.linear.app/graphql'
const parentTitle =
  'Account slice A2: password, KDF, keys, and security-stamp mutation'
const decompositionCommentMarker =
  '<!-- honowarden-managed:HON-160:decomposition-checkpoint -->'
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

validatePlan(accountCredentialPlan)

if (mode === '--validate') {
  console.log(JSON.stringify(summarizePlan(accountCredentialPlan), null, 2))
  process.exit(0)
}

if (mode === '--render') {
  const identifiers = Object.fromEntries(
    accountCredentialPlan.issues.map((issue) => [issue.key, issue.key]),
  )
  console.log(
    JSON.stringify(
      {
        parent: renderParentDescription(identifiers),
        checkpoint: renderDecompositionCheckpoint(identifiers),
        issues: accountCredentialPlan.issues.map((issue) => ({
          key: issue.key,
          title: issue.title,
          stateType: issue.stateType,
          blockers: issue.blockers,
          description: renderChildDescription(issue, identifiers),
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

if (mode === '--apply') {
  try {
    const verification = await applyDecomposition()
    await writeReadback(verification, 'apply')
  } catch (error) {
    await writeFailureArtifact(error)
    throw error
  }
} else {
  const verification = await verifyFinalState()
  await writeReadback(verification, 'readback')
  if (verification.errors.length > 0) {
    process.exitCode = 1
  }
}

async function applyDecomposition() {
  const parentBefore = await readParent()
  assertParentCanMutate(parentBefore)
  const workflowStates = selectWorkflowStates(parentBefore.team.states.nodes)
  let inventory = await readInventory(parentBefore.team.id)
  const initialDiscovery = discoverManagedChildren(
    inventory,
    accountCredentialPlan.issues,
    { requireAll: false },
  )
  if (initialDiscovery.errors.length > 0) {
    throw new Error(initialDiscovery.errors.join('; '))
  }

  const missingCount =
    accountCredentialPlan.issues.length - initialDiscovery.issueByKey.size
  if (inventory.length + missingCount > 250) {
    throw new Error(
      `issue capacity exceeded: ${inventory.length} existing + ${missingCount} new`,
    )
  }

  assertExistingChildrenMutable(
    initialDiscovery.issueByKey,
    parentBefore,
    workflowStates,
  )

  const parentSnapshot = {
    description: parentBefore.description ?? '',
    stateId: parentBefore.state.id,
  }
  let managedIssueByKey = new Map(initialDiscovery.issueByKey)

  try {
    await guardExistingChildren(managedIssueByKey)
    managedIssueByKey = await createMissingChildren({
      parent: parentBefore,
      workflowStates,
      existing: managedIssueByKey,
    })
    await normalizeGuardedChildren({
      issueByKey: managedIssueByKey,
      parent: parentBefore,
      workflowStates,
    })

    inventory = await readInventory(parentBefore.team.id)
    const guarded = discoverManagedChildren(
      inventory,
      accountCredentialPlan.issues,
      { requireAll: true },
    )
    if (guarded.errors.length > 0) {
      throw new Error(guarded.errors.join('; '))
    }
    managedIssueByKey = guarded.issueByKey
    const guardedIssueVerification = verifyChildren({
      issueByKey: managedIssueByKey,
      parent: parentBefore,
      workflowStates,
      descriptionMode: 'guarded',
    })
    if (guardedIssueVerification.errors.length > 0) {
      throw new Error(
        `guarded child mismatch: ${guardedIssueVerification.errors.join('; ')}`,
      )
    }

    await assertNoUnexpectedOrDuplicateRelations(managedIssueByKey)
    await ensureRelations(managedIssueByKey)
    const guardedRelationVerification = await verifyRelations(managedIssueByKey)
    if (guardedRelationVerification.errors.length > 0) {
      throw new Error(
        `guarded relation mismatch: ${guardedRelationVerification.errors.join('; ')}`,
      )
    }

    const identifiers = identifiersFor(managedIssueByKey)
    for (const definition of accountCredentialPlan.issues) {
      const issue = requiredManagedIssue(managedIssueByKey, definition.key)
      await updateIssue(issue.id, {
        description: renderChildDescription(definition, identifiers),
      })
    }
    await updateIssue(parentBefore.id, {
      description: renderParentDescription(identifiers),
      stateId: workflowStates.started.id,
    })

    const beforeCommentVerification = await verifyFinalState()
    const structuralErrors = beforeCommentVerification.errors.filter(
      (error) => !error.startsWith('managed checkpoint:'),
    )
    if (structuralErrors.length > 0) {
      throw new Error(
        `final structural mismatch: ${structuralErrors.join('; ')}`,
      )
    }

    await syncManagedComment(
      parentBefore.id,
      renderDecompositionCheckpoint(identifiers),
    )
    const finalVerification = await verifyFinalState()
    if (finalVerification.errors.length > 0) {
      throw new Error(
        `final synchronization mismatch: ${finalVerification.errors.join('; ')}`,
      )
    }
    return finalVerification
  } catch (cause) {
    const rollbackErrors = await restoreSynchronizationGuard({
      issueByKey: managedIssueByKey,
      parent: parentBefore,
      parentSnapshot,
    })
    const rollbackSummary =
      rollbackErrors.length === 0
        ? 'managed children restored to the synchronization guard and parent restored'
        : `guarded rollback failures: ${rollbackErrors.join('; ')}`
    throw new Error(
      `HON-160 decomposition failed; ${rollbackSummary}; cause: ${errorMessage(cause)}`,
      { cause },
    )
  }
}

async function createMissingChildren({ parent, workflowStates, existing }) {
  const issueByKey = new Map(existing)
  for (const definition of accountCredentialPlan.issues) {
    if (issueByKey.has(definition.key)) {
      continue
    }
    const state = expectedStateForDefinition(definition, workflowStates)
    const data = await request(
      `mutation CreateCredentialChild($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id identifier title description priority archivedAt
            parent { id identifier }
            project { id name }
            state { id name type }
          }
        }
      }`,
      {
        input: {
          teamId: parent.team.id,
          projectId: parent.project.id,
          parentId: parent.id,
          stateId: state.id,
          priority: accountCredentialPlan.priority,
          title: definition.title,
          description: renderGuardedDescription(definition),
        },
      },
    )
    if (!data.issueCreate?.success || !data.issueCreate.issue) {
      throw new Error(`Linear did not create ${definition.key}`)
    }
    issueByKey.set(definition.key, data.issueCreate.issue)
  }
  return issueByKey
}

async function normalizeGuardedChildren({
  issueByKey,
  parent,
  workflowStates,
}) {
  for (const definition of accountCredentialPlan.issues) {
    const issue = requiredManagedIssue(issueByKey, definition.key)
    const state = expectedStateForDefinition(definition, workflowStates)
    await updateIssue(issue.id, {
      title: definition.title,
      description: renderGuardedDescription(definition),
      parentId: parent.id,
      projectId: parent.project.id,
      stateId: state.id,
      priority: accountCredentialPlan.priority,
    })
  }
}

async function guardExistingChildren(issueByKey) {
  for (const definition of accountCredentialPlan.issues) {
    const issue = issueByKey.get(definition.key)
    if (issue) {
      await updateIssue(issue.id, {
        description: renderGuardedDescription(definition),
      })
    }
  }
}

async function assertNoUnexpectedOrDuplicateRelations(issueByKey) {
  const audit = await verifyRelations(issueByKey)
  const unsafe = audit.errors.filter(
    (error) =>
      !error.endsWith(': relation missing') &&
      !error.endsWith(': relation endpoint missing'),
  )
  if (unsafe.length > 0) {
    throw new Error(`refusing relation reconciliation: ${unsafe.join('; ')}`)
  }
}

async function ensureRelations(issueByKey) {
  const pairs = buildExpectedRelationPairs(accountCredentialPlan, issueByKey)
  const cache = new Map()
  for (const pair of pairs) {
    if (!pair.sourceId || !pair.targetId) {
      throw new Error(
        `relation endpoint missing: ${pair.blocker} -> ${pair.blocked}`,
      )
    }
    let outgoing = cache.get(pair.sourceId)
    if (!outgoing) {
      outgoing = await readOutgoingRelations(pair.sourceId)
      cache.set(pair.sourceId, outgoing)
    }
    const matches = outgoing.filter(
      (relation) =>
        relation.archivedAt == null &&
        relation.type === 'blocks' &&
        relation.relatedIssue.id === pair.targetId,
    )
    if (matches.length > 1) {
      throw new Error(`${pair.blocker} -> ${pair.blocked}: duplicate relations`)
    }
    if (matches.length === 1) {
      continue
    }

    const data = await request(
      `mutation CreateCredentialRelation($input: IssueRelationCreateInput!) {
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
    outgoing.push(data.issueRelationCreate.issueRelation)
  }
}

async function verifyFinalState() {
  const parent = await readParent()
  const errors = []
  let workflowStates
  try {
    workflowStates = selectWorkflowStates(parent.team.states.nodes)
  } catch (error) {
    return emptyVerification(parent, [errorMessage(error)])
  }
  const inventory = await readInventory(parent.team.id)
  const discovery = discoverManagedChildren(
    inventory,
    accountCredentialPlan.issues,
    { requireAll: true },
  )
  errors.push(...discovery.errors)
  const issueByKey = discovery.issueByKey
  const identifiers = identifiersFor(issueByKey)
  const childVerification = verifyChildren({
    issueByKey,
    parent,
    workflowStates,
    descriptionMode: 'final',
  })
  errors.push(...childVerification.errors)

  const parentChecks = {
    title: parent.title === parentTitle,
    description: parent.description === renderParentDescription(identifiers),
    project:
      parent.project?.name === accountCredentialPlan.projectName &&
      parent.project?.id != null,
    state:
      parent.state.id === workflowStates.started.id &&
      parent.state.type === 'started',
    priority: parent.priority === accountCredentialPlan.priority,
    nonArchived: parent.archivedAt === null,
    capabilityMarker:
      parent.description?.includes(
        'HonoWarden capability roadmap key: `AUTH-2`.',
      ) === true,
  }
  for (const [name, passed] of Object.entries(parentChecks)) {
    if (!passed) {
      errors.push(`parent HON-160: ${name} mismatch`)
    }
  }

  const relationVerification = await verifyRelations(issueByKey)
  errors.push(...relationVerification.errors)
  const commentVerification = await verifyManagedComment(parent, identifiers)
  errors.push(...commentVerification.errors)

  return {
    inventory,
    parent,
    parentChecks,
    workflowStates,
    identifiers,
    issueRows: childVerification.rows,
    relationRows: relationVerification.rows,
    unexpectedRelationRows: relationVerification.unexpectedRows,
    comment: commentVerification.comment,
    commentChecks: commentVerification.checks,
    errors,
  }
}

function verifyChildren({
  issueByKey,
  parent,
  workflowStates,
  descriptionMode,
}) {
  const identifiers = identifiersFor(issueByKey)
  const rows = []
  const errors = []

  for (const definition of accountCredentialPlan.issues) {
    const issue = issueByKey.get(definition.key)
    if (!issue) {
      continue
    }
    const state = expectedStateForDefinition(definition, workflowStates)
    const expectedDescription =
      descriptionMode === 'guarded'
        ? renderGuardedDescription(definition)
        : renderChildDescription(definition, identifiers)
    const checks = {
      marker: issue.description?.includes(canonicalMarker(definition)) === true,
      title: issue.title === definition.title,
      description: issue.description === expectedDescription,
      parent: issue.parent?.id === parent.id,
      project: issue.project?.id === parent.project.id,
      state: issue.state?.id === state.id,
      priority: issue.priority === accountCredentialPlan.priority,
      nonArchived: issue.archivedAt === null,
    }
    for (const [name, passed] of Object.entries(checks)) {
      if (!passed) {
        errors.push(`${definition.key}: ${name} mismatch`)
      }
    }
    rows.push({
      key: definition.key,
      identifier: issue.identifier,
      id: issue.id,
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
  return { rows, errors }
}

async function verifyRelations(issueByKey) {
  const expectedPairs = buildExpectedRelationPairs(
    accountCredentialPlan,
    issueByKey,
  )
  const managedIssueIds = new Set(
    [...issueByKey.values()].map((issue) => issue.id),
  )
  const relations = []
  for (const issue of issueByKey.values()) {
    relations.push(...(await readRelationsTouchingIssue(issue.id)))
  }
  return auditBlockRelations({ expectedPairs, relations, managedIssueIds })
}

async function syncManagedComment(parentId, body) {
  const comments = await readAllComments(parentId)
  const managed = comments.filter((comment) =>
    comment.body?.startsWith(decompositionCommentMarker),
  )
  if (managed.length > 1) {
    throw new Error(`duplicate managed HON-160 comments: ${managed.length}`)
  }

  if (managed.length === 1) {
    const data = await request(
      `mutation UpdateCredentialCheckpoint($id: String!, $input: CommentUpdateInput!) {
        commentUpdate(id: $id, input: $input) {
          success
          comment { id body updatedAt }
        }
      }`,
      { id: managed[0].id, input: { body } },
    )
    if (!data.commentUpdate?.success) {
      throw new Error('Linear did not update the managed HON-160 comment')
    }
    return
  }

  const data = await request(
    `mutation CreateCredentialCheckpoint($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        success
        comment { id body updatedAt }
      }
    }`,
    { input: { issueId: parentId, body } },
  )
  if (!data.commentCreate?.success || !data.commentCreate.comment) {
    throw new Error('Linear did not create the managed HON-160 comment')
  }
}

async function verifyManagedComment(parent, identifiers) {
  const expectedBody = renderDecompositionCheckpoint(identifiers)
  const comments = await readAllComments(parent.id)
  const managed = comments.filter((comment) =>
    comment.body?.startsWith(decompositionCommentMarker),
  )
  const comment = managed[0] ?? null
  const checks = {
    singleManagedComment: managed.length === 1,
    body: comment?.body === expectedBody,
    bytes:
      Buffer.byteLength(comment?.body ?? '', 'utf8') ===
      Buffer.byteLength(expectedBody, 'utf8'),
    sha256: sha256(comment?.body ?? '') === sha256(expectedBody),
  }
  const errors = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => `managed checkpoint: ${name} mismatch`)
  return { comment, checks, errors }
}

async function restoreSynchronizationGuard({
  issueByKey,
  parent,
  parentSnapshot,
}) {
  const errors = []
  for (const definition of accountCredentialPlan.issues) {
    const issue = issueByKey.get(definition.key)
    if (!issue) {
      continue
    }
    try {
      await updateIssue(issue.id, {
        description: renderGuardedDescription(definition),
      })
    } catch (error) {
      errors.push(`${definition.key}: ${errorMessage(error)}`)
    }
  }
  try {
    await updateIssue(parent.id, {
      description: parentSnapshot.description,
      stateId: parentSnapshot.stateId,
    })
  } catch (error) {
    errors.push(`HON-160 parent: ${errorMessage(error)}`)
  }
  return errors
}

function assertParentCanMutate(parent) {
  const errors = []
  if (parent.identifier !== accountCredentialPlan.parentIdentifier) {
    errors.push('identifier')
  }
  if (parent.title !== parentTitle) {
    errors.push('title')
  }
  if (parent.archivedAt !== null) {
    errors.push('archived')
  }
  if (!['backlog', 'unstarted', 'started'].includes(parent.state.type)) {
    errors.push(`terminal state ${parent.state.type}`)
  }
  if (parent.project?.name !== accountCredentialPlan.projectName) {
    errors.push('project')
  }
  if (parent.priority !== accountCredentialPlan.priority) {
    errors.push('priority')
  }
  if (
    !parent.description?.includes(
      'HonoWarden capability roadmap key: `AUTH-2`.',
    )
  ) {
    errors.push('capability marker')
  }
  if (errors.length > 0) {
    throw new Error(`refusing HON-160 mutation: ${errors.join(', ')}`)
  }
}

function assertExistingChildrenMutable(issueByKey, parent, workflowStates) {
  for (const definition of accountCredentialPlan.issues) {
    const issue = issueByKey.get(definition.key)
    if (!issue) {
      continue
    }
    const errors = []
    if (issue.archivedAt !== null) {
      errors.push('archived')
    }
    if (!['backlog', 'unstarted', 'started'].includes(issue.state.type)) {
      errors.push(`terminal state ${issue.state.type}`)
    }
    if (issue.parent?.id !== parent.id) {
      errors.push('parent')
    }
    if (issue.project?.id !== parent.project.id) {
      errors.push('project')
    }
    if (issue.priority !== accountCredentialPlan.priority) {
      errors.push('priority')
    }
    const expectedState = expectedStateForDefinition(definition, workflowStates)
    if (!expectedState?.id) {
      errors.push('workflow state')
    }
    if (errors.length > 0) {
      throw new Error(
        `${definition.key}: managed issue drifted in ${errors.join(', ')}`,
      )
    }
  }
}

async function readParent() {
  const data = await request(
    `query ReadCredentialParent($id: String!) {
      issue(id: $id) {
        id identifier title description priority archivedAt
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
    { id: accountCredentialPlan.parentIdentifier },
  )
  if (!data.issue) {
    throw new Error('HON-160 was not found')
  }
  if (data.issue.team.states.pageInfo.hasNextPage) {
    throw new Error('Linear workflow state list exceeds 100 entries')
  }
  return data.issue
}

async function readInventory(teamId) {
  const query = `query ReadCredentialInventory($teamId: ID!, $after: String) {
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
    const data = await request(query, { teamId, after })
    issues.push(...data.issues.nodes)
    after = data.issues.pageInfo.hasNextPage
      ? data.issues.pageInfo.endCursor
      : null
  } while (after)
  return issues
}

async function readOutgoingRelations(issueId) {
  return readRelationConnection(issueId, 'relations')
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
  const query = `query ReadCredentialRelations($id: String!, $after: String) {
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
  const relations = []
  const seenCursors = new Set()
  let after = null
  let hasNextPage = true
  while (hasNextPage) {
    const data = await request(query, { id: issueId, after })
    const connection = data.issue?.[connectionName]
    if (!connection) {
      throw new Error(`${connectionName} missing for issue ${issueId}`)
    }
    relations.push(...connection.nodes)
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
  return relations
}

async function readAllComments(issueId) {
  const query = `query ReadCredentialComments($id: String!, $after: String) {
    issue(id: $id) {
      comments(first: 100, after: $after) {
        nodes { id body updatedAt }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`
  const comments = []
  const seenCursors = new Set()
  let after = null
  let hasNextPage = true
  while (hasNextPage) {
    const data = await request(query, { id: issueId, after })
    const connection = data.issue?.comments
    if (!connection) {
      throw new Error(`comments missing for issue ${issueId}`)
    }
    comments.push(...connection.nodes)
    hasNextPage = connection.pageInfo.hasNextPage
    if (!hasNextPage) {
      break
    }
    const next = connection.pageInfo.endCursor
    if (!next || seenCursors.has(next)) {
      throw new Error(`invalid comment cursor for issue ${issueId}`)
    }
    seenCursors.add(next)
    after = next
  }
  return comments
}

async function updateIssue(id, input) {
  const data = await request(
    `mutation UpdateCredentialIssue($id: String!, $input: IssueUpdateInput!) {
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
  return data.issueUpdate.issue
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
  const payload = await response.json()
  if (!response.ok || payload.errors) {
    const messages = payload.errors?.map((error) => error.message) ?? [
      `HTTP ${response.status}`,
    ]
    throw new Error(`Linear credential sync failed: ${messages.join('; ')}`)
  }
  return payload.data
}

async function writeReadback(verification, phase) {
  const readback = {
    generatedAt: new Date().toISOString(),
    status: verification.errors.length === 0 ? 'exact' : 'mismatch',
    phase,
    sourcePins: accountCredentialPlan.sourcePins,
    inventory: summarizeInventory(verification.inventory),
    parent: {
      identifier: verification.parent.identifier,
      id: verification.parent.id,
      state: verification.parent.state,
      descriptionBytes: Buffer.byteLength(
        verification.parent.description ?? '',
        'utf8',
      ),
      descriptionSha256: sha256(verification.parent.description ?? ''),
      checks: verification.parentChecks,
    },
    expectedChildren: accountCredentialPlan.issues.length,
    verifiedChildren: verification.issueRows.length,
    expectedBlockRelations: 9,
    verifiedBlockRelations: verification.relationRows.filter((row) => row.exact)
      .length,
    unexpectedBlockRelations: verification.unexpectedRelationRows.length,
    issues: verification.issueRows,
    relations: verification.relationRows,
    unexpectedRelations: verification.unexpectedRelationRows,
    managedComment: verification.comment
      ? {
          id: verification.comment.id,
          updatedAt: verification.comment.updatedAt,
          bytes: Buffer.byteLength(verification.comment.body ?? '', 'utf8'),
          sha256: sha256(verification.comment.body ?? ''),
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
        generatedAt: readback.generatedAt,
        inventory: readback.inventory,
        parentState: readback.parent.state,
        verifiedChildren: readback.verifiedChildren,
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
  const readback = {
    generatedAt: new Date().toISOString(),
    status: 'apply-failed',
    phase: 'guarded-recovery',
    sourcePins: accountCredentialPlan.sourcePins,
    errors: [errorMessage(error)],
  }
  await mkdir(resultDirectory, { recursive: true })
  await writeFile(jsonOutputPath, `${JSON.stringify(readback, null, 2)}\n`)
  await writeFile(
    markdownOutputPath,
    `# HON-160 Linear decomposition readback\n\nStatus: apply-failed.\n\n- ${errorMessage(error)}\n`,
  )
}

function emptyVerification(parent, errors) {
  return {
    inventory: [],
    parent,
    parentChecks: {},
    workflowStates: null,
    identifiers: {},
    issueRows: [],
    relationRows: [],
    unexpectedRelationRows: [],
    comment: null,
    commentChecks: {},
    errors,
  }
}

function identifiersFor(issueByKey) {
  return Object.fromEntries(
    [...issueByKey].map(([key, issue]) => [key, issue.identifier]),
  )
}

function requiredManagedIssue(issueByKey, key) {
  const issue = issueByKey.get(key)
  if (!issue) {
    throw new Error(`${key}: managed issue is missing`)
  }
  return issue
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

function renderReadbackMarkdown(readback) {
  const lines = [
    '# HON-160 Linear decomposition readback',
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
  ]
  return lines.join('\n')
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

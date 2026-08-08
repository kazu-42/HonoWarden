import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const endpoint = 'https://api.linear.app/graphql'
const issueIdentifier = 'HON-183'
const parentIdentifier = 'HON-182'
const expectedTitle =
  'Send slice S1: replacement ADR, threat model, and wire contract'
const expectedParentTitle = 'Send and public-sharing product-line program'
const expectedProject = 'HonoWarden Post-Alpha Roadmap'
const expectedDescriptionMarker = 'HonoWarden capability roadmap key: `SEND-1`.'
const managedMarker =
  '<!-- honowarden-managed:HON-183:implementation-checkpoint -->'
const workflowRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const bodyPath = path.join(workflowRoot, 'results/hon-183-linear-checkpoint.md')
const outputPath = path.join(
  workflowRoot,
  'results/hon-183-linear-checkpoint-readback.json',
)
const apiKey = process.env.LINEAR_API_KEY?.trim()

if (process.argv[2] !== '--apply') {
  throw new Error('refusing to mutate Linear without the explicit --apply flag')
}
if (!apiKey || containsControlCharacter(apiKey)) {
  throw new Error('a valid LINEAR_API_KEY is required')
}

const rawBody = await readFile(bodyPath, 'utf8')
const body = rawBody.endsWith('\n') ? rawBody.slice(0, -1) : rawBody
if (!body.startsWith(managedMarker)) {
  throw new Error('managed checkpoint body marker mismatch')
}

const issueBefore = await readIssue(issueIdentifier)
const parentBefore = await readIssue(parentIdentifier)
assertIssueIdentity(issueBefore, parentBefore)
const inProgressState = issueBefore.team.states.nodes.filter(
  (state) => state.type === 'started' && state.name === 'In Progress',
)
if (inProgressState.length !== 1) {
  throw new Error(
    `expected one In Progress state, found ${inProgressState.length}`,
  )
}

for (const issue of [parentBefore, issueBefore]) {
  if (issue.state.id !== inProgressState[0].id) {
    const updated = await request(
      `mutation StartIssue($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue { id identifier state { id name type } }
        }
      }`,
      { id: issue.id, input: { stateId: inProgressState[0].id } },
    )
    if (!updated.issueUpdate?.success) {
      throw new Error(`Linear did not move ${issue.identifier} to In Progress`)
    }
  }
}

const matchingBefore = issueBefore.comments.nodes.filter((comment) =>
  comment.body?.startsWith(managedMarker),
)
if (matchingBefore.length > 1) {
  throw new Error(
    `managed checkpoint identity mismatch: ${matchingBefore.length} comments`,
  )
}

let commentId
if (matchingBefore.length === 1) {
  const updated = await request(
    `mutation UpdateManagedComment($id: String!, $input: CommentUpdateInput!) {
      commentUpdate(id: $id, input: $input) {
        success
        comment { id body issue { id identifier } }
      }
    }`,
    { id: matchingBefore[0].id, input: { body } },
  )
  if (!updated.commentUpdate?.success || !updated.commentUpdate.comment) {
    throw new Error('Linear did not update the managed HON-183 comment')
  }
  commentId = updated.commentUpdate.comment.id
} else {
  const created = await request(
    `mutation CreateManagedComment($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        success
        comment { id body issue { id identifier } }
      }
    }`,
    { input: { issueId: issueBefore.id, body } },
  )
  if (!created.commentCreate?.success || !created.commentCreate.comment) {
    throw new Error('Linear did not create the managed HON-183 comment')
  }
  commentId = created.commentCreate.comment.id
}

const issueAfter = await readIssue(issueIdentifier)
const parentAfter = await readIssue(parentIdentifier)
assertIssueIdentity(issueAfter, parentAfter)
const matchingAfter = issueAfter.comments.nodes.filter((comment) =>
  comment.body?.startsWith(managedMarker),
)
const responseBody = matchingAfter[0]?.body ?? ''
const checks = {
  issueIdentity: issueAfter.identifier === issueIdentifier,
  parentIdentity:
    issueAfter.parent?.identifier === parentIdentifier &&
    parentAfter.identifier === parentIdentifier,
  issueInProgress:
    issueAfter.state.name === 'In Progress' &&
    issueAfter.state.type === 'started',
  parentInProgress:
    parentAfter.state.name === 'In Progress' &&
    parentAfter.state.type === 'started',
  singleManagedComment:
    matchingAfter.length === 1 && matchingAfter[0].id === commentId,
  body: responseBody === body,
  bytes:
    Buffer.byteLength(responseBody, 'utf8') === Buffer.byteLength(body, 'utf8'),
  sha256: sha256(responseBody) === sha256(body),
}
const errors = Object.entries(checks)
  .filter(([, passed]) => !passed)
  .map(([name]) => `${name} mismatch`)
const readback = {
  generatedAt: new Date().toISOString(),
  status: errors.length === 0 ? 'exact' : 'mismatch',
  issue: issueIdentifier,
  parent: parentIdentifier,
  commentId,
  requestBytes: Buffer.byteLength(body, 'utf8'),
  responseBytes: Buffer.byteLength(responseBody, 'utf8'),
  requestSha256: sha256(body),
  responseSha256: sha256(responseBody),
  managedCommentCount: matchingAfter.length,
  issueState: issueAfter.state,
  parentState: parentAfter.state,
  checks,
  errors,
}
await writeFile(outputPath, `${JSON.stringify(readback, null, 2)}\n`)
console.log(JSON.stringify({ ...readback, output: outputPath }, null, 2))
if (errors.length > 0) {
  process.exitCode = 1
}

function assertIssueIdentity(issue, parent) {
  const failures = []
  if (issue.identifier !== issueIdentifier || issue.title !== expectedTitle) {
    failures.push('child identifier/title')
  }
  if (issue.archivedAt !== null || issue.priority !== 0) {
    failures.push('child archived/priority')
  }
  if (issue.project?.name !== expectedProject) {
    failures.push('child project')
  }
  if (issue.parent?.identifier !== parentIdentifier) {
    failures.push('child parent')
  }
  if (!issue.description?.includes(expectedDescriptionMarker)) {
    failures.push('child canonical description marker')
  }
  if (
    parent.identifier !== parentIdentifier ||
    parent.title !== expectedParentTitle ||
    parent.archivedAt !== null ||
    parent.project?.name !== expectedProject
  ) {
    failures.push('parent identity/project/archive')
  }
  if (failures.length > 0) {
    throw new Error(
      `Linear identity precondition failed: ${failures.join(', ')}`,
    )
  }
}

async function readIssue(identifier) {
  const query = `query ReadIssue($id: String!, $after: String) {
    issue(id: $id) {
      id
      identifier
      title
      description
      priority
      archivedAt
      parent { id identifier }
      project { id name }
      state { id name type }
      team {
        id
        states { nodes { id name type } }
      }
      comments(first: 50, after: $after) {
        nodes { id body updatedAt }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`
  const comments = []
  let issue = null
  let after = null
  do {
    const data = await request(query, { id: identifier, after })
    if (!data.issue || data.issue.identifier !== identifier) {
      throw new Error(`${identifier} was not found`)
    }
    issue ??= data.issue
    comments.push(...data.issue.comments.nodes)
    after = data.issue.comments.pageInfo.hasNextPage
      ? data.issue.comments.pageInfo.endCursor
      : null
  } while (after)
  issue.comments = { nodes: comments }
  return issue
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
    throw new Error(`Linear checkpoint sync failed: ${messages.join('; ')}`)
  }
  return payload.data
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function containsControlCharacter(value) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f
  })
}

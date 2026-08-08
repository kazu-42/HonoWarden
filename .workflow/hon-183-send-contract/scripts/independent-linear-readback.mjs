import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
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
const expectedBlockedIssues = ['HON-184', 'HON-185']
const workflowRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const bodyPath = path.join(workflowRoot, 'results/hon-183-linear-checkpoint.md')
const canonicalReadbackPath = path.join(
  workflowRoot,
  'results/hon-183-linear-checkpoint-readback.json',
)
const outputPath = path.join(
  workflowRoot,
  'results/hon-183-linear-independent-readback.json',
)
const apiKey = process.env.LINEAR_API_KEY?.trim()

if (!apiKey || containsControlCharacter(apiKey)) {
  throw new Error('a valid LINEAR_API_KEY is required')
}

const rawBody = await readFile(bodyPath, 'utf8')
const expectedBody = rawBody.endsWith('\n') ? rawBody.slice(0, -1) : rawBody
const canonical = JSON.parse(await readFile(canonicalReadbackPath, 'utf8'))
if (
  canonical.status !== 'exact' ||
  canonical.issue !== issueIdentifier ||
  canonical.parent !== parentIdentifier
) {
  throw new Error('canonical Linear checkpoint readback is not exact')
}

const issue = await readIssue(issueIdentifier)
const parent = await readIssue(parentIdentifier)
const managedComments = issue.comments.nodes.filter((comment) =>
  comment.body?.startsWith(managedMarker),
)
const responseBody = managedComments[0]?.body ?? ''
const activeOutgoingBlocks = issue.relations.nodes
  .filter(
    (relation) =>
      relation.type === 'blocks' &&
      relation.archivedAt === null &&
      relation.issue.id === issue.id,
  )
  .map((relation) => relation.relatedIssue.identifier)
  .sort()
const activeIncomingBlockers = issue.inverseRelations.nodes
  .filter(
    (relation) =>
      relation.type === 'blocks' &&
      relation.archivedAt === null &&
      relation.relatedIssue.id === issue.id &&
      (relation.issue.archivedAt !== null ||
        !['completed', 'canceled'].includes(relation.issue.state.type)),
  )
  .map((relation) => relation.issue.identifier)
  .sort()

const checks = {
  issueIdentity:
    issue.identifier === issueIdentifier && issue.title === expectedTitle,
  parentIdentity:
    issue.parent?.identifier === parentIdentifier &&
    parent.identifier === parentIdentifier &&
    parent.title === expectedParentTitle,
  project:
    issue.project?.name === expectedProject &&
    parent.project?.name === expectedProject,
  issueInProgress:
    issue.state.name === 'In Progress' && issue.state.type === 'started',
  parentInProgress:
    parent.state.name === 'In Progress' && parent.state.type === 'started',
  nonArchived: issue.archivedAt === null && parent.archivedAt === null,
  priority: issue.priority === 0,
  canonicalDescription:
    issue.description?.includes(expectedDescriptionMarker) === true,
  noActiveBlockers: activeIncomingBlockers.length === 0,
  outgoingBlocks:
    JSON.stringify(activeOutgoingBlocks) ===
    JSON.stringify(expectedBlockedIssues),
  singleManagedComment:
    managedComments.length === 1 &&
    managedComments[0].id === canonical.commentId,
  body: responseBody === expectedBody,
  bytes:
    Buffer.byteLength(responseBody, 'utf8') ===
      Buffer.byteLength(expectedBody, 'utf8') &&
    canonical.responseBytes === Buffer.byteLength(expectedBody, 'utf8'),
  sha256:
    sha256(responseBody) === sha256(expectedBody) &&
    canonical.responseSha256 === sha256(expectedBody),
}
const errors = Object.entries(checks)
  .filter(([, passed]) => !passed)
  .map(([name]) => `${name} mismatch`)
const readback = {
  generatedAt: new Date().toISOString(),
  status: errors.length === 0 ? 'exact' : 'mismatch',
  issue: issueIdentifier,
  parent: parentIdentifier,
  commentId: managedComments[0]?.id ?? null,
  responseBytes: Buffer.byteLength(responseBody, 'utf8'),
  responseSha256: sha256(responseBody),
  managedCommentCount: managedComments.length,
  activeIncomingBlockers,
  activeOutgoingBlocks,
  checks,
  errors,
}
await writeFile(outputPath, `${JSON.stringify(readback, null, 2)}\n`)
console.log(JSON.stringify({ ...readback, output: outputPath }, null, 2))
if (errors.length > 0) {
  process.exitCode = 1
}

async function readIssue(identifier) {
  const query = `query ReadIndependentIssue($id: String!, $after: String) {
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
      comments(first: 50, after: $after) {
        nodes { id body updatedAt }
        pageInfo { hasNextPage endCursor }
      }
      relations(first: 50) {
        nodes {
          id
          type
          archivedAt
          issue { id identifier }
          relatedIssue { id identifier }
        }
        pageInfo { hasNextPage }
      }
      inverseRelations(first: 50) {
        nodes {
          id
          type
          archivedAt
          issue { id identifier archivedAt state { name type } }
          relatedIssue { id identifier }
        }
        pageInfo { hasNextPage }
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
    if (
      data.issue.relations.pageInfo.hasNextPage ||
      data.issue.inverseRelations.pageInfo.hasNextPage
    ) {
      throw new Error(
        `${identifier} exceeds the 50-relation verification bound`,
      )
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
    throw new Error(
      `independent Linear checkpoint readback failed: ${messages.join('; ')}`,
    )
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

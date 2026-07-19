import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  accountCredentialPlan,
  canonicalMarker,
} from './account-credential-manifest.mjs'
import {
  renderSourceReadyCheckpoint,
  sourceReadyCheckpointIdentity,
  sourceReadyCommentMarker,
} from './auth-2a-source-ready-checkpoint.mjs'

const endpoint = 'https://api.linear.app/graphql'
const issueIdentifier = 'HON-202'
const definition = accountCredentialPlan.issues.find(
  (issue) => issue.key === 'AUTH-2A',
)
const apiKey = process.env.LINEAR_API_KEY?.trim()
const workflowRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const outputPath = path.join(
  workflowRoot,
  'results',
  'hon-202-source-ready-independent-readback.json',
)

if (!definition) {
  throw new Error('AUTH-2A definition is missing')
}
if (!apiKey || [...apiKey].some(isControlCharacter)) {
  throw new Error('a valid LINEAR_API_KEY is required')
}

const issue = await readIssue()
const comments = await readAllComments(issue.id)
const managed = comments.filter((comment) =>
  comment.body?.startsWith(sourceReadyCommentMarker),
)
const comment = managed[0] ?? null
const expectedBody = renderSourceReadyCheckpoint()
const expectedIdentity = sourceReadyCheckpointIdentity(expectedBody)
const actualIdentity = sourceReadyCheckpointIdentity(comment?.body ?? '')
const checks = {
  identifier: issue.identifier === issueIdentifier,
  title: issue.title === definition.title,
  canonicalMarker:
    issue.description?.includes(canonicalMarker(definition)) === true,
  parent: issue.parent?.identifier === accountCredentialPlan.parentIdentifier,
  project: issue.project?.name === accountCredentialPlan.projectName,
  state: issue.state?.name === 'In Progress' && issue.state?.type === 'started',
  priority: issue.priority === accountCredentialPlan.priority,
  nonArchived: issue.archivedAt === null,
  singleManagedComment: managed.length === 1,
  exactCommentBody: comment?.body === expectedBody,
  exactCommentBytes: actualIdentity.bytes === expectedIdentity.bytes,
  exactCommentSha256: actualIdentity.sha256 === expectedIdentity.sha256,
}
const errors = Object.entries(checks)
  .filter(([, passed]) => !passed)
  .map(([name]) => `${name} mismatch`)
const artifact = {
  generatedAt: new Date().toISOString(),
  mode: 'read-only-independent-graphql',
  status: errors.length === 0 ? 'exact' : 'mismatch',
  issue: {
    identifier: issue.identifier,
    id: issue.id,
    state: issue.state,
    parent: issue.parent,
    project: issue.project,
    priority: issue.priority,
    archivedAt: issue.archivedAt,
  },
  managedComment: comment
    ? {
        id: comment.id,
        updatedAt: comment.updatedAt,
        bytes: actualIdentity.bytes,
        sha256: actualIdentity.sha256,
      }
    : null,
  expectedComment: expectedIdentity,
  checks,
  errors,
}

await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
console.log(
  JSON.stringify(
    {
      status: artifact.status,
      mode: artifact.mode,
      issue: artifact.issue.identifier,
      state: artifact.issue.state,
      managedComment: artifact.managedComment,
      errors: artifact.errors,
      output: outputPath,
    },
    null,
    2,
  ),
)
if (errors.length > 0) {
  process.exitCode = 1
}

async function readIssue() {
  const data = await request(
    `query IndependentlyReadAuth2ASourceReadyIssue($id: String!) {
      issue(id: $id) {
        id identifier title description priority archivedAt
        parent { id identifier }
        project { id name }
        state { id name type }
      }
    }`,
    { id: issueIdentifier },
  )
  if (!data.issue) {
    throw new Error(`${issueIdentifier} was not found`)
  }
  return data.issue
}

async function readAllComments(issueId) {
  const comments = []
  const seenCursors = new Set()
  let after = null
  let hasNextPage = true
  while (hasNextPage) {
    const data = await request(
      `query IndependentlyReadAuth2ASourceReadyComments($id: String!, $after: String) {
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
      throw new Error(`comments missing for ${issueIdentifier}`)
    }
    comments.push(...connection.nodes)
    hasNextPage = connection.pageInfo.hasNextPage
    if (hasNextPage) {
      const next = connection.pageInfo.endCursor
      if (!next || seenCursors.has(next)) {
        throw new Error(`invalid comment cursor for ${issueIdentifier}`)
      }
      seenCursors.add(next)
      after = next
    }
  }
  return comments
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
      `independent Linear source-ready readback failed: ${messages.join('; ')}`,
    )
  }
  return payload.data
}

function isControlCharacter(character) {
  const codePoint = character.codePointAt(0) ?? 0
  return codePoint <= 31 || codePoint === 127
}

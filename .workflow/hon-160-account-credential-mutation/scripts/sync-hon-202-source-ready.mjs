import { Buffer } from 'node:buffer'
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
const mode = parseMode(process.argv.slice(2))
const workflowRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const outputPath = path.join(
  workflowRoot,
  'results',
  'hon-202-source-ready-readback.json',
)

if (!definition) {
  throw new Error('AUTH-2A definition is missing')
}
if (!apiKey || [...apiKey].some(isControlCharacter)) {
  throw new Error('a valid LINEAR_API_KEY is required')
}

const expectedBody = renderSourceReadyCheckpoint()
const expectedIdentity = sourceReadyCheckpointIdentity(expectedBody)
const before = await readIssue()
assertIssueBoundary(before)
const beforeComments = await readAllComments(before.id)
const managedBefore = managedComments(beforeComments)
if (managedBefore.length > 1) {
  throw new Error(`duplicate managed HON-202 comments: ${managedBefore.length}`)
}

let action = 'read-only'
if (mode === 'apply') {
  const existing = managedBefore[0]
  if (!existing) {
    await createComment(before.id, expectedBody)
    action = 'created'
  } else if (existing.body !== expectedBody) {
    await updateComment(existing.id, expectedBody)
    action = 'updated'
  } else {
    action = 'unchanged'
  }
}

const after = await readIssue()
const issueChecks = verifyIssueBoundary(after)
const afterComments = await readAllComments(after.id)
const managedAfter = managedComments(afterComments)
const comment = managedAfter[0] ?? null
const actualIdentity = sourceReadyCheckpointIdentity(comment?.body ?? '')
const commentChecks = {
  singleManagedComment: managedAfter.length === 1,
  exactBody: comment?.body === expectedBody,
  exactBytes: actualIdentity.bytes === expectedIdentity.bytes,
  exactSha256: actualIdentity.sha256 === expectedIdentity.sha256,
}
const errors = [
  ...failedChecks('issue', issueChecks),
  ...failedChecks('managed comment', commentChecks),
]
const artifact = {
  generatedAt: new Date().toISOString(),
  mode,
  action,
  status: errors.length === 0 ? 'exact' : 'mismatch',
  issue: {
    identifier: after.identifier,
    id: after.id,
    state: after.state,
    parent: after.parent,
    project: after.project,
    priority: after.priority,
    archivedAt: after.archivedAt,
    checks: issueChecks,
  },
  managedComment: comment
    ? {
        id: comment.id,
        updatedAt: comment.updatedAt,
        bytes: Buffer.byteLength(comment.body ?? '', 'utf8'),
        sha256: actualIdentity.sha256,
        checks: commentChecks,
      }
    : {
        id: null,
        updatedAt: null,
        bytes: 0,
        sha256: actualIdentity.sha256,
        checks: commentChecks,
      },
  expectedComment: expectedIdentity,
  errors,
}

await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
console.log(
  JSON.stringify(
    {
      status: artifact.status,
      mode: artifact.mode,
      action: artifact.action,
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

function parseMode(args) {
  if (args.length !== 1 || !['--apply', '--read-only'].includes(args[0])) {
    throw new Error('usage: sync-hon-202-source-ready.mjs --apply|--read-only')
  }
  return args[0].slice(2)
}

async function readIssue() {
  const data = await request(
    `query ReadAuth2ASourceReadyIssue($id: String!) {
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
      `query ReadAuth2ASourceReadyComments($id: String!, $after: String) {
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

async function createComment(issueId, body) {
  const data = await request(
    `mutation CreateAuth2ASourceReadyComment($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        success
        comment { id body updatedAt }
      }
    }`,
    { input: { issueId, body } },
  )
  if (!data.commentCreate?.success || !data.commentCreate.comment) {
    throw new Error('Linear did not create the managed HON-202 comment')
  }
}

async function updateComment(id, body) {
  const data = await request(
    `mutation UpdateAuth2ASourceReadyComment($id: String!, $input: CommentUpdateInput!) {
      commentUpdate(id: $id, input: $input) {
        success
        comment { id body updatedAt }
      }
    }`,
    { id, input: { body } },
  )
  if (!data.commentUpdate?.success || !data.commentUpdate.comment) {
    throw new Error('Linear did not update the managed HON-202 comment')
  }
}

function managedComments(comments) {
  return comments.filter((comment) =>
    comment.body?.startsWith(sourceReadyCommentMarker),
  )
}

function assertIssueBoundary(issue) {
  const checks = verifyIssueBoundary(issue)
  const errors = failedChecks('issue', checks)
  if (errors.length > 0) {
    throw new Error(`refusing HON-202 comment mutation: ${errors.join(', ')}`)
  }
}

function verifyIssueBoundary(issue) {
  return {
    identifier: issue.identifier === issueIdentifier,
    title: issue.title === definition.title,
    canonicalMarker:
      issue.description?.includes(canonicalMarker(definition)) === true,
    parent: issue.parent?.identifier === accountCredentialPlan.parentIdentifier,
    project: issue.project?.name === accountCredentialPlan.projectName,
    state:
      issue.state?.name === 'In Progress' && issue.state?.type === 'started',
    priority: issue.priority === accountCredentialPlan.priority,
    nonArchived: issue.archivedAt === null,
  }
}

function failedChecks(scope, checks) {
  return Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => `${scope}: ${name} mismatch`)
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
    throw new Error(`Linear source-ready sync failed: ${messages.join('; ')}`)
  }
  return payload.data
}

function isControlCharacter(character) {
  const codePoint = character.codePointAt(0) ?? 0
  return codePoint <= 31 || codePoint === 127
}

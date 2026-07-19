/* global Buffer, fetch, process */

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const endpoint = 'https://api.linear.app/graphql'
const issueId = '07d123f2-4d24-4ef1-b7fe-f6e6d132e054'
const marker =
  '<!-- honowarden-linear-checkpoint:v1 issue=HON-208 phase=source-ready -->'
const expectedIssue = {
  identifier: 'HON-208',
  title: 'WebAuthn A4.1: protocol, RP/origin, and recovery contract',
  parentIdentifier: 'HON-162',
  projectName: 'HonoWarden Post-Alpha Roadmap',
  stateName: 'In Progress',
  stateType: 'started',
  priority: 0,
}
const body = [
  marker,
  '# HON-208 source-ready checkpoint',
  '',
  'Status: source-ready, still In Progress. This is not committed, pushed, in a PR, merged, deployed, runtime-enabled, or compatibility-promoted.',
  '',
  'Candidate:',
  '- Branch: feat/hon-208-webauthn-contract-policy',
  '- Main baseline: 30c361fd4c7bcdd01fab47be77037adec31226a5',
  '- Scope: ADR 0012, pinned wire/state contract, dedicated threat model, pure fail-closed RP/origin policy, optional bindings, local placeholders, and disabled Wrangler defaults.',
  '- Explicitly absent: WebAuthn route, migration, repository, verifier dependency, feature advertisement, real RP/origin value, credential, authenticator, and live evidence.',
  '',
  'Verification:',
  '- TDD: initial missing-module red; policy green; 7 WHATWG normalization regressions red/green; Kelvin-sign case-fold regression red/green.',
  '- Focused policy: 39/39 passed. Combined focused contract/config/docs suite: 62/62 passed.',
  '- Full suite: 80 files, 817 tests passed.',
  '- TypeScript, ESLint, Prettier, brand scan, git diff check, HON-162 node tests 4/4, and workflow verification passed.',
  '- Wrangler dry-run passed for top-level, staging, and production; every readback kept WebAuthn enablement false.',
  '- Independent security/compatibility review found two normalization defects; both were reproduced and fixed. Final readback: resolved, no remaining findings.',
  '',
  'Safety and rollback:',
  '- No deploy, D1 write, binding/secret/DNS/routing change, user or authenticator mutation, external contact, GitHub mutation, or production operation occurred.',
  '- Rollback removes unused parser/config/docs only. No authentication state exists to migrate or delete.',
  '',
  'Publication gate:',
  '- Keep HON-208 In Progress until commit/push/PR approval, CI and review closure, merge/main readback, and exact post-merge Linear checkpoint.',
  '- HON-209 remains blocked until that publication closeout; do not infer source, environment, host, authenticator, or compatibility support from this checkpoint.',
].join('\n')

const workflowRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const resultDirectory = path.join(workflowRoot, 'results')
const jsonPath = path.join(
  resultDirectory,
  'hon-208-linear-source-ready-readback.json',
)
const markdownPath = path.join(
  resultDirectory,
  'hon-208-linear-source-ready-readback.md',
)

const mode = process.argv[2] ?? '--render'
if (!new Set(['--render', '--apply', '--readback']).has(mode)) {
  throw new Error(`unsupported mode: ${mode}`)
}

validateBody()

if (mode === '--render') {
  console.log(
    JSON.stringify(
      {
        status: 'rendered',
        issue: expectedIssue.identifier,
        marker,
        bodyBytes: Buffer.byteLength(body, 'utf8'),
        bodySha256: sha256(body),
        body,
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

const apiKey = process.env.LINEAR_API_KEY?.trim()
if (!apiKey || hasControlCharacter(apiKey)) {
  throw new Error('a valid LINEAR_API_KEY is required')
}

const before = await readIssue(apiKey)
assertIssue(before.issue)
const managedBefore = before.comments.filter((comment) =>
  comment.body.includes(marker),
)
if (managedBefore.length > 1) {
  throw new Error('multiple HON-208 source-ready checkpoint comments found')
}

let operation = 'readback'
if (mode === '--apply') {
  const existing = managedBefore[0]
  if (!existing) {
    await createComment(apiKey)
    operation = 'created'
  } else if (existing.body !== body) {
    await updateComment(apiKey, existing.id)
    operation = 'updated'
  } else {
    operation = 'unchanged'
  }
}

const after = await readIssue(apiKey)
assertIssue(after.issue)
const managedAfter = after.comments.filter((comment) =>
  comment.body.includes(marker),
)
if (managedAfter.length !== 1) {
  throw new Error(`expected one managed comment, found ${managedAfter.length}`)
}
const comment = managedAfter[0]
if (comment.body !== body) {
  throw new Error('managed comment body does not match the canonical body')
}

const readback = {
  status: 'exact',
  phase: 'source-ready',
  checkedAt: new Date().toISOString(),
  operation,
  issue: {
    id: after.issue.id,
    identifier: after.issue.identifier,
    title: after.issue.title,
    archivedAt: after.issue.archivedAt,
    priority: after.issue.priority,
    state: after.issue.state,
    parent: after.issue.parent,
    project: after.issue.project,
  },
  comment: {
    id: comment.id,
    marker,
    bodyBytes: Buffer.byteLength(comment.body, 'utf8'),
    bodySha256: sha256(comment.body),
    bodyExact: comment.body === body,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  },
  checks: {
    issueIdentity: true,
    inProgress: true,
    nonArchived: true,
    parent: true,
    project: true,
    priority: true,
    oneManagedComment: true,
    commentBodyExact: true,
  },
}

await mkdir(resultDirectory, { recursive: true })
await writeFile(jsonPath, `${JSON.stringify(readback, null, 2)}\n`)
await writeFile(
  markdownPath,
  [
    '# HON-208 Linear Source-Ready Readback',
    '',
    `Status: ${readback.status}.`,
    '',
    `- Checked at: ${readback.checkedAt}`,
    `- Operation: ${readback.operation}`,
    `- Issue: ${readback.issue.identifier}`,
    `- State: ${readback.issue.state.name} (${readback.issue.state.type})`,
    `- Archived: ${String(readback.issue.archivedAt !== null)}`,
    `- Parent: ${readback.issue.parent.identifier}`,
    `- Project: ${readback.issue.project.name}`,
    `- Comment id: ${readback.comment.id}`,
    `- Body bytes: ${readback.comment.bodyBytes}`,
    `- Body SHA-256: ${readback.comment.bodySha256}`,
    `- Body exact: ${String(readback.comment.bodyExact)}`,
    `- Managed comment count: 1`,
    '',
    'HON-208 intentionally remains In Progress until GitHub publication, CI,',
    'review, merge, main readback, and post-merge Linear closeout are complete.',
    '',
  ].join('\n'),
)

console.log(JSON.stringify(readback, null, 2))

function validateBody() {
  if (
    !body.startsWith(marker) ||
    body.match(new RegExp(marker, 'g'))?.length !== 1
  ) {
    throw new Error('canonical checkpoint marker must appear exactly once')
  }
  for (const forbidden of [
    'CLOUDFLARE_API_KEY=',
    'LINEAR_API_KEY=',
    'HONOWARDEN_WEBAUTHN_RP_ID=',
    'HONOWARDEN_WEBAUTHN_ORIGINS=',
  ]) {
    if (body.includes(forbidden)) {
      throw new Error(
        `canonical body contains forbidden material: ${forbidden}`,
      )
    }
  }
}

function assertIssue(issue) {
  const checks = {
    id: issue.id === issueId,
    identifier: issue.identifier === expectedIssue.identifier,
    title: issue.title === expectedIssue.title,
    nonArchived: issue.archivedAt === null,
    priority: issue.priority === expectedIssue.priority,
    state:
      issue.state?.name === expectedIssue.stateName &&
      issue.state?.type === expectedIssue.stateType,
    parent: issue.parent?.identifier === expectedIssue.parentIdentifier,
    project: issue.project?.name === expectedIssue.projectName,
  }
  const failed = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name)
  if (failed.length > 0) {
    throw new Error(`HON-208 issue invariant mismatch: ${failed.join(', ')}`)
  }
}

async function readIssue(apiKeyValue) {
  const comments = []
  let issue
  let after = null

  do {
    const data = await graphql(
      apiKeyValue,
      `
        query Hon208Checkpoint($id: String!, $after: String) {
          issue(id: $id) {
            id
            identifier
            title
            archivedAt
            priority
            state {
              id
              name
              type
            }
            parent {
              id
              identifier
            }
            project {
              id
              name
            }
            comments(first: 50, after: $after) {
              nodes {
                id
                body
                createdAt
                updatedAt
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `,
      { id: issueId, after },
    )
    if (!data.issue) {
      throw new Error('HON-208 was not found')
    }
    issue = data.issue
    comments.push(...data.issue.comments.nodes)
    after = data.issue.comments.pageInfo.hasNextPage
      ? data.issue.comments.pageInfo.endCursor
      : null
  } while (after)

  return { issue, comments }
}

async function createComment(apiKeyValue) {
  const data = await graphql(
    apiKeyValue,
    `
      mutation CreateHon208Checkpoint($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
          comment {
            id
            body
          }
        }
      }
    `,
    { input: { issueId, body } },
  )
  if (
    !data.commentCreate.success ||
    data.commentCreate.comment?.body !== body
  ) {
    throw new Error('Linear did not create the canonical checkpoint comment')
  }
}

async function updateComment(apiKeyValue, commentId) {
  const data = await graphql(
    apiKeyValue,
    `
      mutation UpdateHon208Checkpoint(
        $id: String!
        $input: CommentUpdateInput!
      ) {
        commentUpdate(id: $id, input: $input) {
          success
          comment {
            id
            body
          }
        }
      }
    `,
    { id: commentId, input: { body } },
  )
  if (
    !data.commentUpdate.success ||
    data.commentUpdate.comment?.body !== body
  ) {
    throw new Error('Linear did not update the canonical checkpoint comment')
  }
}

async function graphql(apiKeyValue, query, variables) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: apiKeyValue,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })
  const payload = await response.json()
  if (!response.ok || payload.errors?.length > 0) {
    const messages = payload.errors?.map((error) => error.message).join('; ')
    throw new Error(`Linear GraphQL failed: ${messages ?? response.status}`)
  }

  return payload.data
}

function hasControlCharacter(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit <= 0x1f || codeUnit === 0x7f) {
      return true
    }
  }

  return false
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

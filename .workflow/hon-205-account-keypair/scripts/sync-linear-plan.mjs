import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const endpoint = 'https://api.linear.app/graphql'
const issueId = '4eeebb24-7112-4e05-9d91-9b1fabbea57c'
const issueIdentifier = 'HON-205'
const marker = '<!-- honowarden-managed:HON-205:execution-plan -->'
const checkedAt = '2026-07-20 00:20 JST'
const mode = parseMode(process.argv.slice(2))
const workflowRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const outputJson = path.join(workflowRoot, 'results/linear-plan-readback.json')
const outputMarkdown = path.join(
  workflowRoot,
  'results/linear-plan-readback.md',
)

const body = [
  marker,
  '# HON-205 execution plan',
  '',
  `Checked at: ${checkedAt}`,
  '',
  'Status: source implementation is active on `feat/hon-205-account-keypair` from merged main. HON-205 is already the bounded AUTH-2D child under HON-160, so its atomic API/D1/projection contract remains one Linear issue; the reviewable implementation packets are tracked below instead of creating children that cannot close independently.',
  '',
  'Implementation packets:',
  '1. Pin the V1 `publicKey` + `encryptedPrivateKey` request and legacy/nested response envelope; add strict bounded parser and stored-state tests.',
  '2. Add guarded migration-free D1 initialization using `UPDATE ... RETURNING id` plus one required audit event in the same batch.',
  '3. Add exact-true default-off GET/POST routes and one complete-state projection rule for token, refresh, profile, and sync.',
  '4. Prove real local D1 initialization/replay/conflict/rollback/restart behavior, run pinned synthetic compatibility evidence, update docs, review, PR/CI, merge/main, and exact Linear closeout.',
  '',
  'Security and behavior invariants:',
  '- Both-null state may initialize once. An exact replay is a no-op. Partial state or any different value is a non-disclosing conflict and cannot overwrite.',
  '- V2 signature/security/signed-public-key fields are unsupported and rejected before D1. The server stores opaque public and wrapped-private values only.',
  '- First initialization advances revision and atomically audits it while preserving the security stamp and all existing sessions. True replacement remains HON-206.',
  '- Partial stored state is never returned by GET, token, refresh, profile, or sync.',
  '',
  'Completion gates:',
  '- Focused/full/compatibility tests, real local D1 readback, typecheck/lint/format/release gate, standard review, and separate five-axis review.',
  '- Exact-head PR CI, zero unresolved review threads, admin squash merge, exact-main CI, Done + `trash:false` archive, and HON-206 queue advance.',
  '',
  'Boundary: no migration, production deployment, remote D1 mutation, real-account key change, secret rotation, paid action, third-party contact, or compatibility-level promotion is authorized by this plan.',
].join('\n')

if (body.split(marker).length - 1 !== 1) {
  throw new Error('execution plan marker must appear exactly once')
}

const apiKey = process.env.LINEAR_API_KEY?.trim()
if (!apiKey || containsControlCharacter(apiKey)) {
  throw new Error('a valid LINEAR_API_KEY is required')
}

const before = await readIssue()
assertIssue(before)
const beforeManaged = managedComments(before.comments)
if (beforeManaged.length > 1) {
  throw new Error('HON-205 has duplicate managed execution plans')
}

const operations = []
if (mode === 'apply') {
  if (!beforeManaged[0]) {
    await createComment(body)
    operations.push('created_execution_plan')
  } else if (beforeManaged[0].body !== body) {
    await updateComment(beforeManaged[0].id, body)
    operations.push('updated_execution_plan')
  } else {
    operations.push('verified_execution_plan')
  }
}

const after = mode === 'render' ? before : await readIssue()
assertIssue(after)
const managed = managedComments(after.comments)
const checks = {
  issueIdentity: after.id === issueId && after.identifier === issueIdentifier,
  active:
    after.archivedAt === null &&
    after.state.name === 'In Progress' &&
    after.state.type === 'started',
  parent: after.parent?.identifier === 'HON-160',
  ...(mode === 'render'
    ? { noDuplicateBeforeApply: managed.length <= 1 }
    : {
        singleManagedComment: managed.length === 1,
        exactBody: managed[0]?.body === body,
        exactBytes:
          Buffer.byteLength(managed[0]?.body ?? '', 'utf8') ===
          Buffer.byteLength(body, 'utf8'),
        exactSha256: sha256(managed[0]?.body ?? '') === sha256(body),
      }),
}
const errors = Object.entries(checks)
  .filter(([, passed]) => !passed)
  .map(([name]) => `${name} mismatch`)
const readback = {
  generatedAt: new Date().toISOString(),
  checkedAt,
  mode,
  status:
    mode === 'render' ? 'rendered' : errors.length === 0 ? 'exact' : 'mismatch',
  issue: summarizeIssue(after),
  plan: {
    bytes: Buffer.byteLength(body, 'utf8'),
    sha256: sha256(body),
    commentId: managed[0]?.id ?? null,
  },
  operations,
  checks,
  errors,
}

if (mode !== 'render') {
  await mkdir(path.dirname(outputJson), { recursive: true })
  await writeFile(outputJson, `${JSON.stringify(readback, null, 2)}\n`)
  await writeFile(outputMarkdown, renderMarkdown(readback))
}
console.log(JSON.stringify(readback, null, 2))
if (errors.length > 0) {
  process.exitCode = 1
}

async function readIssue() {
  const comments = []
  let issue
  let after = null
  do {
    const data = await request(
      `query ReadIssuePlan($id: String!, $after: String) {
        issue(id: $id) {
          id identifier title archivedAt
          state { id name type }
          parent { id identifier }
          comments(first: 50, after: $after) {
            nodes { id body createdAt updatedAt }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { id: issueIdentifier, after },
    )
    if (!data.issue) {
      throw new Error('HON-205 was not found')
    }
    issue ??= data.issue
    comments.push(...data.issue.comments.nodes)
    after = data.issue.comments.pageInfo.hasNextPage
      ? data.issue.comments.pageInfo.endCursor
      : null
  } while (after)
  return { ...issue, comments }
}

function assertIssue(issue) {
  if (
    issue.id !== issueId ||
    issue.identifier !== issueIdentifier ||
    issue.archivedAt !== null ||
    issue.state.type !== 'started' ||
    issue.parent?.identifier !== 'HON-160'
  ) {
    throw new Error('HON-205 execution-plan identity or state changed')
  }
}

function managedComments(comments) {
  return comments.filter((comment) => comment.body.includes(marker))
}

async function createComment(commentBody) {
  const data = await request(
    `mutation CreateExecutionPlan($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        success
        comment { id body issue { id identifier } }
      }
    }`,
    { input: { issueId, body: commentBody } },
  )
  if (
    !data.commentCreate?.success ||
    data.commentCreate.comment?.body !== commentBody ||
    data.commentCreate.comment?.issue?.id !== issueId
  ) {
    throw new Error('Linear did not create the HON-205 execution plan')
  }
}

async function updateComment(id, commentBody) {
  const data = await request(
    `mutation UpdateExecutionPlan($id: String!, $input: CommentUpdateInput!) {
      commentUpdate(id: $id, input: $input) {
        success
        comment { id body issue { id identifier } }
      }
    }`,
    { id, input: { body: commentBody } },
  )
  if (
    !data.commentUpdate?.success ||
    data.commentUpdate.comment?.body !== commentBody ||
    data.commentUpdate.comment?.issue?.id !== issueId
  ) {
    throw new Error('Linear did not update the HON-205 execution plan')
  }
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
    throw new Error(`HON-205 plan sync failed: ${messages.join('; ')}`)
  }
  return payload.data
}

function summarizeIssue(issue) {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    state: issue.state,
    archivedAt: issue.archivedAt,
    parent: issue.parent?.identifier ?? null,
    managedCommentCount: managedComments(issue.comments).length,
  }
}

function renderMarkdown(readback) {
  return `# HON-205 Linear Plan Readback

- Generated at: \`${readback.generatedAt}\`
- Status: \`${readback.status}\`
- Issue: ${readback.issue.identifier} / ${readback.issue.state.name}
- Parent: ${readback.issue.parent}
- Managed comment count: ${readback.issue.managedCommentCount}
- Plan bytes: ${readback.plan.bytes}
- Plan SHA-256: \`${readback.plan.sha256}\`
- Comment: \`${readback.plan.commentId}\`
- Operations: ${readback.operations.join(', ') || 'read-only verification'}
- Errors: ${readback.errors.length === 0 ? 'none' : readback.errors.join(', ')}
`
}

function parseMode(args) {
  if (
    args.length !== 1 ||
    !['--render', '--apply', '--verify'].includes(args[0])
  ) {
    throw new Error('usage: sync-linear-plan.mjs --render|--apply|--verify')
  }
  return args[0].slice(2)
}

function containsControlCharacter(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint <= 0x1f || codePoint === 0x7f
  })
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

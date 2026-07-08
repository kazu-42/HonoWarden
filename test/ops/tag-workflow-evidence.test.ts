import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// @ts-expect-error script helper intentionally ships as plain ESM.
import { resolveTagWorkflowEvidenceOptions } from '../../scripts/honowarden-tag-workflow-evidence.mjs'

describe('tag workflow evidence defaults', () => {
  it('fills missing tag workflow evidence from the release tag recovery workflow state', async () => {
    const repoRoot = await createRepoRootWithTagWorkflowState({
      run: '12345',
      url: 'https://example.invalid/actions/runs/12345',
      headSha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
    })

    const options = resolveTagWorkflowEvidenceOptions(
      {
        expectedCommit: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
        tagWorkflowRunId: null,
        tagWorkflowUrl: null,
      },
      repoRoot,
    )

    expect(options).toMatchObject({
      expectedCommit: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
      tagWorkflowRunId: '12345',
      tagWorkflowUrl: 'https://example.invalid/actions/runs/12345',
      tagWorkflowHeadSha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
    })
  })

  it('preserves explicit tag workflow evidence', async () => {
    const repoRoot = await createRepoRootWithTagWorkflowState({
      run: '12345',
      url: 'https://example.invalid/actions/runs/12345',
      headSha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
    })

    const options = resolveTagWorkflowEvidenceOptions(
      {
        tagWorkflowRunId: '99999',
        tagWorkflowUrl: 'https://example.invalid/actions/runs/99999',
      },
      repoRoot,
    )

    expect(options.tagWorkflowRunId).toBe('99999')
    expect(options.tagWorkflowUrl).toBe(
      'https://example.invalid/actions/runs/99999',
    )
  })

  it('does not mix a partial explicit run id with default workflow evidence', async () => {
    const repoRoot = await createRepoRootWithTagWorkflowState({
      run: '12345',
      url: 'https://example.invalid/actions/runs/12345',
      headSha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
    })

    const options = resolveTagWorkflowEvidenceOptions(
      {
        tagWorkflowRunId: '99999',
        tagWorkflowUrl: null,
      },
      repoRoot,
    )

    expect(options.tagWorkflowRunId).toBe('99999')
    expect(options.tagWorkflowUrl).toBeNull()
    expect(options.tagWorkflowHeadSha).toBeUndefined()
  })

  it('does not mix a partial explicit URL with default workflow evidence', async () => {
    const repoRoot = await createRepoRootWithTagWorkflowState({
      run: '12345',
      url: 'https://example.invalid/actions/runs/12345',
      headSha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
    })

    const options = resolveTagWorkflowEvidenceOptions(
      {
        tagWorkflowRunId: null,
        tagWorkflowUrl: 'https://example.invalid/actions/runs/99999',
      },
      repoRoot,
    )

    expect(options.tagWorkflowRunId).toBeNull()
    expect(options.tagWorkflowUrl).toBe(
      'https://example.invalid/actions/runs/99999',
    )
    expect(options.tagWorkflowHeadSha).toBeUndefined()
  })

  it('can be disabled for strict missing-evidence checks', async () => {
    const repoRoot = await createRepoRootWithTagWorkflowState({
      run: '12345',
      url: 'https://example.invalid/actions/runs/12345',
      headSha: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd',
    })

    const options = resolveTagWorkflowEvidenceOptions(
      {
        defaultTagWorkflowEvidence: false,
        tagWorkflowRunId: null,
        tagWorkflowUrl: null,
      },
      repoRoot,
    )

    expect(options.tagWorkflowRunId).toBeNull()
    expect(options.tagWorkflowUrl).toBeNull()
  })

  it('leaves options unchanged when workflow state is missing', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'honowarden-empty-state-'))
    const options = { tagWorkflowRunId: null, tagWorkflowUrl: null }

    expect(resolveTagWorkflowEvidenceOptions(options, repoRoot)).toEqual(
      options,
    )
  })
})

async function createRepoRootWithTagWorkflowState(check: {
  headSha: string
  run: string
  url: string
}) {
  const repoRoot = await mkdtemp(join(tmpdir(), 'honowarden-tag-workflow-'))
  const workflowDir = join(
    repoRoot,
    '.workflow',
    'week-26-release-tag-recovery',
  )
  await mkdir(workflowDir, { recursive: true })
  await writeFile(
    join(workflowDir, 'state.json'),
    JSON.stringify(
      {
        verification: {
          checks: [
            {
              name: 'Release Tag Verification',
              status: 'passed',
              run: check.run,
              url: check.url,
              headSha: check.headSha,
            },
          ],
        },
      },
      null,
      2,
    ),
  )

  return repoRoot
}

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

interface WorkflowPacket {
  id: string
  status: string
  linear: string
  result: string | null
  subpackets?: WorkflowPacket[]
}

interface WorkflowState {
  status: string
  active_packet: string
  packets: WorkflowPacket[]
  verification: {
    status: string
    results: Record<string, unknown>
  }
}

interface LinearPlanReadback {
  generatedAt: string
  status: string
  expectedChildren: number
  verifiedChildren: number
  expectedBlockRelations: number
  verifiedBlockRelations: number
  unexpectedBlockRelations: number
  managedComment: {
    id: string
    updatedAt: string
    bytes: number
    sha256: string
    checks: Record<string, boolean>
  }
  errors: string[]
}

const repoRoot = join(import.meta.dirname, '../..')
const workflowRoot = '.workflow/hon-207-credential-closeout'
const state = readJson<WorkflowState>(`${workflowRoot}/state.json`)

describe('HON-223 review closeout packet', () => {
  it('closes EVIDENCE-1 and makes CLOSE-1 the only active packet', () => {
    expect(state.status).toBe('in_progress')
    expect(state.active_packet).toBe('05-review-closeout')
    expect(
      state.packets.map((packet) => [packet.id, packet.status, packet.result]),
    ).toEqual([
      [
        '01-official-client-harness',
        'completed',
        'results/01-official-client-harness.md',
      ],
      [
        '02-credential-lifecycle',
        'completed',
        'results/02-credential-lifecycle.md',
      ],
      ['03-recovery-restore', 'completed', 'results/03-recovery-restore.md'],
      [
        '04-compatibility-evidence',
        'completed',
        'results/04-compatibility-evidence.md',
      ],
      ['05-review-closeout', 'in_progress', 'results/05-review-closeout.md'],
    ])
    expect(
      state.packets.filter((packet) => packet.status === 'in_progress'),
    ).toHaveLength(1)
  })

  it('binds HON-229 publication and HON-222 bottom-up closeout exactly', () => {
    expect(state.verification.status).toBe('close_1_reset_candidate')
    expect(state.verification.results.evidence1cPublication).toEqual({
      base: '32a7bdd6bf54e61c0cfd3c5dd7df2ceab8f177f3',
      reviewed_head: 'a8c8e62997b95c7c5f4090258cdcd53a0ffeceaf',
      reviewed_tree: 'b02c6f2ae945a4eddb4332a379721a28db9c33f4',
      pull_request: 117,
      exact_head_ci_run: 30333366333,
      native_review_session: '019fa750-1e0f-7200-af26-a34ff48ccbb6',
      standard_review_agent: '019fa74f-c9d7-7210-ac0f-427b1823604b',
      five_axis_review_agent: '019fa74f-f7d3-74c1-abc9-b66e953ad780',
      unresolved_review_threads: 0,
      merge_commit: '1fb0aa1dcf6d31795a49d2a6ae447a8a49a8f9a3',
      merge_parent: '32a7bdd6bf54e61c0cfd3c5dd7df2ceab8f177f3',
      merge_tree: 'b02c6f2ae945a4eddb4332a379721a28db9c33f4',
      merged_main_ci_run: 30333830513,
    })
    expect(state.verification.results.evidence1cLinearCloseout).toEqual({
      hon_229_archived_at: '2026-07-28T06:13:13.622Z',
      hon_222_archived_at: '2026-07-28T06:14:05.262Z',
    })
  })

  it('pins the exact CLOSE-1 start and HON-164 blocker boundary', () => {
    expect(state.verification.results.close1StartReadback).toEqual({
      main: '1fb0aa1dcf6d31795a49d2a6ae447a8a49a8f9a3',
      main_tree: 'b02c6f2ae945a4eddb4332a379721a28db9c33f4',
      team_wip: ['HON-207', 'HON-223'],
      hon_207_state: 'In Progress',
      hon_223_state: 'In Progress',
      hon_160_state: 'Todo',
      hon_164_state: 'Backlog',
      hon_164_blockers: [
        {
          identifier: 'HON-160',
          relation_id: '20f54857-e200-4214-b59b-da99ef5555c0',
        },
      ],
    })
  })

  it('records the rejected nonconvergent branch without expanding scanner scope', () => {
    expect(state.verification.results.close1Reset).toEqual({
      decided_at: '2026-08-07T02:22:04Z',
      base: '1fb0aa1dcf6d31795a49d2a6ae447a8a49a8f9a3',
      dependency_prerequisite: 'b18d6f754dc12edb746169c01e19dfdab81cd9b8',
      rejected_head: '386f24f15a5b6b89417badfee4635d8e4dc0e10d',
      recovery_ref: 'archive/hon-223-nonconvergent-20260807',
      replacement_branch: 'feat/hon-223-closeout-reset',
      reason: 'repository_wide_presentation_scanner_nonconvergent',
      scanner_scope: 'origin_main_unchanged',
    })

    const manifest = readText(
      `${workflowRoot}/results/05-reset-salvage-manifest.md`,
    )
    expect(manifest).toContain('Do not merge or continue remediating')
    expect(manifest).toContain('scripts/honowarden-credential-closeout.mjs')
    expect(manifest).toContain('Keep `origin/main` Unchanged In This Lane')
  })

  it('binds an exact archived-inclusive HON-207 readback', () => {
    const readback = readJson<LinearPlanReadback>(
      `${workflowRoot}/results/linear-plan-readback.json`,
    )
    const stateReadback = state.verification.results
      .close1LinearPlanReadback as {
      generated_at: string
      children: number
      active_relations: number
      unexpected_relations: number
      managed_comment: {
        id: string
        updated_at: string
        bytes: number
        sha256: string
      }
      errors: number
    }

    expect(readback.status).toBe('exact')
    expect(readback.errors).toEqual([])
    expect(readback.expectedChildren).toBe(5)
    expect(readback.verifiedChildren).toBe(5)
    expect(readback.expectedBlockRelations).toBe(0)
    expect(readback.verifiedBlockRelations).toBe(0)
    expect(readback.unexpectedBlockRelations).toBe(0)
    expect(Object.values(readback.managedComment.checks)).not.toContain(false)
    expect(stateReadback).toEqual({
      generated_at: readback.generatedAt,
      children: readback.verifiedChildren,
      active_relations: readback.expectedBlockRelations,
      unexpected_relations: readback.unexpectedBlockRelations,
      managed_comment: {
        id: readback.managedComment.id,
        updated_at: readback.managedComment.updatedAt,
        bytes: readback.managedComment.bytes,
        sha256: readback.managedComment.sha256,
      },
      errors: readback.errors.length,
    })
  })

  it('records the complete HON-160 child set without stale publication claims', () => {
    const hon160State = readJson<{
      status: string
      linear_checkpoint: {
        children: Array<{
          identifier: string
          state: string
          archived_at: string | null
        }>
      }
    }>('.workflow/hon-160-account-credential-mutation/state.json')
    const startReadback = readJson<{
      parent: { identifier: string; state: string; archivedAt: string | null }
      children: Array<{
        identifier: string
        state: string
        archivedAt: string | null
      }>
    }>(
      '.workflow/hon-160-account-credential-mutation/results/hon-160-closeout-start-readback.json',
    )
    const finalReport = readText(
      '.workflow/hon-160-account-credential-mutation/final-report.md',
    )
    const expectedChildren = [
      'HON-202',
      'HON-203',
      'HON-204',
      'HON-205',
      'HON-206',
      'HON-207',
    ]

    expect(hon160State.status).toBe('closeout_candidate')
    expect(
      hon160State.linear_checkpoint.children.map(
        ({ identifier }) => identifier,
      ),
    ).toEqual(expectedChildren)
    expect(startReadback.parent).toMatchObject({
      identifier: 'HON-160',
      state: 'Todo',
      archivedAt: null,
    })
    expect(startReadback.children.map(({ identifier }) => identifier)).toEqual(
      expectedChildren,
    )
    expect(
      startReadback.children
        .slice(0, 5)
        .every(
          ({ state: childState, archivedAt }) =>
            childState === 'Done' && archivedAt !== null,
        ),
    ).toBe(true)
    expect(startReadback.children[5]).toMatchObject({
      identifier: 'HON-207',
      state: 'In Progress',
      archivedAt: null,
    })
    expect(finalReport).toContain(
      'HON-202 through HON-206 are Done and archived',
    )
    expect(finalReport).toContain('HON-207 and HON-223 remain In Progress')
    expect(finalReport).not.toContain('for draft PR #101')
    expect(finalReport).not.toContain('HON-203 through HON-207 remain blocked')
    expect(finalReport).not.toContain('No merge or `main` readback exists')
  })

  it('keeps the tracked result honest about its external publication gates', () => {
    const evidenceResult = readText(
      `${workflowRoot}/results/04-compatibility-evidence.md`,
    )
    const closeoutResult = readText(
      `${workflowRoot}/results/05-review-closeout.md`,
    )
    const evidence1cResult = readText(
      `${workflowRoot}/results/04c-docs-index-reconciliation.md`,
    )

    expect(evidenceResult).toMatch(
      /^Status: completed; all three subpackets merged, verified on exact main, Done, and archived$/m,
    )
    expect(evidenceResult).toContain('PR #117')
    expect(evidenceResult).toContain('30333830513')
    expect(evidence1cResult).toMatch(
      /^Status: merged, verified on exact main, Done, and archived$/m,
    )
    expect(evidence1cResult).not.toContain('## Closeout Pending')

    expect(closeoutResult).toMatch(
      /^Status: reset publication candidate; exact-head and post-merge gates are external$/m,
    )
    expect(closeoutResult).toContain('## Reset Decision')
    expect(closeoutResult).toContain('archive/hon-223-nonconvergent-20260807')
    expect(closeoutResult).toContain('HON-223 remains In Progress')
    expect(closeoutResult).toContain('must not claim its own review or merge')
    expect(closeoutResult).not.toContain('## Initial Review And Remediation')
    expect(closeoutResult).not.toContain('The scanner now')
    expect(closeoutResult).not.toMatch(
      /production credential writer activation is verified/i,
    )
  })

  it('publishes the parent closeout in current-state without inflating evidence', () => {
    const currentState = readText('docs/current-state.md')

    expect(currentState).toMatch(/^Last updated: 2026-09-01$/m)
    expect(currentState).toContain(
      '## 2026-07-28 HON-222 Evidence Parent Closeout',
    )
    expect(currentState).toContain('PR #117')
    expect(currentState).toContain('30333830513')
    expect(currentState).toContain(
      'No staging or production credential activation was performed',
    )
    for (const historicalHeading of [
      '## Week 26 Staging Dry Run Evidence',
      '## Week 26 Cloudflare Resource Evidence',
      '## Week 26 Live Client Evidence',
    ]) {
      const sectionStart = currentState.indexOf(historicalHeading)
      expect(sectionStart).toBeGreaterThanOrEqual(0)
      const nextSection = currentState.indexOf('\n## ', sectionStart + 4)
      const section = currentState.slice(
        sectionStart,
        nextSection === -1 ? undefined : nextSection,
      )
      expect(section).toContain('Historical checkpoint:')
      expect(section).toMatch(/not\s+the current capability\s+state/)
    }
  })
})

function readText(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}

function readJson<T>(path: string): T {
  return JSON.parse(readText(path)) as T
}

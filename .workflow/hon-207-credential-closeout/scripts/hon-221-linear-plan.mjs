export const hon221LinearPlan = {
  parentIdentifier: 'HON-221',
  parentId: '7f868193-8232-4d35-b905-f7c73515f889',
  parentTitle: 'Account A2f.3: backup restore, disable, and forward recovery',
  projectName: 'HonoWarden Post-Alpha Roadmap',
  priority: 0,
  labels: [
    'type:feature',
    'area:auth',
    'area:ops',
    'risk:security',
    'evidence:required',
    'agent:codex',
  ],
  issues: [
    {
      key: 'RECOVERY-1A',
      packet: '03a-generation-bound-backup',
      title: 'Account A2f.3a: generation-bound local backup contract',
      stateType: 'started',
      blockers: [],
      goal: 'Bind a local backup to the approved final credential generation and reject restore-source drift before mutation commands execute.',
      scope: [
        'Add optional redaction-safe generation binding and explicit expected manifest/generation SHA-256 gates to the backup CLI.',
        'Route local D1 export through an owned Wrangler config so it reads the exact lifecycle source persistence without ambient-state fallback.',
        'Preserve generic unbound backup compatibility and add focused mismatch, tamper, routing, cleanup, and secret-scan tests.',
      ],
      acceptance: [
        'Manifest or generation mismatch fails before any D1 import or R2 put process is spawned.',
        'A real local export reports deterministic D1/R2 hashes for the approved final generation and contains no secret material.',
        'Exact-head reviews, PR/head CI, squash tree equality, merged-main CI, and Linear Done/archive pass before RECOVERY-1B starts.',
      ],
    },
    {
      key: 'RECOVERY-1B',
      packet: '03b-fresh-restore',
      title: 'Account A2f.3b: fresh restore and stale-generation rejection',
      stateType: 'unstarted',
      blockers: ['RECOVERY-1A'],
      goal: 'Restore the approved generation-bound backup into owned fresh persistence and prove only the final generation remains usable.',
      scope: [
        'Reject non-empty, symlinked, unowned, or previously initialized targets before restore and keep source and target roots distinct.',
        'Compare canonical D1 and R2 contents, reject every pre-final password/token/profile, and repeat rejection after Worker restart.',
        'Complete pinned official-client login, unlock, sync, and decrypted-item readback against the restored final generation.',
      ],
      acceptance: [
        'Freshness is verified rather than inferred from confirmation, and restore cannot mutate source or ambient persistence.',
        'Restored D1/R2 content is equivalent, every pre-final credential/session is rejected, and current official-client decrypt readback passes.',
        'Exact-head reviews, PR/head CI, squash tree equality, merged-main CI, and Linear Done/archive pass before RECOVERY-1C starts.',
      ],
    },
    {
      key: 'RECOVERY-1C',
      packet: '03c-disable-forward-recovery',
      title: 'Account A2f.3c: default-off writers and forward recovery',
      stateType: 'unstarted',
      blockers: ['RECOVERY-1B'],
      goal: 'Make all credential writers explicit D1-free no-ops while disabled, then commit exactly one forward generation on the same restored target.',
      scope: [
        'Add a default-off password-change flag so password, KDF, account-key, and user-key writers share the tracked rollout boundary.',
        'Run every disabled writer before authentication/D1 access and prove canonical D1/R2 hashes remain unchanged.',
        'Re-enable the isolated Worker and prove one audited stamp/revision advancement, official-client decrypt readback, and rejection of pre-recovery material.',
      ],
      acceptance: [
        'Tracked local, staging, and production configuration keeps all four credential writers default-off.',
        'Disabled and enabled phases use the same restored persistence without a reset; retry or concurrency cannot commit a second recovery generation.',
        'Exact-head reviews, PR/head CI, squash tree equality, merged-main CI, Linear child closeout, and HON-221 integration readback all pass.',
      ],
    },
  ],
}

const checkpointMarker = '<!-- honowarden-managed:HON-221:execution-plan -->'

export function canonicalHon221Marker(definition) {
  return `<!-- honowarden-managed:HON-221:${definition.key} -->`
}

export function renderHon221ChildDescription(definition, identifiers) {
  const dependency =
    definition.blockers.length === 0
      ? 'None. This is the first serialized recovery packet.'
      : definition.blockers
          .map(
            (key) =>
              `${identifiers[key] ?? key} must be merged, verified on exact main, and archived before this packet starts.`,
          )
          .join(' ')

  return [
    canonicalHon221Marker(definition),
    '',
    `# ${definition.key} execution packet`,
    '',
    '## Goal',
    '',
    definition.goal,
    '',
    '## Scope',
    '',
    ...definition.scope.map((item) => `* ${item}`),
    '',
    '## Acceptance criteria',
    '',
    ...definition.acceptance.map((item) => `* ${item}`),
    '',
    '## Dependency',
    '',
    dependency,
    '',
    '## Safety boundary',
    '',
    'Local synthetic state only. Deployment, remote D1/R2 mutation, production activation, real credentials or secrets, destructive operations, paid actions, and third-party contact are excluded. Restore is disaster recovery from the approved final generation; credential recovery is forward-only.',
    '',
    `Workflow packet: \`${definition.packet}\`.`,
  ].join('\n')
}

export function renderHon221ExecutionCheckpoint(identifiers) {
  const rows = hon221LinearPlan.issues.map((definition) => {
    const identifier = identifiers[definition.key] ?? definition.key
    const blockers = definition.blockers
      .map((key) => identifiers[key] ?? key)
      .join(', ')
    return `- ${identifier} (${definition.key}): ${definition.title}; ${stateLabel(definition.stateType)}; blockers: ${blockers || 'none'}.`
  })

  return [
    checkpointMarker,
    '# HON-221 recovery execution plan',
    '',
    'Status: three serialized implementation packets; only RECOVERY-1A is active.',
    '',
    'Sub-issue sequence:',
    ...rows,
    '',
    'Integration invariants:',
    '- Restore accepts only the approved final-generation manifest and writes only to verified-fresh owned local persistence.',
    '- Raw passwords, tokens, sessions, keys, encrypted bodies, decrypted vault values, and profile data remain outside committed evidence.',
    '- Disabled and enabled Workers bind the same restored D1/R2 state; disabled writers return before authentication and D1 access.',
    '- Recovery creates one newly authenticated forward generation and never revives historical credentials or sessions.',
    '',
    'Per-child closeout:',
    '- Focused/full gates, exact-head standard and five-axis review, PR/head CI, zero unresolved threads, squash tree equality, merged-main CI, and Linear Done/archive.',
    '',
    'Boundary: no deployment, remote mutation, production activation, real credential or secret, destructive operation, paid action, or third-party contact is authorized.',
  ].join('\n')
}

export function hon221ExecutionCheckpointMarker() {
  return checkpointMarker
}

export function validateHon221Plan(plan = hon221LinearPlan) {
  const keys = new Set()
  const titles = new Set()
  const packets = new Set()
  let started = 0

  for (const issue of plan.issues) {
    if (keys.has(issue.key))
      throw new Error(`duplicate issue key: ${issue.key}`)
    if (titles.has(issue.title)) {
      throw new Error(`duplicate issue title: ${issue.title}`)
    }
    if (packets.has(issue.packet)) {
      throw new Error(`duplicate workflow packet: ${issue.packet}`)
    }
    if (!['completed', 'started', 'unstarted'].includes(issue.stateType)) {
      throw new Error(`invalid state type for ${issue.key}`)
    }
    if (issue.stateType === 'started') started += 1
    keys.add(issue.key)
    titles.add(issue.title)
    packets.add(issue.packet)
  }
  if (started !== 1) {
    throw new Error(`exactly one started packet is required; found ${started}`)
  }

  for (const issue of plan.issues) {
    for (const blocker of issue.blockers) {
      if (!keys.has(blocker)) {
        throw new Error(`${issue.key} has unknown blocker ${blocker}`)
      }
      if (blocker === issue.key) {
        throw new Error(`${issue.key} cannot block itself`)
      }
    }
  }

  const byKey = new Map(plan.issues.map((issue) => [issue.key, issue]))
  const visited = new Set()
  const active = new Set()
  const visit = (key) => {
    if (active.has(key)) throw new Error(`dependency cycle includes ${key}`)
    if (visited.has(key)) return
    active.add(key)
    for (const blocker of byKey.get(key).blockers) visit(blocker)
    active.delete(key)
    visited.add(key)
  }
  for (const key of keys) visit(key)
}

export function summarizeHon221Plan(plan = hon221LinearPlan) {
  validateHon221Plan(plan)
  return {
    parent: plan.parentIdentifier,
    labels: plan.labels,
    issues: plan.issues.map((issue) => ({
      key: issue.key,
      packet: issue.packet,
      title: issue.title,
      stateType: issue.stateType,
      blockers: issue.blockers,
      marker: canonicalHon221Marker(issue),
    })),
    relations: plan.issues.flatMap((issue) =>
      issue.blockers.map((blocker) => ({ blocker, blocked: issue.key })),
    ),
  }
}

function stateLabel(stateType) {
  if (stateType === 'completed') return 'Done'
  return stateType === 'started' ? 'In Progress' : 'Todo'
}

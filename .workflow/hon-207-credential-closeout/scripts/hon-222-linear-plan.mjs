export const hon222LinearPlan = {
  parentIdentifier: 'HON-222',
  parentId: '0879badf-b4b1-4c56-9da5-64d6fb71a994',
  parentTitle:
    'Account A2f.4: compatibility and operations evidence reconciliation',
  projectName: 'HonoWarden Post-Alpha Roadmap',
  priority: 0,
  parentLabels: [
    'type:feature',
    'area:auth',
    'area:docs',
    'area:ops',
    'risk:security',
    'evidence:required',
    'agent:codex',
  ],
  issues: [
    {
      key: 'EVIDENCE-1A',
      identifier: 'HON-227',
      id: '71dc5d6f-e42e-4519-844e-b4b96add30ed',
      packet: '04a-evidence-contract',
      title: 'Account A2f.4a: credential evidence contract and claim registry',
      stateType: 'completed',
      closeout: {
        archivedAt: '2026-07-22T10:11:52.647Z',
        pullRequest: 115,
        mergeCommit: '5b67fbdcf6d32942e5786f4cc49684c479778de8',
        mainCiRun: 29910713312,
        tree: '0297ca848869817cbec3e8f077cd61d313faf239',
      },
      blockers: [],
      labels: [
        'type:feature',
        'area:auth',
        'area:docs',
        'risk:security',
        'evidence:required',
        'agent:codex',
      ],
      goal: 'Define one machine-readable registry that binds every credential claim to its exact evidence level, source generation, artifacts, and residual limitations.',
      scope: [
        'Add an explicit fixture, local_api, local_official_client, staging, and production evidence-level contract without promoting existing claims.',
        'Register password, KDF, account-key, user-key, backup, restore, disabled-route, and forward-recovery claims against exact tracked artifacts and source pins.',
        'Add focused validation that rejects unknown operations, duplicate claims, level inflation, missing artifacts, path escape, source drift, and inconsistent client metadata.',
      ],
      acceptance: [
        'Every registered claim has a unique ID, exact level, existing repository artifact, source generation, and explicit limitations.',
        'A local API artifact cannot satisfy an official-client, staging, or production claim, and live levels require level-appropriate evidence metadata.',
        'Focused compatibility tests, full impact tests, exact-head reviews, PR/head CI, squash tree equality, merged-main CI, and Linear Done/archive pass before EVIDENCE-1B starts.',
      ],
    },
    {
      key: 'EVIDENCE-1B',
      identifier: 'HON-228',
      id: '48f5b632-fdb5-4cb2-8702-edb0f893a622',
      packet: '04b-closeout-packet-secret-scan',
      title:
        'Account A2f.4b: canonical credential closeout packet and secret scan',
      stateType: 'started',
      blockers: ['EVIDENCE-1A'],
      labels: [
        'type:ops',
        'area:auth',
        'area:docs',
        'area:ops',
        'risk:security',
        'evidence:required',
        'agent:codex',
      ],
      goal: 'Generate one deterministic credential-closeout packet from the validated registry and fail closed when committed evidence contains secret-bearing material.',
      scope: [
        'Build a canonical packet containing only allowlisted claim IDs, source pins, levels, statuses, counts, paths, limitations, and digests.',
        'Scan the packet and its owned evidence artifacts for passwords, raw access or refresh tokens, wrapped or unwrapped keys, encrypted item bodies, identities, provider payloads, profiles, and secret-like schema fields.',
        'Reject missing, stale, extra, symlinked, non-regular, path-escaping, non-deterministic, or secret-bearing inputs before publishing the packet.',
      ],
      acceptance: [
        'Two runs over the same approved inputs produce byte-identical output and digest without timestamps or environment-dependent paths.',
        'Positive leak fixtures for every prohibited secret class fail, while approved digests, versions, counts, enums, and repository paths remain accepted.',
        'Focused scanner/generator tests, full impact tests, exact-head reviews, PR/head CI, squash tree equality, merged-main CI, and Linear Done/archive pass before EVIDENCE-1C starts.',
      ],
    },
    {
      key: 'EVIDENCE-1C',
      identifier: 'HON-229',
      id: '672786f1-e7ab-4337-846a-c8dcd8c46fa5',
      packet: '04c-docs-index-reconciliation',
      title:
        'Account A2f.4c: compatibility and operations documentation reconciliation',
      stateType: 'unstarted',
      blockers: ['EVIDENCE-1B'],
      labels: [
        'type:docs',
        'area:auth',
        'area:docs',
        'area:ops',
        'risk:security',
        'evidence:required',
        'agent:codex',
      ],
      goal: 'Reconcile all user-facing compatibility, operations, security, and release claims against the canonical credential-closeout packet.',
      scope: [
        'Update compatibility matrix and fixture inventory language, current state, data flow, audit/retention, backup/restore, rollback, operator, release, and security indexes.',
        'Link each credential operation to the canonical packet and exact underlying artifact while keeping API-only, official-client, staging, production, Web Vault, and remote activation boundaries explicit.',
        'Add cross-document tests that reject missing canonical links, contradictory feature flags, unsupported live claims, stale limitations, and orphaned evidence paths.',
      ],
      acceptance: [
        'Release and security indexes expose exactly one canonical credential-closeout entry and its residual limitations.',
        'No document promotes local synthetic evidence to staging or production, and every claimed level agrees with the machine-readable registry.',
        'Compatibility, security, release, full, static, audit, and exact-head review gates pass before HON-222 integration closeout.',
      ],
    },
  ],
}

const checkpointMarker = '<!-- honowarden-managed:HON-222:execution-plan -->'

export function canonicalHon222Marker(definition) {
  return `<!-- honowarden-managed:HON-222:${definition.key} -->`
}

export function renderHon222ChildDescription(definition, identifiers) {
  const dependency =
    definition.blockers.length === 0
      ? 'HON-221 is Done and archived. This is the first serialized evidence packet.'
      : definition.blockers
          .map(
            (key) =>
              `${identifiers[key] ?? key} must be merged, verified on exact main, moved to Done, and archived before this packet starts.`,
          )
          .join(' ')

  return [
    canonicalHon222Marker(definition),
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
    'Repository and isolated local synthetic evidence only. Deployment, remote D1/R2 mutation, production or staging activation, real-account credential rotation, plaintext or real secrets, normal browser profiles, destructive data changes, paid actions, and third-party contact are excluded. Evidence levels must remain conservative.',
    '',
    `Workflow packet: \`${definition.packet}\`.`,
  ].join('\n')
}

export function renderHon222ExecutionCheckpoint(identifiers) {
  const evidence1a = identifiers['EVIDENCE-1A'] ?? 'EVIDENCE-1A'
  const evidence1b = identifiers['EVIDENCE-1B'] ?? 'EVIDENCE-1B'
  const evidence1c = identifiers['EVIDENCE-1C'] ?? 'EVIDENCE-1C'
  return [
    checkpointMarker,
    '# HON-222 compatibility evidence execution plan',
    '',
    'Status: EVIDENCE-1A is complete and archived; EVIDENCE-1B is the only active child.',
    '',
    'Sub-issue sequence:',
    `- ${evidence1a} (EVIDENCE-1A): Done and archived at 2026-07-22T10:11:52.647Z. PR #115 was squash-merged as 5b67fbdcf6d32942e5786f4cc49684c479778de8; merged-main CI run 29910713312 passed and the squash tree equals the reviewed branch tree.`,
    `- ${evidence1b} (EVIDENCE-1B): In Progress. Generates the deterministic canonical closeout packet and fails closed on secret-bearing or structurally unsafe evidence.`,
    `- ${evidence1c} (EVIDENCE-1C): Todo; blocked until HON-228 is merged, verified on exact main, moved to Done, and archived.`,
    '',
    'Current WIP invariant: exactly HON-222 plus child HON-228 are In Progress in this execution lane.',
    '',
    'Integration invariants:',
    '- Evidence levels are ordered fixture < local API < local official client < staging < production, and lower-level artifacts cannot satisfy higher-level claims.',
    '- Canonical evidence contains only allowlisted IDs, source pins, levels, statuses, counts, paths, limitations, and digests; secret-bearing material is rejected.',
    '- Documentation remains bound to the machine-readable registry and cannot promote local synthetic evidence to staging or production.',
    '- Web Vault publication, remote activation, real-account mutation, and untested client surfaces remain explicit limitations.',
    '',
    'Per-child closeout requires focused/full gates, exact-head standard and independent five-axis review, PR/head CI, zero unresolved threads, squash tree equality, merged-main CI, and Linear Done/archive.',
    '',
    'Boundary: no deployment, remote mutation, production or staging activation, real credential or secret, destructive operation, paid action, or third-party contact is authorized.',
    '',
  ].join('\n')
}

export function hon222ExecutionCheckpointMarker() {
  return checkpointMarker
}

export function validateHon222Plan(plan = hon222LinearPlan) {
  const keys = new Set()
  const identifiers = new Set()
  const ids = new Set()
  const titles = new Set()
  const packets = new Set()
  let started = 0

  for (const issue of plan.issues) {
    for (const [set, value, label] of [
      [keys, issue.key, 'issue key'],
      [identifiers, issue.identifier, 'identifier'],
      [ids, issue.id, 'issue id'],
      [titles, issue.title, 'title'],
      [packets, issue.packet, 'packet'],
    ]) {
      if (set.has(value)) throw new Error(`duplicate ${label}: ${value}`)
      set.add(value)
    }
    if (!['completed', 'started', 'unstarted'].includes(issue.stateType)) {
      throw new Error(`invalid state type for ${issue.key}`)
    }
    if (issue.stateType === 'started') started += 1
  }
  if (started !== 1) {
    throw new Error(`exactly one started packet is required; found ${started}`)
  }

  for (const issue of plan.issues) {
    for (const blocker of issue.blockers) {
      if (!keys.has(blocker)) {
        throw new Error(`${issue.key} has unknown blocker ${blocker}`)
      }
      if (blocker === issue.key)
        throw new Error(`${issue.key} cannot block itself`)
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

export function summarizeHon222Plan(plan = hon222LinearPlan) {
  validateHon222Plan(plan)
  return {
    parent: plan.parentIdentifier,
    parentLabels: plan.parentLabels,
    issues: plan.issues.map((issue) => ({
      key: issue.key,
      identifier: issue.identifier,
      id: issue.id,
      packet: issue.packet,
      title: issue.title,
      stateType: issue.stateType,
      blockers: issue.blockers,
      labels: issue.labels,
      marker: canonicalHon222Marker(issue),
    })),
    relations: plan.issues.flatMap((issue) =>
      issue.blockers.map((blocker) => ({ blocker, blocked: issue.key })),
    ),
  }
}

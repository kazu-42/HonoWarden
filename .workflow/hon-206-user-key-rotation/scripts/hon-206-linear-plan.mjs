export const hon206LinearPlan = {
  parentIdentifier: 'HON-206',
  parentId: '027b6b48-ce60-4bfd-9442-496342a8db8b',
  parentTitle:
    'Account A2e: atomic user-key rotation across personal vault data',
  projectName: 'HonoWarden Post-Alpha Roadmap',
  priority: 0,
  sourcePins: {
    server: 'v2026.6.1@a09c7edb03ae6d4fdece784f1250c67be73d5fe0',
    clients: 'web-v2026.6.1@39f07436ca60e3f25eac47777671754f288a98f1',
    base: '955a9703dd74ae7a26221fe8ccd4ee875e09fd07',
  },
  issues: [
    {
      key: 'ROT-1',
      packet: '01-contract-domain',
      title: 'Account A2e.1: strict V1 rotation contract and parser',
      stateType: 'started',
      blockers: [],
      goal: 'Pin and parse the complete V1 user-key rotation envelope without adding a route or database mutation.',
      scope: [
        'Model the pinned master-password, V1 account-key, personal cipher/folder/attachment, and trusted-device request fields.',
        'Use exact nested allowlists, bounded opaque values, alias consistency, unique identifiers, and immutable metadata.',
        'Reject V2, Send, Emergency Access, organization recovery, WebAuthn, TDE, Key Connector, and other unsupported non-empty data.',
      ],
      acceptance: [
        'Red tests cover malformed, partial, duplicate, oversized, V2, unsupported, metadata-changing, and observably stale candidates.',
        'Legacy and publicKeyEncryptionKeyPair V1 values must agree exactly; the account public key is represented as immutable.',
        'The unchanged salt/KDF generation and all supported record manifests are explicit typed outputs.',
      ],
    },
    {
      key: 'ROT-2',
      packet: '02-atomic-repository',
      title: 'Account A2e.2: atomic personal-vault rotation transaction',
      stateType: 'unstarted',
      blockers: ['ROT-1'],
      goal: 'Commit one complete supported user-key generation or no state under D1 limits.',
      scope: [
        'Read and validate exact current personal folder, cipher, uploaded attachment, trusted-device, and credential snapshots.',
        'Build a bounded multi-row D1 batch for ciphertext, wrapped keys, stamp/revision, sessions, auth requests, and one audit row.',
        'Keep R2 object identity and bytes immutable while updating only owned encrypted attachment metadata.',
      ],
      acceptance: [
        'Foreign, duplicate, missing, deleted, pending-upload, stale observable revision, or over-budget requests enter no batch.',
        'A lost generation race changes no downstream row and returns conflict; any statement failure rolls the entire batch back.',
        'Fake tests and real local D1 prove exact counts, abort, concurrency, and post-rotation readback.',
      ],
    },
    {
      key: 'ROT-3',
      packet: '03-route-consistency',
      title: 'Account A2e.3: default-off API and generation consistency',
      stateType: 'unstarted',
      blockers: ['ROT-2'],
      goal: 'Expose the pinned route behind an exact-true default-off gate with safe acknowledgement ordering.',
      scope: [
        'Order feature gate, authentication, parser, credential-proof defense, notification preflight, snapshot validation, and D1 mutation.',
        'Return explicit request, proof, conflict, budget, unsupported-state, and infrastructure responses without secret leakage.',
        'Schedule generation-aware notification cleanup after D1 success and keep all outward projections consistent after relogin.',
      ],
      acceptance: [
        'Every tracked environment remains false and disabled POST/HEAD stays D1-free even with global quota enabled.',
        'Old access/refresh generations fail; new token/profile/sync/backup read back one complete generation after restart.',
        'Focused route, compatibility fixture, config, incident, and session-ordering tests pass.',
      ],
    },
    {
      key: 'ROT-4',
      packet: '04-evidence-publication',
      title: 'Account A2e.4: lifecycle evidence, review, and closeout',
      stateType: 'unstarted',
      blockers: ['ROT-3'],
      goal: 'Integrate evidence, publish one reviewed source generation, and close the HON-206 hierarchy.',
      scope: [
        'Run real-D1 populated-vault, R2 sentinel, abort, concurrency, restart, and old-generation rejection evidence.',
        'Run focused/full/compatibility/release gates plus exact-head standard and independent five-axis reviews.',
        'Publish PR/CI, admin squash merge, exact-main CI, Linear Done/archive, HON-207 advancement, and local cleanup.',
      ],
      acceptance: [
        'No P1/P2/P3 finding remains and the reviewed head tree equals the squash merge tree.',
        'All four sub-issues and HON-206 are Done and archived with trash false only after merged-main CI.',
        'No deployment, remote database mutation, real-account rotation, secret rotation, or compatibility promotion occurs.',
      ],
    },
  ],
}

const parentCommentMarker = '<!-- honowarden-managed:HON-206:execution-plan -->'

export function canonicalMarker(definition) {
  return `<!-- honowarden-managed:HON-206:${definition.key} -->`
}

export function renderChildDescription(definition, identifiers) {
  const dependencies =
    definition.blockers.length === 0
      ? 'None. This is the first serialized packet.'
      : definition.blockers
          .map(
            (key) =>
              `${identifiers[key] ?? key} must complete before this packet starts.`,
          )
          .join(' ')

  return [
    canonicalMarker(definition),
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
    dependencies,
    '',
    '## Safety boundary',
    '',
    'Production activation, remote D1 mutation, real-account credential rotation, plaintext secrets, unwrapped keys, paid actions, and third-party contact are outside this packet. Rollback is feature disable plus a new authenticated forward generation, never restoration of old credential state.',
    '',
    `Workflow packet: \`${definition.packet}\`.`,
  ].join('\n')
}

export function renderExecutionCheckpoint(identifiers) {
  const rows = hon206LinearPlan.issues.map((definition) => {
    const identifier = identifiers[definition.key] ?? definition.key
    const blockers = definition.blockers
      .map((key) => identifiers[key] ?? key)
      .join(', ')
    return `- ${identifier} (${definition.key}): ${definition.title}; ${definition.stateType === 'started' ? 'In Progress' : 'Todo'}; blockers: ${blockers || 'none'}.`
  })

  return [
    parentCommentMarker,
    '# HON-206 execution plan',
    '',
    'Status: HON-206 is the active AUTH-2E slice. Work is serialized through four visible sub-issues; the feature remains default-off until exact-main closeout.',
    '',
    'Source pins:',
    `- Server: ${hon206LinearPlan.sourcePins.server}.`,
    `- Clients: ${hon206LinearPlan.sourcePins.clients}.`,
    `- Merged base: ${hon206LinearPlan.sourcePins.base}.`,
    '',
    'Sub-issue sequence:',
    ...rows,
    '',
    'Contract decisions:',
    '- V1 only: the account public key is unchanged and the private key is rewrapped under the new user key.',
    '- Non-empty Send, Emergency Access, organization recovery, WebAuthn, V2, TDE, Key Connector, or organization-owned data fails before mutation.',
    '- The pinned cipher envelope carries observable revision data; the pinned folder envelope does not. Folder writes are guarded against the exact current server snapshot without claiming an unexpressed client revision proof.',
    '- Deleted records and pending attachments block rotation; uploaded R2 object keys and bytes remain unchanged.',
    '- D1 query/parameter/time budgets are checked before the one transactional batch.',
    '',
    'Completion gates:',
    '- Focused TDD, real local D1 abort/concurrency/restart, R2 sentinel, full/compatibility/release gates.',
    '- Exact-head standard review, independent five-axis review, PR CI, zero unresolved threads, admin squash merge, and exact-main CI.',
    '- Sub-issues and HON-206 become Done and archive with trash false; HON-207 advances only after blocker readback.',
    '',
    'Boundary: no deployment, remote D1 mutation, real-account rotation, secret rotation, compatibility promotion, paid action, destructive data operation, or third-party contact is authorized.',
  ].join('\n')
}

export function executionCheckpointMarker() {
  return parentCommentMarker
}

export function validatePlan(plan = hon206LinearPlan) {
  const keys = new Set()
  const titles = new Set()
  const packets = new Set()

  for (const issue of plan.issues) {
    if (keys.has(issue.key)) {
      throw new Error(`duplicate issue key: ${issue.key}`)
    }
    if (titles.has(issue.title)) {
      throw new Error(`duplicate issue title: ${issue.title}`)
    }
    if (packets.has(issue.packet)) {
      throw new Error(`duplicate workflow packet: ${issue.packet}`)
    }
    if (!['started', 'unstarted'].includes(issue.stateType)) {
      throw new Error(`invalid state type for ${issue.key}`)
    }
    keys.add(issue.key)
    titles.add(issue.title)
    packets.add(issue.packet)
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

  const visited = new Set()
  const active = new Set()
  const byKey = new Map(plan.issues.map((issue) => [issue.key, issue]))
  const visit = (key) => {
    if (active.has(key)) {
      throw new Error(`dependency cycle includes ${key}`)
    }
    if (visited.has(key)) {
      return
    }
    active.add(key)
    for (const blocker of byKey.get(key).blockers) {
      visit(blocker)
    }
    active.delete(key)
    visited.add(key)
  }
  for (const key of keys) {
    visit(key)
  }
}

export function summarizePlan(plan = hon206LinearPlan) {
  validatePlan(plan)
  return {
    parent: plan.parentIdentifier,
    sourcePins: plan.sourcePins,
    issues: plan.issues.map((issue) => ({
      key: issue.key,
      packet: issue.packet,
      title: issue.title,
      stateType: issue.stateType,
      blockers: issue.blockers,
      marker: canonicalMarker(issue),
    })),
    relations: plan.issues.flatMap((issue) =>
      issue.blockers.map((blocker) => ({ blocker, blocked: issue.key })),
    ),
  }
}

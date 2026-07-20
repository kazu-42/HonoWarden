export const hon207LinearPlan = {
  parentIdentifier: 'HON-207',
  parentId: '928bbc28-2ad2-425f-bcbf-a5b9e3087969',
  parentTitle:
    'Account A2f: official-client credential-mutation and rollback closeout',
  projectName: 'HonoWarden Post-Alpha Roadmap',
  priority: 0,
  sourcePins: {
    server: 'v2026.6.1@a09c7edb03ae6d4fdece784f1250c67be73d5fe0',
    web: 'web-v2026.6.1@39f07436ca60e3f25eac47777671754f288a98f1',
    browser: 'browser-v2026.6.1@723c075bf8b9f45c901e56195be8e94e43ed75a2',
    cli: 'cli-v2026.6.0@e6293ff2bc85123e9baaa998cf1543030ec5d9f0',
    base: 'a68ec0ccf0c5379ce228dce93f4f8eef05f6d6f3',
    assets: {
      cliNpm:
        '31765936eef9beca89298ffb554a658138932d505deebc6b65e02baa065c0660',
      cliMacArm64:
        '57d1e60d7748c6efed96559833ce0423a5c825cbf1356d952970c87a497a64d4',
      browserChrome:
        'fcd29c5971d9b218ad9159717a19c38cca5150f2a0aa909ddf805bd7695d097e',
    },
  },
  issues: [
    {
      key: 'CLIENT-1',
      packet: '01-official-client-harness',
      title: 'Account A2f.1: pinned official-client crypto harness',
      stateType: 'started',
      blockers: [],
      goal: 'Build a deterministic, redaction-safe harness around exact official CLI and browser release assets.',
      scope: [
        'Verify official tags, commits, asset IDs, sizes, SHA-256 values, manifests, and reported versions before execution.',
        'Run public CLI login/unlock/sync commands unmodified and expose non-command crypto only through an explicitly labeled ignored test bridge.',
        'Isolate profiles, ports, process groups, environment secrets, stdout/stderr capture, and cleanup from normal Brave and user state.',
      ],
      acceptance: [
        'Official crypto creates and round-trips a V1 user key, account keypair, and encrypted item without hand-rolled cryptography.',
        'Tampered assets, bridge drift, output secret leakage, stale processes, unsafe paths, or profile reuse fail loudly.',
        'Committed evidence contains only source pins, versions, counts, statuses, and digests.',
      ],
    },
    {
      key: 'CLIENT-2',
      packet: '02-credential-lifecycle',
      title: 'Account A2f.2: single-account credential generation lifecycle',
      stateType: 'unstarted',
      blockers: ['CLIENT-1'],
      goal: 'Prove every existing-account credential mutation on one real local D1/R2 account that official clients can still unlock.',
      scope: [
        'Initialize/read account keys, verify/change password, traverse PBKDF2 and Argon2id KDF generations, and rotate the user key with complete personal-vault data.',
        'Use fresh official-client processes/profiles for login, unlock, sync, encrypted-item read, and final browser-extension vault readback.',
        'Reject every old password, access/refresh token, client profile, wrapped key, and vault generation after its owning commit and restart.',
      ],
      acceptance: [
        'One generation manifest links every mutation to exact D1, R2, client, audit, security-stamp, and revision readback without secret material.',
        'A required-audit failure or stale concurrent generation rolls back all owned D1 state and preserves R2 bytes.',
        'Separate per-feature lifecycle reports do not substitute for the one-account official-client result.',
      ],
    },
    {
      key: 'RECOVERY-1',
      packet: '03-recovery-restore',
      title: 'Account A2f.3: backup restore, disable, and forward recovery',
      stateType: 'unstarted',
      blockers: ['CLIENT-2'],
      goal: 'Prove that the approved final generation survives fresh-target restore and that recovery never rolls credentials backward.',
      scope: [
        'Export the exact final local D1/R2 state and bind restore to its redacted manifest and content digests.',
        'Restore into fresh persistence, reject all pre-final credentials/sessions, and prove current official-client decrypt readback.',
        'Run every writer disabled against the same restored state, then re-enable and complete one new forward credential generation.',
      ],
      acceptance: [
        'A mismatched or historical manifest is rejected before restore execution.',
        'Disabled routes return explicit D1-free unsupported responses and leave restored D1/R2 byte-equivalent.',
        'Forward recovery advances stamp/revision/audit exactly once and old/current-before-recovery generations remain rejected.',
      ],
    },
    {
      key: 'EVIDENCE-1',
      packet: '04-compatibility-evidence',
      title:
        'Account A2f.4: compatibility and operations evidence reconciliation',
      stateType: 'unstarted',
      blockers: ['RECOVERY-1'],
      goal: 'Make every credential claim reviewable at its exact fixture, local API, local official-client, staging, or production level.',
      scope: [
        'Reconcile the compatibility matrix, fixture flow inventory, current state, security data flow, audit/retention, backup/restore, rollback, and operator guidance.',
        'Link every claimed client operation to exact source, asset, lifecycle, cleanup, and limitation evidence.',
        'Keep Web Vault publication, remote activation, real-account mutation, and untested client surfaces explicit and unpromoted.',
      ],
      acceptance: [
        'Schema and tests reject evidence-level inflation or a live claim without its artifact.',
        'Evidence secret scans reject passwords, raw tokens, wrapped/unwrapped keys, encrypted item bodies, identities, and provider payloads.',
        'Release and security indexes expose one canonical credential-closeout packet and residual limitations.',
      ],
    },
    {
      key: 'CLOSE-1',
      packet: '05-review-closeout',
      title: 'Account A2f.5: review, publication, and parent closeout',
      stateType: 'unstarted',
      blockers: ['EVIDENCE-1'],
      goal: 'Publish one exact reviewed source generation and close HON-207 and HON-160 only after merged-main evidence.',
      scope: [
        'Run focused/full/compatibility/static/audit/release/brand gates and remediate standard plus independent five-axis review findings.',
        'Publish PR/head CI, resolve all threads, admin squash merge, verify tree equality, and pass merged-main CI.',
        'Close/archive all five sub-issues, HON-207, and HON-160 with trash false; advance HON-164 only after its complete blocker readback.',
      ],
      acceptance: [
        'No actionable P1/P2/P3 remains and the reviewed head tree equals the squash merge tree.',
        'GitHub, exact local main, Linear hierarchy/comments, and inventory agree before worktree and branch cleanup.',
        'No deployment, remote mutation, production feature activation, real credential rotation, paid action, or third-party contact occurs.',
      ],
    },
  ],
}

const parentCommentMarker = '<!-- honowarden-managed:HON-207:execution-plan -->'

export function canonicalMarker(definition) {
  return `<!-- honowarden-managed:HON-207:${definition.key} -->`
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
    'Production activation, remote D1/R2 mutation, real-account credential rotation, plaintext or real secrets, normal browser profiles, destructive data changes, paid actions, and third-party contact are outside this packet. Recovery is a newly authenticated forward generation, never restoration of old credential state.',
    '',
    `Workflow packet: \`${definition.packet}\`.`,
  ].join('\n')
}

export function renderExecutionCheckpoint(identifiers) {
  const rows = hon207LinearPlan.issues.map((definition) => {
    const identifier = identifiers[definition.key] ?? definition.key
    const blockers = definition.blockers
      .map((key) => identifiers[key] ?? key)
      .join(', ')
    return `- ${identifier} (${definition.key}): ${definition.title}; ${stateLabel(definition.stateType)}; blockers: ${blockers || 'none'}.`
  })

  return [
    parentCommentMarker,
    '# HON-207 execution plan',
    '',
    'Status: HON-207 is the active AUTH-2F closeout slice. Five visible packets serialize official-client proof, recovery, evidence, and publication.',
    '',
    'Source pins:',
    `- Server: ${hon207LinearPlan.sourcePins.server}.`,
    `- Web: ${hon207LinearPlan.sourcePins.web}.`,
    `- Browser: ${hon207LinearPlan.sourcePins.browser}.`,
    `- CLI: ${hon207LinearPlan.sourcePins.cli}.`,
    `- Merged base: ${hon207LinearPlan.sourcePins.base}.`,
    '',
    'Sub-issue sequence:',
    ...rows,
    '',
    'Evidence decisions:',
    '- Fixture, local API, local official-client, staging, and production are separate levels.',
    '- One account must cross all credential generations; aggregating separate feature lifecycles is insufficient.',
    '- Official CLI public commands remain unmodified. Any crypto-only test bridge is ignored, deterministic, hash-bound, and labeled.',
    '- Normal Brave and personal profiles are excluded; optional extension proof uses an isolated Chrome for Testing profile.',
    '- Restore uses the exact post-generation backup. Credential recovery is forward-only.',
    '',
    'Completion gates:',
    '- Official-client decrypt proof, real local D1/R2, stale generation rejection, backup/restore, disable equality, and forward recovery.',
    '- Full repository gates, exact-head standard review, independent five-axis review, PR/head CI, zero unresolved threads, squash tree equality, and exact-main CI.',
    '- Five sub-issues, HON-207, and HON-160 become Done and archive with trash false only after merged-main readback.',
    '',
    'Boundary: no deployment, remote mutation, real-account or secret rotation, production activation, destructive operation, paid action, or third-party contact is authorized.',
  ].join('\n')
}

export function executionCheckpointMarker() {
  return parentCommentMarker
}

export function advanceLinearPlanVerificationStatus(currentStatus) {
  return currentStatus === 'plan_authored'
    ? 'linear_subissues_synced'
    : currentStatus
}

export function validatePlan(plan = hon207LinearPlan) {
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
    if (!['completed', 'started', 'unstarted'].includes(issue.stateType)) {
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

function stateLabel(stateType) {
  if (stateType === 'completed') {
    return 'Done'
  }
  return stateType === 'started' ? 'In Progress' : 'Todo'
}

export function summarizePlan(plan = hon207LinearPlan) {
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

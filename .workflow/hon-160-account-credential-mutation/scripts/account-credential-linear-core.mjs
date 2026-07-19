import { canonicalMarker } from './account-credential-manifest.mjs'

export function discoverManagedChildren(
  inventory,
  definitions,
  { requireAll },
) {
  const issueByKey = new Map()
  const errors = []
  const titleIndex = indexByTitle(inventory)

  for (const definition of definitions) {
    const marker = canonicalMarker(definition)
    const markerMatches = inventory.filter((issue) =>
      issue.description?.includes(marker),
    )
    const titleMatches = titleIndex.get(definition.title) ?? []

    if (markerMatches.length > 1) {
      errors.push(
        `${definition.key}: canonical marker appears on ${markerMatches.length} issues`,
      )
      continue
    }

    if (markerMatches.length === 1) {
      const [matched] = markerMatches
      if (matched.title !== definition.title) {
        errors.push(
          `${definition.key}: marker is on ${matched.identifier} with a non-canonical title`,
        )
        continue
      }
      if (titleMatches.length !== 1 || titleMatches[0].id !== matched.id) {
        errors.push(
          `${definition.key}: title collision exists outside the canonical marker issue`,
        )
        continue
      }
      issueByKey.set(definition.key, matched)
      continue
    }

    if (titleMatches.length > 0) {
      errors.push(
        `${definition.key}: exact title exists without the canonical marker; manual reconciliation is required`,
      )
      continue
    }

    if (requireAll) {
      errors.push(`${definition.key}: canonical issue is missing`)
    }
  }

  return { issueByKey, errors }
}

export function selectWorkflowStates(states) {
  const unstarted = states.filter(
    (state) => state.type === 'unstarted' && state.name === 'Todo',
  )
  const started = states.filter(
    (state) => state.type === 'started' && state.name === 'In Progress',
  )

  if (unstarted.length !== 1 || started.length !== 1) {
    throw new Error('exactly named Todo and In Progress states are required')
  }

  return { unstarted: unstarted[0], started: started[0] }
}

export function buildExpectedRelationPairs(plan, issueByKey) {
  const pairs = []
  for (const definition of plan.issues) {
    const target = issueByKey.get(definition.key)
    for (const blockerKey of definition.blockers) {
      const blocker = issueByKey.get(blockerKey)
      pairs.push({
        blocker: blocker?.identifier ?? blockerKey,
        blocked: target?.identifier ?? definition.key,
        sourceId: blocker?.id ?? null,
        targetId: target?.id ?? null,
      })
    }
  }
  return pairs
}

export function expectedStateForDefinition(definition, workflowStates) {
  return definition.stateType === 'started'
    ? workflowStates.started
    : workflowStates.unstarted
}

function indexByTitle(issues) {
  const result = new Map()
  for (const issue of issues) {
    const matches = result.get(issue.title) ?? []
    matches.push(issue)
    result.set(issue.title, matches)
  }
  return result
}

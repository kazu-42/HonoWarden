export function auditBlockRelations({
  expectedPairs,
  relations,
  managedIssueIds,
}) {
  const activeRelations = deduplicateRelations(relations).filter(
    (relation) => relation.archivedAt == null && relation.type === 'blocks',
  )
  const errors = []
  const rows = []
  const expectedDirections = new Set()

  for (const expected of expectedPairs) {
    const label = `${expected.blocker} -> ${expected.blocked}`
    if (!expected.sourceId || !expected.targetId) {
      errors.push(`${label}: relation endpoint missing`)
      rows.push({ ...expected, exact: false, relationIds: [] })
      continue
    }

    const direction = relationDirection(expected.sourceId, expected.targetId)
    expectedDirections.add(direction)
    const matches = activeRelations.filter(
      (relation) =>
        relation.issue.id === expected.sourceId &&
        relation.relatedIssue.id === expected.targetId,
    )

    if (matches.length === 0) {
      errors.push(`${label}: relation missing`)
    } else if (matches.length > 1) {
      errors.push(`${label}: ${matches.length} duplicate relations`)
    }

    rows.push({
      ...expected,
      exact: matches.length === 1,
      relationIds: matches.map((relation) => relation.id).sort(),
    })
  }

  const unexpectedByDirection = new Map()
  for (const relation of activeRelations) {
    if (
      !managedIssueIds.has(relation.issue.id) &&
      !managedIssueIds.has(relation.relatedIssue.id)
    ) {
      continue
    }

    const direction = relationDirection(
      relation.issue.id,
      relation.relatedIssue.id,
    )
    if (expectedDirections.has(direction)) {
      continue
    }

    const current = unexpectedByDirection.get(direction) ?? []
    current.push(relation)
    unexpectedByDirection.set(direction, current)
  }

  const unexpectedRows = [...unexpectedByDirection.values()]
    .map((directionRelations) => {
      const [first] = directionRelations
      return {
        blocker: first.issue.identifier,
        blocked: first.relatedIssue.identifier,
        relationIds: directionRelations.map((relation) => relation.id).sort(),
      }
    })
    .sort((left, right) =>
      `${left.blocker}->${left.blocked}`.localeCompare(
        `${right.blocker}->${right.blocked}`,
      ),
    )

  for (const unexpected of unexpectedRows) {
    errors.push(
      `${unexpected.blocker} -> ${unexpected.blocked}: ${unexpected.relationIds.length} unexpected managed relation`,
    )
  }

  return { rows, unexpectedRows, errors }
}

function deduplicateRelations(relations) {
  const byId = new Map()
  for (const relation of relations) {
    if (relation?.id) {
      byId.set(relation.id, relation)
    }
  }
  return [...byId.values()]
}

function relationDirection(sourceId, targetId) {
  return `${sourceId}->${targetId}`
}

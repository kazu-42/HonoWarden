export function auditHon207BlockRelations({
  expectedPairs,
  relations,
  managedIssueIds,
}) {
  const activeManagedBlocks = deduplicateRelations(relations).filter(
    (relation) =>
      relation.archivedAt === null &&
      relation.type === 'blocks' &&
      (managedIssueIds.has(relation.issue.id) ||
        managedIssueIds.has(relation.relatedIssue.id)),
  )
  const expectedKeys = new Set(
    expectedPairs.map((pair) => relationKey(pair.sourceId, pair.targetId)),
  )
  const rows = expectedPairs.map((pair) => {
    const matches = activeManagedBlocks.filter(
      (relation) =>
        relation.issue.id === pair.sourceId &&
        relation.relatedIssue.id === pair.targetId,
    )
    return { ...pair, count: matches.length, exact: matches.length === 1 }
  })
  const unexpectedRows = activeManagedBlocks
    .filter(
      (relation) =>
        !expectedKeys.has(
          relationKey(relation.issue.id, relation.relatedIssue.id),
        ),
    )
    .map((relation) => ({
      id: relation.id,
      blocker: relation.issue.identifier,
      blocked: relation.relatedIssue.identifier,
    }))
    .sort((left, right) =>
      `${left.blocker}->${left.blocked}->${left.id}`.localeCompare(
        `${right.blocker}->${right.blocked}->${right.id}`,
      ),
    )
  const errors = rows
    .filter((row) => row.count !== 1)
    .map((row) =>
      row.count === 0
        ? `${row.blocker} -> ${row.blocked}: relation missing`
        : `${row.blocker} -> ${row.blocked}: duplicate relations`,
    )
  errors.push(
    ...unexpectedRows.map(
      (row) => `${row.blocker} -> ${row.blocked}: unexpected relation`,
    ),
  )
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

function relationKey(sourceId, targetId) {
  return `${sourceId}->${targetId}`
}

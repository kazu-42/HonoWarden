import {
  issueOrganizationAuditCursor,
  organizationAuditAvailability,
  organizationAuditPolicy,
  serializeOrganizationAuditCsv,
  type OrganizationAuditQuery,
} from './domain/organization-audit'
import {
  readOrganizationAuditPage,
  type OrganizationAuditReadInput,
} from './repositories/organization-audit-repository'

type Input = Pick<OrganizationAuditReadInput, 'organizationId' | 'actor'> & {
  query: OrganizationAuditQuery
  cursorSecret: string
  optionalAuditLoggingEnabled: boolean
}

export async function queryOrganizationAuditHistory(
  database: Pick<D1Database, 'prepare'>,
  input: Input,
) {
  if (input.query.limit > organizationAuditPolicy.maxLimit)
    throw new Error('Organization audit query exceeds its row bound.')
  const result = await readOrganizationAuditPage(database, {
    organizationId: input.organizationId,
    actor: input.actor,
    ...input.query,
  })
  if (result.status !== 'success') return result
  const last = result.records.at(-1)
  const continuationToken =
    result.hasMore && last
      ? await issueOrganizationAuditCursor({
          query: input.query,
          organizationId: input.organizationId,
          actorUserId: input.actor.userId,
          position: { occurredAt: last.occurredAt, id: last.id },
          cursorSecret: input.cursorSecret,
        })
      : null
  return {
    status: 'success' as const,
    body: {
      object: 'list' as const,
      data: result.records,
      continuationToken,
      query: {
        from: input.query.from,
        to: input.query.to,
        eventName: input.query.eventName,
        actorUserId: input.query.filterActorUserId,
        limit: input.query.limit,
      },
      availability: organizationAuditAvailability(
        input.optionalAuditLoggingEnabled,
      ),
    },
  }
}

export async function exportOrganizationAuditHistory(
  database: Pick<D1Database, 'prepare'>,
  input: Input,
) {
  const result = await readOrganizationAuditPage(database, {
    organizationId: input.organizationId,
    actor: input.actor,
    ...input.query,
    limit: organizationAuditPolicy.maxExportRows,
    cursor: null,
  })
  if (result.status !== 'success') return result
  if (result.hasMore) return { status: 'export_too_large' as const }
  return {
    status: 'success' as const,
    csv: serializeOrganizationAuditCsv(result.records),
    rowCount: result.records.length,
    from: input.query.from,
    to: input.query.to,
    availability: organizationAuditAvailability(
      input.optionalAuditLoggingEnabled,
    ),
  }
}

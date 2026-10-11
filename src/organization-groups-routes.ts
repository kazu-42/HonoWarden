import type { Context, Env, Hono } from 'hono'
import {
  isOrganizationGroupIdentifier,
  organizationGroupPolicy,
  parseOrganizationGroupIfMatch,
} from './domain/organization-groups'
import { readBoundedJsonBody } from './infra/bounded-json'
import {
  createOrganizationGroup,
  deleteOrganizationGroup,
  listOrganizationGroups,
  readOrganizationGroup,
  removeOrganizationGroupMember,
  updateOrganizationGroup,
  type OrganizationGroupResult,
} from './organization-groups'
import type { OrganizationPolicyActor } from './repositories/organization-policy-sql'

type Operation =
  | 'list'
  | 'list-details'
  | 'read'
  | 'read-details'
  | 'users'
  | 'create'
  | 'update'
  | 'delete'
  | 'remove-member'
  | 'unsupported'
export type OrganizationGroupsRouteDependencies<E extends Env> = {
  authenticate: (
    context: Context<E>,
  ) => Promise<
    | { ok: true; actor: OrganizationPolicyActor }
    | { ok: false; response: Response }
  >
  runtime: (context: Context<E>) => { enabled: boolean; database: D1Database }
  requestId: (context: Context<E>) => string
  reportFailure: (
    context: Context<E>,
    failure: { code: 'organization_groups_unavailable'; operation: Operation },
  ) => void | Promise<void>
}

export function registerOrganizationGroupsRoutes<E extends Env>(
  app: Hono<E>,
  dependencies: OrganizationGroupsRouteDependencies<E>,
): void {
  const route =
    (operation: Operation) =>
    async (context: Context<E>): Promise<Response> => {
      context.header('Cache-Control', 'no-store')
      const error = (
        code: string,
        status: 400 | 404 | 409 | 501 | 503,
        message: string,
      ) =>
        context.json(
          {
            error: { code, message },
            requestId: dependencies.requestId(context),
          },
          status,
        )
      const runtime = dependencies.runtime(context)
      if (!runtime.enabled || operation === 'unsupported')
        return error(
          'unsupported_feature',
          501,
          'Requested organization group operation is unavailable.',
        )
      try {
        const authenticated = await dependencies.authenticate(context)
        if (!authenticated.ok) return authenticated.response
        const organizationId = context.req.param('id') ?? ''
        const groupId = context.req.param('groupId') ?? ''
        const membershipId = context.req.param('membershipId') ?? ''
        const expected = parseOrganizationGroupIfMatch(
          context.req.header('If-Match'),
          groupId,
        )
        if (
          !isOrganizationGroupIdentifier(organizationId) ||
          (groupId !== '' && !isOrganizationGroupIdentifier(groupId)) ||
          (membershipId !== '' &&
            !isOrganizationGroupIdentifier(membershipId)) ||
          Object.keys(context.req.queries()).length > 0 ||
          !expected.ok ||
          (context.req.header('If-Match') !== undefined &&
            !['update', 'delete', 'remove-member'].includes(operation))
        )
          return error(
            'invalid_request',
            400,
            'Organization group identifier, query or precondition is invalid.',
          )
        const input = {
          actor: authenticated.actor,
          organizationId,
          groupId,
          requestId: dependencies.requestId(context),
          now: new Date().toISOString(),
          ...expected,
        }
        let result: OrganizationGroupResult
        if (operation === 'list' || operation === 'list-details') {
          result = await listOrganizationGroups(runtime.database, {
            ...input,
            details: operation === 'list-details',
          })
        } else if (
          operation === 'read' ||
          operation === 'read-details' ||
          operation === 'users'
        ) {
          result = await readOrganizationGroup(runtime.database, {
            ...input,
            details: operation === 'read-details',
            users: operation === 'users',
          })
        } else if (operation === 'delete') {
          result = await deleteOrganizationGroup(runtime.database, input)
        } else if (operation === 'remove-member') {
          result = await removeOrganizationGroupMember(runtime.database, {
            ...input,
            membershipId,
          })
        } else {
          const body = await readBoundedJsonBody(
            context.req.raw,
            organizationGroupPolicy.maxBodyBytes,
          )
          if (!body.ok)
            return error(
              'invalid_request',
              400,
              'Organization group payload is invalid.',
            )
          result =
            operation === 'create'
              ? await createOrganizationGroup(runtime.database, {
                  ...input,
                  body: body.value,
                })
              : await updateOrganizationGroup(runtime.database, {
                  ...input,
                  body: body.value,
                })
        }
        if (result.status === 'success') {
          if (result.etag) context.header('ETag', result.etag)
          return result.body === undefined
            ? context.body(null, 200)
            : context.json(result.body)
        }
        if (result.status === 'invalid_request')
          return error(
            'invalid_request',
            400,
            'Organization group payload is invalid.',
          )
        if (result.status === 'conflict')
          return error(
            'group_conflict',
            409,
            'Organization group changed. Read current state before replacing access.',
          )
        return error(
          'organization_not_found',
          404,
          'Organization or group was not found.',
        )
      } catch {
        await dependencies.reportFailure(context, {
          code: 'organization_groups_unavailable',
          operation,
        })
        return error(
          'organization_groups_unavailable',
          503,
          'Organization group operation failed. Read current state before retrying.',
        )
      }
    }
  const base = '/api/organizations/:id/groups'
  app.get(base, route('list'))
  app.get(`${base}/details`, route('list-details'))
  app.get(`${base}/:groupId/details`, route('read-details'))
  app.get(`${base}/:groupId/users`, route('users'))
  app.get(`${base}/:groupId`, route('read'))
  app.post(base, route('create'))
  app.put(`${base}/:groupId`, route('update'))
  app.delete(`${base}/:groupId`, route('delete'))
  app.delete(`${base}/:groupId/user/:membershipId`, route('remove-member'))
  app.delete(base, route('unsupported'))
  app.post(`${base}/delete`, route('unsupported'))
  app.post(`${base}/:groupId/delete`, route('unsupported'))
  app.post(`${base}/:groupId/delete-user/:membershipId`, route('unsupported'))
  app.post(`${base}/:groupId`, route('unsupported'))
}

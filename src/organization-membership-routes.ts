import type { Context, Env, Hono } from 'hono'

import { readBoundedJsonBody } from './infra/bounded-json'

import {
  acceptOrganizationMember,
  confirmOrganizationMember,
  inviteOrganizationMembers,
  listOrganizationMembers,
  readOrganizationMember,
  readOrganizationUserPublicKey,
  organizationMemberPublicKeys,
  reinviteOrganizationMember,
  removeOrganizationMember,
  revokeOrganizationMember,
  updateOrganizationMember,
  type OrganizationMembershipActor,
  type OrganizationMembershipDeliveryAdapter,
  type OrganizationMembershipResult,
} from './organization-membership'

type Operation =
  | 'list'
  | 'read'
  | 'user-public-key'
  | 'invite'
  | 'reinvite'
  | 'accept'
  | 'confirm'
  | 'public-keys'
  | 'update'
  | 'revoke'
  | 'remove'

export type OrganizationMembershipRuntime = {
  enabled: boolean
  database: D1Database
  inviteSecret?: string
  delivery?: OrganizationMembershipDeliveryAdapter
}

export type OrganizationMembershipRouteDependencies<E extends Env> = {
  authenticate: (
    context: Context<E>,
  ) => Promise<
    | { ok: true; actor: OrganizationMembershipActor }
    | { ok: false; response: Response }
  >
  runtime: (context: Context<E>) => OrganizationMembershipRuntime
  requestId: (context: Context<E>) => string
  reportFailure: (
    context: Context<E>,
    failure: {
      code: 'server_misconfigured' | 'organization_membership_unavailable'
      operation: Operation
    },
  ) => void | Promise<void>
}

export function registerOrganizationMembershipRoutes<E extends Env>(
  app: Hono<E>,
  dependencies: OrganizationMembershipRouteDependencies<E>,
): void {
  const route =
    (operation: Operation) =>
    async (c: Context<E>): Promise<Response> => {
      c.header('Cache-Control', 'no-store')
      const runtime = dependencies.runtime(c)
      const error = (
        code: string,
        message: string,
        status: 400 | 404 | 409 | 501 | 503,
      ) =>
        c.json(
          {
            error: { code, message },
            requestId: dependencies.requestId(c),
          },
          status,
        )
      if (!runtime.enabled)
        return error(
          'unsupported_feature',
          'Organization membership management is unavailable on this server.',
          501,
        )
      if (
        (operation === 'invite' ||
          operation === 'reinvite' ||
          operation === 'accept') &&
        (!runtime.inviteSecret ||
          new TextEncoder().encode(runtime.inviteSecret).byteLength < 32 ||
          (operation !== 'accept' && !runtime.delivery))
      ) {
        await dependencies.reportFailure(c, {
          code: 'server_misconfigured',
          operation,
        })
        return error(
          'server_misconfigured',
          'Organization membership runtime is not configured.',
          503,
        )
      }
      try {
        const auth = await dependencies.authenticate(c)
        if (!auth.ok) return auth.response
        const organizationId = c.req.param('id') ?? ''
        const membershipId = c.req.param('memberId') ?? ''
        const userId = c.req.param('userId') ?? ''
        if (
          (operation !== 'user-public-key' && !validId(organizationId)) ||
          (operation === 'user-public-key' && !validId(userId)) ||
          (membershipId && !validId(membershipId))
        ) {
          return error(
            'invalid_request',
            'Organization membership identifier is invalid.',
            400,
          )
        }
        const input = {
          actor: auth.actor,
          organizationId,
          membershipId,
          requestId: dependencies.requestId(c),
          now: new Date().toISOString(),
        }
        let result: OrganizationMembershipResult
        if (operation === 'user-public-key') {
          if (Object.keys(c.req.queries()).length > 0)
            return error(
              'invalid_request',
              'User public key query is invalid.',
              400,
            )
          result = await readOrganizationUserPublicKey(runtime.database, {
            actor: auth.actor,
            userId,
          })
        } else if (operation === 'list' || operation === 'read') {
          const queries = c.req.queries()
          if (
            Object.keys(queries).some(
              (key) =>
                key !== 'includeGroups' &&
                (operation === 'read' || key !== 'includeCollections'),
            ) ||
            Object.values(queries).some(
              (values) =>
                values.length !== 1 ||
                !['true', 'false'].includes(values[0] ?? ''),
            )
          ) {
            return error(
              'invalid_request',
              'Organization member list query is invalid.',
              400,
            )
          }
          result =
            operation === 'read'
              ? await readOrganizationMember(runtime.database, {
                  ...input,
                  includeGroups: c.req.query('includeGroups') === 'true',
                })
              : await listOrganizationMembers(runtime.database, {
                  ...input,
                  includeGroups: c.req.query('includeGroups') === 'true',
                  includeCollections:
                    c.req.query('includeCollections') === 'true',
                })
        } else if (operation === 'remove') {
          result = await removeOrganizationMember(runtime.database, input)
        } else if (operation === 'revoke') {
          result = await revokeOrganizationMember(runtime.database, input)
        } else if (operation === 'reinvite') {
          result = await reinviteOrganizationMember(runtime.database, {
            ...input,
            inviteSecret: runtime.inviteSecret!,
            delivery: runtime.delivery!,
          })
        } else {
          const payload = await readBoundedJsonBody(c.req.raw, 128 * 1024)
          if (!payload.ok) {
            return error(
              'invalid_request',
              'Organization membership payload is invalid.',
              400,
            )
          }
          const body = payload.value
          switch (operation) {
            case 'invite':
              result = await inviteOrganizationMembers(runtime.database, {
                ...input,
                body,
                inviteSecret: runtime.inviteSecret!,
                delivery: runtime.delivery!,
              })
              break
            case 'accept':
              result = await acceptOrganizationMember(runtime.database, {
                ...input,
                body,
                inviteSecret: runtime.inviteSecret!,
              })
              break
            case 'confirm':
              result = await confirmOrganizationMember(runtime.database, {
                ...input,
                body,
              })
              break
            case 'public-keys':
              result = await organizationMemberPublicKeys(runtime.database, {
                ...input,
                body,
              })
              break
            case 'update':
              result = await updateOrganizationMember(runtime.database, {
                ...input,
                body,
              })
              break
          }
        }
        if (result.status === 'success')
          return result.body ? c.json(result.body) : c.body(null, 200)
        switch (result.status) {
          case 'delivery_unavailable':
            await dependencies.reportFailure(c, {
              code: 'organization_membership_unavailable',
              operation,
            })
            return c.json(
              {
                error: {
                  code: 'invitation_delivery_unavailable',
                  message:
                    'Invitation persisted but delivery was not confirmed. Read membership state and intentionally reinvite to rotate the token.',
                },
                persisted: true,
                membershipIds: result.membershipIds,
                requestId: dependencies.requestId(c),
              },
              503,
            )
          case 'invalid_request':
            return error(
              'invalid_request',
              'Organization membership payload is invalid.',
              400,
            )
          case 'unsupported_feature':
            return error(
              'unsupported_feature',
              'Requested organization membership feature is unavailable.',
              501,
            )
          case 'not_found':
            return error(
              'organization_not_found',
              'Organization or member was not found.',
              404,
            )
          case 'conflict':
            return error(
              'membership_conflict',
              'Organization membership transition could not be applied.',
              409,
            )
        }
      } catch {
        await dependencies.reportFailure(c, {
          code: 'organization_membership_unavailable',
          operation,
        })
        return error(
          'organization_membership_unavailable',
          'Organization membership operation failed.',
          503,
        )
      }
    }
  app.get('/api/organizations/:id/users', route('list'))
  app.get('/api/organizations/:id/users/:memberId', route('read'))
  app.get('/api/users/:userId/public-key', route('user-public-key'))
  app.post('/api/organizations/:id/users/invite', route('invite'))
  app.post('/api/organizations/:id/users/public-keys', route('public-keys'))
  app.post('/api/organizations/:id/users/:memberId/accept', route('accept'))
  app.post('/api/organizations/:id/users/:memberId/confirm', route('confirm'))
  app.post('/api/organizations/:id/users/:memberId/reinvite', route('reinvite'))
  app.put('/api/organizations/:id/users/:memberId/revoke', route('revoke'))
  app.put('/api/organizations/:id/users/:memberId', route('update'))
  app.delete('/api/organizations/:id/users/:memberId', route('remove'))
}

function validId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value)
}

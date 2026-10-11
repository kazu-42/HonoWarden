import { id } from './api'
import { AdminError } from './contracts'

export type PendingInvitation = {
  organizationId: string
  membershipId: string
  token: string
}
export function consumeInvitation(
  location: Pick<Location, 'pathname' | 'hash'>,
  replace: (path: string) => void,
): PendingInvitation | undefined {
  if (
    location.pathname !== '/admin/accept' &&
    !location.pathname.startsWith('/admin/accept/')
  )
    return undefined
  const fragment = location.hash
  if (fragment) replace(location.pathname)
  const match =
    /^\/admin\/accept\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})\/?$/.exec(
      location.pathname,
    )
  const params = new URLSearchParams(fragment.slice(1))
  const token = params.get('token')
  if (
    !match ||
    [...params.keys()].length !== 1 ||
    !token ||
    !/^[A-Za-z0-9_-]{43}$/.test(token)
  )
    throw new AdminError('validation', 'invitation_invalid')
  return { organizationId: id(match[1]), membershipId: id(match[2]), token }
}

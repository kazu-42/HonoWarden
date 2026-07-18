import { MessagePackHubProtocol } from '@microsoft/signalr-protocol-msgpack'
import { MessageType } from '@microsoft/signalr'

import type { Bindings } from './bindings'

const recordSeparator = '\u001e'
const heartbeatIntervalMs = 15_000
const messagePackProtocol = new MessagePackHubProtocol()
const accountSessionRevokedCloseCode = 4001
const accountSessionRevokedCloseReason = 'Account session revoked'

export const notificationSecurityStampHeader = 'X-HonoWarden-Security-Stamp'
export const notificationCredentialRevisionHeader =
  'X-HonoWarden-Credential-Revision'

type Protocol = 'json' | 'messagepack'

type CredentialGeneration = {
  securityStamp: string
  revisionDate: string
  revisionTime: number
}

type SocketRegistration = {
  protocol: Protocol
  credentialGeneration: CredentialGeneration | null
}

export const authRequestNotificationTypes = {
  pending: 15,
  response: 16,
} as const

export type AuthRequestNotificationType =
  (typeof authRequestNotificationTypes)[keyof typeof authRequestNotificationTypes]

export type AuthRequestNotification = {
  requestId: string
  userId: string
  type: AuthRequestNotificationType
}

type AuthRequestNotificationDelivery = AuthRequestNotification & {
  credentialGeneration: CredentialGeneration | null
}

export class NotificationHub {
  private readonly sockets = new Map<WebSocket, SocketRegistration>()
  private readonly heartbeats = new Map<
    WebSocket,
    ReturnType<typeof setInterval>
  >()
  private activeCredentialGeneration: CredentialGeneration | null = null

  constructor(state: DurableObjectState, env: Bindings) {
    void state
    void env
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/connect') {
      return this.connect(request)
    }
    if (url.pathname === '/notify' && request.method === 'POST') {
      return this.notify(request)
    }
    if (url.pathname === '/invalidate' && request.method === 'POST') {
      return this.invalidate(request)
    }
    return new Response('Not found', { status: 404 })
  }

  private connect(request: Request): Response {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 })
    }

    const generation = readCredentialGeneration(request.headers)
    if (generation === 'invalid') {
      return Response.json(
        { error: 'invalid_credential_generation' },
        { status: 400 },
      )
    }
    if (generation && !this.acceptCredentialGeneration(generation)) {
      return Response.json({ error: 'session_revoked' }, { status: 401 })
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    server.accept()
    server.addEventListener('message', (event) => {
      const protocol = readHandshakeProtocol(event.data)
      if (!protocol) return

      if (generation && !this.acceptCredentialGeneration(generation)) {
        this.closeSocket(server)
        return
      }

      this.clearHeartbeat(server)
      this.sockets.set(server, {
        protocol,
        credentialGeneration: generation,
      })
      server.send(`{}${recordSeparator}`)
      this.sendPing(server, protocol)
      this.heartbeats.set(
        server,
        setInterval(() => this.sendPing(server, protocol), heartbeatIntervalMs),
      )
    })
    server.addEventListener('close', () => this.removeSocket(server))
    server.addEventListener('error', () => this.removeSocket(server))

    return new Response(null, { status: 101, webSocket: client })
  }

  private async notify(request: Request): Promise<Response> {
    const notification = await parseNotification(request)
    if (!notification) {
      return Response.json({ error: 'invalid_notification' }, { status: 400 })
    }

    let invalidated = 0
    if (notification.credentialGeneration) {
      const result = this.advanceCredentialGeneration(
        notification.credentialGeneration,
      )
      if (!result.accepted) {
        return Response.json({ error: 'stale_notification' }, { status: 409 })
      }
      invalidated = result.invalidated
    }

    let delivered = 0
    let failed = 0
    for (const [socket, registration] of this.sockets) {
      if (socket.readyState !== WebSocket.OPEN) {
        this.removeSocket(socket)
        continue
      }
      try {
        socket.send(
          encodeAuthRequestNotification(registration.protocol, notification),
        )
        delivered += 1
      } catch {
        failed += 1
        this.removeSocket(socket)
      }
    }

    return Response.json({ delivered, failed, invalidated })
  }

  private invalidate(request: Request): Response {
    const generation = readCredentialGeneration(request.headers)
    if (!generation || generation === 'invalid') {
      return Response.json(
        { error: 'invalid_credential_generation' },
        { status: 400 },
      )
    }

    const result = this.advanceCredentialGeneration(generation)
    if (!result.accepted) {
      return Response.json({ error: 'stale_invalidation' }, { status: 409 })
    }

    return Response.json({ invalidated: result.invalidated })
  }

  private sendPing(socket: WebSocket, protocol: Protocol): void {
    if (socket.readyState !== WebSocket.OPEN) return
    socket.send(
      protocol === 'messagepack'
        ? messagePackProtocol.writeMessage({ type: MessageType.Ping })
        : `{"type":6}${recordSeparator}`,
    )
  }

  private removeSocket(socket: WebSocket): void {
    this.clearHeartbeat(socket)
    this.sockets.delete(socket)
  }

  private closeSocket(socket: WebSocket): void {
    try {
      socket.close(
        accountSessionRevokedCloseCode,
        accountSessionRevokedCloseReason,
      )
    } catch {
      // Removing the registration is the security boundary even if the peer
      // cannot receive a close frame.
    } finally {
      this.removeSocket(socket)
    }
  }

  private acceptCredentialGeneration(
    generation: CredentialGeneration,
  ): boolean {
    return this.advanceCredentialGeneration(generation).accepted
  }

  private advanceCredentialGeneration(
    generation: CredentialGeneration,
  ):
    | { accepted: true; invalidated: number }
    | { accepted: false; invalidated: 0 } {
    const active = this.activeCredentialGeneration
    if (active && generation.revisionTime < active.revisionTime) {
      return { accepted: false, invalidated: 0 }
    }
    if (
      active &&
      generation.revisionTime === active.revisionTime &&
      generation.securityStamp !== active.securityStamp
    ) {
      return { accepted: false, invalidated: 0 }
    }

    this.activeCredentialGeneration = generation
    let invalidated = 0
    for (const [socket, registration] of this.sockets) {
      const socketGeneration = registration.credentialGeneration
      if (
        !socketGeneration ||
        socketGeneration.revisionTime !== generation.revisionTime ||
        socketGeneration.securityStamp !== generation.securityStamp
      ) {
        this.closeSocket(socket)
        invalidated += 1
      }
    }

    return { accepted: true, invalidated }
  }

  private clearHeartbeat(socket: WebSocket): void {
    const heartbeat = this.heartbeats.get(socket)
    if (heartbeat) clearInterval(heartbeat)
    this.heartbeats.delete(socket)
  }
}

export function isDurableNotificationEnabled(
  value: string | undefined,
): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function encodeAuthRequestNotification(
  protocol: Protocol,
  notification: AuthRequestNotification,
): string | ArrayBuffer {
  const target =
    notification.type === authRequestNotificationTypes.response
      ? 'AuthRequestResponseRecieved'
      : 'ReceiveMessage'
  const message = {
    type: MessageType.Invocation as const,
    target,
    arguments: [
      {
        Type: notification.type,
        Payload: { Id: notification.requestId, UserId: notification.userId },
      },
    ],
  }

  return protocol === 'messagepack'
    ? messagePackProtocol.writeMessage(message)
    : `${JSON.stringify(message)}${recordSeparator}`
}

async function parseNotification(
  request: Request,
): Promise<AuthRequestNotificationDelivery | null> {
  try {
    const value: unknown = await request.json()
    if (!isObject(value)) return null
    const requestId = value.requestId
    const userId = value.userId
    const type = value.type
    const credentialGeneration = parseCredentialGeneration(
      value.securityStamp,
      value.revisionDate,
    )
    if (
      typeof requestId !== 'string' ||
      requestId.length < 1 ||
      requestId.length > 128 ||
      typeof userId !== 'string' ||
      userId.length < 1 ||
      userId.length > 128 ||
      (type !== authRequestNotificationTypes.pending &&
        type !== authRequestNotificationTypes.response) ||
      (type === authRequestNotificationTypes.pending &&
        !credentialGeneration) ||
      (type === authRequestNotificationTypes.response &&
        (value.securityStamp !== undefined || value.revisionDate !== undefined))
    ) {
      return null
    }
    return { requestId, userId, type, credentialGeneration }
  } catch {
    return null
  }
}

function readCredentialGeneration(
  headers: Headers,
): CredentialGeneration | null | 'invalid' {
  const securityStamp = headers.get(notificationSecurityStampHeader)
  const revisionDate = headers.get(notificationCredentialRevisionHeader)
  if (securityStamp === null && revisionDate === null) return null

  return parseCredentialGeneration(securityStamp, revisionDate) ?? 'invalid'
}

function parseCredentialGeneration(
  securityStamp: unknown,
  revisionDate: unknown,
): CredentialGeneration | null {
  if (
    typeof securityStamp !== 'string' ||
    securityStamp.length < 1 ||
    securityStamp.length > 128 ||
    typeof revisionDate !== 'string' ||
    revisionDate.length < 1 ||
    revisionDate.length > 64
  ) {
    return null
  }

  const revisionTime = Date.parse(revisionDate)
  if (!Number.isFinite(revisionTime)) return null

  return { securityStamp, revisionDate, revisionTime }
}

function readHandshakeProtocol(data: string | ArrayBuffer): Protocol | null {
  let text: string
  try {
    text = typeof data === 'string' ? data : new TextDecoder().decode(data)
  } catch {
    return null
  }

  for (const frame of text.split(recordSeparator)) {
    if (!frame) continue
    try {
      const value: unknown = JSON.parse(frame)
      if (
        isObject(value) &&
        value.version === 1 &&
        (value.protocol === 'json' || value.protocol === 'messagepack')
      ) {
        return value.protocol
      }
    } catch {
      return null
    }
  }
  return null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

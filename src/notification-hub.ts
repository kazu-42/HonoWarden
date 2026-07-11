import { MessagePackHubProtocol } from '@microsoft/signalr-protocol-msgpack'
import { MessageType } from '@microsoft/signalr'

import type { Bindings } from './bindings'

const recordSeparator = '\u001e'
const heartbeatIntervalMs = 15_000
const authRequestResponseType = 16
const messagePackProtocol = new MessagePackHubProtocol()

type Protocol = 'json' | 'messagepack'

export type AuthRequestNotification = {
  requestId: string
  userId: string
}

export class NotificationHub {
  private readonly sockets = new Map<WebSocket, Protocol>()
  private readonly heartbeats = new Map<
    WebSocket,
    ReturnType<typeof setInterval>
  >()

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
    return new Response('Not found', { status: 404 })
  }

  private connect(request: Request): Response {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 426 })
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    server.accept()
    server.addEventListener('message', (event) => {
      const protocol = readHandshakeProtocol(event.data)
      if (!protocol) return

      this.clearHeartbeat(server)
      this.sockets.set(server, protocol)
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

    let delivered = 0
    let failed = 0
    for (const [socket, protocol] of this.sockets) {
      if (socket.readyState !== WebSocket.OPEN) {
        this.removeSocket(socket)
        continue
      }
      try {
        socket.send(encodeAuthRequestNotification(protocol, notification))
        delivered += 1
      } catch {
        failed += 1
        this.removeSocket(socket)
      }
    }

    return Response.json({ delivered, failed })
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
  const message = {
    type: MessageType.Invocation as const,
    target: 'ReceiveMessage',
    arguments: [
      {
        Type: authRequestResponseType,
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
): Promise<AuthRequestNotification | null> {
  try {
    const value: unknown = await request.json()
    if (!isObject(value)) return null
    const requestId = value.requestId
    const userId = value.userId
    if (
      typeof requestId !== 'string' ||
      requestId.length < 1 ||
      requestId.length > 128 ||
      typeof userId !== 'string' ||
      userId.length < 1 ||
      userId.length > 128
    ) {
      return null
    }
    return { requestId, userId }
  } catch {
    return null
  }
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

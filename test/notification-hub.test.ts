import { MessagePackHubProtocol } from '@microsoft/signalr-protocol-msgpack'
import { NullLogger } from '@microsoft/signalr'
import { describe, expect, it } from 'vitest'

import {
  encodeAuthRequestNotification,
  notificationCredentialRevisionHeader,
  notificationSecurityStampHeader,
  NotificationHub,
} from '../src/notification-hub'

class FakeNotificationSocket {
  readyState = WebSocket.OPEN
  readonly sent: Array<string | ArrayBuffer> = []
  readonly closed: Array<{
    code: number | undefined
    reason: string | undefined
  }> = []

  constructor(private readonly throwOnClose = false) {}

  send(value: string | ArrayBuffer) {
    this.sent.push(value)
  }

  close(code?: number, reason?: string) {
    this.closed.push({ code, reason })
    this.readyState = WebSocket.CLOSED
    if (this.throwOnClose) throw new Error('socket close failed')
  }
}

function registerSocket(
  hub: NotificationHub,
  socket: FakeNotificationSocket,
  securityStamp: string | null,
  revisionDate: string | null,
) {
  const sockets = Reflect.get(hub, 'sockets') as Map<
    WebSocket,
    {
      protocol: 'json' | 'messagepack'
      credentialGeneration: {
        securityStamp: string
        revisionDate: string
        revisionTime: number
      } | null
    }
  >
  sockets.set(socket as unknown as WebSocket, {
    protocol: 'json',
    credentialGeneration:
      securityStamp && revisionDate
        ? {
            securityStamp,
            revisionDate,
            revisionTime: Date.parse(revisionDate),
          }
        : null,
  })
}

describe('notification hub protocol', () => {
  const notification = { requestId: 'request-123', userId: 'user-456' }

  it('encodes a pending auth request for logged-in approval clients', () => {
    const encoded = encodeAuthRequestNotification('json', {
      ...notification,
      type: 15,
    })

    expect(encoded).toBe(
      '{"type":1,"target":"ReceiveMessage","arguments":[{"Type":15,"Payload":{"Id":"request-123","UserId":"user-456"}}]}\u001e',
    )
  })

  it('encodes the minimal auth request response as a JSON invocation', () => {
    const encoded = encodeAuthRequestNotification('json', {
      ...notification,
      type: 16,
    })

    expect(encoded).toBe(
      '{"type":1,"target":"AuthRequestResponseRecieved","arguments":[{"Type":16,"Payload":{"Id":"request-123","UserId":"user-456"}}]}\u001e',
    )
    expect(encoded).not.toContain('key')
    expect(encoded).not.toContain('code')
  })

  it('encodes a client-compatible MessagePack invocation', () => {
    const encoded = encodeAuthRequestNotification('messagepack', {
      ...notification,
      type: 16,
    })
    expect(encoded).toBeInstanceOf(ArrayBuffer)

    const messages = new MessagePackHubProtocol().parseMessages(
      encoded as ArrayBuffer,
      NullLogger.instance,
    )
    expect(messages).toEqual([
      {
        type: 1,
        headers: {},
        invocationId: undefined,
        target: 'AuthRequestResponseRecieved',
        arguments: [
          {
            Type: 16,
            Payload: { Id: 'request-123', UserId: 'user-456' },
          },
        ],
        streamIds: [],
      },
    ])
  })

  it('rejects arbitrary notification types at the durable object boundary', async () => {
    const hub = new NotificationHub({} as DurableObjectState, {} as never)
    const response = await hub.fetch(
      new Request('https://notification-hub/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'request-123',
          userId: 'user-456',
          type: 99,
        }),
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_notification',
    })
  })

  it('closes stale account sockets before delivering a notification', async () => {
    const hub = new NotificationHub({} as DurableObjectState, {} as never)
    const staleSocket = new FakeNotificationSocket()
    const currentSocket = new FakeNotificationSocket()
    registerSocket(
      hub,
      staleSocket,
      'stale-security-stamp',
      '2026-07-19T00:00:00.000Z',
    )
    registerSocket(
      hub,
      currentSocket,
      'current-security-stamp',
      '2026-07-19T00:00:01.000Z',
    )

    const response = await hub.fetch(
      new Request('https://notification-hub/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: 'request-123',
          userId: 'user-456',
          type: 15,
          securityStamp: 'current-security-stamp',
          revisionDate: '2026-07-19T00:00:01.000Z',
        }),
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      delivered: 1,
      failed: 0,
      invalidated: 1,
    })
    expect(staleSocket.closed).toEqual([
      { code: 4001, reason: 'Account session revoked' },
    ])
    expect(staleSocket.sent).toEqual([])
    expect(currentSocket.closed).toEqual([])
    expect(currentSocket.sent).toHaveLength(1)
  })

  it('invalidates every socket outside the new credential generation', async () => {
    const hub = new NotificationHub({} as DurableObjectState, {} as never)
    const staleSocket = new FakeNotificationSocket()
    const currentSocket = new FakeNotificationSocket()
    registerSocket(
      hub,
      staleSocket,
      'stale-security-stamp',
      '2026-07-19T00:00:00.000Z',
    )
    registerSocket(
      hub,
      currentSocket,
      'next-security-stamp',
      '2026-07-19T00:00:01.000Z',
    )

    const response = await hub.fetch(
      new Request('https://notification-hub/invalidate', {
        method: 'POST',
        headers: {
          [notificationSecurityStampHeader]: 'next-security-stamp',
          [notificationCredentialRevisionHeader]: '2026-07-19T00:00:01.000Z',
        },
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ invalidated: 1 })
    expect(staleSocket.closed).toEqual([
      { code: 4001, reason: 'Account session revoked' },
    ])
    expect(currentSocket.closed).toEqual([])
  })

  it('continues invalidating stale sockets when one close operation throws', async () => {
    const hub = new NotificationHub({} as DurableObjectState, {} as never)
    const failingSocket = new FakeNotificationSocket(true)
    const staleSocket = new FakeNotificationSocket()
    const currentSocket = new FakeNotificationSocket()
    registerSocket(hub, failingSocket, 'stale-one', '2026-07-19T00:00:00.000Z')
    registerSocket(hub, staleSocket, 'stale-two', '2026-07-19T00:00:00.000Z')
    registerSocket(
      hub,
      currentSocket,
      'current-security-stamp',
      '2026-07-19T00:00:01.000Z',
    )

    const response = await hub.fetch(
      new Request('https://notification-hub/invalidate', {
        method: 'POST',
        headers: {
          [notificationSecurityStampHeader]: 'current-security-stamp',
          [notificationCredentialRevisionHeader]: '2026-07-19T00:00:01.000Z',
        },
      }),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ invalidated: 2 })
    expect(failingSocket.closed).toHaveLength(1)
    expect(staleSocket.closed).toHaveLength(1)
    expect(currentSocket.closed).toEqual([])
  })

  it('rejects a delayed websocket connection from an older generation', async () => {
    const hub = new NotificationHub({} as DurableObjectState, {} as never)
    const invalidation = await hub.fetch(
      new Request('https://notification-hub/invalidate', {
        method: 'POST',
        headers: {
          [notificationSecurityStampHeader]: 'current-security-stamp',
          [notificationCredentialRevisionHeader]: '2026-07-19T00:00:01.000Z',
        },
      }),
    )
    expect(invalidation.status).toBe(200)

    const response = await hub.fetch(
      new Request('https://notification-hub/connect', {
        headers: {
          Upgrade: 'websocket',
          [notificationSecurityStampHeader]: 'stale-security-stamp',
          [notificationCredentialRevisionHeader]: '2026-07-19T00:00:00.000Z',
        },
      }),
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: 'session_revoked',
    })
  })
})

import { MessagePackHubProtocol } from '@microsoft/signalr-protocol-msgpack'
import { NullLogger } from '@microsoft/signalr'
import { describe, expect, it } from 'vitest'

import {
  encodeAuthRequestNotification,
  NotificationHub,
} from '../src/notification-hub'

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
})

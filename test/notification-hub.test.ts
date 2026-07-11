import { MessagePackHubProtocol } from '@microsoft/signalr-protocol-msgpack'
import { NullLogger } from '@microsoft/signalr'
import { describe, expect, it } from 'vitest'

import { encodeAuthRequestNotification } from '../src/notification-hub'

describe('notification hub protocol', () => {
  const notification = { requestId: 'request-123', userId: 'user-456' }

  it('encodes the minimal auth request response as a JSON invocation', () => {
    const encoded = encodeAuthRequestNotification('json', notification)

    expect(encoded).toBe(
      '{"type":1,"target":"ReceiveMessage","arguments":[{"Type":16,"Payload":{"Id":"request-123","UserId":"user-456"}}]}\u001e',
    )
    expect(encoded).not.toContain('key')
    expect(encoded).not.toContain('code')
  })

  it('encodes a client-compatible MessagePack invocation', () => {
    const encoded = encodeAuthRequestNotification('messagepack', notification)
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
        target: 'ReceiveMessage',
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
})

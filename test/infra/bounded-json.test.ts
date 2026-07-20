import { describe, expect, it } from 'vitest'

import { readBoundedJsonBody } from '../../src/infra/bounded-json'

describe('bounded JSON reader', () => {
  it('decodes a valid chunked UTF-8 body within the byte limit', async () => {
    const bytes = new TextEncoder().encode('{"value":"é"}')
    const splitAt = bytes.indexOf(0xc3) + 1
    const request = chunkedRequest([
      bytes.slice(0, splitAt),
      bytes.slice(splitAt),
    ])

    await expect(
      readBoundedJsonBody(request, bytes.byteLength),
    ).resolves.toEqual({
      ok: true,
      value: { value: 'é' },
    })
  })

  it('cancels a chunked body as soon as it exceeds the byte limit', async () => {
    let canceled = false
    const request = chunkedRequest(
      [new Uint8Array(8), new Uint8Array(8)],
      () => {
        canceled = true
      },
    )

    await expect(readBoundedJsonBody(request, 12)).resolves.toEqual({
      ok: false,
    })
    expect(canceled).toBe(true)
  })

  it('rejects an oversized Content-Length before reading the body', async () => {
    let canceled = false
    const request = chunkedRequest(
      [new TextEncoder().encode('{}')],
      () => {
        canceled = true
      },
      {
        'Content-Length': '13',
      },
    )

    await expect(readBoundedJsonBody(request, 12)).resolves.toEqual({
      ok: false,
    })
    expect(canceled).toBe(true)
  })

  it('rejects invalid JSON inside the limit', async () => {
    const request = chunkedRequest([new TextEncoder().encode('{')])

    await expect(readBoundedJsonBody(request, 12)).resolves.toEqual({
      ok: false,
    })
  })
})

function chunkedRequest(
  chunks: Uint8Array[],
  onCancel?: () => void,
  headers?: HeadersInit,
): Request {
  let index = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index]
      if (!chunk) {
        controller.close()
        return
      }
      index += 1
      controller.enqueue(chunk)
    },
    cancel() {
      onCancel?.()
    },
  })
  const init: RequestInit & { duplex: 'half' } = {
    method: 'POST',
    ...(headers ? { headers } : {}),
    body,
    duplex: 'half',
  }
  return new Request('https://example.test/rotation', init)
}

export type BoundedJsonReadResult = { ok: true; value: unknown } | { ok: false }

export async function readBoundedJsonBody(
  request: Request,
  maxBytes: number,
): Promise<BoundedJsonReadResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    return { ok: false }
  }

  if (!request.body) {
    return { ok: false }
  }

  const contentLength = parseContentLength(
    request.headers.get('Content-Length'),
  )
  if (
    contentLength === 'invalid' ||
    (contentLength !== null && contentLength > maxBytes)
  ) {
    await cancelBody(request.body)
    return { ok: false }
  }

  const reader = request.body.getReader()
  const decoder = new TextDecoder('utf-8', {
    fatal: true,
    ignoreBOM: false,
  })
  const chunks: string[] = []
  let receivedBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      receivedBytes += value.byteLength
      if (receivedBytes > maxBytes) {
        await cancelReader(reader)
        return { ok: false }
      }
      chunks.push(decoder.decode(value, { stream: true }))
    }
    chunks.push(decoder.decode())

    return { ok: true, value: JSON.parse(chunks.join('')) as unknown }
  } catch {
    await cancelReader(reader)
    return { ok: false }
  } finally {
    reader.releaseLock()
  }
}

function parseContentLength(value: string | null): number | null | 'invalid' {
  if (value === null) return null
  if (!/^\d+$/.test(value)) return 'invalid'

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : 'invalid'
}

async function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  try {
    await reader.cancel()
  } catch {
    // The request is already failed; cancellation is best-effort cleanup.
  }
}

async function cancelBody(body: ReadableStream<Uint8Array>): Promise<void> {
  try {
    await body.cancel()
  } catch {
    // The request is already failed; cancellation is best-effort cleanup.
  }
}

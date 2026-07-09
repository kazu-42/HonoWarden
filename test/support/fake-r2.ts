type StoredR2Object = {
  body: ArrayBuffer
  contentType: string | null
}

export class FakeR2Bucket {
  readonly deletedKeys: string[] = []
  readonly putKeys: string[] = []

  private readonly objects = new Map<string, StoredR2Object>()

  async put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | Blob | string | null,
    options: { httpMetadata?: { contentType?: string } } = {},
  ): Promise<null> {
    this.putKeys.push(key)
    this.objects.set(key, {
      body: await toArrayBuffer(value),
      contentType: options.httpMetadata?.contentType ?? null,
    })

    return null
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const stored = this.objects.get(key)
    if (!stored) {
      return null
    }

    return {
      get body() {
        return new Response(stored.body.slice(0)).body as ReadableStream
      },
      get bodyUsed() {
        return false
      },
      arrayBuffer: async () => stored.body.slice(0),
      bytes: async () => new Uint8Array(stored.body.slice(0)),
      text: async () => new TextDecoder().decode(stored.body),
      json: async <T = unknown>() =>
        JSON.parse(new TextDecoder().decode(stored.body)) as T,
      blob: async () =>
        new Blob([stored.body], {
          type: stored.contentType ?? '',
        }),
      writeHttpMetadata(headers: Headers) {
        if (stored.contentType) {
          headers.set('Content-Type', stored.contentType)
        }
      },
      httpEtag: '"fake-etag"',
      checksums: {},
      customMetadata: {},
      httpMetadata: stored.contentType
        ? {
            contentType: stored.contentType,
          }
        : {},
      key,
      version: 'fake-version',
      size: stored.body.byteLength,
      etag: 'fake-etag',
      uploaded: new Date('2026-07-10T00:00:00.000Z'),
      range: undefined,
      storageClass: 'Standard',
    } as unknown as R2ObjectBody
  }

  async delete(key: string): Promise<void> {
    this.deletedKeys.push(key)
    this.objects.delete(key)
  }

  has(key: string): boolean {
    return this.objects.has(key)
  }

  keys(): string[] {
    return [...this.objects.keys()].sort()
  }
}

async function toArrayBuffer(
  value: ArrayBuffer | ArrayBufferView | Blob | string | null,
): Promise<ArrayBuffer> {
  if (value === null) {
    return new ArrayBuffer(0)
  }

  if (typeof value === 'string') {
    return copyBytes(new TextEncoder().encode(value))
  }

  if (value instanceof Blob) {
    return value.arrayBuffer()
  }

  if (ArrayBuffer.isView(value)) {
    return copyBytes(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    )
  }

  return value.slice(0)
}

function copyBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)

  return copy.buffer
}

const inventoryPath = '/inventory'
const inventoryLimit = 1000
const maximumObjectCount = 100_000

export async function listLocalR2ObjectKeys(bucket) {
  if (!bucket || typeof bucket.list !== 'function') {
    throw new TypeError('local R2 inventory binding was invalid')
  }

  const keys = []
  const seenKeys = new Set()
  const seenCursors = new Set()
  let cursor

  do {
    const page = await bucket.list({
      limit: inventoryLimit,
      ...(cursor ? { cursor } : {}),
    })
    if (
      !page ||
      !Array.isArray(page.objects) ||
      typeof page.truncated !== 'boolean'
    ) {
      throw new Error('local R2 inventory page was invalid')
    }

    for (const object of page.objects) {
      const key = object?.key
      if (
        typeof key !== 'string' ||
        key.length === 0 ||
        key.includes('\n') ||
        key.includes('\r')
      ) {
        throw new Error('local R2 inventory contained an invalid key')
      }
      if (seenKeys.has(key)) {
        throw new Error('local R2 inventory contained a duplicate key')
      }
      seenKeys.add(key)
      keys.push(key)
      if (keys.length > maximumObjectCount) {
        throw new Error('local R2 inventory exceeded the object limit')
      }
    }

    if (!page.truncated) {
      cursor = undefined
      continue
    }
    if (
      typeof page.cursor !== 'string' ||
      page.cursor.length === 0 ||
      seenCursors.has(page.cursor)
    ) {
      throw new Error('local R2 inventory cursor was invalid')
    }
    seenCursors.add(page.cursor)
    cursor = page.cursor
  } while (cursor)

  return keys.sort()
}

const inventoryWorker = {
  async fetch(request, env) {
    const url = new globalThis.URL(request.url)
    if (request.method === 'GET' && url.pathname === '/health') {
      return new globalThis.Response(null, { status: 204 })
    }
    if (request.method !== 'GET' || url.pathname !== inventoryPath) {
      return new globalThis.Response(null, { status: 404 })
    }

    const token = env?.HONOWARDEN_LOCAL_R2_INVENTORY_TOKEN
    if (
      typeof token !== 'string' ||
      token.length < 16 ||
      request.headers.get('Authorization') !== `Bearer ${token}`
    ) {
      return globalThis.Response.json(
        { error: 'unauthorized' },
        { status: 401 },
      )
    }

    try {
      const keys = await listLocalR2ObjectKeys(env.VAULT_OBJECTS)
      return globalThis.Response.json({ schemaVersion: 1, keys })
    } catch {
      console.error('local R2 inventory failed')
      return globalThis.Response.json(
        { error: 'inventory_failed' },
        { status: 500 },
      )
    }
  },
}

export default inventoryWorker

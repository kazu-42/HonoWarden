import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url).toString())
const inventoryScript = join(
  repoRoot,
  'scripts/honowarden-local-r2-inventory.mjs',
)

function loadInventoryModule() {
  return import(pathToFileURL(inventoryScript).href)
}

describe('local R2 inventory worker', () => {
  it('lists every object across pages in canonical key order', async () => {
    const { listLocalR2ObjectKeys } = await loadInventoryModule()
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        objects: [
          { key: 'z/unexpected-object' },
          { key: 'attachments/hon220-immutable-ciphertext' },
        ],
        truncated: true,
        cursor: 'next-page',
      })
      .mockResolvedValueOnce({
        objects: [{ key: 'a/another-unexpected-object' }],
        truncated: false,
      })

    await expect(
      listLocalR2ObjectKeys({ list } as unknown as R2Bucket),
    ).resolves.toEqual([
      'a/another-unexpected-object',
      'attachments/hon220-immutable-ciphertext',
      'z/unexpected-object',
    ])
    expect(list).toHaveBeenNthCalledWith(1, { limit: 1000 })
    expect(list).toHaveBeenNthCalledWith(2, {
      cursor: 'next-page',
      limit: 1000,
    })
  })

  it('requires the ephemeral bearer token before returning inventory', async () => {
    const { default: inventoryWorker } = await loadInventoryModule()
    const list = vi.fn()
    const response = await inventoryWorker.fetch(
      new Request('http://127.0.0.1/inventory'),
      {
        HONOWARDEN_LOCAL_R2_INVENTORY_TOKEN: 'synthetic-inventory-token',
        VAULT_OBJECTS: { list } as unknown as R2Bucket,
      },
    )

    expect(response.status).toBe(401)
    expect(list).not.toHaveBeenCalled()
  })

  it('fails closed on duplicate keys across inventory pages', async () => {
    const { listLocalR2ObjectKeys } = await loadInventoryModule()
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        objects: [{ key: 'duplicate' }],
        truncated: true,
        cursor: 'next-page',
      })
      .mockResolvedValueOnce({
        objects: [{ key: 'duplicate' }],
        truncated: false,
      })

    await expect(
      listLocalR2ObjectKeys({ list } as unknown as R2Bucket),
    ).rejects.toThrow('local R2 inventory contained a duplicate key')
  })
})

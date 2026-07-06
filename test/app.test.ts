import { describe, expect, it } from 'vitest'

import app from '../src/app'

describe('HonoWarden app', () => {
  it('returns service metadata from the root route', async () => {
    const response = await app.request('/')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      name: 'HonoWarden',
      status: 'pre-alpha',
      links: {
        health: '/healthz',
      },
    })
  })

  it('returns a health response', async () => {
    const response = await app.request('/healthz')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: 'honowarden',
    })
  })

  it('returns structured JSON for unknown routes', async () => {
    const response = await app.request('/missing')

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'not_found',
        message: 'The requested resource was not found.',
      },
    })
  })
})

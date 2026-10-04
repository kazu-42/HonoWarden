import type { Context, Hono, Env } from 'hono'

const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "connect-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ')

export type AdminRouteDependencies<E extends Env> = {
  runtime: (context: Context<E>) => {
    enabled: boolean
    assets?: Fetcher | undefined
  }
  reportFailure: (context: Context<E>) => void | Promise<void>
}

export function registerAdminRoutes<E extends Env>(
  app: Hono<E>,
  dependencies: AdminRouteDependencies<E>,
) {
  const handler = async (c: Context<E>) => {
    c.header('Cache-Control', 'no-store')
    c.header('Content-Security-Policy', contentSecurityPolicy)
    c.header('Referrer-Policy', 'no-referrer')
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    const runtime = dependencies.runtime(c)
    if (!runtime.enabled) return c.text('Not found', 404)
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      c.header('Allow', 'GET, HEAD')
      return c.text('Method not allowed', 405)
    }
    if (c.req.path === '/admin') return c.redirect('/admin/', 308)

    const isIndex =
      c.req.path === '/admin/' ||
      c.req.path === '/admin/index.html' ||
      /^\/admin\/accept\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\/?$/.test(
        c.req.path,
      )
    const assetMatch =
      /^\/admin\/assets\/([a-zA-Z0-9_.-]{1,200}\.(?:js|css|wasm))$/.exec(
        c.req.path,
      )
    if (!isIndex && !assetMatch) return c.text('Not found', 404)
    if (!runtime.assets) {
      await dependencies.reportFailure(c)
      return c.text('Organization administration assets unavailable', 503)
    }

    try {
      const url = new URL(c.req.url)
      url.pathname = isIndex ? '/index.html' : `/assets/${assetMatch![1]}`
      url.search = ''
      // The static binding receives no bearer, cookie, or caller-controlled capability.
      const response = await runtime.assets.fetch(
        new Request(url, { method: c.req.method }),
      )
      if (response.status === 404) return c.text('Not found', 404)
      if (response.status !== 200) {
        await dependencies.reportFailure(c)
        return c.text('Organization administration assets unavailable', 503)
      }
      const type = response.headers.get('Content-Type')?.split(';')[0]?.trim()
      const expectedType = isIndex
        ? 'text/html'
        : c.req.path.endsWith('.css')
          ? 'text/css'
          : c.req.path.endsWith('.wasm')
            ? 'application/wasm'
            : 'javascript'
      const typeMatches =
        expectedType === 'javascript'
          ? type === 'text/javascript' || type === 'application/javascript'
          : type === expectedType
      // An incorrectly configured SPA fallback must never turn missing code into HTML.
      if (!typeMatches) return c.text('Not found', 404)
      return new Response(c.req.method === 'HEAD' ? null : response.body, {
        status: 200,
        headers: {
          'Content-Type': response.headers.get('Content-Type')!,
          'Cache-Control': 'no-store',
          'Content-Security-Policy': contentSecurityPolicy,
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
          'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        },
      })
    } catch {
      await dependencies.reportFailure(c)
      return c.text('Organization administration assets unavailable', 503)
    }
  }
  app.all('/admin', handler)
  app.all('/admin/*', handler)
}

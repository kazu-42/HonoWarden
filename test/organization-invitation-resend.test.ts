import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createResendInvitationSender,
  type InvitationProviderFetch,
} from '../src/organization-invitation-resend'

const message = {
  from: 'invites@example.test',
  to: 'member@example.test',
  subject: 'HonoWarden organization invitation',
  text: 'Synthetic invitation #token=private-synthetic-token',
}
const key = 're_synthetic_invitation_only'
const id = '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794'
afterEach(() => vi.restoreAllMocks())

describe('Resend invitation sender', () => {
  it('uses one fixed HTTPS request, blocks redirects, forwards cancellation, and sends no token-bearing header', async () => {
    const fetch = vi.fn<InvitationProviderFetch>(async () =>
      Response.json({ id }),
    )
    const send = createResendInvitationSender({ apiKey: key, fetch })
    const controller = new AbortController()
    await expect(send(message, controller.signal)).resolves.toBe('accepted')
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('error')
    expect(init.signal).toBe(controller.signal)
    expect(JSON.parse(String(init.body))).toEqual({
      from: message.from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
    })
    const headers = new Headers(init.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${key}`)
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('idempotency-key')).toMatch(
      /^honowarden-invitation:[a-f0-9]{64}$/,
    )
    expect(headers.get('idempotency-key')).not.toContain(
      'private-synthetic-token',
    )
  })

  it('reuses the idempotency key for identical content and changes it for a rotated invitation', async () => {
    const fetch = vi.fn<InvitationProviderFetch>(async () =>
      Response.json({ id }),
    )
    const send = createResendInvitationSender({ apiKey: key, fetch })
    const signal = new AbortController().signal
    await send(message, signal)
    await send(message, signal)
    await send(
      { ...message, text: 'A newly rotated invitation capability' },
      signal,
    )
    const keys = fetch.mock.calls.map(([, init]) =>
      new Headers(init.headers).get('idempotency-key'),
    )
    expect(keys[0]).toBe(keys[1])
    expect(keys[2]).not.toBe(keys[0])
  })

  it.each([301, 302, 400, 401, 403, 422, 429, 500, 503])(
    'discards HTTP %i bodies without reading or reflecting provider data and does not retry',
    async (status) => {
      const response = new Response(`${key} ${message.to} ${message.text}`, {
        status,
      })
      const reader = vi.spyOn(response.body!, 'getReader')
      const cancel = vi.spyOn(response.body!, 'cancel')
      const fetch = vi.fn<InvitationProviderFetch>(async () => response)
      const send = createResendInvitationSender({ apiKey: key, fetch })
      await expect(send(message, new AbortController().signal)).rejects.toThrow(
        /^Resend invitation delivery failed\.$/,
      )
      expect(fetch).toHaveBeenCalledOnce()
      expect(reader).not.toHaveBeenCalled()
      expect(cancel).toHaveBeenCalledOnce()
    },
  )

  it.each([
    {},
    { id: null },
    { id: '' },
    { id: 'x'.repeat(129) },
    { id: 'id\r\nprivate' },
    ['id'],
  ])('refuses unacknowledged successful response %j', async (body) => {
    const send = createResendInvitationSender({
      apiKey: key,
      fetch: async () => Response.json(body),
    })
    await expect(send(message, new AbortController().signal)).rejects.toThrow(
      /^Resend invitation delivery failed\.$/,
    )
  })

  it.each(['not-json', '{"id":', '\ufeffnot-json'])(
    'refuses malformed successful JSON without reflecting it',
    async (body) => {
      const send = createResendInvitationSender({
        apiKey: key,
        fetch: async () =>
          new Response(body, {
            headers: { 'content-type': 'application/json' },
          }),
      })
      await expect(send(message, new AbortController().signal)).rejects.toThrow(
        /^Resend invitation delivery failed\.$/,
      )
    },
  )

  it('refuses non-JSON success and an empty response body', async () => {
    for (const response of [
      new Response(JSON.stringify({ id })),
      new Response(null, { status: 204 }),
    ]) {
      const send = createResendInvitationSender({
        apiKey: key,
        fetch: async () => response,
      })
      await expect(send(message, new AbortController().signal)).rejects.toThrow(
        /^Resend invitation delivery failed\.$/,
      )
    }
  })

  it('enforces the byte cap on streamed responses without a Content-Length', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            JSON.stringify({ id, extra: 'x'.repeat(4096) }),
          ),
        )
      },
      cancel() {
        cancelled = true
      },
    })
    const send = createResendInvitationSender({
      apiKey: key,
      fetch: async () =>
        new Response(body, { headers: { 'content-type': 'application/json' } }),
    })
    await expect(send(message, new AbortController().signal)).rejects.toThrow(
      /^Resend invitation delivery failed\.$/,
    )
    expect(cancelled).toBe(true)
  })

  it.each(['5000', '-1', 'bad', '9007199254740993'])(
    'rejects unsafe Content-Length %s without reading a body',
    async (length) => {
      const response = new Response(JSON.stringify({ id }), {
        headers: {
          'content-type': 'application/json',
          'content-length': length,
        },
      })
      const read = vi.spyOn(response.body!, 'getReader')
      const send = createResendInvitationSender({
        apiKey: key,
        fetch: async () => response,
      })
      await expect(send(message, new AbortController().signal)).rejects.toThrow(
        /^Resend invitation delivery failed\.$/,
      )
      expect(read).not.toHaveBeenCalled()
    },
  )

  it('rejects malformed UTF-8 acknowledgements', async () => {
    const send = createResendInvitationSender({
      apiKey: key,
      fetch: async () =>
        new Response(new Uint8Array([0xff]), {
          headers: { 'content-type': 'application/json' },
        }),
    })
    await expect(send(message, new AbortController().signal)).rejects.toThrow(
      /^Resend invitation delivery failed\.$/,
    )
  })

  it('does not call the provider for a pre-aborted request or invalid message', async () => {
    const fetch = vi.fn<InvitationProviderFetch>()
    const send = createResendInvitationSender({ apiKey: key, fetch })
    const controller = new AbortController()
    controller.abort(new Error(`${key} private abort reason`))
    await expect(send(message, controller.signal)).rejects.toThrow(
      /^Resend invitation delivery failed\.$/,
    )
    for (const invalid of [
      { ...message, to: 'a@example.test\r\nBcc: other@example.test' },
      { ...message, text: 'x'.repeat(8193) },
      { ...message, subject: 'Subject\r\nBcc: other@example.test' },
    ]) {
      await expect(send(invalid, new AbortController().signal)).rejects.toThrow(
        /^Resend invitation delivery failed\.$/,
      )
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sanitizes provider exceptions', async () => {
    const send = createResendInvitationSender({
      apiKey: key,
      fetch: async () => {
        throw new Error(`${key} ${message.text}`)
      },
    })
    await expect(send(message, new AbortController().signal)).rejects.toThrow(
      /^Resend invitation delivery failed\.$/,
    )
  })

  it('cancels a stalled acknowledgement stream on abort and rejects without private reason', async () => {
    const controller = new AbortController()
    let reading!: () => void
    const started = new Promise<void>((resolve) => {
      reading = resolve
    })
    let cancelled = false
    const response = new Response(
      new ReadableStream<Uint8Array>(
        {
          pull() {
            reading()
          },
          cancel() {
            cancelled = true
          },
        },
        { highWaterMark: 0 },
      ),
      { headers: { 'content-type': 'application/json' } },
    )
    const send = createResendInvitationSender({
      apiKey: key,
      fetch: async () => response,
    })
    const result = send(message, controller.signal)
    const rejection = expect(result).rejects.toThrow(
      /^Resend invitation delivery failed\.$/,
    )
    await started
    controller.abort(new Error(`${key} ${message.text}`))
    await rejection
    expect(cancelled).toBe(true)
  })

  it.each(['', ' key', 'key\r\nInjected: secret', 'x'.repeat(513)])(
    'rejects invalid key configuration without echoing it',
    (apiKey) => {
      expect(() =>
        createResendInvitationSender({ apiKey, fetch: vi.fn() }),
      ).toThrow(/^Resend invitation sender configuration is invalid\.$/)
    },
  )
})

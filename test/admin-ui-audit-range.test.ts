import { afterEach, describe, expect, it, vi } from 'vitest'

import { mountAdminApp } from '../admin/app'
import type {
  AdminClient,
  AuditFilter,
  AuditPage,
  SessionView,
} from '../admin/browser/contracts'

// A small event-capable DOM keeps these lifecycle tests independent of a browser
// and does not emulate disabled activation: dispatch also exercises the UI guard.
class TestElement {
  parent: TestElement | null = null
  children: (TestElement | string)[] = []
  attributes = new Map<string, string>()
  listeners = new Map<string, ((event: Event) => void)[]>()
  dataset: Record<string, string> = {}
  className = ''
  id = ''
  value = ''
  disabled = false
  tabIndex = 0
  step = ''

  constructor(readonly tag: string) {}

  get textContent(): string {
    return this.children
      .map((child) => (typeof child === 'string' ? child : child.textContent))
      .join('')
  }
  get isConnected(): boolean {
    return this.tag === 'body' || Boolean(this.parent?.isConnected)
  }
  append(...children: (TestElement | string)[]): void {
    for (const child of children) {
      if (child instanceof TestElement) child.parent = this
      this.children.push(child)
    }
  }
  prepend(...children: (TestElement | string)[]): void {
    for (const child of children)
      if (child instanceof TestElement) child.parent = this
    this.children.unshift(...children)
  }
  replaceChildren(...children: (TestElement | string)[]): void {
    for (const child of this.children)
      if (child instanceof TestElement) child.parent = null
    this.children = []
    this.append(...children)
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }
  addEventListener(name: string, listener: (event: Event) => void): void {
    const listeners = this.listeners.get(name) ?? []
    listeners.push(listener)
    this.listeners.set(name, listeners)
  }
  dispatch(name: string): void {
    for (const listener of this.listeners.get(name) ?? [])
      listener(new Event(name))
  }
  contains(candidate: TestElement): boolean {
    return (
      candidate === this ||
      this.children.some(
        (child) => child instanceof TestElement && child.contains(candidate),
      )
    )
  }
  querySelector(selector: string): TestElement | null {
    return this.querySelectorAll(selector)[0] ?? null
  }
  querySelectorAll(selector: string): TestElement[] {
    const matches = (candidate: TestElement, part: string): boolean => {
      const tokens = part.trim().split(' ')
      const last = tokens.pop()
      if (!last) return false
      const self =
        last === '[data-focus-key]'
          ? candidate.dataset.focusKey !== undefined
          : last.startsWith('#')
            ? candidate.id === last.slice(1)
            : candidate.tag === last
      if (!self) return false
      if (!tokens.length) return true
      let ancestor = candidate.parent
      while (ancestor) {
        if (ancestor.tag === tokens[0]) return true
        ancestor = ancestor.parent
      }
      return false
    }
    const found: TestElement[] = []
    const visit = (parent: TestElement): void => {
      for (const child of parent.children) {
        if (!(child instanceof TestElement)) continue
        if (selector.split(',').some((part) => matches(child, part)))
          found.push(child)
        visit(child)
      }
    }
    visit(this)
    return found
  }
  remove(): void {
    if (this.parent)
      this.parent.children = this.parent.children.filter(
        (child) => child !== this,
      )
    this.parent = null
  }
  click(): void {
    this.dispatch('click')
  }
  focus(): void {
    testDocument.activeElement = this
  }
}

const testDocument = {
  activeElement: null as TestElement | null,
  body: new TestElement('body'),
  createElement: (tag: string) => new TestElement(tag),
  getElementById: (id: string) => testDocument.body.querySelector(`#${id}`),
}

let unmount: (() => void) | undefined
afterEach(() => {
  unmount?.()
  unmount = undefined
  testDocument.body.replaceChildren()
  testDocument.activeElement = null
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const mountedAt = '2026-10-04T11:52:54.792Z'
const enteredAt = '2026-10-04T11:54:20.123Z'
const recentEventAt = '2026-10-04T11:54:20.122Z'
const localValue = (value: string): string => {
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 23)
}
const settle = async (): Promise<void> => {
  for (let count = 0; count < 16; count++) await Promise.resolve()
}

function auditWorkspace() {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(mountedAt))
  vi.stubGlobal('document', testDocument)
  vi.stubGlobal('HTMLElement', TestElement)
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  const root = new TestElement('div')
  testDocument.body.append(root)
  let state: SessionView = {
    phase: 'unlocked',
    email: 'synthetic@example.invalid',
    organizations: [
      { id: 'org-1', name: 'Synthetic org', role: 0 },
      { id: 'org-2', name: 'Synthetic second org', role: 0 },
    ],
  }
  let subscriber: (next: SessionView) => void = () => {}
  const queries: AuditFilter[] = []
  const queryScopes: { organizationId: string; email: string | undefined }[] =
    []
  const exports: AuditFilter[] = []
  let delayAudit = false
  let delayExport = false
  let releaseAudit: (() => void) | undefined
  let releaseExport: (() => void) | undefined
  const listAudit = vi.fn(
    async (organizationId: string, input: AuditFilter): Promise<AuditPage> => {
      const query = { ...input }
      const requestedEmail = state.email
      queries.push(query)
      queryScopes.push({ organizationId, email: requestedEmail })
      const from =
        input.from ?? new Date(Date.now() - 7 * 86400000).toISOString()
      const to = input.to ?? new Date().toISOString()
      if (to > new Date().toISOString())
        throw new Error('Future audit end rejected')
      const cursor =
        organizationId === 'org-1'
          ? 'synthetic-cursor'
          : 'synthetic-other-cursor'
      if (input.continuationToken && input.continuationToken !== cursor)
        throw new Error('Cursor belongs to another organization')
      if (delayAudit) {
        delayAudit = false
        await new Promise<void>((resolve) => {
          releaseAudit = resolve
        })
      }
      return {
        data:
          from <= recentEventAt && recentEventAt < to
            ? [
                {
                  id: 'event-1',
                  occurredAt: recentEventAt,
                  name:
                    requestedEmail === 'synthetic@example.invalid'
                      ? 'organization.policy.update'
                      : 'organization.member.invite',
                  actorUserId: null,
                  targetId: null,
                  targetType: 'organization',
                  outcome: 'success',
                },
              ]
            : [],
        continuationToken: input.continuationToken ? null : cursor,
        query: {
          from,
          to,
          eventName: input.eventName ?? null,
          actorUserId: null,
          limit: input.limit ?? 50,
        },
        availability: {
          coverage: 'partial',
          recordedActivity: 'committed_organization_administration',
          retentionDays: 365,
          eventNames: [
            'organization.policy.update',
            'organization.member.invite',
          ],
          outcomes: ['success'],
          persistence: 'required',
        },
      }
    },
  )
  const client = {
    getSession: () => state,
    subscribe: (listener: typeof subscriber) => {
      subscriber = listener
      return () => {}
    },
    listCollections: async () => [],
    listMembers: async () => [],
    listAudit,
    exportAudit: async (_organizationId: string, input: AuditFilter) => {
      exports.push({ ...input })
      if (delayExport) {
        delayExport = false
        await new Promise<void>((resolve) => {
          releaseExport = resolve
        })
      }
      return new Blob(['Synthetic export'])
    },
    dispose: vi.fn(),
  } as unknown as AdminClient
  unmount = mountAdminApp(root as unknown as HTMLElement, client)
  const control = (label: string): TestElement => {
    const found = root
      .querySelectorAll('button')
      .find(
        (item) => item.dataset.focusKey === label || item.textContent === label,
      )
    if (!found) throw new Error('Expected UI control missing')
    return found
  }
  const input = (id: string): TestElement => {
    const found = root.querySelector('#' + id)
    if (!found) throw new Error('Expected UI input missing')
    return found
  }
  const search = (): void => {
    const form = root.querySelector('form')
    if (!form) throw new Error('Expected audit form missing')
    form.dispatch('submit')
  }
  const publish = (next: SessionView): void => {
    state = next
    subscriber(next)
  }
  return {
    root,
    control,
    input,
    search,
    publish,
    queries,
    queryScopes,
    exports,
    deferAudit: () => {
      delayAudit = true
    },
    releaseAudit: () => releaseAudit?.(),
    deferExport: () => {
      delayExport = true
    },
    releaseExport: () => releaseExport?.(),
    state: () => state,
  }
}

describe('audit range precision and loaded snapshot bounds', () => {
  it('includes a committed event after mount when audit is first entered later', async () => {
    const page = auditWorkspace()
    await settle()
    vi.setSystemTime(new Date(enteredAt))
    page.control('監査').dispatch('click')
    await settle()
    expect(page.queries[0]?.to).toBe(enteredAt)
    expect(page.root.textContent).toContain('認証ポリシーを変更')
  })

  it('keeps exact bounds when Search is submitted without edits', async () => {
    const page = auditWorkspace()
    await settle()
    vi.setSystemTime(new Date(enteredAt))
    page.control('監査').dispatch('click')
    await settle()
    const original = { ...page.queries[0] }
    page.search()
    await settle()
    expect(page.queries[1]?.to).toBe(original.to)
    expect(page.queries[1]?.from).toBe(original.from)
    expect(page.input('audit-to').step).toBe('0.001')
    expect(new Date(page.input('audit-to').value).toISOString()).toBe(enteredAt)
    expect(page.root.textContent).toContain('認証ポリシーを変更')
  })

  it('preserves draft and submitted ranges while pagination and CSV use loaded bounds', async () => {
    const page = auditWorkspace()
    await settle()
    vi.setSystemTime(new Date(enteredAt))
    page.control('監査').dispatch('click')
    await settle()
    const from = '2026-10-03T10:15:23.456Z'
    const to = '2026-10-04T10:45:12.321Z'
    page.input('audit-from').value = localValue(from)
    page.input('audit-from').dispatch('input')
    page.input('audit-to').value = localValue(to)
    page.input('audit-to').dispatch('input')
    page.input('audit-event').value = 'organization.member.invite'
    page.input('audit-event').dispatch('change')
    page.publish({ ...page.state(), mfaVerified: true })
    expect(page.input('audit-from').value).toBe(localValue(from))
    expect(page.input('audit-to').value).toBe(localValue(to))
    expect(page.input('audit-event').value).toBe('organization.member.invite')
    page.search()
    await settle()
    expect(page.queries[1]).toMatchObject({
      from,
      to,
      eventName: 'organization.member.invite',
    })
    vi.setSystemTime(new Date('2026-10-04T12:05:00.999Z'))
    page.control('次の記録').dispatch('click')
    await settle()
    expect(page.queries[2]).toMatchObject({
      from,
      to,
      eventName: 'organization.member.invite',
      continuationToken: 'synthetic-cursor',
    })
    expect(page.input('audit-to').value).toBe(localValue(to))
    const unsubmittedTo = localValue('2026-10-04T11:00:05.678Z')
    page.input('audit-to').value = unsubmittedTo
    page.input('audit-to').dispatch('input')
    page.control('検索範囲をCSV出力').dispatch('click')
    await settle()
    expect(page.exports).toEqual([
      { from, to, eventName: 'organization.member.invite' },
    ])
    expect(page.input('audit-to').value).toBe(unsubmittedTo)
  })

  it('starts a fresh pristine range after a new authentication lifecycle', async () => {
    const page = auditWorkspace()
    await settle()
    vi.setSystemTime(new Date(enteredAt))
    page.control('監査').dispatch('click')
    await settle()
    page.publish({ ...page.state(), phase: 'locked' })
    vi.setSystemTime(new Date('2026-10-04T12:30:00.345Z'))
    page.publish({ ...page.state(), phase: 'unlocked' })
    await settle()
    page.control('監査').dispatch('click')
    await settle()
    expect(page.queries.at(-1)?.to).toBe('2026-10-04T12:30:00.345Z')
  })

  it('clears the prior organization cursor and draft on an explicit organization switch', async () => {
    const page = auditWorkspace()
    await settle()
    vi.setSystemTime(new Date(enteredAt))
    page.control('監査').dispatch('click')
    await settle()
    page.control('次の記録').dispatch('click')
    await settle()
    page.input('audit-to').value = localValue(mountedAt)
    page.input('audit-to').dispatch('input')
    vi.setSystemTime(new Date('2026-10-04T12:00:00.111Z'))
    page.input('organization-select').value = 'org-2'
    page.input('organization-select').dispatch('change')
    await settle()
    page.control('監査').dispatch('click')
    await settle()
    expect(page.queryScopes.at(-1)?.organizationId).toBe('org-2')
    expect(page.queries.at(-1)?.continuationToken).toBeUndefined()
    expect(page.queries.at(-1)?.to).toBe('2026-10-04T12:00:00.111Z')
    expect(page.input('audit-to').value).toBe(
      localValue('2026-10-04T12:00:00.111Z'),
    )
  })

  it('clears scoped cursor and draft on an implicit membership-loss fallback', async () => {
    const page = auditWorkspace()
    await settle()
    vi.setSystemTime(new Date(enteredAt))
    page.control('監査').dispatch('click')
    await settle()
    page.control('次の記録').dispatch('click')
    await settle()
    page.input('audit-to').value = localValue(mountedAt)
    page.input('audit-to').dispatch('input')
    vi.setSystemTime(new Date('2026-10-04T12:00:00.222Z'))
    page.publish({
      ...page.state(),
      organizations: [{ id: 'org-2', name: 'Synthetic second org', role: 0 }],
    })
    await settle()
    expect(page.queryScopes.at(-1)?.organizationId).toBe('org-2')
    expect(page.queries.at(-1)?.continuationToken).toBeUndefined()
    expect(page.queries.at(-1)?.to).toBe('2026-10-04T12:00:00.222Z')
    expect(page.input('audit-to').value).toBe(
      localValue('2026-10-04T12:00:00.222Z'),
    )
  })

  it('invalidates a loaded snapshot and draft on same-phase email identity change', async () => {
    const page = auditWorkspace()
    await settle()
    vi.setSystemTime(new Date(enteredAt))
    page.control('監査').dispatch('click')
    await settle()
    page.input('audit-to').value = localValue(mountedAt)
    page.input('audit-to').dispatch('input')
    vi.setSystemTime(new Date('2026-10-04T12:10:00.333Z'))
    page.publish({ ...page.state(), email: 'changed@example.invalid' })
    await settle()
    expect(page.queries).toHaveLength(2)
    expect(page.queryScopes.at(-1)?.email).toBe('changed@example.invalid')
    expect(page.queries.at(-1)?.to).toBe('2026-10-04T12:10:00.333Z')
    expect(page.root.querySelector('table')?.textContent).toContain(
      'メンバーを招待',
    )
    expect(page.root.querySelector('table')?.textContent).not.toContain(
      '認証ポリシーを変更',
    )
  })

  it('ignores an old deferred read after same-phase email identity change', async () => {
    const page = auditWorkspace()
    await settle()
    vi.setSystemTime(new Date(enteredAt))
    page.control('監査').dispatch('click')
    await settle()
    page.deferAudit()
    page.search()
    await settle()
    vi.setSystemTime(new Date('2026-10-04T12:15:00.444Z'))
    page.publish({ ...page.state(), email: 'changed@example.invalid' })
    await settle()
    expect(page.queryScopes.at(-1)?.email).toBe('changed@example.invalid')
    page.releaseAudit()
    await settle()
    expect(page.input('audit-to').value).toBe(
      localValue('2026-10-04T12:15:00.444Z'),
    )
    expect(page.root.querySelector('table')?.textContent).toContain(
      'メンバーを招待',
    )
    expect(page.root.querySelector('table')?.textContent).not.toContain(
      '認証ポリシーを変更',
    )
  })

  it('does not download an old deferred export after same-phase email identity change', async () => {
    const page = auditWorkspace()
    await settle()
    vi.setSystemTime(new Date(enteredAt))
    page.control('監査').dispatch('click')
    await settle()
    const createUrl = vi.spyOn(URL, 'createObjectURL')
    page.deferExport()
    page.control('検索範囲をCSV出力').dispatch('click')
    await settle()
    expect(page.exports).toHaveLength(1)
    vi.setSystemTime(new Date('2026-10-04T12:20:00.555Z'))
    page.publish({ ...page.state(), email: 'changed@example.invalid' })
    await settle()
    page.releaseExport()
    await settle()
    expect(createUrl).not.toHaveBeenCalled()
    expect(page.root.textContent).not.toContain('CSVを出力しました')
  })
})

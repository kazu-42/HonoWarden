import { afterEach, describe, expect, it, vi } from 'vitest'

import { mountAdminApp } from '../admin/app'
import type { AdminClient, SessionView } from '../admin/browser/contracts'

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
})

function workspace(initialOrganizations: SessionView['organizations'] = []) {
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
    organizations: initialOrganizations,
  }
  let subscriber: (next: SessionView) => void = () => {}
  let finishSync!: () => void
  const listCollections = vi.fn(async () => [
    {
      id: 'collection-1',
      organizationId: 'org-1',
      name: { status: 'decrypted' as const, value: 'Synthetic collection' },
    },
  ])
  const client = {
    getSession: () => state,
    subscribe: (listener: typeof subscriber) => {
      subscriber = listener
      return () => {}
    },
    sync: () =>
      new Promise<void>((resolve) => {
        finishSync = () => {
          state = {
            ...state,
            organizations: [{ id: 'org-1', name: 'Synthetic org', role: 2 }],
          }
          subscriber(state)
          resolve()
        }
      }),
    listCollections,
    dispose: vi.fn(),
  } as unknown as AdminClient
  unmount = mountAdminApp(root as unknown as HTMLElement, client)
  const control = (label: string): TestElement => {
    const found = root
      .querySelectorAll('button')
      .find((item) => item.dataset.focusKey === label)
    if (!found) throw new Error('Expected UI control missing')
    return found
  }
  return { root, control, finishSync: () => finishSync(), listCollections }
}

describe('organization adoption during a delayed workspace refresh', () => {
  it('shows pending refresh before the no-organization empty state', () => {
    const page = workspace()
    page.control('再取得').dispatch('click')
    expect(page.root.textContent).toContain('最新の状態を取得しています')
    expect(page.root.textContent).not.toContain('組織のワークスペースを始める')
    expect(page.control('コレクション').disabled).toBe(true)
  })

  it('keeps the refresh current when navigation is dispatched before sync resolves', async () => {
    const page = workspace()
    page.control('再取得').dispatch('click')
    page.control('コレクション').dispatch('click')
    page.finishSync()
    await vi.waitFor(() => {
      expect(page.listCollections).toHaveBeenCalledWith('org-1')
      expect(page.control('再取得').disabled).toBe(false)
    })
    expect(page.root.querySelector('#organization-select')?.value).toBe('org-1')
    page.control('コレクション').dispatch('click')
    await vi.waitFor(() => {
      expect(page.root.textContent).toContain('Synthetic collection')
    })
  })

  it('keeps navigation available while an already selected organization loads', () => {
    const page = workspace([{ id: 'org-1', name: 'Synthetic org', role: 2 }])
    expect(page.control('コレクション').disabled).toBe(false)
    expect(page.root.textContent).toContain('最新の状態を取得しています')
  })
})

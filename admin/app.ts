import { createAdminClient } from './browser/admin-client'
import {
  AdminError,
  type AdminClient,
  type AuditFilter,
  type AuditPage,
  type CollectionGrant,
  type CollectionView,
  type EmailVerificationAttempt,
  type GroupView,
  type MemberStatus,
  type MemberView,
  type OrganizationView,
  type PolicyView,
  type Role,
  type TotpSetupView,
} from './browser/contracts'

type Tone = 'neutral' | 'warning' | 'error' | 'success'
export type UiNotice = {
  title: string
  message: string
  tone: Tone
  reference?: string
}
export type MutationOutcome<T> =
  | { kind: 'confirmed'; data: T }
  | { kind: 'partial' | 'unknown' | 'rejected'; error: unknown; data?: T }
  | { kind: 'stale' }

export async function runMutationWithReadback<T>(input: {
  operation: () => Promise<unknown>
  readback: () => Promise<T>
  isCurrent: () => boolean
}): Promise<MutationOutcome<T>> {
  if (!input.isCurrent()) return { kind: 'stale' }
  let failure: unknown
  let failed = false
  try {
    await input.operation()
  } catch (error) {
    failure = error
    failed = true
  }
  if (!input.isCurrent()) return { kind: 'stale' }
  let data: T
  try {
    data = await input.readback()
  } catch (error) {
    if (!input.isCurrent()) return { kind: 'stale' }
    return {
      kind:
        failure instanceof AdminError && failure.persisted
          ? 'partial'
          : 'unknown',
      error: failed ? failure : error,
    }
  }
  if (!input.isCurrent()) return { kind: 'stale' }
  if (!failed) return { kind: 'confirmed', data }
  const kind =
    failure instanceof AdminError && failure.persisted
      ? 'partial'
      : !(failure instanceof AdminError) ||
          ['transport', 'unavailable'].includes(failure.kind)
        ? 'unknown'
        : 'rejected'
  return { kind, error: failure, data }
}

export async function runMfaVerification<T>(input: {
  operation: () => Promise<unknown>
  readback: () => Promise<T>
  isCurrent: () => boolean
  clearEphemeral: () => void
}): Promise<MutationOutcome<T>> {
  if (!input.isCurrent()) return { kind: 'stale' }
  let failure: unknown
  let failed = false
  try {
    await input.operation()
  } catch (error) {
    failure = error
    failed = true
  }
  if (!input.isCurrent()) return { kind: 'stale' }
  if (
    failed &&
    failure instanceof AdminError &&
    !failure.persisted &&
    !['transport', 'unavailable'].includes(failure.kind)
  )
    return { kind: 'rejected', error: failure }
  input.clearEphemeral()
  try {
    const data = await input.readback()
    if (!input.isCurrent()) return { kind: 'stale' }
    return failed
      ? { kind: 'unknown', error: failure, data }
      : { kind: 'confirmed', data }
  } catch (error) {
    if (!input.isCurrent()) return { kind: 'stale' }
    return { kind: 'unknown', error: failed ? failure : error }
  }
}

export type EmailVerificationUiOutcome =
  | { kind: 'verified' }
  | { kind: 'proofUnavailable' }
  | { kind: 'stale' }
  | { kind: 'rejected'; error: unknown }
  | {
      kind: 'unknown'
      error: unknown
      canonicalVerified?: boolean
    }

export async function runEmailVerificationSubmission(input: {
  submit: EmailVerificationAttempt['submit']
  dispose: () => void
  isCurrent: () => boolean
  currentVerification: () => boolean | undefined
  readback: () => Promise<boolean | undefined>
}): Promise<EmailVerificationUiOutcome> {
  if (!input.isCurrent()) {
    input.dispose()
    return { kind: 'stale' }
  }
  let failure: unknown
  try {
    const result = await input.submit()
    if (!input.isCurrent()) {
      input.dispose()
      return { kind: 'stale' }
    }
    if (result.status === 'proofUnavailable') {
      input.dispose()
      return { kind: 'proofUnavailable' }
    }
    input.dispose()
    if (input.currentVerification() === true) return { kind: 'verified' }
    failure = new AdminError(
      'unavailable',
      'email_verification_readback_failed',
    )
  } catch (error) {
    input.dispose()
    if (!input.isCurrent()) return { kind: 'stale' }
    if (
      error instanceof AdminError &&
      !['transport', 'unavailable'].includes(error.kind)
    )
      return { kind: 'rejected', error }
    failure = error
  }
  try {
    const canonicalVerified = await input.readback()
    if (!input.isCurrent()) return { kind: 'stale' }
    return canonicalVerified === undefined
      ? { kind: 'unknown', error: failure }
      : { kind: 'unknown', error: failure, canonicalVerified }
  } catch {
    if (!input.isCurrent()) return { kind: 'stale' }
    return { kind: 'unknown', error: failure }
  }
}

export function formatUiError(error: unknown): UiNotice {
  const result: UiNotice = {
    title: '操作結果を確認できません',
    message:
      '最新の状態を再取得してください。送信済みの操作が保存されている可能性があります。',
    tone: 'error',
  }
  if (!(error instanceof AdminError)) return result
  if (error.requestId && /^[\w-]{1,128}$/.test(error.requestId))
    result.reference = error.requestId
  if (error.persisted)
    return {
      ...result,
      title: '招待は保存されましたが、メール送信を確認できません',
      message:
        'メンバーの状態を確認してください。まだ招待中の方には、個別に再招待できます。新しい招待は前のリンクを無効にします。',
      tone: 'warning',
    }
  if (error.httpStatus === 501 || error.code === 'unsupported_feature')
    return {
      ...result,
      title: 'この環境では利用できません',
      message:
        'この機能は現在の環境で有効になっていません。ほかの利用できる画面から作業を続けられます。',
      tone: 'neutral',
    }
  if (error.code === 'server_misconfigured')
    return {
      ...result,
      title: '管理サービスの設定を確認できません',
      message:
        'サービス側で対応が必要です。参照番号を添えて管理者へお知らせください。',
    }
  if (
    error.code === 'organization_mfa_required' ||
    error.code === 'mfa_required'
  )
    return {
      ...result,
      title: '現在のセッションで本人確認が必要です',
      message:
        'アカウントのセキュリティから認証アプリのコードを確認してください。認証アプリが未登録の場合は、先に登録が必要です。古いセッションでは再サインインしてください。',
      tone: 'warning',
    }
  if (
    error.code === 'recent_auth_required' ||
    error.code === 'reauth_required' ||
    error.code === 'totp_session_required'
  )
    return {
      ...result,
      title: '再サインインが必要です',
      message:
        'この変更には最近のパスワード認証が必要です。一度サインアウトしてサインインし直してください。ロック解除だけでは更新されません。',
      tone: 'warning',
    }
  if (error.httpStatus === 413)
    return {
      ...result,
      title: '出力する記録が多すぎます',
      message:
        '検索期間や操作の種類を絞ってください。CSVは1,000件までの検索結果をまとめて出力できます。',
      tone: 'warning',
    }
  if (error.code === 'totp_code_invalid')
    return {
      ...result,
      title: '認証コードを確認してください',
      message:
        '認証アプリに表示されている新しい6桁のコードを入力してください。一度確認に使ったコードは再利用できません。',
    }
  if (error.code === 'totp_not_enrolled')
    return {
      ...result,
      title: '認証アプリの登録が必要です',
      message:
        'アカウントのセキュリティから認証アプリを登録した後、現在のセッションを本人確認してください。',
      tone: 'warning',
    }
  if (error.kind === 'authentication')
    return {
      ...result,
      title: 'サインインを確認してください',
      message:
        'メールアドレス、パスワード、認証コードを確認してください。期限が切れた場合は再度サインインしてください。',
    }
  if (error.kind === 'authorization' || error.httpStatus === 404)
    return {
      ...result,
      title: '現在この操作を実行できません',
      message:
        '権限または状態が変わった可能性があります。最新の状態を確認してください。',
    }
  if (error.kind === 'conflict')
    return {
      ...result,
      title: '最新の状態を確認してください',
      message:
        'ほかの変更、または現在の状態と競合しています。再取得してから変更内容を確認してください。',
      tone: 'warning',
    }
  if (error.kind === 'rateLimit')
    return {
      ...result,
      title: '操作が集中しています',
      message: error.retryAfterSeconds
        ? `${Math.ceil(error.retryAfterSeconds)}秒ほど待ってから、状態を再取得してください。`
        : 'しばらく待ってから、状態を再取得してください。',
      tone: 'warning',
    }
  if (error.kind === 'crypto')
    return {
      ...result,
      title: '暗号化データを利用できません',
      message:
        '鍵や暗号方式を確認できませんでした。再度ロック解除してください。解決しない場合は管理者へお知らせください。',
    }
  if (error.kind === 'validation')
    return {
      ...result,
      title: '入力内容を確認してください',
      message:
        error.code === 'duplicate_invitation'
          ? '同じメールアドレスが複数あります。重複を取り除いてください。'
          : error.code === 'collection_name_too_long'
            ? 'コレクション名が長すぎます。日本語のみの場合は229文字を目安に短くしてください。'
            : error.code === 'audit_window_invalid'
              ? '開始日時より後の終了日時を指定してください。検索範囲は31日以内です。'
              : error.code === 'invalid_invitation'
                ? 'メールアドレスの形式を確認してください。招待は一度に20名まで指定できます。'
                : '必須項目、入力の形式と長さを確認してください。',
    }
  if (error.kind === 'cancelled')
    return {
      ...result,
      title: '操作を中断しました',
      message: '最新の状態を確認してから続けてください。',
      tone: 'neutral',
    }
  return result
}

export function normalizeInvitationEmails(value: string): string[] {
  const emails = value
    .split(/[\n,;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
  if (
    !emails.length ||
    emails.length > 20 ||
    emails.some(
      (email) =>
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        new TextEncoder().encode(email).length > 254,
    )
  ) {
    throw new AdminError('validation', 'invalid_invitation')
  }
  if (new Set(emails).size !== emails.length)
    throw new AdminError('validation', 'duplicate_invitation')
  return emails
}

type View =
  'overview' | 'members' | 'collections' | 'groups' | 'security' | 'audit'
type Snapshot = {
  members?: readonly MemberView[]
  collections?: readonly CollectionView[]
  groups?: readonly GroupView[]
  policy?: PolicyView
  audit?: AuditPage
  errors: UiNotice[]
}
const viewLabels: Record<View, string> = {
  overview: '概要',
  members: 'メンバー',
  collections: 'コレクション',
  groups: 'グループ',
  security: 'セキュリティ',
  audit: '監査',
}
const roleLabels: Record<Role, string> = {
  0: 'オーナー',
  1: '管理者',
  2: 'メンバー',
}
const statusLabels: Record<MemberStatus, string> = {
  0: '招待中',
  1: '確認待ち',
  2: '利用中',
  '-1': 'アクセス取消済み',
}
const eventLabels: Record<string, string> = {
  'organization.member.invite': 'メンバーを招待',
  'organization.member.reinvite': '招待を再送',
  'organization.member.accept': '招待を承諾',
  'organization.member.confirm': 'メンバーを確認',
  'organization.member.update': '役割・アクセスを変更',
  'organization.member.revoke': 'アクセスを取消',
  'organization.member.remove': 'メンバーを削除',
  'organization.group.create': 'グループを作成',
  'organization.group.update': 'グループを変更',
  'organization.group.delete': 'グループを削除',
  'organization.group.member.remove': 'グループからメンバーを削除',
  'organization.policy.update': '認証ポリシーを変更',
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag)
  if (className) result.className = className
  for (const child of children)
    if (child !== null && child !== undefined) result.append(child)
  return result
}
function button(
  label: string,
  action: () => void,
  tone = '',
  accessibleLabel?: string,
): HTMLButtonElement {
  const result = element('button', `button ${tone}`, label)
  result.type = 'button'
  if (accessibleLabel) result.setAttribute('aria-label', accessibleLabel)
  result.dataset.focusKey = accessibleLabel ?? label
  result.addEventListener('click', action)
  return result
}
function field(
  id: string,
  label: string,
  type = 'text',
  value = '',
  help?: string,
) {
  const input = element('input')
  input.id = id
  input.name = id
  input.type = type
  input.value = value
  const caption = element('label', 'field-label', label)
  caption.htmlFor = id
  const root = element('div', 'field', caption, input)
  if (help) {
    const hint = element('small', 'field-help', help)
    hint.id = `${id}-help`
    input.setAttribute('aria-describedby', hint.id)
    root.append(hint)
  }
  return { root, input }
}
function selectField(
  id: string,
  label: string,
  options: [string, string][],
  value: string,
) {
  const input = element('select')
  input.id = id
  input.name = id
  for (const [key, text] of options) {
    const option = element('option', '', text)
    option.value = key
    input.append(option)
  }
  input.value = value
  const caption = element('label', 'field-label', label)
  caption.htmlFor = id
  return { root: element('div', 'field', caption, input), input }
}
function check(label: string, checked: boolean, accessibleLabel?: string) {
  const input = element('input')
  input.type = 'checkbox'
  input.checked = checked
  if (accessibleLabel) input.setAttribute('aria-label', accessibleLabel)
  return {
    root: element('label', 'check-label', input, element('span', '', label)),
    input,
  }
}
function noticeNode(notice: UiNotice): HTMLElement {
  const copy = element(
    'div',
    'notice-copy',
    element('strong', '', notice.title),
    element('p', '', notice.message),
  )
  if (notice.reference)
    copy.append(element('small', '', `参照番号: ${notice.reference}`))
  const root = element(
    'div',
    `notice ${notice.tone === 'success' ? '' : notice.tone}`,
    copy,
  )
  root.setAttribute('role', notice.tone === 'error' ? 'alert' : 'status')
  return root
}
function statusNode(status: MemberStatus): HTMLElement {
  const modifier =
    status === 0
      ? 'pending'
      : status === 1
        ? 'waiting'
        : status === -1
          ? 'revoked'
          : ''
  return element('span', `status ${modifier}`, statusLabels[status])
}
function collectionName(collection: CollectionView): string {
  return collection.name.status === 'decrypted'
    ? collection.name.value
    : `名前を復号できません (${collection.id})`
}
function validateCollectionName(value: string): string {
  const name = value.trim()
  if (!name) throw new AdminError('validation', 'required_name')
  if (new TextEncoder().encode(name).length > 687)
    throw new AdminError('validation', 'collection_name_too_long')
  return name
}
function emptyState(
  title: string,
  copy: string,
  action?: HTMLElement,
): HTMLElement {
  const glyph = element('div', 'empty-glyph', '◇')
  glyph.setAttribute('aria-hidden', 'true')
  return element(
    'div',
    'empty-state',
    glyph,
    element('h2', '', title),
    element('p', '', copy),
    action,
  )
}
function table(headers: string[], rows: HTMLElement[]): HTMLElement {
  const head = element('tr')
  for (const label of headers) {
    const th = element('th', '', label)
    th.scope = 'col'
    head.append(th)
  }
  return element(
    'div',
    'table-scroll',
    element(
      'table',
      'data-table',
      element('thead', '', head),
      element('tbody', '', ...rows),
    ),
  )
}
function memberIdentity(member: MemberView): HTMLElement {
  const display = member.name || member.email
  const initial = Array.from(display)[0]?.toUpperCase() ?? '?'
  const avatar = element('span', 'avatar', initial)
  avatar.setAttribute('aria-hidden', 'true')
  return element(
    'div',
    'member-cell',
    avatar,
    element(
      'div',
      'member-identity',
      element('span', 'member-name', display),
      member.name ? element('span', 'member-email', member.email) : null,
    ),
  )
}
function grantEditor(
  collections: readonly CollectionView[],
  initial: readonly CollectionGrant[],
) {
  const selected = new Map(initial.map((grant) => [grant.id, { ...grant }]))
  const root = element('div', 'grant-list')
  for (const collection of collections) {
    const name = collectionName(collection)
    const existing = selected.get(collection.id)
    const assigned = check(
      name,
      Boolean(existing),
      `${name}にアクセスを割り当てる`,
    )
    const readOnly = check(
      '閲覧のみ',
      existing?.readOnly ?? true,
      `${name}: 閲覧のみ`,
    )
    const hide = check(
      '画面でパスワードを非表示',
      existing?.hidePasswords ?? false,
      `${name}: パスワードを画面で非表示`,
    )
    const manage = check(
      'コレクション管理',
      existing?.manage ?? false,
      `${name}: コレクション管理`,
    )
    const options = element(
      'div',
      'grant-options',
      readOnly.root,
      hide.root,
      manage.root,
    )
    options.hidden = !assigned.input.checked
    const update = () => {
      options.hidden = !assigned.input.checked
      if (!assigned.input.checked) selected.delete(collection.id)
      else
        selected.set(collection.id, {
          id: collection.id,
          readOnly: readOnly.input.checked,
          hidePasswords: hide.input.checked,
          manage: manage.input.checked,
        })
    }
    for (const control of [
      assigned.input,
      readOnly.input,
      hide.input,
      manage.input,
    ])
      control.addEventListener('change', update)
    root.append(element('div', 'grant-item', assigned.root, options))
  }
  if (!collections.length)
    root.append(
      element(
        'p',
        'panel-body note',
        '現在、選択できるコレクションはありません。',
      ),
    )
  const known = new Set(collections.map((collection) => collection.id))
  const unknown = initial.filter((grant) => !known.has(grant.id))
  if (unknown.length)
    root.append(
      element(
        'p',
        'panel-body note',
        `名称を確認できない既存の割当 ${unknown.length}件は、そのまま保持します。`,
      ),
    )
  return { root, value: () => [...selected.values()] }
}

export function mountAdminApp(
  root: HTMLElement,
  client: AdminClient,
): () => void {
  let session = client.getSession()
  let selectedOrganizationId: string | null = null
  let view: View = 'overview'
  let epoch = 0
  let snapshot: Snapshot = { errors: [] }
  let loading = false
  let mutating = false
  let outcomeNotice: UiNotice | null = null
  let activeDialog: HTMLDialogElement | null = null
  let dialogGeneration = 0
  let disposed = false
  let observedAt: Date | null = null
  let focusMainAfterLoad = false
  let focusAuthAfterRender = true
  const dialogCleanups = new WeakMap<HTMLDialogElement, () => void>()
  let memberSearch = ''
  let memberStatus = 'all'
  let auditFilter: AuditFilter | null = null
  let auditDraft: { from: string; to: string; eventName: string } | null = null

  const organization = (): OrganizationView | undefined =>
    session.organizations?.find((item) => item.id === selectedOrganizationId)
  const manager = (): boolean =>
    organization()?.role === 0 || organization()?.role === 1
  const owner = (): boolean => organization()?.role === 0
  const current = (capturedEpoch: number, orgId: string | null): boolean =>
    !disposed &&
    session.phase === 'unlocked' &&
    epoch === capturedEpoch &&
    selectedOrganizationId === orgId

  function currentAuditFilter(): AuditFilter {
    if (!auditFilter) {
      const now = Date.now()
      auditFilter = {
        from: new Date(now - 7 * 86400000).toISOString(),
        to: new Date(now).toISOString(),
        limit: 50,
      }
    }
    return auditFilter
  }
  function loadedAuditFilter(page: AuditPage): AuditFilter {
    return {
      from: page.query.from,
      to: page.query.to,
      limit: page.query.limit,
      ...(page.query.eventName ? { eventName: page.query.eventName } : {}),
      ...(page.query.actorUserId
        ? { actorUserId: page.query.actorUserId }
        : {}),
    }
  }
  function setSelectedOrganization(id: string | null): void {
    if (selectedOrganizationId === id) return
    selectedOrganizationId = id
    auditFilter = null
    auditDraft = null
  }

  function closeDialog(): void {
    dialogGeneration++
    if (!activeDialog) return
    dialogCleanups.get(activeDialog)?.()
    dialogCleanups.delete(activeDialog)
    for (const input of activeDialog.querySelectorAll('input, textarea')) {
      if (
        input instanceof HTMLInputElement ||
        input instanceof HTMLTextAreaElement
      )
        input.value = ''
    }
    activeDialog.close()
    activeDialog.remove()
    activeDialog = null
  }
  function invalidate(): void {
    epoch++
    closeDialog()
    snapshot = { errors: [] }
    outcomeNotice = null
    loading = false
    mutating = false
    observedAt = null
    memberSearch = ''
    memberStatus = 'all'
  }
  function showDialog(
    title: string,
    content: HTMLElement,
    submitLabel: string,
    submit: (form: HTMLFormElement, errorArea: HTMLElement) => Promise<void>,
    danger = false,
    cleanup?: () => void,
    canSubmit?: () => boolean,
  ): void {
    closeDialog()
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const dialog = element('dialog', 'dialog')
    activeDialog = dialog
    if (cleanup) dialogCleanups.set(dialog, cleanup)
    const heading = element('h2', '', title)
    heading.id = 'admin-dialog-title'
    dialog.setAttribute('aria-labelledby', heading.id)
    const dismiss = button(
      '閉じる',
      () => closeDialog(),
      'quiet compact',
      `${title}を閉じる`,
    )
    const errorArea = element('div', 'dialog-errors')
    errorArea.setAttribute('aria-live', 'polite')
    const form = element('form', 'dialog-body', errorArea, content)
    const cancel = button('キャンセル', () => closeDialog())
    const save = element(
      'button',
      `button ${danger ? 'danger' : 'primary'}`,
      submitLabel,
    )
    save.type = 'submit'
    save.disabled = canSubmit ? !canSubmit() : false
    form.append(element('div', 'dialog-footer', cancel, save))
    dialog.append(element('div', 'dialog-header', heading, dismiss), form)
    document.body.append(dialog)
    dialog.addEventListener('close', () => {
      dialogCleanups.get(dialog)?.()
      dialogCleanups.delete(dialog)
      if (activeDialog === dialog) activeDialog = null
      dialog.remove()
      if (session.phase === 'unlocked' && trigger?.isConnected) trigger.focus()
      else root.querySelector<HTMLElement>('h1, h2')?.focus()
    })
    dialog.addEventListener('cancel', () => closeDialog())
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      if (save.disabled) return
      save.disabled = true
      form.setAttribute('aria-busy', 'true')
      errorArea.replaceChildren()
      void submit(form, errorArea)
        .catch((error: unknown) => {
          if (activeDialog === dialog)
            errorArea.replaceChildren(noticeNode(formatUiError(error)))
        })
        .finally(() => {
          save.disabled = canSubmit ? !canSubmit() : false
          form.removeAttribute('aria-busy')
        })
    })
    dialog.showModal()
    if (danger) cancel.focus()
    else form.querySelector<HTMLElement>('input, select, textarea')?.focus()
  }

  async function fetchSnapshot(
    orgId: string,
    targetView: View,
  ): Promise<Snapshot> {
    const result: Snapshot = { errors: [] }
    const tasks: Promise<void>[] = []
    const read = <T>(
      label: string,
      operation: () => Promise<T>,
      assign: (data: T) => void,
    ): void => {
      tasks.push(
        operation()
          .then(assign)
          .catch((error: unknown) => {
            const notice = formatUiError(error)
            result.errors.push({
              ...notice,
              message: `${label}: ${notice.message}`,
            })
          }),
      )
    }
    if (['overview', 'members', 'collections'].includes(targetView))
      read(
        'コレクション',
        () => client.listCollections(orgId),
        (data) => {
          result.collections = data
        },
      )
    if (['overview', 'members'].includes(targetView) && manager())
      read(
        'メンバー',
        () => client.listMembers(orgId),
        (data) => {
          result.members = data
        },
      )
    if (targetView === 'groups' && manager())
      read(
        'グループ',
        () => client.listGroups(orgId),
        (data) => {
          result.groups = data
        },
      )
    if (targetView === 'security')
      read(
        'セキュリティ',
        () => client.getPolicy(orgId),
        (data) => {
          result.policy = data
        },
      )
    if (targetView === 'audit' && manager())
      read(
        '監査',
        () => client.listAudit(orgId, currentAuditFilter()),
        (data) => {
          result.audit = data
        },
      )
    await Promise.all(tasks)
    return result
  }
  async function loadView(): Promise<void> {
    const orgId = selectedOrganizationId
    if (!orgId || session.phase !== 'unlocked') {
      loading = false
      render()
      return
    }
    const capturedEpoch = epoch
    loading = true
    render()
    const next = await fetchSnapshot(orgId, view)
    if (!current(capturedEpoch, orgId)) return
    snapshot = next
    if (next.audit)
      auditFilter = {
        ...loadedAuditFilter(next.audit),
        ...(auditFilter?.continuationToken
          ? { continuationToken: auditFilter.continuationToken }
          : {}),
      }
    loading = false
    observedAt = new Date()
    render()
  }
  function selectView(next: View): void {
    if (loading && !selectedOrganizationId) return
    invalidate()
    view = next
    focusMainAfterLoad = true
    void loadView()
  }
  function selectOrganization(id: string): void {
    invalidate()
    setSelectedOrganization(id)
    view = 'overview'
    focusMainAfterLoad = true
    void loadView()
  }
  async function refreshWorkspace(): Promise<void> {
    invalidate()
    const capturedEpoch = epoch
    const orgId = selectedOrganizationId
    loading = true
    render()
    try {
      await client.sync()
      if (!current(capturedEpoch, orgId)) return
      const newlyAvailable = session.organizations?.[0]
      if (!selectedOrganizationId && newlyAvailable && !activeDialog)
        selectOrganization(newlyAvailable.id)
      else await loadView()
    } catch (error) {
      if (!current(capturedEpoch, orgId)) return
      loading = false
      outcomeNotice = formatUiError(error)
      render()
    }
  }
  async function mutate(
    title: string,
    operation: () => Promise<unknown>,
  ): Promise<void> {
    const orgId = selectedOrganizationId
    if (!orgId || mutating) return
    const capturedEpoch = epoch
    const targetView = view
    const submittedDialog = activeDialog
    mutating = true
    outcomeNotice = {
      title: '保存結果を確認しています',
      message: '操作の送信と最新状態の確認が終わるまでお待ちください。',
      tone: 'neutral',
    }
    render()
    const result = await runMutationWithReadback({
      operation,
      readback: async () => {
        const next = await fetchSnapshot(orgId, targetView)
        if (next.errors.length)
          throw new AdminError('unavailable', 'readback_unavailable')
        return next
      },
      isCurrent: () => current(capturedEpoch, orgId),
    })
    if (result.kind === 'stale') return
    mutating = false
    if (result.data) {
      snapshot = result.data
      observedAt = new Date()
    }
    outcomeNotice =
      result.kind === 'confirmed'
        ? { title, message: '最新の状態を取得しました。', tone: 'success' }
        : formatUiError(result.error)
    if (activeDialog === submittedDialog) {
      if (
        result.kind === 'confirmed' ||
        result.kind === 'partial' ||
        result.kind === 'unknown'
      )
        closeDialog()
      else
        activeDialog
          ?.querySelector('.dialog-errors')
          ?.replaceChildren(noticeNode(outcomeNotice))
    }
    render()
  }

  function heading(
    title: string,
    description: string,
    actions: HTMLElement[] = [],
  ): HTMLElement {
    const label = element('h1', '', title)
    label.tabIndex = -1
    return element(
      'div',
      'page-heading',
      element(
        'div',
        'page-heading-copy',
        element('p', 'eyebrow', 'Organization workspace'),
        label,
        element('p', 'page-description', description),
      ),
      element('div', 'heading-actions', ...actions),
    )
  }
  function accessNotice(): HTMLElement {
    return emptyState(
      '管理者向けの画面です',
      'この画面は組織のオーナーまたは管理者が利用できます。',
    )
  }
  function overviewView(): HTMLElement {
    const result = element(
      'div',
      '',
      heading(
        '組織のアクセスを見渡す',
        '参加の確認から日々の権限管理まで。現在の組織の状態をここで確認できます。',
      ),
    )
    const count = (
      label: string,
      value: number | undefined,
      note: string,
    ): HTMLElement =>
      element(
        'div',
        'metric',
        element('span', 'metric-label', label),
        element(
          'strong',
          'metric-value',
          value === undefined ? '—' : String(value),
        ),
        element('small', 'metric-note', note),
      )
    const pending = snapshot.members?.filter(
      (member) => member.status === 0 || member.status === 1,
    )
    result.append(
      element(
        'div',
        'metrics',
        count(
          '利用中のメンバー',
          snapshot.members?.filter((member) => member.status === 2).length,
          '確認済みのメンバー',
        ),
        count('参加の手続き中', pending?.length, '招待中・管理者の確認待ち'),
        count(
          'コレクション',
          snapshot.collections?.length,
          'あなたが閲覧できるコレクション',
        ),
      ),
    )
    const next = element(
      'div',
      'panel',
      element(
        'div',
        'panel-header',
        element('h2', '', '次に確認すること'),
        manager()
          ? button(
              'メンバーを開く',
              () => selectView('members'),
              'quiet compact',
            )
          : null,
      ),
    )
    const list = element('ul', 'activity-list')
    for (const member of pending?.slice(0, 5) ?? [])
      list.append(
        element(
          'li',
          '',
          element(
            'div',
            'activity-person',
            element('strong', '', member.name || member.email),
            element('small', '', member.email),
          ),
          statusNode(member.status),
        ),
      )
    next.append(
      pending === undefined
        ? element(
            'div',
            'panel-body note',
            'メンバー管理の状態は、許可されたメンバー一覧を取得すると表示されます。',
          )
        : pending.length
          ? element('div', 'panel-body', list)
          : emptyState(
              '参加の手続きはありません',
              '招待や管理者の確認を待っているメンバーはいません。',
            ),
    )
    const information = element(
      'div',
      'panel',
      element('div', 'panel-header', element('h2', '', 'このワークスペース')),
      element(
        'div',
        'panel-body',
        element(
          'dl',
          'detail-list',
          element('dt', '', '組織'),
          element('dd', '', organization()?.name ?? ''),
          element('dt', '', 'あなたの役割'),
          element('dd', '', roleLabels[organization()?.role ?? 2]),
          element('dt', '', '確認日時'),
          element('dd', '', observedAt?.toLocaleString('ja-JP') ?? '未取得'),
        ),
        element(
          'p',
          'note',
          '役割とコレクションへのアクセスは別の設定です。管理者でも、すべてのコレクションに自動でアクセスできるとは限りません。',
        ),
      ),
    )
    result.append(element('div', 'overview-grid', next, information))
    return result
  }
  function membersView(): HTMLElement {
    const result = element(
      'div',
      '',
      heading(
        'メンバー',
        '招待、参加の確認、役割とコレクションへのアクセスを管理します。',
        manager()
          ? [
              button(
                'メンバーを招待',
                () => {
                  void inviteDialog()
                },
                'primary',
              ),
            ]
          : [],
      ),
    )
    if (!manager()) {
      result.append(accessNotice())
      return result
    }
    if (!snapshot.members) return result
    const panel = element('div', 'panel')
    const search = field(
      'member-search',
      'メンバーを検索',
      'search',
      memberSearch,
    )
    search.root.classList.add('grow')
    search.input.placeholder = '名前またはメールアドレス'
    const filter = selectField(
      'member-status',
      '状態',
      [
        ['all', 'すべての状態'],
        ['0', '招待中'],
        ['1', '確認待ち'],
        ['2', '利用中'],
        ['-1', 'アクセス取消済み'],
      ],
      memberStatus,
    )
    const tableArea = element('div')
    function renderRows(): void {
      const rows =
        snapshot.members
          ?.filter((member) => {
            const matchesStatus =
              memberStatus === 'all' || String(member.status) === memberStatus
            return (
              matchesStatus &&
              `${member.name ?? ''} ${member.email}`
                .toLowerCase()
                .includes(memberSearch.toLowerCase())
            )
          })
          .map((member) => {
            const actions: HTMLElement[] = [
              button(
                '詳細・変更',
                () => {
                  void memberDialog(member)
                },
                'quiet compact',
                `${member.email}の詳細とアクセスを確認`,
              ),
            ]
            const canManage = owner() || member.type === 2
            if (canManage && member.status === 1)
              actions.push(
                button(
                  '確認する',
                  () => confirmMemberDialog(member),
                  'compact',
                  `${member.email}の参加を確認`,
                ),
              )
            if (canManage && member.status === 0)
              actions.push(
                button(
                  '再招待',
                  () => reinviteDialog(member),
                  'compact',
                  `${member.email}を再招待`,
                ),
              )
            return element(
              'tr',
              '',
              element('td', '', memberIdentity(member)),
              element('td', '', statusNode(member.status)),
              element(
                'td',
                '',
                element('span', 'role-label', roleLabels[member.type]),
              ),
              element('td', '', `${member.collections.length}件`),
              element('td', '', element('div', 'inline-actions', ...actions)),
            )
          }) ?? []
      tableArea.replaceChildren(
        rows.length
          ? table(['メンバー', '状態', '役割', '直接の割当', '操作'], rows)
          : emptyState(
              '該当するメンバーはいません',
              snapshot.members?.length
                ? '検索条件を変えてください。'
                : 'メンバーを招待して、組織への参加を案内できます。',
            ),
      )
    }
    search.input.addEventListener('input', () => {
      memberSearch = search.input.value
      renderRows()
    })
    filter.input.addEventListener('change', () => {
      memberStatus = filter.input.value
      renderRows()
    })
    panel.append(element('div', 'toolbar', search.root, filter.root), tableArea)
    renderRows()
    result.append(
      panel,
      element(
        'p',
        'note',
        '「確認待ち」のメンバーは、まだ共有データを利用できません。管理者が参加を確認するとアクセスが有効になります。',
      ),
    )
    return result
  }
  async function inviteDialog(): Promise<void> {
    const orgId = selectedOrganizationId
    const capturedEpoch = epoch
    if (!orgId) return
    closeDialog()
    const intendedDialogGeneration = dialogGeneration
    let collections: readonly CollectionView[]
    try {
      collections = await client.listCollections(orgId)
    } catch (error) {
      if (
        current(capturedEpoch, orgId) &&
        dialogGeneration === intendedDialogGeneration
      ) {
        outcomeNotice = formatUiError(error)
        render()
      }
      return
    }
    if (
      !current(capturedEpoch, orgId) ||
      dialogGeneration !== intendedDialogGeneration
    )
      return
    const label = element('label', 'field-label', 'メールアドレス（20名まで）')
    const emails = element('textarea')
    emails.id = 'invite-emails'
    emails.name = 'emails'
    emails.required = true
    emails.autocomplete = 'off'
    emails.spellcheck = false
    label.htmlFor = emails.id
    const role = selectField(
      'invite-role',
      '役割',
      owner()
        ? [
            ['2', 'メンバー'],
            ['1', '管理者'],
            ['0', 'オーナー'],
          ]
        : [['2', 'メンバー']],
      '2',
    )
    const grants = grantEditor(collections, [])
    const content = element(
      'div',
      '',
      element(
        'div',
        'field',
        label,
        emails,
        element(
          'small',
          'field-help',
          '1行に1名、またはカンマで区切ってください。重複したアドレスは送信できません。',
        ),
      ),
      role.root,
      element('h3', 'grant-title', '直接割り当てるコレクション'),
      grants.root,
      element(
        'p',
        'note',
        '招待中の割当は、参加が確認されるまで有効になりません。メール到達はこの画面では確認できません。',
      ),
    )
    showDialog('メンバーを招待', content, '招待を作成', async () => {
      const normalized = normalizeInvitationEmails(emails.value)
      if (!current(capturedEpoch, orgId)) return
      await mutate('招待を作成しました', () =>
        client.inviteMembers(orgId, {
          emails: normalized,
          type: Number(role.input.value) as Role,
          collections: grants.value(),
        }),
      )
    })
  }
  async function memberDialog(original: MemberView): Promise<void> {
    const orgId = selectedOrganizationId
    const capturedEpoch = epoch
    if (!orgId) return
    closeDialog()
    const intendedDialogGeneration = dialogGeneration
    let members: readonly MemberView[]
    let collections: readonly CollectionView[]
    try {
      ;[members, collections] = await Promise.all([
        client.listMembers(orgId),
        client.listCollections(orgId),
      ])
    } catch (error) {
      if (
        current(capturedEpoch, orgId) &&
        dialogGeneration === intendedDialogGeneration
      ) {
        outcomeNotice = formatUiError(error)
        render()
      }
      return
    }
    if (
      !current(capturedEpoch, orgId) ||
      dialogGeneration !== intendedDialogGeneration
    )
      return
    const member = members.find((item) => item.id === original.id)
    if (!member) {
      outcomeNotice = formatUiError(
        new AdminError('authorization', 'organization_not_found'),
      )
      render()
      return
    }
    const canManage = owner() || member.type === 2
    const canEdit = canManage && member.status !== -1
    const role = selectField(
      'member-role',
      '役割',
      owner()
        ? [
            ['2', 'メンバー'],
            ['1', '管理者'],
            ['0', 'オーナー'],
          ]
        : [[String(member.type), roleLabels[member.type]]],
      String(member.type),
    )
    role.input.disabled = !canEdit
    const grants = grantEditor(collections, member.collections)
    if (!canEdit)
      for (const control of grants.root.querySelectorAll('input'))
        control.disabled = true
    const content = element(
      'div',
      '',
      element(
        'div',
        'identity-strip',
        element('strong', '', member.name || member.email),
        element('small', '', member.email),
        statusNode(member.status),
      ),
      role.root,
      element('h3', 'grant-title', '直接割り当てるコレクション'),
      grants.root,
      element(
        'p',
        'note',
        'パスワードの非表示は画面上の制御です。割り当てられたメンバーによる、別のクライアントでの復号を防ぐものではありません。',
      ),
    )
    if (canManage)
      content.append(
        element(
          'div',
          'inline-actions',
          member.status !== -1
            ? button(
                'アクセスを取り消す',
                () => revokeDialog(member),
                'danger compact',
              )
            : null,
          button(
            '組織から削除',
            () => removeMemberDialog(member),
            'danger compact',
          ),
        ),
      )
    else
      content.append(
        element(
          'p',
          'note',
          '管理者はオーナーと管理者の権限を変更できません。',
        ),
      )
    if (member.status === -1)
      content.append(
        element(
          'p',
          'note',
          '取り消したメンバーの役割と割当は変更できません。再参加には、記録を削除して新しく招待する必要があります。',
        ),
      )
    showDialog(
      'メンバーのアクセス',
      content,
      canEdit ? '変更を保存' : '閉じる',
      async (form, errorArea) => {
        if (!canEdit) {
          closeDialog()
          return
        }
        const latest = await client.listMembers(orgId)
        if (
          !current(capturedEpoch, orgId) ||
          !form.isConnected ||
          !activeDialog?.contains(form)
        )
          return
        const observed = latest.find((item) => item.id === member.id)
        if (
          !observed ||
          JSON.stringify({
            type: observed.type,
            status: observed.status,
            collections: observed.collections,
          }) !==
            JSON.stringify({
              type: member.type,
              status: member.status,
              collections: member.collections,
            })
        ) {
          throw new AdminError('conflict', 'member_changed')
        }
        const nextGrants = grants.value()
        if (
          member.collections.length &&
          !nextGrants.length &&
          !errorArea.dataset.emptyConfirmed
        ) {
          errorArea.dataset.emptyConfirmed = 'true'
          errorArea.replaceChildren(
            noticeNode({
              title: '直接の割当をすべて取り除きます',
              message:
                'この変更により直接割り当てられたコレクションへのアクセスを失います。確認したら、もう一度「変更を保存」を押してください。',
              tone: 'warning',
            }),
          )
          return
        }
        await mutate('メンバーのアクセスを更新しました', () =>
          client.updateMember(orgId, member.id, {
            type: Number(role.input.value) as Role,
            collections: nextGrants,
          }),
        )
      },
    )
  }
  function confirmMemberDialog(member: MemberView): void {
    const orgId = selectedOrganizationId
    if (!orgId) return
    showDialog(
      '参加を確認',
      element(
        'div',
        '',
        memberIdentity(member),
        element(
          'p',
          'dialog-note',
          'このメンバーが共有データを利用できるようにします。必要な暗号処理はブラウザ内で行います。',
        ),
      ),
      '参加を確認',
      async () =>
        mutate('メンバーの参加を確認しました', () =>
          client.confirmMember(orgId, member.id),
        ),
    )
  }
  function reinviteDialog(member: MemberView): void {
    const orgId = selectedOrganizationId
    if (!orgId) return
    showDialog(
      '招待を再送',
      element(
        'div',
        '',
        memberIdentity(member),
        element(
          'p',
          'dialog-note',
          '新しい招待を作成し、前の招待リンクを無効にします。メール送信の結果が不明な場合も、メンバーの状態を確認してから再送してください。',
        ),
      ),
      '再招待する',
      async () =>
        mutate('新しい招待を作成しました', () =>
          client.reinviteMember(orgId, member.id),
        ),
    )
  }
  function revokeDialog(member: MemberView): void {
    const orgId = selectedOrganizationId
    if (!orgId) return
    showDialog(
      'アクセスを取り消す',
      element(
        'div',
        '',
        memberIdentity(member),
        element(
          'p',
          'dialog-note',
          '今後のサーバーへのアクセスと割当を取り消します。既に取得した秘密やデータは回収できません。必要に応じて会社の認証情報を変更してください。この画面からの復活はできません。',
        ),
      ),
      'アクセスを取り消す',
      async () =>
        mutate('メンバーのアクセスを取り消しました', () =>
          client.revokeMember(orgId, member.id),
        ),
      true,
    )
  }
  function removeMemberDialog(member: MemberView): void {
    const orgId = selectedOrganizationId
    if (!orgId) return
    showDialog(
      '組織からメンバーを削除',
      element(
        'div',
        '',
        memberIdentity(member),
        element(
          'p',
          'dialog-note',
          'アクセスを取り消し、この組織のメンバー記録を削除します。再参加には新しい招待が必要です。既に取得した秘密やデータは回収できません。',
        ),
      ),
      '組織から削除',
      async () =>
        mutate('組織からメンバーを削除しました', () =>
          client.removeMember(orgId, member.id),
        ),
      true,
    )
  }

  function collectionsView(): HTMLElement {
    const result = element(
      'div',
      '',
      heading(
        'コレクション',
        '共有する情報をまとめ、必要なメンバーへアクセスを割り当てます。',
        owner()
          ? [button('コレクションを作成', () => collectionDialog(), 'primary')]
          : [],
      ),
    )
    if (!snapshot.collections) return result
    if (!snapshot.collections.length) {
      result.append(
        element(
          'div',
          'panel',
          emptyState(
            'コレクションはありません',
            'あなたが閲覧できるコレクションがありません。',
          ),
        ),
      )
      return result
    }
    const rows = snapshot.collections.map((collection) =>
      element(
        'tr',
        '',
        element('td', '', element('strong', '', collectionName(collection))),
        element('td', 'audit-id', collection.id),
        element(
          'td',
          '',
          owner() && collection.name.status === 'decrypted'
            ? element(
                'div',
                'inline-actions',
                button(
                  '名前を変更',
                  () => collectionDialog(collection),
                  'quiet compact',
                  `${collectionName(collection)}の名前を変更`,
                ),
                button(
                  '削除',
                  () => deleteCollectionDialog(collection),
                  'danger compact',
                  `${collectionName(collection)}を削除`,
                ),
              )
            : element('span', 'note', '閲覧'),
        ),
      ),
    )
    result.append(
      element(
        'div',
        'panel',
        table(['コレクション名', '識別子', '操作'], rows),
      ),
      element(
        'p',
        'note',
        'メンバーへの直接の割当はメンバー画面で管理します。オーナーでも、このコレクションの管理権限がない場合は変更できません。',
      ),
    )
    return result
  }
  function collectionDialog(collection?: CollectionView): void {
    const orgId = selectedOrganizationId
    if (!orgId) return
    const name = field(
      'collection-name',
      'コレクション名',
      'text',
      collection?.name.status === 'decrypted' ? collection.name.value : '',
      '長い名称は短くしてください。名称はブラウザで暗号化して保存します。',
    )
    name.input.required = true
    showDialog(
      collection ? 'コレクション名を変更' : 'コレクションを作成',
      name.root,
      collection ? '変更を保存' : '作成する',
      async () => {
        const value = validateCollectionName(name.input.value)
        await mutate(
          collection
            ? 'コレクション名を更新しました'
            : 'コレクションを作成しました',
          () =>
            collection
              ? client.updateCollection(orgId, collection.id, { name: value })
              : client.createCollection(orgId, { name: value }),
        )
      },
    )
  }
  function deleteCollectionDialog(collection: CollectionView): void {
    const orgId = selectedOrganizationId
    if (!orgId) return
    showDialog(
      'コレクションを削除',
      element(
        'div',
        '',
        element('strong', '', collectionName(collection)),
        element(
          'p',
          'dialog-note',
          'このコレクションとアクセスの割当を削除します。共有アイテムがほかのコレクションに属していない場合は、削除できません。保管したアイテムを自動で削除する操作ではありません。',
        ),
      ),
      'コレクションを削除',
      async () =>
        mutate('コレクションを削除しました', () =>
          client.deleteCollection(orgId, collection.id),
        ),
      true,
    )
  }

  function groupsView(): HTMLElement {
    const result = element(
      'div',
      '',
      heading(
        'グループ',
        '部署やチームごとに、メンバーとコレクションへのアクセスをまとめます。',
        manager()
          ? [
              button(
                'グループを作成',
                () => {
                  void groupDialog()
                },
                'primary',
              ),
            ]
          : [],
      ),
    )
    if (!manager()) {
      result.append(accessNotice())
      return result
    }
    if (!snapshot.groups) return result
    if (!snapshot.groups.length) {
      result.append(
        element(
          'div',
          'panel',
          emptyState(
            'グループはありません',
            '部署やチームのグループを作成できます。',
          ),
        ),
      )
      return result
    }
    result.append(
      element(
        'div',
        'panel',
        table(
          ['グループ名', '操作'],
          snapshot.groups.map((group) =>
            element(
              'tr',
              '',
              element('td', '', element('strong', '', group.name)),
              element(
                'td',
                '',
                element(
                  'div',
                  'inline-actions',
                  button(
                    'メンバー・アクセス',
                    () => {
                      void groupDialog(group)
                    },
                    'quiet compact',
                    `${group.name}のメンバーとアクセスを変更`,
                  ),
                  button(
                    '削除',
                    () => {
                      void deleteGroupDialog(group)
                    },
                    'danger compact',
                    `${group.name}を削除`,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    )
    return result
  }
  async function groupDialog(group?: GroupView): Promise<void> {
    const orgId = selectedOrganizationId
    const capturedEpoch = epoch
    if (!orgId) return
    closeDialog()
    const intendedDialogGeneration = dialogGeneration
    try {
      const [members, collections, detail] = await Promise.all([
        client.listMembers(orgId),
        client.listCollections(orgId),
        group ? client.getGroup(orgId, group.id) : Promise.resolve(null),
      ])
      if (
        !current(capturedEpoch, orgId) ||
        dialogGeneration !== intendedDialogGeneration
      )
        return
      const name = field('group-name', 'グループ名', 'text', detail?.name ?? '')
      name.input.required = true
      name.input.maxLength = 100
      const selected = new Set(detail?.memberIds ?? [])
      const canEditGroup =
        owner() ||
        !detail?.memberIds.some(
          (id) => members.find((member) => member.id === id)?.type !== 2,
        )
      name.input.disabled = !canEditGroup
      const membership = element('div', 'grant-list')
      for (const member of members) {
        const control = check(
          `${member.name || member.email} · ${statusLabels[member.status]}`,
          selected.has(member.id),
          `${member.email}をグループに含める`,
        )
        const editable = canEditGroup && (owner() || member.type === 2)
        control.input.disabled = !editable
        control.input.addEventListener('change', () =>
          control.input.checked
            ? selected.add(member.id)
            : selected.delete(member.id),
        )
        membership.append(
          element(
            'div',
            'grant-item',
            control.root,
            !editable
              ? element(
                  'small',
                  'field-help',
                  'オーナー・管理者の所属はオーナーが変更します。',
                )
              : null,
          ),
        )
      }
      if (!members.length)
        membership.append(
          element('p', 'panel-body note', '選択できるメンバーがいません。'),
        )
      const grants = grantEditor(collections, detail?.collections ?? [])
      if (!canEditGroup)
        for (const control of grants.root.querySelectorAll('input'))
          control.disabled = true
      let reviewedRevision = detail?.revision
      const comparison = element('div')
      const compareLatest = group
        ? button(
            '最新状態と下書きを比較',
            () => {
              const intendedDialog = activeDialog
              void client
                .getGroup(orgId, group.id)
                .then((latest) => {
                  if (
                    !current(capturedEpoch, orgId) ||
                    activeDialog !== intendedDialog ||
                    !comparison.isConnected
                  )
                    return
                  const memberLabels = latest.memberIds.map(
                    (id) =>
                      members.find((member) => member.id === id)?.email ?? id,
                  )
                  const collectionLabels = latest.collections.map((grant) => {
                    const item = collections.find(
                      (collection) => collection.id === grant.id,
                    )
                    return `${item ? collectionName(item) : grant.id}: ${grant.readOnly ? '閲覧のみ' : '編集可'} / ${grant.hidePasswords ? '画面でパスワードを非表示' : 'パスワード表示可'} / ${grant.manage ? 'コレクション管理可' : '管理なし'}`
                  })
                  comparison.replaceChildren(
                    element(
                      'div',
                      'notice warning',
                      element(
                        'div',
                        'notice-copy',
                        element('strong', '', 'サーバーの最新状態'),
                        element('p', '', `名前: ${latest.name}`),
                        element(
                          'p',
                          '',
                          `メンバー: ${memberLabels.join('、') || 'なし'}`,
                        ),
                        element(
                          'ul',
                          '',
                          ...collectionLabels.map((text) =>
                            element('li', '', text),
                          ),
                        ),
                        element(
                          'p',
                          '',
                          '上の入力欄は下書きのままです。以下を確認すると、この最新状態に対して下書き全体を保存できます。',
                        ),
                        button('最新状態を確認して下書きを保持', () => {
                          reviewedRevision = latest.revision
                          comparison.replaceChildren(
                            noticeNode({
                              title: '最新状態を確認しました',
                              message:
                                '下書きは変更していません。変更内容を確認し、「変更を保存」で保存してください。',
                              tone: 'neutral',
                            }),
                          )
                        }),
                      ),
                    ),
                  )
                })
                .catch((error: unknown) => {
                  if (
                    current(capturedEpoch, orgId) &&
                    activeDialog === intendedDialog
                  )
                    comparison.replaceChildren(noticeNode(formatUiError(error)))
                })
            },
            'quiet compact',
          )
        : null
      showDialog(
        group ? 'グループのメンバーとアクセス' : 'グループを作成',
        element(
          'div',
          '',
          name.root,
          element('h3', 'grant-title', 'グループのメンバー'),
          membership,
          element('h3', 'grant-title', 'グループに割り当てるコレクション'),
          grants.root,
          compareLatest,
          comparison,
          element(
            'p',
            'note',
            '直接の割当はそのまま保持されます。グループからのアクセスは、メンバー自身の参加状態とセキュリティ条件にも従います。',
          ),
        ),
        !canEditGroup ? '閉じる' : group ? '変更を保存' : '作成する',
        async () => {
          if (!canEditGroup) {
            closeDialog()
            return
          }
          const groupName = name.input.value.trim()
          if (!groupName) throw new AdminError('validation', 'required_name')
          if (!current(capturedEpoch, orgId)) return
          const input = {
            name: groupName,
            memberIds: [...selected],
            collections: grants.value(),
            ...(reviewedRevision ? { revision: reviewedRevision } : {}),
          }
          await mutate(
            group ? 'グループを更新しました' : 'グループを作成しました',
            () =>
              group
                ? client.updateGroup(orgId, group.id, input)
                : client.createGroup(orgId, input),
          )
        },
      )
    } catch (error) {
      if (
        current(capturedEpoch, orgId) &&
        dialogGeneration === intendedDialogGeneration
      ) {
        outcomeNotice = formatUiError(error)
        render()
      }
    }
  }
  async function deleteGroupDialog(group: GroupView): Promise<void> {
    const orgId = selectedOrganizationId
    const capturedEpoch = epoch
    if (!orgId) return
    closeDialog()
    const intendedDialogGeneration = dialogGeneration
    let detail: Awaited<ReturnType<AdminClient['getGroup']>>
    try {
      detail = await client.getGroup(orgId, group.id)
      if (!owner()) {
        const members = await client.listMembers(orgId)
        if (
          detail.memberIds.some(
            (id) => members.find((member) => member.id === id)?.type !== 2,
          )
        )
          throw new AdminError('authorization', 'organization_not_found')
      }
    } catch (error) {
      if (
        current(capturedEpoch, orgId) &&
        dialogGeneration === intendedDialogGeneration
      ) {
        outcomeNotice = formatUiError(error)
        render()
      }
      return
    }
    if (
      !current(capturedEpoch, orgId) ||
      dialogGeneration !== intendedDialogGeneration
    )
      return
    showDialog(
      'グループを削除',
      element(
        'div',
        '',
        element('strong', '', detail.name),
        element(
          'p',
          'note',
          `確認時点: メンバー ${detail.memberIds.length}名、コレクションへの割当 ${detail.collections.length}件。`,
        ),
        element(
          'p',
          'dialog-note',
          'このグループによるコレクションへのアクセスを取り除きます。メンバーと直接の割当は削除しません。',
        ),
      ),
      'グループを削除',
      async () =>
        mutate('グループを削除しました', () =>
          client.removeGroup(orgId, group.id),
        ),
      true,
    )
  }

  function securityView(): HTMLElement {
    const result = element(
      'div',
      '',
      heading(
        'セキュリティ',
        '組織のアクセスに必要な認証条件と、現在のセッションを確認します。',
      ),
    )
    const assurance = element(
      'div',
      'panel',
      element('div', 'panel-header', element('h2', '', '現在のセッション')),
      element(
        'div',
        'panel-body',
        element(
          'dl',
          'detail-list',
          element('dt', '', '認証コードの確認'),
          element(
            'dd',
            '',
            session.mfaVerified
              ? 'このセッションで確認済み'
              : 'このセッションでは未確認',
          ),
        ),
        element(
          'p',
          'note',
          '認証アプリの登録と、このセッションの本人確認は別の状態です。必要な組織では、現在のセッションでも認証コードを確認します。',
        ),
        !session.mfaVerified
          ? button('認証コードで本人確認', () => stepUpDialog(), 'compact')
          : null,
      ),
    )
    result.append(assurance, emailVerificationPanel(), accountSecurityPanel())
    if (!snapshot.policy) return result
    const action = button(
      snapshot.policy.required ? '必須設定を解除' : '認証アプリを必須にする',
      () => policyDialog(!snapshot.policy!.required),
      snapshot.policy.required ? '' : 'primary',
    )
    action.disabled = !owner() || !session.mfaVerified
    const reason = !owner()
      ? '変更できるのはオーナーです。'
      : !session.mfaVerified
        ? '先に現在のセッションで認証コードを確認してください。'
        : '保存時にサーバーが有効なオーナーと認証状態を確認します。'
    result.append(
      element(
        'div',
        'panel',
        element(
          'div',
          'policy-row',
          element(
            'div',
            'policy-copy',
            element('h2', '', '認証アプリによる本人確認を必須にする'),
            element(
              'p',
              'page-description',
              'この組織の共有データへのアクセスに、認証アプリと現在のセッションでの本人確認を求めます。条件を満たさないメンバーは、登録と認証を完了するまで共有データを利用できません。',
            ),
          ),
          element(
            'div',
            'policy-action',
            element(
              'span',
              `status ${snapshot.policy.required ? '' : 'revoked'}`,
              snapshot.policy.required ? '必須' : '必須設定なし',
            ),
            action,
          ),
        ),
        element(
          'div',
          'policy-coverage',
          element('p', 'note', reason),
          element(
            'p',
            'note',
            'この設定は組織へのアクセス条件です。保管したアイテムの認証コード機能とは別です。',
          ),
        ),
      ),
    )
    return result
  }
  function signOut(): void {
    const action = client.logout()
    const capturedEpoch = epoch
    void action.catch((error: unknown) => {
      if (disposed || epoch !== capturedEpoch || session.phase !== 'signedOut')
        return
      const failure = formatUiError(error)
      outcomeNotice = {
        ...failure,
        title: 'このブラウザからサインアウトしました',
        message: failure.reference
          ? 'サーバーのセッション取消を確認できませんでした。参照番号を添えて管理者へお知らせください。'
          : 'サーバーのセッション取消を確認できませんでした。管理者へお知らせください。',
        tone: 'warning',
      }
      render()
    })
  }
  function accountSecurityPanel(): HTMLElement {
    const registered = session.totpEnabled === true
    return element(
      'div',
      'panel',
      element(
        'div',
        'panel-header',
        element('h2', '', 'アカウントの認証アプリ'),
        element(
          'span',
          `status ${registered ? '' : 'revoked'}`,
          session.totpEnabled === undefined
            ? '状態を確認中'
            : registered
              ? '登録済み'
              : '未登録',
        ),
      ),
      element(
        'div',
        'panel-body',
        element(
          'p',
          'note',
          '認証アプリの登録と、現在のセッションの本人確認をここから行えます。組織が表示されない場合でも利用できます。',
        ),
        element(
          'div',
          'inline-actions',
          registered
            ? button('認証アプリを変更', () => totpSetupDialog(true))
            : button(
                '認証アプリを登録',
                () => totpSetupDialog(false),
                'primary',
              ),
          !session.mfaVerified
            ? button('認証コードで本人確認', () => stepUpDialog())
            : null,
        ),
        element(
          'p',
          'note',
          '認証アプリを利用できない場合は、会社が定めた復旧窓口へ連絡してください。本人確認を省略して解除する機能は提供していません。',
        ),
      ),
    )
  }
  function accountSecurityDialog(): void {
    showDialog(
      'アカウントのセキュリティ',
      element('div', '', emailVerificationPanel(), accountSecurityPanel()),
      '閉じる',
      async () => {
        closeDialog()
      },
    )
  }
  function emailVerificationPanel(): HTMLElement {
    const action = button(
      'ブラウザでメールを確認',
      () => emailVerificationDialog(),
      session.emailVerified === false ? 'primary' : '',
    )
    action.disabled = !session.email
    return element(
      'div',
      'panel',
      element(
        'div',
        'panel-header',
        element('h2', '', 'メールアドレスの確認'),
        element(
          'span',
          `status ${session.emailVerified === true ? '' : 'revoked'}`,
          session.emailVerified === undefined
            ? '状態を確認できません'
            : session.emailVerified
              ? '確認済み'
              : '未確認',
        ),
      ),
      element(
        'div',
        'panel-body',
        element(
          'dl',
          'detail-list',
          element('dt', '', 'アカウントのメール'),
          element('dd', '', session.email ?? '状態を確認できません'),
        ),
        element(
          'p',
          'note',
          'サインイン中のメールアドレスの所有を確認します。ブラウザとメールサービスに依存する実験的な機能です。',
        ),
        element('div', 'inline-actions', action),
      ),
    )
  }
  function emailVerificationDialog(): void {
    const capturedEpoch = epoch
    const orgId = selectedOrganizationId
    const accountEmail = session.email
    if (!accountEmail || session.phase !== 'unlocked') return
    const email = field(
      'email-verification-email',
      '確認するメールアドレス',
      'email',
      accountEmail,
    )
    email.input.name = 'email'
    email.input.autocomplete = 'email'
    email.input.required = true
    email.input.disabled = true
    const proof = element('input')
    proof.type = 'hidden'
    proof.name = 'token'
    proof.setAttribute('autocomplete', 'email-verification-token')
    const stateArea = element('div', 'email-verification-state')
    stateArea.setAttribute('role', 'status')
    let attempt: EmailVerificationAttempt | null = null
    let preparing = false
    let sending = false
    let revision = 0
    let dialog: HTMLDialogElement | null = null
    let form: HTMLFormElement | null = null
    const owns = (): boolean =>
      current(capturedEpoch, orgId) &&
      session.email === accountEmail &&
      activeDialog === dialog &&
      Boolean(dialog?.isConnected && form?.isConnected)
    const retire = (): void => {
      attempt?.dispose()
      attempt = null
      proof.value = ''
      proof.removeAttribute('nonce')
    }
    const prepareButton = button('新しい確認を準備', () => {
      void prepare()
    })
    const content = element(
      'div',
      '',
      element(
        'p',
        'dialog-note',
        'このアカウントのメールアドレスを選択または入力し、ブラウザの案内に従ってください。同じブラウザでメールサービスへのサインインが必要です。',
      ),
      email.root,
      proof,
      stateArea,
      element('div', 'inline-actions', prepareButton),
      element(
        'p',
        'note',
        '確認情報を取得できない場合、この画面には通常の確認メールを受け取って完了する経路がありません。メール確認の利用準備については管理者にご確認ください。',
      ),
    )
    showDialog(
      'ブラウザでメールを確認',
      content,
      '確認結果を送信',
      async (_form, errorArea) => {
        if (!owns() || !attempt || preparing || sending) return
        const submittedAttempt = attempt
        sending = true
        prepareButton.disabled = true
        stateArea.replaceChildren(
          element('p', 'note', '確認結果を送信しています'),
        )
        const result = await runEmailVerificationSubmission({
          submit: () => submittedAttempt.submit(),
          dispose: () => {
            submittedAttempt.dispose()
            if (attempt === submittedAttempt) attempt = null
          },
          isCurrent: owns,
          currentVerification: () => client.getSession().emailVerified,
          readback: async () => {
            await client.sync()
            return client.getSession().emailVerified
          },
        })
        sending = false
        if (!owns() || result.kind === 'stale') return
        prepareButton.disabled = false
        if (result.kind === 'verified') {
          closeDialog()
          outcomeNotice = {
            title: 'メールアドレスの所有を確認しました',
            message: '最新のアカウントの確認状態を取得しました。',
            tone: 'success',
          }
          render()
          return
        }
        if (result.kind === 'proofUnavailable') {
          stateArea.replaceChildren(
            noticeNode({
              title: 'ブラウザから確認情報を取得できませんでした',
              message:
                'ブラウザとメールサービスの対応、サインイン状態、許可と確認の完了をご確認ください。取得できなかった原因はこの画面から判別できません。「新しい確認を準備」からやり直せます。',
              tone: 'warning',
            }),
          )
          return
        }
        if (result.kind === 'rejected') {
          const failure = formatUiError(result.error)
          errorArea.replaceChildren(
            noticeNode({
              ...failure,
              title: '確認情報を利用できませんでした',
              message:
                '新しい確認を準備して、サインイン中のメールアドレスでお試しください。',
            }),
          )
          stateArea.replaceChildren()
          return
        }
        closeDialog()
        outcomeNotice = {
          ...formatUiError(result.error),
          title: '確認結果を確定できません',
          message:
            result.canonicalVerified === undefined
              ? '確認操作が保存されている可能性があります。最新の状態も取得できませんでした。一度サインアウトしてサインインし直してください。'
              : `確認操作が保存されている可能性があります。現在のアカウントのメール確認状態は「${result.canonicalVerified ? '確認済み' : '未確認'}」です。操作は再送していません。`,
          tone: 'warning',
        }
        render()
      },
      false,
      () => {
        revision++
        retire()
        email.input.value = ''
      },
      () => owns() && attempt !== null && !preparing && !sending,
    )
    dialog = activeDialog
    form = dialog?.querySelector('form') ?? null
    if (!form) {
      closeDialog()
      return
    }
    form.dataset.emailVerification = 'true'
    email.input.addEventListener('input', () => {
      proof.value = ''
    })
    email.input.addEventListener('change', () => {
      proof.value = ''
    })
    async function prepare(): Promise<void> {
      if (!owns() || !form || preparing || sending) return
      retire()
      const intendedRevision = ++revision
      preparing = true
      prepareButton.disabled = true
      email.input.disabled = true
      const submit = form.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      )
      if (submit) submit.disabled = true
      form.querySelector('.dialog-errors')?.replaceChildren()
      stateArea.replaceChildren(element('p', 'note', '確認の準備をしています'))
      try {
        const prepared = await client.prepareEmailVerification({
          form,
          emailInput: email.input,
          proofInput: proof,
        })
        if (!owns() || revision !== intendedRevision) {
          prepared.dispose()
          return
        }
        attempt = prepared
        email.input.disabled = false
        if (submit) submit.disabled = false
        stateArea.replaceChildren(
          element(
            'p',
            'note',
            'メールアドレスを選択または入力し、ブラウザの確認が終わってから送信してください。',
          ),
        )
        email.input.focus()
      } catch (error) {
        if (owns() && revision === intendedRevision)
          stateArea.replaceChildren(noticeNode(formatUiError(error)))
      } finally {
        if (owns() && revision === intendedRevision) {
          preparing = false
          prepareButton.disabled = false
        }
      }
    }
    void prepare()
  }
  async function finishMfaSubmission(
    result: MutationOutcome<ReturnType<AdminClient['getSession']>>,
    title: string,
    message: string,
    expected: 'enrollment' | 'assurance',
  ): Promise<void> {
    if (result.kind === 'stale') return
    if (result.kind === 'rejected') throw result.error
    const confirmed =
      result.kind === 'confirmed' &&
      (expected === 'enrollment'
        ? result.data.totpEnabled === true
        : result.data.mfaVerified === true)
    const failure =
      result.kind === 'confirmed'
        ? new AdminError('unavailable', 'mfa_readback_unverified')
        : result.error
    const nextNotice: UiNotice = confirmed
      ? { title, message, tone: 'success' }
      : {
          ...formatUiError(failure),
          title: '認証操作の結果を確定できません',
          message: result.data
            ? '認証操作が保存されている可能性があります。最新の認証状態を取得しました。アカウントの表示を確認してから作業を続けてください。'
            : '認証操作が保存されている可能性があります。最新の認証状態を取得できませんでした。一度サインアウトしてサインインし直してください。',
          tone: 'warning',
        }
    const newlyAvailable = session.organizations?.[0]
    if (!selectedOrganizationId && newlyAvailable && !activeDialog)
      selectOrganization(newlyAvailable.id)
    else {
      const capturedEpoch = epoch
      const orgId = selectedOrganizationId
      await loadView()
      if (!current(capturedEpoch, orgId)) return
    }
    outcomeNotice = nextNotice
    render()
  }
  function totpSetupDialog(change: boolean): void {
    const capturedEpoch = epoch
    const orgId = selectedOrganizationId
    let setup: TotpSetupView | null = null
    const currentCode = field(
      'totp-current-code',
      '現在の認証アプリの6桁コード',
    )
    const verifyCode = field('totp-setup-code', '新しい認証アプリの6桁コード')
    for (const input of [currentCode.input, verifyCode.input]) {
      input.inputMode = 'numeric'
      input.autocomplete = 'one-time-code'
      input.pattern = '[0-9]{6}'
      input.maxLength = 6
    }
    currentCode.input.required = change
    currentCode.root.hidden = !change
    verifyCode.root.hidden = true
    const setupArea = element('div')
    const setupSecret = element('output', 'setup-secret')
    const applicationLink = element('a', 'button', '認証アプリで開く')
    const content = element(
      'div',
      '',
      element(
        'p',
        'dialog-note',
        change
          ? '現在の認証コードを確認してから、新しい認証アプリを登録します。新しいアプリの確認が終わるまで、現在の設定は維持されます。'
          : 'このアカウントの認証アプリを登録します。最近のパスワード認証が必要です。',
      ),
      currentCode.root,
      setupArea,
      verifyCode.root,
    )
    showDialog(
      change ? '認証アプリを変更' : '認証アプリを登録',
      content,
      'セットアップを開始',
      async (form) => {
        if (!current(capturedEpoch, orgId)) return
        if (!setup) {
          const currentValue = currentCode.input.value
          currentCode.input.value = ''
          const next = change
            ? await client.startTotpChange(currentValue)
            : await client.startTotpSetup()
          if (
            !current(capturedEpoch, orgId) ||
            !form.isConnected ||
            !activeDialog?.contains(form)
          )
            return
          setup = next
          setupSecret.textContent = next.secret
          applicationLink.href = next.uri
          setupArea.replaceChildren(
            element('h3', 'grant-title', '認証アプリに登録'),
            element(
              'p',
              'note',
              '認証アプリで開くか、アプリの手動入力に以下のセットアップキーを入力してください。この情報は他人に共有しないでください。',
            ),
            setupSecret,
            element(
              'div',
              'inline-actions',
              applicationLink,
              button('セットアップキーをコピー', () => {
                if (!setup) return
                if (!navigator.clipboard) {
                  setupArea.append(
                    element(
                      'p',
                      'field-error',
                      'このブラウザではコピーできません。認証アプリに手動で入力してください。',
                    ),
                  )
                  return
                }
                void navigator.clipboard.writeText(setup.secret).catch(() => {
                  if (setup && setupArea.isConnected)
                    setupArea.append(
                      element(
                        'p',
                        'field-error',
                        'コピーできませんでした。認証アプリに手動で入力してください。',
                      ),
                    )
                })
              }),
            ),
          )
          currentCode.root.hidden = true
          currentCode.input.required = false
          verifyCode.root.hidden = false
          verifyCode.input.required = true
          const submit = form.querySelector<HTMLButtonElement>(
            'button[type="submit"]',
          )
          if (submit) submit.textContent = '認証アプリを確認して保存'
          verifyCode.input.focus()
          return
        }
        const code = verifyCode.input.value
        verifyCode.input.value = ''
        const result = await runMfaVerification({
          operation: () =>
            change
              ? client.verifyTotpChange(code)
              : client.verifyTotpSetup(code),
          readback: async () => {
            await client.sync()
            return client.getSession()
          },
          isCurrent: () => current(capturedEpoch, orgId),
          clearEphemeral: () => {
            if (form.isConnected && activeDialog?.contains(form)) closeDialog()
          },
        })
        await finishMfaSubmission(
          result,
          change ? '認証アプリを変更しました' : '認証アプリを登録しました',
          '最新の認証状態を取得しました。組織で本人確認が求められる場合は、現在のセッションでも認証コードを確認してください。',
          'enrollment',
        )
      },
      false,
      () => {
        setup = null
        setupSecret.textContent = ''
        applicationLink.removeAttribute('href')
        setupArea.replaceChildren()
        currentCode.input.value = ''
        verifyCode.input.value = ''
      },
    )
  }
  function stepUpDialog(): void {
    const capturedEpoch = epoch
    const orgId = selectedOrganizationId
    const code = field('step-up-code', '認証アプリの6桁コード', 'text')
    code.input.inputMode = 'numeric'
    code.input.autocomplete = 'one-time-code'
    code.input.pattern = '[0-9]{6}'
    code.input.maxLength = 6
    code.input.required = true
    showDialog(
      '現在のセッションを本人確認',
      element(
        'div',
        '',
        code.root,
        element(
          'p',
          'note',
          '認証アプリが未登録の場合は、会社が案内する登録手順を先に完了してください。古いセッションでは、再サインインが必要な場合があります。',
        ),
      ),
      '本人確認する',
      async (form) => {
        const value = code.input.value
        code.input.value = ''
        const result = await runMfaVerification({
          operation: () => client.stepUpTotp(value),
          readback: async () => {
            await client.sync()
            return client.getSession()
          },
          isCurrent: () => current(capturedEpoch, orgId),
          clearEphemeral: () => {
            if (form.isConnected && activeDialog?.contains(form)) closeDialog()
          },
        })
        await finishMfaSubmission(
          result,
          '現在のセッションを確認しました',
          '最新の認証状態を取得しました。',
          'assurance',
        )
      },
    )
  }
  function policyDialog(required: boolean): void {
    const orgId = selectedOrganizationId
    if (!orgId) return
    showDialog(
      required ? '認証アプリを必須にする' : '必須設定を解除する',
      element(
        'div',
        '',
        element(
          'p',
          'dialog-note',
          required
            ? '登録または現在のセッションの本人確認を終えていないメンバーは、共有データを利用できなくなります。会社の案内と登録状況を確認してから有効にしてください。最後の有効なオーナーの保護条件はサーバーが確認します。'
            : 'この組織の共有アクセスに、認証アプリによる本人確認を一律で求める設定を解除します。各アカウントの認証アプリ登録は変更しません。',
        ),
      ),
      required ? '必須にする' : '必須設定を解除',
      async () =>
        mutate(
          required ? '認証アプリを必須にしました' : '必須設定を解除しました',
          () => client.updatePolicy(orgId, { required }),
        ),
      true,
    )
  }

  function auditView(): HTMLElement {
    const result = element(
      'div',
      '',
      heading(
        '監査',
        'メンバー、グループ、認証ポリシーの管理履歴を確認します。',
        manager()
          ? [
              button('検索範囲をCSV出力', () => {
                void exportAudit()
              }),
            ]
          : [],
      ),
    )
    if (!manager()) {
      result.append(accessNotice())
      return result
    }
    const filter = snapshot.audit
      ? loadedAuditFilter(snapshot.audit)
      : currentAuditFilter()
    const localDate = (value?: string): string => {
      const date = new Date(value ?? Date.now())
      return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 23)
    }
    const from = field(
      'audit-from',
      '開始日時',
      'datetime-local',
      auditDraft?.from ?? localDate(filter.from),
    )
    const to = field(
      'audit-to',
      '終了日時（この時刻は含まない）',
      'datetime-local',
      auditDraft?.to ?? localDate(filter.to),
    )
    from.input.step = '0.001'
    to.input.step = '0.001'
    const event = selectField(
      'audit-event',
      '操作',
      [
        ['', 'すべての記録対象操作'],
        ...(
          snapshot.audit?.availability.eventNames ?? Object.keys(eventLabels)
        ).map((name): [string, string] => [name, eventLabels[name] ?? name]),
      ],
      auditDraft?.eventName ?? filter.eventName ?? '',
    )
    const form = element('form', 'toolbar', from.root, to.root, event.root)
    const rememberDraft = (): void => {
      if (!form.isConnected) return
      auditDraft = {
        from: from.input.value,
        to: to.input.value,
        eventName: event.input.value,
      }
    }
    for (const input of [from.input, to.input, event.input]) {
      input.addEventListener('input', rememberDraft)
      input.addEventListener('change', rememberDraft)
    }
    const search = element('button', 'button primary', '検索')
    search.type = 'submit'
    form.append(search)
    form.addEventListener('submit', (submitEvent) => {
      submitEvent.preventDefault()
      rememberDraft()
      const fromDate = new Date(from.input.value)
      const toDate = new Date(to.input.value)
      const span = toDate.getTime() - fromDate.getTime()
      if (!Number.isFinite(span) || span <= 0 || span > 31 * 86400000) {
        outcomeNotice = formatUiError(
          new AdminError('validation', 'audit_window_invalid'),
        )
        render()
        return
      }
      auditFilter = {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        limit: 50,
        ...(event.input.value ? { eventName: event.input.value } : {}),
      }
      auditDraft = null
      invalidate()
      void loadView()
    })
    const panel = element('div', 'panel', form)
    const page = snapshot.audit
    if (page) {
      panel.append(
        page.data.length
          ? table(
              ['日時', '操作', '結果', '実行者', '対象'],
              page.data.map((row) =>
                element(
                  'tr',
                  '',
                  element(
                    'td',
                    '',
                    new Date(row.occurredAt).toLocaleString('ja-JP'),
                  ),
                  element(
                    'td',
                    'audit-event',
                    eventLabels[row.name] ?? row.name,
                  ),
                  element('td', '', '成功'),
                  element('td', 'audit-id', row.actorUserId ?? '記録なし'),
                  element('td', 'audit-id', row.targetId ?? '記録なし'),
                ),
              ),
            )
          : emptyState(
              '条件に一致する記録はありません',
              '記録対象は保存が確定した組織の管理操作です。記録がないことは、ほかの活動がなかった証明にはなりません。',
            ),
      )
      const next = page.continuationToken
        ? button('次の記録', () => {
            auditFilter = {
              ...loadedAuditFilter(page),
              continuationToken: page.continuationToken!,
            }
            invalidate()
            void loadView()
          })
        : null
      panel.append(
        element(
          'div',
          'table-footer',
          element(
            'small',
            'note',
            `${page.data.length}件表示 · 保存期間 ${page.availability.retentionDays}日`,
          ),
          next,
        ),
      )
      panel.append(
        element(
          'p',
          'panel-body audit-coverage',
          `対象期間: ${new Date(page.query.from).toLocaleString('ja-JP')} 〜 ${new Date(page.query.to).toLocaleString('ja-JP')}（終了時刻を含まない）`,
        ),
      )
    }
    result.append(
      panel,
      element(
        'p',
        'audit-coverage',
        '記録範囲: 保存が確定した組織の管理操作のみ。保管アイテムの操作、失敗した試行、メール到達の記録は含みません。検索は31日以内、CSVは検索結果全体が1,000件以内の場合に出力できます。日時はこの端末のタイムゾーンで入力・表示します。',
      ),
    )
    return result
  }
  async function exportAudit(): Promise<void> {
    const orgId = selectedOrganizationId
    const capturedEpoch = epoch
    if (!orgId) return
    try {
      const query = {
        ...(snapshot.audit
          ? loadedAuditFilter(snapshot.audit)
          : currentAuditFilter()),
      }
      delete query.continuationToken
      delete query.limit
      const file = await client.exportAudit(orgId, query)
      if (!current(capturedEpoch, orgId)) return
      const url = URL.createObjectURL(file)
      const download = element('a')
      download.href = url
      download.download = 'organization-administration-audit.csv'
      document.body.append(download)
      download.click()
      download.remove()
      URL.revokeObjectURL(url)
      outcomeNotice = {
        title: 'CSVを出力しました',
        message:
          '指定した検索範囲の記録対象操作を出力しました。組織のすべての活動を含む記録ではありません。',
        tone: 'success',
      }
      render()
    } catch (error) {
      if (current(capturedEpoch, orgId)) {
        outcomeNotice = formatUiError(error)
        render()
      }
    }
  }

  function createOrganizationDialog(): void {
    const capturedEpoch = epoch
    const name = field('organization-name', '組織名')
    const collection = field(
      'first-collection-name',
      '最初のコレクション名',
      'text',
      'チーム共有',
    )
    name.input.required = true
    collection.input.required = true
    showDialog(
      '組織を作成',
      element(
        'div',
        '',
        name.root,
        collection.root,
        element(
          'p',
          'note',
          'あなたが最初のオーナーになります。組織の暗号鍵はブラウザで生成し、暗号化して保存します。',
        ),
      ),
      '組織を作成',
      async (form) => {
        const organizationName = name.input.value.trim()
        const collectionValue = validateCollectionName(collection.input.value)
        if (!organizationName)
          throw new AdminError('validation', 'required_name')
        if (session.phase !== 'unlocked' || epoch !== capturedEpoch) return
        const created = await client.createOrganization({
          name: organizationName,
          collectionName: collectionValue,
        })
        if (session.phase !== 'unlocked' || epoch !== capturedEpoch) return
        await client.sync()
        if (session.phase !== 'unlocked' || epoch !== capturedEpoch) return
        if (
          !client
            .getSession()
            .organizations?.some((item) => item.id === created.id)
        )
          throw new AdminError('unavailable', 'readback_unavailable')
        if (form.isConnected && activeDialog?.contains(form))
          selectOrganization(created.id)
        outcomeNotice = {
          title: '組織を作成しました',
          message: '最新の組織情報を取得しました。',
          tone: 'success',
        }
        render()
      },
    )
  }
  async function acceptInvitation(): Promise<void> {
    const capturedEpoch = epoch
    if (mutating) return
    mutating = true
    try {
      await client.acceptPendingInvitation()
      if (session.phase !== 'unlocked' || epoch !== capturedEpoch) return
      outcomeNotice = {
        title: '招待を承諾しました',
        message:
          '管理者の確認を待っています。共有データは参加が確認された後に利用できます。',
        tone: 'success',
      }
    } catch (error) {
      if (session.phase === 'unlocked' && epoch === capturedEpoch)
        outcomeNotice = formatUiError(error)
    } finally {
      if (session.phase === 'unlocked' && epoch === capturedEpoch) {
        mutating = false
        render()
      }
    }
  }
  function renderWorkspace(): void {
    const rail = element(
      'aside',
      'rail',
      brand(),
      element('p', 'rail-caption', 'ORGANIZATION ADMIN'),
    )
    const nav = element('nav', 'navigation')
    nav.setAttribute('aria-label', '組織管理')
    const symbols: Record<View, string> = {
      overview: '◫',
      members: '◉',
      collections: '▧',
      groups: '▦',
      security: '◇',
      audit: '≡',
    }
    for (const next of Object.keys(viewLabels) as View[]) {
      const symbol = element('span', 'nav-symbol', symbols[next])
      symbol.setAttribute('aria-hidden', 'true')
      const item = button(viewLabels[next], () => selectView(next))
      item.className = 'nav-button'
      item.disabled = loading && !selectedOrganizationId
      item.prepend(symbol)
      if (view === next) item.setAttribute('aria-current', 'page')
      nav.append(item)
    }
    rail.append(
      nav,
      element(
        'div',
        'rail-footer',
        element('strong', '', 'アクセスを、必要な人へ。'),
        'HonoWarden · pre-alpha',
        element('br'),
        '検証用データでご利用ください。',
      ),
    )
    const orgSelect = element('select', 'organization-select')
    orgSelect.id = 'organization-select'
    const orgLabel = element('label', 'organization-label', '組織')
    orgLabel.htmlFor = orgSelect.id
    for (const item of session.organizations ?? []) {
      const option = element('option', '', item.name)
      option.value = item.id
      orgSelect.append(option)
    }
    if (!session.organizations?.length) {
      const option = element('option', '', '組織を選択')
      option.value = ''
      orgSelect.append(option)
      orgSelect.disabled = true
    }
    orgSelect.value = selectedOrganizationId ?? ''
    orgSelect.addEventListener('change', () =>
      selectOrganization(orgSelect.value),
    )
    const refresh = button(
      '再取得',
      () => {
        void refreshWorkspace()
      },
      'quiet compact',
    )
    refresh.disabled = loading || mutating
    const header = element(
      'header',
      'workspace-header',
      element(
        'div',
        'organization-control',
        orgLabel,
        orgSelect,
        button(
          '＋ 組織を作成',
          () => createOrganizationDialog(),
          'quiet compact',
        ),
      ),
      element(
        'div',
        'session-control',
        element('span', 'account-email', session.email ?? ''),
        refresh,
        button('ロック', () => client.lock(), 'quiet compact'),
        button(
          'アカウント',
          () => accountSecurityDialog(),
          'quiet compact',
          'アカウントのセキュリティ',
        ),
        button('サインアウト', () => signOut(), 'quiet compact'),
      ),
    )
    const main = element('main', 'main-content')
    main.id = 'main-content'
    main.tabIndex = -1
    main.setAttribute('aria-busy', String(loading || mutating))
    if (outcomeNotice) main.append(noticeNode(outcomeNotice))
    if (session.mfaRequired && !session.mfaVerified)
      main.append(
        element(
          'div',
          'notice warning',
          element(
            'div',
            'notice-copy',
            element('strong', '', 'この組織では本人確認が必要です'),
            element(
              'p',
              '',
              '現在のセッションで認証コードを確認してから作業を続けてください。',
            ),
          ),
          button('認証コードを確認', () => stepUpDialog(), 'primary'),
        ),
      )
    if (session.pendingInvitation)
      main.append(
        element(
          'div',
          'notice',
          element(
            'div',
            'notice-copy',
            element('strong', '', '組織への招待があります'),
            element(
              'p',
              '',
              'サインイン中のアカウントで招待を承諾します。参加には、その後の管理者の確認が必要です。',
            ),
          ),
          button(
            '招待を承諾する',
            () => {
              void acceptInvitation()
            },
            'primary',
          ),
        ),
      )
    for (const error of snapshot.errors) main.append(noticeNode(error))
    if (loading) {
      const pending = element(
        'div',
        'loading-state',
        '最新の状態を取得しています',
      )
      pending.setAttribute('role', 'status')
      main.append(pending)
    } else if (!selectedOrganizationId)
      main.append(
        emptyState(
          '組織のワークスペースを始める',
          '組織を作成するか、会社からの招待を承諾してください。',
          button('組織を作成', () => createOrganizationDialog(), 'primary'),
        ),
      )
    else {
      const renderers: Record<View, () => HTMLElement> = {
        overview: overviewView,
        members: membersView,
        collections: collectionsView,
        groups: groupsView,
        security: securityView,
        audit: auditView,
      }
      main.append(renderers[view]())
    }
    root.replaceChildren(
      element(
        'div',
        'workspace',
        rail,
        element('div', 'main-area', header, main),
      ),
    )
  }
  function brand(): HTMLElement {
    const mark = element('span', 'brand-mark')
    mark.setAttribute('aria-hidden', 'true')
    return element('div', 'brand', mark, element('span', '', 'HonoWarden'))
  }
  function renderAuth(): void {
    const locked = session.phase === 'locked'
    const totp = session.phase === 'totpRequired'
    const authenticating = session.phase === 'authenticating'
    const title = locked
      ? 'ロックを解除'
      : totp
        ? '認証コードを確認'
        : '組織管理にサインイン'
    const form = element('form', 'auth-card')
    form.setAttribute('aria-busy', String(authenticating))
    form.append(
      element('p', 'eyebrow', 'Your organization workspace'),
      element('h2', '', title),
      element(
        'p',
        'page-description',
        locked
          ? 'このブラウザでの作業を再開します。'
          : totp
            ? '認証アプリに表示されている6桁のコードを入力してください。'
            : '会社から案内されたアカウントでサインインしてください。',
      ),
    )
    if (outcomeNotice) form.append(noticeNode(outcomeNotice))
    if (session.phase === 'expired')
      form.append(
        noticeNode({
          title: 'セッションの期限が切れました',
          message: '再度サインインして、最新の状態から作業を続けてください。',
          tone: 'neutral',
        }),
      )
    if (session.pendingInvitation)
      form.append(
        element(
          'p',
          'auth-email',
          'サインイン後に組織への招待を承諾できます。',
        ),
      )
    const email = field(
      'login-email',
      'メールアドレス',
      'email',
      session.email ?? '',
    )
    email.input.autocomplete = 'username'
    email.input.required = true
    const secret = field(
      totp ? 'login-code' : 'login-password',
      totp ? '認証アプリの6桁コード' : 'マスターパスワード',
      totp ? 'text' : 'password',
    )
    secret.input.autocomplete = totp ? 'one-time-code' : 'current-password'
    secret.input.required = true
    if (totp) {
      secret.input.inputMode = 'numeric'
      secret.input.pattern = '[0-9]{6}'
      secret.input.maxLength = 6
    }
    if (!locked && !totp) form.append(email.root)
    else if (session.email)
      form.append(element('p', 'auth-email', session.email))
    form.append(secret.root)
    const submit = element(
      'button',
      'button primary',
      authenticating
        ? '確認しています…'
        : locked
          ? 'ロックを解除'
          : totp
            ? 'コードを確認'
            : 'サインイン',
    )
    submit.type = 'submit'
    submit.disabled = authenticating
    form.append(submit)
    if (locked || totp)
      form.append(
        button('別のアカウントでサインイン', () => signOut(), 'quiet'),
      )
    form.append(
      element(
        'p',
        'auth-bottom',
        'パスワードと暗号鍵はブラウザ内で処理します。HonoWardenは検証段階です。実際の会社の秘密を保管する前に、導入の受け入れ条件を確認してください。',
      ),
    )
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      if (submit.disabled) return
      const password = secret.input.value
      secret.input.value = ''
      const address = email.input.value
      submit.disabled = true
      outcomeNotice = null
      void (
        locked
          ? client.unlock(password)
          : totp
            ? client.verifyTotp(password)
            : client.login(address, password)
      )
        .catch((error: unknown) => {
          if (session.phase !== 'unlocked') {
            outcomeNotice = formatUiError(error)
            render()
          }
        })
        .finally(() => {
          submit.disabled = false
        })
    })
    root.replaceChildren(
      element(
        'div',
        'auth-layout',
        element(
          'aside',
          'auth-story',
          brand(),
          element(
            'div',
            'auth-story-main',
            element('p', 'eyebrow', 'A place for trusted teams'),
            element(
              'h1',
              '',
              '会社のアクセスを、',
              element('br'),
              '見渡せる形に。',
            ),
            element(
              'p',
              '',
              '必要な人へ、必要な情報を。組織とチームの権限を、一つのワークスペースで管理します。',
            ),
          ),
          element(
            'p',
            'auth-story-footer',
            'HonoWarden · Organization administration',
            element('br'),
            '組織とチームのアクセス管理',
          ),
        ),
        element('main', 'auth-form-area', form),
      ),
    )
    const main = root.querySelector('main')!
    main.id = 'main-content'
    main.tabIndex = -1
  }
  function render(): void {
    if (disposed) return
    const focused =
      document.activeElement instanceof HTMLElement &&
      root.contains(document.activeElement)
        ? document.activeElement
        : null
    const focusId = focused?.id
    const focusKey = focused?.dataset.focusKey
    if (session.phase === 'unlocked') renderWorkspace()
    else renderAuth()
    if (
      focusAuthAfterRender &&
      !['unlocked', 'authenticating'].includes(session.phase)
    ) {
      focusAuthAfterRender = false
      root
        .querySelector<HTMLInputElement>('form input:not([disabled])')
        ?.focus()
    } else if (focusMainAfterLoad && !loading && session.phase === 'unlocked') {
      focusMainAfterLoad = false
      const target =
        root.querySelector<HTMLElement>('main h1, main h2') ??
        root.querySelector<HTMLElement>('main')
      if (target) {
        target.tabIndex = -1
        target.focus()
      }
    } else if (focusId) document.getElementById(focusId)?.focus()
    else if (focusKey)
      Array.from(root.querySelectorAll<HTMLElement>('[data-focus-key]'))
        .find((item) => item.dataset.focusKey === focusKey)
        ?.focus()
  }
  const unsubscribe = client.subscribe((next) => {
    const previousPhase = session.phase
    const previousEmail = session.email
    const identityChanged = previousEmail !== next.email
    session = next
    if (previousPhase !== next.phase || identityChanged) {
      auditFilter = null
      auditDraft = null
      invalidate()
    }
    if (
      previousPhase !== next.phase &&
      ['signedOut', 'expired', 'locked', 'totpRequired'].includes(next.phase)
    )
      focusAuthAfterRender = true
    if (next.phase === 'unlocked') {
      if (previousPhase !== 'unlocked')
        setSelectedOrganization(next.organizations?.[0]?.id ?? null)
      else if (
        selectedOrganizationId &&
        !next.organizations?.some((item) => item.id === selectedOrganizationId)
      ) {
        invalidate()
        setSelectedOrganization(next.organizations?.[0]?.id ?? null)
        render()
        void loadView()
        return
      }
      if (identityChanged && !selectedOrganizationId)
        setSelectedOrganization(next.organizations?.[0]?.id ?? null)
      render()
      if (previousPhase !== 'unlocked' || identityChanged) void loadView()
    } else render()
  })
  const pageHide = (): void => client.lock()
  window.addEventListener('pagehide', pageHide)
  if (session.phase === 'unlocked')
    setSelectedOrganization(session.organizations?.[0]?.id ?? null)
  render()
  if (session.phase === 'unlocked') void loadView()
  return () => {
    disposed = true
    invalidate()
    unsubscribe()
    window.removeEventListener('pagehide', pageHide)
    client.dispose()
    root.replaceChildren()
  }
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('admin-app')
  if (root) {
    try {
      mountAdminApp(root, createAdminClient())
    } catch (error) {
      const notice = formatUiError(error)
      const recovery = element('a', 'button primary', 'サインイン画面に戻る')
      recovery.href = '/admin/'
      const main = element(
        'main',
        'main-content',
        noticeNode({
          ...notice,
          title: '管理画面を開始できません',
          message:
            '招待リンクまたはブラウザの状態を確認できませんでした。サインイン画面から再度お試しください。',
        }),
        recovery,
      )
      main.id = 'main-content'
      main.tabIndex = -1
      root.replaceChildren(main)
      recovery.focus()
    }
  }
}

const PREFIX = '/api'

import {
  DEMO_BOOK_SPECS,
  DEMO_BOOK_SPEC_UID,
  DEMO_ESTIMATE,
  DEMO_ORDER_DETAIL,
  DEMO_ORDERS,
  DEMO_TEMPLATE_DETAIL,
  DEMO_TEMPLATES,
} from './demo/demoData'

const META_KEY = 'photobook_app_meta_v1'

function isDemoMode(): boolean {
  try {
    const s = sessionStorage.getItem(META_KEY)
    if (!s) return false
    const m = JSON.parse(s) as { demoMode?: boolean }
    return Boolean(m?.demoMode)
  } catch {
    return false
  }
}

function demoGet(path: string, params?: Record<string, string>) {
  if (path === '/book-specs') {
    return { success: true, data: { bookSpecs: DEMO_BOOK_SPECS } }
  }
  if (path.startsWith('/book-specs/')) {
    const uid = decodeURIComponent(path.split('/').pop() || '')
    if (uid === DEMO_BOOK_SPEC_UID) return { success: true, data: DEMO_BOOK_SPECS[0] }
    return { success: false, message: 'not found' }
  }
  if (path === '/templates') {
    const kind = (params?.templateKind ?? '') as 'cover' | 'content'
    const list = (DEMO_TEMPLATES[kind] ?? []) as unknown[]
    return { success: true, data: { templates: list } }
  }
  if (path.startsWith('/templates/')) {
    const uid = decodeURIComponent(path.split('/').pop() || '')
    const r = DEMO_TEMPLATE_DETAIL[uid]
    if (r) return r
    return { success: false, message: 'not found' }
  }
  if (path === '/orders') {
    return { success: true, data: { orders: DEMO_ORDERS } }
  }
  if (path.startsWith('/orders/')) {
    const uid = decodeURIComponent(path.split('/').pop() || '')
    const d = DEMO_ORDER_DETAIL[uid]
    if (d) return { success: true, data: d }
    return { success: false, message: 'not found' }
  }
  if (path === '/credits') {
    return { success: true, data: { balance: 250000 } }
  }
  if (path === '/webhooks/events') {
    return { success: true, data: { events: [] } }
  }
  if (path === '/books') {
    // 데모는 finalized만 보여준다 (UI 확인용)
    const status = (params?.status ?? '').toLowerCase()
    if (status === 'draft') return { success: true, data: { books: [] } }
    return {
      success: true,
      data: {
        books: [
          {
            bookUid: 'demo-book-1',
            bookSpecUid: DEMO_BOOK_SPEC_UID,
            title: 'TEST 추억 앨범',
            status: 'finalized',
            pageCount: 30,
          },
        ],
        pagination: { total: 1 },
      },
    }
  }
  if (path.startsWith('/books/')) {
    const uid = decodeURIComponent(path.split('/').pop() || '')
    return {
      success: true,
      data: {
        bookUid: uid,
        bookSpecUid: DEMO_BOOK_SPEC_UID,
        title: 'TEST 추억 앨범',
        status: 'finalized',
        pageCount: 30,
        pageMin: 24,
      },
    }
  }
  return { success: true, data: {} }
}

function demoPost(path: string, body: unknown) {
  if (path === '/orders/estimate') {
    // OrderPage는 { items: [{ bookUid, quantity }] } 형태로 보낸다.
    let qty = 1
    try {
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        const o = body as Record<string, unknown>
        const items = o.items
        if (Array.isArray(items) && items[0] && typeof items[0] === 'object') {
          const it = items[0] as Record<string, unknown>
          const n = Number(it.quantity ?? it.qty ?? 1)
          if (Number.isFinite(n) && n > 0) qty = Math.floor(n)
        }
      }
    } catch {
      /* ignore */
    }

    const baseLine = (DEMO_ESTIMATE as any)?.data?.lines?.[0] ?? {}
    const unit = Number(baseLine.unitPrice ?? 19900) || 19900
    const lineTotal = unit * qty
    return {
      success: true,
      data: {
        paidCreditAmount: lineTotal,
        totalAmount: lineTotal,
        shippingFee: 0,
        vatAmount: 0,
        lines: [
          {
            ...baseLine,
            bookUid: baseLine.bookUid ?? 'demo-book-1',
            bookTitle: baseLine.bookTitle ?? 'TEST 추억 앨범',
            quantity: qty,
            unitPrice: unit,
            lineTotal,
            total: lineTotal,
            amount: lineTotal,
          },
        ],
      },
    }
  }
  if (path === '/orders') {
    return { success: true, data: { orderUid: 'demo-order-001' } }
  }
  if (path === '/books') {
    // 데모는 bookUid를 고정해서 sessionStorage(내지/업로드 등) 키가 흔들리지 않게 한다.
    return { success: true, data: { bookUid: 'demo-book-1' } }
  }
  return { success: true, data: {} }
}

export async function parseJson(res: Response) {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { success: false, message: text || 'Invalid JSON' }
  }
}

export function errorMessageFromApiData(
  data: Record<string, unknown>,
  fallback: string,
): string {
  const parts: string[] = []
  const m = data.message
  if (typeof m === 'string' && m.trim()) parts.push(m.trim())
  const errors = data.errors
  if (Array.isArray(errors)) {
    for (const x of errors) {
      if (typeof x === 'string' && x.trim()) parts.push(x.trim())
    }
  }
  return parts.length ? parts.join(' — ') : fallback
}

export async function apiGet(path: string, params?: Record<string, string>) {
  if (isDemoMode()) {
    return demoGet(path, params)
  }
  const q = params
    ? '?' + new URLSearchParams(params).toString()
    : ''
  const res = await fetch(`${PREFIX}${path}${q}`)
  const data = await parseJson(res)
  if (!res.ok) {
    throw new Error(
      errorMessageFromApiData(data as Record<string, unknown>, `${res.status} ${res.statusText}`),
    )
  }
  return data
}

export async function apiDelete(path: string) {
  if (isDemoMode()) {
    return { success: true }
  }
  const res = await fetch(`${PREFIX}${path}`, { method: 'DELETE' })
  const data = await parseJson(res)
  if (!res.ok) {
    throw new Error(
      errorMessageFromApiData(data as Record<string, unknown>, res.statusText),
    )
  }
  return data
}

export async function apiPostJson(path: string, body: unknown) {
  if (isDemoMode()) {
    return demoPost(path, body)
  }
  const res = await fetch(`${PREFIX}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await parseJson(res)
  if (!res.ok) {
    throw new Error(
      errorMessageFromApiData(data as Record<string, unknown>, res.statusText),
    )
  }
  return data
}

export async function apiPatchJson(path: string, body: unknown) {
  if (isDemoMode()) {
    return { success: true }
  }
  const res = await fetch(`${PREFIX}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await parseJson(res)
  if (!res.ok) {
    throw new Error(
      errorMessageFromApiData(data as Record<string, unknown>, res.statusText),
    )
  }
  return data
}

/** JSON 본문 없이 POST (예: 최종화) */
export async function apiPostEmpty(path: string) {
  if (isDemoMode()) {
    return { success: true, data: { ok: true } }
  }
  const res = await fetch(`${PREFIX}${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  })
  const data = await parseJson(res)
  if (!res.ok) {
    throw new Error(
      errorMessageFromApiData(data as Record<string, unknown>, `${res.status} ${res.statusText}`),
    )
  }
  return data
}

/** 컬러화 등 장시간 요청 */
export async function apiPostForm(path: string, form: FormData, timeoutMs = 600_000) {
  // 데모 모드라도 로컬 컬러화는 실제 백엔드를 호출해 "진짜"로 처리한다.
  if (isDemoMode() && path !== '/photos/colorize') {
    return { success: true, data: { imageBase64: '', engine: 'stub', meanAbsDiff: 12 } }
  }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${PREFIX}${path}`, {
      method: 'POST',
      body: form,
      signal: ctrl.signal,
    })
    const data = await parseJson(res)
    if (!res.ok) {
      throw new Error(
        errorMessageFromApiData(data as Record<string, unknown>, res.statusText),
      )
    }
    return data
  } finally {
    clearTimeout(t)
  }
}

export function unwrapArray(raw: unknown, keys: string[]): unknown[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    for (const k of keys) {
      const v = o[k]
      if (Array.isArray(v)) return v
    }
  }
  return []
}

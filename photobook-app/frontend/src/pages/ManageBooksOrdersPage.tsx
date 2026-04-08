import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiDelete, apiGet, unwrapArray } from '../api'
import { useApp } from '../context/AppContext'

type Row = Record<string, unknown>

function isRecord(v: unknown): v is Row {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function unwrapBooksListResponse(res: unknown): { books: Row[]; total: number | null } {
  const root = isRecord(res) ? res : null
  const data = root && isRecord(root.data) ? root.data : null
  if (!data) return { books: [], total: null }
  const books = unwrapArray(data, ['books', 'items', 'list']) as Row[]
  const pag = isRecord(data.pagination) ? data.pagination : null
  const t = pag?.total
  const total = typeof t === 'number' && Number.isFinite(t) ? t : null
  return { books, total }
}

function unwrapSingleBook(res: unknown): Row | null {
  if (!isRecord(res)) return null
  if (isRecord(res.data)) return res.data as Row
  return null
}

function bookRowUid(b: Row): string {
  return String(b.bookUid ?? b.uid ?? b.id ?? '').trim()
}

function isFinalizedBook(status: unknown): boolean {
  if (status === 2 || status === '2') return true
  const s = String(status ?? '').trim().toLowerCase()
  return s === 'finalized' || s === '2'
}

function bookSpecFromListRow(b: Row): string {
  const u = b.bookSpecUid ?? b.bookSpecUID
  if (typeof u === 'string' && u.trim()) return u.trim()
  const nested = b.bookSpec
  if (isRecord(nested)) {
    const nu = nested.uid ?? nested.bookSpecUid
    if (typeof nu === 'string' && nu.trim()) return nu.trim()
  }
  return ''
}

/** 사용자에게 보이는 주문 상태 (한글) */
function orderStatusLabel(code: unknown, display?: unknown): string {
  const d = typeof display === 'string' && display.trim() ? display.trim() : ''
  if (d) return d
  const c = String(code ?? '').trim()
  const map: Record<string, string> = {
    '20': '결제 완료',
    '25': 'PDF 준비됨',
    '30': '제작 확정',
    '40': '인쇄 중',
    '50': '인쇄 완료',
    '60': '발송됨',
    '70': '배송 완료',
    '80': '취소됨',
    '81': '취소됨',
  }
  return map[c] || (c ? `처리 중 (${c})` : '—')
}

function orderRowUid(o: Row): string {
  return String(o.orderUid ?? o.uid ?? o.id ?? '').trim()
}

function unwrapOrderPayload(res: unknown): Row | null {
  if (!isRecord(res)) return null
  if (isRecord(res.data)) return res.data as Row
  return res
}

function pickOrderItems(order: Row | null): Row[] {
  if (!order) return []
  return unwrapArray(order, ['items', 'orderItems', 'lines', 'orderLines']) as Row[]
}

function pickQtyFromItem(item: Row): string | null {
  const v =
    item.quantity ??
    item.qty ??
    item.count ??
    item.copies ??
    item.amount ??
    item.quantityOrdered ??
    item.orderedQuantity
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'string' && v.trim()) return v.trim()
  return null
}

function pickBookUidFromItem(item: Row): string | null {
  const v = item.bookUid ?? item.book_uid ?? item.bookUID ?? item.bookId ?? item.book_id
  if (typeof v === 'string' && v.trim()) return v.trim()
  return null
}

function pickBookTitleFromItem(item: Row): string | null {
  const v =
    item.bookTitle ??
    item.book_title ??
    item.title ??
    item.bookName ??
    item.book_name ??
    item.name ??
    item.productName ??
    item.product_name
  if (typeof v === 'string' && v.trim()) return v.trim()
  return null
}

export default function ManageBooksOrdersPage() {
  const nav = useNavigate()
  const {
    bookUid,
    setBookSpecUid,
    setBookTitle,
    setCoverTemplateUid,
    setContentTemplateUid,
    setBookUid,
    persistMeta,
  } = useApp()

  const bookUidRef = useRef(bookUid)
  bookUidRef.current = bookUid

  const [bookList, setBookList] = useState<Row[]>([])
  const [bookListTotal, setBookListTotal] = useState<number | null>(null)
  const [bookListLoading, setBookListLoading] = useState(false)
  const [bookListErr, setBookListErr] = useState<string | null>(null)
  const [listRefreshTick, setListRefreshTick] = useState(0)
  const [orderingUid, setOrderingUid] = useState<string | null>(null)

  const [ordersSectionLoading, setOrdersSectionLoading] = useState(false)
  const [ordersErr, setOrdersErr] = useState<string | null>(null)
  const [ordersRows, setOrdersRows] = useState<Row[]>([])
  const [ordersRefreshTick, setOrdersRefreshTick] = useState(0)
  const [orderItemSummaryByUid, setOrderItemSummaryByUid] = useState<
    Record<string, { bookTitle: string | null; quantity: string | null }>
  >({})
  const [webhookErr, setWebhookErr] = useState<string | null>(null)
  const [webhookEvents, setWebhookEvents] = useState<Row[]>([])

  useEffect(() => {
    let cancel = false
    ;(async () => {
      setBookListLoading(true)
      setBookListErr(null)
      try {
        const draftUids: string[] = []
        let dOffset = 0
        const dLimit = 100
        for (;;) {
          const dr = await apiGet('/books', {
            status: 'draft',
            limit: String(dLimit),
            offset: String(dOffset),
          })
          const parsed = unwrapBooksListResponse(dr)
          if (cancel) return
          for (const b of parsed.books) {
            const u = bookRowUid(b)
            if (u) draftUids.push(u)
          }
          if (parsed.books.length < dLimit) break
          dOffset += dLimit
          if (
            parsed.total != null &&
            typeof parsed.total === 'number' &&
            dOffset >= parsed.total
          )
            break
          if (parsed.books.length === 0) break
        }

        const purgeErrors: string[] = []
        for (const uid of draftUids) {
          if (cancel) return
          if (uid === bookUidRef.current) continue
          try {
            await apiDelete(`/books/${encodeURIComponent(uid)}`)
          } catch (e) {
            purgeErrors.push(`${uid}: ${e instanceof Error ? e.message : String(e)}`)
          }
        }

        const fr = await apiGet('/books', {
          status: 'finalized',
          limit: '50',
          offset: '0',
        })
        if (cancel) return
        const { books, total } = unwrapBooksListResponse(fr)
        setBookList(books)
        setBookListTotal(total)
        if (purgeErrors.length > 0) {
          setBookListErr(
            `정리 중 일부를 건너뛰었습니다. 새로고침을 다시 시도해 보세요.`,
          )
        }
      } catch (e) {
        if (!cancel) {
          setBookListErr(e instanceof Error ? e.message : String(e))
          setBookList([])
          setBookListTotal(null)
        }
      } finally {
        if (!cancel) setBookListLoading(false)
      }
    })()
    return () => {
      cancel = true
    }
  }, [listRefreshTick])

  useEffect(() => {
    let cancel = false
    setOrdersSectionLoading(true)
    setOrdersErr(null)
    setWebhookErr(null)
    void (async () => {
      const [oRes, wRes] = await Promise.allSettled([
        apiGet('/orders', { limit: '40', offset: '0' }),
        apiGet('/webhooks/events', { limit: '50' }),
      ])
      if (cancel) return
      if (oRes.status === 'fulfilled') {
        const r = oRes.value
        const root = isRecord(r) ? r : null
        const data = root && isRecord(root.data) ? root.data : root
        const list = data
          ? (unwrapArray(data, ['orders', 'items', 'list']) as Row[])
          : []
        setOrdersRows(list)

        // 목록 응답에 quantity가 없는 환경이 있어, 상세 조회로 수량을 채운다.
        setOrderItemSummaryByUid({})
        const ouids = list.map(orderRowUid).filter(Boolean)

        const concurrency = 6
        let i = 0
        const next = async (): Promise<void> => {
          for (;;) {
            const idx = i++
            if (idx >= ouids.length) return
            const ouid = ouids[idx]
            try {
              const dr = await apiGet(`/orders/${encodeURIComponent(ouid)}`)
              if (cancel) return
              const d = unwrapOrderPayload(dr)
              const items = pickOrderItems(d)
              const first = items.length > 0 && isRecord(items[0]) ? (items[0] as Row) : null
              const bookTitle =
                (first && pickBookTitleFromItem(first)) ||
                (first && pickBookUidFromItem(first)) ||
                null
              const quantity = first ? pickQtyFromItem(first) : null
              setOrderItemSummaryByUid((m) => ({
                ...m,
                [ouid]: { bookTitle, quantity },
              }))
            } catch {
              // 상세 조회 실패는 조용히 무시(목록 표시로 폴백)
            }
          }
        }

        await Promise.allSettled(
          Array.from({ length: Math.min(concurrency, ouids.length) }, () => next()),
        )
      } else {
        const reason = oRes.reason
        setOrdersErr(reason instanceof Error ? reason.message : String(reason))
        setOrdersRows([])
        setOrderItemSummaryByUid({})
      }
      if (wRes.status === 'fulfilled') {
        const r = wRes.value
        const root = isRecord(r) ? r : null
        const data = root && isRecord(root.data) ? root.data : null
        const ev = data && unwrapArray(data, ['events'])
        setWebhookEvents((Array.isArray(ev) ? ev : []) as Row[])
      } else {
        const reason = wRes.reason
        setWebhookErr(reason instanceof Error ? reason.message : String(reason))
        setWebhookEvents([])
      }
      setOrdersSectionLoading(false)
    })()
    return () => {
      cancel = true
    }
  }, [ordersRefreshTick])

  const goOrderOnly = async (uid: string, listRow: Row) => {
    const id = uid.trim()
    if (!id) return
    setOrderingUid(id)
    setBookListErr(null)
    try {
      let spec = bookSpecFromListRow(listRow)
      let title = typeof listRow.title === 'string' ? listRow.title : ''
      let st = String(listRow.status ?? '').toLowerCase()
      try {
        const r = await apiGet(`/books/${encodeURIComponent(id)}`)
        const d = unwrapSingleBook(r)
        if (d) {
          const ds = String(d.bookSpecUid ?? d.bookSpecUID ?? '').trim()
          if (ds) spec = ds
          if (typeof d.title === 'string' && d.title) title = d.title
          const dst = String(d.status ?? '').toLowerCase()
          if (dst) st = dst
        }
      } catch {
        /* ignore */
      }

      if (isFinalizedBook(st)) {
        if (spec) setBookSpecUid(spec)
        else setBookSpecUid(null)
        setBookTitle(title)
        setBookUid(id)
        setCoverTemplateUid('')
        setContentTemplateUid('')
        persistMeta()
        nav('/order')
        return
      }

      setBookListErr(
        '주문은 완성된 앨범부터 진행할 수 있습니다. 내지 편집에서 마무리한 뒤 다시 시도해 주세요.',
      )
    } catch (e) {
      setBookListErr(e instanceof Error ? e.message : String(e))
    } finally {
      setOrderingUid(null)
    }
  }

  const refreshAll = () => {
    setListRefreshTick((n) => n + 1)
    setOrdersRefreshTick((n) => n + 1)
  }

  return (
    <div className="page">
      <h1>책·주문 관리</h1>
      <p className="muted">
        완성된 앨범에서 주문을 이어가거나 주문·알림 내역을 확인합니다.
      </p>

      {bookListErr && <div className="banner error small">{bookListErr}</div>}

      <section className="card">
        <h2>내 앨범</h2>
        <p className="muted small">
          편집을 마친 앨범만 여기 표시됩니다. 새로 만들기는 설정에서 진행하세요.
        </p>
        <div className="book-list-toolbar">
          <button
            type="button"
            className="btn"
            disabled={bookListLoading}
            onClick={() => setListRefreshTick((n) => n + 1)}
          >
            {bookListLoading ? '불러오는 중…' : '목록 새로고침'}
          </button>
          <Link to="/book/setup" className="btn" style={{ textDecoration: 'none' }}>
            설정으로
          </Link>
        </div>
        {bookListLoading && !bookListErr ? (
          <p className="muted small" style={{ marginTop: '0.75rem' }}>
            불러오는 중…
          </p>
        ) : null}
        {!bookListLoading && !bookListErr && bookList.length === 0 ? (
          <p className="muted small" style={{ marginTop: '0.75rem' }}>
            표시할 앨범이 없습니다.
          </p>
        ) : null}
        {bookList.length > 0 ? (
          <>
            <p className="muted small book-list-meta">
              {bookListTotal != null && bookListTotal > bookList.length
                ? `전체 ${bookListTotal}권 중 ${bookList.length}권`
                : bookListTotal != null
                  ? `전체 ${bookListTotal}권`
                  : `${bookList.length}권`}
            </p>
            <div className="book-list-scroll">
              <table className="book-list-table">
                <thead>
                  <tr>
                    <th>제목</th>
                    <th>상태</th>
                    <th>페이지</th>
                    <th>번호</th>
                    <th>작업</th>
                  </tr>
                </thead>
                <tbody>
                  {bookList.map((b) => {
                    const uid = bookRowUid(b)
                    if (!uid) return null
                    const title = String(b.title ?? '(제목 없음)')
                    const status = String(b.status ?? '—')
                    const pages = b.pageCount ?? b.pages ?? '—'
                    const busyOrder = orderingUid === uid
                    const orderBusy = orderingUid !== null
                    return (
                      <tr key={uid}>
                        <td className="book-list-cell-title">{title}</td>
                        <td>{status}</td>
                        <td>{String(pages)}</td>
                        <td>
                          <code className="book-list-uid">{uid}</code>
                        </td>
                        <td className="book-list-cell-action">
                          <div className="book-list-actions">
                            <button
                              type="button"
                              className="btn book-list-action-btn primary"
                              disabled={orderBusy}
                              onClick={() => void goOrderOnly(uid, b)}
                            >
                              {busyOrder ? '…' : '주문하기'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>

      <section className="card">
        <h2>주문·알림</h2>
        <p className="muted small">주문 목록과 시스템 알림을 함께 불러옵니다.</p>
        <div className="book-list-toolbar" style={{ marginTop: '0.5rem' }}>
          <button
            type="button"
            className="btn"
            disabled={ordersSectionLoading}
            onClick={refreshAll}
          >
            {ordersSectionLoading ? '불러오는 중…' : '새로고침'}
          </button>
        </div>
        {ordersErr && (
          <div className="banner error small" style={{ marginTop: '0.75rem' }}>
            주문을 불러오지 못했습니다.
          </div>
        )}
        {ordersSectionLoading && !ordersErr ? (
          <p className="muted small" style={{ marginTop: '0.75rem' }}>
            불러오는 중…
          </p>
        ) : null}
        {!ordersSectionLoading && !ordersErr && ordersRows.length === 0 ? (
          <p className="muted small" style={{ marginTop: '0.75rem' }}>
            주문 내역이 없습니다.
          </p>
        ) : null}
        {ordersRows.length > 0 ? (
          <div className="book-list-scroll" style={{ marginTop: '0.75rem' }}>
            <table className="book-list-table orders-table">
              <thead>
                <tr>
                  <th>주문 번호</th>
                  <th>상태</th>
                  <th>앨범 / 수량</th>
                  <th>일시</th>
                </tr>
              </thead>
              <tbody>
                {ordersRows.map((o) => {
                  const ouid = orderRowUid(o)
                  const items = unwrapArray(o, ['items', 'orderItems', 'lines'])
                  const first = items[0] as Row | undefined
                  const bookRef =
                    first && isRecord(first)
                      ? String(
                          first.bookTitle ??
                            first.book_title ??
                            first.title ??
                            first.name ??
                            first.bookUid ??
                            first.book_uid ??
                            '',
                        ).trim()
                      : ''
                  const qty =
                    first && isRecord(first)
                      ? String(first.quantity ?? first.qty ?? '')
                      : ''
                  const detail = ouid ? orderItemSummaryByUid[ouid] : undefined
                  const displayBook = (detail?.bookTitle ?? '') || bookRef || '—'
                  const displayQty = (detail?.quantity ?? '') || qty
                  return (
                    <tr key={ouid || JSON.stringify(o).slice(0, 40)}>
                      <td>
                        {ouid ? (
                          <Link
                            to={`/orders/${encodeURIComponent(ouid)}`}
                            className="order-uid-link"
                          >
                            <code className="book-list-uid">{ouid}</code>
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="small">
                        {orderStatusLabel(
                          o.orderStatus ?? o.status ?? o.order_status,
                          o.orderStatusDisplay,
                        )}
                      </td>
                      <td className="small">
                        {displayBook}
                        {displayQty ? ` × ${displayQty}` : ''}
                      </td>
                      <td className="small muted">
                        {String(
                          o.updatedAt ??
                            o.updated_at ??
                            o.createdAt ??
                            o.created_at ??
                            '—',
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        <h3 className="small" style={{ margin: '1.25rem 0 0.35rem' }}>
          최근 알림
        </h3>
        {webhookErr && <div className="banner error small">{webhookErr}</div>}
        {!ordersSectionLoading && !webhookErr && webhookEvents.length === 0 ? (
          <p className="muted small">알림 내역이 없습니다.</p>
        ) : null}
        {webhookEvents.length > 0 ? (
          <ul className="webhook-event-list">
            {webhookEvents.map((ev, i) => {
              const row = isRecord(ev) ? ev : {}
              const et = String(row.eventType ?? row.type ?? '알림')
              const at = String(row.receivedAt ?? '—')
              const body = row.body
              const snippet =
                body && isRecord(body)
                  ? JSON.stringify(body).slice(0, 280)
                  : String(body ?? '').slice(0, 280)
              return (
                <li key={`${at}-${i}`} className="webhook-event-item">
                  <span className="webhook-event-meta">
                    <strong>{et}</strong>
                    <span className="muted">{at}</span>
                  </span>
                  <pre className="webhook-event-snippet">{snippet}</pre>
                </li>
              )
            })}
          </ul>
        ) : null}
      </section>

      <nav className="nav-footer">
        <Link to="/book/setup">← 설정</Link>
        <Link to="/order">주문하기</Link>
      </nav>
    </div>
  )
}

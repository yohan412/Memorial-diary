import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiGet, apiPatchJson, unwrapArray } from '../api'
import {
  canEditOrderShipping,
  payloadForShippingPatch,
  shippingFormFromOrderData,
  type ShippingFormFields,
} from '../utils/orderShipping'

type Row = Record<string, unknown>

function isRecord(v: unknown): v is Row {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function unwrapOrderPayload(res: unknown): Row | null {
  if (!isRecord(res)) return null
  const d = res.data
  if (isRecord(d)) return d
  return res
}

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
  return map[c] || (c ? '처리 중' : '—')
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

export default function OrderDetailPage() {
  const { orderUid } = useParams<{ orderUid: string }>()
  const uid = orderUid?.trim() ?? ''

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [order, setOrder] = useState<Row | null>(null)
  const [ship, setShip] = useState<ShippingFormFields>(shippingFormFromOrderData(null))
  const [shipSaving, setShipSaving] = useState(false)
  const [shipOk, setShipOk] = useState<string | null>(null)
  const [shipErr, setShipErr] = useState<string | null>(null)

  const load = () => {
    if (!uid) return
    setLoading(true)
    setErr(null)
    void apiGet(`/orders/${encodeURIComponent(uid)}`)
      .then((r) => {
        const d = unwrapOrderPayload(r)
        setOrder(d)
        setShip(shippingFormFromOrderData(d))
      })
      .catch((e) => {
        setErr(e instanceof Error ? e.message : String(e))
        setOrder(null)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- uid only
  }, [uid])

  const statusRaw = order?.orderStatus ?? order?.status ?? order?.order_status
  const editable = useMemo(() => canEditOrderShipping(statusRaw), [statusRaw])
  const orderItems = useMemo(() => pickOrderItems(order), [order])

  const field =
    (k: keyof ShippingFormFields) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setShip((s) => ({ ...s, [k]: e.target.value }))
    }

  const saveShipping = async () => {
    if (!uid || !editable) return
    const body = payloadForShippingPatch(ship)
    if (Object.keys(body).length === 0) {
      setShipErr('변경할 항목을 하나 이상 입력하세요.')
      return
    }
    setShipSaving(true)
    setShipErr(null)
    setShipOk(null)
    try {
      await apiPatchJson(`/orders/${encodeURIComponent(uid)}/shipping`, body)
      setShipOk('배송지가 반영되었습니다.')
      load()
    } catch (e) {
      setShipErr(e instanceof Error ? e.message : String(e))
    } finally {
      setShipSaving(false)
    }
  }

  if (!uid) {
    return (
      <div className="page">
        <div className="banner error">주문 정보를 찾을 수 없습니다.</div>
        <Link to="/manage">← 책·주문 관리</Link>
      </div>
    )
  }

  return (
    <div className="page">
      <h1>주문 상세</h1>
      <p className="muted small">주문 번호: {uid}</p>

      {loading && <p className="muted">불러오는 중…</p>}
      {err && <div className="banner error">{err}</div>}

      {!loading && order && (
        <>
          <section className="card">
            <h2 className="order-detail-card-title">상태</h2>
            <p style={{ margin: '0.25rem 0' }}>
              <strong>
                {orderStatusLabel(statusRaw, order.orderStatusDisplay)}
              </strong>
            </p>
            {!editable ? (
              <p className="muted small" style={{ marginBottom: 0 }}>
                발송(배송 출발) 이후 또는 취소된 주문은 배송지 변경이 불가합니다.
              </p>
            ) : (
              <p className="muted small" style={{ marginBottom: 0 }}>
                결제 완료 ~ 제작·인쇄 단계에서는 배송지를 수정할 수 있습니다.
              </p>
            )}
          </section>

          <section className="card">
            <h2 className="order-detail-card-title">요약</h2>
            <dl className="order-estimate-dl">
              {(
                [
                  ['createdAt', 'created_at', '생성'],
                  ['updatedAt', 'updated_at', '갱신'],
                  ['paidCreditAmount', 'paid_credit_amount', '결제(충전금)'],
                  ['totalAmount', 'total_amount', '합계'],
                  ['shippingFee', 'shipping_fee', '배송비'],
                  ['externalRef', 'external_ref', '외부 참조'],
                ] as const
              ).map(([camel, snake, label]) => {
                const v = order[camel] ?? order[snake]
                if (v == null || v === '') return null
                return (
                  <div key={camel} className="order-estimate-dl-row">
                    <dt>{label}</dt>
                    <dd>{String(v)}</dd>
                  </div>
                )
              })}
            </dl>
          </section>

          <section className="card">
            <h2 className="order-detail-card-title">품목</h2>
            {orderItems.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>
                품목 정보를 찾을 수 없습니다.
              </p>
            ) : (
              <div className="book-list-scroll" style={{ marginTop: '0.25rem' }}>
                <table className="book-list-table orders-table">
                  <thead>
                    <tr>
                      <th>앨범 번호</th>
                      <th>수량</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderItems.map((it, i) => {
                      const row = isRecord(it) ? it : {}
                      const book = pickBookUidFromItem(row) ?? '—'
                      const qty = pickQtyFromItem(row) ?? '—'
                      return (
                        <tr key={`${book}-${i}`}>
                          <td className="small">
                            <code className="book-list-uid">{book}</code>
                          </td>
                          <td className="small">{qty}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h2 className="order-detail-card-title">배송지</h2>
            {editable ? (
              <>
                {shipOk && <div className="banner ok small">{shipOk}</div>}
                {shipErr && <div className="banner error small">{shipErr}</div>}
                <p className="muted small">바꿀 항목만 입력하면 됩니다.</p>
                <label>수령인</label>
                <input className="input" value={ship.recipientName} onChange={field('recipientName')} />
                <label>전화</label>
                <input className="input" value={ship.recipientPhone} onChange={field('recipientPhone')} />
                <label>우편번호</label>
                <input className="input" value={ship.postalCode} onChange={field('postalCode')} />
                <label>주소1</label>
                <input className="input" value={ship.address1} onChange={field('address1')} />
                <label>주소2</label>
                <input className="input" value={ship.address2} onChange={field('address2')} />
                <label>배송 메모</label>
                <textarea
                  className="input"
                  rows={2}
                  value={ship.shippingMemo}
                  onChange={field('shippingMemo')}
                  style={{ resize: 'vertical' }}
                />
                <button
                  type="button"
                  className="btn primary"
                  style={{ marginTop: '0.75rem' }}
                  disabled={shipSaving}
                  onClick={() => void saveShipping()}
                >
                  {shipSaving ? '저장 중…' : '배송지 저장'}
                </button>
              </>
            ) : (
              <dl className="order-estimate-dl">
                <div className="order-estimate-dl-row">
                  <dt>수령인</dt>
                  <dd>{ship.recipientName || '—'}</dd>
                </div>
                <div className="order-estimate-dl-row">
                  <dt>전화</dt>
                  <dd>{ship.recipientPhone || '—'}</dd>
                </div>
                <div className="order-estimate-dl-row">
                  <dt>주소</dt>
                  <dd>
                    {ship.postalCode ? `(${ship.postalCode}) ` : ''}
                    {ship.address1 || '—'} {ship.address2}
                  </dd>
                </div>
                {ship.shippingMemo ? (
                  <div className="order-estimate-dl-row">
                    <dt>메모</dt>
                    <dd>{ship.shippingMemo}</dd>
                  </div>
                ) : null}
              </dl>
            )}
          </section>
        </>
      )}

      <nav className="nav-footer">
        <Link to="/manage">← 책·주문 관리</Link>
        <Link to="/order">주문 생성</Link>
      </nav>
    </div>
  )
}

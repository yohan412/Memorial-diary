import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiGet, apiPostJson } from '../api'
import { useApp } from '../context/AppContext'
import {
  parseEstimateDetails,
  summarizeEstimateResponse,
  type EstimateDetails,
} from '../utils/orderEstimate'

const emptyShipping = {
  recipientName: '',
  recipientPhone: '',
  postalCode: '',
  address1: '',
  address2: '',
  memo: '',
}

const demoShipping = {
  recipientName: '홍길동',
  recipientPhone: '010-1234-5678',
  postalCode: '06100',
  address1: '서울특별시 강남구 테헤란로 123',
  address2: '101동 1001호',
  memo: '문 앞에 두세요',
}

const shippingPlaceholders: Record<keyof typeof emptyShipping, string> = {
  recipientName: '예: 홍길동',
  recipientPhone: '예: 010-1234-5678',
  postalCode: '예: 06100',
  address1: '예: 서울특별시 강남구 테헤란로 123',
  address2: '예: 101동 1001호',
  memo: '예: 문 앞에 두세요',
}

const LINE_COL_LABELS: Record<string, string> = {
  bookUid: '앨범 번호',
  bookTitle: '제목',
  quantity: '수량',
  qty: '수량',
  unitPrice: '단가',
  price: '가격',
  amount: '금액',
  lineTotal: '소계',
  total: '합계',
  pageCount: '페이지',
  pages: '페이지',
  title: '제목',
  name: '이름',
  description: '설명',
}

function unwrapData(res: unknown): Record<string, unknown> | null {
  if (!res || typeof res !== 'object') return null
  const o = res as Record<string, unknown>
  const d = o.data
  if (d && typeof d === 'object' && !Array.isArray(d)) return d as Record<string, unknown>
  return o
}

function pickCreditBalanceWon(res: unknown): number | null {
  const d = unwrapData(res)
  if (!d) return null
  for (const k of [
    'balance',
    'creditBalance',
    'availableBalance',
    'amount',
    'totalBalance',
    'paidCreditBalance',
  ]) {
    const n = Number(d[k])
    if (Number.isFinite(n)) return n
  }
  return null
}

function formatWon(n: number): string {
  return `${n.toLocaleString('ko-KR')}원`
}

export default function OrderPage() {
  const nav = useNavigate()
  const { bookUid, demoMode } = useApp()
  const [qty, setQty] = useState(1)
  const [shipping, setShipping] = useState(() => (demoMode ? demoShipping : emptyShipping))
  const [err, setErr] = useState<string | null>(null)
  const [orderOk, setOrderOk] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [estimateDetails, setEstimateDetails] = useState<EstimateDetails | null>(null)
  const [estimateLine, setEstimateLine] = useState<string | null>(null)
  const [estimateLoading, setEstimateLoading] = useState(false)
  const [estimateErr, setEstimateErr] = useState<string | null>(null)
  const [creditLoading, setCreditLoading] = useState(true)
  const [creditErr, setCreditErr] = useState<string | null>(null)
  const [creditWon, setCreditWon] = useState<number | null>(null)

  useEffect(() => {
    // 데모/일반 모드 전환 시 배송지 기본값 정책을 맞춤
    setShipping(demoMode ? demoShipping : emptyShipping)
  }, [demoMode])

  useEffect(() => {
    let cancelled = false
    setCreditLoading(true)
    setCreditErr(null)
    void (async () => {
      try {
        const r = await apiGet('/credits')
        if (cancelled) return
        setCreditWon(pickCreditBalanceWon(r))
      } catch (e) {
        if (!cancelled) {
          setCreditErr(e instanceof Error ? e.message : String(e))
          setCreditWon(null)
        }
      } finally {
        if (!cancelled) setCreditLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!bookUid) {
      setEstimateDetails(null)
      setEstimateLine(null)
      setEstimateErr(null)
      setEstimateLoading(false)
      return
    }
    let cancelled = false
    const t = window.setTimeout(() => {
      void (async () => {
        setEstimateLoading(true)
        setEstimateErr(null)
        try {
          const r = await apiPostJson('/orders/estimate', {
            items: [{ bookUid, quantity: qty }],
          })
          if (cancelled) return
          setEstimateDetails(parseEstimateDetails(r))
          setEstimateLine(summarizeEstimateResponse(r))
        } catch (e) {
          if (!cancelled) {
            setEstimateErr(e instanceof Error ? e.message : String(e))
            setEstimateLine(null)
            setEstimateDetails(null)
          }
        } finally {
          if (!cancelled) setEstimateLoading(false)
        }
      })()
    }, 350)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [bookUid, qty])

  const field =
    (k: keyof typeof emptyShipping) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setShipping((s) => ({ ...s, [k]: e.target.value }))
    }

  const submit = async () => {
    if (!bookUid) return
    setLoading(true)
    setErr(null)
    setOrderOk(null)
    try {
      const data = await apiPostJson('/orders', {
        items: [{ bookUid, quantity: qty }],
        shipping: {
          recipientName: shipping.recipientName,
          recipientPhone: shipping.recipientPhone,
          postalCode: shipping.postalCode,
          address1: shipping.address1,
          address2: shipping.address2 || undefined,
          memo: shipping.memo || undefined,
        },
      })
      const d = unwrapData(data)
      const ouid =
        (typeof d?.orderUid === 'string' && d.orderUid) ||
        (typeof d?.order_uid === 'string' && d.order_uid) ||
        null
      setOrderOk(
        ouid
          ? `주문이 접수되었습니다. 주문 번호: ${ouid} — 잠시 후 책·주문 페이지로 이동합니다.`
          : '주문이 접수되었습니다. 잠시 후 책·주문 페이지로 이동합니다.',
      )
      window.setTimeout(() => {
        nav('/manage')
      }, 900)
      void (async () => {
        try {
          const r = await apiGet('/credits')
          setCreditWon(pickCreditBalanceWon(r))
        } catch {
          /* ignore */
        }
      })()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page">
      <h1>주문</h1>
      <p className="muted">
        결제가 진행되며 잔액이 차감됩니다. 수량을 바꾸면 아래 금액 안내가 갱신됩니다.
      </p>
      {!bookUid && (
        <div className="banner error">주문할 앨범이 선택되지 않았습니다. 설정이나 «책·주문»에서 이어주세요.</div>
      )}
      {err && <div className="banner error">{err}</div>}
      {orderOk && <div className="banner ok">{orderOk}</div>}
      <section className="card order-page-card">
        <div className="order-card-head">
          <h2 className="order-card-title">주문 정보</h2>
          <div className="order-credit-pill" title="이용 잔액">
            {creditLoading ? (
              <span className="muted small">충전금 조회…</span>
            ) : creditErr ? (
              <span className="warn-inline small">충전금: {creditErr}</span>
            ) : creditWon != null ? (
              <span>충전금 {formatWon(creditWon)}</span>
            ) : (
              <span className="muted small">충전금 정보 없음</span>
            )}
          </div>
        </div>

        <label>수량</label>
        <input
          type="number"
          min={1}
          className="input"
          value={qty}
          onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
        />
        {bookUid && (
          <div className="order-estimate-block" style={{ marginTop: '0.75rem' }}>
            <h3 className="order-estimate-subheading" style={{ marginTop: 0 }}>
              견적 상세
            </h3>
            {estimateLoading ? (
              <p className="muted small" style={{ margin: 0 }}>
                견적 조회 중…
              </p>
            ) : estimateErr ? (
              <p className="error-text small" style={{ margin: 0 }}>
                견적: {estimateErr}
              </p>
            ) : estimateDetails ? (
              <>
                <p
                  className="small"
                  style={{ margin: '0 0 0.5rem', fontWeight: 600, minHeight: '1.2rem' }}
                >
                  {estimateLine ?? '—'}
                </p>
                <div style={{ minHeight: '7.5rem' }}>
                  {estimateDetails.summary.length > 0 ? (
                    <>
                      <h3 className="order-estimate-subheading">금액·배송·세금 요약</h3>
                      <dl className="order-estimate-dl">
                        {estimateDetails.summary.map((row) => (
                          <div key={row.key} className="order-estimate-dl-row">
                            <dt>{row.label}</dt>
                            <dd>{row.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </>
                  ) : (
                    <p className="muted small" style={{ margin: 0 }}>
                      요약 정보가 없습니다.
                    </p>
                  )}
                  {estimateDetails.lineItems.length > 0 ? (
                    <>
                      <h3 className="order-estimate-subheading">품목·책 단위 내역</h3>
                      <div className="order-estimate-table-wrap">
                        <table className="order-estimate-table">
                          <thead>
                            <tr>
                              {estimateDetails.lineItemColumns.map((c) => (
                                <th key={c}>{LINE_COL_LABELS[c] ?? c}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {estimateDetails.lineItems.map((row, i) => (
                              <tr key={i}>
                                {estimateDetails.lineItemColumns.map((c) => (
                                  <td key={c}>{row[c] ?? '—'}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : null}
                </div>
                {estimateDetails.rawNote ? (
                  <p className="muted small">{estimateDetails.rawNote}</p>
                ) : null}
              </>
            ) : (
              <p className="muted small" style={{ margin: 0 }}>
                견적 정보를 불러오지 못했습니다.
              </p>
            )}
          </div>
        )}
        <h3>배송지</h3>
        {(
          [
            ['recipientName', '수령인'],
            ['recipientPhone', '전화'],
            ['postalCode', '우편번호'],
            ['address1', '주소1'],
            ['address2', '주소2'],
            ['memo', '메모'],
          ] as const
        ).map(([k, label]) => (
          <div key={k}>
            <label>{label}</label>
            <input
              className="input"
              value={shipping[k]}
              placeholder={shippingPlaceholders[k]}
              onChange={field(k)}
            />
          </div>
        ))}
        <button
          type="button"
          className="btn primary"
          style={{ marginTop: '0.75rem' }}
          disabled={!bookUid || loading}
          onClick={() => void submit()}
        >
          {loading ? '주문 중…' : '주문 생성'}
        </button>
      </section>

      <nav className="nav-footer">
        <Link to="/contents">← 본문 편집</Link>
        <Link to="/manage">책·주문</Link>
        <Link to="/book/setup">설정</Link>
      </nav>
    </div>
  )
}

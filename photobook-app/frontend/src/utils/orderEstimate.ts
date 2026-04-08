/** 견적 API 응답 파싱 — 상품·배송·세금·합계 등 상세 표시 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

const KEY_LABELS: Record<string, string> = {
  paidCreditAmount: '결제(충전금 차감) 예정',
  totalAmount: '합계',
  grandTotal: '총액',
  estimatedTotal: '예상 합계',
  productAmount: '상품 금액',
  subtotal: '소계',
  subTotal: '소계',
  shippingFee: '배송비',
  shippingAmount: '배송 금액',
  deliveryFee: '배송비',
  vatAmount: '부가세(VAT)',
  taxAmount: '세금',
  vat: '부가세',
  discountAmount: '할인',
  balanceAfterOrder: '주문 후 잔액(예상)',
  creditBalance: '현재 충전금',
  currency: '통화',
  message: '메시지',
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number' && Number.isFinite(v))
    return v.toLocaleString('ko-KR')
  if (typeof v === 'boolean') return v ? '예' : '아니오'
  if (typeof v === 'string') return v.trim() || '—'
  return JSON.stringify(v)
}

function labelForKey(k: string): string {
  return KEY_LABELS[k] ?? k.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())
}

/** 객체 배열인지(견적 라인 후보) */
function isObjectArray(a: unknown): a is Record<string, unknown>[] {
  return Array.isArray(a) && a.length > 0 && a.every((x) => isRecord(x))
}

export type EstimateKvRow = { key: string; label: string; value: string }
export type EstimateLineItem = Record<string, string>

export type EstimateDetails = {
  summary: EstimateKvRow[]
  lineItems: EstimateLineItem[]
  lineItemColumns: string[]
  rawNote: string | null
}

function pickLineArray(data: Record<string, unknown>): Record<string, unknown>[] | null {
  const keys = [
    'lines',
    'items',
    'orderLines',
    'lineItems',
    'estimateLines',
    'books',
  ]
  for (const k of keys) {
    const v = data[k]
    if (isObjectArray(v)) return v
  }
  return null
}

/** 견적 응답을 UI용 상세 구조로 변환 */
export function parseEstimateDetails(res: unknown): EstimateDetails {
  const empty: EstimateDetails = {
    summary: [],
    lineItems: [],
    lineItemColumns: [],
    rawNote: null,
  }
  if (!isRecord(res)) return empty
  const data = isRecord(res.data) ? res.data : res
  const lineArr = pickLineArray(data)

  const summary: EstimateKvRow[] = []
  for (const [k, v] of Object.entries(data)) {
    if (k === 'lines' || k === 'items' || k === 'orders') continue
    if (lineArr && data[k] === lineArr) continue
    if (Array.isArray(v)) continue
    if (isRecord(v)) continue
    summary.push({ key: k, label: labelForKey(k), value: fmtVal(v) })
  }

  summary.sort((a, b) => {
    const pri = (x: string) => {
      if (x.includes('배송')) return 1
      if (x.includes('상품') || x.includes('소계')) return 0
      if (x.includes('부가세') || x.includes('세금')) return 2
      if (x.includes('합계') || x.includes('총') || x.includes('결제')) return 4
      return 3
    }
    return pri(a.label) - pri(b.label) || a.label.localeCompare(b.label, 'ko')
  })

  let lineItems: EstimateLineItem[] = []
  let lineItemColumns: string[] = []
  if (lineArr) {
    const colSet = new Set<string>()
    for (const row of lineArr) {
      for (const key of Object.keys(row)) {
        if (!isRecord(row[key])) colSet.add(key)
      }
    }
    lineItemColumns = [...colSet]
    const preferred = [
      'bookUid',
      'bookTitle',
      'title',
      'name',
      'description',
      'quantity',
      'qty',
      'unitPrice',
      'price',
      'amount',
      'lineTotal',
      'total',
      'pageCount',
      'pages',
    ]
    lineItemColumns.sort((a, b) => {
      const ia = preferred.indexOf(a)
      const ib = preferred.indexOf(b)
      if (ia >= 0 && ib >= 0) return ia - ib
      if (ia >= 0) return -1
      if (ib >= 0) return 1
      return a.localeCompare(b)
    })
    lineItems = lineArr.map((row) => {
      const out: EstimateLineItem = {}
      for (const c of lineItemColumns) {
        out[c] = fmtVal(row[c])
      }
      return out
    })
  }

  return {
    summary,
    lineItems,
    lineItemColumns,
    rawNote:
      summary.length === 0 && lineItems.length === 0
        ? '응답에 숫자 요약 필드가 없으면 아래 원본 JSON을 확인하세요.'
        : null,
  }
}

/** 하위 호환: 한 줄 요약 */
export function summarizeEstimateResponse(r: unknown): string {
  const d = parseEstimateDetails(r)
  const pay = d.summary.find(
    (x) =>
      x.key === 'paidCreditAmount' ||
      x.label.includes('결제') ||
      x.label.includes('합계'),
  )
  const total = d.summary.find(
    (x) =>
      x.key === 'totalAmount' ||
      x.key === 'grandTotal' ||
      x.key === 'estimatedTotal',
  )
  const row = pay ?? total ?? d.summary[0]
  if (row) return `${row.label}: ${row.value}`
  if (d.lineItems.length > 0) return `견적 품목 ${d.lineItems.length}건`
  return '견적을 확인했습니다.'
}

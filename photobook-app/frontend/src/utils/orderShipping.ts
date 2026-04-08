/** 주문 상세에서 배송지 편집 가능 여부 (발송·배송 완료·취소 전만) */

export function canEditOrderShipping(status: unknown): boolean {
  const n = Number(status)
  if (Number.isFinite(n)) {
    if (n >= 80) return false
    if (n >= 60) return false
    if (n >= 20 && n < 60) return true
    return false
  }
  const u = String(status ?? '').toUpperCase()
  if (u.includes('CANCEL')) return false
  if (u.includes('SHIPPED') || u.includes('DELIVERED')) return false
  if (u.includes('SHIP') || u.includes('DELIVER')) return false
  return true
}

export type ShippingFormFields = {
  recipientName: string
  recipientPhone: string
  postalCode: string
  address1: string
  address2: string
  shippingMemo: string
}

const emptyShipping: ShippingFormFields = {
  recipientName: '',
  recipientPhone: '',
  postalCode: '',
  address1: '',
  address2: '',
  shippingMemo: '',
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** GET /orders/:uid 응답 data에서 배송지 폼 초기값 추출 */
export function shippingFormFromOrderData(
  order: Record<string, unknown> | null,
): ShippingFormFields {
  if (!order) return { ...emptyShipping }
  const candidates = [
    order.shipping,
    order.delivery,
    order.shippingAddress,
    order.deliveryAddress,
  ]
  let row: Record<string, unknown> = order
  for (const c of candidates) {
    if (isRecord(c)) {
      row = c
      break
    }
  }
  const str = (k: string, ...alts: string[]) => {
    for (const key of [k, ...alts]) {
      const v = row[key]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    return ''
  }
  return {
    recipientName: str('recipientName', 'recipient_name'),
    recipientPhone: str('recipientPhone', 'recipient_phone', 'phone'),
    postalCode: str('postalCode', 'postal_code', 'zipCode', 'zip'),
    address1: str('address1', 'address_1', 'addr1'),
    address2: str('address2', 'address_2', 'addr2'),
    shippingMemo: str('shippingMemo', 'shipping_memo', 'memo'),
  }
}

/** PATCH /orders/:id/shipping 본문 (빈 문자열 필드 제외) */
export function payloadForShippingPatch(
  fields: ShippingFormFields,
): Record<string, string> {
  const out: Record<string, string> = {}
  const map: [keyof ShippingFormFields, string][] = [
    ['recipientName', 'recipientName'],
    ['recipientPhone', 'recipientPhone'],
    ['postalCode', 'postalCode'],
    ['address1', 'address1'],
    ['address2', 'address2'],
    ['shippingMemo', 'shippingMemo'],
  ]
  for (const [fk, apiKey] of map) {
    const v = fields[fk].trim()
    if (v) out[apiKey] = v
  }
  return out
}

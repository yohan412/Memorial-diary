/** GET /templates 목록 행 — BookSetup·표지·내지 공통 */

export type TemplateRow = Record<string, unknown>

export function pickTemplateUid(t: TemplateRow): string {
  return String(
    t.templateUid ?? t.uid ?? t.id ?? t.bookSpecUid ?? '',
  )
}

const LABEL_KEYS = [
  'templateName',
  'name',
  'title',
  'displayName',
  'label',
  'nickName',
  'nickname',
  'templateTitle',
] as const

function firstNonEmptyString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

/** 목록/상세 행에서 사람이 읽을 템플릿 이름 (API 키 차이 흡수) */
export function pickLabel(t: TemplateRow): string {
  if (!t || typeof t !== 'object') return '?'
  for (const k of LABEL_KEYS) {
    const s = firstNonEmptyString(t[k])
    if (s) return s
  }
  const nested = t.template
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const n = nested as TemplateRow
    for (const k of LABEL_KEYS) {
      const s = firstNonEmptyString(n[k])
      if (s) return s
    }
  }
  const uid = pickTemplateUid(t)
  return uid || '?'
}

/** 선택 UID 에 대해 목록 행 → 상세(templateName) → UID 순으로 표시 문자열 */
export function resolveTemplateDisplayName(
  uid: string,
  list: TemplateRow[],
  detail: { templateUid?: string; templateName?: string } | null,
): string {
  const u = uid.trim()
  if (!u) return ''
  const row = list.find((t) => pickTemplateUid(t) === u)
  if (row) {
    const lab = pickLabel(row)
    if (lab && lab !== u) return lab
  }
  const du = detail?.templateUid?.trim()
  if (du === u && detail?.templateName?.trim()) {
    return detail.templateName.trim()
  }
  return u
}

export function pickTemplateKind(t: TemplateRow): string {
  const direct = String(
    t.templateKind ?? t.kind ?? t.pageType ?? t.templateType ?? '',
  ).toLowerCase()
  if (direct) return direct
  const name = String(t.name ?? t.title ?? '').toLowerCase()
  if (name.includes('cover') || name.includes('표지')) return 'cover'
  if (
    name.includes('content') ||
    name.includes('inner') ||
    name.includes('내지')
  )
    return 'content'
  return ''
}

export function dedupeTemplatesByUid(list: TemplateRow[]): TemplateRow[] {
  const seen = new Set<string>()
  const out: TemplateRow[] = []
  for (const t of list) {
    const u = pickTemplateUid(t)
    if (!u || seen.has(u)) continue
    seen.add(u)
    out.push(t)
  }
  return out
}

export function filterCoverTemplates(templates: TemplateRow[]): TemplateRow[] {
  return templates.filter((t) => {
    const k = pickTemplateKind(t)
    return k === 'cover' || k.includes('cover')
  })
}

export function filterContentTemplates(templates: TemplateRow[]): TemplateRow[] {
  return templates.filter((t) => {
    const k = pickTemplateKind(t)
    if (k === 'cover' || k.includes('cover')) return false
    const isContent =
      k === 'content' ||
      k.includes('content') ||
      k === 'inner' ||
      k.includes('inner') ||
      k === 'page'
    return isContent || !k
  })
}

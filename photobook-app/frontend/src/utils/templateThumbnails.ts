import { unwrapTemplateData } from './templateParams'

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** 응답 트리 어디에 있든 thumbnails 객체 탐색 (상세 JSON 래핑 차이 흡수) */
function findThumbnailsObjectDeep(
  root: unknown,
  depth = 0,
): Record<string, unknown> | null {
  if (depth > 10 || !isRecord(root)) return null
  const th = root.thumbnails
  if (isRecord(th)) return th
  for (const v of Object.values(root)) {
    const r = findThumbnailsObjectDeep(v, depth + 1)
    if (r) return r
  }
  return null
}

/**
 * unwrap 한 노드에 thumbnails 가 없으면 전체 응답에서 찾아 병합.
 * Templates API: thumbnails.layout / baseLayerOdd / baseLayerEven
 */
export function mergeTemplateDetailForPreview(
  res: unknown,
): Record<string, unknown> | null {
  const base = unwrapTemplateData(res)
  const thObj = findThumbnailsObjectDeep(res)
  if (!base) {
    return thObj ? { thumbnails: thObj } : null
  }
  if (!isRecord(base.thumbnails) && thObj) {
    return { ...base, thumbnails: thObj }
  }
  return base
}

/** Templates API: thumbnails.layout, baseLayerOdd, baseLayerEven 우선 */
const THUMB_KEY_PRIORITY = [
  'layout',
  'baseLayerOdd',
  'baseLayerEven',
] as const

const PRIORITY_SET = new Set<string>(THUMB_KEY_PRIORITY)

function pushHttpString(
  label: string,
  v: unknown,
  out: { label: string; url: string }[],
): void {
  if (typeof v === 'string' && /^https?:\/\//i.test(v)) {
    out.push({ label, url: v.trim() })
    return
  }
  if (Array.isArray(v)) {
    v.forEach((item, i) => {
      if (typeof item === 'string' && /^https?:\/\//i.test(item)) {
        out.push({ label: `${label}[${i}]`, url: item.trim() })
      }
    })
    return
  }
  if (isRecord(v)) {
    const u = v.url ?? v.href ?? v.src
    if (typeof u === 'string' && /^https?:\/\//i.test(u)) {
      out.push({ label, url: u.trim() })
    }
  }
}

/** 템플릿 상세·목록 행의 thumbnails에서 HTTP URL 목록 (layout 우선) */
export function collectTemplateThumbnailEntries(
  raw: Record<string, unknown> | null,
): { label: string; url: string }[] {
  if (!raw) return []
  const th = raw.thumbnails
  if (!isRecord(th)) return []
  const out: { label: string; url: string }[] = []

  for (const k of THUMB_KEY_PRIORITY) {
    if (!Object.prototype.hasOwnProperty.call(th, k)) continue
    pushHttpString(k, th[k], out)
  }

  const restKeys = Object.keys(th).filter((k) => !PRIORITY_SET.has(k)).sort()
  for (const k of restKeys) {
    pushHttpString(k, th[k], out)
  }

  return out
}

export function firstTemplateThumbnailUrlFromRaw(
  raw: Record<string, unknown> | null,
): string | null {
  const entries = collectTemplateThumbnailEntries(raw)
  return entries[0]?.url ?? null
}

/** GET /templates 목록의 한 행 — layout 썸네일 URL */
export function firstTemplateThumbnailFromListRow(
  row: Record<string, unknown> | null | undefined,
): string | null {
  return firstTemplateThumbnailUrlFromRaw(row ?? null)
}

/** GET /api/templates/:uid JSON 응답 전체 */
export function firstTemplateThumbnailUrlFromApiResponse(
  res: unknown,
): string | null {
  return firstTemplateThumbnailUrlFromRaw(mergeTemplateDetailForPreview(res))
}

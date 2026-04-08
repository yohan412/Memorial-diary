/** Sweetbook 책 표지/내지 GET 응답을 UI용으로 정규화 (필드명이 환경별로 달라질 수 있음) */

import type { ContentInsertedSnapshot } from '../components/ContentInsertedStrip'
import { firstTemplateThumbnailUrlFromRaw } from './templateThumbnails'

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export function unwrapBookData(res: unknown): Record<string, unknown> | null {
  if (!isRecord(res)) return null
  if (isRecord(res.data)) return res.data as Record<string, unknown>
  return res as Record<string, unknown>
}

function parseParametersValue(v: unknown): Record<string, unknown> | null {
  if (!v) return null
  if (typeof v === 'string') {
    try {
      const o = JSON.parse(v) as unknown
      return isRecord(o) ? o : null
    } catch {
      return null
    }
  }
  return isRecord(v) ? v : null
}

const URL_KEY_HINT = /preview|thumb|render|image|photo|cover|layout|url|src|picture/i

function pushHttpUrl(s: string, out: string[]) {
  let t = s.trim()
  if (/^\/\//.test(t)) t = `https:${t}`
  if (!/^https?:\/\//i.test(t) || t.length < 10) return
  if (out.includes(t)) return
  out.push(t)
}

/** GET /Books/.../cover data 루트·중첩에서 흔한 렌더/미리보기 필드 */
function collectTopLevelCoverImageUrls(data: Record<string, unknown>): string[] {
  const keys = [
    'renderedPreviewUrl',
    'renderedImageUrl',
    'previewImageUrl',
    'coverPreviewUrl',
    'thumbnailUrl',
    'imageUrl',
    'coverImageUrl',
    'frontCoverUrl',
    'backCoverUrl',
    'outputPreviewUrl',
    'previewUrl',
    'url',
  ] as const
  const out: string[] = []
  for (const k of keys) {
    const v = data[k]
    if (typeof v === 'string') pushHttpUrl(v, out)
  }
  const purls = data['previewUrls']
  if (Array.isArray(purls)) {
    for (const x of purls) {
      if (typeof x === 'string') pushHttpUrl(x, out)
    }
  }
  const rendered = data['rendered']
  if (isRecord(rendered)) {
    for (const k of ['url', 'previewUrl', 'imageUrl', 'thumbnailUrl'] as const) {
      const v = rendered[k]
      if (typeof v === 'string') pushHttpUrl(v, out)
    }
  }
  const preview = data['preview']
  if (isRecord(preview)) {
    for (const k of ['url', 'imageUrl', 'src'] as const) {
      const v = preview[k]
      if (typeof v === 'string') pushHttpUrl(v, out)
    }
  }
  return out
}

function mergeUniqueUrls(...groups: string[][]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const g of groups) {
    for (const u of g) {
      if (seen.has(u)) continue
      seen.add(u)
      out.push(u)
    }
  }
  return out
}

/** 객체 안에서 표지 미리보기로 쓸 만한 URL 수집 */
export function collectCoverPreviewUrls(root: unknown, max = 6): string[] {
  const out: string[] = []

  function walk(x: unknown, depth: number) {
    if (depth > 12 || out.length >= max) return
    if (typeof x === 'string') {
      pushHttpUrl(x, out)
      return
    }
    if (!x || typeof x !== 'object') return
    if (Array.isArray(x)) {
      for (const it of x) walk(it, depth + 1)
      return
    }
    for (const [k, v] of Object.entries(x)) {
      if (typeof v === 'string' && URL_KEY_HINT.test(k)) {
        pushHttpUrl(v, out)
      } else {
        walk(v, depth + 1)
      }
    }
  }

  walk(root, 0)
  return out
}

export function findTemplateUidDeep(root: unknown, maxDepth = 14): string {
  function walk(x: unknown, depth: number): string {
    if (depth > maxDepth) return ''
    if (!x || typeof x !== 'object') return ''
    if (!Array.isArray(x)) {
      const o = x as Record<string, unknown>
      const u = o['templateUid']
      if (typeof u === 'string' && u.trim()) return u.trim()
    }
    if (Array.isArray(x)) {
      for (const it of x) {
        const f = walk(it, depth + 1)
        if (f) return f
      }
      return ''
    }
    for (const v of Object.values(x)) {
      const f = walk(v, depth + 1)
      if (f) return f
    }
    return ''
  }
  return walk(root, 0)
}

export function extractCoverFromBookApi(res: unknown): {
  templateUid: string
  parameters: Record<string, unknown>
  previewUrls: string[]
} | null {
  const data = unwrapBookData(res) ?? (isRecord(res) ? res : null)
  if (!data) return null
  const templateUid = findTemplateUidDeep(data)
  let parameters: Record<string, unknown> = {}
  const p =
    parseParametersValue(data['parameters']) ??
    parseParametersValue(data['templateParameters']) ??
    parseParametersValue((data['cover'] as Record<string, unknown> | undefined)?.['parameters'])
  if (p) parameters = p
  const previewUrls = mergeUniqueUrls(
    collectTopLevelCoverImageUrls(data),
    collectCoverPreviewUrls(data),
  )
  if (!templateUid && previewUrls.length === 0 && Object.keys(parameters).length === 0) {
    return null
  }
  return {
    templateUid,
    parameters,
    previewUrls,
  }
}

function pickFirstUrl(
  row: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const k of keys) {
    const v = row[k]
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) return v.trim()
  }
  return null
}

/** parameters 객체에서 Sweetbook 서버 파일명 후보 추출 (갤러리 배열 포함) */
export function firstPhotoFileNameFromParams(
  params: Record<string, unknown>,
): string | null {
  let fallback: string | null = null
  for (const v of Object.values(params)) {
    if (typeof v === 'string') {
      const s = v.trim()
      if (!s || /^https?:\/\//i.test(s) || /^www\./i.test(s)) continue
      if (/\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(s)) return s
      if (!fallback) fallback = s
    }
    if (Array.isArray(v)) {
      for (const x of v) {
        if (typeof x !== 'string') continue
        const s = x.trim()
        if (!s || /^https?:\/\//i.test(s) || /^www\./i.test(s)) continue
        if (/\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(s)) return s
        if (!fallback) fallback = s
      }
    }
  }
  return fallback
}

function contentSnapshotFromRow(
  row: Record<string, unknown>,
  order: number,
  idFallback: string,
): ContentInsertedSnapshot | null {
  const templateUid = String(
    row.templateUid ??
      row.templateID ??
      row.template_id ??
      row.contentTemplateUid ??
      row.contentTemplateUID ??
      '',
  ).trim()
  if (!templateUid) return null
  const params =
    parseParametersValue(row.parameters) ??
    parseParametersValue(row.templateParameters) ??
    {}
  const layoutThumbUrl =
    pickFirstUrl(row, [
      'pagePreviewUrl',
      'contentPreviewUrl',
      'renderPreviewUrl',
      'previewImageUrl',
      'thumbnailUrl',
      'previewUrl',
    ]) ??
    pickFirstUrl(row, [
      'layoutThumbnailUrl',
      'layoutThumbUrl',
      'thumbUrl',
      'templateThumbnailUrl',
    ]) ??
    firstTemplateThumbnailUrlFromRaw(row) ??
    null
  const photoFileName =
    (typeof row.photoFileName === 'string' && row.photoFileName.trim()) ||
    (typeof row.fileName === 'string' && row.fileName.trim()) ||
    (typeof row.mainImageFileName === 'string' &&
      row.mainImageFileName.trim()) ||
    (typeof row.imageMain === 'string' && row.imageMain.trim()) ||
    firstPhotoFileNameFromParams(params)
  return {
    id: String(row.uid ?? row.id ?? row.contentUid ?? idFallback),
    order,
    templateUid,
    templateName: String(
      row.templateName ?? row.name ?? row.title ?? '내지',
    ).trim(),
    layoutThumbUrl,
    photoFileName: photoFileName || null,
  }
}

/** 스프레드·중첩 pages 를 풀어 한 페이지당 카드 하나로 만든다. */
function expandContentArray(arr: unknown[]): ContentInsertedSnapshot[] {
  const out: ContentInsertedSnapshot[] = []
  let seq = 0
  for (let i = 0; i < arr.length; i++) {
    const row = arr[i]
    if (!isRecord(row)) continue

    const nested = row['pages']
    if (Array.isArray(nested) && nested.length > 0) {
      for (let j = 0; j < nested.length; j++) {
        const sub = nested[j]
        if (!isRecord(sub)) continue
        const s = contentSnapshotFromRow(sub, seq + 1, `srv-${i}-${j}`)
        if (s) {
          out.push(s)
          seq++
        }
      }
      continue
    }

    const left = row['leftPage']
    const right = row['rightPage']
    let usedSides = false
    if (isRecord(left)) {
      const s = contentSnapshotFromRow(left, seq + 1, `srv-${i}-L`)
      if (s) {
        out.push(s)
        seq++
        usedSides = true
      }
    }
    if (isRecord(right)) {
      const s = contentSnapshotFromRow(right, seq + 1, `srv-${i}-R`)
      if (s) {
        out.push(s)
        seq++
        usedSides = true
      }
    }
    if (usedSides) continue

    const body = row['content']
    if (isRecord(body)) {
      const s = contentSnapshotFromRow(body, seq + 1, `srv-${i}-body`)
      if (s) {
        out.push(s)
        seq++
        continue
      }
    }

    const s = contentSnapshotFromRow(row, seq + 1, `srv-${i}`)
    if (s) {
      out.push(s)
      seq++
    }
  }
  return out
}

/** data.data 중첩 등 Sweetbook 응답 래핑 제거 */
function peelBookPayload(root: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!root) return null
  let cur: Record<string, unknown> | null = root
  for (let i = 0; i < 5 && cur; i++) {
    const inner: unknown = cur['data']
    if (isRecord(inner) && !Array.isArray(inner)) {
      cur = inner
      continue
    }
    break
  }
  return cur
}

function rowLooksLikeContentPage(row: unknown): boolean {
  if (!isRecord(row)) return false
  const uid =
    row.templateUid ??
    row.templateID ??
    row.template_id ??
    row.contentTemplateUid
  return typeof uid === 'string' && uid.trim().length > 0
}

/** 객체 안의 배열 중 내지 행으로 보이는 첫 목록 */
function findContentArrayInObject(data: Record<string, unknown>): unknown[] | null {
  for (const v of Object.values(data)) {
    if (!Array.isArray(v) || v.length === 0) continue
    if (v.some(rowLooksLikeContentPage)) return v
  }
  return null
}

export function extractContentPagesFromApi(res: unknown): ContentInsertedSnapshot[] {
  const top = unwrapBookData(res) ?? (isRecord(res) ? res : null)
  const data = peelBookPayload(top) ?? top
  if (!data) return []

  const candidates = [
    data['pages'],
    data['contents'],
    data['items'],
    data['contentPages'],
    data['contentList'],
    data['bookContents'],
    data['innerPages'],
    data['pageList'],
    data['layouts'],
    data['sheets'],
    data['spreads'],
    data['results'],
    data['list'],
  ]

  for (const arr of candidates) {
    if (!Array.isArray(arr) || arr.length === 0) continue
    const out = expandContentArray(arr)
    if (out.length) return out
  }

  const discovered = findContentArrayInObject(data)
  if (discovered) {
    const out = expandContentArray(discovered)
    if (out.length) return out
  }

  return []
}

export function pickContentPageCount(book: Record<string, unknown> | null): number | null {
  if (!book) return null
  const keys = [
    'contentPageCount',
    'pageCount',
    'totalPageCount',
    'innerPageCount',
    'currentPageCount',
    'innerPages',
    'pages',
  ]
  for (const k of keys) {
    const n = Number(book[k])
    if (Number.isFinite(n) && n > 0) return Math.floor(n)
  }
  return null
}

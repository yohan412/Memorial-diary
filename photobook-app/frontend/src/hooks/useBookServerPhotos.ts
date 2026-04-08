import { useEffect, useMemo, useState } from 'react'
import { parseJson } from '../api'
import { useApp } from '../context/AppContext'
import { proxiedSweetbookImageUrl } from '../utils/sweetbookAssetProxy'

export type ServerPhotoListEntry = {
  fileName: string
  /** @see https://api.sweetbook.com/docs/guides/images/ — 미리보기용(최대 800px) */
  thumbnailUrl?: string
  /** 가이드 응답 originalUrl — 썸네일 실패 시 중간 폴백 */
  originalUrl?: string
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim())
}

function pushEntryDetailed(
  p: unknown,
  out: ServerPhotoListEntry[],
  seen: Set<string>,
) {
  if (typeof p === 'string') {
    const s = p.trim()
    if (s && !seen.has(s)) {
      seen.add(s)
      out.push({ fileName: s })
    }
    return
  }
  if (!p || typeof p !== 'object') return
  const o = p as Record<string, unknown>
  const fn =
    (typeof o.fileName === 'string' && o.fileName) ||
    (typeof o.name === 'string' && o.name) ||
    (typeof o.filename === 'string' && o.filename) ||
    ''
  const s = fn.trim()
  if (!s || seen.has(s)) return
  seen.add(s)
  const th =
    o.thumbnailUrl ??
    o.thumbnailURL ??
    o.thumbUrl ??
    o.previewUrl ??
    o.smallUrl ??
    o.thumbNailUrl ??
    (typeof o.thumbnail === 'string' ? o.thumbnail : undefined)
  const thumbnailUrl =
    typeof th === 'string' && th.trim() && isHttpUrl(th) ? th.trim() : undefined
  const origRaw = o.originalUrl ?? o.originalURL ?? o.sourceUrl
  const originalUrl =
    typeof origRaw === 'string' && origRaw.trim() && isHttpUrl(origRaw)
      ? origRaw.trim()
      : undefined
  out.push({ fileName: s, thumbnailUrl, originalUrl })
}

/** Sweetbook GET /Books/.../photos — data 가 객체·배열인 경우 (백엔드 파서와 동일) */
function unwrapPhotosPayloadDetailed(data: unknown): ServerPhotoListEntry[] {
  if (!data || typeof data !== 'object') return []
  const root = data as { data?: unknown }
  const d = root.data
  const out: ServerPhotoListEntry[] = []
  const seen = new Set<string>()

  if (Array.isArray(d)) {
    for (const p of d) pushEntryDetailed(p, out, seen)
    return out
  }
  if (!d || typeof d !== 'object') return []
  const obj = d as Record<string, unknown>
  const photosArr = obj.photos
  const hasPhotosArray = Array.isArray(photosArr) && photosArr.length > 0
  if (
    !hasPhotosArray &&
    typeof obj.fileName === 'string' &&
    obj.fileName.trim()
  ) {
    pushEntryDetailed(obj, out, seen)
    if (out.length) return out
  }
  for (const key of [
    'photos',
    'fileNames',
    'files',
    'items',
    'results',
    'photoList',
    'list',
  ] as const) {
    const block = obj[key]
    if (!Array.isArray(block)) continue
    for (const p of block) pushEntryDetailed(p, out, seen)
  }
  return out
}

/** 목록 항목 → 미리보기용 URL (가이드 썸네일 우선, 없으면 바이너리 프록시) */
export function previewUrlForServerPhoto(
  e: ServerPhotoListEntry,
): string {
  // 예전 동작으로 복귀: URL이 있으면 그걸 우선 사용, 없으면 바이너리 프록시
  if (e.originalUrl) return proxiedSweetbookImageUrl(e.originalUrl)
  if (e.thumbnailUrl) return proxiedSweetbookImageUrl(e.thumbnailUrl)
  // 사용자가 /api/books/{uid}/photos/{fileName} 호출을 원치 않는 경우: 폴백 없음
  return ''
}

/** Sweetbook에 올라간 사진 파일명 + 미리보기 URL (thumbnailUrl 있으면 API 썸네일) */
export function useBookServerPhotos(bookUid: string | null) {
  const { demoMode, uploadedPhotoNames, uploadedPhotoPreviewByName } = useApp()
  const [entries, setEntries] = useState<ServerPhotoListEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (demoMode) {
      setEntries(uploadedPhotoNames.map((fileName) => ({ fileName })))
      setErr(null)
      setLoading(false)
      return
    }
    if (!bookUid) {
      setEntries([])
      setErr(null)
      return
    }
    let cancel = false
    setLoading(true)
    setErr(null)
    void fetch(`/api/books/${encodeURIComponent(bookUid)}/photos`)
      .then(async (res) => {
        const data = await parseJson(res)
        if (cancel) return
        if (!res.ok) {
          const msg =
            typeof (data as { message?: string }).message === 'string'
              ? (data as { message: string }).message
              : `HTTP ${res.status}`
          setErr(msg)
          setEntries([])
          return
        }
        setEntries(unwrapPhotosPayloadDetailed(data))
      })
      .catch(() => {
        if (!cancel) {
          setErr('사진 목록을 불러오지 못했습니다.')
          setEntries([])
        }
      })
      .finally(() => {
        if (!cancel) setLoading(false)
      })
    return () => {
      cancel = true
    }
  }, [bookUid, demoMode, uploadedPhotoNames])

  const fileNames = useMemo(() => entries.map((e) => e.fileName), [entries])

  const urlByFileName = useMemo(() => {
    if (demoMode) return { ...uploadedPhotoPreviewByName }
    if (!bookUid || !entries.length) return {}
    const m: Record<string, string> = {}
    for (const e of entries) {
      m[e.fileName] = previewUrlForServerPhoto(e)
    }
    return m
  }, [bookUid, entries, demoMode, uploadedPhotoPreviewByName])

  // photos 목록이 originalUrl 을 안 주는 환경이 많아, 여기서는 별도 originalUrl 매핑을 만들지 않는다.
  const photoOriginalByName = useMemo(() => ({} as Record<string, string>), [])

  return { fileNames, urlByFileName, photoOriginalByName, loading, err }
}

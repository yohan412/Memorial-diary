import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import BookEditorShell from '../components/BookEditorShell'
import ContentInsertedStrip from '../components/ContentInsertedStrip'
import type { ContentInsertedSnapshot } from '../components/ContentInsertedStrip'
import TemplateParameterForm from '../components/TemplateParameterForm'
import TemplatePreviewBlock from '../components/TemplatePreviewBlock'
import UploadedPhotoThumb from '../components/UploadedPhotoThumb'
import { useBookServerPhotos } from '../hooks/useBookServerPhotos'
import { useSweetbookTemplateParameters } from '../hooks/useSweetbookTemplateParameters'
import { useTemplatesForBookSpec } from '../hooks/useTemplatesForBookSpec'
import { apiGet, apiPostEmpty, errorMessageFromApiData, parseJson } from '../api'
import { useApp } from '../context/AppContext'
import {
  extractContentPagesFromApi,
  extractCoverFromBookApi,
} from '../utils/bookAssetParse'
import {
  consumeOptimisticMatchingServer,
  fingerprintFromPendingPayload,
  longestSyncedQueuePrefix,
  normalizeBaseName,
} from '../utils/contentInsertFingerprint'
import {
  isFileBinding,
  pickFirstPhotoFileName,
  sanitizeParameterPayload,
} from '../utils/templateParams'
import { proxiedSweetbookImageUrl } from '../utils/sweetbookAssetProxy'
import {
  pickLabel,
  pickTemplateUid,
  resolveTemplateDisplayName,
} from '../utils/sweetbookTemplateList'
import {
  firstTemplateThumbnailFromListRow,
  firstTemplateThumbnailUrlFromApiResponse,
} from '../utils/templateThumbnails'

type BookRow = Record<string, unknown>

function isBookRow(v: unknown): v is BookRow {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function unwrapBookRow(res: unknown): BookRow | null {
  if (!isBookRow(res)) return null
  if (isBookRow(res.data)) return res.data as BookRow
  return res as BookRow
}

function pickBookPageCount(book: BookRow | null): number | null {
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

/** 서버 스트립 + 로컬 삽입 기준 내지 슬롯 수(실제 행 우선, 없으면 placeholder 문구의 약 N페이지) */
function countContentSlotsFromSnapshots(
  items: ContentInsertedSnapshot[],
): number {
  let placeholder = 0
  let real = 0
  for (const it of items) {
    if (it.templateUid === '__server__') {
      const m = it.templateName.match(/약\s*(\d+)\s*페이지/)
      if (m) {
        const n = parseInt(m[1], 10)
        if (Number.isFinite(n)) placeholder = Math.max(placeholder, n)
      }
      continue
    }
    if (it.templateUid.startsWith('__')) continue
    real++
  }
  return real > 0 ? real : placeholder
}

function specNum(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

const BREAK_BEFORE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '기본값 (서버 기본)' },
  { value: 'page', label: '새 페이지 (page)' },
  { value: 'spread', label: '새 펼침면 (spread)' },
  { value: 'column', label: '새 단 (column)' },
]

/** 내지 삽입 대기열(POST 본문 재현용). sessionStorage v2 */
type PendingContentInsert = {
  id: string
  order: number
  templateUid: string
  templateName: string
  breakBefore: string
  parameters: Record<string, unknown>
  layoutThumbUrl: string | null
  photoFileName: string | null
  fingerprint: string
  createdAt: number
  attempts: number
  lastAttemptAt: number | null
}

export default function ContentsPage() {
  const nav = useNavigate()
  const {
    bookUid,
    bookSpecUid,
    contentTemplateUid,
    setContentTemplateUid,
    uploadedPhotoNames,
    uploadedPhotoPreviewByName,
    setUploadedPhotoNames,
    workflowStage,
    demoMode,
  } = useApp()
  const [templateUid, setTemplateUid] = useState(contentTemplateUid)
  useEffect(() => {
    if (contentTemplateUid) setTemplateUid(contentTemplateUid)
  }, [contentTemplateUid])

  const {
    fileNames: serverPhotoNames,
    urlByFileName: serverPhotoUrls,
    photoOriginalByName: serverPhotoOriginalByName,
    loading: serverPhotosLoading,
    err: serverPhotosErr,
  } = useBookServerPhotos(bookUid)

  /** 서버가 확장자를 바꿔도(예: .png→.jpg) 동일 사진으로 미리보기를 찾을 수 있게 매핑 보강 */
  const mergedPhotoPreviewByName = useMemo(() => {
    const baseToServerName: Record<string, string> = {}
    for (const fn of serverPhotoNames) {
      baseToServerName[normalizeBaseName(fn)] = fn
    }
    const out: Record<string, string> = { ...serverPhotoUrls, ...uploadedPhotoPreviewByName }
    for (const n of uploadedPhotoNames) {
      const base = normalizeBaseName(n)
      const sn = baseToServerName[base]
      if (sn && out[sn] && !out[n]) out[n] = out[sn]
    }
    return out
  }, [serverPhotoNames.join('\0'), serverPhotoUrls, uploadedPhotoPreviewByName, uploadedPhotoNames.join('\0')])

  const mergedPhotoOriginalByName = useMemo(() => {
    const baseToServerName: Record<string, string> = {}
    for (const fn of serverPhotoNames) {
      baseToServerName[normalizeBaseName(fn)] = fn
    }
    const out: Record<string, string> = { ...serverPhotoOriginalByName }
    for (const n of uploadedPhotoNames) {
      const base = normalizeBaseName(n)
      const sn = baseToServerName[base]
      if (sn && out[sn] && !out[n]) out[n] = out[sn]
    }
    return out
  }, [serverPhotoNames.join('\0'), serverPhotoOriginalByName, uploadedPhotoNames.join('\0')])

  const photoFallbackByName = useMemo(() => {
    // 파일명 바이너리 프록시 폴백을 사용하지 않음
    return {}
  }, [])

  const serverNamesKey = serverPhotoNames.join('\0')
  useEffect(() => {
    if (!bookUid || !serverPhotoNames.length) return
    setUploadedPhotoNames((prev) => {
      const next = [...prev]
      let changed = false
      for (const n of serverPhotoNames) {
        if (!next.includes(n)) {
          next.push(n)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [bookUid, serverNamesKey, setUploadedPhotoNames])

  const {
    parsed,
    loading: tplLoading,
    fetchErr: tplErr,
    paramValues,
    setParamValues,
  } = useSweetbookTemplateParameters(templateUid)

  const { templates: contentTemplates, templatesLoading, templatesErr } =
    useTemplatesForBookSpec(bookSpecUid, 'content')

  const selectedContentListThumbUrl = useMemo(() => {
    const uid = templateUid.trim()
    if (!uid) return null
    const row = contentTemplates.find((t) => pickTemplateUid(t) === uid)
    return row ? firstTemplateThumbnailFromListRow(row) : null
  }, [contentTemplates, templateUid])

  const contentTemplateUidSet = useMemo(
    () =>
      new Set(
        contentTemplates
          .map((t) => pickTemplateUid(t))
          .filter((u) => u.length > 0),
      ),
    [contentTemplates],
  )
  const orphanContentTemplateSelect =
    Boolean(templateUid.trim()) &&
    !contentTemplateUidSet.has(templateUid.trim())

  const uploadsKey = uploadedPhotoNames.join('\0')
  useEffect(() => {
    if (tplLoading || !parsed?.fields.length || !uploadedPhotoNames.length) return
    const first = uploadedPhotoNames[0]
    setParamValues((prev) => {
      let changed = false
      const next = { ...prev }
      for (const f of parsed.fields) {
        if (!isFileBinding(f) || !f.required) continue
        const cur = next[f.key]
        if (cur === '' || cur === undefined || cur === null) {
          next[f.key] = first
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [tplLoading, parsed?.templateUid, uploadsKey, parsed?.fields.length, setParamValues])

  const [breakBefore, setBreakBefore] = useState<string>('')
  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  /** 서버로 순차 전송할 내지 삽입 대기열 */
  const [pendingQueue, setPendingQueue] = useState<PendingContentInsert[]>([])
  /** 전송 오류 시 true — 재개 전까지 순차 전송 중단 */
  const [queuePaused, setQueuePaused] = useState(false)

  const [serverSnapshots, setServerSnapshots] = useState<
    ContentInsertedSnapshot[]
  >([])
  const [serverStripLoading, setServerStripLoading] = useState(false)
  /** GET 내지 응답에 썸네일 URL이 없을 때 템플릿 상세로 1회 보강 시도한 templateUid */
  const layoutThumbHydrateTried = useRef(new Set<string>())

  const [finalizeErr, setFinalizeErr] = useState<string | null>(null)
  const [finalizeOk, setFinalizeOk] = useState<string | null>(null)
  const [finalizeLoading, setFinalizeLoading] = useState(false)
  const [bookInfoLoading, setBookInfoLoading] = useState(false)
  const [bookInfo, setBookInfo] = useState<{
    pages: number | null
    pageMin: number | undefined
    coverStatus: 'yes' | 'no' | 'unknown'
    title: string
  } | null>(null)
  const [contentRefreshTick, setContentRefreshTick] = useState(0)
  // bookInfoRefreshTick: 주기적 폴링 제거로 더 이상 사용하지 않음
  const [postSuccessCount, setPostSuccessCount] = useState(0)
  const [postedStrip, setPostedStrip] = useState<ContentInsertedSnapshot[]>([])
  const [lastBookInfoLoadedAt, setLastBookInfoLoadedAt] = useState(0)
  /** POST 성공 후 GET이 아직 새 행을 안 돌려줄 때까지 유지하는 미리보기 카드 */
  const [optimisticServerStrip, setOptimisticServerStrip] = useState<
    ContentInsertedSnapshot[]
  >([])
  const serverRealRowCountRef = useRef(0)
  // awaitingConfirm: GET /contents가 비어오는 환경에서 큐가 멈추는 원인이 되어 제거

  const queueStorageKey = bookUid
    ? `photobook_content_queue_v2_${bookUid}`
    : null

  const postedStorageKey = bookUid
    ? `photobook_content_posted_v1_${bookUid}`
    : null

  const persistPosted = (next: ContentInsertedSnapshot[]) => {
    if (!postedStorageKey) return
    try {
      sessionStorage.setItem(postedStorageKey, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }

  const postedCountStorageKey = bookUid
    ? `photobook_content_post_success_count_v1_${bookUid}`
    : null

  const persistQueue = (next: PendingContentInsert[]) => {
    if (!queueStorageKey) return
    try {
      sessionStorage.setItem(queueStorageKey, JSON.stringify(next))
    } catch {
      /* 용량 등 */
    }
  }

  useEffect(() => {
    if (!postedStorageKey) {
      setPostedStrip([])
      return
    }
    try {
      const raw = sessionStorage.getItem(postedStorageKey)
      if (!raw) {
        setPostedStrip([])
        return
      }
      const arr = JSON.parse(raw) as unknown
      if (!Array.isArray(arr)) {
        setPostedStrip([])
        return
      }
      const next: ContentInsertedSnapshot[] = []
      for (const row of arr) {
        if (!row || typeof row !== 'object') continue
        const o = row as Record<string, unknown>
        const id = typeof o.id === 'string' ? o.id : ''
        const order = typeof o.order === 'number' ? o.order : 0
        const templateUid =
          typeof o.templateUid === 'string' ? o.templateUid : ''
        const templateName =
          typeof o.templateName === 'string' ? o.templateName : '내지'
        const layoutThumbUrl =
          typeof o.layoutThumbUrl === 'string' || o.layoutThumbUrl === null
            ? (o.layoutThumbUrl as string | null)
            : null
        const photoFileName =
          typeof o.photoFileName === 'string' || o.photoFileName === null
            ? (o.photoFileName as string | null)
            : null
        if (id && templateUid) {
          next.push({
            id,
            order,
            templateUid,
            templateName,
            layoutThumbUrl,
            photoFileName,
            contentSyncStatus: 'server',
          })
        }
      }
      setPostedStrip(next)
    } catch {
      setPostedStrip([])
    }
  }, [postedStorageKey])

  useEffect(() => {
    if (!postedCountStorageKey) {
      setPostSuccessCount(0)
      return
    }
    const raw = sessionStorage.getItem(postedCountStorageKey)
    const n = raw ? Number(raw) : 0
    setPostSuccessCount(Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)
  }, [postedCountStorageKey])

  useEffect(() => {
    if (!queueStorageKey) {
      setPendingQueue([])
      return
    }
    try {
      const raw = sessionStorage.getItem(queueStorageKey)
      if (!raw) {
        try {
          sessionStorage.removeItem(
            `photobook_content_inserted_v1_${bookUid ?? ''}`,
          )
        } catch {
          /* ignore */
        }
        setPendingQueue([])
        return
      }
      const arr = JSON.parse(raw) as unknown
      if (!Array.isArray(arr)) {
        setPendingQueue([])
        return
      }
      const next: PendingContentInsert[] = []
      for (const row of arr) {
        if (!row || typeof row !== 'object') continue
        const o = row as Record<string, unknown>
        const id = typeof o.id === 'string' ? o.id : ''
        const order = typeof o.order === 'number' ? o.order : 0
        const templateUid =
          typeof o.templateUid === 'string' ? o.templateUid : ''
        const templateName =
          typeof o.templateName === 'string' ? o.templateName : '내지'
        const breakBefore =
          typeof o.breakBefore === 'string' ? o.breakBefore : ''
        const parameters =
          o.parameters && typeof o.parameters === 'object' && !Array.isArray(o.parameters)
            ? (o.parameters as Record<string, unknown>)
            : {}
        const layoutThumbUrl =
          typeof o.layoutThumbUrl === 'string' || o.layoutThumbUrl === null
            ? (o.layoutThumbUrl as string | null)
            : null
        const photoFileName =
          typeof o.photoFileName === 'string' || o.photoFileName === null
            ? (o.photoFileName as string | null)
            : null
        const fingerprint =
          typeof o.fingerprint === 'string' ? o.fingerprint : ''
        const createdAt =
          typeof o.createdAt === 'number' && Number.isFinite(o.createdAt)
            ? o.createdAt
            : Date.now()
        const attempts =
          typeof o.attempts === 'number' && Number.isFinite(o.attempts)
            ? Math.max(0, Math.floor(o.attempts))
            : 0
        const lastAttemptAt =
          typeof o.lastAttemptAt === 'number' && Number.isFinite(o.lastAttemptAt)
            ? o.lastAttemptAt
            : null
        if (id && templateUid && fingerprint) {
          next.push({
            id,
            order,
            templateUid,
            templateName,
            breakBefore,
            parameters,
            layoutThumbUrl,
            photoFileName,
            fingerprint,
            createdAt,
            attempts,
            lastAttemptAt,
          })
        }
      }
      setPendingQueue(next)
    } catch {
      setPendingQueue([])
    }
  }, [queueStorageKey, bookUid])

  useEffect(() => {
    if (!bookUid) {
      setServerSnapshots([])
      return
    }
    if (demoMode) {
      setServerSnapshots([])
      setServerStripLoading(false)
      return
    }
    let cancel = false
    setServerStripLoading(true)
    ;(async () => {
      try {
        const res = await fetch(
          `/api/books/${encodeURIComponent(bookUid)}/contents`,
        )
        const data = await parseJson(res)
        if (cancel) return
        if (res.ok) {
          let snaps = extractContentPagesFromApi(data)
          // snaps가 비어도 별도의 /books GET으로 폴백하지 않음 (내지 삽입 시 book GET이 2번 나가던 원인)
          setServerSnapshots(snaps)
          return
        }
        setServerSnapshots([])
      } catch {
        if (!cancel) setServerSnapshots([])
      } finally {
        if (!cancel) setServerStripLoading(false)
      }
    })()
    return () => {
      cancel = true
    }
  }, [bookUid, contentRefreshTick, demoMode])

  useEffect(() => {
    serverRealRowCountRef.current = serverSnapshots.filter(
      (s) => s.templateUid !== '__server__' && !s.templateUid.startsWith('__'),
    ).length
  }, [serverSnapshots])

  /** GET에 동일 내지가 잡히면 낙관적 카드 제거(실제 서버 행만 남김) */
  useEffect(() => {
    setOptimisticServerStrip((prev) =>
      consumeOptimisticMatchingServer(serverSnapshots, prev),
    )
  }, [serverSnapshots])

  /** GET 내지와 대기열 지문을 맞춰, 이미 서버에 반영된 항목을 큐에서 제거 */
  useEffect(() => {
    setPendingQueue((q) => {
      if (q.length === 0) return q
      const fps = q.map((x) => x.fingerprint)
      const k = longestSyncedQueuePrefix(serverSnapshots, fps)
      if (k <= 0) return q
      const next = q.slice(k)
      if (queueStorageKey) {
        try {
          sessionStorage.setItem(queueStorageKey, JSON.stringify(next))
        } catch {
          /* ignore */
        }
      }
      return next
    })
  }, [serverSnapshots, queueStorageKey])

  useEffect(() => {
    layoutThumbHydrateTried.current = new Set()
  }, [bookUid])

  useEffect(() => {
    setQueuePaused(false)
  }, [bookUid])

  useEffect(() => {
    setOptimisticServerStrip([])
  }, [bookUid])

  useEffect(() => {
    setPostedStrip([])
    setPostSuccessCount(0)
  }, [bookUid])

  useEffect(() => {
    if (pendingQueue.length === 0) setQueuePaused(false)
  }, [pendingQueue.length])

  // queueBaselineServerCount 제거

  // 주기적 조회(폴링)는 제거 (사용자가 원치 않음)

  // awaitingConfirm 제거

  useEffect(() => {
    if (!bookUid || serverSnapshots.length === 0) return
    const uids: string[] = []
    for (const s of serverSnapshots) {
      if (s.templateUid === '__server__') continue
      if (s.templateUid.startsWith('__')) continue
      if (s.layoutThumbUrl?.trim()) continue
      if (layoutThumbHydrateTried.current.has(s.templateUid)) continue
      uids.push(s.templateUid)
    }
    const unique = [...new Set(uids)]
    if (!unique.length) return
    for (const u of unique) layoutThumbHydrateTried.current.add(u)

    let cancel = false
    ;(async () => {
      const resolved: Record<string, string> = {}
      await Promise.all(
        unique.map(async (uid) => {
          try {
            const tplRes = await apiGet(
              `/templates/${encodeURIComponent(uid)}`,
            )
            const url = firstTemplateThumbnailUrlFromApiResponse(tplRes)
            if (url?.trim()) resolved[uid] = url.trim()
          } catch {
            /* ignore */
          }
        }),
      )
      if (cancel || Object.keys(resolved).length === 0) return
      setServerSnapshots((prev) =>
        prev.map((s) => {
          if (s.layoutThumbUrl?.trim()) return s
          const u = resolved[s.templateUid]
          return u ? { ...s, layoutThumbUrl: u } : s
        }),
      )
    })()
    return () => {
      cancel = true
    }
  }, [bookUid, serverSnapshots])

  /** 대기열 레이아웃 썸네일이 비었으면 템플릿 상세로 보강 */
  useEffect(() => {
    if (!bookUid || pendingQueue.length === 0) return
    const missing = pendingQueue
      .filter((p) => !p.layoutThumbUrl?.trim())
      .map((p) => p.templateUid)
      .filter((u) => u.trim().length > 0)
    const unique = [...new Set(missing)]
    if (unique.length === 0) return
    let cancel = false
    ;(async () => {
      const resolved: Record<string, string> = {}
      await Promise.all(
        unique.map(async (uid) => {
          try {
            const tplRes = await apiGet(`/templates/${encodeURIComponent(uid)}`)
            const url = firstTemplateThumbnailUrlFromApiResponse(tplRes)
            if (url?.trim()) resolved[uid] = url.trim()
          } catch {
            /* ignore */
          }
        }),
      )
      if (cancel || Object.keys(resolved).length === 0) return
      setPendingQueue((q) => {
        const next = q.map((p) => {
          if (p.layoutThumbUrl?.trim()) return p
          const u = resolved[p.templateUid]
          return u ? { ...p, layoutThumbUrl: u } : p
        })
        persistQueue(next)
        return next
      })
    })()
    return () => {
      cancel = true
    }
  }, [bookUid, pendingQueue.length])

  useEffect(() => {
    if (!bookUid) {
      setBookInfo(null)
      return
    }
    let cancel = false
    ;(async () => {
      setBookInfoLoading(true)
      try {
        const br = await apiGet(`/books/${encodeURIComponent(bookUid)}`)
        const book = unwrapBookRow(br)
        const specUid = book
          ? String(book.bookSpecUid ?? book.bookSpecUID ?? '').trim()
          : ''
        let pageMin: number | undefined
        if (specUid) {
          try {
            const sr = await apiGet(`/book-specs/${encodeURIComponent(specUid)}`)
            const sd = unwrapBookRow(sr)
            if (sd) pageMin = specNum(sd.pageMin)
          } catch {
            /* ignore */
          }
        }
        const coverRes = await fetch(
          `/api/books/${encodeURIComponent(bookUid)}/cover`,
        )
        const coverJson = coverRes.ok ? await parseJson(coverRes) : null
        let coverStatus: 'yes' | 'no' | 'unknown' = 'unknown'
        if (coverRes.ok && coverJson) {
          const cov = extractCoverFromBookApi(coverJson)
          if (cov && (cov.templateUid.trim() || cov.previewUrls.length > 0)) {
            coverStatus = 'yes'
          } else {
            const raw = coverJson as Record<string, unknown>
            const d = raw.data
            const empty =
              d == null ||
              (typeof d === 'object' &&
                !Array.isArray(d) &&
                Object.keys(d as object).length === 0)
            coverStatus = empty ? 'unknown' : 'no'
          }
        } else if (coverRes.status === 404) {
          coverStatus = 'no'
        }
        const pages = pickBookPageCount(book)
        const title = book && typeof book.title === 'string' ? book.title : ''
        if (!cancel) {
          setBookInfo({ pages, pageMin, coverStatus, title })
          setLastBookInfoLoadedAt(Date.now())
        }
      } catch {
        if (!cancel) setBookInfo(null)
      } finally {
        if (!cancel) setBookInfoLoading(false)
      }
    })()
    return () => {
      cancel = true
    }
  }, [bookUid, contentRefreshTick])

  // 서버 반영 판정은 POST /contents success 누적 개수(postSuccessCount)로만 처리

  const mergedInsertedStrip = useMemo(() => {
    const seen = new Set<string>()
    const out: ContentInsertedSnapshot[] = []
    for (const it of serverSnapshots) {
      if (it.templateUid.startsWith('__') && it.templateUid !== '__server__') continue
      if (seen.has(it.id)) continue
      seen.add(it.id)
      out.push({ ...it, contentSyncStatus: 'server' })
    }
    for (const it of postedStrip) {
      if (seen.has(it.id)) continue
      seen.add(it.id)
      out.push({ ...it, contentSyncStatus: 'server' })
    }
    for (const it of optimisticServerStrip) {
      if (seen.has(it.id)) continue
      seen.add(it.id)
      out.push(it)
    }
    const serverRealCount = serverSnapshots.filter(
      (s) => s.templateUid !== '__server__' && !s.templateUid.startsWith('__'),
    ).length
    const tailBase =
      serverRealCount + postedStrip.length + optimisticServerStrip.length
    for (let i = 0; i < pendingQueue.length; i++) {
      const p = pendingQueue[i]
      if (seen.has(p.id)) continue
      seen.add(p.id)
      const isConfirmed = i < postSuccessCount
      const isStuck =
        !isConfirmed &&
        p.attempts > 0 &&
        p.lastAttemptAt != null &&
        lastBookInfoLoadedAt > 0 &&
        Date.now() - p.lastAttemptAt > 20_000 &&
        Date.now() - lastBookInfoLoadedAt > 9_000
      out.push({
        id: p.id,
        order: tailBase + i + 1,
        templateUid: p.templateUid,
        templateName: p.templateName,
        layoutThumbUrl: p.layoutThumbUrl,
        photoFileName: p.photoFileName,
        contentSyncStatus: isConfirmed ? 'server' : isStuck ? 'error' : 'pending',
      })
    }
    return out.sort((a, b) => a.order - b.order)
  }, [serverSnapshots, postedStrip, pendingQueue, optimisticServerStrip, postSuccessCount, lastBookInfoLoadedAt])

  /** 아래 삽입 스트립(서버+로컬) 행 수 — UI 목록용 */
  const mergedStripCount = useMemo(
    () => countContentSlotsFromSnapshots(mergedInsertedStrip),
    [mergedInsertedStrip],
  )

  /** 서버 전송 대기 중인 내지 건수 */
  const pendingCount = pendingQueue.length

  /** GET /contents 정규화 결과만(최종화 시 Sweetbook이 보는 내지와 가장 가깝게 맞춤) */
  const serverKnownCount = useMemo(
    () =>
      countContentSlotsFromSnapshots(
        serverSnapshots.filter(
          (s) =>
            s.templateUid !== '__server__' && !s.templateUid.startsWith('__'),
        ),
      ),
    [serverSnapshots],
  )

  const serverPlaceholderCount = useMemo(() => {
    const ph = serverSnapshots.find((s) => s.templateUid === '__server__')
    if (!ph) return undefined
    const m = ph.templateName.match(/약\s*(\d+)\s*페이지/)
    if (!m) return undefined
    const n = parseInt(m[1], 10)
    return Number.isFinite(n) && n > 0 ? n : undefined
  }, [serverSnapshots])

  /**
   * 최종화·최소 페이지 판단용. 로컬 삽입 기록만 많고 서버/책 메타는 적은 경우
   * Math.max(api, local)로 부풀리면 안 됨(세션에만 남은 행 때문일 수 있음).
   */
  const displayPageCount = useMemo(() => {
    if (!bookInfo) return null
    const api = bookInfo.pages != null && bookInfo.pages > 0 ? bookInfo.pages : 0
    const localEst = mergedStripCount

    if (serverKnownCount > 0) {
      return Math.max(serverKnownCount, api)
    }

    if (api > 0 && localEst > api) {
      return api
    }

    if (localEst > 0) return localEst
    if (serverPlaceholderCount != null && serverPlaceholderCount > 0) {
      return Math.max(api, serverPlaceholderCount)
    }
    return api > 0 ? api : null
  }, [
    bookInfo,
    serverKnownCount,
    mergedStripCount,
    serverPlaceholderCount,
  ])

  /** 대기열이 남아 있으면 최종화 전에 전송 완료 필요 */
  const hasPendingQueue = pendingCount > 0

  const displayCoverStatus = useMemo((): 'yes' | 'no' | 'unknown' => {
    if (!bookInfo) return 'unknown'
    if (bookInfo.coverStatus === 'yes' || bookInfo.coverStatus === 'no') {
      return bookInfo.coverStatus
    }
    if ((workflowStage ?? 0) >= 3) return 'yes'
    return 'unknown'
  }, [bookInfo, workflowStage])

  const shortOnPages =
    bookInfo?.pageMin != null &&
    displayPageCount != null &&
    displayPageCount < bookInfo.pageMin

  useEffect(() => {
    const first = serverSnapshots.find(
      (s) => s.templateUid && !s.templateUid.startsWith('__'),
    )
    if (!first) return
    if (!contentTemplateUid) {
      setContentTemplateUid(first.templateUid)
      setTemplateUid(first.templateUid)
    }
  }, [serverSnapshots, contentTemplateUid, setContentTemplateUid])

  /** 대기열 맨 앞 1건을 서버에 POST — 성공 시 큐에서 제거 후 GET 갱신 */
  useEffect(() => {
    if (!bookUid || queuePaused || pendingQueue.length === 0) return
    const item = pendingQueue[0]
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setErr(null)
      try {
        if (demoMode) {
          // 데모: 실제 서버 전송 없이 로컬에서 "반영 완료" 처리
          setPostSuccessCount((n) => {
            const next = n + 1
            if (postedCountStorageKey) {
              try {
                sessionStorage.setItem(postedCountStorageKey, String(next))
              } catch {
                /* ignore */
              }
            }
            return next
          })
          setPendingQueue((q) => {
            const next = q.slice(1)
            persistQueue(next)
            return next
          })
          setPostedStrip((prev) => {
            const order = serverRealRowCountRef.current + prev.length + 1
            const card: ContentInsertedSnapshot = {
              id: `posted-${item.id}`,
              order,
              templateUid: item.templateUid,
              templateName: item.templateName,
              layoutThumbUrl: item.layoutThumbUrl,
              photoFileName: item.photoFileName,
              contentSyncStatus: 'server',
            }
            const next = [...prev, card]
            persistPosted(next)
            return next
          })
          setOk('데모: 내지 1건을 반영했습니다.')
          setContentRefreshTick((t) => t + 1)
          return
        }
        setPendingQueue((q) => {
          if (q.length === 0) return q
          const head = q[0]
          const next = [
            {
              ...head,
              attempts: (head.attempts ?? 0) + 1,
              lastAttemptAt: Date.now(),
            },
            ...q.slice(1),
          ]
          persistQueue(next)
          return next
        })
        const fd = new FormData()
        fd.append('templateUid', item.templateUid)
        fd.append('parameters', JSON.stringify(item.parameters))
        if (item.breakBefore) fd.append('breakBefore', item.breakBefore)
        const res = await fetch(
          `/api/books/${encodeURIComponent(bookUid)}/contents`,
          {
            method: 'POST',
            body: fd,
          },
        )
        const data = await parseJson(res)
        if (cancelled) return
        if (!res.ok) {
          throw new Error(
            errorMessageFromApiData(
              data as Record<string, unknown>,
              res.statusText,
            ),
          )
        }
        setPostSuccessCount((n) => {
          const next = n + 1
          if (postedCountStorageKey) {
            try {
              sessionStorage.setItem(postedCountStorageKey, String(next))
            } catch {
              /* ignore */
            }
          }
          return next
        })
        setPendingQueue((q) => {
          const next = q.slice(1)
          persistQueue(next)
          return next
        })
        setPostedStrip((prev) => {
          const order = serverRealRowCountRef.current + prev.length + 1
          const card: ContentInsertedSnapshot = {
            id: `posted-${item.id}`,
            order,
            templateUid: item.templateUid,
            templateName: item.templateName,
            layoutThumbUrl: item.layoutThumbUrl,
            photoFileName: item.photoFileName,
            contentSyncStatus: 'server',
          }
          const next = [...prev, card]
          persistPosted(next)
          return next
        })
        setContentRefreshTick((t) => t + 1)
        setOk('내지 1건을 서버에 반영했습니다.')
      } catch (e) {
        if (!cancelled) {
          setQueuePaused(true)
          setErr(e instanceof Error ? e.message : String(e))
          setContentRefreshTick((t) => t + 1)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bookUid, queuePaused, pendingQueue[0]?.id, demoMode])

  // 주기적 조회(폴링)는 제거 (사용자가 원치 않음)

  const submit = () => {
    if (!bookUid) return
    setErr(null)
    setOk(null)
    if (!templateUid.trim()) {
      setErr('내지 템플릿을 선택하세요.')
      return
    }
    const parameters = sanitizeParameterPayload(
      paramValues,
      parsed?.fields ?? [],
    ) as Record<string, unknown>
    const vals = paramValues as Record<string, unknown>
    const fields = parsed?.fields ?? []
    const fp = fingerprintFromPendingPayload(templateUid.trim(), vals, fields)
    const photoFile = pickFirstPhotoFileName(vals, fields)
    const tplName = (parsed?.templateName ?? '').trim() || '내지'
    void (async () => {
      let layoutUrl: string | null = null
      try {
        const tplRes = await apiGet(
          `/templates/${encodeURIComponent(templateUid.trim())}`,
        )
        layoutUrl = firstTemplateThumbnailUrlFromApiResponse(tplRes)
      } catch {
        /* 썸네일 없음 */
      }
      const item: PendingContentInsert = {
        id: crypto.randomUUID(),
        order: Date.now(),
        templateUid: templateUid.trim(),
        templateName: tplName,
        breakBefore: breakBefore.trim(),
        parameters,
        layoutThumbUrl: layoutUrl,
        photoFileName: photoFile,
        fingerprint: fp,
        createdAt: Date.now(),
        attempts: 0,
        lastAttemptAt: null,
      }
      setPendingQueue((prev) => {
        const next = [...prev, item]
        persistQueue(next)
        return next
      })
      setQueuePaused(false)
      setContentRefreshTick((t) => t + 1)
      setOk(
        '대기열에 추가했습니다. 위에서부터 순서대로 서버에 반영합니다.',
      )
    })()
  }

  const runFinalize = async () => {
    if (!bookUid) return
    setFinalizeLoading(true)
    setFinalizeErr(null)
    setFinalizeOk(null)
    try {
      await apiPostEmpty(`/books/${encodeURIComponent(bookUid)}/finalization`)
      setFinalizeOk('최종화가 완료되었습니다. 주문 페이지로 이동합니다.')
      window.setTimeout(() => {
        nav('/order')
      }, 500)
    } catch (e) {
      setFinalizeErr(e instanceof Error ? e.message : String(e))
    } finally {
      setFinalizeLoading(false)
    }
  }

  const alerts = (
    <>
      {!bookUid && <div className="banner error">bookUid 없음</div>}
      {!bookSpecUid && (
        <div className="banner warn">
          판형(bookSpec)이 없습니다.{' '}
          <Link to="/book/setup">설정</Link>에서 판형을 고르고 책을 생성하세요.
        </div>
      )}
      {err && <div className="banner error">{err}</div>}
      {ok && <div className="banner ok">{ok}</div>}
      {!demoMode && templatesErr && (
        <div className="banner error">템플릿 목록: {templatesErr}</div>
      )}
      {!demoMode && tplErr && <div className="banner error">템플릿 로드: {tplErr}</div>}
      {serverStripLoading && (
        <p className="muted small" style={{ margin: 0 }}>
          서버에 적용된 내지 목록을 불러오는 중…
        </p>
      )}
      {!demoMode && serverPhotosErr && (
        <div className="banner warn small">책 사진 목록: {serverPhotosErr}</div>
      )}
      {!demoMode && queuePaused && pendingQueue.length > 0 && (
        <div className="banner warn small" style={{ marginTop: '0.35rem' }}>
          내지 서버 전송이 일시정지되었습니다. 아래를 눌러 같은 순서로 다시 시도하세요.
          <div style={{ marginTop: '0.5rem' }}>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setQueuePaused(false)
                setErr(null)
              }}
            >
              전송 재개
            </button>
          </div>
        </div>
      )}
      {hasPendingQueue && !queuePaused && loading && (
        <p className="muted small" style={{ margin: '0.35rem 0 0' }}>
          서버에 내지 반영 중… (대기 {pendingCount}건)
        </p>
      )}
    </>
  )

  const left = (
    <>
      <p className="book-editor-rail-note">
        판형은 <Link to="/book/setup">설정</Link>에서 선택합니다.
      </p>
      <label className="small" style={{ display: 'block', marginBottom: '0.25rem' }}>
        내지 템플릿
      </label>
      {!bookSpecUid ? (
        <p className="muted small">판형을 먼저 지정하세요.</p>
      ) : templatesLoading ? (
        <p className="muted small">목록 불러오는 중…</p>
      ) : (
        <select
          className="input"
          value={templateUid}
          disabled={!bookSpecUid}
          onChange={(e) => {
            const v = e.target.value
            setTemplateUid(v)
            setContentTemplateUid(v)
          }}
        >
          <option value="">선택…</option>
          {orphanContentTemplateSelect ? (
            <option value={templateUid.trim()}>
              {resolveTemplateDisplayName(
                templateUid.trim(),
                contentTemplates,
                parsed,
              )}
            </option>
          ) : null}
          {contentTemplates.map((t) => {
            const uid = pickTemplateUid(t)
            if (!uid) return null
            return (
              <option key={uid} value={uid}>
                {pickLabel(t)}
              </option>
            )
          })}
        </select>
      )}
      {selectedContentListThumbUrl ? (
        <div className="template-select-layout-preview">
          <p className="muted small template-select-layout-preview-label">
            템플릿 레이아웃 (목록 thumbnails.layout)
          </p>
          <img
            src={proxiedSweetbookImageUrl(selectedContentListThumbUrl)}
            alt=""
            className="template-select-layout-preview-img"
          />
        </div>
      ) : null}
      {bookSpecUid && !templatesLoading && contentTemplates.length === 0 && (
        <p className="muted small">이 판형에 내지 템플릿이 없습니다.</p>
      )}
      <p
        className="small muted"
        style={{ marginTop: '1rem', marginBottom: '0.35rem' }}
      >
        업로드 사진 (파일명)
      </p>
      {serverPhotosLoading && uploadedPhotoNames.length === 0 ? (
        <p className="muted small">사진 목록을 불러오는 중…</p>
      ) : uploadedPhotoNames.length === 0 ? (
        <p className="muted small">사진 업로드 후 사용할 수 있습니다.</p>
      ) : (
        <ul className="uploaded-ref-strip-list book-editor-assets-list">
          {uploadedPhotoNames.map((n) => (
            <li key={n} className="uploaded-ref-strip-item">
              <UploadedPhotoThumb
                fileName={n}
                photoPreviewByName={mergedPhotoPreviewByName}
                photoOriginalByName={mergedPhotoOriginalByName}
                photoFallbackByName={photoFallbackByName}
                size="sm"
              />
              <span className="uploaded-ref-strip-name mono">{n}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )

  const serverPageSummary = serverSnapshots.find(
    (s) => s.templateUid === '__server__',
  )

  const canvas = (
    <div className="book-editor-canvas-stack">
      {serverPageSummary ? (
        <div className="book-applied-asset-preview">
          <p className="muted small" style={{ margin: 0 }}>
            <strong>{serverPageSummary.templateName}</strong>
            <br />
            현재는 페이지 수만 표시합니다.
          </p>
        </div>
      ) : null}
      {templateUid.trim() ? (
        <TemplatePreviewBlock
          templateUid={templateUid}
          heading="미리보기"
          variant="editorCanvas"
        />
      ) : !serverPageSummary ? (
        <div className="book-editor-canvas-placeholder">
          왼쪽에서 내지 템플릿을 선택하면
          <br />
          여기에 미리보기가 표시됩니다.
        </div>
      ) : null}
    </div>
  )

  const right = (
    <>
      {parsed && (
        <p className="muted small" style={{ marginTop: 0 }}>
          선택한 템플릿:{' '}
          <strong>{parsed.templateName?.trim() || '이름 없음'}</strong>
          {parsed.fields.length > 0 ? (
            <>
              <br />
              오른쪽 입력란은 {parsed.fields.length}개입니다.
            </>
          ) : null}
        </p>
      )}
      {tplLoading && <p className="muted small">템플릿 정보를 불러오는 중…</p>}

      <label className="small" style={{ display: 'block', marginTop: '0.65rem' }}>
        새 페이지가 어디서 끊길지 (선택)
      </label>
      <p className="muted small" style={{ margin: '0.2rem 0 0.35rem' }}>
        미리보기에 맞는 값만 고를 수 있습니다. 보통은 기본값을 두고, 페이지나
        펼침면·단을 나누고 싶을 때만 바꿉니다.
      </p>
      <select
        className="input"
        value={breakBefore}
        onChange={(e) => setBreakBefore(e.target.value)}
      >
        {BREAK_BEFORE_OPTIONS.map((o) => (
          <option key={o.value || 'default'} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <div style={{ marginTop: '0.65rem' }}>
        <TemplateParameterForm
          fields={parsed?.fields ?? []}
          values={paramValues}
          onChange={setParamValues}
          uploadedPhotoNames={uploadedPhotoNames}
          photoPreviewByName={mergedPhotoPreviewByName}
          photoOriginalByName={mergedPhotoOriginalByName}
          photoFallbackByName={photoFallbackByName}
        />
      </div>

      <button
        type="button"
        className="btn primary"
        style={{ marginTop: '0.85rem', width: '100%' }}
        disabled={!bookUid}
        onClick={() => submit()}
      >
        {loading ? '서버 반영 중…' : '내지 삽입 (대기열에 추가)'}
      </button>
    </>
  )

  return (
    <BookEditorShell
      title="내지 편집"
      kind="content"
      alerts={alerts}
      left={left}
      canvas={canvas}
      right={right}
      belowGrid={
        <>
          {mergedInsertedStrip.length > 0 ? (
            <ContentInsertedStrip
              key={bookUid ?? 'no-book'}
              items={mergedInsertedStrip}
              photoPreviewByName={mergedPhotoPreviewByName}
              photoOriginalByName={mergedPhotoOriginalByName}
              photoFallbackByName={photoFallbackByName}
              onItemClick={(it) => {
                if (!it || it.contentSyncStatus !== 'error') return
                setPendingQueue((q) => {
                  const idx = q.findIndex((x) => x.id === it.id)
                  if (idx < 0) return q
                  const target = q[idx]
                  const next = [target, ...q.slice(0, idx), ...q.slice(idx + 1)]
                  persistQueue(next)
                  return next
                })
                setQueuePaused(false)
                setErr(null)
                setOk('미반영 항목을 맨 앞으로 옮겨 재시도합니다.')
                setContentRefreshTick((x) => x + 1)
              }}
            />
          ) : null}
          <section
            className="card content-finalize-section"
            style={{ marginTop: mergedInsertedStrip.length ? '1rem' : 0 }}
          >
            <h2 className="content-finalize-heading">책 최종화</h2>
            <p className="muted small" style={{ marginTop: '-0.25rem' }}>
              본문·표지를 모두 반영한 뒤 앨범을 인쇄 가능한 상태로 확정합니다.
            </p>
            {!bookUid && (
              <p className="muted small">설정에서 앨범을 먼저 만들거나 선택해 주세요.</p>
            )}
            {finalizeErr && (
              <div className="banner error small" style={{ marginTop: '0.5rem' }}>
                {finalizeErr}
              </div>
            )}
            {finalizeOk && (
              <div className="banner ok small" style={{ marginTop: '0.5rem' }}>
                {finalizeOk}
              </div>
            )}
            {bookUid && (
              <>
                <h3 className="small" style={{ margin: '0.75rem 0 0.35rem' }}>
                  현재 책 상태
                </h3>
                {bookInfoLoading ? (
                  <p className="muted small">불러오는 중…</p>
                ) : bookInfo ? (
                  <>
                    <ul
                      className="muted small"
                      style={{ margin: 0, lineHeight: 1.6, paddingLeft: '1.1rem' }}
                    >
                      <li>
                        표지:{' '}
                        {displayCoverStatus === 'yes' ? (
                          <>
                            <span className="ok-inline">있음</span>
                            {bookInfo.coverStatus === 'unknown' ? (
                              <span className="muted small">
                                {' '}
                                (이 앱에서 표지를 적용한 기록이 있습니다)
                              </span>
                            ) : null}
                          </>
                        ) : displayCoverStatus === 'no' ? (
                          <>
                            <span className="warn-inline">없음</span> —{' '}
                            <Link to="/cover">표지</Link>에서 먼저 적용하는 것이 안전합니다.
                          </>
                        ) : (
                          <span className="muted">
                            서버에서 표지를 확인하지 못했습니다.
                          </span>
                        )}
                      </li>
                      <li>
                        내지 페이지(최종화 기준):{' '}
                        {displayPageCount != null ? (
                          <>
                            <strong>{displayPageCount}p</strong>
                            {mergedStripCount > displayPageCount ? (
                              <span className="muted small">
                                {' '}
                                · 아래 목록에는 {mergedStripCount}p 분량이 보입니다.
                              </span>
                            ) : bookInfo.pages != null &&
                              bookInfo.pages > 0 &&
                              bookInfo.pages !== displayPageCount ? (
                              <span className="muted small">
                                {' '}
                                · 책 메타 {bookInfo.pages}p와 표시가 다를 수 있습니다.
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="muted">아래 목록에서 집계되지 않았습니다.</span>
                        )}
                        {bookInfo.pageMin != null
                          ? ` · 이 판형 최소 ${bookInfo.pageMin}p`
                          : ''}
                      </li>
                      {bookInfo.title ? <li>제목: {bookInfo.title}</li> : null}
                    </ul>
                    {displayCoverStatus === 'no' && (
                      <div className="banner warn small" style={{ marginTop: '0.5rem' }}>
                        표지가 없으면 최종화가 거절될 수 있습니다.
                      </div>
                    )}
                    {hasPendingQueue && (
                      <div className="banner warn small" style={{ marginTop: '0.5rem' }}>
                        서버로 보낼 내지가 {pendingCount}건 남았습니다. 모두 반영된 뒤
                        최종화할 수 있습니다.
                      </div>
                    )}
                    {shortOnPages && (
                      <div className="banner warn small" style={{ marginTop: '0.5rem' }}>
                        최종화 기준({displayPageCount}p)이 이 판형 최소({bookInfo.pageMin}p)보다
                        적습니다. 내지를 더 넣은 뒤 새로고침해 보세요. 펼침면(spread)은
                        서버에서 2페이지로 집계될 수 있습니다.
                      </div>
                    )}
                  </>
                ) : (
                  <p className="muted small">책 정보를 불러오지 못했습니다.</p>
                )}
                <button
                  type="button"
                  className="btn primary"
                  style={{ marginTop: '0.85rem' }}
                  disabled={
                    !bookUid ||
                    finalizeLoading ||
                    false
                  }
                  onClick={() => void runFinalize()}
                >
                  {finalizeLoading ? '처리 중…' : '최종화 실행'}
                </button>
              </>
            )}
          </section>
        </>
      }
      footer={
        <nav className="nav-footer">
          <Link to="/cover">← 표지</Link>
          <Link to="/order">주문 →</Link>
        </nav>
      }
    />
  )
}

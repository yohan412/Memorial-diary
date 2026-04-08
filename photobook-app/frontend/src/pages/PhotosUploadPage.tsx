import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { parseJson } from '../api'
import { useApp } from '../context/AppContext'
import { proxiedSweetbookImageUrl } from '../utils/sweetbookAssetProxy'

const PAGE_SIZE = 9

function pickThumbnailFromUploadResponse(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const root = data as Record<string, unknown>
  const d = root.data
  if (!d || typeof d !== 'object') return undefined
  const dd = d as Record<string, unknown>
  const direct = dd.thumbnailUrl ?? dd.thumbnailURL
  if (typeof direct === 'string' && /^https?:\/\//i.test(direct.trim())) {
    return direct.trim()
  }
  const photos = dd.photos
  if (!Array.isArray(photos)) return undefined
  for (const p of photos) {
    if (!p || typeof p !== 'object') continue
    const th = (p as { thumbnailUrl?: string }).thumbnailUrl
    if (typeof th === 'string' && /^https?:\/\//i.test(th.trim())) return th.trim()
  }
  return undefined
}

function pickOriginalFromUploadResponse(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const root = data as Record<string, unknown>
  const d = root.data
  if (!d || typeof d !== 'object') return undefined
  const dd = d as Record<string, unknown>
  const direct = dd.originalUrl ?? dd.originalURL ?? dd.sourceUrl
  if (typeof direct === 'string' && /^https?:\/\//i.test(direct.trim())) {
    return direct.trim()
  }
  const photos = dd.photos
  if (!Array.isArray(photos)) return undefined
  for (const p of photos) {
    if (!p || typeof p !== 'object') continue
    const orig = (p as { originalUrl?: string }).originalUrl
    if (typeof orig === 'string' && /^https?:\/\//i.test(orig.trim())) return orig.trim()
  }
  return undefined
}

function pickFileNameFromUploadResponse(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const root = data as Record<string, unknown>
  const d = root.data
  if (!d || typeof d !== 'object') return undefined
  const dd = d as Record<string, unknown>
  if (typeof dd.fileName === 'string' && dd.fileName.trim()) return dd.fileName.trim()
  const photos = dd.photos
  if (!Array.isArray(photos) || !photos[0] || typeof photos[0] !== 'object') {
    return undefined
  }
  const fn = (photos[0] as { fileName?: string }).fileName
  return typeof fn === 'string' && fn.trim() ? fn.trim() : undefined
}

async function postPhotos(
  bookUid: string,
  blob: Blob,
  filename: string,
): Promise<{ fileName?: string; thumbnailUrl?: string; originalUrl?: string }> {
  const fd = new FormData()
  fd.append('file', blob, filename)
  const res = await fetch(`/api/books/${bookUid}/photos`, {
    method: 'POST',
    body: fd,
  })
  const data = await parseJson(res)
  if (!res.ok) {
    throw new Error(data.message || res.statusText)
  }
  const fileName = pickFileNameFromUploadResponse(data)
  const thumbnailUrl = pickThumbnailFromUploadResponse(data)
  const originalUrl = pickOriginalFromUploadResponse(data)
  return { fileName, thumbnailUrl, originalUrl }
}

export default function PhotosUploadPage() {
  const nav = useNavigate()
  const {
    bookUid,
    colorItems,
    contentTemplateUid,
    setUploadedPhotoPreviewByName,
    applyMeta,
    demoMode,
  } = useApp()

  const [pick, setPick] = useState<Record<string, boolean>>({})
  const [previewPage, setPreviewPage] = useState(0)
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const done = useMemo(
    () => colorItems.filter((c) => c.resultBase64),
    [colorItems],
  )

  useEffect(() => {
    setPick((prev) => {
      const next: Record<string, boolean> = {}
      for (const d of done) {
        next[d.id] = d.id in prev ? prev[d.id]! : true
      }
      return next
    })
  }, [done])

  const selectedCount = useMemo(
    () => done.filter((d) => pick[d.id] !== false).length,
    [done, pick],
  )
  const totalPreviewPages = Math.max(1, Math.ceil(done.length / PAGE_SIZE))
  const slice = done.slice(
    previewPage * PAGE_SIZE,
    previewPage * PAGE_SIZE + PAGE_SIZE,
  )

  useEffect(() => {
    setPreviewPage((p) => Math.min(p, Math.max(0, totalPreviewPages - 1)))
  }, [totalPreviewPages])

  function togglePick(id: string) {
    setPick((p) => {
      const wasSelected = p[id] !== false
      return { ...p, [id]: !wasSelected }
    })
  }

  async function uploadAll() {
    if (!bookUid) return
    const toUpload = done.filter((d) => pick[d.id] !== false)
    if (!toUpload.length) {
      setErr('업로드할 사진을 한 장 이상 선택하세요.')
      return
    }
    if (demoMode) {
      // 데모: 실제 Sweetbook 업로드는 하지 않고, 로컬 상태만 채워 다음 단계로 이동
      const names: string[] = []
      const previews: Record<string, string> = {}
      for (let i = 0; i < toUpload.length; i++) {
        const it = toUpload[i]!
        const n = `demo-color-${String(i + 1).padStart(2, '0')}.png`
        names.push(n)
        const b64 = it.resultBase64
        previews[n] =
          b64 && (b64.startsWith('data:') || b64.startsWith('/'))
            ? b64
            : `data:image/png;base64,${b64 || ''}`
      }
      applyMeta((m) => ({
        ...m,
        uploadedPhotoNames: names,
        workflowStage: Math.max(m.workflowStage ?? 0, 2),
      }))
      setUploadedPhotoPreviewByName(previews)

      // 데모 내지 30p를 "서버 반영"처럼 초록 테두리로 구성
      const tpl = contentTemplateUid?.trim() || 'demo-content-1'
      const now = Date.now()
      const queueKey = `photobook_content_queue_v2_${bookUid}`
      const postedKey = `photobook_content_posted_v1_${bookUid}`
      const countKey = `photobook_content_post_success_count_v1_${bookUid}`
      const pickName = (idx: number) => names[idx % Math.max(1, names.length)] || null
      const posted = Array.from({ length: 30 }, (_, i) => {
        const photo = pickName(i)
        return {
          id: `demo-content-${i + 1}`,
          order: i,
          templateUid: tpl,
          templateName: 'DEMO 내지 템플릿',
          breakBefore: 'none',
          parameters: {
            title: `기억 ${i + 1}`,
            date: '2026-04-06',
            photoFileName: photo,
            photo: photo,
          },
          layoutThumbUrl: previews[photo ?? ''] || null,
          photoFileName: photo,
          fingerprint: `${tpl}|${photo ?? 'none'}|${i}`,
          createdAt: now,
          contentSyncStatus: 'server',
        }
      })
      try {
        sessionStorage.setItem(queueKey, JSON.stringify([]))
        sessionStorage.setItem(postedKey, JSON.stringify(posted))
        // 데모에서는 모든 항목을 "서버 반영"으로 취급(큐/대기 항목이 남아도 초록 표시)
        sessionStorage.setItem(countKey, JSON.stringify(9999))
      } catch {
        /* ignore */
      }

      nav('/cover')
      return
    }
    setRunning(true)
    setErr(null)
    const names: string[] = []
    const previews: Record<string, string> = {}
    try {
      for (const it of toUpload) {
        if (!it.resultBase64) continue
        const blob = await fetch(
          `data:image/png;base64,${it.resultBase64}`,
        ).then((r) => r.blob())
        const base = it.name.replace(/\.[^.]+$/, '') || 'photo'
        const { fileName, thumbnailUrl, originalUrl } = await postPhotos(
          bookUid,
          blob,
          `${base}-color.png`,
        )
        if (fileName) {
          names.push(fileName)
          previews[fileName] =
            (originalUrl && /^https?:\/\//i.test(originalUrl) && proxiedSweetbookImageUrl(originalUrl)) ||
            (thumbnailUrl && /^https?:\/\//i.test(thumbnailUrl) && proxiedSweetbookImageUrl(thumbnailUrl)) ||
            `data:image/png;base64,${it.resultBase64}`
        }
      }
      applyMeta((m) => ({
        ...m,
        uploadedPhotoNames: names,
        workflowStage:
          names.length > 0
            ? Math.max(m.workflowStage ?? 0, 2)
            : m.workflowStage,
      }))
      setUploadedPhotoPreviewByName(previews)
      if (names.length > 0) {
        nav('/cover')
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="page">
      <h1>사진 업로드</h1>
      <p className="muted">
        컬러화된 사진을 책에 올리면 표지·본문에서 선택해 쓸 수 있습니다.
      </p>
      {!bookUid && (
        <div className="banner error">
          앨범이 없습니다. 설정에서 앨범을 먼저 만들어 주세요.
        </div>
      )}
      {err && <div className="banner error">{err}</div>}

      {done.length > 0 && (
        <section className="card">
          <h2>컬러 결과 미리보기</h2>
          <p className="muted small" style={{ marginTop: '-0.5rem' }}>
            테두리가 강조된 사진은 <strong>업로드 대상</strong>입니다. 썸네일을 누르면
            제외·포함을 바꿀 수 있습니다.
          </p>
          <p className="small" style={{ marginBottom: '0.75rem' }}>
            선택 <strong>{selectedCount}</strong> / {done.length}장
          </p>
          {done.length >= 10 && (
            <div className="pager">
              <button
                type="button"
                className="btn"
                disabled={previewPage <= 0}
                onClick={() => setPreviewPage((p) => Math.max(0, p - 1))}
              >
                ←
              </button>
              <span>
                {previewPage + 1} / {totalPreviewPages}
              </span>
              <button
                type="button"
                className="btn"
                disabled={previewPage >= totalPreviewPages - 1}
                onClick={() =>
                  setPreviewPage((p) =>
                    Math.min(totalPreviewPages - 1, p + 1),
                  )
                }
              >
                →
              </button>
            </div>
          )}
          <div className="grid-3">
            {slice.map((it) => {
              const selected = pick[it.id] !== false
              return (
                <button
                  key={it.id}
                  type="button"
                  className={`upload-preview-cell grid-cell ${
                    selected ? 'selected' : 'excluded'
                  }`}
                  onClick={() => togglePick(it.id)}
                >
                  {it.resultBase64 && (
                    <img
                      src={`data:image/png;base64,${it.resultBase64}`}
                      alt={it.name}
                    />
                  )}
                  <span className="upload-preview-state">
                    {selected ? '업로드' : '제외'}
                  </span>
                  <span className="caption">
                    {it.name}
                    {it.meanAbsDiff != null && (
                      <span className="muted small">
                        {' '}
                        · Δ{it.meanAbsDiff}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {done.length === 0 && (
        <section className="card">
          <p className="muted">
            컬러화된 사진이 없습니다.{' '}
            <Link to="/colorize">컬러화 페이지</Link>에서 먼저 처리하세요.
          </p>
        </section>
      )}

      <section className="card">
        <button
          type="button"
          className="btn primary"
          disabled={
            running || !bookUid || done.length === 0 || selectedCount === 0
          }
          onClick={() => void uploadAll()}
        >
          {running
            ? '업로드 중…'
            : `선택한 사진 업로드 (${selectedCount}장)`}
        </button>
        <p className="muted small">
          업로드가 끝나면 표지 편집 화면으로 이동합니다.
        </p>
      </section>

      <nav className="nav-footer">
        <Link to="/colorize">← 컬러화</Link>
        <Link to="/cover">표지 →</Link>
      </nav>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet, apiPostForm } from '../api'
import { useApp } from '../context/AppContext'

function parseEngine(v: unknown): 'deoldify' | 'stub' | undefined {
  return v === 'deoldify' || v === 'stub' ? v : undefined
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

const PAGE_SIZE = 9

export default function ColorizePage() {
  const { bookUid, colorItems, setColorItems, applyMeta, demoMode } = useApp()
  const inputRef = useRef<HTMLInputElement>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [previewPage, setPreviewPage] = useState(0)
  const [originalPreviewPage, setOriginalPreviewPage] = useState(0)
  const [engineHint, setEngineHint] = useState<string | null>(null)

  useEffect(() => {
    if (demoMode) {
      setEngineHint('데모 모드: API 없이 샘플 결과로 표시합니다.')
      return
    }
    let cancel = false
    void apiGet('/photos/colorize/diagnostics')
      .then((r) => {
        if (cancel) return
        const d = r?.data as Record<string, unknown> | undefined
        if (!d) return
        const deps = d.deoldify_dependencies_ok === true
        const will = d.will_use_deoldify === true
        const cuda = d.cuda_available === true
        if (!deps || !will) {
          setEngineHint('고화질 컬러가 제한될 수 있습니다. 기본 보정으로 계속할 수 있습니다.')
          return
        }
        setEngineHint(
          cuda
            ? '고화질 컬러 보정을 사용합니다.'
            : '컬러 보정을 사용합니다. (그래픽 가속 없음)',
        )
      })
      .catch(() => {
        if (!cancel) setEngineHint(null)
      })
    return () => {
      cancel = true
    }
  }, [])

  // 데모 모드: 샘플 이미지를 자동으로 "업로드된 것처럼" data URL로 적재
  useEffect(() => {
    if (!demoMode) return
    if (colorItems.length > 0) return
    let cancel = false
    const samples = [
      { id: 'demo-1', name: 'bw1.png', url: '/demo/bw/bw1.png' },
      { id: 'demo-2', name: 'bw2.png', url: '/demo/bw/bw2.png' },
      { id: 'demo-3', name: 'bw3.png', url: '/demo/bw/bw3.png' },
      { id: 'demo-4', name: 'bw4.png', url: '/demo/bw/bw4.png' },
    ]

    const toDataUrl = async (url: string): Promise<string> => {
      const res = await fetch(url)
      const blob = await res.blob()
      return await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onerror = () => reject(new Error('샘플 이미지 로드 실패'))
        r.onload = () => resolve(String(r.result || ''))
        r.readAsDataURL(blob)
      })
    }

    void (async () => {
      try {
        const urls = await Promise.all(samples.map((s) => toDataUrl(s.url)))
        if (cancel) return
        setColorItems(
          samples.map((s, i) => ({
            id: s.id,
            name: s.name,
            originalDataUrl: urls[i],
            status: 'pending',
          })),
        )
      } catch {
        if (!cancel) {
          // 실패해도 데모 진행은 가능하도록 조용히 두고, 사용자가 직접 업로드할 수 있게 한다.
        }
      }
    })()

    return () => {
      cancel = true
    }
  }, [demoMode, colorItems.length, setColorItems])

  const onFiles = (files: FileList | null) => {
    if (!files?.length) return
    for (const f of Array.from(files)) {
      const id = uid()
      const reader = new FileReader()
      reader.onload = () => {
        const url = reader.result as string
        setColorItems((prev) => [
          ...prev,
          {
            id,
            name: f.name,
            originalDataUrl: url,
            status: 'pending',
          },
        ])
      }
      reader.readAsDataURL(f)
    }
  }

  const blobFromDataUrl = (dataUrl: string): Blob => {
    if (!dataUrl.startsWith('data:')) {
      throw new Error('data URL이 아닙니다. 파일 업로드로 다시 시도하세요.')
    }
    const [head, b64] = dataUrl.split(',')
    const mime = head.match(/:(.*?);/)?.[1] || 'image/png'
    const binary = atob(b64)
    const arr = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i)
    return new Blob([arr], { type: mime })
  }

  const allOriginalsReady =
    colorItems.length > 0 && colorItems.every((c) => c.originalDataUrl)

  const runColorizeAll = async () => {
    if (demoMode) {
      const pending = colorItems.filter((c) => c.originalDataUrl)
      if (!pending.length) {
        setErr('이미지를 먼저 업로드하세요.')
        return
      }
      setRunning(true)
      setErr(null)
      setPreviewPage(0)
      setOriginalPreviewPage(0)
      let anySuccess = false
      for (let i = 0; i < pending.length; i++) {
        const it = pending[i]
        setProgress(`${i + 1} / ${pending.length} — ${it.name}`)
        setColorItems((items) =>
          items.map((x) =>
            x.id === it.id ? { ...x, status: 'processing', error: undefined } : x,
          ),
        )
        try {
          const blob = blobFromDataUrl(it.originalDataUrl)
          const fd = new FormData()
          fd.append('image', blob, it.name || 'photo.png')
          const r = await apiPostForm('/photos/colorize', fd)
          const payload = r?.data as Record<string, unknown> | undefined
          const b64 = payload?.imageBase64 as string | undefined
          if (!b64) throw new Error('imageBase64 없음')
          const engine = parseEngine(payload?.engine)
          const madRaw = payload?.meanAbsDiff
          const meanAbsDiff =
            typeof madRaw === 'number' ? madRaw : Number(madRaw) || undefined
          setColorItems((items) =>
            items.map((x) =>
              x.id === it.id
                ? {
                    ...x,
                    status: 'done',
                    resultBase64: b64,
                    error: undefined,
                    ...(engine ? { engine } : {}),
                    ...(meanAbsDiff != null && !Number.isNaN(meanAbsDiff)
                      ? { meanAbsDiff }
                      : {}),
                  }
                : x,
            ),
          )
          anySuccess = true
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          setColorItems((items) =>
            items.map((x) =>
              x.id === it.id ? { ...x, status: 'error', error: msg } : x,
            ),
          )
        }
      }
      setProgress('')
      setRunning(false)
      if (anySuccess) {
        applyMeta((m) => ({
          ...m,
          workflowStage: Math.max(m.workflowStage ?? 0, 1),
        }))
      }
      return
    }
    const pending = colorItems.filter((c) => c.originalDataUrl)
    if (!pending.length) {
      setErr('이미지를 먼저 업로드하세요.')
      return
    }
    setRunning(true)
    setErr(null)
    setPreviewPage(0)
    setOriginalPreviewPage(0)
    let anySuccess = false
    for (let i = 0; i < pending.length; i++) {
      const it = pending[i]
      setProgress(`${i + 1} / ${pending.length} — ${it.name}`)
      setColorItems((items) =>
        items.map((x) =>
          x.id === it.id ? { ...x, status: 'processing', error: undefined } : x,
        ),
      )
      try {
        const blob = blobFromDataUrl(it.originalDataUrl)
        const fd = new FormData()
        fd.append('image', blob, it.name || 'photo.png')
        const r = await apiPostForm('/photos/colorize', fd)
        const payload = r?.data as Record<string, unknown> | undefined
        const b64 = payload?.imageBase64 as string | undefined
        if (!b64) throw new Error('imageBase64 없음')
        const engine = parseEngine(payload?.engine)
        const madRaw = payload?.meanAbsDiff
        const meanAbsDiff =
          typeof madRaw === 'number' ? madRaw : Number(madRaw) || undefined
        setColorItems((items) =>
          items.map((x) =>
            x.id === it.id
              ? {
                  ...x,
                  status: 'done',
                  resultBase64: b64,
                  error: undefined,
                  ...(engine ? { engine } : {}),
                  ...(meanAbsDiff != null && !Number.isNaN(meanAbsDiff)
                    ? { meanAbsDiff }
                    : {}),
                }
              : x,
          ),
        )
        anySuccess = true
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setColorItems((items) =>
          items.map((x) =>
            x.id === it.id ? { ...x, status: 'error', error: msg } : x,
          ),
        )
      }
    }
    setProgress('')
    setRunning(false)
    if (anySuccess) {
      applyMeta((m) => ({
        ...m,
        workflowStage: Math.max(m.workflowStage ?? 0, 1),
      }))
    }
  }

  const done = useMemo(
    () => colorItems.filter((c) => c.resultBase64),
    [colorItems],
  )
  const totalPreviewPages = Math.max(1, Math.ceil(done.length / PAGE_SIZE))
  const slice = done.slice(
    previewPage * PAGE_SIZE,
    previewPage * PAGE_SIZE + PAGE_SIZE,
  )

  const totalOriginalPages = Math.max(
    1,
    Math.ceil(colorItems.length / PAGE_SIZE),
  )
  const originalSlice = colorItems.slice(
    originalPreviewPage * PAGE_SIZE,
    originalPreviewPage * PAGE_SIZE + PAGE_SIZE,
  )

  useEffect(() => {
    setOriginalPreviewPage((p) =>
      Math.min(p, Math.max(0, totalOriginalPages - 1)),
    )
  }, [totalOriginalPages])

  return (
    <div className="page">
      <h1>흑백 → 컬러</h1>
      {!bookUid && (
        <div className="banner warn">
          앨범이 없습니다.{' '}
          <Link to="/book/setup">설정</Link>에서 앨범을 먼저 만드세요.
        </div>
      )}
      {err && <div className="banner error">{err}</div>}

      <section className="card">
        <h2>여러 장 업로드</h2>
        <input
          key={bookUid ?? 'no-book'}
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="input"
          onChange={(e) => onFiles(e.target.files)}
        />
        {engineHint && (
          <p
            className={`small ${engineHint.includes('미완료') || engineHint.includes('stub') ? 'banner warn' : 'banner ok'}`}
            style={{ marginTop: '0.5rem', marginBottom: 0 }}
          >
            {engineHint}
          </p>
        )}
        <button
          type="button"
          className="btn primary"
          disabled={
            running || !allOriginalsReady || colorItems.length === 0
          }
          onClick={() => void runColorizeAll()}
        >
          {running
            ? '처리 중…'
            : '한 장씩 순차 컬러화'}
        </button>
        {progress && <p className="muted">{progress}</p>}
        {!allOriginalsReady && colorItems.length > 0 && (
          <p className="muted small">파일 로딩이 끝나면 컬러화 버튼이 활성화됩니다.</p>
        )}
      </section>

      {colorItems.length > 0 && (
        <section className="card">
          <h2>원본 미리보기 (3×3)</h2>
          <p className="muted small" style={{ marginTop: '-0.5rem' }}>
            컬러 처리 전 원본입니다. 결과는 아래{' '}
            <strong>컬러 결과 미리보기</strong>에서 확인하세요.
          </p>
          {colorItems.length > PAGE_SIZE && (
            <div className="pager">
              <button
                type="button"
                className="btn"
                disabled={originalPreviewPage <= 0}
                onClick={() =>
                  setOriginalPreviewPage((p) => Math.max(0, p - 1))
                }
              >
                ←
              </button>
              <span>
                {originalPreviewPage + 1} / {totalOriginalPages}
              </span>
              <button
                type="button"
                className="btn"
                disabled={originalPreviewPage >= totalOriginalPages - 1}
                onClick={() =>
                  setOriginalPreviewPage((p) =>
                    Math.min(totalOriginalPages - 1, p + 1),
                  )
                }
              >
                →
              </button>
            </div>
          )}
          <div className="grid-3 colorize-originals-grid">
            {originalSlice.map((it) => (
              <div
                key={it.id}
                className={`colorize-original-cell grid-cell ${
                  !it.originalDataUrl ? 'loading' : ''
                }`}
              >
                {it.originalDataUrl ? (
                  <img src={it.originalDataUrl} alt={it.name} />
                ) : (
                  <span>로딩…</span>
                )}
                <span className="caption">{it.name}</span>
                <span className="badge">
                  {it.status}
                  {it.status === 'done' && it.engine
                    ? ` · ${it.engine === 'deoldify' ? '고화질' : '기본'}`
                    : ''}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {done.length > 0 && (
        <section className="card">
          <h2>컬러 결과 미리보기 (3×3)</h2>
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
            {slice.map((it) => (
              <div key={it.id} className="grid-cell">
                {it.resultBase64 && (
                  <img
                    src={
                      /^https?:\/\//i.test(it.resultBase64) ||
                      it.resultBase64.startsWith('/') ||
                      it.resultBase64.startsWith('data:')
                        ? it.resultBase64
                        : `data:image/png;base64,${it.resultBase64}`
                    }
                    alt={it.name}
                  />
                )}
                <span className="caption">
                  {it.name}
                  {it.meanAbsDiff != null && (
                    <span className="muted small">
                      {' '}
                      · Δ{it.meanAbsDiff}
                      {it.meanAbsDiff < 2.5 ? ' (거의 원본과 동일)' : ''}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <nav className="nav-footer">
        <Link to="/book/setup">← 설정</Link>
        <Link to="/photos/upload">사진 업로드 →</Link>
      </nav>
    </div>
  )
}

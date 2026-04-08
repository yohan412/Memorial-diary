import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiDelete, apiGet, apiPostJson, unwrapArray } from '../api'
import { useApp } from '../context/AppContext'
import { DEMO_BOOK_SPEC_UID } from '../demo/demoData'

type Row = Record<string, unknown>

function isAllowedBookSpecUid(uid: string): boolean {
  const u = uid.trim().toLowerCase()
  return u.startsWith('photobook') || u.startsWith('squarebook')
}

function isRecord(v: unknown): v is Row {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function pickUid(t: Row): string {
  return String(t.bookSpecUid ?? t.templateUid ?? t.uid ?? t.id ?? '')
}

function pickLabel(t: Row): string {
  return String(t.name ?? t.title ?? t.displayName ?? pickUid(t) ?? '?')
}

function unwrapBookSpecData(res: unknown): Row | null {
  if (!isRecord(res)) return null
  const d = res.data
  if (isRecord(d)) return d as Row
  return null
}

function num(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function specTrimSize(row: Row | null): { w: number; h: number } | null {
  if (!row) return null
  const w = num(row.innerTrimWidthMm)
  const h = num(row.innerTrimHeightMm)
  if (w && h) return { w, h }
  const ls = row.layoutSize
  if (isRecord(ls)) {
    const lw = num(ls.width ?? ls.w ?? ls.innerWidth ?? ls.innerTrimWidthMm)
    const lh = num(ls.height ?? ls.h ?? ls.innerHeight ?? ls.innerTrimHeightMm)
    if (lw && lh) return { w: lw, h: lh }
  }
  return null
}

export default function BookSetupPage() {
  const nav = useNavigate()
  const {
    bookSpecUid,
    setBookSpecUid,
    bookTitle,
    setBookTitle,
    setCoverTemplateUid,
    setContentTemplateUid,
    bookUid,
    setBookUid,
    persistMeta,
    demoMode,
  } = useApp()

  const [specs, setSpecs] = useState<Row[]>([])
  const [specDetail, setSpecDetail] = useState<Row | null>(null)
  const [specDetailLoading, setSpecDetailLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // 데모 모드: 기본으로 DEMO 포토북을 선택해 둔다(사용자는 변경 가능)
  useEffect(() => {
    if (!demoMode) return
    if (!bookSpecUid) setBookSpecUid(DEMO_BOOK_SPEC_UID)
    if (!bookTitle.trim()) setBookTitle('TEST 추억 앨범')
  }, [demoMode, bookSpecUid, bookTitle, setBookSpecUid, setBookTitle])

  // 설정 페이지 진입 시: 최종화(=완성)되지 않은 draft 책 정리
  useEffect(() => {
    let cancel = false
    ;(async () => {
      try {
        const draftUids: string[] = []
        let offset = 0
        const limit = 100
        for (;;) {
          const r = await apiGet('/books', {
            status: 'draft',
            limit: String(limit),
            offset: String(offset),
          })
          const data = (r && typeof r === 'object' ? (r as Row).data : null) as
            | Row
            | null
          const books = unwrapArray(data, ['books', 'items', 'list']) as Row[]
          if (cancel) return
          for (const b of books) {
            const uid = String(b.bookUid ?? b.uid ?? b.id ?? '').trim()
            if (uid) draftUids.push(uid)
          }
          if (books.length < limit) break
          offset += limit
          if (books.length === 0) break
        }

        for (const uid of draftUids) {
          if (cancel) return
          if (bookUid && uid === bookUid) continue
          try {
            await apiDelete(`/books/${encodeURIComponent(uid)}`)
          } catch {
            // draft가 아니거나 삭제 불가한 케이스는 조용히 스킵
          }
        }
      } catch {
        // 정리 실패는 기능상 치명적이지 않아서 무시
      }
    })()
    return () => {
      cancel = true
    }
  }, [bookUid])

  useEffect(() => {
    let cancel = false
    ;(async () => {
      setLoading(true)
      setErr(null)
      try {
        const r = await apiGet('/book-specs')
        const list = unwrapArray(r?.data, ['bookSpecs', 'items', 'list'])
        if (!cancel) setSpecs(list as Row[])
      } catch (e) {
        if (!cancel) setErr(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancel) setLoading(false)
      }
    })()
    return () => {
      cancel = true
    }
  }, [])

  useEffect(() => {
    if (!bookSpecUid) return
    if (!isAllowedBookSpecUid(bookSpecUid)) {
      setBookSpecUid(null)
      setCoverTemplateUid('')
      setContentTemplateUid('')
    }
  }, [bookSpecUid, setBookSpecUid, setCoverTemplateUid, setContentTemplateUid])

  const allowedSpecs = useMemo(
    () =>
      specs.filter((s) => {
        const uid = pickUid(s)
        return uid && isAllowedBookSpecUid(uid)
      }),
    [specs],
  )

  useEffect(() => {
    if (!bookSpecUid) {
      setSpecDetail(null)
      return
    }
    let cancel = false
    setSpecDetailLoading(true)
    void apiGet(`/book-specs/${encodeURIComponent(bookSpecUid)}`)
      .then((res) => {
        if (cancel) return
        setSpecDetail(unwrapBookSpecData(res))
      })
      .catch(() => {
        if (!cancel) setSpecDetail(null)
      })
      .finally(() => {
        if (!cancel) setSpecDetailLoading(false)
      })
    return () => {
      cancel = true
    }
  }, [bookSpecUid])

  const selectedSpecRow = useMemo(() => {
    if (!bookSpecUid) return null
    return specs.find((s) => pickUid(s) === bookSpecUid) ?? null
  }, [specs, bookSpecUid])

  const specMerged = useMemo((): Row | null => {
    if (!bookSpecUid) return null
    return { ...(selectedSpecRow ?? {}), ...(specDetail ?? {}) } as Row
  }, [bookSpecUid, selectedSpecRow, specDetail])

  const trim = useMemo(() => specTrimSize(specMerged), [specMerged])

  const onSpecChange = (uid: string) => {
    setBookSpecUid(uid || null)
    setCoverTemplateUid('')
    setContentTemplateUid('')
  }

  const createBook = async () => {
    if (!bookSpecUid) return
    setCreating(true)
    setErr(null)
    try {
      const r = await apiPostJson('/books', {
        bookSpecUid,
        title: bookTitle || '나의 기록',
        creationType: 'TEST',
      })
      const uid = (r?.data as Row)?.bookUid as string | undefined
      if (!uid) throw new Error('응답에 앨범 정보가 없습니다.')
      setBookUid(uid)
      persistMeta()
      nav('/colorize')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  const pageMin = num(specMerged?.pageMin)
  const pageMax = num(specMerged?.pageMax)
  const pageInc = num(specMerged?.pageIncrement)

  return (
    <div className="page">
      <h1>설정</h1>
      <p className="muted">
        앨범 크기를 고르고 제목을 정한 뒤 시작합니다. 사진 보정·표지·본문은 다음 단계에서
        이어집니다.
      </p>

      {err && <div className="banner error">{err}</div>}

      <section className="card">
        <h2>앨범 크기</h2>
        <p className="muted small">사용 가능한 규격만 표시됩니다.</p>
        {loading ? (
          <p>불러오는 중…</p>
        ) : (
          <select
            value={bookSpecUid ?? ''}
            onChange={(e) => onSpecChange(e.target.value)}
            className="input"
          >
            <option value="">선택하세요</option>
            {allowedSpecs.map((s) => {
              const uid = pickUid(s)
              if (!uid) return null
              return (
                <option key={uid} value={uid}>
                  {pickLabel(s)}
                </option>
              )
            })}
          </select>
        )}
        {!loading && allowedSpecs.length === 0 && (
          <p className="banner warn small">선택할 수 있는 규격이 없습니다.</p>
        )}
        {bookSpecUid && specMerged && (
          <div className="setup-spec-preview">
            <h3>선택한 규격</h3>
            {specDetailLoading && (
              <p className="muted small">상세 정보 불러오는 중…</p>
            )}
            <div className="setup-spec-row">
              <div className="setup-spec-media">
                <div className="setup-spec-shape-wrap">
                  {trim ? (
                    <>
                      <div
                        className="setup-spec-shape"
                        style={{
                          aspectRatio: `${trim.w} / ${trim.h}`,
                          maxHeight: '280px',
                          width: 'min(100%, 240px)',
                        }}
                        title="본문 페이지 가로·세로 비율 안내"
                      />
                      <span className="setup-spec-shape-caption">
                        안쪽 페이지의 가로·세로 비율만 표시합니다.
                      </span>
                    </>
                  ) : (
                    <div className="setup-spec-shape-fallback">
                      비율 정보를 표시할 수 없습니다
                    </div>
                  )}
                </div>
              </div>
              <div className="setup-spec-summary-wrap">
                <p className="setup-spec-summary-title">요약</p>
                <dl>
                  <dt>본문 페이지 크기</dt>
                  <dd>
                    {trim
                      ? `${trim.w} × ${trim.h} mm (가로×세로)`
                      : '정보 없음'}
                  </dd>
                  <dt>비율</dt>
                  <dd>
                    {trim
                      ? `${(trim.w / trim.h).toFixed(3)} : 1`
                      : '—'}
                  </dd>
                  <dt>페이지</dt>
                  <dd>
                    {pageMin != null && pageMax != null
                      ? `${pageMin}~${pageMax}페이지`
                      : '—'}
                    {pageInc != null ? ` · ${pageInc}페이지 단위` : ''}
                  </dd>
                  <dt>표지 · 제본</dt>
                  <dd>
                    {String(specMerged.coverType ?? '—')}
                    {' · '}
                    {String(specMerged.bindingType ?? '—')}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>제목</h2>
        <input
          className="input"
          placeholder="앨범 제목"
          value={bookTitle}
          onChange={(e) => setBookTitle(e.target.value)}
        />
        {bookUid ? (
          <p className="muted small">이어서 작업 중인 앨범이 있습니다.</p>
        ) : null}
        <button
          type="button"
          className="btn primary"
          style={{ marginTop: '0.65rem' }}
          disabled={!bookSpecUid || creating}
          onClick={() => void createBook()}
        >
          {creating ? '만드는 중…' : '새 앨범 만들고 다음 단계로'}
        </button>
      </section>

      <nav className="nav-footer">
        <Link to="/">처음 화면</Link>
        <Link to="/manage">책·주문 관리</Link>
        <Link to="/colorize">사진 보정 →</Link>
      </nav>
    </div>
  )
}

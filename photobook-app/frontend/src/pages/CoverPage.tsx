import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import BookEditorShell from '../components/BookEditorShell'
import TemplateParameterForm from '../components/TemplateParameterForm'
import TemplatePreviewBlock from '../components/TemplatePreviewBlock'
import UploadedPhotoThumb from '../components/UploadedPhotoThumb'
import { useBookServerPhotos } from '../hooks/useBookServerPhotos'
import { useSweetbookTemplateParameters } from '../hooks/useSweetbookTemplateParameters'
import { useTemplatesForBookSpec } from '../hooks/useTemplatesForBookSpec'
import { errorMessageFromApiData, parseJson } from '../api'
import { useApp } from '../context/AppContext'
import {
  extractCoverFromBookApi,
  firstPhotoFileNameFromParams,
} from '../utils/bookAssetParse'
import { isFileBinding, sanitizeParameterPayload } from '../utils/templateParams'
import { proxiedSweetbookImageUrl } from '../utils/sweetbookAssetProxy'
import {
  pickLabel,
  pickTemplateUid,
  resolveTemplateDisplayName,
} from '../utils/sweetbookTemplateList'
import { firstTemplateThumbnailFromListRow } from '../utils/templateThumbnails'

export default function CoverPage() {
  const nav = useNavigate()
  const {
    bookUid,
    bookSpecUid,
    coverTemplateUid,
    setCoverTemplateUid,
    uploadedPhotoNames,
    uploadedPhotoPreviewByName,
    setUploadedPhotoNames,
    applyMeta,
    demoMode,
  } = useApp()
  const [templateUid, setTemplateUid] = useState(coverTemplateUid)
  useEffect(() => {
    if (coverTemplateUid) setTemplateUid(coverTemplateUid)
  }, [coverTemplateUid])

  const [coverRemote, setCoverRemote] = useState<ReturnType<
    typeof extractCoverFromBookApi
  > | null>(null)
  const [coverRemoteLoading, setCoverRemoteLoading] = useState(false)
  const [coverRemoteErr, setCoverRemoteErr] = useState<string | null>(null)

  useEffect(() => {
    if (!bookUid) {
      setCoverRemote(null)
      setCoverRemoteErr(null)
      return
    }
    if (demoMode) {
      // 데모는 서버 표지 조회를 하지 않는다.
      setCoverRemote(null)
      setCoverRemoteErr(null)
      setCoverRemoteLoading(false)
      return
    }
    let cancel = false
    setCoverRemoteLoading(true)
    setCoverRemoteErr(null)
    void fetch(`/api/books/${encodeURIComponent(bookUid)}/cover`)
      .then(async (res) => {
        const data = await parseJson(res)
        if (cancel) return
        if (!res.ok) {
          setCoverRemote(null)
          if (res.status !== 404) {
            const msg =
              typeof (data as { message?: string }).message === 'string'
                ? (data as { message: string }).message
                : `표지 조회 HTTP ${res.status}`
            setCoverRemoteErr(msg)
          }
          return
        }
        setCoverRemote(extractCoverFromBookApi(data))
      })
      .catch(() => {
        if (!cancel) {
          setCoverRemoteErr('표지 정보를 불러오지 못했습니다.')
          setCoverRemote(null)
        }
      })
      .finally(() => {
        if (!cancel) setCoverRemoteLoading(false)
      })
    return () => {
      cancel = true
    }
  }, [bookUid])

  useEffect(() => {
    const t = coverRemote?.templateUid?.trim()
    if (!t) return
    if (!coverTemplateUid) {
      setCoverTemplateUid(t)
      setTemplateUid(t)
    }
  }, [coverRemote?.templateUid, coverTemplateUid, setCoverTemplateUid])

  const {
    fileNames: serverPhotoNames,
    urlByFileName: serverPhotoUrls,
    photoOriginalByName: serverPhotoOriginalByName,
    loading: serverPhotosLoading,
    err: serverPhotosErr,
  } = useBookServerPhotos(bookUid)

  const mergedPhotoPreviewByName = useMemo(
    () => ({ ...serverPhotoUrls, ...uploadedPhotoPreviewByName }),
    [serverPhotoUrls, uploadedPhotoPreviewByName],
  )

  const mergedPhotoOriginalByName = useMemo(
    () => ({ ...serverPhotoOriginalByName }),
    [serverPhotoOriginalByName],
  )

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

  const coverSeed = useMemo(() => {
    if (!coverRemote?.parameters || !Object.keys(coverRemote.parameters).length) {
      return null
    }
    return coverRemote.parameters
  }, [coverRemote])

  const {
    parsed,
    loading: tplLoading,
    fetchErr: tplErr,
    paramValues,
    setParamValues,
  } = useSweetbookTemplateParameters(templateUid, { seedValues: coverSeed })

  const { templates: coverTemplates, templatesLoading, templatesErr } =
    useTemplatesForBookSpec(bookSpecUid, 'cover')

  const selectedCoverListThumbUrl = useMemo(() => {
    const uid = templateUid.trim()
    if (!uid) return null
    const row = coverTemplates.find((t) => pickTemplateUid(t) === uid)
    return row ? firstTemplateThumbnailFromListRow(row) : null
  }, [coverTemplates, templateUid])

  const coverTemplateUidSet = useMemo(
    () =>
      new Set(
        coverTemplates.map((t) => pickTemplateUid(t)).filter((u) => u.length > 0),
      ),
    [coverTemplates],
  )
  const orphanCoverTemplateSelect =
    Boolean(templateUid.trim()) && !coverTemplateUidSet.has(templateUid.trim())

  const appliedCoverTemplateCaption = useMemo(() => {
    const uid = coverRemote?.templateUid?.trim()
    if (!uid) return ''
    return resolveTemplateDisplayName(uid, coverTemplates, parsed)
  }, [coverRemote?.templateUid, coverTemplates, parsed])

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

  const [err, setErr] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    if (!bookUid) return
    setErr(null)
    setOk(null)
    const parameters = sanitizeParameterPayload(
      paramValues,
      parsed?.fields ?? [],
    ) as object
    if (!templateUid.trim()) {
      setErr('표지 템플릿을 선택하세요.')
      return
    }
    if (demoMode) {
      applyMeta((m) => ({
        ...m,
        workflowStage: Math.max(m.workflowStage ?? 0, 3),
      }))
      setOk('데모: 표지 적용 완료 — 내지 페이지로 이동합니다.')
      nav('/contents')
      return
    }
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('templateUid', templateUid.trim())
      fd.append('parameters', JSON.stringify(parameters))
      const res = await fetch(`/api/books/${bookUid}/cover`, {
        method: 'POST',
        body: fd,
      })
      const data = await parseJson(res)
      if (!res.ok) {
        throw new Error(
          errorMessageFromApiData(data as Record<string, unknown>, res.statusText),
        )
      }
      applyMeta((m) => ({
        ...m,
        workflowStage: Math.max(m.workflowStage ?? 0, 3),
      }))
      setOk('표지 적용 완료 — 내지 페이지로 이동합니다.')
      nav('/contents')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const alerts = (
    <>
      {!bookUid && (
        <div className="banner error">설정에서 앨범을 먼저 만들거나 선택해 주세요.</div>
      )}
      {!bookSpecUid && (
        <div className="banner warn">
          판형(bookSpec)이 없습니다.{' '}
          <Link to="/book/setup">설정</Link>에서 판형을 고르고 책을 생성하세요.
        </div>
      )}
      {err && <div className="banner error">{err}</div>}
      {ok && <div className="banner ok">{ok}</div>}
      {templatesErr && (
        <div className="banner error">템플릿 목록: {templatesErr}</div>
      )}
      {tplErr && <div className="banner error">템플릿 로드: {tplErr}</div>}
      {coverRemoteErr && (
        <div className="banner warn small">표지 조회: {coverRemoteErr}</div>
      )}
      {!demoMode && serverPhotosErr && (
        <div className="banner warn small">책 사진 목록: {serverPhotosErr}</div>
      )}
    </>
  )

  const left = (
    <>
      <p className="book-editor-rail-note">
        판형은 <Link to="/book/setup">설정</Link>에서 선택합니다.
      </p>
      <label className="small" style={{ display: 'block', marginBottom: '0.25rem' }}>
        표지 템플릿
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
            setCoverTemplateUid(v)
          }}
        >
          <option value="">선택…</option>
          {orphanCoverTemplateSelect ? (
            <option value={templateUid.trim()}>
              {resolveTemplateDisplayName(
                templateUid.trim(),
                coverTemplates,
                parsed,
              )}
            </option>
          ) : null}
          {coverTemplates.map((t) => {
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
      {selectedCoverListThumbUrl ? (
        <div className="template-select-layout-preview">
          <p className="muted small template-select-layout-preview-label">
            템플릿 레이아웃 (목록 thumbnails.layout)
          </p>
          <img
            src={proxiedSweetbookImageUrl(selectedCoverListThumbUrl)}
            alt=""
            className="template-select-layout-preview-img"
          />
        </div>
      ) : null}
      {bookSpecUid && !templatesLoading && coverTemplates.length === 0 && (
        <p className="muted small">이 판형에 표지 템플릿이 없습니다.</p>
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
        <p className="muted small">사진 업로드 단계에서 추가하세요.</p>
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

  /** Sweetbook 표지 GET URL + 파라미터 내 서버 파일명(프록시)까지 캔버스에 사용 */
  const canvasCoverUrl = useMemo(() => {
    const fromApi = coverRemote?.previewUrls?.[0]
    if (fromApi) return fromApi
    if (!bookUid || !coverRemote?.parameters) return null
    const fn = firstPhotoFileNameFromParams(coverRemote.parameters)
    if (!fn || /^https?:\/\//i.test(fn)) return null
    // 파일명 바이너리 프록시를 사용하지 않음
    return null
  }, [coverRemote, bookUid])

  const hasRemoteCoverMeta =
    !!coverRemote &&
    (!!coverRemote.templateUid.trim() ||
      Object.keys(coverRemote.parameters).length > 0)

  const canvas = (
    <div className="book-editor-canvas-stack">
      {coverRemoteLoading && (
        <p className="muted small" style={{ margin: 0 }}>
          서버에 적용된 표지를 불러오는 중…
        </p>
      )}
      {canvasCoverUrl ? (
        <div className="book-cover-editor-canvas" aria-label="적용된 표지 캔버스">
          <p className="book-cover-canvas-label muted small">적용된 표지</p>
          <img
            src={canvasCoverUrl}
            alt=""
            className="book-cover-canvas-img"
          />
          {coverRemote?.templateUid ? (
            <p className="book-applied-asset-meta">
              {appliedCoverTemplateCaption || coverRemote.templateUid}
            </p>
          ) : null}
        </div>
      ) : null}
      {!coverRemoteLoading &&
      hasRemoteCoverMeta &&
      !canvasCoverUrl ? (
        <p className="muted small" style={{ margin: 0 }}>
          적용된 표지는 있으나 이미지 URL·연결 가능한 업로드 파일명이 없습니다. 아래 템플릿
          미리보기와 입력 값으로 확인할 수 있습니다.
        </p>
      ) : null}
      {templateUid.trim() ? (
        <TemplatePreviewBlock
          templateUid={templateUid}
          heading="미리보기"
          variant="editorCanvas"
        />
      ) : !canvasCoverUrl ? (
        <div className="book-editor-canvas-placeholder">
          왼쪽에서 표지 템플릿을 선택하면
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

      <div style={{ marginTop: '0.5rem' }}>
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
        disabled={loading || !bookUid}
        onClick={() => void submit()}
      >
        {loading ? '전송 중…' : '표지 적용'}
      </button>
    </>
  )

  return (
    <BookEditorShell
      title="표지 편집"
      kind="cover"
      alerts={alerts}
      left={left}
      canvas={canvas}
      right={right}
      footer={
        <nav className="nav-footer">
          <Link to="/photos/upload">← 사진</Link>
          <Link to="/contents">내지 →</Link>
        </nav>
      }
    />
  )
}

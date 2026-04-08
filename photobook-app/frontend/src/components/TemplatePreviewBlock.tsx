import { useEffect, useState } from 'react'
import { apiGet } from '../api'
import { parseTemplateDefinitions, type ParsedTemplate } from '../utils/templateParams'
import { proxiedSweetbookImageUrl } from '../utils/sweetbookAssetProxy'
import {
  collectTemplateThumbnailEntries,
  mergeTemplateDetailForPreview,
} from '../utils/templateThumbnails'

type Row = Record<string, unknown>

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function summarizeTemplateStructure(
  parsed: ParsedTemplate | null,
  raw: Row | null,
): string[] {
  const lines: string[] = []
  if (!parsed && !raw) return lines
  if (parsed?.templateKind) lines.push(`템플릿 종류(templateKind): ${parsed.templateKind}`)
  if (parsed?.templateName) lines.push(`이름: ${parsed.templateName}`)
  if (!parsed?.fields.length) {
    lines.push('파라미터(definitions): 상세 응답에 없거나 비어 있음')
  } else {
    const byBinding = new Map<string, number>()
    for (const f of parsed.fields) {
      byBinding.set(f.binding, (byBinding.get(f.binding) ?? 0) + 1)
    }
    lines.push(`입력 파라미터 ${parsed.fields.length}개`)
    for (const [b, c] of [...byBinding.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      lines.push(`· ${b} 바인딩: ${c}개`)
    }
    const req = parsed.fields.filter((f) => f.required).length
    if (req) lines.push(`필수 필드: ${req}개`)
  }
  if (raw) {
    if (isRecord(raw.layout as object)) lines.push('레이아웃(layout) 객체 포함')
    if (raw.layoutRules != null) lines.push('layoutRules 포함')
    if (raw.baseLayer != null) lines.push('baseLayer(베이스 레이어) 포함')
  }
  return lines
}

/** 편집기 캔버스용: API 용어·필드 키 없이 짧게만 안내 */
function summarizeTemplateStructureFriendly(
  parsed: ParsedTemplate | null,
): string[] {
  const lines: string[] = []
  if (!parsed) return lines
  const name = parsed.templateName?.trim()
  if (name) lines.push(`선택한 템플릿: ${name}`)
  const n = parsed.fields.length
  if (n === 0) {
    lines.push('입력 칸 정보가 없습니다. 오른쪽 속성에서 내용을 확인해 주세요.')
  } else {
    const req = parsed.fields.filter((f) => f.required).length
    lines.push(
      req > 0
        ? `입력 칸 ${n}개 중 ${req}개는 반드시 채워야 합니다.`
        : `입력 칸이 ${n}개 있습니다.`,
    )
  }
  return lines
}

type Props = {
  templateUid: string
  heading: string
  /** 편집기 캔버스: 넓은 미리보기·세로 스택 */
  variant?: 'default' | 'editorCanvas'
}

export default function TemplatePreviewBlock({
  templateUid,
  heading,
  variant = 'default',
}: Props) {
  const [parsed, setParsed] = useState<ParsedTemplate | null>(null)
  const [raw, setRaw] = useState<Row | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetchErr, setFetchErr] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<{ url: string; label: string } | null>(
    null,
  )

  useEffect(() => {
    const uid = templateUid.trim()
    if (!uid) {
      setParsed(null)
      setRaw(null)
      setFetchErr(null)
      return
    }
    let cancel = false
    setLoading(true)
    setFetchErr(null)
    void apiGet(`/templates/${encodeURIComponent(uid)}`)
      .then((res) => {
        if (cancel) return
        const data = mergeTemplateDetailForPreview(res)
        setRaw(data)
        setParsed(data ? parseTemplateDefinitions(data) : null)
      })
      .catch((e: Error) => {
        if (!cancel) {
          setFetchErr(e.message)
          setParsed(null)
          setRaw(null)
        }
      })
      .finally(() => {
        if (!cancel) setLoading(false)
      })
    return () => {
      cancel = true
    }
  }, [templateUid])

  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  if (!templateUid.trim()) return null

  const thumbs = collectTemplateThumbnailEntries(raw).map((t) => ({
    ...t,
    displayUrl: proxiedSweetbookImageUrl(t.url),
  }))
  const structureLines =
    variant === 'editorCanvas'
      ? summarizeTemplateStructureFriendly(parsed)
      : summarizeTemplateStructure(parsed, raw)
  const rootClass =
    variant === 'editorCanvas'
      ? 'setup-template-preview setup-template-preview--editor-canvas'
      : 'setup-template-preview'

  return (
    <div className={rootClass}>
      {variant !== 'editorCanvas' ? (
        <h3 className="setup-template-preview-heading">{heading}</h3>
      ) : null}
      {loading && <p className="muted small">미리보기 불러오는 중…</p>}
      {fetchErr && <p className="error-text small">{fetchErr}</p>}
      {!loading && !fetchErr && (
        <div
          className={
            variant === 'editorCanvas'
              ? 'setup-template-row setup-template-row--editor-canvas'
              : 'setup-template-row'
          }
        >
          <div className="setup-template-media">
            {thumbs.length > 0 ? (
              <div className="setup-template-thumbs">
                {thumbs.map((t) => (
                  <button
                    key={`${t.label}-${t.url.slice(-24)}`}
                    type="button"
                    className="setup-template-thumb-btn"
                    onClick={() =>
                      setLightbox({ url: t.displayUrl, label: t.label })
                    }
                    title="클릭하여 크게 보기"
                  >
                    <div className="setup-template-thumb">
                      <img
                        src={t.displayUrl}
                        alt={t.label}
                        loading="lazy"
                      />
                    </div>
                    <div className="setup-template-thumb-caption">{t.label}</div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted small setup-template-no-thumb">
                이 템플릿 응답에 썸네일 URL이 없습니다.
              </p>
            )}
          </div>
          {structureLines.length > 0 && (
            <div
              className={
                variant === 'editorCanvas'
                  ? 'setup-template-structure-wrap setup-template-structure-wrap--editor-canvas'
                  : 'setup-template-structure-wrap'
              }
            >
              <p className="setup-template-structure-title">
                {variant === 'editorCanvas' ? '레이아웃 안내' : '구조 요약'}
              </p>
              <ul className="setup-template-structure">
                {structureLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {lightbox && (
        <div
          className="template-layout-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="템플릿 레이아웃 확대"
          onClick={() => setLightbox(null)}
        >
          <p className="template-layout-lightbox-hint">
            닫으려면 여기나 배경을 클릭하거나 Esc 키
          </p>
          <img
            src={lightbox.url}
            alt={lightbox.label}
            className="template-layout-lightbox-img"
          />
        </div>
      )}
    </div>
  )
}

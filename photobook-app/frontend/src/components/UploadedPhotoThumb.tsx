import { useEffect, useMemo, useState } from 'react'

type Props = {
  fileName: string
  photoPreviewByName: Record<string, string>
  /** 썸네일 실패 시: 가이드 originalUrl 프록시 (선택) */
  photoOriginalByName?: Record<string, string>
  /** 최종 폴백: GET 사진 바이너리 프록시 */
  photoFallbackByName?: Record<string, string>
  /** 기본 88px 정사각 — 목록용으로 더 작게 */
  size?: 'md' | 'sm'
}

/** 표지/내지 등: 업로드 파일명에 대한 미리보기 (썸네일 → 원본 URL → 바이너리) */
export default function UploadedPhotoThumb({
  fileName,
  photoPreviewByName,
  photoOriginalByName,
  photoFallbackByName,
  size = 'md',
}: Props) {
  const primary = fileName ? photoPreviewByName[fileName] ?? '' : ''
  const intermediate = fileName
    ? photoOriginalByName?.[fileName] ?? ''
    : ''
  const fallback = fileName
    ? photoFallbackByName?.[fileName] ?? ''
    : ''

  const chain = useMemo(() => {
    const c = [primary, intermediate, fallback].filter(
      (s): s is string => typeof s === 'string' && s.length > 0,
    )
    return [...new Set(c)]
  }, [primary, intermediate, fallback])

  const [idx, setIdx] = useState(0)

  useEffect(() => {
    setIdx(0)
  }, [chain.join('\0')])

  const src = chain[idx] ?? ''

  return (
    <div
      className={`param-file-preview param-file-preview--${size}`}
      title={fileName || undefined}
    >
      {src ? (
        <img
          src={src}
          alt=""
          className="param-file-preview-img"
          onError={() => {
            setIdx((i) => (i + 1 < chain.length ? i + 1 : i))
          }}
        />
      ) : (
        <span className="param-file-preview-placeholder">
          {!fileName ? '선택 전' : '미리보기 없음'}
        </span>
      )}
    </div>
  )
}

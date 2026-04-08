import { useEffect, useMemo, useRef, useState } from 'react'
import { proxiedImageSrcIfRemote } from '../utils/sweetbookAssetProxy'

function PreviewImgChain({ urls }: { urls: string[] }) {
  const chain = useMemo(
    () => [...new Set(urls.filter((s) => s.length > 0))],
    [urls.join('\0')],
  )
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    setIdx(0)
  }, [urls.join('\0')])
  const src = chain[idx]
  if (!src) return null
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => {
        setIdx((i) => (i + 1 < chain.length ? i + 1 : i))
      }}
    />
  )
}

export type ContentInsertedSnapshot = {
  id: string
  order: number
  templateUid: string
  templateName: string
  layoutThumbUrl: string | null
  photoFileName: string | null
  /** 서버 GET으로 확인된 내지 vs 아직 전송 대기열 */
  contentSyncStatus?: 'server' | 'pending' | 'error'
}

type Props = {
  items: ContentInsertedSnapshot[]
  photoPreviewByName: Record<string, string>
  photoOriginalByName?: Record<string, string>
  photoFallbackByName?: Record<string, string>
  onItemClick?: (it: ContentInsertedSnapshot) => void
}

export default function ContentInsertedStrip({
  items,
  photoPreviewByName,
  photoOriginalByName,
  photoFallbackByName,
  onItemClick,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevLen = useRef(0)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (items.length > prevLen.current && items.length > 0) {
      requestAnimationFrame(() => {
        el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' })
      })
    }
    prevLen.current = items.length
  }, [items.length])

  const scrollBy = (delta: number) => {
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' })
  }

  if (items.length === 0) return null

  return (
    <section className="content-inserted-region" aria-label="삽입된 내지 페이지">
      <h2 className="content-inserted-heading">적용·삽입된 내지</h2>
      <p className="muted small content-inserted-hint">
        왼쪽부터 순서입니다.{' '}
        <span className="content-inserted-legend-server">■</span> 굵은 초록 테두리는
        서버에 반영된 내지,{' '}
        <span className="content-inserted-legend-pending">■</span> 점선 테두리는
        아직 전송 대기입니다.{' '}
        <span className="content-inserted-legend-error">■</span> 빨간 점선은 반영
        확인에 실패했습니다(클릭하면 재시도).
      </p>
      <div className="content-inserted-strip-outer">
        <button
          type="button"
          className="content-inserted-strip-nav"
          aria-label="이전 카드"
          onClick={() => scrollBy(-280)}
        >
          ‹
        </button>
        <div ref={scrollRef} className="content-inserted-strip-scroll">
          {items.map((it) => {
            const fn = it.photoFileName?.trim() ?? ''
            const primary = fn ? photoPreviewByName[fn] ?? '' : ''
            const original = fn ? photoOriginalByName?.[fn] ?? '' : ''
            const fallback = fn ? photoFallbackByName?.[fn] ?? '' : ''
            const showPhoto = Boolean(primary || original || fallback)
            const sync = it.contentSyncStatus ?? 'server'
            const cardClass =
              sync === 'error'
                ? 'content-inserted-card content-inserted-card--error'
                : sync === 'pending'
                  ? 'content-inserted-card content-inserted-card--pending'
                  : 'content-inserted-card content-inserted-card--server'
            return (
              <article
                key={it.id}
                className={cardClass}
                role={onItemClick ? 'button' : undefined}
                tabIndex={onItemClick ? 0 : undefined}
                onClick={() => onItemClick?.(it)}
                onKeyDown={(e) => {
                  if (!onItemClick) return
                  if (e.key === 'Enter' || e.key === ' ') onItemClick(it)
                }}
              >
                <div className="content-inserted-card-head">
                  <div
                    className="content-inserted-card-order"
                    aria-label={`${it.order}번째 내지`}
                  >
                    {it.order}
                  </div>
                  <p className="content-inserted-card-title">{it.templateName}</p>
                </div>
                <div className="content-inserted-card-pair">
                  <div className="content-inserted-card-cell">
                    <span className="content-inserted-card-caption">
                      템플릿 레이아웃
                    </span>
                    <div className="content-inserted-card-imgwrap">
                      {it.layoutThumbUrl ? (
                        <img
                          src={
                            proxiedImageSrcIfRemote(it.layoutThumbUrl) ??
                            it.layoutThumbUrl
                          }
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        <span className="muted small">이미지 없음</span>
                      )}
                    </div>
                  </div>
                  <div className="content-inserted-card-cell">
                    <span className="content-inserted-card-caption">
                      포함 사진 한 장
                    </span>
                    <div className="content-inserted-card-imgwrap">
                      {showPhoto ? (
                        <PreviewImgChain urls={[primary, original, fallback]} />
                      ) : (
                        <span className="muted small">
                          {fn
                            ? '미리보기 URL 없음(사진 목록에 썸네일·파일명 확인)'
                            : '선택된 사진 없음'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
        <button
          type="button"
          className="content-inserted-strip-nav"
          aria-label="다음 카드"
          onClick={() => scrollBy(280)}
        >
          ›
        </button>
      </div>
    </section>
  )
}

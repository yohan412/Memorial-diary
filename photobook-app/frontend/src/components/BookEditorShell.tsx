import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../context/AppContext'

type Props = {
  title: string
  /** 표지 | 내지 탭 구분 */
  kind: 'cover' | 'content'
  /** 상단 알림·배너 */
  alerts?: ReactNode
  /** 왼쪽: 템플릿 선택·자산 */
  left: ReactNode
  /** 가운데: 레이아웃 미리보기 */
  canvas: ReactNode
  /** 오른쪽: 파라미터·적용 */
  right: ReactNode
  /** 3열 그리드 아래 (예: 삽입된 내지 스트립) */
  belowGrid?: ReactNode
  footer?: ReactNode
}

export default function BookEditorShell({
  title,
  kind,
  alerts,
  left,
  canvas,
  right,
  belowGrid,
  footer,
}: Props) {
  const { workflowStage } = useApp()
  const contentsLocked = kind === 'cover' && (workflowStage ?? 0) < 3

  return (
    <div className="book-editor-page">
      <header className="book-editor-topbar">
        <div className="book-editor-topbar-text">
          <h1 className="book-editor-title">{title}</h1>
          <p className="book-editor-sub muted small">
            <strong>템플릿</strong>, <strong>미리보기</strong>, <strong>속성</strong>을 한
            화면에서 조정합니다.
          </p>
        </div>
        <div className="book-editor-tabs" role="tablist" aria-label="편집 영역">
          <Link
            to="/cover"
            className={`book-editor-tab ${kind === 'cover' ? 'active' : ''}`}
          >
            표지
          </Link>
          {contentsLocked ? (
            <span
              className="book-editor-tab book-editor-tab--locked"
              title="표지 적용을 먼저 완료하세요."
            >
              내지
            </span>
          ) : (
            <Link
              to="/contents"
              className={`book-editor-tab ${kind === 'content' ? 'active' : ''}`}
            >
              내지
            </Link>
          )}
        </div>
      </header>

      {alerts ? <div className="book-editor-alerts">{alerts}</div> : null}

      <div className="book-editor-grid">
        <aside className="book-editor-panel book-editor-panel--left">
          <div className="book-editor-panel-head">템플릿 · 자산</div>
          <div className="book-editor-panel-body">{left}</div>
        </aside>
        <section
          className="book-editor-panel book-editor-panel--canvas"
          aria-label="캔버스"
        >
          <div className="book-editor-panel-head">캔버스</div>
          <div className="book-editor-panel-body book-editor-panel-body--canvas">
            {canvas}
          </div>
        </section>
        <aside className="book-editor-panel book-editor-panel--right">
          <div className="book-editor-panel-head">속성</div>
          <div className="book-editor-panel-body">{right}</div>
        </aside>
      </div>

      {belowGrid ? (
        <div className="book-editor-below-grid">{belowGrid}</div>
      ) : null}

      {footer ? <footer className="book-editor-footer">{footer}</footer> : null}
    </div>
  )
}

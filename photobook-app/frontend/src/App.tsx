import {
  Navigate,
  Route,
  Routes,
  Link,
  useLocation,
} from 'react-router-dom'
import { AppProvider, useApp } from './context/AppContext'
import PipelineRoute from './components/PipelineRoute'
import LandingPage from './pages/LandingPage'
import BookSetupPage from './pages/BookSetupPage'
import ManageBooksOrdersPage from './pages/ManageBooksOrdersPage'
import ColorizePage from './pages/ColorizePage'
import PhotosUploadPage from './pages/PhotosUploadPage'
import CoverPage from './pages/CoverPage'
import ContentsPage from './pages/ContentsPage'
import OrderPage from './pages/OrderPage'
import OrderDetailPage from './pages/OrderDetailPage'
import type { NavStepPath } from './utils/workflowGates'
import { navStepEnabled } from './utils/workflowGates'

const steps = [
  { path: '/book/setup', label: '설정' },
  { path: '/manage', label: '책·주문' },
  { path: '/colorize', label: '컬러화' },
  { path: '/photos/upload', label: '사진' },
  { path: '/cover', label: '표지' },
  { path: '/contents', label: '본문' },
  { path: '/order', label: '주문' },
]

function NavBar() {
  const loc = useLocation()
  const ctx = useApp()
  return (
    <header className="top-nav">
      <Link to="/" className="brand">
        Memorial diary
      </Link>
      <nav className="steps">
        {steps.map((s) => {
          const active =
            s.path === '/order'
              ? loc.pathname === '/order' ||
                loc.pathname.startsWith('/orders/')
              : loc.pathname === s.path
          const gateCtx = {
            bookUid: ctx.bookUid,
            bookSpecUid: ctx.bookSpecUid,
            workflowStage: ctx.workflowStage,
            uploadedPhotoNames: ctx.uploadedPhotoNames,
          }
          const enabled = navStepEnabled(s.path as NavStepPath, gateCtx)
          if (!enabled) {
            return (
              <span
                key={s.path}
                className={`nav-step-locked${active ? ' active' : ''}`}
                title="이전 단계를 먼저 완료하세요."
              >
                {s.label}
              </span>
            )
          }
          return (
            <Link key={s.path} to={s.path} className={active ? 'active' : ''}>
              {s.label}
            </Link>
          )
        })}
      </nav>
    </header>
  )
}

function Shell() {
  const loc = useLocation()
  const { hasStarted } = useApp()
  const isLanding = loc.pathname === '/'
  const editorWorkspace =
    loc.pathname === '/cover' || loc.pathname === '/contents'
  if (!hasStarted && !isLanding) {
    return <Navigate to="/" replace />
  }
  return (
    <>
      <NavBar />
      <main
        className={
          isLanding
            ? 'main main--landing'
            : editorWorkspace
              ? 'main main--editor-workspace'
              : 'main'
        }
      >
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/book/setup" element={<BookSetupPage />} />
          <Route path="/manage" element={<ManageBooksOrdersPage />} />
          <Route
            path="/colorize"
            element={
              <PipelineRoute route="colorize">
                <ColorizePage />
              </PipelineRoute>
            }
          />
          <Route
            path="/photos/upload"
            element={
              <PipelineRoute route="photos">
                <PhotosUploadPage />
              </PipelineRoute>
            }
          />
          <Route
            path="/cover"
            element={
              <PipelineRoute route="cover">
                <CoverPage />
              </PipelineRoute>
            }
          />
          <Route
            path="/contents"
            element={
              <PipelineRoute route="contents">
                <ContentsPage />
              </PipelineRoute>
            }
          />
          <Route path="/orders/:orderUid" element={<OrderDetailPage />} />
          <Route path="/order" element={<OrderPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}

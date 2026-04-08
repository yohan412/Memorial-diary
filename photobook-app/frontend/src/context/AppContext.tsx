import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export const PHOTOBOOK_META_STORAGE_KEY = 'photobook_app_meta_v1'
const STORAGE_KEY = PHOTOBOOK_META_STORAGE_KEY

export type ColorItem = {
  id: string
  name: string
  originalDataUrl: string
  resultBase64?: string
  /** 컬러화 API 응답: deoldify | stub */
  engine?: 'deoldify' | 'stub'
  /** 입력 대비 평균 RGB 차이(약 2 미만이면 거의 원본과 동일) */
  meanAbsDiff?: number
  status: 'pending' | 'processing' | 'done' | 'error'
  error?: string
}

export type AppMeta = {
  /** API 없이 UI 데모(샘플 데이터) 모드 */
  demoMode?: boolean
  /** 랜딩에서 시작 버튼을 눌렀는지 (직접 URL 진입 차단용) */
  hasStarted?: boolean
  bookSpecUid: string | null
  bookTitle: string
  coverTemplateUid: string
  contentTemplateUid: string
  bookUid: string | null
  /** Sweetbook 업로드 후 파일명 (표지/내지 파라미터에 사용) */
  uploadedPhotoNames: string[]
  /**
   * 책 제작 순서 강제: 0=설정까지, 1=컬러화 완료, 2=사진 업로드 완료, 3=표지 적용 완료 → 본문 허용
   */
  workflowStage: number
}

type Ctx = AppMeta & {
  colorItems: ColorItem[]
  /** 업로드된 Sweetbook 파일명 → 미리보기 data URL (메모리만, 새로고침 시 비움) */
  uploadedPhotoPreviewByName: Record<string, string>
  initDemo: () => void
  exitDemo: () => void
  markStarted: () => void
  setBookSpecUid: (v: string | null) => void
  setBookTitle: (v: string) => void
  setCoverTemplateUid: (v: string) => void
  setContentTemplateUid: (v: string) => void
  setBookUid: (v: string | null) => void
  setUploadedPhotoNames: (
    v: string[] | ((prev: string[]) => string[]),
  ) => void
  setUploadedPhotoPreviewByName: (
    v:
      | Record<string, string>
      | ((p: Record<string, string>) => Record<string, string>),
  ) => void
  setColorItems: (v: ColorItem[] | ((p: ColorItem[]) => ColorItem[])) => void
  resetSession: () => void
  loadMeta: () => void
  persistMeta: () => void
  /** 메타 갱신 + sessionStorage 동기화 (업로드·단계를 한 번에 반영할 때 사용) */
  applyMeta: (fn: (m: AppMeta) => AppMeta) => void
}

const defaultMeta: AppMeta = {
  demoMode: false,
  hasStarted: false,
  bookSpecUid: null,
  bookTitle: '',
  coverTemplateUid: '',
  contentTemplateUid: '',
  bookUid: null,
  uploadedPhotoNames: [],
  workflowStage: 0,
}

const AppContext = createContext<Ctx | null>(null)

function readStoredMeta(): Partial<AppMeta> {
  try {
    const s = sessionStorage.getItem(STORAGE_KEY)
    if (!s) return {}
    const raw = JSON.parse(s) as Partial<AppMeta>
    const ws = raw.workflowStage
    return {
      ...raw,
      demoMode: Boolean(raw.demoMode),
      hasStarted: Boolean(raw.hasStarted),
      workflowStage:
        typeof ws === 'number' && Number.isFinite(ws)
          ? Math.min(3, Math.max(0, Math.floor(ws)))
          : defaultMeta.workflowStage,
    }
  } catch {
    return {}
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<AppMeta>(() => ({
    ...defaultMeta,
    ...readStoredMeta(),
  }))
  const [colorItems, setColorItems] = useState<ColorItem[]>([])
  const [uploadedPhotoPreviewByName, setUploadedPhotoPreviewByName] = useState<
    Record<string, string>
  >({})

  /** 앨범(bookUid)이 바뀌면 이전 책 전용 메모리 상태는 버림 (컬러화·업로드 미리보기 등) */
  useEffect(() => {
    setUploadedPhotoPreviewByName({})
    setColorItems([])
  }, [meta.bookUid])

  const persistMeta = useCallback(() => {
    const payload: AppMeta = { ...meta, uploadedPhotoNames: meta.uploadedPhotoNames }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }, [meta])

  const applyMeta = useCallback((fn: (m: AppMeta) => AppMeta) => {
    setMeta((m) => {
      const next = fn(m)
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const loadMeta = useCallback(() => {
    setMeta((m) => ({ ...m, ...readStoredMeta() }))
  }, [])

  const setBookSpecUid = useCallback((bookSpecUid: string | null) => {
    setMeta((m) => ({ ...m, bookSpecUid }))
  }, [])
  const setBookTitle = useCallback((bookTitle: string) => {
    setMeta((m) => ({ ...m, bookTitle }))
  }, [])
  const setCoverTemplateUid = useCallback((coverTemplateUid: string) => {
    setMeta((m) => ({ ...m, coverTemplateUid }))
  }, [])
  const setContentTemplateUid = useCallback((contentTemplateUid: string) => {
    setMeta((m) => ({ ...m, contentTemplateUid }))
  }, [])
  const setBookUid = useCallback((bookUid: string | null) => {
    setMeta((m) => {
      if (m.bookUid === bookUid) return { ...m, bookUid }
      const next: AppMeta = {
        ...m,
        bookUid,
        uploadedPhotoNames: [],
        workflowStage: 0,
      }
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])
  const setUploadedPhotoNames = useCallback(
    (uploadedPhotoNames: string[] | ((prev: string[]) => string[])) => {
      setMeta((m) => {
        const next: AppMeta = {
          ...m,
          uploadedPhotoNames:
            typeof uploadedPhotoNames === 'function'
              ? uploadedPhotoNames(m.uploadedPhotoNames)
              : uploadedPhotoNames,
        }
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        return next
      })
    },
    [],
  )

  const resetSession = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY)
    setMeta({ ...defaultMeta })
    setColorItems([])
    setUploadedPhotoPreviewByName({})
  }, [])

  const initDemo = useCallback(() => {
    const now = Date.now()
    const demoBookUid = 'demo-book-1'
    const demoUploaded = ['demo-bw1.png', 'demo-bw2.png', 'demo-bw3.png', 'demo-bw4.png']

    const next: AppMeta = {
      demoMode: true,
      hasStarted: true,
      bookSpecUid: 'photobook-demo',
      bookTitle: 'TEST 추억 앨범',
      coverTemplateUid: 'demo-cover-1',
      contentTemplateUid: 'demo-content-1',
      bookUid: demoBookUid,
      uploadedPhotoNames: demoUploaded,
      workflowStage: 3,
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setMeta(next)

    // 컬러화는 ColorizePage에서 "원본 자동 업로드"까지만 하고,
    // 사용자가 버튼을 눌러야 결과가 채워지도록 한다.
    setColorItems([])
    setUploadedPhotoPreviewByName({
      'demo-bw1.png': '/demo/bw/bw1.png',
      'demo-bw2.png': '/demo/bw/bw2.png',
      'demo-bw3.png': '/demo/bw/bw3.png',
      'demo-bw4.png': '/demo/bw/bw4.png',
    })

    // 내지 30p 데모(ContentsPage가 읽는 sessionStorage 키를 미리 채움)
    const queueKey = `photobook_content_queue_v2_${demoBookUid}`
    const postedKey = `photobook_content_posted_v1_${demoBookUid}`
    const countKey = `photobook_content_post_success_count_v1_${demoBookUid}`

    const mkPending = (i: number) => {
      const photo = demoUploaded[i % demoUploaded.length]
      const id = `demo-content-${i + 1}`
      return {
        id,
        order: i,
        templateUid: 'demo-content-1',
        templateName: 'DEMO 내지 템플릿',
        breakBefore: 'none',
        parameters: {
          title: `기억 ${i + 1}`,
          date: '2026-04-06',
          photoFileName: photo,
        },
        layoutThumbUrl: '/demo/bw/bw1.png',
        photoFileName: photo,
        fingerprint: `demo-content-1|${photo}|${i}`,
        createdAt: now,
        attempts: 0,
        lastAttemptAt: null,
      }
    }
    const posted = Array.from({ length: 30 }, (_, i) => {
      const p = mkPending(i)
      return {
        id: p.id,
        order: p.order,
        templateUid: p.templateUid,
        templateName: p.templateName,
        breakBefore: p.breakBefore,
        parameters: p.parameters,
        layoutThumbUrl: p.layoutThumbUrl,
        photoFileName: p.photoFileName,
        fingerprint: p.fingerprint,
        createdAt: p.createdAt,
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
  }, [])

  const exitDemo = useCallback(() => {
    // 데모 상태를 끄고, 데모에서 자동으로 채웠던 메타만 기본값으로 되돌린다.
    setMeta((m) => {
      const next: AppMeta = {
        ...m,
        demoMode: false,
        hasStarted: true,
        bookSpecUid: null,
        bookTitle: '',
        coverTemplateUid: '',
        contentTemplateUid: '',
        bookUid: null,
        uploadedPhotoNames: [],
        workflowStage: 0,
      }
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
    setColorItems([])
    setUploadedPhotoPreviewByName({})
  }, [])

  const markStarted = useCallback(() => {
    setMeta((m) => {
      if (m.hasStarted) return m
      const next: AppMeta = { ...m, hasStarted: true }
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const value = useMemo<Ctx>(
    () => ({
      ...meta,
      colorItems,
      uploadedPhotoPreviewByName,
      initDemo,
      exitDemo,
      markStarted,
      setBookSpecUid,
      setBookTitle,
      setCoverTemplateUid,
      setContentTemplateUid,
      setBookUid,
      setUploadedPhotoNames,
      setUploadedPhotoPreviewByName,
      setColorItems,
      resetSession,
      loadMeta,
      persistMeta,
      applyMeta,
    }),
    [
      meta,
      colorItems,
      uploadedPhotoPreviewByName,
      initDemo,
      exitDemo,
      markStarted,
      setBookSpecUid,
      setBookTitle,
      setCoverTemplateUid,
      setContentTemplateUid,
      setBookUid,
      setUploadedPhotoNames,
      setUploadedPhotoPreviewByName,
      resetSession,
      loadMeta,
      persistMeta,
      applyMeta,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const c = useContext(AppContext)
  if (!c) throw new Error('useApp outside AppProvider')
  return c
}

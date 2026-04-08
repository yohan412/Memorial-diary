import { useEffect, useState } from 'react'
import { apiGet, unwrapArray } from '../api'
import { useApp } from '../context/AppContext'
import {
  parseTemplateDefinitions,
  parsedTemplateIsMealOrNapRoutine,
} from '../utils/templateParams'
import {
  dedupeTemplatesByUid,
  pickTemplateUid,
  type TemplateRow,
} from '../utils/sweetbookTemplateList'
import { mergeTemplateDetailForPreview } from '../utils/templateThumbnails'
import { DEMO_BOOK_SPEC_UID, DEMO_TEMPLATES } from '../demo/demoData'

/**
 * GET /templates?bookSpecUid=&templateKind=
 * 내지(content)는 각 템플릿 상세를 조회해 식사·낮잠 관련 파라미터(또는 템플릿명)가 있으면 목록에서 제외합니다.
 */
export function useTemplatesForBookSpec(
  bookSpecUid: string | null,
  templateKind: 'cover' | 'content',
) {
  const { demoMode } = useApp()
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (demoMode && bookSpecUid === DEMO_BOOK_SPEC_UID) {
      setTemplates((DEMO_TEMPLATES[templateKind] ?? []) as TemplateRow[])
      setErr(null)
      setLoading(false)
      return
    }
    if (!bookSpecUid) {
      setTemplates([])
      setErr(null)
      return
    }
    let cancel = false
    setLoading(true)
    setErr(null)
    void (async () => {
      try {
        const r = await apiGet('/templates', { bookSpecUid, templateKind })
        if (cancel) return
        let list = unwrapArray(r?.data, ['templates', 'items', 'list']) as TemplateRow[]
        list = dedupeTemplatesByUid(list)

        if (templateKind === 'content' && list.length > 0) {
          const flags = await Promise.all(
            list.map(async (t) => {
              const uid = pickTemplateUid(t)
              if (!uid) return { t, exclude: false }
              try {
                const tr = await apiGet(`/templates/${encodeURIComponent(uid)}`)
                if (cancel) return { t, exclude: false }
                const merged = mergeTemplateDetailForPreview(tr)
                const p = parseTemplateDefinitions(merged)
                return {
                  t,
                  exclude: parsedTemplateIsMealOrNapRoutine(p),
                }
              } catch {
                return { t, exclude: false }
              }
            }),
          )
          list = flags.filter((x) => !x.exclude).map((x) => x.t)
        }

        if (!cancel) setTemplates(list)
      } catch (e) {
        if (!cancel) {
          setErr(e instanceof Error ? e.message : String(e))
          setTemplates([])
        }
      } finally {
        if (!cancel) setLoading(false)
      }
    })()
    return () => {
      cancel = true
    }
  }, [bookSpecUid, templateKind])

  return {
    templates,
    templatesLoading: loading,
    templatesErr: err,
  }
}

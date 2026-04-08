import { useEffect, useMemo, useState } from 'react'
import { apiGet } from '../api'
import { useApp } from '../context/AppContext'
import {
  initialValuesFromFields,
  parseTemplateDefinitions,
  type ParsedTemplate,
} from '../utils/templateParams'
import { mergeTemplateDetailForPreview } from '../utils/templateThumbnails'
import { DEMO_TEMPLATE_DETAIL } from '../demo/demoData'

export type SweetbookTemplateParamsOptions = {
  /** GET 표지 등에서 받은 값 — 템플릿 필드와 키가 맞는 항목만 폼에 채움 */
  seedValues?: Record<string, unknown> | null
}

export function useSweetbookTemplateParameters(
  templateUid: string,
  options?: SweetbookTemplateParamsOptions,
) {
  const { demoMode } = useApp()
  const seedValues = options?.seedValues ?? null
  const seedKey = useMemo(
    () => (seedValues && Object.keys(seedValues).length ? JSON.stringify(seedValues) : ''),
    [seedValues],
  )

  const [parsed, setParsed] = useState<ParsedTemplate | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetchErr, setFetchErr] = useState<string | null>(null)
  const [paramValues, setParamValues] = useState<Record<string, unknown>>({})

  useEffect(() => {
    const uid = templateUid.trim()
    if (!uid) {
      setParsed(null)
      setParamValues({})
      setFetchErr(null)
      return
    }
    if (demoMode && Object.prototype.hasOwnProperty.call(DEMO_TEMPLATE_DETAIL, uid)) {
      setLoading(true)
      setFetchErr(null)
      try {
        const res = DEMO_TEMPLATE_DETAIL[uid] as unknown
        const data = mergeTemplateDetailForPreview(res)
        const p = parseTemplateDefinitions(data)
        setParsed(p)
        setParamValues(initialValuesFromFields(p.fields))
      } catch (e) {
        setFetchErr(e instanceof Error ? e.message : String(e))
        setParsed(null)
        setParamValues({})
      } finally {
        setLoading(false)
      }
      return
    }
    let cancel = false
    setLoading(true)
    setFetchErr(null)
    apiGet(`/templates/${encodeURIComponent(uid)}`)
      .then((res) => {
        if (cancel) return
        const data = mergeTemplateDetailForPreview(res)
        const p = parseTemplateDefinitions(data)
        setParsed(p)
        setParamValues(initialValuesFromFields(p.fields))
      })
      .catch((e: Error) => {
        if (!cancel) {
          setFetchErr(e.message)
          setParsed(null)
          setParamValues({})
        }
      })
      .finally(() => {
        if (!cancel) setLoading(false)
      })
    return () => {
      cancel = true
    }
  }, [templateUid, demoMode])

  useEffect(() => {
    if (!parsed?.fields.length || !seedKey) return
    let seed: Record<string, unknown>
    try {
      seed = JSON.parse(seedKey) as Record<string, unknown>
    } catch {
      return
    }
    setParamValues((prev) => {
      const next = { ...prev }
      let changed = false
      for (const f of parsed.fields) {
        if (!Object.prototype.hasOwnProperty.call(seed, f.key)) continue
        const v = seed[f.key]
        if (v !== undefined && next[f.key] !== v) {
          next[f.key] = v
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [parsed?.templateUid, parsed?.fields.length, seedKey])

  return { parsed, loading, fetchErr, paramValues, setParamValues }
}

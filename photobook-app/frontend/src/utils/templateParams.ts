/**
 * Sweetbook GET /templates/{templateUid} 응답의 parameters.definitions 파싱.
 * @see https://api.sweetbook.com/docs/
 */

export type TemplateParamField = {
  key: string
  binding: string
  type: string
  required?: boolean
  description?: string
  default?: unknown
  itemType?: string
  minItems?: number
  maxItems?: number
}

export type ParsedTemplate = {
  templateUid?: string
  templateName?: string
  templateKind?: string
  bookSpecUid?: string
  fields: TemplateParamField[]
  rawData: unknown
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * GET /templates/{uid} 응답에서 파라미터·썸네일이 들어 있는 객체 추출.
 * @see https://api.sweetbook.com/docs/api/templates/ (상세: parameters, thumbnails)
 */
export function unwrapTemplateData(res: unknown): Record<string, unknown> | null {
  if (!isRecord(res)) return null
  const d = res.data
  if (!isRecord(d)) return null

  const inner = (k: string): Record<string, unknown> | null => {
    const v = d[k]
    return isRecord(v) ? v : null
  }

  for (const key of [
    'template',
    'item',
    'payload',
    'result',
    'detail',
  ] as const) {
    const n = inner(key)
    if (!n) continue
    if (
      n.parameters != null ||
      n.thumbnails != null ||
      typeof n.templateUid === 'string'
    ) {
      return n
    }
  }

  if (d.parameters != null || d.thumbnails != null || typeof d.templateUid === 'string') {
    return d
  }

  return d
}

export function parseTemplateDefinitions(data: unknown): ParsedTemplate {
  const root = isRecord(data) ? data : null
  const params = root && isRecord(root.parameters) ? root.parameters : null
  const definitions =
    params && isRecord(params.definitions) ? params.definitions : null

  const fields: TemplateParamField[] = []
  if (definitions) {
    for (const key of Object.keys(definitions)) {
      const def = definitions[key]
      if (!isRecord(def)) continue
      fields.push({
        key,
        binding: String(def.binding ?? 'text'),
        type: String(def.type ?? 'string'),
        required: Boolean(def.required),
        description:
          typeof def.description === 'string' ? def.description : undefined,
        default: def.default !== undefined ? def.default : undefined,
        itemType: typeof def.itemType === 'string' ? def.itemType : undefined,
        minItems: typeof def.minItems === 'number' ? def.minItems : undefined,
        maxItems: typeof def.maxItems === 'number' ? def.maxItems : undefined,
      })
    }
  }

  fields.sort((a, b) => a.key.localeCompare(b.key))

  return {
    templateUid: typeof root?.templateUid === 'string' ? root.templateUid : undefined,
    templateName:
      typeof root?.templateName === 'string' ? root.templateName : undefined,
    templateKind:
      typeof root?.templateKind === 'string' ? root.templateKind : undefined,
    bookSpecUid:
      typeof root?.bookSpecUid === 'string' ? root.bookSpecUid : undefined,
    fields,
    rawData: data,
  }
}

/** 내지 목록에서 빼는 테마: 식사·낮잠 문자열이 템플릿명 또는 파라미터에 있으면 true */
const MEAL_NAP_ROUTINE_MARKERS = ['식사', '낮잠'] as const

export function parsedTemplateIsMealOrNapRoutine(p: ParsedTemplate): boolean {
  const name = (p.templateName ?? '').trim()
  for (const m of MEAL_NAP_ROUTINE_MARKERS) {
    if (name.includes(m)) return true
  }
  for (const f of p.fields) {
    const desc = f.description ?? ''
    for (const m of MEAL_NAP_ROUTINE_MARKERS) {
      if (f.key.includes(m) || desc.includes(m)) return true
    }
  }
  return false
}

/** 필드 정의로부터 초기 값 객체 생성 */
export function initialValuesFromFields(
  fields: TemplateParamField[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    if (f.default !== undefined) {
      out[f.key] = f.default
      continue
    }
    if (f.binding === 'rowGallery' || (f.type === 'array' && f.itemType === 'file')) {
      out[f.key] = []
      continue
    }
    if (f.type === 'boolean') {
      out[f.key] = false
      continue
    }
    out[f.key] = ''
  }
  return out
}

export function isFileBinding(f: TemplateParamField): boolean {
  return f.binding === 'file' || f.binding === 'image'
}

export function isGalleryBinding(f: TemplateParamField): boolean {
  return (
    f.binding === 'rowGallery' ||
    (f.type === 'array' && (f.itemType === 'file' || f.itemType === 'image'))
  )
}

/** 표지·내지에서 색상(hex 등)을 넣는 필드 — 컬러 피커 UI에 사용 */
export function isColorField(f: TemplateParamField): boolean {
  if (isFileBinding(f) || isGalleryBinding(f)) return false
  const b = (f.binding || '').toLowerCase()
  const t = (f.type || '').toLowerCase()
  if (b === 'color' || t === 'color') return true
  const desc = f.description || ''
  if (/(#[0-9A-Fa-f]{3,8}(?![0-9A-Fa-f])|hex|rgb|rgba|색상|컬러|칼라)/i.test(desc))
    return true
  if (/(^|[_])(color|colour|hex)(_|$)/i.test(f.key)) return true
  if (/[a-z]Color$/i.test(f.key)) return true
  return false
}

/** <input type="color">용 6자리 #RRGGBB (알파 있으면 잘라냄) */
export function normalizeHexForColorInput(raw: string): string {
  const s = raw.trim()
  if (/^#[0-9A-Fa-f]{6}$/i.test(s)) return s.slice(0, 7).toLowerCase()
  if (/^#[0-9A-Fa-f]{3}$/i.test(s)) {
    const r = s[1],
      g = s[2],
      b = s[3]
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  if (/^#[0-9A-Fa-f]{8}$/i.test(s)) return `#${s.slice(1, 7)}`.toLowerCase()
  return '#000000'
}

/**
 * 스위트북 전송용 parameters 객체.
 * - definitions에 없는 키는 보내지 않음(이전 템플릿 잔여 키로 400 나는 것 방지).
 * - 선택 필드가 빈 문자열이면 키 생략.
 * - number 타입은 숫자로 직렬화.
 */
export function sanitizeParameterPayload(
  values: Record<string, unknown>,
  fields: TemplateParamField[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  for (const f of fields) {
    const raw = values[f.key]

    if (isGalleryBinding(f)) {
      const arr = Array.isArray(raw) ? raw : []
      const cleaned = arr.map((x) => String(x)).filter((s) => s.trim() !== '')
      if (cleaned.length > 0 || f.required) {
        out[f.key] = cleaned
      }
      continue
    }

    if (isFileBinding(f)) {
      const s = String(raw ?? '').trim()
      if (s === '') {
        if (f.required) out[f.key] = ''
        continue
      }
      out[f.key] = s
      continue
    }

    if (raw === undefined || raw === null) {
      continue
    }

    if (f.type === 'boolean') {
      out[f.key] = raw === true || raw === 'true'
      continue
    }

    if (f.type === 'number') {
      if (raw === '') {
        if (f.required) out[f.key] = ''
        continue
      }
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
      if (Number.isFinite(n)) {
        out[f.key] = n
      } else if (f.required) {
        out[f.key] = raw
      }
      continue
    }

    if (typeof raw === 'string') {
      const t = raw.trim()
      if (t === '' && !f.required) {
        continue
      }
      out[f.key] = raw
      continue
    }

    out[f.key] = raw
  }

  return out
}

/** 내지 삽입 카드용: 파라미터에서 첫 번째로 쓰인 사진 파일명 */
export function pickFirstPhotoFileName(
  values: Record<string, unknown>,
  fields: TemplateParamField[],
): string | null {
  for (const f of fields) {
    if (isGalleryBinding(f)) {
      const arr = values[f.key]
      if (Array.isArray(arr)) {
        for (const x of arr) {
          const s = String(x).trim()
          if (s) return s
        }
      }
    } else if (isFileBinding(f)) {
      const s = String(values[f.key] ?? '').trim()
      if (s) return s
    }
  }
  return null
}

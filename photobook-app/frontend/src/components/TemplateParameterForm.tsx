import type { TemplateParamField } from '../utils/templateParams'
import {
  isColorField,
  isFileBinding,
  isGalleryBinding,
  normalizeHexForColorInput,
} from '../utils/templateParams'
import { presentTemplateField } from '../utils/templateFieldKo'
import UploadedPhotoThumb from './UploadedPhotoThumb'

type Props = {
  fields: TemplateParamField[]
  values: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  uploadedPhotoNames: string[]
  /** 사진 업로드 직후 세션에만 채워짐(파일명 → data URL) */
  photoPreviewByName?: Record<string, string>
  /** 썸네일 실패 시 originalUrl 프록시 (이미지 가이드) */
  photoOriginalByName?: Record<string, string>
  /** 최종 폴백: 사진 바이너리 프록시 */
  photoFallbackByName?: Record<string, string>
}

function getStr(v: unknown): string {
  return v === undefined || v === null ? '' : String(v)
}

function getBool(v: unknown): boolean {
  return v === true || v === 'true'
}

function getStrArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => String(x))
}

export default function TemplateParameterForm({
  fields,
  values,
  onChange,
  uploadedPhotoNames,
  photoPreviewByName = {},
  photoOriginalByName,
  photoFallbackByName,
}: Props) {
  const setKey = (key: string, val: unknown) => {
    onChange({ ...values, [key]: val })
  }

  if (fields.length === 0) {
    return (
      <p className="muted small">
        이 템플릿은 입력 칸 정의가 비어 있습니다. 다른 템플릿을 선택하거나 API
        응답을 확인해 주세요.
      </p>
    )
  }

  return (
    <div className="dynamic-fields">
      {fields.map((f) => {
        const pres = presentTemplateField(f)
        const label = pres.label
        const req = f.required ? ' (필수)' : ''

        if (isGalleryBinding(f)) {
          const arr = getStrArray(values[f.key])
          return (
            <div key={f.key} className="field-block">
              <label>
                {label}
                {req}
              </label>
              {pres.hint ? (
                <p className="muted small field-block-hint">{pres.hint}</p>
              ) : null}
              {arr.map((row, idx) => (
                <div key={idx} className="row-gallery-row photo-param-row">
                  <UploadedPhotoThumb
                    fileName={row}
                    photoPreviewByName={photoPreviewByName}
                    photoOriginalByName={photoOriginalByName}
                    photoFallbackByName={photoFallbackByName}
                  />
                  <div className="photo-param-row-main">
                    <select
                      className="input"
                      value={row}
                      onChange={(e) => {
                        const next = [...arr]
                        next[idx] = e.target.value
                        setKey(f.key, next)
                      }}
                    >
                      <option value="">— 선택 —</option>
                      {uploadedPhotoNames.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        const next = arr.filter((_, i) => i !== idx)
                        setKey(f.key, next)
                      }}
                    >
                      행 삭제
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="btn"
                onClick={() => setKey(f.key, [...arr, ''])}
              >
                사진 행 추가
              </button>
            </div>
          )
        }

        if (isFileBinding(f)) {
          const fileVal = getStr(values[f.key])
          return (
            <div key={f.key} className="field-block">
              <label>
                {label}
                {req}
              </label>
              {pres.hint ? (
                <p className="muted small field-block-hint">{pres.hint}</p>
              ) : null}
              <div className="photo-param-row">
                <UploadedPhotoThumb
                  fileName={fileVal}
                  photoPreviewByName={photoPreviewByName}
                  photoOriginalByName={photoOriginalByName}
                  photoFallbackByName={photoFallbackByName}
                />
                <div className="photo-param-row-main">
                  <select
                    className="input"
                    value={fileVal}
                    onChange={(e) => setKey(f.key, e.target.value)}
                  >
                    <option value="">
                      {!f.required ? '— 없음 —' : '— 파일 선택 —'}
                    </option>
                    {uploadedPhotoNames.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )
        }

        if (f.type === 'boolean') {
          return (
            <div key={f.key} className="field-block checkbox-row">
              <label>
                <input
                  type="checkbox"
                  checked={getBool(values[f.key])}
                  onChange={(e) => setKey(f.key, e.target.checked)}
                />{' '}
                {label}
                {req}
              </label>
              {pres.hint ? (
                <p className="muted small field-block-hint">{pres.hint}</p>
              ) : null}
            </div>
          )
        }

        if (isColorField(f) && f.type !== 'number') {
          const str = getStr(values[f.key])
          const pickerSafe = normalizeHexForColorInput(str)
          return (
            <div key={f.key} className="field-block">
              <label>
                {label}
                {req}
              </label>
              {pres.hint ? (
                <p className="muted small field-block-hint">{pres.hint}</p>
              ) : null}
              <div className="color-field-row">
                <input
                  type="color"
                  className="input-color"
                  aria-label={`${label} 색상 선택`}
                  value={pickerSafe}
                  onChange={(e) => setKey(f.key, e.target.value)}
                />
                <input
                  className="input color-field-hex"
                  type="text"
                  value={str}
                  placeholder={pres.placeholder || '#RRGGBB'}
                  spellCheck={false}
                  onChange={(e) => setKey(f.key, e.target.value)}
                />
              </div>
            </div>
          )
        }

        return (
          <div key={f.key} className="field-block">
            <label>
              {label}
              {req}
            </label>
            {pres.hint ? (
              <p className="muted small field-block-hint">{pres.hint}</p>
            ) : null}
            <input
              className="input"
              type={f.type === 'number' ? 'number' : 'text'}
              value={getStr(values[f.key])}
              placeholder={pres.placeholder}
              onChange={(e) =>
                setKey(
                  f.key,
                  f.type === 'number'
                    ? e.target.value === ''
                      ? ''
                      : Number(e.target.value)
                    : e.target.value,
                )
              }
            />
          </div>
        )
      })}
    </div>
  )
}

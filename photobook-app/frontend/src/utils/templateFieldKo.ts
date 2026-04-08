import type { TemplateParamField } from './templateParams'
import { isFileBinding, isGalleryBinding } from './templateParams'

type Presentation = {
  label: string
  hint?: string
  placeholder?: string
}

const BY_KEY: Record<string, Presentation> = {
  dateRange: {
    label: '기간·날짜 문구',
    hint: '표지에 인쇄될 기간이나 날짜를 적습니다. 짧은 한 줄이면 됩니다.',
    placeholder: '예: 2024. 3. 12 ~ 2025. 1. 20',
  },
  frontPhoto: {
    label: '앞표지 사진',
    hint: '앞표지에 쓸 사진을 업로드 목록에서 고릅니다.',
  },
  backPhoto: {
    label: '뒷표지 사진',
    hint: '뒷표지에 쓸 사진을 업로드 목록에서 고릅니다.',
  },
  spineTitle: {
    label: '책등 제목',
    hint: '책등에 세로로 들어갈 짧은 제목입니다.',
    placeholder: '예: 우리 가족 앨범',
  },
  title: {
    label: '제목',
    hint: '책이나 페이지에 들어갈 제목입니다.',
    placeholder: '예: 봄나들이',
  },
  subtitle: {
    label: '부제',
    hint: '제목 아래에 붙는 짧은 문구입니다.',
    placeholder: '예: 제주 여행 기록',
  },
  author: {
    label: '이름·저자',
    hint: '표기할 이름이나 저자 문구입니다.',
    placeholder: '예: 홍길동',
  },
  message: {
    label: '메시지·문구',
    hint: '페이지에 넣을 짧은 메시지입니다.',
    placeholder: '예: 소중한 순간을 담았습니다.',
  },
  caption: {
    label: '사진 설명',
    hint: '사진 아래나 옆에 들어갈 설명입니다.',
    placeholder: '예: 첫날, 해변에서',
  },
  description: {
    label: '설명 문구',
    hint: '길이 제한이 있으면 짧게 적어 주세요.',
    placeholder: '예: 가족과 함께한 하루',
  },
  year: {
    label: '연도',
    hint: '표시할 연도입니다.',
    placeholder: '예: 2024',
  },
  month: {
    label: '월',
    hint: '표시할 월입니다.',
    placeholder: '예: 3',
  },
  day: {
    label: '일',
    hint: '표시할 날짜(일)입니다.',
    placeholder: '예: 12',
  },
}

function looksLikeTechnicalKey(s: string): boolean {
  return /^[a-z][a-zA-Z0-9]*$/.test(s) && /[a-z][A-Z]/.test(s)
}

/** API 필드 키·영문 설명을 UI에 노출하지 않고 한글 안내로 바꿉니다. */
export function presentTemplateField(f: TemplateParamField): Presentation {
  if (isGalleryBinding(f)) {
    return {
      label: '사진 모음',
      hint: '여러 장을 순서대로 고릅니다. 행마다 업로드한 파일명을 선택하세요.',
    }
  }
  if (isFileBinding(f)) {
    const mapped = BY_KEY[f.key]
    if (mapped) return { ...mapped, placeholder: undefined }
    if (f.description && !looksLikeTechnicalKey(f.description)) {
      return { label: '사진 선택', hint: f.description }
    }
    return {
      label: '사진 선택',
      hint: '이 칸에 들어갈 사진을 업로드 목록에서 고릅니다.',
    }
  }
  const mapped = BY_KEY[f.key]
  if (mapped) return mapped
  if (f.description && f.description.trim()) {
    const d = f.description.trim()
    if (!looksLikeTechnicalKey(d) && d.length > 2) {
      return {
        label: '입력',
        hint: d,
        placeholder: exampleForType(f.type),
      }
    }
  }
  return {
    label: '입력',
    hint: '템플릿에 맞게 짧게 적어 주세요.',
    placeholder: exampleForType(f.type),
  }
}

function exampleForType(type: string): string | undefined {
  if (type === 'number') return '예: 1'
  if (type === 'boolean') return undefined
  return '예: 원하는 문구'
}

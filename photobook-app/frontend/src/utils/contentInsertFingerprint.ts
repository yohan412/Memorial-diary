import type { ContentInsertedSnapshot } from '../components/ContentInsertedStrip'
import type { TemplateParamField } from './templateParams'
import { pickFirstPhotoFileName } from './templateParams'

/** 확장자만 다른 경우를 같은 파일로 본다 */
export function normalizeBaseName(name: string): string {
  const s = name.trim()
  const i = s.lastIndexOf('.')
  if (i <= 0) return s.toLowerCase()
  return s.slice(0, i).toLowerCase()
}

/**
 * 내지 1건 비교용 지문. 서버 GET 스냅샷은 주로 첫 사진 파일명만 온다고 가정하고,
 * 로컬도 첫 파일 기준으로 맞춘다(갤러리 다중은 첫 장만 매칭).
 */
export function fingerprintForContentInsert(args: {
  templateUid: string
  photoFileName: string | null
}): string {
  const t = args.templateUid.trim()
  const p = args.photoFileName?.trim()
    ? normalizeBaseName(args.photoFileName)
    : ''
  return `${t}\u0001${p}`
}

export function fingerprintFromPendingPayload(
  templateUid: string,
  paramValues: Record<string, unknown>,
  fields: TemplateParamField[],
): string {
  const photo = pickFirstPhotoFileName(paramValues, fields)
  return fingerprintForContentInsert({ templateUid, photoFileName: photo })
}

export function fingerprintFromSnapshot(s: ContentInsertedSnapshot): string {
  return fingerprintForContentInsert({
    templateUid: s.templateUid,
    photoFileName: s.photoFileName,
  })
}

/**
 * 서버 내지 목록 어딘가에 있는 연속 구간이, 큐 맨 앞부터 k개와 일치하는 최대 k.
 * 앞에 다른 내지가 있어도 오프셋을 찾아 맞춘다.
 */
/**
 * 서버 GET에 동일 지문의 내지가 나타난 만큼, 낙관적 카드를 FIFO로 제거한다.
 * (POST 직후 GET 지연 동안 카드가 사라지지 않게 할 때 사용)
 */
export function consumeOptimisticMatchingServer(
  server: ContentInsertedSnapshot[],
  optimistic: ContentInsertedSnapshot[],
): ContentInsertedSnapshot[] {
  const serverFps = server
    .filter((s) => s.templateUid !== '__server__' && !s.templateUid.startsWith('__'))
    .map(fingerprintFromSnapshot)
  const rem = [...optimistic]
  for (const fp of serverFps) {
    const i = rem.findIndex((o) => fingerprintFromSnapshot(o) === fp)
    if (i >= 0) rem.splice(i, 1)
  }
  return rem
}

export function longestSyncedQueuePrefix(
  serverSnapshots: ContentInsertedSnapshot[],
  queueFingerprints: string[],
): number {
  const S = serverSnapshots
    .filter((x) => x.templateUid && !x.templateUid.startsWith('__'))
    .map(fingerprintFromSnapshot)
  if (S.length === 0 || queueFingerprints.length === 0) return 0
  let best = 0
  for (let i = 0; i < S.length; i++) {
    if (S[i] !== queueFingerprints[0]) continue
    let k = 0
    while (
      k < queueFingerprints.length &&
      i + k < S.length &&
      S[i + k] === queueFingerprints[k]
    ) {
      k++
    }
    if (k > best) best = k
  }
  return best
}

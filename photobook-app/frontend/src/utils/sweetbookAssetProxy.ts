/** Sweetbook 스토리지 URL은 브라우저 직접 로드 시 차단되는 경우가 많아 앱 출처로 프록시 */
export function proxiedSweetbookImageUrl(remoteUrl: string): string {
  const s = remoteUrl.trim()
  if (!/^https?:\/\//i.test(s)) return s
  return `/api/sweetbook-asset?url=${encodeURIComponent(s)}`
}

/** 템플릿 layout 썸네일 등 — https 면 프록시, 이미 상대경로면 그대로 */
export function proxiedImageSrcIfRemote(
  url: string | null | undefined,
): string | null {
  if (!url?.trim()) return null
  const u = url.trim()
  if (/^https?:\/\//i.test(u)) return proxiedSweetbookImageUrl(u)
  return u
}

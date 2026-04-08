import type { AppMeta } from '../context/AppContext'

export type PipelineRouteName = 'colorize' | 'photos' | 'cover' | 'contents'

type Ctx = Pick<
  AppMeta,
  'bookUid' | 'bookSpecUid' | 'workflowStage' | 'uploadedPhotoNames'
>

/** 이전 단계를 건너뛰지 못하게 할 때 리다이렉트할 경로 (null이면 통과) */
export function pipelineRedirectForRoute(
  route: PipelineRouteName,
  ctx: Ctx,
): string | null {
  if (!ctx.bookUid?.trim() || !ctx.bookSpecUid?.trim()) {
    return '/book/setup'
  }
  const stage = ctx.workflowStage ?? 0
  if (route === 'colorize') return null
  if (route === 'photos') {
    if (stage < 1) return '/colorize'
    return null
  }
  if (route === 'cover') {
    if (stage < 1) return '/colorize'
    if (stage < 2 || ctx.uploadedPhotoNames.length === 0) {
      return '/photos/upload'
    }
    return null
  }
  if (route === 'contents') {
    if (stage < 1) return '/colorize'
    if (stage < 2 || ctx.uploadedPhotoNames.length === 0) {
      return '/photos/upload'
    }
    if (stage < 3) return '/cover'
    return null
  }
  return null
}

export type NavStepPath =
  | '/book/setup'
  | '/manage'
  | '/colorize'
  | '/photos/upload'
  | '/cover'
  | '/contents'
  | '/order'

/** 상단 네비: 해당 경로로 이동 가능하면 true */
export function navStepEnabled(path: NavStepPath, ctx: Ctx): boolean {
  if (path === '/book/setup' || path === '/manage') return true
  if (path === '/order') return true
  if (!ctx.bookUid?.trim() || !ctx.bookSpecUid?.trim()) return false
  const stage = ctx.workflowStage ?? 0
  if (path === '/colorize') return true
  if (path === '/photos/upload') return stage >= 1
  if (path === '/cover') {
    return stage >= 2 && ctx.uploadedPhotoNames.length > 0
  }
  if (path === '/contents') return stage >= 3
  return false
}

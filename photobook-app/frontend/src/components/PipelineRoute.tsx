import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import {
  type PipelineRouteName,
  pipelineRedirectForRoute,
} from '../utils/workflowGates'

type Props = {
  route: PipelineRouteName
  children: ReactNode
}

export default function PipelineRoute({ route, children }: Props) {
  const { bookUid, bookSpecUid, workflowStage, uploadedPhotoNames } = useApp()
  const to = pipelineRedirectForRoute(route, {
    bookUid,
    bookSpecUid,
    workflowStage,
    uploadedPhotoNames,
  })
  if (to) return <Navigate to={to} replace />
  return children
}

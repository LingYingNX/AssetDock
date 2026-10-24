import { lazy, Suspense } from 'react'
import type { EnvMapViewerProps } from './EnvMapViewer'

const EnvMapViewer = lazy(() =>
  import('./EnvMapViewer').then((module) => ({ default: module.EnvMapViewer }))
)

export function LazyEnvMapViewer(props: EnvMapViewerProps): React.JSX.Element {
  return (
    <Suspense fallback={<div className="empty" style={{ minHeight: 240 }}><span>加载环境图…</span></div>}>
      <EnvMapViewer {...props} />
    </Suspense>
  )
}

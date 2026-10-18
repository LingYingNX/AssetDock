import { lazy, Suspense } from 'react'
import type { Viewer3DProps } from './Viewer3D'

const Viewer3D = lazy(() => import('./Viewer3D').then((module) => ({ default: module.Viewer3D })))

/** Three.js 与模型加载器只在真正需要 3D 预览时加载。 */
export function LazyViewer3D(props: Viewer3DProps): React.JSX.Element {
  return (
    <Suspense fallback={<div className="empty" style={{ minHeight: 240 }}><span>加载 3D 预览…</span></div>}>
      <Viewer3D {...props} />
    </Suspense>
  )
}

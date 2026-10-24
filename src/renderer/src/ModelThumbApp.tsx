import { useEffect } from 'react'
import { LazyViewer3D } from './components/LazyViewer3D'
import type { Viewer3DFormat } from './components/Viewer3D'
import { DEFAULT_HDR, DEFAULT_HDR_SETTINGS } from './data/hdr-presets'

declare global {
  interface Window {
    __modelThumbState?: 'loading' | 'ready' | 'error'
  }
}

export default function ModelThumbApp(): React.JSX.Element {
  const params = new URLSearchParams(window.location.search)
  const url = params.get('url') ?? ''
  const format = (params.get('format') ?? 'GLB') as Viewer3DFormat

  useEffect(() => {
    window.__modelThumbState = 'loading'
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: '#4b5563'
      }}
    >
      <LazyViewer3D
        url={url}
        format={format}
        shade="render"
        hdr={DEFAULT_HDR}
        hdrSettings={DEFAULT_HDR_SETTINGS}
        onLoaded={() => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              window.__modelThumbState = 'ready'
            })
          })
        }}
        onError={() => {
          window.__modelThumbState = 'error'
        }}
      />
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

const LOAD_TIMEOUT_MS = 30_000
const MAX_SOURCE_BYTES = 512 * 1024 * 1024

export interface EnvMapViewerProps {
  url: string
  format: 'HDR' | 'EXR'
  exposure: number
  onError?: () => void
}

export function EnvMapViewer({ url, format, exposure, onError }: EnvMapViewerProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [url, format])

  useEffect(() => {
    if (failed) return
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let texture: THREE.Texture | null = null
    const abort = new AbortController()
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true })
    } catch {
      setFailed(true)
      onError?.()
      return
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = exposure
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.cursor = 'grab'
    renderer.domElement.tabIndex = 0
    renderer.domElement.setAttribute('aria-label', `${format} 环境贴图预览。拖拽旋转视角。`)
    host.appendChild(renderer.domElement)
    rendererRef.current = renderer

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100)
    camera.position.set(0, 0, 0.01)
    const resize = (): void => {
      const width = host.clientWidth || 1
      const height = host.clientHeight || 1
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(host)

    void (async () => {
      const started = Date.now()
      const response = await fetch(url, { signal: abort.signal })
      if (!response.ok) throw new Error(`media ${response.status}`)
      const total = Number(response.headers.get('content-length')) || 0
      if (total > MAX_SOURCE_BYTES) throw new Error('environment map exceeds 512 MB limit')
      if (!response.body) throw new Error('environment map response has no body')
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let loadedBytes = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        loadedBytes += value.length
        if (loadedBytes > MAX_SOURCE_BYTES) {
          await reader.cancel()
          throw new Error('environment map exceeds 512 MB limit')
        }
        chunks.push(value)
      }
      if (Date.now() - started > LOAD_TIMEOUT_MS) throw new Error('environment map load timed out')
      const data = new Uint8Array(loadedBytes)
      let offset = 0
      for (const chunk of chunks) {
        data.set(chunk, offset)
        offset += chunk.length
      }
      const loader = format === 'EXR'
        ? new (await import('three/examples/jsm/loaders/EXRLoader.js')).EXRLoader()
        : new (await import('three/examples/jsm/loaders/RGBELoader.js')).RGBELoader()
      const loaded = loader.createDataTexture(data.buffer)
      if (disposed) {
        loaded.dispose()
        return
      }
      texture = loaded
      texture.mapping = THREE.EquirectangularReflectionMapping
      texture.colorSpace = THREE.LinearSRGBColorSpace
      scene.background = texture
    })().catch(() => {
      if (disposed) return
      setFailed(true)
      onError?.()
    })
    const loadTimer = window.setTimeout(() => abort.abort(), LOAD_TIMEOUT_MS)

    let dragging = false
    let lastX = 0
    let lastY = 0
    const down = (event: PointerEvent): void => {
      dragging = true
      lastX = event.clientX
      lastY = event.clientY
      renderer.domElement.setPointerCapture(event.pointerId)
      renderer.domElement.style.cursor = 'grabbing'
    }
    const move = (event: PointerEvent): void => {
      if (!dragging) return
      const dx = event.clientX - lastX
      const dy = event.clientY - lastY
      lastX = event.clientX
      lastY = event.clientY
      camera.rotation.y += dx * 0.005
      camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x + dy * 0.005))
    }
    const up = (event: PointerEvent): void => {
      dragging = false
      renderer.domElement.releasePointerCapture(event.pointerId)
      renderer.domElement.style.cursor = 'grab'
    }
    renderer.domElement.addEventListener('pointerdown', down)
    renderer.domElement.addEventListener('pointermove', move)
    renderer.domElement.addEventListener('pointerup', up)
    renderer.domElement.addEventListener('pointercancel', up)

    let frame = 0
    const draw = (): void => {
      frame = requestAnimationFrame(draw)
      renderer.render(scene, camera)
    }
    frame = requestAnimationFrame(draw)

    return () => {
      disposed = true
      window.clearTimeout(loadTimer)
      abort.abort()
      cancelAnimationFrame(frame)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointerdown', down)
      renderer.domElement.removeEventListener('pointermove', move)
      renderer.domElement.removeEventListener('pointerup', up)
      renderer.domElement.removeEventListener('pointercancel', up)
      scene.background = null
      texture?.dispose()
      renderer.dispose()
      renderer.forceContextLoss?.()
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement)
      rendererRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, format, failed])

  useEffect(() => {
    if (rendererRef.current) rendererRef.current.toneMappingExposure = exposure
  }, [exposure])

  if (failed) return <div className="empty" style={{ minHeight: 240 }}><span>环境图加载失败</span></div>
  return <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
}

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

export type ViewKey = 'auto' | 'front' | 'side' | 'top' | 'back'

interface Viewer3DProps {
  url: string
  turntable: boolean
  wireframe: boolean
  view: ViewKey
  onError?: () => void
  onLoaded?: () => void
}

interface ViewerApi {
  applyProps: (turntable: boolean, wireframe: boolean, view: ViewKey) => void
}

/** dev 泄漏断言计数器 */
declare global {
  interface Window {
    __threeStats?: { mounts: number; disposes: number }
  }
}

const VIEW_POS: Record<Exclude<ViewKey, 'auto'>, [number, number, number]> = {
  front: [0, 0, 1],
  side: [1, 0, 0],
  top: [0, 1, 0.001],
  back: [0, 0, -1]
}

/**
 * three.js 实时 3D 渲染器(alpha 透出舞台玻璃底):
 * GLTFLoader(+Draco) 经 media 流加载,包围盒自适应取景;
 * 转台=模型绕 Y 自转,定格=相机切正交向;卸载对称释放。
 */
export function Viewer3D({ url, turntable, wireframe, view, onError, onLoaded }: Viewer3DProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<ViewerApi | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    window.__threeStats = window.__threeStats ?? { mounts: 0, disposes: 0 }
    window.__threeStats.mounts++

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      setFailed(true)
      onError?.()
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.outline = 'none'
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.enablePan = false

    const pmrem = new THREE.PMREMGenerator(renderer)
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04)
    scene.environment = envRT.texture
    scene.add(new THREE.AmbientLight(0xffffff, 0.35))

    const group = new THREE.Group()
    scene.add(group)

    const st = { turntable, wireframe, view, dist: 5 }

    const applyWire = (on: boolean): void => {
      group.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const m of mats) (m as THREE.MeshStandardMaterial).wireframe = on
      })
    }

    const applyView = (v: ViewKey): void => {
      const d = st.dist
      if (v === 'auto') {
        camera.position.set(0, d * 0.35, d)
      } else {
        const p = VIEW_POS[v]
        camera.position.set(p[0] * d, p[1] * d, p[2] * d)
      }
      controls.target.set(0, 0, 0)
      controls.update()
    }

    apiRef.current = {
      applyProps: (t, w, v) => {
        st.turntable = t
        st.view = v
        if (w !== st.wireframe) {
          st.wireframe = w
          applyWire(w)
        }
        if (v !== 'auto') applyView(v)
      }
    }

    const resize = (): void => {
      const w = host.clientWidth || 1
      const h = host.clientHeight || 1
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(host)

    /* 加载:media 流 → GLTFLoader.parse(Draco) */
    const draco = new DRACOLoader()
    draco.setDecoderPath('/gltf/draco/')
    const loader = new GLTFLoader()
    loader.setDRACOLoader(draco)

    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`media ${r.status}`)
        return r.arrayBuffer()
      })
      .then((buf) => new Promise<THREE.Group>((res, rej) => loader.parse(buf, '', (g) => res(g.scene), rej)))
      .then((model) => {
        if (disposed) return
        group.add(model)
        const box = new THREE.Box3().setFromObject(model)
        const size = box.getSize(new THREE.Vector3()).length() || 1
        const center = box.getCenter(new THREE.Vector3())
        model.position.sub(center)
        st.dist = size * 1.6
        camera.near = Math.max(size / 200, 0.01)
        camera.far = size * 30
        camera.updateProjectionMatrix()
        applyWire(st.wireframe)
        applyView(st.view)
        onLoaded?.()
      })
      .catch(() => {
        if (disposed) return
        setFailed(true)
        onError?.()
      })

    let raf = 0
    let last = performance.now()
    const loop = (t: number): void => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min((t - last) / 1000, 0.1)
      last = t
      if (st.turntable && st.view === 'auto') group.rotation.y += 0.35 * dt
      controls.update()
      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      envRT.dispose()
      pmrem.dispose()
      draco.dispose()
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
        for (const m of mats) m.dispose()
      })
      renderer.dispose()
      renderer.forceContextLoss?.()
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement)
      window.__threeStats!.disposes++
      apiRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  /* 控制属性同步 */
  useEffect(() => {
    apiRef.current?.applyProps(turntable, wireframe, view)
  }, [turntable, wireframe, view])

  if (failed) {
    return (
      <div className="empty" style={{ minHeight: 240 }}>
        <span>3D 模型加载失败</span>
      </div>
    )
  }
  return <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
}

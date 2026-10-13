import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { AssetFormat } from '../data/types'

export type ViewKey = 'auto' | 'front' | 'side' | 'top' | 'back'

interface Viewer3DProps {
  url: string
  format: Extract<AssetFormat, 'GLB' | 'FBX' | 'OBJ'>
  turntable: boolean
  wireframe: boolean
  view: ViewKey
  /** toneMappingExposure(0.4–1.6);调整不重建渲染器 */
  exposure?: number
  /** 加载进度:0–99 字节流 / null 解析中 / 100 完成 */
  onProgress?: (pct: number | null) => void
  onError?: () => void
  onLoaded?: () => void
}

interface ViewerApi {
  applyProps: (turntable: boolean, wireframe: boolean, view: ViewKey) => void
}

/**
 * 材质上可能挂贴图的槽位。
 *
 * glTF / FBX / OBJ 走的是不同的材质类型(MeshStandardMaterial / MeshPhysicalMaterial /
 * MeshPhongMaterial ...),同一张贴图挂哪个槽位取决于导出器,所以这里按「槽位名」枚举而不是
 * 按材质类分派 —— 三个示例模型与用户自备模型都能覆盖到,新增槽位只需往这张表里加名字。
 */
const MATERIAL_TEXTURE_SLOTS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'aoMap',
  'alphaMap',
  'bumpMap',
  'displacementMap',
  'lightMap',
  'specularMap',
  'envMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'transmissionMap',
  'thicknessMap',
  'specularIntensityMap',
  'specularColorMap',
  'anisotropyMap',
  'gradientMap',
  'matcap'
] as const

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
export function Viewer3D({ url, format, turntable, wireframe, view, exposure = 1, onProgress, onError, onLoaded }: Viewer3DProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<ViewerApi | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const onProgressRef = useRef(onProgress)
  onProgressRef.current = onProgress
  const [failed, setFailed] = useState(false)

  /* 曝光:直改 toneMappingExposure,不重建 */
  useEffect(() => {
    if (rendererRef.current) rendererRef.current.toneMappingExposure = exposure
  }, [exposure])

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
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = exposure
    rendererRef.current = renderer
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

    /* 加载:media 流式进度 → GLTFLoader.parse(Draco) */
    const draco = new DRACOLoader()
    draco.setDecoderPath('/gltf/draco/')
    const loader = new GLTFLoader()
    loader.setDRACOLoader(draco)

    async function fetchWithProgress(u: string): Promise<ArrayBuffer> {
      const res = await fetch(u)
      if (!res.ok) throw new Error(`media ${res.status}`)
      const total = Number(res.headers.get('content-length')) || 0
      if (!res.body) return res.arrayBuffer()
      const reader = res.body.getReader()
      const chunks: Uint8Array[] = []
      let loaded = 0
      let lastPct = -1
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        loaded += value.length
        if (total > 0) {
          const pct = Math.min(99, Math.floor((loaded / total) * 100))
          if (pct !== lastPct) {
            lastPct = pct
            onProgressRef.current?.(pct)
          }
        }
      }
      const buf = new Uint8Array(loaded)
      let off = 0
      for (const c of chunks) {
        buf.set(c, off)
        off += c.length
      }
      return buf.buffer
    }

    fetchWithProgress(url)
      .then((buf) => {
        if (disposed) return
        onProgressRef.current?.(null) // null = 解析阶段(旋转指示)
        if (format === 'OBJ') return new OBJLoader().parse(new TextDecoder().decode(buf))
        if (format === 'FBX') return new FBXLoader().parse(buf, '')
        return new Promise<THREE.Group>((res, rej) => loader.parse(buf, '', (g) => res(g.scene as THREE.Group), rej))
      })
      .then((model) => {
        if (disposed || !model) return
        onProgressRef.current?.(100)
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
      /* 环境贴图与 PMREM 渲染目标:场景先摘掉引用再释放,别让 scene 继续持有一张已释放的贴图 */
      scene.environment = null
      envRT.dispose()
      pmrem.dispose()
      draco.dispose()
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
        for (const m of mats) {
          /* 材质句柄之外,材质还持有贴图槽位(map / normalMap / roughnessMap ...)。
             只 dispose 材质不会带走这些贴图的显存,反复开关灯箱会一路累积。 */
          const record = m as unknown as Record<string, unknown>
          for (const slot of MATERIAL_TEXTURE_SLOTS) {
            const tex = record[slot] as { isTexture?: boolean; dispose?: () => void } | null | undefined
            if (tex && tex.isTexture === true) tex.dispose?.()
          }
          m.dispose()
        }
      })
      renderer.dispose()
      renderer.forceContextLoss?.()
      rendererRef.current = null
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement)
      window.__threeStats!.disposes++
      apiRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, format])

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

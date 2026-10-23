import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { modelBaseUrl, objMaterialUrls } from '../data/model-url'
import { hdrPreset, type HdrId } from '../data/hdr-presets'
import {
  MATERIAL_TEXTURE_SLOTS,
  normalizeEmissive,
  normalizeTransparency,
  toStandardMaterial
} from '../data/material-preview'
import type { AssetFormat } from '../data/types'

export type ModelShade = 'solid' | 'render'
const LOAD_TIMEOUT_MS = 20_000

export interface Viewer3DProps {
  url: string
  format: Extract<AssetFormat, 'GLB' | 'FBX' | 'OBJ'>
  shade: ModelShade
  hdr: HdrId
  /** 加载进度:0–99 字节流 / null 解析中 / 100 完成 */
  onProgress?: (pct: number | null) => void
  onError?: () => void
  onLoaded?: () => void
}

interface ViewerApi {
  applyShade: (mode: ModelShade) => void
  applyHdr: (id: HdrId) => void
}

/** dev 泄漏断言计数器 */
declare global {
  interface Window {
    __threeStats?: {
      mounts: number
      disposes: number
      preview?: 'mtl' | 'solid' | 'native'
      shade?: ModelShade
      env?: string
      background?: string
      envSwitches?: number
      envDisposals?: number
      materials?: number
      transparent?: number
      middlePan?: boolean
      camera?: [number, number, number]
      target?: [number, number, number]
    }
  }
}

/** 中文 3ds Max 导出的 OBJ/MTL 常为 GBK,UTF-8 出现替换字符时回退。 */
function decodeModelText(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder().decode(buf)
  if (!utf8.includes('\uFFFD')) return utf8
  try {
    return new TextDecoder('gbk').decode(buf)
  } catch {
    return utf8
  }
}

/** 按 OBJ 声明顺序取第一份可读 MTL;材质缺失不阻断模型本体。 */
async function loadObjMaterials(objText: string, baseUrl: string): Promise<MTLLoader.MaterialCreator | null> {
  for (const mtlUrl of objMaterialUrls(objText, baseUrl)) {
    try {
      const res = await fetch(mtlUrl)
      if (!res.ok) continue
      const mtlText = decodeModelText(await res.arrayBuffer()).replace(/\\/g, '/')
      const creator = new MTLLoader().parse(mtlText, new URL('.', mtlUrl).href)
      creator.preload()
      return creator
    } catch {
      /* 换下一份材质库 */
    }
  }
  return null
}

/**
 * three.js 实时 3D 渲染器:
 * 各格式按原文件目录加载,包围盒自适应取景;实体/渲染模式切换不重建渲染器。
 */
export function Viewer3D({
  url,
  format,
  shade,
  hdr,
  onProgress,
  onError,
  onLoaded
}: Viewer3DProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<ViewerApi | null>(null)
  const onProgressRef = useRef(onProgress)
  onProgressRef.current = onProgress
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [url, format])

  useEffect(() => {
    if (failed) return
    const host = hostRef.current
    if (!host) return
    let disposed = false
    window.__threeStats = window.__threeStats ?? { mounts: 0, disposes: 0 }
    window.__threeStats.mounts++
    window.__threeStats.materials = 0
    window.__threeStats.transparent = 0
    window.__threeStats.env = 'loading'
    window.__threeStats.background = 'none'
    window.__threeStats.envSwitches = 0
    window.__threeStats.envDisposals = 0

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      onProgressRef.current?.(100)
      setFailed(true)
      onError?.()
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.outline = 'none'
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.enablePan = true
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE
    controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN
    window.__threeStats!.middlePan = controls.mouseButtons.MIDDLE === THREE.MOUSE.PAN

    const pmrem = new THREE.PMREMGenerator(renderer)
    /* RoomEnvironment 只做首帧与加载失败兜底,成功后由 HDR 替换并释放。 */
    let envRT: THREE.WebGLRenderTarget | null = pmrem.fromScene(new RoomEnvironment(), 0.04)
    let hdrTexture: THREE.Texture | null = null
    let envToken = 0
    let currentHdr: HdrId | null = null
    scene.environment = envRT.texture
    scene.environmentIntensity = 1.35
    const applyHdr = (id: HdrId): void => {
      if (currentHdr === id) return
      const token = ++envToken
      const preset = hdrPreset(id)
      new EXRLoader().load(
        preset.url,
        (tex) => {
          if (disposed || token !== envToken) {
            tex.dispose()
            return
          }
          tex.mapping = THREE.EquirectangularReflectionMapping
          let rt: THREE.WebGLRenderTarget
          try {
            rt = pmrem.fromEquirectangular(tex)
          } catch {
            tex.dispose()
            window.__threeStats!.env = 'fallback'
            return
          }
          if (disposed || token !== envToken) {
            rt.dispose()
            tex.dispose()
            return
          }
          scene.environment = rt.texture
          scene.background = tex
          if (envRT) {
            envRT.dispose()
            window.__threeStats!.envDisposals = (window.__threeStats!.envDisposals ?? 0) + 1
          }
          envRT = rt
          hdrTexture?.dispose()
          hdrTexture = tex
          currentHdr = id
          window.__threeStats!.env = id
          window.__threeStats!.background = id
          window.__threeStats!.envSwitches = (window.__threeStats!.envSwitches ?? 0) + 1
        },
        undefined,
        () => {
          if (token === envToken) window.__threeStats!.env = 'fallback'
        }
      )
    }
    applyHdr(hdr)
    scene.add(new THREE.AmbientLight(0xffffff, 0.12))
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.55)
    keyLight.position.set(3, 5, 4)
    scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.18)
    fillLight.position.set(-4, 2, -3)
    scene.add(fillLight)

    const group = new THREE.Group()
    scene.add(group)
    const solidMaterial = new THREE.MeshStandardMaterial({
      color: 0x7b8491,
      roughness: 0.8,
      metalness: 0.02
    })
    const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
    const rememberMaterials = (model: THREE.Object3D): void => {
      model.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh) originalMaterials.set(mesh, mesh.material)
      })
    }
    let currentShade = shade
    const applyShade = (mode: ModelShade): void => {
      currentShade = mode
      group.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.material = mode === 'solid'
          ? solidMaterial
          : (originalMaterials.get(mesh) ?? mesh.material)
      })
      window.__threeStats!.shade = mode
    }

    apiRef.current = {
      applyShade,
      applyHdr
    }
    applyShade(currentShade)

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

    let loadTimer: ReturnType<typeof setTimeout> | null = null
    fetchWithProgress(url)
      .then(async (buf) => {
        if (disposed) return
        onProgressRef.current?.(null) // null = 解析阶段(旋转指示)
        const baseUrl = modelBaseUrl(url)
        if (format === 'OBJ') {
          const text = decodeModelText(buf)
          const materials = await loadObjMaterials(text, baseUrl)
          if (disposed) return
          const obj = new OBJLoader()
          if (materials) obj.setMaterials(materials)
          const model = obj.parse(text)
          window.__threeStats!.preview = materials ? 'mtl' : 'solid'
          return model
        }
        window.__threeStats!.preview = 'native'
        if (format === 'FBX') return new FBXLoader().parse(buf, baseUrl)
        return new Promise<THREE.Group>((res, rej) => loader.parse(buf, baseUrl, (g) => res(g.scene as THREE.Group), rej))
      })
      .then((model) => {
        if (loadTimer) clearTimeout(loadTimer)
        if (disposed) return
        if (!model) throw new Error('empty model')
        onProgressRef.current?.(100)
        group.add(model)
        const box = new THREE.Box3().setFromObject(model)
        const size = box.getSize(new THREE.Vector3()).length() || 1
        const center = box.getCenter(new THREE.Vector3())
        model.position.sub(center)
        const dist = size * 1.6
        camera.near = Math.max(size / 200, 0.01)
        camera.far = size * 30
        camera.updateProjectionMatrix()
        camera.position.set(0, dist * 0.35, dist)
        controls.target.set(0, 0, 0)
        controls.update()
        /* 材质归一:统一成 PBR,并清掉源文件把全不透明材质误标为透明的标记。 */
        const converted = new Map<THREE.Material, THREE.Material>()
        const convert = (src: THREE.Material): THREE.Material => {
          const cached = converted.get(src)
          if (cached) return cached
          const std = toStandardMaterial(src)
          if (std !== src) src.dispose()
          normalizeTransparency(std)
          normalizeEmissive(std)
          converted.set(src, std)
          return std
        }
        model.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (!mesh.isMesh) return
          if (Array.isArray(mesh.material)) mesh.material = mesh.material.map(convert)
          else if (mesh.material) mesh.material = convert(mesh.material)
        })
        rememberMaterials(model)
        const materials = new Set<THREE.Material>()
        let transparent = 0
        model.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (!mesh.isMesh) return
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          for (const material of mats) {
            if (!material || materials.has(material)) continue
            materials.add(material)
            if (material.transparent) transparent++
          }
        })
        window.__threeStats!.materials = materials.size
        window.__threeStats!.transparent = transparent
        applyShade(currentShade)
        onLoaded?.()
      })
      .catch(() => {
        if (loadTimer) clearTimeout(loadTimer)
        if (disposed) return
        onProgressRef.current?.(100)
        setFailed(true)
        onError?.()
      })
    loadTimer = setTimeout(() => {
      if (disposed) return
      onProgressRef.current?.(100)
      setFailed(true)
      onError?.()
    }, LOAD_TIMEOUT_MS)

    let raf = 0
    const loop = (): void => {
      raf = requestAnimationFrame(loop)
      controls.update()
      renderer.render(scene, camera)
      if (import.meta.env.DEV) {
        window.__threeStats!.camera = camera.position.toArray() as [number, number, number]
        window.__threeStats!.target = controls.target.toArray() as [number, number, number]
      }
    }
    raf = requestAnimationFrame(loop)

    return () => {
      disposed = true
      if (loadTimer) clearTimeout(loadTimer)
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      /* 环境贴图与 PMREM 渲染目标:场景先摘掉引用再释放,别让 scene 继续持有一张已释放的贴图 */
      scene.environment = null
      scene.background = null
      envRT?.dispose()
      hdrTexture?.dispose()
      pmrem.dispose()
      draco.dispose()
      const seenMaterials = new Set<THREE.Material>()
      const disposeMaterial = (m: THREE.Material): void => {
        if (seenMaterials.has(m)) return
        seenMaterials.add(m)
        const record = m as unknown as Record<string, unknown>
        for (const slot of MATERIAL_TEXTURE_SLOTS) {
          const tex = record[slot] as { isTexture?: boolean; dispose?: () => void } | null | undefined
          if (tex && tex.isTexture === true) tex.dispose?.()
        }
        m.dispose()
      }
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
        for (const m of mats) disposeMaterial(m)
      })
      for (const mats of originalMaterials.values()) {
        for (const m of Array.isArray(mats) ? mats : [mats]) disposeMaterial(m)
      }
      disposeMaterial(solidMaterial)
      renderer.dispose()
      renderer.forceContextLoss?.()
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement)
      window.__threeStats!.disposes++
      apiRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, format, failed])

  /* 控制属性同步 */
  useEffect(() => {
    apiRef.current?.applyShade(shade)
  }, [shade])

  useEffect(() => {
    apiRef.current?.applyHdr(hdr)
  }, [hdr])

  if (failed) {
    return (
      <div className="empty" style={{ minHeight: 240 }}>
        <span>3D 模型加载失败</span>
      </div>
    )
  }
  return <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
}

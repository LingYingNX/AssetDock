import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { modelBaseUrl, objMaterialUrls } from '../data/model-url'
import type { AssetFormat } from '../data/types'

export type ModelShade = 'solid' | 'render'
const LOAD_TIMEOUT_MS = 20_000

export interface Viewer3DProps {
  url: string
  format: Extract<AssetFormat,
    'GLB' | 'FBX' | 'OBJ' | 'PMD' | 'PMX' | 'STL' | 'PLY' | '3DS' |
    'DAE' | 'USDZ' | '3MF' | 'AMF' | 'VRML' | 'VRM'>
  shade: ModelShade
  /** 加载进度:0–99 字节流 / null 解析中 / 100 完成 */
  onProgress?: (pct: number | null) => void
  onError?: () => void
  onLoaded?: () => void
}

export type Viewer3DFormat = Viewer3DProps['format']

interface ViewerApi {
  applyShade: (mode: ModelShade) => void
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
    __threeStats?: {
      mounts: number
      disposes: number
      preview?: 'mtl' | 'solid' | 'native'
      shade?: ModelShade
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

/** 骨骼不完整时 SkinnedMesh.computeBoundingBox 会抛错，取景改用几何本体的包围盒。 */
function modelBounds(model: THREE.Object3D): THREE.Box3 {
  model.updateMatrixWorld(true)
  const box = new THREE.Box3()
  const part = new THREE.Box3()
  model.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    if (!mesh.geometry.boundingBox) return
    part.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld)
    box.union(part)
  })
  return box.isEmpty() ? new THREE.Box3().setFromObject(model) : box
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

async function loadExtendedModel(
  format: Viewer3DProps['format'],
  url: string,
  baseUrl: string,
  buffer: ArrayBuffer
): Promise<THREE.Object3D> {
  if (format === 'PMD' || format === 'PMX') {
    const manager = new THREE.LoadingManager()
    let pending = 0
    let resolveIdle: () => void = () => {}
    const idle = new Promise<void>((resolve) => {
      resolveIdle = resolve
    })
    const itemStart = manager.itemStart
    const itemEnd = manager.itemEnd
    manager.itemStart = (resourceUrl) => {
      pending++
      itemStart(resourceUrl)
    }
    manager.itemEnd = (resourceUrl) => {
      itemEnd(resourceUrl)
      pending--
      if (pending === 0) resolveIdle()
    }
    const { MMDLoader } = await import('@moeru/three-mmd')
    const loader = new MMDLoader(manager)
    loader.setResourcePath(baseUrl)
    const mmd = await loader.loadAsync(url)
    if (pending > 0) {
      let timer = 0
      await Promise.race([
        idle,
        new Promise<void>((resolve) => {
          timer = window.setTimeout(resolve, 5_000)
        })
      ])
      window.clearTimeout(timer)
    }
    mmd.mesh.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials) {
        const record = material as unknown as Record<string, unknown>
        let changed = false
        for (const slot of ['map', 'sphereMap', 'toonMap']) {
          const texture = record[slot] as THREE.Texture | null | undefined
          if (texture?.isTexture && texture.version === 0) {
            record[slot] = null
            changed = true
          }
        }
        if (changed) material.needsUpdate = true
      }
    })
    return mmd.mesh
  }
  if (format === 'STL') {
    const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js')
    return new THREE.Mesh(
      new STLLoader().parse(buffer),
      new THREE.MeshStandardMaterial({ color: 0x9aa4b2, roughness: 0.72, metalness: 0.05 })
    )
  }
  if (format === 'PLY') {
    const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js')
    return new THREE.Mesh(
      new PLYLoader().parse(buffer),
      new THREE.MeshStandardMaterial({ color: 0x9aa4b2, roughness: 0.72, metalness: 0.05, vertexColors: true })
    )
  }
  if (format === '3DS') {
    const { TDSLoader } = await import('three/examples/jsm/loaders/TDSLoader.js')
    const loader = new TDSLoader()
    loader.setResourcePath(baseUrl)
    return loader.loadAsync(url)
  }
  if (format === 'DAE') {
    const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js')
    const result = new ColladaLoader().parse(decodeModelText(buffer), baseUrl)
    if (!result) throw new Error('Collada model is empty')
    return result.scene
  }
  if (format === 'USDZ') {
    const { USDZLoader } = await import('three/examples/jsm/loaders/USDZLoader.js')
    return new USDZLoader().loadAsync(url)
  }
  if (format === '3MF') {
    const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js')
    return new ThreeMFLoader().parse(buffer)
  }
  if (format === 'AMF') {
    const { AMFLoader } = await import('three/examples/jsm/loaders/AMFLoader.js')
    return new AMFLoader().parse(buffer)
  }
  if (format === 'VRML') {
    const { VRMLLoader } = await import('three/examples/jsm/loaders/VRMLLoader.js')
    return new VRMLLoader().parse(decodeModelText(buffer), baseUrl)
  }
  throw new Error(`unsupported model format: ${format}`)
}

/**
 * three.js 实时 3D 渲染器(alpha 透出舞台玻璃底):
 * GLTFLoader(+Draco) 经 media 流加载,包围盒自适应取景;
 * 转台=模型绕 Y 自转,定格=相机切正交向;卸载对称释放。
 */
export function Viewer3D({ url, format, shade, onProgress, onError, onLoaded }: Viewer3DProps): React.JSX.Element {
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
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04)
    scene.environment = envRT.texture
    scene.add(new THREE.AmbientLight(0xffffff, 0.28))
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.25)
    keyLight.position.set(3, 5, 4)
    scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.45)
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
      applyShade
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
      if (total > 512 * 1024 * 1024) throw new Error('model exceeds 512 MB limit')
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
        if (loaded > 512 * 1024 * 1024) {
          await reader.cancel()
          throw new Error('model exceeds 512 MB limit')
        }
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
        if (format === 'GLB' || format === 'VRM') {
          return new Promise<THREE.Group>((res, rej) =>
            loader.parse(buf, baseUrl, (g) => res(g.scene as THREE.Group), rej)
          )
        }
        return loadExtendedModel(format, url, baseUrl, buf)
      })
      .then((model) => {
        if (loadTimer) clearTimeout(loadTimer)
        if (disposed) return
        if (!model) throw new Error('empty model')
        onProgressRef.current?.(100)
        group.add(model)
        const box = modelBounds(model)
        const dimensions = box.getSize(new THREE.Vector3())
        const size = dimensions.length() || 1
        const center = box.getCenter(new THREE.Vector3())
        model.position.sub(center)
        const alongX = dimensions.x <= dimensions.y && dimensions.x <= dimensions.z
        const alongY = !alongX && dimensions.y <= dimensions.z
        const horizontal = alongX ? dimensions.z : dimensions.x
        const vertical = alongY ? dimensions.z : dimensions.y
        const verticalTan = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
        const dist = Math.max(
          vertical / (2 * verticalTan),
          horizontal / (2 * verticalTan * camera.aspect),
          size / 100
        ) * 1.18
        camera.near = Math.max(size / 200, 0.01)
        camera.far = Math.max(size * 30, dist * 3)
        camera.updateProjectionMatrix()
        const direction = alongX
          ? new THREE.Vector3(1, 0.12, 0)
          : alongY
            ? new THREE.Vector3(0, 1, 0.12)
            : new THREE.Vector3(0, 0.35, 1)
        camera.position.copy(direction.normalize().multiplyScalar(dist))
        controls.target.set(0, 0, 0)
        controls.update()
        rememberMaterials(model)
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
      envRT.dispose()
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

  if (failed) {
    return (
      <div className="empty" style={{ minHeight: 240 }}>
        <span>3D 模型加载失败</span>
      </div>
    )
  }
  return <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
}

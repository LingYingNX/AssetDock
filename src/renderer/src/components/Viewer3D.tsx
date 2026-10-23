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
import { hdrPreset, type HdrId, type HdrSettings } from '../data/hdr-presets'
import {
  MODEL_OUTPUT_COLOR_SPACE,
  MODEL_STUDIO_LIGHTS,
  MODEL_TONE_MAPPING,
  MODEL_TONE_MAPPING_EXPOSURE,
  MODEL_TONE_MAPPING_NAME,
  MODEL_VIEW_GRID_DIVISIONS,
  MODEL_VIEW_GRID_SPAN
} from '../data/model-renderer'
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
  hdrSettings: HdrSettings
  /** 加载进度:0–99 字节流 / null 解析中 / 100 完成 */
  onProgress?: (pct: number | null) => void
  onError?: () => void
  onLoaded?: () => void
}

interface ViewerApi {
  applyShade: (mode: ModelShade) => void
  applyHdr: (id: HdrId) => void
  applyHdrSettings: (settings: HdrSettings) => void
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
      toneMapping?: string
      toneMappingExposure?: number
      lights?: number
      hdrSettings?: HdrSettings
      backgroundOpacity?: number
      backgroundBlur?: number
      grid3d?: boolean
      gridSpan?: number
      bounds?: { min: [number, number, number]; max: [number, number, number] }
      camera?: [number, number, number]
      target?: [number, number, number]
    }
  }
}

const ENV_BACKGROUND_VERTEX = `
  varying vec2 vNdc;

  void main() {
    vNdc = position.xy;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`

const ENV_BACKGROUND_FRAGMENT = `
  uniform sampler2D envMap;
  uniform float rotation;
  uniform float opacity;
  uniform float blur;
  uniform mat4 inverseProjection;
  uniform mat4 cameraWorld;
  varying vec2 vNdc;

  const float INV_ATAN = 0.15915494309189535;
  const float INV_ASIN = 0.3183098861837907;

  vec2 dirToUv(vec3 dir) {
    float u = atan(dir.z, dir.x) * INV_ATAN + 0.5 + rotation;
    float v = asin(clamp(dir.y, -1.0, 1.0)) * INV_ASIN + 0.5;
    return vec2(u, clamp(v, 0.0, 1.0));
  }

  vec3 sampleEnv(vec2 uv) {
    return texture2D(envMap, vec2(fract(uv.x), clamp(uv.y, 0.0, 1.0))).rgb;
  }

  void main() {
    vec4 view = inverseProjection * vec4(vNdc, 1.0, 1.0);
    vec3 dirView = normalize(view.xyz / view.w);
    vec3 dir = normalize((cameraWorld * vec4(dirView, 0.0)).xyz);
    vec2 uv = dirToUv(dir);
    vec3 color;
    if (blur > 0.0001) {
      float r = blur * 0.018;
      color = sampleEnv(uv) * 0.20;
      color += sampleEnv(uv + vec2( r, 0.0)) * 0.12;
      color += sampleEnv(uv + vec2(-r, 0.0)) * 0.12;
      color += sampleEnv(uv + vec2(0.0,  r)) * 0.12;
      color += sampleEnv(uv + vec2(0.0, -r)) * 0.12;
      color += sampleEnv(uv + vec2( r,  r)) * 0.08;
      color += sampleEnv(uv + vec2(-r,  r)) * 0.08;
      color += sampleEnv(uv + vec2( r, -r)) * 0.08;
      color += sampleEnv(uv + vec2(-r, -r)) * 0.08;
    } else {
      color = sampleEnv(uv);
    }
    gl_FragColor = vec4(color, opacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

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
  hdrSettings,
  onProgress,
  onError,
  onLoaded
}: Viewer3DProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<ViewerApi | null>(null)
  const onProgressRef = useRef(onProgress)
  const hdrSettingsRef = useRef(hdrSettings)
  onProgressRef.current = onProgress
  hdrSettingsRef.current = hdrSettings
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
    window.__threeStats.toneMapping = MODEL_TONE_MAPPING_NAME
    window.__threeStats.toneMappingExposure = MODEL_TONE_MAPPING_EXPOSURE
    window.__threeStats.lights = 0

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
    renderer.outputColorSpace = MODEL_OUTPUT_COLOR_SPACE
    renderer.toneMapping = MODEL_TONE_MAPPING
    renderer.toneMappingExposure = MODEL_TONE_MAPPING_EXPOSURE
    renderer.autoClear = false
    renderer.setClearColor(0x000000, 0)
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.outline = 'none'
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const backgroundScene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.enablePan = true
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE
    controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN
    window.__threeStats!.middlePan = controls.mouseButtons.MIDDLE === THREE.MOUSE.PAN

    const backgroundMaterial = new THREE.ShaderMaterial({
      uniforms: {
        envMap: { value: null },
        rotation: { value: 0 },
        opacity: { value: 0 },
        blur: { value: hdrSettingsRef.current.blur },
        inverseProjection: { value: camera.projectionMatrixInverse },
        cameraWorld: { value: camera.matrixWorld }
      },
      vertexShader: ENV_BACKGROUND_VERTEX,
      fragmentShader: ENV_BACKGROUND_FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false
    })
    const backgroundGeometry = new THREE.PlaneGeometry(2, 2)
    const background = new THREE.Mesh(backgroundGeometry, backgroundMaterial)
    background.frustumCulled = false
    background.renderOrder = -1000
    background.visible = false
    backgroundScene.add(background)

    const pmrem = new THREE.PMREMGenerator(renderer)
    const roomEnvironment = new RoomEnvironment()
    const studioRT = pmrem.fromScene(roomEnvironment, 0.04)
    roomEnvironment.dispose()
    let hdrRT: THREE.WebGLRenderTarget | null = null
    let hdrTexture: THREE.Texture | null = null
    let envToken = 0
    let currentHdr: HdrId | null = null
    let currentShade = shade

    const studioRig = new THREE.Group()
    const studioLights = MODEL_STUDIO_LIGHTS.map((spec) => {
      const target = new THREE.Object3D()
      studioRig.add(target)
      const light = new THREE.DirectionalLight(
        new THREE.Color(...spec.color),
        spec.intensity
      )
      light.position.fromArray(spec.direction).normalize().multiplyScalar(10)
      light.target = target
      studioRig.add(light)
      return light
    })
    scene.add(studioRig)

    const applyLighting = (): void => {
      const solid = currentShade === 'solid'
      studioRig.visible = solid
      scene.environment = solid ? null : (hdrRT?.texture ?? studioRT.texture)
      scene.environmentIntensity = hdrSettingsRef.current.strength
      window.__threeStats!.lights = solid ? studioLights.length : 0
    }
    const applyHdrSettings = (settings: HdrSettings): void => {
      scene.environmentRotation.set(0, -THREE.MathUtils.degToRad(settings.rotation), 0)
      scene.environmentIntensity = settings.strength
      backgroundMaterial.uniforms.rotation.value = -settings.rotation / 360
      backgroundMaterial.uniforms.opacity.value = settings.opacity
      backgroundMaterial.uniforms.blur.value = settings.blur
      const showBackground = currentShade === 'render' && hdrTexture !== null && settings.opacity > 0
      background.visible = showBackground
      window.__threeStats!.hdrSettings = { ...settings }
      window.__threeStats!.backgroundOpacity = settings.opacity
      window.__threeStats!.backgroundBlur = settings.blur
      window.__threeStats!.background = showBackground ? (currentHdr ?? 'loading') : 'theme'
    }
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
          tex.wrapS = THREE.RepeatWrapping
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
          hdrRT?.dispose()
          if (hdrRT) {
            window.__threeStats!.envDisposals = (window.__threeStats!.envDisposals ?? 0) + 1
          }
          hdrRT = rt
          hdrTexture?.dispose()
          hdrTexture = tex
          currentHdr = id
          backgroundMaterial.uniforms.envMap.value = tex
          if (currentShade === 'render') scene.environment = rt.texture
          applyHdrSettings(hdrSettingsRef.current)
          window.__threeStats!.env = id
          window.__threeStats!.envSwitches = (window.__threeStats!.envSwitches ?? 0) + 1
        },
        undefined,
        () => {
          if (token === envToken) window.__threeStats!.env = 'fallback'
        }
      )
    }
    applyHdr(hdr)
    applyLighting()
    applyHdrSettings(hdrSettingsRef.current)

    const group = new THREE.Group()
    scene.add(group)
    let groundGrid: THREE.GridHelper | null = null
    let groundAxes: THREE.LineSegments | null = null
    const disposeGround = (): void => {
      if (groundGrid) {
        groundGrid.geometry.dispose()
        const mats = Array.isArray(groundGrid.material) ? groundGrid.material : [groundGrid.material]
        for (const material of mats) material.dispose()
        groundGrid.removeFromParent()
        groundGrid = null
      }
      if (groundAxes) {
        groundAxes.geometry.dispose()
        const material = groundAxes.material as THREE.Material
        material.dispose()
        groundAxes.removeFromParent()
        groundAxes = null
      }
    }
    const addGround = (modelSize: number): void => {
      disposeGround()
      const span = Math.max(modelSize * MODEL_VIEW_GRID_SPAN, 1)
      groundGrid = new THREE.GridHelper(span, MODEL_VIEW_GRID_DIVISIONS, 0x697562, 0x44464c)
      groundGrid.position.set(0, 0, 0)
      groundGrid.renderOrder = -2
      const gridMaterials = Array.isArray(groundGrid.material) ? groundGrid.material : [groundGrid.material]
      for (const material of gridMaterials) {
        material.transparent = true
        material.opacity = 0.55
        material.depthWrite = false
      }
      scene.add(groundGrid)

      const half = span / 2
      const axisGeometry = new THREE.BufferGeometry()
      axisGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
        -half, 0, 0, half, 0, 0,
        0, 0, -half, 0, 0, half
      ], 3))
      axisGeometry.setAttribute('color', new THREE.Float32BufferAttribute([
        0.60, 0.26, 0.26, 0.60, 0.26, 0.26,
        0.38, 0.58, 0.28, 0.38, 0.58, 0.28
      ], 3))
      groundAxes = new THREE.LineSegments(
        axisGeometry,
        new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.48, depthWrite: false })
      )
      groundAxes.position.set(0, 0.001, 0)
      groundAxes.renderOrder = -1
      scene.add(groundAxes)
      window.__threeStats!.grid3d = true
      window.__threeStats!.gridSpan = span
    }
    const solidMaterial = new THREE.MeshStandardMaterial({
      color: 0x56595c,
      roughness: 0.82,
      metalness: 0
    })
    const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
    const rememberMaterials = (model: THREE.Object3D): void => {
      model.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (mesh.isMesh) originalMaterials.set(mesh, mesh.material)
      })
    }
    const applyShade = (mode: ModelShade): void => {
      currentShade = mode
      group.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.material = mode === 'solid'
          ? solidMaterial
          : (originalMaterials.get(mesh) ?? mesh.material)
      })
      applyLighting()
      applyHdrSettings(hdrSettingsRef.current)
      window.__threeStats!.shade = mode
    }

    apiRef.current = {
      applyShade,
      applyHdr,
      applyHdrSettings
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
        window.__threeStats!.bounds = {
          min: box.min.toArray() as [number, number, number],
          max: box.max.toArray() as [number, number, number]
        }
        addGround(size)
        const dist = size * 1.6
        camera.near = Math.max(size / 200, 0.01)
        camera.far = size * 30
        camera.updateProjectionMatrix()
        camera.position.set(0, center.y + dist * 0.35, dist)
        controls.target.set(0, center.y, 0)
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
      studioRig.position.copy(camera.position)
      studioRig.quaternion.copy(camera.quaternion)
      backgroundMaterial.uniforms.inverseProjection.value = camera.projectionMatrixInverse
      backgroundMaterial.uniforms.cameraWorld.value = camera.matrixWorld
      renderer.clear(true, true, true)
      if (background.visible) renderer.render(backgroundScene, camera)
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
      disposeGround()
      backgroundMaterial.uniforms.envMap.value = null
      backgroundGeometry.dispose()
      backgroundMaterial.dispose()
      studioRT.dispose()
      hdrRT?.dispose()
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

  useEffect(() => {
    apiRef.current?.applyHdrSettings(hdrSettings)
  }, [hdrSettings])

  if (failed) {
    return (
      <div className="empty" style={{ minHeight: 240 }}>
        <span>3D 模型加载失败</span>
      </div>
    )
  }
  return <div ref={hostRef} className="pv3d-canvas" />
}

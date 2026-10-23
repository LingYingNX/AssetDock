import * as THREE from 'three'

/** 材质上可能挂贴图的槽位:卸载时逐个释放。 */
export const MATERIAL_TEXTURE_SLOTS = [
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

const COPIED_PROPS = [
  'map',
  'normalMap',
  'alphaMap',
  'aoMap',
  'bumpMap',
  'displacementMap',
  'lightMap',
  'specularMap',
  'emissiveMap',
  'opacity',
  'transparent',
  'alphaTest',
  'side',
  'vertexColors',
  'flatShading',
  'depthWrite',
  'depthTest',
  'blending',
  'polygonOffset',
  'polygonOffsetFactor',
  'polygonOffsetUnits'
] as const

/**
 * 源文件常把全不透明材质标成 transparent。只有 opacity<1 或 alphaTest>0
 * 才视为真实透明;alphaMap 单独存在时不启用透明混合。
 */
export function normalizeTransparency(material: THREE.Material): void {
  if (material.opacity >= 1 && material.alphaTest === 0) {
    material.transparent = false
  }
}

/**
 * FBX 常把未贴自发光的材质标成 emissive=white,导致 Base Color 被纯白覆盖。
 * 无自发光贴图时清掉这种白色自发光;只有 Emissive 贴图时把它迁回 Base Color。
 */
export function normalizeEmissive(material: THREE.MeshStandardMaterial): void {
  if (!material.emissive) return
  const white =
    material.emissive.r >= 0.99 &&
    material.emissive.g >= 0.99 &&
    material.emissive.b >= 0.99

  if (material.emissiveMap && !material.map) {
    material.map = material.emissiveMap
    material.emissiveMap = null
    material.emissive.setRGB(0, 0, 0)
    material.emissiveIntensity = 0
    material.needsUpdate = true
    return
  }
  if (white && !material.emissiveMap) {
    material.emissive.setRGB(0, 0, 0)
    material.emissiveIntensity = 0
    material.needsUpdate = true
  }
}

/** Phong/Lambert 统一成 MeshStandardMaterial,让各格式的渲染模式语义一致。 */
export function toStandardMaterial(material: THREE.Material): THREE.MeshStandardMaterial {
  if ((material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
    return material as THREE.MeshStandardMaterial
  }
  const src = material as unknown as Record<string, unknown>
  const std = new THREE.MeshStandardMaterial({ name: material.name })
  for (const key of COPIED_PROPS) {
    if (src[key] !== undefined) (std as unknown as Record<string, unknown>)[key] = src[key]
  }
  const color = src.color as THREE.Color | undefined
  if (color?.isColor) std.color.copy(color)
  const emissive = src.emissive as THREE.Color | undefined
  if (emissive?.isColor) std.emissive.copy(emissive)
  const shininess = src.shininess as number | undefined
  std.roughness = typeof shininess === 'number'
    ? Math.min(1, Math.max(0.05, 1 - shininess / 100))
    : 0.6
  std.metalness = 0
  return std
}

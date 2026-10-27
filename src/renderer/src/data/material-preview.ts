import * as THREE from 'three'
import type { FbxMaterialScalars, FbxMaterialTextures } from './fbx-material-connections'

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

/** 渲染模式不保留源文件的透明混合，避免 FBX alphaMap 让模型出现半透明。 */
export function normalizeTransparency(material: THREE.Material): void {
  material.transparent = false
  material.opacity = 1
  material.depthWrite = true
  material.needsUpdate = true
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

/** 源贴图一张都没加载到时，白色素材质不该冒充渲染结果。 */
export function fallbackMissingTextures(material: THREE.MeshStandardMaterial): boolean {
  if (
    material.map ||
    material.normalMap ||
    material.alphaMap ||
    material.emissiveMap ||
    material.metalnessMap ||
    material.roughnessMap
  ) {
    return false
  }
  material.color.setRGB(0.48, 0.52, 0.57)
  material.emissive.setRGB(0, 0, 0)
  material.emissiveIntensity = 0
  material.roughness = 0.8
  material.metalness = 0.02
  material.needsUpdate = true
  return true
}

export function roughnessFromShininess(shininess: unknown): number {
  const value = typeof shininess === 'number' && Number.isFinite(shininess)
    ? Math.max(0, shininess)
    : 0
  return Math.min(1, Math.max(0, 1 - Math.sqrt(value) / 10))
}

export function metalnessFromReflection(reflection: unknown): number {
  if (typeof reflection !== 'number' || !Number.isFinite(reflection)) return 0
  return Math.min(1, Math.max(0, reflection))
}

function applyFbxTextures(material: THREE.MeshStandardMaterial, textures: FbxMaterialTextures): void {
  const slots: Array<[keyof FbxMaterialTextures, keyof THREE.MeshStandardMaterial]> = [
    ['DiffuseColor', 'map'],
    ['NormalMap', 'normalMap'],
    ['EmissiveColor', 'emissiveMap'],
    ['TransparencyFactor', 'alphaMap'],
    ['TransparentColor', 'alphaMap'],
    ['ReflectionFactor', 'metalnessMap'],
    ['ReflectionColor', 'metalnessMap'],
    ['ShininessExponent', 'roughnessMap']
  ]
  let changed = false
  for (const [source, target] of slots) {
    const texture = textures[source]
    if (!texture) continue
    ;(material as unknown as Record<string, unknown>)[target] = texture
    changed = true
  }
  if (textures.TransparencyFactor || textures.TransparentColor) material.transparent = true
  if (changed) material.needsUpdate = true
}

/** Phong/Lambert 统一成 MeshStandardMaterial,让各格式的渲染模式语义一致。 */
export function toStandardMaterial(
  material: THREE.Material,
  fbxTextures?: FbxMaterialTextures,
  fbxScalars?: FbxMaterialScalars
): THREE.MeshStandardMaterial {
  if ((material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
    const standard = material as THREE.MeshStandardMaterial
    if (fbxTextures) applyFbxTextures(standard, fbxTextures)
    return standard
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
  if (fbxTextures) applyFbxTextures(std, fbxTextures)
  const shininess = src.shininess as number | undefined
  std.roughness = std.roughnessMap
    ? 1
    : fbxScalars
      ? typeof fbxScalars.shininessExponent === 'number' && Number.isFinite(fbxScalars.shininessExponent)
        ? roughnessFromShininess(fbxScalars.shininessExponent)
        : typeof shininess === 'number' && Number.isFinite(shininess)
          ? roughnessFromShininess(shininess)
          : 0.6
      : typeof shininess === 'number' && Number.isFinite(shininess)
        ? Math.min(1, Math.max(0.05, 1 - shininess / 100))
        : 0.6
  std.metalness = std.metalnessMap
    ? 1
    : fbxScalars
      ? metalnessFromReflection(fbxScalars.reflectionFactor)
      : 0
  return std
}

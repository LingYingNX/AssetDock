import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  MATERIAL_TEXTURE_SLOTS,
  fallbackMissingTextures,
  metalnessFromReflection,
  normalizeEmissive,
  normalizeTransparency,
  roughnessFromShininess,
  toStandardMaterial
} from '../src/renderer/src/data/material-preview'

describe('material preview', () => {
  it('forces render materials opaque regardless of source alpha', () => {
    const opaque = new THREE.MeshStandardMaterial({ transparent: true, opacity: 1 })
    normalizeTransparency(opaque)
    expect(opaque.transparent).toBe(false)
    expect(opaque.opacity).toBe(1)
    expect(opaque.depthWrite).toBe(true)

    const cutout = new THREE.MeshStandardMaterial({ transparent: true, opacity: 1, alphaTest: 0.5 })
    normalizeTransparency(cutout)
    expect(cutout.transparent).toBe(false)
    expect(cutout.opacity).toBe(1)

    const alphaMap = new THREE.MeshStandardMaterial({ transparent: true, opacity: 1, alphaMap: new THREE.Texture() })
    normalizeTransparency(alphaMap)
    expect(alphaMap.transparent).toBe(false)
    expect(alphaMap.opacity).toBe(1)

    const semi = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.4 })
    normalizeTransparency(semi)
    expect(semi.transparent).toBe(false)
    expect(semi.opacity).toBe(1)
  })

  it('converts Phong materials to standard while keeping color and maps', () => {
    const map = new THREE.Texture()
    const source = new THREE.MeshPhongMaterial({ color: 0x336699, map, shininess: 20 })
    const std = toStandardMaterial(source)
    expect(std.isMeshStandardMaterial).toBe(true)
    expect(std.color.getHex()).toBe(0x336699)
    expect(std.map).toBe(map)
    expect(std.roughness).toBeCloseTo(0.8)
    expect(std.metalness).toBe(0)
  })

  it('maps FBX material connections to PBR texture slots', () => {
    const diffuse = new THREE.Texture()
    const metalness = new THREE.Texture()
    const roughness = new THREE.Texture()
    const alpha = new THREE.Texture()
    const std = toStandardMaterial(
      new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 25, reflectivity: 0.2 }),
      {
        DiffuseColor: diffuse,
        ReflectionFactor: metalness,
        ShininessExponent: roughness,
        TransparencyFactor: alpha
      },
      { reflectionFactor: 0.2, shininessExponent: 25 }
    )
    expect(std.map).toBe(diffuse)
    expect(std.metalnessMap).toBe(metalness)
    expect(std.roughnessMap).toBe(roughness)
    expect(std.alphaMap).toBe(alpha)
    normalizeTransparency(std)
    expect(std.transparent).toBe(false)
    expect(std.opacity).toBe(1)
    expect(std.metalness).toBe(1)
    expect(std.roughness).toBe(1)
  })

  it('keeps alpha-test cutouts opaque but clipped', () => {
    const cutout = new THREE.MeshStandardMaterial({
      transparent: true,
      opacity: 0.5,
      alphaTest: 0.5,
      alphaMap: new THREE.Texture()
    })
    normalizeTransparency(cutout)
    expect(cutout.transparent).toBe(false)
    expect(cutout.opacity).toBe(1)
    expect(cutout.alphaTest).toBe(0.5)
  })

  it('lists every FBX PBR texture slot for disposal', () => {
    expect(MATERIAL_TEXTURE_SLOTS).toEqual(expect.arrayContaining([
      'map',
      'normalMap',
      'emissiveMap',
      'alphaMap',
      'metalnessMap',
      'roughnessMap'
    ]))
  })

  it('converts FBX shininess and reflection scalars', () => {
    expect(roughnessFromShininess(36)).toBeCloseTo(0.4)
    expect(roughnessFromShininess(-4)).toBe(1)
    expect(roughnessFromShininess(400)).toBe(0)
    expect(metalnessFromReflection(0.35)).toBe(0.35)
    expect(metalnessFromReflection(-1)).toBe(0)
    expect(metalnessFromReflection(2)).toBe(1)
    expect(metalnessFromReflection(Number.NaN)).toBe(0)

    const std = toStandardMaterial(
      new THREE.MeshPhongMaterial({ shininess: 36, reflectivity: 0.35 }),
      undefined,
      { reflectionFactor: 0.35, shininessExponent: 36 }
    )
    expect(std.roughness).toBeCloseTo(0.4)
    expect(std.metalness).toBe(0.35)
  })

  it('clears white FBX emissive and moves an emissive-only map to base color', () => {
    const white = new THREE.MeshStandardMaterial({ emissive: 0xffffff })
    normalizeEmissive(white)
    expect(white.emissive.getHex()).toBe(0)
    expect(white.emissiveIntensity).toBe(0)

    const emissiveMap = new THREE.Texture()
    const mapped = new THREE.MeshStandardMaterial({
      emissive: 0xffffff,
      emissiveMap
    })
    normalizeEmissive(mapped)
    expect(mapped.map).toBe(emissiveMap)
    expect(mapped.emissiveMap).toBeNull()
    expect(mapped.emissive.getHex()).toBe(0)
  })

  it('falls back to neutral clay when source textures are missing', () => {
    const missing = new THREE.MeshStandardMaterial({ color: 0xffffff })
    expect(fallbackMissingTextures(missing)).toBe(true)
    expect(missing.color.r).toBeCloseTo(0.48, 2)
    expect(missing.color.g).toBeCloseTo(0.52, 2)
    expect(missing.color.b).toBeCloseTo(0.57, 2)
    expect(missing.roughness).toBe(0.8)

    const loaded = new THREE.MeshStandardMaterial({ map: new THREE.Texture() })
    expect(fallbackMissingTextures(loaded)).toBe(false)

    const normalOnly = new THREE.MeshStandardMaterial({ normalMap: new THREE.Texture() })
    expect(fallbackMissingTextures(normalOnly)).toBe(false)
  })

})

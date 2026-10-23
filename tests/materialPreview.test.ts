import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  normalizeEmissive,
  normalizeTransparency,
  toStandardMaterial
} from '../src/renderer/src/data/material-preview'

describe('material preview', () => {
  it('clears the source transparent flag only for fully opaque materials', () => {
    const opaque = new THREE.MeshStandardMaterial({ transparent: true, opacity: 1 })
    normalizeTransparency(opaque)
    expect(opaque.transparent).toBe(false)

    const cutout = new THREE.MeshStandardMaterial({ transparent: true, opacity: 1, alphaTest: 0.5 })
    normalizeTransparency(cutout)
    expect(cutout.transparent).toBe(true)

    const alphaMap = new THREE.MeshStandardMaterial({ transparent: true, opacity: 1, alphaMap: new THREE.Texture() })
    normalizeTransparency(alphaMap)
    expect(alphaMap.transparent).toBe(false)

    const semi = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.4 })
    normalizeTransparency(semi)
    expect(semi.transparent).toBe(true)
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

})

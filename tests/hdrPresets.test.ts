import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HDR,
  DEFAULT_HDR_SETTINGS,
  HDR_PRESETS,
  hdrPreset,
  parseHdrPreset,
  parseHdrSettings
} from '../src/renderer/src/data/hdr-presets'
import {
  MODEL_OUTPUT_COLOR_SPACE,
  MODEL_TONE_MAPPING,
  MODEL_TONE_MAPPING_EXPOSURE,
  MODEL_TONE_MAPPING_NAME,
  MODEL_VIEW_GRID_DIVISIONS,
  MODEL_VIEW_GRID_SPAN
} from '../src/renderer/src/data/model-renderer'

const HDRI_DIR = fileURLToPath(new URL('../src/renderer/public/hdri/', import.meta.url))

describe('HDR presets', () => {
  it('ships the 8 Blender worlds with forest as default', () => {
    expect(HDR_PRESETS.map((p) => p.id)).toEqual([
      'city',
      'courtyard',
      'forest',
      'interior',
      'night',
      'studio',
      'sunrise',
      'sunset'
    ])
    expect(DEFAULT_HDR).toBe('forest')
    expect(hdrPreset('forest').url).toBe('hdri/forest.exr')
    expect(hdrPreset('forest').thumbUrl).toBe('hdri/thumbs/forest.png')
  })

  it('falls back to forest for unknown stored values', () => {
    expect(parseHdrPreset('volcano')).toBe('forest')
    expect(parseHdrPreset(null)).toBe('forest')
    expect(parseHdrPreset('sunset')).toBe('sunset')
  })

  it('uses Blender AgX at neutral exposure', () => {
    expect(MODEL_TONE_MAPPING).toBe(THREE.AgXToneMapping)
    expect(MODEL_TONE_MAPPING_NAME).toBe('AgX')
    expect(MODEL_TONE_MAPPING_EXPOSURE).toBe(1)
    expect(MODEL_OUTPUT_COLOR_SPACE).toBe(THREE.SRGBColorSpace)
  })

  it('defines a world-space grid', () => {
    expect(MODEL_VIEW_GRID_SPAN).toBeGreaterThan(1)
    expect(MODEL_VIEW_GRID_DIVISIONS).toBeGreaterThan(100)
  })

  it('parses Blender environment controls and rejects invalid values', () => {
    expect(parseHdrSettings({
      modelHdrRotation: 90,
      modelHdrStrength: 2.5,
      modelHdrOpacity: 0.4,
      modelHdrBlur: 0.2
    })).toEqual({ rotation: 90, strength: 2.5, opacity: 0.4, blur: 0.2 })

    expect(parseHdrSettings({
      modelHdrRotation: 999,
      modelHdrStrength: -1,
      modelHdrOpacity: 'half',
      modelHdrBlur: 2
    })).toEqual(DEFAULT_HDR_SETTINGS)
  })

  it('bundles real EXR files, not LFS pointers', () => {
    for (const preset of HDR_PRESETS) {
      const path = `${HDRI_DIR}${preset.id}.exr`
      const thumbPath = `${HDRI_DIR}thumbs/${preset.id}.png`
      expect(existsSync(path), preset.id).toBe(true)
      expect(existsSync(thumbPath), `${preset.id} thumb`).toBe(true)
      // LFS 指针只有 131 字节;真实 1K EXR 每个约 98–553KB
      expect(statSync(path).size, preset.id).toBeGreaterThan(50_000)
    }
  })
})

import { AgXToneMapping, SRGBColorSpace } from 'three'

/** Blender 曝光 0 对应 Three.js 的单位曝光。 */
export const MODEL_TONE_MAPPING = AgXToneMapping
export const MODEL_TONE_MAPPING_NAME = 'AgX'
export const MODEL_TONE_MAPPING_EXPOSURE = 1
export const MODEL_OUTPUT_COLOR_SPACE = SRGBColorSpace

/** 三维舞台的主题背景与网格参数。 */
export const MODEL_VIEW_BACKGROUND = '#313337'
export const MODEL_VIEW_GRID_SPAN = 24
export const MODEL_VIEW_GRID_DIVISIONS = 216

export interface StudioLightSpec {
  /** Blender basic.sl 的视空间方向。 */
  direction: readonly [number, number, number]
  /** 颜色按 basic.sl 的线性 RGB 值保留。 */
  color: readonly [number, number, number]
  intensity: number
}

/**
 * Blender Default studio light (basic.sl) 的四灯 rig。
 * 最后一项只提供 specular，Three.js 用弱方向光近似，避免改变主体明暗。
 */
export const MODEL_STUDIO_LIGHTS: readonly StudioLightSpec[] = [
  { direction: [0, 0.639175, 0.769061], color: [0.507074, 0.507074, 0.507074], intensity: 0.3 },
  { direction: [-0.846939, -0.357143, 0.393883], color: [0.021936, 0.058160, 0.063719], intensity: 0.5 },
  { direction: [0.755102, -0.530612, 0.385060], color: [0.063721, 0.040061, 0.037017], intensity: 0.5 },
  { direction: [0.034483, 0.913793, 0.404714], color: [0.023079, 0.023393, 0.025394], intensity: 0.5 }
]

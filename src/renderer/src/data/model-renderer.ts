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

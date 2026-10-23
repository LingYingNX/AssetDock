export type HdrId =
  | 'city'
  | 'courtyard'
  | 'forest'
  | 'interior'
  | 'night'
  | 'studio'
  | 'sunrise'
  | 'sunset'

export interface HdrPreset {
  id: HdrId
  label: string
  /** 相对页面地址:dev 与 file:// 产物都能解析到 public/hdri。 */
  url: string
  thumbUrl: string
}

export interface HdrSettings {
  rotation: number
  strength: number
  opacity: number
  blur: number
}

export const HDR_PRESETS: readonly HdrPreset[] = [
  { id: 'city', label: '城市', url: 'hdri/city.exr', thumbUrl: 'hdri/thumbs/city.png' },
  { id: 'courtyard', label: '庭院', url: 'hdri/courtyard.exr', thumbUrl: 'hdri/thumbs/courtyard.png' },
  { id: 'forest', label: '森林', url: 'hdri/forest.exr', thumbUrl: 'hdri/thumbs/forest.png' },
  { id: 'interior', label: '室内', url: 'hdri/interior.exr', thumbUrl: 'hdri/thumbs/interior.png' },
  { id: 'night', label: '夜晚', url: 'hdri/night.exr', thumbUrl: 'hdri/thumbs/night.png' },
  { id: 'studio', label: '影棚', url: 'hdri/studio.exr', thumbUrl: 'hdri/thumbs/studio.png' },
  { id: 'sunrise', label: '日出', url: 'hdri/sunrise.exr', thumbUrl: 'hdri/thumbs/sunrise.png' },
  { id: 'sunset', label: '日落', url: 'hdri/sunset.exr', thumbUrl: 'hdri/thumbs/sunset.png' }
]

/** Blender 默认世界预览环境。 */
export const DEFAULT_HDR: HdrId = 'forest'

export const DEFAULT_HDR_SETTINGS: Readonly<HdrSettings> = {
  rotation: 0,
  strength: 1,
  opacity: 0,
  blur: 0.5
}

export function parseHdrPreset(value: unknown): HdrId {
  return HDR_PRESETS.some((p) => p.id === value) ? (value as HdrId) : DEFAULT_HDR
}

function parseRange(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback
}

export function parseHdrSettings(value: Record<string, unknown>): HdrSettings {
  return {
    rotation: parseRange(value.modelHdrRotation, DEFAULT_HDR_SETTINGS.rotation, 0, 360),
    strength: parseRange(value.modelHdrStrength, DEFAULT_HDR_SETTINGS.strength, 0, 10),
    opacity: parseRange(value.modelHdrOpacity, DEFAULT_HDR_SETTINGS.opacity, 0, 1),
    blur: parseRange(value.modelHdrBlur, DEFAULT_HDR_SETTINGS.blur, 0, 1)
  }
}

export function hdrPreset(id: HdrId): HdrPreset {
  return HDR_PRESETS.find((p) => p.id === id) ?? HDR_PRESETS[2]
}

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

export function parseHdrPreset(value: unknown): HdrId {
  return HDR_PRESETS.some((p) => p.id === value) ? (value as HdrId) : DEFAULT_HDR
}

export function hdrPreset(id: HdrId): HdrPreset {
  return HDR_PRESETS.find((p) => p.id === id) ?? HDR_PRESETS[2]
}

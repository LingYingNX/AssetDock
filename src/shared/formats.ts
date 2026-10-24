import type { AssetKind } from './types'

export type { AssetKind } from './types'

export type FormatProbe = 'sharp' | 'ffmpeg' | 'pdf' | 'psd' | 'heic' | 'three' | 'external' | 'none'
export type FormatThumbnail = 'sharp' | 'ffmpeg' | 'pdf' | 'psd' | 'heic' | 'three' | 'external' | 'none'
export type FormatPreview = 'image' | 'pdf' | 'video' | 'three' | 'envmap' | 'external' | 'none' | 'css'
export type ExternalTool = 'blender' | 'cinema4d'

interface FormatSpecBase {
  ext: string
  type: AssetKind
  format: string
  probe: FormatProbe
  thumbnail: FormatThumbnail
  preview: FormatPreview
  external?: ExternalTool
}

/**
 * 扫描、缩略图、预览和筛选的唯一格式事实源。
 * 同一规范格式可以有多个扩展名条目，但扩展名本身不得重复。
 */
export const FORMAT_SPECS = [
  { ext: 'jpg', type: 'image', format: 'JPG', probe: 'sharp', thumbnail: 'sharp', preview: 'image' },
  { ext: 'jpeg', type: 'image', format: 'JPG', probe: 'sharp', thumbnail: 'sharp', preview: 'image' },
  { ext: 'png', type: 'image', format: 'PNG', probe: 'sharp', thumbnail: 'sharp', preview: 'image' },
  { ext: 'webp', type: 'image', format: 'WEBP', probe: 'sharp', thumbnail: 'sharp', preview: 'image' },
  { ext: 'gif', type: 'image', format: 'GIF', probe: 'sharp', thumbnail: 'sharp', preview: 'image' },
  { ext: 'svg', type: 'image', format: 'SVG', probe: 'sharp', thumbnail: 'sharp', preview: 'image' },
  { ext: 'psd', type: 'image', format: 'PSD', probe: 'psd', thumbnail: 'psd', preview: 'image' },
  { ext: 'ai', type: 'image', format: 'AI', probe: 'pdf', thumbnail: 'pdf', preview: 'pdf' },
  { ext: 'heic', type: 'image', format: 'HEIC', probe: 'heic', thumbnail: 'heic', preview: 'image' },
  { ext: 'heif', type: 'image', format: 'HEIC', probe: 'heic', thumbnail: 'heic', preview: 'image' },
  { ext: 'avif', type: 'image', format: 'AVIF', probe: 'sharp', thumbnail: 'sharp', preview: 'image' },
  { ext: 'tif', type: 'image', format: 'TIFF', probe: 'sharp', thumbnail: 'sharp', preview: 'image' },
  { ext: 'tiff', type: 'image', format: 'TIFF', probe: 'sharp', thumbnail: 'sharp', preview: 'image' },
  { ext: 'bmp', type: 'image', format: 'BMP', probe: 'ffmpeg', thumbnail: 'ffmpeg', preview: 'image' },
  { ext: 'ico', type: 'image', format: 'ICO', probe: 'ffmpeg', thumbnail: 'ffmpeg', preview: 'image' },
  { ext: 'tga', type: 'image', format: 'TGA', probe: 'ffmpeg', thumbnail: 'ffmpeg', preview: 'image' },
  { ext: 'hdr', type: 'image', format: 'HDR', probe: 'ffmpeg', thumbnail: 'ffmpeg', preview: 'envmap' },
  { ext: 'exr', type: 'image', format: 'EXR', probe: 'ffmpeg', thumbnail: 'ffmpeg', preview: 'envmap' },

  { ext: 'mp4', type: 'video', format: 'MP4', probe: 'ffmpeg', thumbnail: 'ffmpeg', preview: 'video' },
  { ext: 'mov', type: 'video', format: 'MOV', probe: 'ffmpeg', thumbnail: 'ffmpeg', preview: 'video' },
  { ext: 'webm', type: 'video', format: 'WEBM', probe: 'ffmpeg', thumbnail: 'ffmpeg', preview: 'video' },
  { ext: 'mkv', type: 'video', format: 'MKV', probe: 'ffmpeg', thumbnail: 'ffmpeg', preview: 'video' },
  { ext: 'avi', type: 'video', format: 'AVI', probe: 'ffmpeg', thumbnail: 'ffmpeg', preview: 'video' },
  { ext: 'flv', type: 'video', format: 'FLV', probe: 'ffmpeg', thumbnail: 'ffmpeg', preview: 'video' },
  { ext: 'wmv', type: 'video', format: 'WMV', probe: 'ffmpeg', thumbnail: 'ffmpeg', preview: 'video' },
  { ext: 'm4v', type: 'video', format: 'M4V', probe: 'ffmpeg', thumbnail: 'ffmpeg', preview: 'video' },
  { ext: 'mpg', type: 'video', format: 'MPEG', probe: 'ffmpeg', thumbnail: 'ffmpeg', preview: 'video' },
  { ext: 'mpeg', type: 'video', format: 'MPEG', probe: 'ffmpeg', thumbnail: 'ffmpeg', preview: 'video' },
  { ext: 'ts', type: 'video', format: 'TS', probe: 'ffmpeg', thumbnail: 'ffmpeg', preview: 'video' },

  { ext: 'glb', type: 'model', format: 'GLB', probe: 'three', thumbnail: 'three', preview: 'three' },
  { ext: 'gltf', type: 'model', format: 'GLB', probe: 'three', thumbnail: 'three', preview: 'three' },
  { ext: 'fbx', type: 'model', format: 'FBX', probe: 'three', thumbnail: 'three', preview: 'three' },
  { ext: 'obj', type: 'model', format: 'OBJ', probe: 'three', thumbnail: 'three', preview: 'three' },
  { ext: 'pmd', type: 'model', format: 'PMD', probe: 'three', thumbnail: 'three', preview: 'three' },
  { ext: 'pmx', type: 'model', format: 'PMX', probe: 'three', thumbnail: 'three', preview: 'three' },
  { ext: 'stl', type: 'model', format: 'STL', probe: 'three', thumbnail: 'three', preview: 'three' },
  { ext: 'ply', type: 'model', format: 'PLY', probe: 'three', thumbnail: 'three', preview: 'three' },
  { ext: '3ds', type: 'model', format: '3DS', probe: 'three', thumbnail: 'three', preview: 'three' },
  { ext: 'dae', type: 'model', format: 'DAE', probe: 'three', thumbnail: 'three', preview: 'three' },
  { ext: 'usdz', type: 'model', format: 'USDZ', probe: 'three', thumbnail: 'three', preview: 'three' },
  { ext: '3mf', type: 'model', format: '3MF', probe: 'three', thumbnail: 'three', preview: 'three' },
  { ext: 'amf', type: 'model', format: 'AMF', probe: 'three', thumbnail: 'three', preview: 'three' },
  { ext: 'vrml', type: 'model', format: 'VRML', probe: 'three', thumbnail: 'three', preview: 'three' },
  { ext: 'wrl', type: 'model', format: 'VRML', probe: 'three', thumbnail: 'three', preview: 'three' },
  { ext: 'vrm', type: 'model', format: 'VRM', probe: 'three', thumbnail: 'three', preview: 'three' },
  { ext: 'blend', type: 'model', format: 'BLEND', probe: 'external', thumbnail: 'external', preview: 'external', external: 'blender' },
  { ext: 'c4d', type: 'model', format: 'C4D', probe: 'external', thumbnail: 'external', preview: 'external', external: 'cinema4d' },

  { ext: 'css', type: 'style', format: 'CSS', probe: 'none', thumbnail: 'none', preview: 'css' }
] as const satisfies readonly FormatSpecBase[]

export type FormatSpec = (typeof FORMAT_SPECS)[number]
export type AssetFormat = FormatSpec['format']

export const FORMAT_BY_EXTENSION = new Map<string, FormatSpec>(
  FORMAT_SPECS.map((spec) => [spec.ext, spec])
)

/** 每个规范格式保留注册表顺序中的第一个条目，供筛选菜单和徽章使用。 */
export const FORMAT_OPTIONS = FORMAT_SPECS.filter(
  (spec, index, all) => all.findIndex((item) => item.format === spec.format) === index
)

export const FORMAT_GROUPS: ReadonlyArray<{ type: AssetKind; label: string; formats: readonly AssetFormat[] }> = [
  {
    type: 'image',
    label: '图片',
    formats: ['JPG', 'PNG', 'WEBP', 'GIF', 'SVG', 'PSD', 'AI', 'HEIC', 'AVIF', 'TIFF', 'BMP', 'ICO', 'TGA', 'HDR', 'EXR']
  },
  {
    type: 'video',
    label: '视频',
    formats: ['MP4', 'MOV', 'WEBM', 'MKV', 'AVI', 'FLV', 'WMV', 'M4V', 'MPEG', 'TS']
  },
  {
    type: 'model',
    label: '三维',
    formats: ['GLB', 'FBX', 'OBJ', 'PMD', 'PMX', 'STL', 'PLY', '3DS', 'DAE', 'USDZ', '3MF', 'AMF', 'VRML', 'VRM', 'BLEND', 'C4D']
  },
  {
    type: 'style',
    label: '代码',
    formats: ['CSS']
  }
]

function extensionOf(relPath: string): string | null {
  const normalized = relPath.replace(/\\/g, '/')
  const base = normalized.slice(normalized.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return null
  return base.slice(dot + 1).toLowerCase()
}

export function detectFormat(relPath: string): FormatSpec | null {
  const ext = extensionOf(relPath)
  return ext ? FORMAT_BY_EXTENSION.get(ext) ?? null : null
}

export function formatSpec(format: string): FormatSpec | undefined {
  return FORMAT_OPTIONS.find((spec) => spec.format === format)
}

/** Chromium can stream these containers directly; everything else uses the MP4 cache. */
export function needsVideoTranscode(format: string): boolean {
  const spec = formatSpec(format)
  return spec?.type === 'video' && spec.format !== 'MP4' && spec.format !== 'WEBM'
}

export function isSupportedExtension(ext: string): boolean {
  return FORMAT_BY_EXTENSION.has(ext.toLowerCase())
}

/** 注册表完整性检查：供测试使用，运行时不做重复扫描。 */
export function duplicateExtensions(): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const spec of FORMAT_SPECS) {
    if (seen.has(spec.ext)) duplicates.add(spec.ext)
    seen.add(spec.ext)
  }
  return [...duplicates]
}

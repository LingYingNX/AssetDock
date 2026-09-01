/** 扩展名白名单与忽略规则(扫描与监听共用) */
export const EXT_WHITELIST: Record<string, { type: 'image' | 'video' | 'model'; format: string }> = {
  jpg: { type: 'image', format: 'JPG' },
  jpeg: { type: 'image', format: 'JPG' },
  png: { type: 'image', format: 'PNG' },
  webp: { type: 'image', format: 'WEBP' },
  gif: { type: 'image', format: 'GIF' },
  svg: { type: 'image', format: 'SVG' },
  psd: { type: 'image', format: 'PSD' },
  mp4: { type: 'video', format: 'MP4' },
  mov: { type: 'video', format: 'MOV' },
  glb: { type: 'model', format: 'GLB' },
  fbx: { type: 'model', format: 'FBX' },
  obj: { type: 'model', format: 'OBJ' }
}

const TEMP_SUFFIX = /\.(tmp|crdownload|part)$/i
const IGNORED_DIRS = new Set(['thumbs', '.mediahub'])

/** 相对路径是否应被忽略(隐藏文件/临时文件/缓存目录/白名单外) */
export function isIgnored(relPath: string): boolean {
  const segs = relPath.split(/[\\/]/)
  if (segs.some((s) => s.startsWith('.') || s.startsWith('~$'))) return true
  if (segs.slice(0, -1).some((s) => IGNORED_DIRS.has(s.toLowerCase()))) return true
  if (TEMP_SUFFIX.test(relPath)) return true
  const dot = relPath.lastIndexOf('.')
  if (dot < 0) return true
  const ext = relPath.slice(dot + 1).toLowerCase()
  if (ext === 'jpeg') return false
  return !Object.keys(EXT_WHITELIST).includes(ext)
}

/** 相对路径 → 类型/格式;不在白名单返回 null */
export function detectKind(relPath: string): { type: 'image' | 'video' | 'model'; format: string } | null {
  const dot = relPath.lastIndexOf('.')
  if (dot < 0) return null
  const ext = relPath.slice(dot + 1).toLowerCase()
  if (ext === 'jpeg') return EXT_WHITELIST.jpg
  return EXT_WHITELIST[ext] ?? null
}

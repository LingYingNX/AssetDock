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
  gltf: { type: 'model', format: 'GLB' },
  fbx: { type: 'model', format: 'FBX' },
  obj: { type: 'model', format: 'OBJ' }
}

const TEMP_SUFFIX = /\.(tmp|crdownload|part)$/i
const IGNORED_DIRS = new Set(['thumbs', '.mediahub'])

function pathSegmentsIgnored(relPath: string): boolean {
  const segs = relPath.split(/[\\/]/)
  if (segs.some((s) => s.startsWith('.') || s.startsWith('~$'))) return true
  if (segs.slice(0, -1).some((s) => IGNORED_DIRS.has(s.toLowerCase()))) return true
  return false
}

/** 相对路径是否应被忽略(文件语义:隐藏/临时/缓存段命中,或扩展名不在白名单) */
export function isIgnored(relPath: string): boolean {
  if (pathSegmentsIgnored(relPath)) return true
  if (TEMP_SUFFIX.test(relPath)) return true
  const dot = relPath.lastIndexOf('.')
  if (dot < 0) return true
  const ext = relPath.slice(dot + 1).toLowerCase()
  if (ext === 'jpeg') return false
  return !Object.keys(EXT_WHITELIST).includes(ext)
}

/** 目录相对路径的忽略判断(不做扩展名检查) */
export function isIgnoredDir(relDir: string): boolean {
  return pathSegmentsIgnored(relDir)
}

/** 监听剪枝判断:无扩展名路径按目录放行(其内文件入库时再各自判断) */
export function isIgnoredWatch(p: string): boolean {
  if (isIgnoredDir(p)) return true
  if (!p.includes('.')) return false
  return isIgnored(p)
}

/** 相对路径 → 类型/格式;不在白名单返回 null */
export function detectKind(relPath: string): { type: 'image' | 'video' | 'model'; format: string } | null {
  const dot = relPath.lastIndexOf('.')
  if (dot < 0) return null
  const ext = relPath.slice(dot + 1).toLowerCase()
  if (ext === 'jpeg') return EXT_WHITELIST.jpg
  return EXT_WHITELIST[ext] ?? null
}

/** 扩展名白名单与忽略规则(扫描与监听共用) */
import { detectFormat, FORMAT_SPECS, isSupportedExtension } from '../../shared/formats'
import type { AssetFormat, AssetKind } from '../../shared/formats'

export type { AssetFormat, AssetKind } from '../../shared/formats'

/** 兼容旧调用点；新增格式请只改 src/shared/formats.ts。 */
export const EXT_WHITELIST: Record<string, { type: AssetKind; format: AssetFormat }> = Object.fromEntries(
  FORMAT_SPECS.map((spec) => [spec.ext, { type: spec.type, format: spec.format }])
)

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
  return !isSupportedExtension(ext)
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
export function detectKind(relPath: string): { type: AssetKind; format: string } | null {
  const spec = detectFormat(relPath)
  return spec ? { type: spec.type, format: spec.format } : null
}

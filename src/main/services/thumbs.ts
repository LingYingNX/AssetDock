import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileExists, writeFileAtomically } from './cacheFiles'

/**
 * 库内缩略图缓存:<库>/.mediahub/thumbs/
 *
 * - 文件名 = 素材指纹(内容寻址):指纹只由内容+大小+mtime 决定,与原图路径无关。
 *   因此原图移动或改名后缩略图仍然有效,既不用重新生成,也不用改指路径。
 * - index.json 记录设置版本与 指纹→相对路径 映射,用于:换缩略图尺寸时整体失效、
 *   删除素材时精确清理、以及孤儿回收。清单是缓存元数据,不是权威数据源——
 *   权威来源始终是库内数据库的 assets 表。
 */

export const THUMB_SIZE = 640
const THUMB_VERSION = 2
const FLUSH_DELAY_MS = 1500

export interface ThumbEntry {
  /** 生成时的原图相对路径,仅用于可读性与排查;原图移动后由调用方更新 */
  relPath: string
  mtimeMs: number
  sizeBytes: number
  generatedAt: string
}

export interface ThumbManifest {
  version: number
  size: number
  format: 'jpeg'
  entries: Record<string, ThumbEntry>
}

export function thumbsDir(libPath: string): string {
  return join(libPath, '.mediahub', 'thumbs')
}

/** 文件名带尺寸后缀:改 THUMB_SIZE 后自然生成新文件,旧尺寸成为孤儿由对账清理 */
export function thumbFileName(fingerprint: string): string {
  return `${fingerprint}-${THUMB_SIZE}.jpg`
}

export function thumbPath(libPath: string, fingerprint: string): string {
  return join(thumbsDir(libPath), thumbFileName(fingerprint))
}

export function thumbManifestPath(libPath: string): string {
  return join(thumbsDir(libPath), 'index.json')
}

const manifests = new Map<string, ThumbManifest>()
const flushTimers = new Map<string, NodeJS.Timeout>()

function emptyManifest(): ThumbManifest {
  return { version: THUMB_VERSION, size: THUMB_SIZE, format: 'jpeg', entries: {} }
}

function isUsable(value: unknown): value is ThumbManifest {
  if (!value || typeof value !== 'object') return false
  const m = value as Partial<ThumbManifest>
  return m.version === THUMB_VERSION && m.size === THUMB_SIZE && !!m.entries && typeof m.entries === 'object'
}

/** 读取清单;版本或尺寸不符时视为失效,返回空清单以触发重新生成。 */
async function loadManifest(libPath: string): Promise<ThumbManifest> {
  const cached = manifests.get(libPath)
  if (cached) return cached
  let manifest = emptyManifest()
  try {
    const parsed = JSON.parse(await readFile(thumbManifestPath(libPath), 'utf8')) as unknown
    if (isUsable(parsed)) manifest = { ...parsed, entries: { ...parsed.entries } }
  } catch { /* 缺失或损坏:按空清单重建 */ }
  manifests.set(libPath, manifest)
  return manifest
}

/**
 * 延迟合并写入:批量生成时逐个改写清单会退化成 O(n²) 的磁盘写,
 * 因此内存内累加、定时落盘,并提供 flushManifest 供关键路径同步。
 */
function scheduleFlush(libPath: string): void {
  if (flushTimers.has(libPath)) return
  const timer = setTimeout(() => {
    flushTimers.delete(libPath)
    void flushManifest(libPath)
  }, FLUSH_DELAY_MS)
  timer.unref?.()
  flushTimers.set(libPath, timer)
}

export async function flushManifest(libPath: string): Promise<void> {
  const manifest = manifests.get(libPath)
  if (!manifest) return
  const timer = flushTimers.get(libPath)
  if (timer) {
    clearTimeout(timer)
    flushTimers.delete(libPath)
  }
  await writeFileAtomically(thumbManifestPath(libPath), JSON.stringify(manifest)).catch(() => undefined)
}

/** 生成串行队列:一次只解码一张,避免机械盘被并发随机读拖垮 */
let chain: Promise<unknown> = Promise.resolve()
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn)
  chain = next.catch(() => undefined)
  return next
}

async function placeholderJpeg(label: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240">
    <rect width="320" height="240" fill="#B7C0CE"/>
    <text x="160" y="126" font-family="Segoe UI, sans-serif" font-size="30" font-weight="700"
      fill="#2C3444" text-anchor="middle">${label}</text>
  </svg>`
  const sharp = (await import('sharp')).default
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer()
}

/**
 * 确保缩略图存在并返回其路径。
 * 图片解码失败(PSD/损坏文件)退回格式占位图,不抛错,保证网格不出现空洞。
 */
export async function ensureThumb(
  libPath: string,
  absPath: string,
  fingerprint: string,
  format: string,
  meta: { relPath: string; mtimeMs: number; sizeBytes: number }
): Promise<{ path: string; placeholder: boolean }> {
  const manifest = await loadManifest(libPath)
  const target = thumbPath(libPath, fingerprint)

  // 文件与清单同时命中才认为有效:只有文件而清单缺失时补充清单,不重复解码
  if (manifest.entries[fingerprint] && await fileExists(target)) {
    return { path: target, placeholder: manifest.entries[fingerprint].relPath === '' }
  }

  return enqueue(async () => {
    const fresh = await loadManifest(libPath)
    if (fresh.entries[fingerprint] && await fileExists(target)) {
      return { path: target, placeholder: false }
    }
    if (await fileExists(target)) {
      fresh.entries[fingerprint] = { ...meta, generatedAt: new Date().toISOString() }
      scheduleFlush(libPath)
      return { path: target, placeholder: false }
    }

    await mkdir(thumbsDir(libPath), { recursive: true })
    let buf: Buffer
    let placeholder = false
    try {
      const sharp = (await import('sharp')).default
      buf = await sharp(absPath)
        .rotate()
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 84, mozjpeg: true })
        .toBuffer()
    } catch {
      buf = await placeholderJpeg(format)
      placeholder = true
    }
    await writeFileAtomically(target, buf)
    fresh.entries[fingerprint] = { ...meta, generatedAt: new Date().toISOString() }
    scheduleFlush(libPath)
    return { path: target, placeholder }
  })
}

/** 删除单个缩略图与清单条目(原图被清除时调用);删除是关键路径,立即落盘 */
export async function removeThumb(libPath: string, fingerprint: string): Promise<void> {
  const manifest = await loadManifest(libPath)
  if (manifest.entries[fingerprint]) {
    delete manifest.entries[fingerprint]
    await flushManifest(libPath)
  }
  await rm(thumbPath(libPath, fingerprint), { force: true }).catch(() => undefined)
}

/** 批量删除(清空回收站 / 清理缺失记录时调用):条目一次性落盘 */
export async function removeThumbs(libPath: string, fingerprints: string[]): Promise<number> {
  const manifest = await loadManifest(libPath)
  let removed = 0
  for (const fingerprint of fingerprints) {
    if (!fingerprint) continue
    if (manifest.entries[fingerprint]) delete manifest.entries[fingerprint]
    await rm(thumbPath(libPath, fingerprint), { force: true }).catch(() => undefined)
    removed++
  }
  if (removed > 0) await flushManifest(libPath)
  return removed
}

/** 原图移动/改名:指纹不变,缩略图文件继续有效,仅同步清单里的可读路径 */
export async function retargetThumb(libPath: string, fingerprint: string, relPath: string): Promise<void> {
  if (!fingerprint) return
  const manifest = await loadManifest(libPath)
  const entry = manifest.entries[fingerprint]
  if (!entry) return
  entry.relPath = relPath
  scheduleFlush(libPath)
}

/** 孤儿回收:清单中存在但文件已不在的条目直接剔除;返回剔除数量 */
export async function pruneMissingThumbs(libPath: string): Promise<number> {
  const manifest = await loadManifest(libPath)
  const gone: string[] = []
  for (const fingerprint of Object.keys(manifest.entries)) {
    if (!(await fileExists(thumbPath(libPath, fingerprint)))) gone.push(fingerprint)
  }
  for (const fingerprint of gone) delete manifest.entries[fingerprint]
  if (gone.length > 0) await flushManifest(libPath)
  return gone.length
}

/**
 * 清单与实际文件对账:
 * - 非当前命名(旧版本的无尺寸后缀 / 旧尺寸)文件一律清除;
 * - 当前命名但既不在清单、也不在 live 集合中的文件清除。
 */
export async function collectOrphanThumbs(libPath: string, liveFingerprints: Set<string>): Promise<number> {
  const manifest = await loadManifest(libPath)
  const expectedSuffix = `-${THUMB_SIZE}.jpg`
  let removed = 0
  const dirents = await readdir(thumbsDir(libPath)).catch(() => [] as string[])
  for (const name of dirents) {
    // 早期版本产出 WebP:不再产生,一律清理
    if (name.endsWith('.webp')) {
      await rm(join(thumbsDir(libPath), name), { force: true }).catch(() => undefined)
      removed++
      continue
    }
    if (name !== 'index.json' && !name.endsWith('.jpg')) continue
    // 命名不符合当前约定(旧格式/旧尺寸):直接清除
    if (!name.endsWith(expectedSuffix)) {
      await rm(join(thumbsDir(libPath), name), { force: true }).catch(() => undefined)
      removed++
      continue
    }
    const fingerprint = name.slice(0, -expectedSuffix.length)
    if (liveFingerprints.has(fingerprint) || manifest.entries[fingerprint]) continue
    await rm(join(thumbsDir(libPath), name), { force: true }).catch(() => undefined)
    removed++
  }
  return removed
}

/** 测试辅助:丢弃内存态,强制下次从磁盘重读 */
export function resetThumbCache(): void {
  for (const timer of flushTimers.values()) clearTimeout(timer)
  flushTimers.clear()
  manifests.clear()
}

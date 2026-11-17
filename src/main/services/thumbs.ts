import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { fileExists, writeFileAtomically } from './cacheFiles'
import { formatSpec, type AssetFormat } from '../../shared/formats'
import { THUMB_CACHE_VERSION, THUMB_SIZE } from '../../shared/thumbnailConfig'
import {
  createThumbnailJpeg,
  ThumbnailDecodeError,
  type ThumbnailFailureKind
} from './thumbnailDecoder'
import { ensureBlendPreview, ExternalPreviewError } from './externalPreview'
import { DOCUMENT_RENDERER_VERSION } from '../../shared/thumbnailConfig'

/**
 * 库内缩略图缓存:<库>/.mediahub/thumbs/
 *
 * - 文件名 = 素材指纹(内容寻址):指纹只由内容+大小+mtime 决定,与原图路径无关。
 *   因此原图移动或改名后缩略图仍然有效,既不用重新生成,也不用改指路径。
 * - index.json 记录设置版本与 指纹→相对路径 映射,用于:换缩略图尺寸时整体失效、
 *   删除素材时精确清理、以及孤儿回收。清单是缓存元数据,不是权威数据源——
 *   权威来源始终是库内数据库的 assets 表。
 */

export { THUMB_SIZE } from '../../shared/thumbnailConfig'
const THUMB_VERSION = THUMB_CACHE_VERSION
const FLUSH_DELAY_MS = 1500
const MISSING_TOOL_RETRY_MS = 60_000

/**
 * CSS 封面的渲染逻辑版本。
 *
 * 位图缩略图只由原图内容决定,指纹变了重生成即可;但 CSS 封面还取决于预览骨架的拼接方式
 * ——骨架改了而素材没改时指纹不变,旧封面会一直留着。把这个版本写进清单条目,
 * 改渲染逻辑时递增,存量 CSS 封面即按新骨架重建(位图不受影响)。
 */
export const SHELL_VERSION = 2
export const SVG_THUMB_RENDERER = 2
export const MODEL_THUMB_RENDERER = 1

export interface ThumbEntry {
  /** 生成时的原图相对路径,仅用于可读性与排查;原图移动后由调用方更新 */
  relPath: string
  mtimeMs: number
  sizeBytes: number
  generatedAt: string
  /** 失败也按指纹缓存，重复请求不会反复启动解码进程。 */
  failure?: ThumbnailFailureKind
  error?: string
  /** 仅 CSS 封面写入:生成时的骨架版本 */
  shell?: number
  /** 仅 SVG 写入:生成时的离屏渲染版本 */
  renderer?: number
  /**
   * 仅 CSS 封面写入:生成时的外观签名(配套 HTML 的内容摘要)。
   *
   * 配套 HTML 是附属文件,改它不会动 CSS 指纹,单看指纹会误判成「缓存有效」而沿用旧封面。
   * 把外观签名一并记下来比对,HTML 一改封面即重建。
   */
  look?: string
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

/**
 * 生成任务并发池(S1-8):一次最多 THUMB_CONCURRENCY 个解码任务。
 * 原先是全局单链串行——大库首刷时每张图排队,协议请求全部挂起。
 * sharp 解码是 CPU 密集,4 并发足以吃满单核剩余 IO 余量又不挤爆机械盘随机读。
 */
const THUMB_CONCURRENCY = 4
let running = 0
const waiters: Array<() => void> = []

async function acquireSlot(): Promise<void> {
  if (running < THUMB_CONCURRENCY) {
    running++
    return
  }
  await new Promise<void>((resolve) => waiters.push(resolve))
  running++
}

function releaseSlot(): void {
  running--
  const next = waiters.shift()
  if (next) next()
}

async function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  await acquireSlot()
  try {
    return await fn()
  } finally {
    releaseSlot()
  }
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
 * 同步占位 SVG(S1-8):协议请求在缩略图尚未生成时立即返回的轻量响应体。
 * 与格式占位图不同色,渲染层据此可区分「还在生成」与「生成失败」。
 */
export function inlinePlaceholderSvg(label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240">
    <rect width="320" height="240" fill="#E2E6EC"/>
    <text x="160" y="126" font-family="Segoe UI, sans-serif" font-size="22" font-weight="600"
      fill="#8A94A6" text-anchor="middle">${label}</text>
  </svg>`
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
  meta: { relPath: string; mtimeMs: number; sizeBytes: number; libraryId?: number },
  /**
   * CSS 专用的外观签名:配套 HTML 的内容摘要。
   * 传 null 表示当前没有配套 HTML(用推导骨架),与「有 HTML」区分开,不能只用空串混淆。
   */
  look?: string | null
): Promise<{ path: string; placeholder: boolean }> {
  const manifest = await loadManifest(libPath)
  const target = thumbPath(libPath, fingerprint)
  // CSS 封面还要外观对齐:骨架版本或配套 HTML 变了,存量封面必须重建(位图只认指纹)
  const wantLook = format === 'CSS' ? (look ?? '') : ''
  const spec = formatSpec(format)
  const isModelThumb = spec?.thumbnail === 'three' ||
    (format === 'BLEND' && spec?.thumbnail === 'external')
  const isDocumentThumb = spec?.thumbnail === 'document'
  const rendererVersion = format === 'SVG'
    ? SVG_THUMB_RENDERER
    : isModelThumb
      ? MODEL_THUMB_RENDERER
      : isDocumentThumb
        ? DOCUMENT_RENDERER_VERSION
      : null
  const matches = (entry: ThumbEntry | undefined): boolean => {
    if (!entry) return false
    if (entry.failure === 'missing-tool' && Date.now() - Date.parse(entry.generatedAt) >= MISSING_TOOL_RETRY_MS) {
      return false
    }
    if (rendererVersion != null) return entry.renderer === rendererVersion
    return format !== 'CSS' || (entry.shell === SHELL_VERSION && (entry.look ?? '') === wantLook)
  }

  const cached = manifest.entries[fingerprint]
  if (matches(cached) && await fileExists(target)) {
    return { path: target, placeholder: !!cached.failure }
  }

  return enqueue(async () => {
    const fresh = await loadManifest(libPath)
    const freshEntry = fresh.entries[fingerprint]
    if (matches(freshEntry) && await fileExists(target)) {
      return { path: target, placeholder: !!freshEntry.failure }
    }
    if (freshEntry?.failure === 'missing-tool' && !matches(freshEntry)) {
      delete fresh.entries[fingerprint]
      await rm(target, { force: true }).catch(() => undefined)
    }
    if ((format === 'CSS' || rendererVersion != null) && freshEntry) delete fresh.entries[fingerprint]
    if (await fileExists(target)) {
      if (format === 'CSS' || rendererVersion != null || !freshEntry) {
        // 清单版本失效、孤儿文件或 CSS 外观变化时,旧 JPEG 不可证明对应当前规则
        await rm(target, { force: true }).catch(() => undefined)
      } else {
        fresh.entries[fingerprint] = { ...meta, generatedAt: new Date().toISOString() }
        scheduleFlush(libPath)
        return { path: target, placeholder: false }
      }
    }

    await mkdir(thumbsDir(libPath), { recursive: true })
    let buf: Buffer
    let placeholder = false
    let failure: ThumbnailFailureKind | undefined
    let failureDetail: string | undefined
    try {
      if (format === 'CSS') {
        // CSS 没有可解码像素:走离屏渲染截图,产出与位图同规格的 JPEG
        const { renderCssThumbFromFile } = await import('./cssThumb')
        buf = await renderCssThumbFromFile(libPath, absPath, THUMB_SIZE)
      } else if (format === 'HTML') {
        // HTML 正文多由运行时脚本挂载,走文档预览会被剥掉脚本变成空白页;直接渲染原文件
        const { renderHtmlThumbFromFile } = await import('./cssThumb')
        buf = await renderHtmlThumbFromFile(absPath, THUMB_SIZE)
      } else if (isDocumentThumb) {
        const { ensureDocumentPreview, documentThumbnailHtml } = await import('./documentPreview')
        const preview = await ensureDocumentPreview(libPath, absPath, fingerprint, format, meta)
        if (preview.failure) {
          throw new ThumbnailDecodeError(preview.failureDetail ?? 'document preview failed', preview.failure)
        }
        const { renderCssThumbJpeg } = await import('./cssThumb')
        buf = await renderCssThumbJpeg(documentThumbnailHtml(preview), THUMB_SIZE, libPath)
      } else {
        if (!spec) throw new ThumbnailDecodeError(`unknown format: ${format}`, 'unsupported')
        if (spec.thumbnail === 'three') {
          if (meta.libraryId == null) throw new ThumbnailDecodeError('missing library id', 'unsupported')
          const url = `media://${meta.libraryId}/${encodeURIComponent(meta.relPath)}?v=${encodeURIComponent(fingerprint)}`
          const { renderModelThumbJpeg } = await import('./modelThumb')
          buf = await renderModelThumbJpeg(url, spec.format, THUMB_SIZE)
        } else if (spec.thumbnail === 'external') {
          if (format !== 'BLEND' || meta.libraryId == null) {
            throw new ThumbnailDecodeError(`external preview unavailable for ${format}`, 'missing-tool')
          }
          await ensureBlendPreview(libPath, absPath, fingerprint)
          const url = `media://${meta.libraryId}/${encodeURIComponent(meta.relPath)}?blend=1&v=${encodeURIComponent(fingerprint)}`
          const { renderModelThumbJpeg } = await import('./modelThumb')
          buf = await renderModelThumbJpeg(url, 'GLB', THUMB_SIZE)
        } else {
          buf = await createThumbnailJpeg(spec.format as AssetFormat, absPath)
        }
      }
    } catch (error) {
      buf = await placeholderJpeg(format)
      placeholder = true
      failure = error instanceof ThumbnailDecodeError
        ? error.kind
        : error instanceof ExternalPreviewError
          ? (error.kind === 'failed' ? 'corrupt' : error.kind)
          : 'corrupt'
      failureDetail = error instanceof Error ? error.message : String(error)
    }
    await writeFileAtomically(target, buf)
    fresh.entries[fingerprint] = {
      ...meta,
      generatedAt: new Date().toISOString(),
      ...(failure ? { failure } : {}),
      ...(failureDetail ? { error: failureDetail } : {}),
      ...(format === 'CSS' ? { shell: SHELL_VERSION, look: wantLook } : {}),
      ...(rendererVersion != null ? { renderer: rendererVersion } : {})
    }
    scheduleFlush(libPath)
    return { path: target, placeholder }
  })
}

/**
 * 后台补齐单个缩略图(S1-8):协议请求 miss 时由 media.ts 触发,不阻塞协议响应。
 * onDone 在生成完成(无论成功失败)后回调一次,供主进程通知渲染层重取该图。
 * 已有有效缓存时不动、不回调——调用方在请求路径上本就先查过缓存。
 */
export function warmThumbInBackground(
  libPath: string,
  absPath: string,
  fingerprint: string,
  format: string,
  meta: { relPath: string; mtimeMs: number; sizeBytes: number; libraryId?: number },
  look?: string | null,
  onDone?: () => void
): void {
  if (!fingerprint) return
  void ensureThumb(libPath, absPath, fingerprint, format, meta, look)
    .catch(() => undefined)
    .finally(() => { if (onDone) try { onDone() } catch { /* 通知失败不影响生成 */ } })
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

/**
 * 指纹由内容决定,同内容素材共用一个缩略图。删除前须确认库里已无存活素材使用它,
 * 否则会误删其它素材仍在引用的缓存。
 */
export function fingerprintInUse(db: Database.Database, libraryId: number, fingerprint: string): boolean {
  return !!db
    .prepare('SELECT 1 FROM assets WHERE library_id = ? AND fingerprint = ? AND deleted_at IS NULL LIMIT 1')
    .get(libraryId, fingerprint)
}

/** 批量删除缩略图,但跳过仍被存活素材引用的指纹;返回实际删除数量 */
export async function removeThumbsIfUnused(
  libPath: string,
  db: Database.Database,
  libraryId: number,
  fingerprints: string[]
): Promise<number> {
  const safe = fingerprints.filter((fp) => fp && !fingerprintInUse(db, libraryId, fp))
  return safe.length > 0 ? removeThumbs(libPath, safe) : 0
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

/**
 * 跨库搬素材时把源库那份缩略图一起搬过来。
 *
 * 缩略图目录是按库放的,而且指纹里含 mtime —— 复制后 mtime 变了,目标库的指纹
 * 也不一样,所以这里按「新指纹」重新命名落地,清单条目(渲染器/骨架版本、外观签名)
 * 一并照搬。少了条目这一步,SVG / CSS / 文档 / 3D 那几类会被 ensureThumb 判成
 * 无法证明对应规则变化的孤儿文件删掉重渲染,正是搬家后要等几秒才出图的原因。
 *
 * 源库没有这条缩略图(或它本身是失败占位)就什么都不做,交给目标库正常生成。
 */
export async function adoptThumb(
  sourceLibPath: string,
  targetLibPath: string,
  sourceFingerprint: string,
  targetFingerprint: string,
  relPath: string
): Promise<boolean> {
  if (!sourceFingerprint || !targetFingerprint || sourceLibPath === targetLibPath) return false
  const entry = (await loadManifest(sourceLibPath)).entries[sourceFingerprint]
  if (!entry || entry.failure) return false
  const from = thumbPath(sourceLibPath, sourceFingerprint)
  const manifest = await loadManifest(targetLibPath)
  const existing = manifest.entries[targetFingerprint]
  if (existing && (await fileExists(thumbPath(targetLibPath, targetFingerprint)))) return true
  if (!(await fileExists(from))) return false
  await mkdir(thumbsDir(targetLibPath), { recursive: true })
  await copyFile(from, thumbPath(targetLibPath, targetFingerprint))
  manifest.entries[targetFingerprint] = { ...entry, relPath }
  scheduleFlush(targetLibPath)
  return true
}

/** 孤儿回收:清单中存在但文件已不在的条目直接剔除;返回剔除数量 */
export async function pruneMissingThumbs(libPath: string): Promise<number> {
  const manifest = await loadManifest(libPath)
  // 目录一次读完再比对:34k 条逐条 fileExists 会在启动时把 libuv 线程池占满,
  // 首屏的 folders:list 只能排在后面。
  const names = new Set(await readdir(thumbsDir(libPath)).catch(() => [] as string[]))
  const gone: string[] = []
  for (const fingerprint of Object.keys(manifest.entries)) {
    if (!names.has(thumbFileName(fingerprint))) gone.push(fingerprint)
  }
  for (const fingerprint of gone) delete manifest.entries[fingerprint]
  if (gone.length > 0) await flushManifest(libPath)
  return gone.length
}

/**
 * 清单与实际文件对账:
 * - 清单自身永不删除;
 * - 非当前命名(旧版本的无尺寸后缀 / 旧尺寸)文件一律清除;
 * - 当前命名但既不在清单、也不在 live 集合中的文件清除;
 * - 清单里但已无存活素材引用的条目(如残留的回收站条目)一并剔除。
 */
export async function collectOrphanThumbs(libPath: string, liveFingerprints: Set<string>): Promise<number> {
  const manifest = await loadManifest(libPath)
  const expectedSuffix = `-${THUMB_SIZE}.jpg`
  let removed = 0
  let manifestChanged = false
  for (const fingerprint of Object.keys(manifest.entries)) {
    if (liveFingerprints.has(fingerprint)) continue
    delete manifest.entries[fingerprint]
    manifestChanged = true
  }
  const dirents = await readdir(thumbsDir(libPath)).catch(() => [] as string[])
  for (const name of dirents) {
    if (name === 'index.json') continue
    // 早期版本产出 WebP:不再产生,一律清理
    if (name.endsWith('.webp')) {
      await rm(join(thumbsDir(libPath), name), { force: true }).catch(() => undefined)
      removed++
      continue
    }
    if (!name.endsWith('.jpg')) continue
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
  if (manifestChanged) await flushManifest(libPath)
  return removed
}

export interface ThumbJob {
  absPath: string
  fingerprint: string
  format: string
  meta: { relPath: string; mtimeMs: number; sizeBytes: number; libraryId?: number }
}

export interface ThumbJobRow {
  rel_path: string
  fingerprint: string
  format: string
  mtime_ms: number
  size_bytes: number
}

/**
 * Rows that need an eager thumbnail: raster/doc images, video keyframes, 3D models and CSS.
 * SVG and HTML are intentionally excluded because their Chromium render is expensive
 * (HTML must boot a whole page and wait for its runtime script; 18000 documents would
 * still take hours). They are generated lazily when a card first requests ?thumb=1.
 * Missing and trashed assets are excluded too.
 */
export function thumbJobRows(
  db: Database.Database,
  libraryId: number,
  fingerprints?: readonly string[]
): ThumbJobRow[] {
  const rows = db
    .prepare(
      `SELECT rel_path, fingerprint, format, mtime_ms, size_bytes FROM assets
       WHERE library_id = ? AND missing = 0 AND deleted_at IS NULL
         AND type IN ('image', 'video', 'model', 'style', 'document')
         AND upper(format) NOT IN ('SVG', 'HTML', 'HTM') AND fingerprint <> ''`
    )
    .all(libraryId) as ThumbJobRow[]
  if (!fingerprints) return rows
  const wanted = new Set(fingerprints)
  return rows.filter((row) => wanted.has(row.fingerprint))
}

/**
 * 全量预热:只处理清单里还没有的指纹,按队列串行生成并回报进度。
 * 已生成过的直接跳过,因此重复调用只补新素材;进度回调以「本次待生成总数」为分母。
 *
 * 必须串行:sharp 是 libvips 的 N-API 模块,同一进程里多个预热 worker 在
 * 解码边界上重入会让原生栈保护触发 0xC0000409,整个主进程直接退出
 * (表现为「窗口闪一下就没了」)。解码并发已由 ensureThumb 内部的 4 槽池负责。
 */
export async function generateMissingThumbs(
  libPath: string,
  jobs: ThumbJob[],
  onProgress?: (done: number, total: number) => void,
  onError?: (job: ThumbJob, error: unknown) => void
): Promise<{ total: number; generated: number; failed: number }> {
  const manifest = await loadManifest(libPath)
  const seen = new Set<string>()
  const todo: ThumbJob[] = []
  for (const job of jobs) {
    if (!job.fingerprint || seen.has(job.fingerprint)) continue
    seen.add(job.fingerprint)
    // 只信清单,不逐个 fileExists:启动时 1 万次串行探测在机械盘上要 8s,
    // 会把首屏 folders:list 一起拖住;被外部删掉的缩略图由请求路径的 ensureThumb 重建。
    if (manifest.entries[job.fingerprint]) continue
    todo.push(job)
  }
  onProgress?.(0, todo.length)
  let done = 0
  let failed = 0
  for (const job of todo) {
    try {
      await ensureThumb(libPath, job.absPath, job.fingerprint, job.format, job.meta)
    } catch (error) {
      // S3-6:单张失败不中断批次,计数上报
      failed++
      onError?.(job, error)
      console.error('[thumbs] generate failed', job.meta.relPath, error)
    }
    done++
    if (done % 5 === 0 || done === todo.length) onProgress?.(done, todo.length)
  }
  if (todo.length > 0) await flushManifest(libPath)
  return { total: todo.length, generated: done - failed, failed }
}
/** 测试辅助:丢弃内存态,强制下次从磁盘重读 */
export function resetThumbCache(): void {
  for (const timer of flushTimers.values()) clearTimeout(timer)
  flushTimers.clear()
  manifests.clear()
}

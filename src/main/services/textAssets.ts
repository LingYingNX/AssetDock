import type Database from 'better-sqlite3'
import { promises as fsp } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { realPathWithinRoot } from './libResolve'
import { fingerprint } from './fingerprint'
import { writeFileAtomically } from './cacheFiles'
import { upsertScanned } from './store'

/**
 * 文本类素材(CSS)的读写。
 *
 * 读写都必须先经库根真实路径校验:join 出来的路径可能被符号链接/Junction 导向库外,
 * realPathWithinRoot 会解析真实路径并拒绝越界。保存采用原子替换,避免中断留下半截文件。
 */

export interface TextReadResult {
  text: string
  sizeBytes: number
}

/** 读取库内文本素材;越界或缺失返回 null(IPC 层转成错误结果) */
export async function readTextAsset(libPath: string, relPath: string): Promise<TextReadResult | null> {
  const abs = join(libPath, relPath)
  const real = await realPathWithinRoot(libPath, abs)
  if (!real) return null
  const text = await fsp.readFile(real, 'utf8').catch(() => null)
  if (text == null) return null
  const st = await fsp.stat(real).catch(() => null)
  return { text, sizeBytes: st?.size ?? Buffer.byteLength(text, 'utf8') }
}

/** CSS 素材的配套 HTML 骨架路径(同目录同名 .html) */
export function siblingShellRelPath(relPath: string): string {
  const ext = extname(relPath)
  const stem = ext ? relPath.slice(0, -ext.length) : relPath
  return `${stem}.html`
}

/**
 * 读取 CSS 素材的配套 HTML 骨架。
 *
 * 站点收集来的组件是 HTML + CSS 成对给出的,单看 CSS 无法知道外观由哪些元素承载,
 * 所以外观交给这段 HTML 决定。文件不存在不是错误,返回 null 表示「还没有骨架」。
 */
export async function readShellAsset(libPath: string, relPath: string): Promise<TextReadResult | null> {
  return readTextAsset(libPath, siblingShellRelPath(relPath))
}

/**
 * 写入 CSS 素材的配套 HTML 骨架。
 *
 * 与 CSS 不同,HTML 是承载外观的附属文件而非入库素材,因此不动 assets 行、不重算指纹,
 * 只原子落盘并让调用方重渲染封面。目标可能尚不存在,故校验其所在目录确实落在库内。
 */
export async function writeShellAsset(libPath: string, relPath: string, html: string): Promise<boolean> {
  const target = join(libPath, siblingShellRelPath(relPath))
  const dirReal = await realPathWithinRoot(libPath, dirname(target))
  if (!dirReal) return false
  await writeFileAtomically(target, html)
  return true
}

/**
 * CSS 素材改名后,把配套 HTML 骨架改成同名。
 *
 * 骨架靠「同目录同名」关联,不跟着改就会断链、外观退回推导骨架。
 * 骨架不存在时静默跳过;目标已被占用时保留原骨架,不覆盖别人的文件。
 */
export async function renameShellAlongside(libPath: string, oldRelPath: string, newRelPath: string): Promise<boolean> {
  const from = join(libPath, siblingShellRelPath(oldRelPath))
  const to = join(libPath, siblingShellRelPath(newRelPath))
  if (from === to) return false
  const [fromReal, toDirReal] = await Promise.all([
    realPathWithinRoot(libPath, from),
    realPathWithinRoot(libPath, dirname(to))
  ])
  if (!fromReal || !toDirReal) return false
  if (await fsp.access(to).then(() => true, () => false)) return false
  await fsp.rename(fromReal, to).catch(() => undefined)
  return true
}

/**
 * 写回库内文本素材并同步元数据。
 *
 * 只更新大小、mtime 与指纹(以及 missing=0);id、标签、评分、文件夹与导入时间保持不变,
 * 由 upsertScanned 的既有语义保证。返回新的指纹与大小,供缩略图重新生成。
 */
export async function writeTextAsset(
  db: Database.Database,
  libraryId: number,
  libPath: string,
  relPath: string,
  text: string
): Promise<{ fingerprint: string; sizeBytes: number } | null> {
  const abs = join(libPath, relPath)
  const real = await realPathWithinRoot(libPath, abs)
  if (!real) return null

  await writeFileAtomically(real, text)
  const st = await fsp.stat(real).catch(() => null)
  if (!st) return null
  const nextFingerprint = await fingerprint(real, st.size, st.mtimeMs)

  upsertScanned(db, libraryId, [{
    relPath,
    name: relPath.slice(relPath.lastIndexOf('/') + 1).replace(/\.[^.]+$/, ''),
    type: 'style',
    format: 'CSS',
    sizeBytes: st.size,
    mtimeMs: st.mtimeMs,
    fingerprint: nextFingerprint
  }])

  return { fingerprint: nextFingerprint, sizeBytes: st.size }
}
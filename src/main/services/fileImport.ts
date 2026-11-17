import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, realpath, rm } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { detectKind, isIgnored } from './ignore'
import { realPathWithinRoot } from './libResolve'
import { scanPaths } from './scan'
import type { ScanEntry } from './store'

export interface DroppedFileImport {
  entries: ScanEntry[]
  imported: number
  skipped: number
}

/** 拖入的是外部文件:库内路径排除,避免把已入库素材再复制一份。 */
export function normalizeDroppedPaths(paths: readonly unknown[], libraryRoot: string): string[] {
  const root = resolve(libraryRoot)
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of paths) {
    if (typeof value !== 'string' || !value.trim()) continue
    const abs = resolve(value)
    if (!isAbsolute(value)) continue
    const rel = relative(root, abs)
    const inside = rel === '' || (rel !== '..' && !rel.startsWith('..\\') && !isAbsolute(rel))
    const fileName = basename(abs)
    if (inside || isIgnored(fileName)) continue
    const key = abs.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(abs)
  }
  return out
}

function targetInside(root: string, targetFolder: string, fileName: string): { abs: string; rel: string } {
  const base = resolve(root)
  const folder = resolve(base, targetFolder)
  const folderRel = relative(base, folder)
  if (folderRel === '..' || folderRel.startsWith('..\\') || isAbsolute(folderRel)) throw new Error('目标文件夹不存在')
  const abs = join(folder, fileName)
  const rel = relative(base, abs)
  if (!rel || rel === '..' || rel.startsWith('..\\') || isAbsolute(rel)) throw new Error('导入路径超出素材库范围')
  return { abs, rel: rel.replace(/\\/g, '/') }
}

/** 在目标文件夹里找一个不冲突的文件名;`claimed` 收集同批已占用的路径,避免批内互撞。 */
export async function uniqueTarget(root: string, targetFolder: string, fileName: string, claimed: Set<string>): Promise<{ abs: string; rel: string }> {
  const dot = fileName.lastIndexOf('.')
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  const ext = dot > 0 ? fileName.slice(dot) : ''
  for (let n = 1; ; n++) {
    const candidate = targetInside(root, targetFolder, n === 1 ? fileName : `${stem} (${n})${ext}`)
    const key = candidate.abs.toLowerCase()
    if (claimed.has(key)) continue
    try {
      await lstat(candidate.abs)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        claimed.add(key)
        return candidate
      }
      throw error
    }
  }
}

/**
 * 系统文件拖入:复制进当前文件夹,同名自动避让,不覆盖、不删除源文件。
 * 先把全部目标路径定下来再复制,避免同批两个同名文件互相覆盖。
 */
export async function importDroppedFiles(
  libraryRoot: string,
  targetFolder: string,
  filePaths: readonly string[],
  onProgress?: (done: number) => void
): Promise<DroppedFileImport> {
  const root = resolve(libraryRoot)
  const sourcePaths = normalizeDroppedPaths(filePaths, root)
  const folder = resolve(root, targetFolder)
  const stat = await lstat(folder).catch(() => null)
  if (!stat?.isDirectory()) throw new Error('目标文件夹不存在')
  if (!(await realPathWithinRoot(root, folder))) throw new Error('目标文件夹不在素材库内')

  const copies: { source: string; target: { abs: string; rel: string } }[] = []
  const claimed = new Set<string>()
  let skipped = Math.max(0, filePaths.length - sourcePaths.length)
  for (const source of sourcePaths) {
    const sourceStat = await lstat(source).catch(() => null)
    const kind = detectKind(source)
    // 源文件本身不做库根包含校验:系统拖入的合法来源通常在库外。
    // 只解析真实路径,确保断链、不可读或自引用链接被跳过,而不是等到 copyFile 才失败。
    const sourceReal = sourceStat?.isFile() ? await realpath(source).catch(() => null) : null
    if (!sourceStat?.isFile() || !kind || !sourceReal) {
      skipped++
      continue
    }
    copies.push({ source, target: await uniqueTarget(root, targetFolder, basename(source), claimed) })
  }

  await mkdir(folder, { recursive: true })
  const copied: typeof copies = []
  try {
    for (const item of copies) {
      await copyFile(item.source, item.target.abs, constants.COPYFILE_EXCL)
      copied.push(item)
      if (copied.length % 20 === 0 || copied.length === copies.length) onProgress?.(copied.length)
    }
  } catch (error) {
    for (const item of copied) {
      await rm(item.target.abs, { force: true }).catch(() => undefined)
    }
    throw error
  }

  const entries = copied.length > 0
    ? await scanPaths(root, copied.map((item) => item.target.rel))
    : []
  // scanPaths 返回的空缺不能静默:调用方应先入库再提示成功。
  // 复制已完成但扫描失败时,删除本次写入,避免留下无库记录的文件。
  if (copied.length > 0 && entries.length !== copied.length) {
    for (const item of copied) {
      await rm(item.target.abs, { force: true }).catch(() => undefined)
    }
    throw new Error('导入素材失败,请重试')
  }
  return { entries, imported: copied.length, skipped }
}

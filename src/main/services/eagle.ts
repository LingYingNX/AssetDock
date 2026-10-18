import { copyFile, lstat, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { scanPaths } from './scan'
import type { ScanEntry } from './store'

type JsonObject = Record<string, unknown>

interface EagleDraft {
  relPath: string
  name: string
  folderPaths: string[]
  importedAt: string
  mtimeMs: number | null
  manualOrder: number | null
}

export interface EagleScan {
  entries: ScanEntry[]
  folders: { path: string }[]
  assets: EagleDraft[]
}

export interface EagleImportResult {
  imported: number
  multiFolderAssets: number
  entries: ScanEntry[]
}

interface EagleCopy {
  source: string
  target: string
}

function object(value: unknown): JsonObject | null {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

async function json(path: string): Promise<JsonObject | null> {
  try {
    return object(JSON.parse(await readFile(path, 'utf8')))
  } catch {
    return null
  }
}

function folderName(value: string): string {
  return value.replace(/[\\/]/g, '_').trim() || '未命名'
}

function importTime(value: number | null): string {
  // S2-6:与 upsertScanned 对齐保留毫秒精度,展示层自行截断
  return value == null ? new Date().toISOString() : new Date(value).toISOString()
}

function pathInside(root: string, target: string): string {
  const base = resolve(root)
  const resolved = resolve(target)
  const rel = relative(base, resolved)
  if (!rel || rel === '..' || rel.startsWith('..\\') || isAbsolute(rel)) throw new Error('导入路径超出素材库范围')
  return resolved
}

function pathsOverlap(left: string, right: string): boolean {
  const a = resolve(left)
  const b = resolve(right)
  const rel = relative(a, b)
  return rel === '' || (rel !== '..' && !rel.startsWith('..\\') && !isAbsolute(rel))
}

function numberedFileName(fileName: string, number: number): string {
  if (number === 1) return fileName
  const dot = fileName.lastIndexOf('.')
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  const ext = dot > 0 ? fileName.slice(dot) : ''
  return `${stem} (${number})${ext}`
}

async function uniqueTarget(directory: string, fileName: string, claimed: Set<string>): Promise<string> {
  for (let number = 1; ; number++) {
    const target = join(directory, numberedFileName(fileName, number))
    const key = target.toLowerCase()
    if (claimed.has(key)) continue
    try {
      await lstat(target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        claimed.add(key)
        return target
      }
      throw error
    }
  }
}

async function copyFileExclusive(source: string, target: string): Promise<void> {
  await copyFile(source, target, constants.COPYFILE_EXCL)
}

function eagleFolders(data: JsonObject, rootName: string): { folders: { path: string }[]; paths: Map<string, string> } {
  const folders: { path: string }[] = [{ path: rootName }]
  const paths = new Map<string, string>()
  const used = new Set<string>([rootName])
  const visit = (items: unknown, parent: string): void => {
    if (!Array.isArray(items)) return
    for (const value of items) {
      const item = object(value)
      const id = item && text(item.id)
      const name = item && text(item.name)
      if (!item || !id || !name) continue
      let path = `${parent}/${folderName(name)}`
      for (let suffix = 2; used.has(path); suffix++) path = `${parent}/${folderName(name)} (${suffix})`
      used.add(path)
      folders.push({ path })
      paths.set(id, path)
      visit(item.children, path)
    }
  }
  visit(data.folders, rootName)
  return { folders, paths }
}

function assetPath(item: JsonObject): { relPath: string; name: string } | null {
  const id = text(item.id)
  const name = text(item.name)
  const ext = text(item.ext)?.replace(/^\./, '')
  if (!id || !name || !ext || !/^[a-z0-9]+$/i.test(ext) || /[\\/]/.test(id)) return null
  const fileName = name.toLowerCase().endsWith(`.${ext.toLowerCase()}`) ? name : `${name}.${ext}`
  if (basename(fileName) !== fileName) return null
  return { relPath: `images/${id}.info/${fileName}`, name }
}

async function readDrafts(root: string, folderPaths: Map<string, string>, rootName: string, manualOrders: JsonObject): Promise<EagleDraft[]> {
  const images = join(root, 'images')
  const infoDirs = (await readdir(images, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.info'))
    .map((entry) => entry.name)
  const drafts: EagleDraft[] = []
  for (let start = 0; start < infoDirs.length; start += 64) {
    const batch = await Promise.all(infoDirs.slice(start, start + 64).map(async (dir) => {
      const item = await json(join(images, dir, 'metadata.json'))
      if (!item || item.isDeleted === true) return null
      const source = assetPath(item)
      if (!source) return null
      const assigned = Array.isArray(item.folders)
        ? item.folders.map((id) => typeof id === 'string' ? folderPaths.get(id) : undefined).filter((path): path is string => !!path)
        : []
      const id = text(item.id)
      const btime = number(item.btime)
      return {
        ...source,
        folderPaths: [...new Set([rootName, ...assigned])],
        importedAt: importTime(btime),
        mtimeMs: number(item.mtime),
        manualOrder: id ? number(manualOrders[id]) : null
      } satisfies EagleDraft
    }))
    for (const draft of batch) if (draft) drafts.push(draft)
  }
  return drafts
}

/** 只读取 Eagle 数据库，跳过其预览副本并返回源文件映射。 */
export async function scanEagleLibrary(root: string, onProgress?: (done: number) => void): Promise<EagleScan> {
  const metadata = await json(join(root, 'metadata.json'))
  if (!metadata || !Array.isArray(metadata.folders)) throw new Error('所选目录不是有效的 Eagle 素材库')
  const rootName = basename(root).replace(/\.library$/i, '') || 'Eagle'
  const { folders, paths } = eagleFolders(metadata, rootName)
  const manualOrders = await json(join(root, 'mtime.json')) ?? {}
  const drafts = await readDrafts(root, paths, rootName, manualOrders)
  const scanned = await scanPaths(root, drafts.map((draft) => draft.relPath), onProgress)
  const byPath = new Map(scanned.map((entry) => [entry.relPath, entry]))
  const entries: ScanEntry[] = []
  const assets: EagleDraft[] = []
  for (const draft of drafts) {
    const entry = byPath.get(draft.relPath)
    if (!entry) continue
    entries.push({ ...entry, name: draft.name })
    assets.push(draft)
  }
  return { entries, folders, assets }
}

/** 将 Eagle 原文件复制进当前素材库；多分类素材以首个分类作为物理位置。 */
export async function copyEagleLibraryAssets(
  eagleRoot: string,
  libraryRoot: string,
  eagle: EagleScan,
  onProgress?: (done: number) => void,
  copy: (source: string, target: string) => Promise<void> = copyFileExclusive
): Promise<EagleImportResult> {
  if (pathsOverlap(eagleRoot, libraryRoot) || pathsOverlap(libraryRoot, eagleRoot)) {
    throw new Error('Eagle 素材库不能与当前素材库重叠')
  }
  if (eagle.entries.length !== eagle.assets.length) throw new Error('Eagle 素材清单不完整')

  const claimed = new Set<string>()
  const copies: EagleCopy[] = []
  let multiFolderAssets = 0
  for (const folder of eagle.folders) await mkdir(pathInside(libraryRoot, join(libraryRoot, ...folder.path.split('/'))), { recursive: true })
  for (let index = 0; index < eagle.entries.length; index++) {
    const entry = eagle.entries[index]
    const asset = eagle.assets[index]
    const source = pathInside(eagleRoot, join(eagleRoot, ...entry.relPath.split('/')))
    const sourceStat = await lstat(source).catch(() => null)
    if (!sourceStat?.isFile()) throw new Error(`Eagle 原始素材不存在: ${entry.relPath}`)
    const folder = asset.folderPaths[1] ?? asset.folderPaths[0]
    if (!folder) throw new Error(`Eagle 素材缺少分类: ${entry.relPath}`)
    if (asset.folderPaths.length > 2) multiFolderAssets++
    const directory = pathInside(libraryRoot, join(libraryRoot, ...folder.split('/')))
    await mkdir(directory, { recursive: true })
    copies.push({ source, target: await uniqueTarget(directory, basename(entry.relPath), claimed) })
  }

  const copied: EagleCopy[] = []
  try {
    for (const item of copies) {
      await copy(item.source, item.target)
      copied.push(item)
      if (copied.length % 20 === 0 || copied.length === copies.length) onProgress?.(copied.length)
    }
  } catch (error) {
    const cleanupFailures: EagleCopy[] = []
    for (const item of copied.reverse()) {
      await rm(item.target, { force: true }).catch(() => cleanupFailures.push(item))
    }
    if (cleanupFailures.length > 0) throw new Error(`导入失败，${cleanupFailures.length} 个已复制文件未能自动清理`)
    throw error
  }
  return {
    imported: copies.length,
    multiFolderAssets,
    entries: eagle.entries.map((entry, index) => ({
      ...entry,
      relPath: relative(libraryRoot, copies[index].target).replace(/\\/g, '/')
    }))
  }
}

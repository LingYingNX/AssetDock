import { lstat, mkdir, readdir, rename } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { isIgnoredDir } from './ignore'

const DEFAULT_NAME = '未命名'
const INVALID_NAME = /[<>:"/\\|?*\u0000-\u001F]/
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

function fail(message: string): never {
  throw new Error(message)
}

function libraryPath(root: string, relPath: string): { abs: string; rel: string } {
  const rel = relPath.replace(/\\/g, '/')
  if (!rel || rel.split('/').some((part) => !part || part === '.' || part === '..')) fail('文件夹路径无效')
  const base = resolve(root)
  const abs = resolve(base, rel)
  const fromBase = relative(base, abs)
  if (!fromBase || fromBase.startsWith('..') || isAbsolute(fromBase)) fail('文件夹必须位于素材库内')
  return { abs, rel: fromBase.replace(/\\/g, '/') }
}

function targetFolderPath(root: string, relPath: string): { abs: string; rel: string } {
  return relPath === '' ? { abs: resolve(root), rel: '' } : libraryPath(root, relPath)
}

function folderName(name: string): string {
  const value = name.trim()
  if (!value || value === '.' || value === '..' || INVALID_NAME.test(value) || RESERVED_NAME.test(value) || /[. ]$/.test(value)) {
    fail('文件夹名称无效')
  }
  return value
}

export async function listLibraryFolders(root: string): Promise<string[]> {
  const folders: string[] = []

  const walk = async (relDir: string): Promise<void> => {
    const entries = await readdir(join(root, relDir), { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      if (isIgnoredDir(rel)) continue
      folders.push(rel)
      await walk(rel)
    }
  }

  await walk('')
  return folders.sort((a, b) => a.localeCompare(b))
}

function parentPath(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

/** 目录顺序只影响同级节点，并始终保证父目录在子目录前。 */
export function orderLibraryFolders(paths: readonly string[], positions: ReadonlyMap<string, number>): string[] {
  const children = new Map<string, string[]>()
  for (const path of paths) {
    const parent = parentPath(path)
    const siblings = children.get(parent) ?? []
    siblings.push(path)
    children.set(parent, siblings)
  }
  const result: string[] = []
  const visit = (parent: string): void => {
    const siblings = children.get(parent) ?? []
    siblings.sort((a, b) => (positions.get(a) ?? Number.MAX_SAFE_INTEGER) - (positions.get(b) ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b))
    for (const path of siblings) {
      result.push(path)
      visit(path)
    }
  }
  visit('')
  return result
}

export async function createLibraryFolder(root: string): Promise<string> {
  for (let n = 1; ; n++) {
    const name = n === 1 ? DEFAULT_NAME : `${DEFAULT_NAME} (${n})`
    try {
      await mkdir(join(root, name))
      return name
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
  }
}

export async function renameLibraryFolder(root: string, relPath: string, newName: string): Promise<string> {
  const source = libraryPath(root, relPath)
  const name = folderName(newName)
  const destination = resolve(dirname(source.abs), name)
  const target = libraryPath(root, relative(resolve(root), destination))
  if (target.abs === source.abs) return source.rel
  if (!(await lstat(source.abs)).isDirectory()) fail('文件夹不存在')
  try {
    await lstat(target.abs)
    fail('文件夹名称已存在')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await rename(source.abs, target.abs)
  return target.rel
}

export async function moveLibraryFolder(root: string, relPath: string, targetParent: string): Promise<string> {
  const source = libraryPath(root, relPath)
  const parent = targetFolderPath(root, targetParent)
  if (parent.rel === source.rel || parent.rel.startsWith(`${source.rel}/`)) fail('不能移动到自身或子文件夹')
  if (!(await lstat(source.abs)).isDirectory()) fail('文件夹不存在')
  if (!(await lstat(parent.abs)).isDirectory()) fail('目标文件夹不存在')
  if (dirname(source.abs).toLowerCase() === parent.abs.toLowerCase()) return source.rel
  const target = libraryPath(root, relative(resolve(root), join(parent.abs, basename(source.abs))))
  try {
    await lstat(target.abs)
    fail('目标位置已有同名文件夹')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await rename(source.abs, target.abs)
  return target.rel
}

async function uniqueAssetTarget(directory: string, fileName: string): Promise<string> {
  const extname = fileName.slice(fileName.lastIndexOf('.'))
  const stem = extname === fileName ? fileName : fileName.slice(0, -extname.length)
  for (let n = 1; ; n++) {
    const candidate = join(directory, n === 1 ? fileName : `${stem} (${n})${extname}`)
    try {
      await lstat(candidate)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return candidate
      throw error
    }
  }
}

export async function moveLibraryAsset(root: string, relPath: string, targetFolder: string): Promise<string> {
  const source = libraryPath(root, relPath)
  const targetDir = targetFolderPath(root, targetFolder)
  if (dirname(source.abs).toLowerCase() === targetDir.abs.toLowerCase()) return source.rel
  if (!(await lstat(source.abs)).isFile()) fail('素材不存在')
  if (!(await lstat(targetDir.abs)).isDirectory()) fail('目标文件夹不存在')
  const fileName = source.rel.split('/').pop() ?? ''
  const target = await uniqueAssetTarget(targetDir.abs, fileName)
  await rename(source.abs, target)
  return libraryPath(root, relative(resolve(root), target)).rel
}

export async function assertLibraryFolder(root: string, targetFolder: string): Promise<void> {
  const target = targetFolderPath(root, targetFolder)
  if (!(await lstat(target.abs)).isDirectory()) fail('目标文件夹不存在')
}

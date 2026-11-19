import { copyFile, lstat, mkdir, readdir, rename, rmdir } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { isIgnoredDir } from './ignore'
import { realPathWithinRoot } from './libResolve'

const DEFAULT_NAME = '未命名'
const FOLDER_WALK_CONCURRENCY = 8
const INVALID_NAME = /[<>:"/\\|?*\u0000-\u001F]/
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

function fail(message: string): never {
  throw new Error(message)
}

/**
 * 解析库内相对路径为绝对路径(S3-1:resolve+relative 字符串校验)。
 * folder 操作低频,入口做一次 realpath 解析,把 symlink/Junction 语义与 media:// 对齐;
 * 目标不存在时(创建场景)回退 lexical 校验。
 */
function libraryPath(root: string, relPath: string): { abs: string; rel: string } {
  const rel = relPath.replace(/\\/g, '/')
  if (!rel || rel.split('/').some((part) => !part || part === '.' || part === '..')) fail('文件夹路径无效')
  const base = resolve(root)
  const abs = resolve(base, rel)
  const fromBase = relative(base, abs)
  if (!fromBase || fromBase.startsWith('..') || isAbsolute(fromBase)) fail('文件夹必须位于素材库内')
  return { abs, rel: fromBase.replace(/\\/g, '/') }
}

/** S3-1:对已存在的路径做 realpath 越界复检;不存在(即将创建)时放行 lexical 结果 */
async function assertRealWithinRoot(root: string, abs: string): Promise<void> {
  const real = await realPathWithinRoot(root, abs).catch(() => null)
  if (real === null) {
    // 目标自身不存在才允许(等待后续 mkdir/rename);存在但越界 = symlink 逃逸
    const st = await lstat(abs).catch(() => null)
    if (st) fail('路径解析后不在素材库内')
  }
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
  // 串行递归在机械盘上 200+ 目录要 2s+;并发读目录能让侧边栏目录树首帧就出来。
  const queue: string[] = ['']
  while (queue.length > 0) {
    const batch = queue.splice(0, FOLDER_WALK_CONCURRENCY)
    const children = await Promise.all(batch.map(async (relDir) => {
      // 只容忍「刚好被删掉」:权限不足、盘掉线必须报错,否则整棵子树静默消失
      const entries = await readdir(join(root, relDir), { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return []
        throw error
      })
      const found: string[] = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const rel = relDir ? `${relDir}/${entry.name}` : entry.name
        if (isIgnoredDir(rel)) continue
        found.push(rel)
      }
      return found
    }))
    for (const found of children) {
      folders.push(...found)
      queue.push(...found)
    }
  }
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
    const originalOrder = new Map(siblings.map((path, index) => [path, index]))
    siblings.sort((a, b) => {
      const pa = positions.get(a)
      const pb = positions.get(b)
      if (pa != null || pb != null) return (pa ?? Number.MAX_SAFE_INTEGER) - (pb ?? Number.MAX_SAFE_INTEGER)
      return (originalOrder.get(a) ?? 0) - (originalOrder.get(b) ?? 0)
    })
    for (const path of siblings) {
      result.push(path)
      visit(path)
    }
  }
  visit('')
  return result
}

/** 把刚创建的真实目录放到父级子树末尾；物理扫描已包含它时不得重复插入。 */
export function insertCreatedFolderPath(
  paths: readonly string[],
  createdPath: string,
  parentPath: string
): string[] {
  const ordered = [...new Set(paths)].filter((path) => path !== createdPath)
  let insertAt = 0
  if (parentPath) {
    const prefix = `${parentPath}/`
    insertAt = ordered.reduce(
      (last, item, index) => item === parentPath || item.startsWith(prefix) ? index + 1 : last,
      0
    )
  }
  ordered.splice(insertAt, 0, createdPath)
  return ordered
}

export async function createLibraryFolder(root: string, parentPath = ''): Promise<string> {
  const parent = targetFolderPath(root, parentPath)
  await assertRealWithinRoot(root, parent.abs)
  if (parentPath !== '') {
    const stat = await lstat(parent.abs).catch(() => null)
    if (!stat?.isDirectory()) fail('父文件夹不存在')
  }
  for (let n = 1; ; n++) {
    const name = n === 1 ? DEFAULT_NAME : `${DEFAULT_NAME} (${n})`
    try {
      await mkdir(join(parent.abs, name))
      return parent.rel ? `${parent.rel}/${name}` : name
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
  }
}

/** 解析真实目录路径,供打开资源管理器与移入回收站前统一校验。 */
export async function resolveLibraryFolder(root: string, relPath: string): Promise<string> {
  const target = libraryPath(root, relPath)
  const real = await realPathWithinRoot(root, target.abs)
  if (!real) fail('文件夹路径越界')
  if (!(await lstat(real)).isDirectory()) fail('文件夹不存在')
  return real
}

/**
 * 摘掉一个空文件夹,非空返回 false。
 *
 * 跨库移动收尾时用:源文件删掉后目录才空得下来,但源文件可能删不掉(占用/权限),
 * 那串残留文件必须留在原地。所以这里只用非递归 rmdir —— 目录里还有任何东西就失败,
 * 天然不会把「没搬干净」的目录连同漏掉的素材一起抹掉。
 */
export async function removeFolderIfEmpty(root: string, relPath: string): Promise<boolean> {
  const target = libraryPath(root, relPath)
  try {
    await rmdir(target.abs)
    return true
  } catch {
    return false
  }
}

/**
 * 从 relDir 起逐级向上摘空目录(含自身),库根不动。
 *
 * 移动/剪切把文件夹里最后一批素材搬走之后,磁盘上会剩一个 0 件的空壳,
 * 侧栏上挂着一个点不开的空文件夹;搬完就顺手摘掉。
 */
export async function removeEmptyFolderChain(root: string, relDir: string): Promise<number> {
  const segments = relDir.split('/').filter(Boolean)
  let removed = 0
  for (let i = segments.length; i > 0; i--) {
    if (await removeFolderIfEmpty(root, segments.slice(0, i).join('/'))) removed++
  }
  return removed
}

/** 确保库内某个相对路径的目录存在(跨库搬整棵子树时目标库可能还没有这层目录)。 */
export async function ensureLibraryFolder(root: string, relPath: string): Promise<void> {
  const target = libraryPath(root, relPath)
  await assertRealWithinRoot(root, target.abs)
  await mkdir(target.abs, { recursive: true })
}

export async function renameLibraryFolder(root: string, relPath: string, newName: string): Promise<string> {
  const source = libraryPath(root, relPath)
  await assertRealWithinRoot(root, source.abs)
  const name = folderName(newName)
  const destination = resolve(dirname(source.abs), name)
  const target = libraryPath(root, relative(resolve(root), destination))
  if (target.abs === source.abs) return source.rel
  if (!(await lstat(source.abs)).isDirectory()) fail('文件夹不存在')
  /* 只改大小写:Windows 是大小写不敏感文件系统,存在性检查会命中源目录本身,直接 rename */
  if (target.abs.toLowerCase() === source.abs.toLowerCase()) {
    await rename(source.abs, target.abs)
    return target.rel
  }
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
  await assertRealWithinRoot(root, source.abs)
  const parent = targetFolderPath(root, targetParent)
  await assertRealWithinRoot(root, parent.abs)
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
  await assertRealWithinRoot(root, source.abs)
  const targetDir = targetFolderPath(root, targetFolder)
  await assertRealWithinRoot(root, targetDir.abs)
  if (dirname(source.abs).toLowerCase() === targetDir.abs.toLowerCase()) return source.rel
  if (!(await lstat(source.abs)).isFile()) fail('素材不存在')
  if (!(await lstat(targetDir.abs)).isDirectory()) fail('目标文件夹不存在')
  const fileName = source.rel.split('/').pop() ?? ''
  const target = await uniqueAssetTarget(targetDir.abs, fileName)
  await rename(source.abs, target)
  return libraryPath(root, relative(resolve(root), target)).rel
}

/**
 * 重命名库内素材文件:只换文件名,留在原目录。
 *
 * 扩展名沿用原文件的——用户输入的是「名字」,不该因为漏写后缀就把 .png 变成无后缀文件。
 * 磁盘是权威来源:同一个文件夹里已有同名文件时直接报错,不静默改名。
 */
export async function renameLibraryAsset(root: string, relPath: string, newName: string): Promise<string> {
  const source = libraryPath(root, relPath)
  await assertRealWithinRoot(root, source.abs)
  if (!(await lstat(source.abs)).isFile()) fail('素材不存在')

  const base = folderName(newName)
  const dot = source.rel.lastIndexOf('.')
  const ext = dot > source.rel.lastIndexOf('/') ? source.rel.slice(dot) : ''
  // 用户自己带上原扩展名时不重复叠加
  const fileName = base.toLowerCase().endsWith(ext.toLowerCase()) ? base : `${base}${ext}`

  const destination = resolve(dirname(source.abs), fileName)
  const target = libraryPath(root, relative(resolve(root), destination))
  if (target.abs === source.abs) return source.rel
  /* 只改大小写时存在性检查会命中源文件本身,必须直接 rename(NTFS 允许仅改大小写) */
  if (target.abs.toLowerCase() === source.abs.toLowerCase()) {
    await rename(source.abs, target.abs)
    return target.rel
  }
  try {
    await lstat(target.abs)
    fail('同目录下已有同名文件')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await rename(source.abs, target.abs)
  return target.rel
}

export async function assertLibraryFolder(root: string, targetFolder: string): Promise<void> {
  const target = targetFolderPath(root, targetFolder)
  if (!(await lstat(target.abs)).isDirectory()) fail('目标文件夹不存在')
}

/**
 * 把库内素材复制到库外目标目录(导出)。目标同名文件自动避让为 `名称 (2).ext`;
 * 只读源文件、不移动、不删源;返回实际写入的路径。
 */
export async function exportLibraryAsset(root: string, relPath: string, targetDir: string): Promise<string> {
  const source = libraryPath(root, relPath)
  if (!(await lstat(source.abs)).isFile()) fail('素材不存在')
  const destDir = resolve(targetDir)
  if (!(await lstat(destDir)).isDirectory()) fail('导出目录不存在')
  const fileName = source.rel.split('/').pop() ?? ''
  const target = await uniqueAssetTarget(destDir, fileName)
  await copyFile(source.abs, target)
  return target
}

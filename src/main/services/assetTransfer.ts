import { constants } from 'node:fs'
import { copyFile, readdir, unlink } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import type { Database } from 'better-sqlite3'
import { applyMovedAssets, assetsByIds, upsertScanned, type AssetRow } from './store'
import { assertLibraryFolder, ensureLibraryFolder, listLibraryFolders, moveLibraryAsset, removeEmptyFolderChain, removeFolderIfEmpty } from './folders'
import { uniqueTarget } from './fileImport'
import { isIgnoredDir } from './ignore'
import { realPathWithinRoot } from './libResolve'
import { scanPaths } from './scan'
import { adoptThumb, removeThumbsIfUnused, retargetThumb } from './thumbs'
import { adoptDocumentPreview, removeDocumentPreviewIfUnused } from './documentPreview'
import { siblingShellRelPath } from './textAssets'

export interface TransferSide {
  libraryId: number
  root: string
  db: Database
}

export interface TransferResult {
  transferred: number
  skipped: number
  /** 剪切时源文件删除失败、源记录被保留的数量(目标已有副本) */
  keptSource: number
  targetIds: number[]
  fingerprints: string[]
}

/** 传输进度回调:done 是「已处理件数」(含跳过与失败),total 是本批总数 */
export type TransferProgress = (done: number, total: number) => void

/** 目标库插入后把源记录的用户数据(评分/标签/备注/主色等)带过去 */
function copyMetadata(db: Database, libraryId: number, assetId: number, row: AssetRow): void {
  db.prepare(
    `UPDATE assets SET rating = ?, favorite = ?, review_flag = ?, note = ?, source_url = ?, palette = ?, material_info = ?,
       width = COALESCE(?, width), height = COALESCE(?, height), duration = COALESCE(?, duration),
       codec = COALESCE(?, codec), fps = COALESCE(?, fps), face_count = COALESCE(?, face_count),
       vertices = COALESCE(?, vertices), imported_at = ?
     WHERE id = ? AND library_id = ?`
  ).run(
    row.rating,
    row.favorite,
    row.review_flag,
    row.note,
    row.source_url,
    row.palette,
    row.material_info,
    row.width,
    row.height,
    row.duration,
    row.codec,
    row.fps,
    row.face_count,
    row.vertices,
    row.imported_at,
    assetId,
    libraryId
  )
  const addTag = db.prepare('INSERT OR IGNORE INTO asset_tags(asset_id, tag_id) SELECT ?, id FROM tags WHERE name = ?')
  const createTag = db.prepare('INSERT OR IGNORE INTO tags(name, color) VALUES (?, ?)')
  for (const tag of row.tags) {
    createTag.run(tag.name, tag.color)
    addTag.run(assetId, tag.name)
  }
}

/** CSS 素材的外观由同目录同名 .html 决定,复制时必须把它一起带过去,否则目标库只剩裸样式 */
async function copyShellAlongside(sourceRoot: string, targetRoot: string, sourceRel: string, targetRel: string): Promise<void> {
  if (extname(sourceRel).toLowerCase() !== '.css') return
  const sourceAbs = await realPathWithinRoot(sourceRoot, join(sourceRoot, siblingShellRelPath(sourceRel)))
  if (!sourceAbs) return
  const targetAbs = join(targetRoot, siblingShellRelPath(targetRel))
  await copyFile(sourceAbs, targetAbs, constants.COPYFILE_EXCL).catch(() => undefined)
}

/**
 * 跨库复制/剪切素材。
 *
 * - 同库剪切:走 rename,保留 id、标签、评分;
 * - 其它组合:复制文件 → 目标库扫描入库 → 迁移用户数据;剪切再删源文件与源记录。
 *
 * 目标重名自动避让为 `名称 (2).ext`。源文件缺失/已删除的条目计入 skipped。
 * 剪切时源文件删不掉就保留源记录(宁可多一份,也不丢用户数据),计入 keptSource。
 */
export async function transferAssets(
  source: TransferSide,
  target: TransferSide,
  ids: number[],
  targetFolder: string,
  move: boolean,
  onProgress?: TransferProgress
): Promise<TransferResult> {
  /* 库根互相嵌套时,复制进对方目录会被对方监听当成新素材再扫一遍,源库也会多出一份 */
  if (source.libraryId !== target.libraryId) {
    const nested = (outer: string, inner: string): boolean => {
      const rel = relative(resolve(outer), resolve(inner))
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
    }
    if (nested(source.root, target.root) || nested(target.root, source.root)) {
      throw new Error('两个资源库目录互相嵌套，无法跨库传输素材')
    }
  }
  const rows = assetsByIds(source.db, source.libraryId, ids).filter((row) => !row.deleted_at && !row.missing)
  const skipped = Math.max(0, new Set(ids).size - rows.length)
  /* 分母 = 请求去重后的条目数;跳过与失败的也算已处理,进度条才追得到 100% */
  const total = skipped + rows.length
  let processed = skipped
  const tick = (): void => onProgress?.(++processed, total)
  onProgress?.(0, total)
  if (rows.length === 0) return { transferred: 0, skipped, keptSource: 0, targetIds: [], fingerprints: [] }
  await assertLibraryFolder(target.root, targetFolder)

  if (move && source.libraryId === target.libraryId) {
    const newPaths = new Map<number, string>()
    const items = rows.map((row) => ({ id: row.id, rel_path: row.rel_path, fingerprint: row.fingerprint }))
    for (const item of items) {
      newPaths.set(item.id, await moveLibraryAsset(target.root, item.rel_path, targetFolder))
      tick()
    }
    applyMovedAssets(target.db, target.libraryId, items, newPaths)
    for (const item of items) {
      await retargetThumb(target.root, item.fingerprint, newPaths.get(item.id) ?? item.rel_path).catch(() => undefined)
    }
    return {
      transferred: items.length,
      skipped,
      keptSource: 0,
      targetIds: items.map((item) => item.id),
      fingerprints: items.map((item) => item.fingerprint)
    }
  }

  /* 目标库里已有记录(哪怕文件暂时缺失)的路径也算占用,避免覆盖旧行的标签/评分 */
  const claimed = new Set<string>(
    (target.db.prepare('SELECT rel_path FROM assets WHERE library_id = ?').all(target.libraryId) as { rel_path: string }[])
      .map((row) => resolve(target.root, row.rel_path).toLowerCase())
  )
  const copies: { row: AssetRow; sourceAbs: string; abs: string; rel: string }[] = []
  let failed = 0
  for (const row of rows) {
    const sourceAbs = await realPathWithinRoot(source.root, join(source.root, row.rel_path))
    if (!sourceAbs) {
      failed++
      tick()
      continue
    }
    const destination = await uniqueTarget(target.root, targetFolder, basename(sourceAbs), claimed)
    try {
      await copyFile(sourceAbs, destination.abs, constants.COPYFILE_EXCL)
      copies.push({ row, sourceAbs, ...destination })
    } catch {
      failed++
    }
    tick()
  }

  const entries = copies.length > 0 ? await scanPaths(target.root, copies.map((item) => item.rel)) : []
  const entryByRel = new Map(entries.map((entry) => [entry.relPath, entry]))
  const targetIds: number[] = []
  const fingerprints: string[] = []
  const committed: typeof copies = []
  for (const copy of copies) {
    const entry = entryByRel.get(copy.rel)
    if (!entry) {
      await unlink(copy.abs).catch(() => undefined)
      failed++
      continue
    }
    const [result] = upsertScanned(target.db, target.libraryId, [entry])
    copyMetadata(target.db, target.libraryId, result.assetId, copy.row)
    await copyShellAlongside(source.root, target.root, copy.row.rel_path, copy.rel)
    /* 缩略图与文档解析缓存都按库分开存,顺手把源库那份搬到新指纹名下,
       否则目标库要重渲染/重解析一遍,搬完还得等几秒才出图 */
    await adoptThumb(source.root, target.root, copy.row.fingerprint, entry.fingerprint, copy.rel).catch(() => false)
    await adoptDocumentPreview(source.root, target.root, copy.row.fingerprint, entry.fingerprint).catch(() => false)
    targetIds.push(result.assetId)
    fingerprints.push(entry.fingerprint)
    committed.push(copy)
  }

  let keptSource = 0
  if (move) {
    const removed: { fingerprint: string }[] = []
    for (const copy of committed) {
      try {
        await unlink(copy.sourceAbs)
      } catch {
        keptSource++
        continue
      }
      source.db.prepare('DELETE FROM assets WHERE id = ? AND library_id = ?').run(copy.row.id, source.libraryId)
      removed.push({ fingerprint: copy.row.fingerprint })
      if (extname(copy.row.rel_path).toLowerCase() === '.css') {
        await unlink(join(source.root, siblingShellRelPath(copy.row.rel_path))).catch(() => undefined)
      }
    }
    const fingerprints = removed.map((row) => row.fingerprint)
    await removeThumbsIfUnused(source.root, source.db, source.libraryId, fingerprints).catch(() => 0)
    for (const fingerprint of fingerprints) {
      await removeDocumentPreviewIfUnused(source.root, source.db, source.libraryId, fingerprint).catch(() => undefined)
    }
  }

  return { transferred: committed.length, skipped: skipped + failed, keptSource, targetIds, fingerprints }
}

export interface FolderTransferResult extends TransferResult {
  /** 搬空后被摘掉的源目录数量;源文件没删干净时对应目录会保留 */
  removedFolders: number
}

/** 目录下所有文件(相对该目录、正斜杠);库内部目录(.mediahub 等)不算 */
async function listFilesUnder(root: string, relDir: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(join(root, relDir, prefix), { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (!isIgnoredDir(rel)) files.push(...await listFilesUnder(root, relDir, rel))
      continue
    }
    files.push(rel)
  }
  return files
}

/**
 * 文件夹跨库移动:整棵子树搬到目标库,内部结构原样保留(不拍平)。
 *
 * 落点只取文件夹自己的名字(不重建它在源库里的父级路径):`前端UI组件/媒体与画廊`
 * 在目标库里就是 `媒体与画廊`,选了 `destFolder` 就是 `destFolder/媒体与画廊`。
 * `transferAssets` 的目标粒度是「一个文件夹」,所以这里按文件夹分批调用它。
 * 目标库已有同名文件夹时自然合并,同名文件由 `uniqueTarget` 避让成 `名称 (2).ext`。
 *
 * 收尾分三步:先补齐没入库的伴生文件(索引 jsonl、字体、shell…),再摘「真的空了」的源目录。
 * 只搬入库素材的话,源目录会因为剩下这些文件而留成 0 件的空壳,侧栏上白挂一个空文件夹。
 * 目标已存在同名文件时保留源文件 —— 宁可不删,也不覆盖目标里已有的东西。
 */
export async function transferFolderTree(
  source: TransferSide,
  target: TransferSide,
  relPath: string,
  destFolder: string,
  onProgress?: TransferProgress
): Promise<FolderTransferResult> {
  const physical = await listLibraryFolders(source.root)
  if (!physical.includes(relPath)) throw new Error('只能移动资源库中的本地文件夹')
  if (destFolder) await assertLibraryFolder(target.root, destFolder)
  const leaf = relPath.split('/').pop() ?? relPath
  const base = destFolder ? `${destFolder}/${leaf}` : leaf
  const place = (folder: string): string => `${base}${folder.slice(relPath.length)}`
  const subtree = physical
    .filter((item) => item === relPath || item.startsWith(`${relPath}/`))
    .sort((a, b) => a.split('/').length - b.split('/').length)
  /* 分母 = 真会搬走的素材;缺失/回收站里的行侧栏本来就不计数,混进来只会让进度条比选中数大 */
  const rows = source.db
    .prepare(
      `SELECT id, rel_path FROM assets WHERE library_id = ? AND instr(rel_path, ?) = 1
       AND missing = 0 AND deleted_at IS NULL`
    )
    .all(source.libraryId, `${relPath}/`) as { id: number; rel_path: string }[]
  const idsByFolder = new Map<string, number[]>()
  for (const row of rows) {
    const cut = row.rel_path.lastIndexOf('/')
    const folder = cut < 0 ? '' : row.rel_path.slice(0, cut)
    const list = idsByFolder.get(folder)
    if (list) list.push(row.id)
    else idsByFolder.set(folder, [row.id])
  }

  let transferred = 0
  let skipped = 0
  let keptSource = 0
  const targetIds: number[] = []
  const fingerprints: string[] = []
  /* 分母先按清单算死:预热/传输都要按同一把尺子报,进度条才不会来回跳 */
  let done = 0
  const total = [...idsByFolder.values()].reduce((sum, list) => sum + list.length, 0)
  onProgress?.(0, total)
  for (const folder of subtree) {
    const ids = idsByFolder.get(folder)
    if (!ids || ids.length === 0) continue
    await ensureLibraryFolder(target.root, place(folder))
    const result = await transferAssets(source, target, ids, place(folder), true, (n) => onProgress?.(done + n, total))
    done += ids.length
    transferred += result.transferred
    skipped += result.skipped
    keptSource += result.keptSource
    targetIds.push(...result.targetIds)
    fingerprints.push(...result.fingerprints)
  }

  for (const file of await listFilesUnder(source.root, relPath)) {
    const targetRel = `${base}/${file}`
    const sourceAbs = await realPathWithinRoot(source.root, join(source.root, relPath, file))
    if (!sourceAbs) continue
    await ensureLibraryFolder(target.root, dirname(targetRel).replace(/\\/g, '/')).catch(() => undefined)
    const copied = await copyFile(sourceAbs, join(target.root, targetRel), constants.COPYFILE_EXCL)
      .then(() => true)
      .catch(() => false)
    if (copied) await unlink(sourceAbs).catch(() => undefined)
  }

  let removedFolders = 0
  for (const folder of [...subtree].sort((a, b) => b.split('/').length - a.split('/').length)) {
    if (await removeFolderIfEmpty(source.root, folder)) removedFolders++
  }
  /* 文件夹自己搬走了,源库里的父级可能就空了:一路往上摘,库根不动 */
  removedFolders += await removeEmptyFolderChain(source.root, relPath.split('/').slice(0, -1).join('/'))
  return { transferred, skipped, keptSource, targetIds, fingerprints, removedFolders }
}

import { ipcMain, dialog, clipboard } from 'electron'
import { access } from 'node:fs/promises'
import { getDb } from '../services/db'
import {
  addTag, removeTag, setAssetFolder, renameAssetFolder, renameFolderOrders,
  listFolderOrders, replaceFolderOrders, listAssets, updateAsset, getLibrary, sanitizeAssetPatch,
  upsertScanned, type AssetPatch
} from '../services/store'
import { ensureLibraryStorage, hasLibDb } from '../services/libraryDb'
import {
  assertLibraryFolder, createLibraryFolder, exportLibraryAsset, listLibraryFolders,
  moveLibraryAsset, moveLibraryFolder, orderLibraryFolders, renameLibraryAsset, renameLibraryFolder
} from '../services/folders'
import { removeThumbsIfUnused, retargetThumb } from '../services/thumbs'
import { readShellAsset, readTextAsset, renameShellAlongside, writeShellAsset, writeTextAsset } from '../services/textAssets'
import { copyFilesToClipboard } from '../services/clipboardFiles'
import { moveEagleLibraryAssets, scanEagleLibrary, type EagleScan } from '../services/eagle'
import { assetsByIds } from '../services/store'
import { send } from '../events'
import { absPathFor, libRootOf, releaseScope, scopeFor, win, type Scope } from './context'
import { queueThumbWarmup } from './thumbs'
import { attachRootWatcher, watchManager } from './watch'

function folderParent(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

function moveFolderBlock(paths: readonly string[], source: string, target: string, placement: 'before' | 'after' | 'inside'): string[] {
  const block = paths.filter((path) => path === source || path.startsWith(`${source}/`))
  const rest = paths.filter((path) => !block.includes(path))
  const targetIndex = rest.indexOf(target)
  if (targetIndex < 0) return paths.slice()
  if (placement === 'before') return [...rest.slice(0, targetIndex), ...block, ...rest.slice(targetIndex)]
  let after = targetIndex + 1
  while (after < rest.length && rest[after].startsWith(`${target}/`)) after++
  return [...rest.slice(0, after), ...block, ...rest.slice(after)]
}

/** 资产/文件夹/Eagle 域 handler(S1-1 拆分) */
export function registerAssetsIpc(): void {
  ipcMain.handle('folders:list', async (_e, libraryId: number) => {
    const s = scopeFor(libraryId)
    if (!s) return { error: '素材库不存在' }
    try {
      const physical = await listLibraryFolders(s.libPath)
      return { paths: orderLibraryFolders(physical, listFolderOrders(s.db, libraryId)) }
    } catch {
      return { error: '无法读取素材库文件夹' }
    } finally {
      releaseScope(s)
    }
  })

  ipcMain.handle('folders:create', async (_e, libraryId: number) => {
    const root = libRootOf(libraryId)
    const s = scopeFor(libraryId)
    if (!root || !s) return { error: '素材库不存在' }
    try {
      const path = await createLibraryFolder(root)
      const ordered = orderLibraryFolders(await listLibraryFolders(root), listFolderOrders(s.db, libraryId))
      replaceFolderOrders(s.db, libraryId, [path, ...ordered.filter((item) => item !== path)])
      send('assets:changed', { libraryId })
      return { path }
    } catch (error) {
      return { error: error instanceof Error ? error.message : '新建文件夹失败' }
    } finally {
      releaseScope(s)
    }
  })

  ipcMain.handle('folders:rename', async (_e, libraryId: number, relPath: string, name: string) => {
    const root = libRootOf(libraryId)
    const s = scopeFor(libraryId)
    if (!root || !s) return { error: '素材库不存在' }
    let path: string | null = null
    try {
      path = await renameLibraryFolder(root, relPath, name)
      renameAssetFolder(s.db, libraryId, relPath, path)
      renameFolderOrders(s.db, libraryId, relPath, path)
      send('assets:changed', { libraryId })
      return { path }
    } catch (error) {
      if (path) {
        const oldName = relPath.split('/').pop()
        try {
          if (oldName) await renameLibraryFolder(root, path, oldName)
        } catch {
          return { error: '重命名后的数据库同步失败，且无法自动恢复目录名称' }
        }
      }
      return { error: error instanceof Error ? error.message : '重命名文件夹失败' }
    } finally {
      releaseScope(s)
    }
  })

  ipcMain.handle('folders:move', async (
    _e,
    libraryId: number,
    sourcePath: string,
    targetPath: string,
    placement: 'before' | 'after' | 'inside'
  ) => {
    const root = libRootOf(libraryId)
    const s = scopeFor(libraryId)
    if (!root || !s) return { error: '素材库不存在' }
    if (!['before', 'after', 'inside'].includes(placement) || typeof sourcePath !== 'string') return { error: '文件夹移动参数无效' }
    try {
      const physical = await listLibraryFolders(root)
      if (!physical.includes(sourcePath)) return { error: '只能调整资源库中的本地文件夹' }
      if (!physical.includes(targetPath)) return { error: '目标文件夹不存在' }
      const destinationParent = placement === 'inside' ? targetPath : folderParent(targetPath)
      if (destinationParent === sourcePath || destinationParent.startsWith(`${sourcePath}/`)) return { error: '不能移动到自身或子文件夹' }

      let path = sourcePath
      if (folderParent(sourcePath) !== destinationParent) {
        path = await moveLibraryFolder(root, sourcePath, destinationParent)
        renameAssetFolder(s.db, libraryId, sourcePath, path)
        renameFolderOrders(s.db, libraryId, sourcePath, path)
      }
      const ordered = moveFolderBlock(
        orderLibraryFolders(await listLibraryFolders(root), listFolderOrders(s.db, libraryId)),
        path,
        targetPath,
        placement
      )
      replaceFolderOrders(s.db, libraryId, ordered)
      // 缩略图按指纹命名,文件夹移动后文件继续有效,只需同步清单里的路径记录
      if (path !== sourcePath) {
        const moved = s.db.prepare('SELECT fingerprint, rel_path FROM assets WHERE library_id = ? AND rel_path LIKE ?').all(libraryId, sourcePath + '/%') as { fingerprint: string; rel_path: string }[]
        for (const row of moved) await retargetThumb(s.libPath, row.fingerprint, row.rel_path)
      }
      send('assets:changed', { libraryId })
      return { path }
    } catch (error) {
      return { error: error instanceof Error ? error.message : '移动文件夹失败' }
    } finally {
      releaseScope(s)
    }
  })

  ipcMain.handle('assets:list', (_e, libraryId: number) => {
    const s = scopeFor(libraryId)
    if (!s) return { error: 'library not found' }
    try {
      const lib = getLibrary(getDb(), libraryId)!
      const rows = listAssets(s.db, libraryId).map((r) => ({
        ...r,
        absPath: absPathFor(s, r.rel_path)
      }))
      return {
        library: { id: lib.id, name: lib.name, path: lib.path },
        assets: rows
      }
    } finally {
      releaseScope(s)
    }
  })

  ipcMain.handle('assets:update', async (_e, libraryId: number, id: number, patch: AssetPatch) => {
    const s = scopeFor(libraryId)
    if (!s) return { ok: false }
    // S1-4:handler 边界先清洗 patch——非法列值直接剔除,全空则拒绝
    const clean: AssetPatch = sanitizeAssetPatch(patch ?? {})
    if (Object.keys(clean).length === 0 || !Number.isInteger(id)) return { ok: false }
    try {
      const changesDeletedAt = 'deleted_at' in clean
      const trashing = changesDeletedAt && !!clean.deleted_at
      const restoring = changesDeletedAt && clean.deleted_at === null
      const row = changesDeletedAt
        ? (s.db.prepare('SELECT fingerprint FROM assets WHERE library_id = ? AND id = ?').get(libraryId, id) as
            | { fingerprint: string }
            | undefined)
        : undefined
      // 先落库再处理缓存,否则恢复时预热仍会读到旧的 deleted_at 而跳过该素材
      updateAsset(s.db, id, clean)
      if (row && trashing) await removeThumbsIfUnused(s.libPath, s.db, libraryId, [row.fingerprint])
      if (row && restoring) queueThumbWarmup(libraryId)
      // 单素材编辑(评分/收藏/备注/回收站)走增量:渲染层只合并这一行
      send('assets:changed', { libraryId, assetIds: [id] })
      return { ok: true }
    } finally {
      releaseScope(s)
    }
  })

  /* 增量取行(S1-7):assets:changed 携带 assetIds 时渲染层按 id 拉行合并,不全量重拉 */
  ipcMain.handle('assets:rows', (_e, libraryId: number, ids: number[]) => {
    const s = scopeFor(libraryId)
    if (!s) return { assets: [] }
    try {
      const rows = assetsByIds(s.db, libraryId, Array.isArray(ids) ? ids : []).map((r) => ({
        ...r,
        absPath: absPathFor(s, r.rel_path)
      }))
      return { assets: rows }
    } finally {
      releaseScope(s)
    }
  })

  /* CSS 等文本素材的读取:渲染层编辑器加载原始文本 */
  ipcMain.handle('assets:readText', async (_e, libraryId: number, id: number) => {
    const s = scopeFor(libraryId)
    if (!s) return { error: '素材库不存在' }
    try {
      const row = s.db
        .prepare('SELECT rel_path FROM assets WHERE library_id = ? AND id = ?')
        .get(libraryId, id) as { rel_path: string } | undefined
      if (!row) return { error: '素材不存在' }
      const result = await readTextAsset(s.libPath, row.rel_path)
      if (!result) return { error: '无法读取素材文件' }
      return { text: result.text, sizeBytes: result.sizeBytes }
    } finally {
      releaseScope(s)
    }
  })

  /* 保存文本素材:原子写回原文件并同步大小/指纹,随后重排该素材缩略图 */
  ipcMain.handle('assets:writeText', async (_e, libraryId: number, id: number, text: string) => {
    const s = scopeFor(libraryId)
    if (!s) return { error: '素材库不存在' }
    try {
      if (typeof text !== 'string') return { error: '写入内容无效' }
      const row = s.db
        .prepare('SELECT rel_path FROM assets WHERE library_id = ? AND id = ?')
        .get(libraryId, id) as { rel_path: string } | undefined
      if (!row) return { error: '素材不存在' }
      const written = await writeTextAsset(s.db, libraryId, s.libPath, row.rel_path, text)
      if (!written) return { error: '写入失败:文件不可写或路径越界' }
      queueThumbWarmup(libraryId)
      send('assets:changed', { libraryId, assetIds: [id] })
      return { ok: true, fingerprint: written.fingerprint, sizeBytes: written.sizeBytes }
    } finally {
      releaseScope(s)
    }
  })

  /* 读取 CSS 素材的配套 HTML 骨架:外观由它决定,不存在时返回 null 表示用推导骨架 */
  ipcMain.handle('assets:readShell', async (_e, libraryId: number, id: number) => {
    const s = scopeFor(libraryId)
    if (!s) return { error: '素材库不存在' }
    try {
      const row = s.db
        .prepare('SELECT rel_path FROM assets WHERE library_id = ? AND id = ?')
        .get(libraryId, id) as { rel_path: string } | undefined
      if (!row) return { text: null, exists: false }
      const result = await readShellAsset(s.libPath, row.rel_path)
      if (!result) return { text: null, exists: false }
      return { text: result.text, exists: true, sizeBytes: result.sizeBytes }
    } finally {
      releaseScope(s)
    }
  })

  /* 写入配套 HTML 骨架并重排封面:外观改了封面要跟着变 */
  ipcMain.handle('assets:writeShell', async (_e, libraryId: number, id: number, html: string) => {
    const s = scopeFor(libraryId)
    if (!s) return { error: '素材库不存在' }
    try {
      if (typeof html !== 'string') return { error: '写入内容无效' }
      const row = s.db
        .prepare('SELECT rel_path FROM assets WHERE library_id = ? AND id = ?')
        .get(libraryId, id) as { rel_path: string } | undefined
      if (!row) return { error: '素材不存在' }
      const ok = await writeShellAsset(s.libPath, row.rel_path, html)
      if (!ok) return { error: '写入失败:路径越界' }
      queueThumbWarmup(libraryId)
      send('assets:changed', { libraryId, assetIds: [id] })
      return { ok: true }
    } finally {
      releaseScope(s)
    }
  })

  /**
   * 重命名素材文件:改磁盘文件名并同步库记录。
   *
   * 磁盘是权威来源,所以先改名再更新 rel_path;缩略图按内容指纹命名,改名后仍有效,
   * 只需把清单里的可读路径一起改掉。CSS 素材的配套 HTML 骨架同名关联,一并跟着改,
   * 否则改名后外观会退回推导骨架。
   */
  ipcMain.handle('assets:rename', async (_e, libraryId: number, id: number, newName: string) => {
    const s = scopeFor(libraryId)
    if (!s) return { error: '素材库不存在' }
    try {
      if (typeof newName !== 'string' || !newName.trim()) return { error: '名称不能为空' }
      const row = s.db
        .prepare('SELECT rel_path, fingerprint, missing, format FROM assets WHERE id = ? AND library_id = ?')
        .get(id, libraryId) as { rel_path: string; fingerprint: string; missing: number; format: string } | undefined
      if (!row) return { error: '素材不存在' }
      if (row.missing) return { error: '缺失文件不能重命名' }
      const relPath = await renameLibraryAsset(s.libPath, row.rel_path, newName)
      s.db.prepare('UPDATE assets SET rel_path = ? WHERE id = ? AND library_id = ?').run(relPath, id, libraryId)
      if (row.fingerprint) await retargetThumb(s.libPath, row.fingerprint, relPath)
      if (row.format === 'CSS') await renameShellAlongside(s.libPath, row.rel_path, relPath)
      send('assets:changed', { libraryId, assetIds: [id] })
      return { ok: true, relPath }
    } catch (error) {
      return { error: error instanceof Error ? error.message : '重命名失败' }
    } finally {
      releaseScope(s)
    }
  })

  ipcMain.handle('assets:move', async (_e, libraryId: number, assetIds: number[], targetFolder: string) => {
    const s = scopeFor(libraryId)
    if (!s) return { error: '素材库不存在' }
    try {
      if (!Array.isArray(assetIds) || assetIds.length === 0) return { error: '没有选择素材' }
      if (!assetIds.every((id) => Number.isInteger(id))) return { error: '素材 ID 无效' }
      try {
        await assertLibraryFolder(s.libPath, targetFolder)
      } catch (error) {
        return { error: error instanceof Error ? error.message : '目标文件夹不存在' }
      }

      // S1-5:循环内逐条 SELECT 提到循环外,一次批量预查(N+1 → 1)
      const idList = [...new Set(assetIds)]
      const placeholders = idList.map(() => '?').join(', ')
      const rows = s.db
        .prepare(
          `SELECT id, rel_path, missing, fingerprint FROM assets
           WHERE library_id = ? AND id IN (${placeholders})`
        )
        .all(libraryId, ...idList) as { id: number; rel_path: string; missing: number; fingerprint: string }[]
      const byId = new Map(rows.map((r) => [r.id, r]))
      for (const assetId of idList) {
        const row = byId.get(assetId)
        if (!row) return { error: '素材不存在' }
        if (row.missing) return { error: '缺失文件不能移动' }
      }

      // 磁盘 move 逐个执行(可给出失败清单);行更新全部包进 better-sqlite3
      // 事务,磁盘已动而库更新失败时不留半截状态——同一素材失败即整体回滚计数
      let moved = 0
      const tx = s.db.transaction((items: { id: number; rel_path: string; fingerprint: string }[], newRelPaths: Map<number, string>) => {
        const upd = s.db.prepare('UPDATE assets SET rel_path = ?, folder_path = NULL WHERE id = ? AND library_id = ?')
        for (const item of items) {
          const relPath = newRelPaths.get(item.id) ?? item.rel_path
          upd.run(relPath, item.id, libraryId)
          setAssetFolder(s.db, item.id, null)
          moved++
        }
      })

      // 先完成全部磁盘 rename,收集新 rel_path;任一失败立即中止并返回已移动清单
      const newRelPaths = new Map<number, string>()
      const movedItems: { id: number; rel_path: string; fingerprint: string }[] = []
      for (const assetId of idList) {
        const item = byId.get(assetId)!
        try {
          const relPath = await moveLibraryAsset(s.libPath, item.rel_path, targetFolder)
          newRelPaths.set(assetId, relPath)
          movedItems.push(item)
        } catch (error) {
          // S1-5:磁盘部分成功 + 库零写入,直接如实上报失败清单;已 rename 的文件
          // 由库记录仍指向旧路径时的「missing 重扫」兜底(行为与旧版一致,不再有半截库状态)
          return { error: error instanceof Error ? error.message : '移动素材失败', moved: 0 }
        }
      }

      // 库更新一次性事务:全成或全不成
      tx(movedItems, newRelPaths)

      // 缩略图清单按新路径同步(fingerprint 不变,移动后缩略图继续有效)
      for (const item of movedItems) {
        await retargetThumb(s.libPath, item.fingerprint, newRelPaths.get(item.id) ?? item.rel_path).catch(() => {})
      }

      // S1-7:移动会改 rel_path/folder_path,目标集合按 id 增量合并即可
      send('assets:changed', { libraryId, assetIds: idList })
      return { moved }
    } finally {
      releaseScope(s)
    }
  })

  /**
   * 复制选中素材到系统剪贴板。
   *
   * 首选写入文件对象,这样在资源管理器里可以直接 Ctrl+V 粘贴出文件;
   * 写文件对象不可用(非 Windows / PowerShell 失败)时退回路径文本,至少不空手而归。
   * Electron 自带的 clipboard 写不出 CF_HDROP,实现细节见 services/clipboardFiles.ts。
   */
  ipcMain.handle('assets:copy', async (_e, libraryId: number, assetIds: number[]) => {
    const s = scopeFor(libraryId)
    if (!s) return { error: '素材库不存在' }
    if (!Array.isArray(assetIds) || assetIds.length === 0) return { error: '没有选择素材' }
    const rows = assetIds
      .map((id) => s.db.prepare('SELECT rel_path FROM assets WHERE id = ? AND library_id = ?').get(id, libraryId) as
        | { rel_path: string }
        | undefined)
      .filter((row): row is { rel_path: string } => row != null)
    if (rows.length === 0) return { error: '素材不存在' }
    const abs = rows.map((row) => absPathFor(s, row.rel_path))

    const fileDrop = await copyFilesToClipboard(abs).catch(() => null)
    if (fileDrop && fileDrop.copied > 0) {
      return { copied: fileDrop.copied, mode: 'files' as const, skipped: fileDrop.skipped, paths: abs }
    }

    clipboard.write({ text: abs.join('\r\n') })
    return { copied: abs.length, mode: 'paths' as const, skipped: fileDrop?.skipped ?? [], paths: abs }
  })

  /** 导出选中素材:选择目标目录后复制文件(不移动、不改库记录),同名自动避让 */
  ipcMain.handle('assets:export', async (_e, libraryId: number, assetIds: number[]) => {
    const s = scopeFor(libraryId)
    if (!s) return { error: '素材库不存在' }
    try {
      if (!Array.isArray(assetIds) || assetIds.length === 0) return { error: '没有选择素材' }
      const w = win()
      if (!w) return { error: 'no window' }
      const pick = await dialog.showOpenDialog(w, { properties: ['openDirectory'], title: '选择导出目录' })
      if (pick.canceled || !pick.filePaths[0]) return { canceled: true }
      const rows = assetIds
        .map((id) => s.db.prepare('SELECT rel_path, missing FROM assets WHERE id = ? AND library_id = ?').get(id, libraryId) as
          | { rel_path: string; missing: number }
          | undefined)
        .filter((row): row is { rel_path: string; missing: number } => row != null && row.missing === 0)
      if (rows.length === 0) return { error: '素材不存在或已缺失' }
      let exported = 0
      for (const row of rows) {
        try {
          await exportLibraryAsset(s.libPath, row.rel_path, pick.filePaths[0])
          exported++
        } catch (error) {
          return { error: error instanceof Error ? error.message : '导出失败', exported }
        }
      }
      return { exported }
    } finally {
      releaseScope(s)
    }
  })

  ipcMain.handle('assets:addTag', async (_e, libraryId: number, id: number, name: string) => {
    const s = scopeFor(libraryId)
    if (!s) return { ok: false }
    try {
      addTag(s.db, id, name)
      return { ok: true }
    } finally {
      releaseScope(s)
    }
  })

  ipcMain.handle('assets:removeTag', async (_e, libraryId: number, id: number, name: string) => {
    const s = scopeFor(libraryId)
    if (!s) return { ok: false }
    try {
      removeTag(s.db, id, name)
      return { ok: true }
    } finally {
      releaseScope(s)
    }
  })

  ipcMain.handle('assets:emptyTrash', async (_e, libraryId: number) => {
    const s = scopeFor(libraryId)
    if (!s) return { ok: false }
    try {
      const doomed = s.db.prepare('SELECT fingerprint FROM assets WHERE library_id = ? AND deleted_at IS NOT NULL').all(libraryId) as { fingerprint: string }[]
      const purged = s.db.prepare('DELETE FROM assets WHERE library_id = ? AND deleted_at IS NOT NULL').run(libraryId).changes
      // 原图记录被清除时同步删除缩略图与清单条目
      await removeThumbsIfUnused(s.libPath, s.db, libraryId, doomed.map((r) => r.fingerprint))
      return { ok: true, purged }
    } finally {
      releaseScope(s)
    }
  })

  /* 单条/批量彻底删除回收站记录:数据库行与缩略图一并清除,不动原图文件 */
  ipcMain.handle('assets:purge', async (_e, libraryId: number, ids: number[]) => {
    const s = scopeFor(libraryId)
    if (!s) return { ok: false, purged: 0 }
    try {
      if (!Array.isArray(ids) || ids.length === 0) return { ok: true, purged: 0 }
      const clean = ids.filter((id) => Number.isInteger(id))
      if (clean.length === 0) return { ok: true, purged: 0 }
      // S3-5:分批 500,规避 SQLite 变量数上限(999/32766 视版本)
      const CHUNK = 500
      let purged = 0
      const doomed: { fingerprint: string }[] = []
      for (let i = 0; i < clean.length; i += CHUNK) {
        const batch = clean.slice(i, i + CHUNK)
        const placeholders = batch.map(() => '?').join(',')
        doomed.push(
          ...(s.db
            .prepare(`SELECT fingerprint FROM assets WHERE library_id = ? AND deleted_at IS NOT NULL AND id IN (${placeholders})`)
            .all(libraryId, ...batch) as { fingerprint: string }[])
        )
        purged += s.db
          .prepare(`DELETE FROM assets WHERE library_id = ? AND deleted_at IS NOT NULL AND id IN (${placeholders})`)
          .run(libraryId, ...batch).changes
      }
      await removeThumbsIfUnused(s.libPath, s.db, libraryId, doomed.map((r) => r.fingerprint))
      return { ok: true, purged }
    } finally {
      releaseScope(s)
    }
  })

  /* 清理缺失记录:missing=1 且文件确实不存在(二重校验),不动任何磁盘文件 */
  ipcMain.handle('assets:purgeMissing', async (_e, libraryId: number) => {
    const s = scopeFor(libraryId)
    if (!s) return { purged: 0 }
    try {
      const rows = s.db
        .prepare('SELECT id, rel_path, fingerprint FROM assets WHERE library_id = ? AND missing = 1')
        .all(libraryId) as { id: number; rel_path: string; fingerprint: string }[]
      let purged = 0
      for (const r of rows) {
        const gone = await access(absPathFor(s, r.rel_path)).then(() => false, () => true)
        // 文件其实还在盘上(临时不可见/误标):保留记录与缩略图,只报告不动手
        if (!gone) continue
        s.db.prepare('DELETE FROM assets WHERE id = ?').run(r.id)
        await removeThumbsIfUnused(s.libPath, s.db, libraryId, [r.fingerprint])
        purged++
      }
      return { purged }
    } finally {
      releaseScope(s)
    }
  })

  ipcMain.handle('eagle:import', async (_e, libraryId: number, folderPath: string) => {
    const lib = getLibrary(getDb(), libraryId)
    if (!lib) return { error: '当前没有激活的库' }
    if (!hasLibDb(lib.path) && !ensureLibraryStorage(getDb(), lib)) return { error: '素材库无法创建本地数据库' }
    const s = scopeFor(libraryId)
    if (!s || typeof folderPath !== 'string' || !folderPath.trim()) return { error: '请选择 Eagle 素材库目录' }
    let eagle: EagleScan
    try {
      eagle = await scanEagleLibrary(folderPath, (done) => send('library:scan', { libraryId, done, phase: 'scanning' }))
    } catch (error) {
      releaseScope(s)
      return { error: error instanceof Error ? error.message : '无法读取 Eagle 素材库' }
    }
    try {
      const rootKey = `${libraryId}:root`
      await watchManager.close(rootKey)

      try {
        const imported = await moveEagleLibraryAssets(folderPath, s.libPath, eagle, (done) => {
          send('library:scan', { libraryId, done, phase: 'moving' })
        })
        upsertScanned(s.db, libraryId, imported.entries)
        send('library:scan', { libraryId, done: imported.imported, phase: 'done', added: imported.imported })
        send('assets:changed', { libraryId })
        queueThumbWarmup(libraryId)
        return { imported: imported.imported, multiFolderAssets: imported.multiFolderAssets }
      } catch (error) {
        return { error: error instanceof Error ? error.message : '无法导入 Eagle 素材' }
      } finally {
        attachRootWatcher(libraryId, s.libPath)
      }
    } finally {
      releaseScope(s)
    }
  })
}


export type { Scope }

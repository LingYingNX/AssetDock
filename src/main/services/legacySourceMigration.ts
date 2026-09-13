import type { Database } from 'better-sqlite3'
import { copyFile, lstat, mkdir, rename, rm, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

interface LegacySource {
  id: number
  path: string
}

interface LegacyAsset {
  id: number
  rel_path: string
  source_index_id: number
  missing: number
}

interface PlannedMove {
  assetId: number
  source: string
  target: string
  targetRelPath: string
}

export interface LegacySourceMigrationResult {
  moved: number
  removedMissing: number
  sourceIds: number[]
}

function safeRelativePath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/')
  if (
    !normalized ||
    isAbsolute(path) ||
    /^[a-zA-Z]:\//.test(normalized) ||
    parts.some((part) => !part || part === '.' || part === '..' || part.toLowerCase() === '.mediahub')
  ) {
    throw new Error('旧素材路径无效')
  }
  return parts.join('/')
}

function pathInside(root: string, relPath: string): string {
  const base = resolve(root)
  const target = resolve(base, ...safeRelativePath(relPath).split('/'))
  const fromBase = relative(base, target)
  if (!fromBase || fromBase === '..' || fromBase.startsWith('..\\') || isAbsolute(fromBase)) {
    throw new Error('旧素材路径超出允许范围')
  }
  return target
}

function sourceRelativePath(relPath: string, sourceId: number): string {
  const prefix = `@index:${sourceId}/`
  if (!relPath.startsWith(prefix)) throw new Error('旧素材路径与来源不匹配')
  return safeRelativePath(relPath.slice(prefix.length))
}

function overlaps(left: string, right: string): boolean {
  const rel = relative(resolve(left), resolve(right))
  return rel === '' || (!rel.startsWith('..\\') && rel !== '..' && !isAbsolute(rel))
}

async function moveFile(source: string, target: string): Promise<void> {
  try {
    await rename(source, target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    await copyFile(source, target, constants.COPYFILE_EXCL)
    try {
      await unlink(source)
    } catch (unlinkError) {
      await rm(target, { force: true }).catch(() => undefined)
      throw unlinkError
    }
  }
}

function numberedName(fileName: string, number: number): string {
  if (number === 1) return fileName
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? `${fileName.slice(0, dot)} (${number})${fileName.slice(dot)}` : `${fileName} (${number})`
}

async function uniqueTarget(root: string, relPath: string, occupied: Set<string>): Promise<{ target: string; relPath: string }> {
  const directory = dirname(pathInside(root, relPath))
  const fileName = basename(relPath)
  for (let number = 1; ; number++) {
    const candidateRel = [...safeRelativePath(relPath).split('/').slice(0, -1), numberedName(fileName, number)].join('/')
    const candidate = pathInside(root, candidateRel)
    const key = candidateRel.toLowerCase()
    if (occupied.has(key)) continue
    const exists = await lstat(candidate).then(() => true, (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false
      throw error
    })
    if (!exists) {
      await mkdir(directory, { recursive: true })
      occupied.add(key)
      return { target: candidate, relPath: candidateRel }
    }
  }
}

/**
 * 一次性收拢旧版外部来源。仅迁移数据库已登记且存在的文件；失败时回滚已移动文件。
 */
export async function migrateLegacySources(
  db: Database,
  libraryId: number,
  libraryRoot: string
): Promise<LegacySourceMigrationResult> {
  const sources = db
    .prepare(
      `SELECT id, path FROM index_sources
       WHERE id IN (SELECT DISTINCT source_index_id FROM assets WHERE library_id = ? AND source_index_id IS NOT NULL)`
    )
    .all(libraryId) as LegacySource[]
  if (sources.length === 0) return { moved: 0, removedMissing: 0, sourceIds: [] }

  const byId = new Map(sources.map((source) => [source.id, source]))
  const assets = db
    .prepare('SELECT id, rel_path, source_index_id, missing FROM assets WHERE library_id = ? AND source_index_id IS NOT NULL')
    .all(libraryId) as LegacyAsset[]
  const occupied = new Set(
    (db.prepare('SELECT rel_path FROM assets WHERE library_id = ? AND source_index_id IS NULL').all(libraryId) as { rel_path: string }[])
      .map((row) => row.rel_path.toLowerCase())
  )
  const moves: PlannedMove[] = []
  const missingAssetIds: number[] = []

  for (const asset of assets) {
    const source = byId.get(asset.source_index_id)
    if (!source) throw new Error('旧素材来源不存在')
    if (asset.missing) {
      missingAssetIds.push(asset.id)
      continue
    }
    if (overlaps(source.path, libraryRoot) || overlaps(libraryRoot, source.path)) {
      throw new Error('旧素材来源不能与当前资源库重叠')
    }
    const relPath = sourceRelativePath(asset.rel_path, asset.source_index_id)
    const sourcePath = pathInside(source.path, relPath)
    const state = await lstat(sourcePath).catch(() => null)
    if (!state?.isFile()) throw new Error(`旧素材不存在: ${relPath}`)
    const target = await uniqueTarget(libraryRoot, relPath, occupied)
    moves.push({ assetId: asset.id, source: sourcePath, target: target.target, targetRelPath: target.relPath })
  }

  const moved: PlannedMove[] = []
  try {
    for (const move of moves) {
      await moveFile(move.source, move.target)
      moved.push(move)
    }
  } catch (error) {
    for (const move of moved.reverse()) await moveFile(move.target, move.source).catch(() => undefined)
    throw error
  }

  try {
    const update = db.prepare('UPDATE assets SET rel_path = ?, source_index_id = NULL, missing = 0, folder_path = NULL WHERE id = ? AND library_id = ?')
    const removeSources = db.prepare('DELETE FROM index_sources WHERE id = ?')
    db.transaction(() => {
      for (const move of moves) update.run(move.targetRelPath, move.assetId, libraryId)
      for (const source of sources) removeSources.run(source.id)
    })()
  } catch (error) {
    for (const move of moved.reverse()) await moveFile(move.target, move.source).catch(() => undefined)
    throw error
  }

  const metadataRoot = resolve(libraryRoot, '.mediahub', 'metadata')
  for (const source of sources) {
    const metadataPath = resolve(metadataRoot, String(source.id))
    if (relative(metadataRoot, metadataPath) === String(source.id)) await rm(metadataPath, { recursive: true, force: true })
  }
  return { moved: moves.length, removedMissing: missingAssetIds.length, sourceIds: sources.map((source) => source.id) }
}

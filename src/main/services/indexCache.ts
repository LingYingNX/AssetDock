import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdir, readdir, readFile, rename, rm, rmdir } from 'node:fs/promises'
import { promisify } from 'node:util'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { isWithinRoot, moveFileIfPresent, writeFileAtomically } from './cacheFiles'
import { libIndexCacheDir } from './libraryDb'
import type { AssetRow } from './store'

const execFileAsync = promisify(execFile)

export interface IndexCachePaths {
  libraryRoot: string
  sourceIndexId: number
  sourceRelPath: string
  shortcut: string
  sidecar: string
}

const SIDECAR_KIND = 'mediahub.index-sidecar'

function validSourceRelativePath(sourceRelPath: string): string {
  const normalized = sourceRelPath.replace(/\\/g, '/')
  const parts = normalized.split('/')
  if (
    !normalized ||
    isAbsolute(sourceRelPath) ||
    /^[a-zA-Z]:\//.test(normalized) ||
    parts.some((part) => !part || part === '.' || part === '..') ||
    parts.some((part) => part.toLowerCase() === '.mediahub')
  ) {
    throw new Error('invalid source-relative path')
  }
  return parts.join('/')
}

function assertMirrorPath(libraryRoot: string, target: string): void {
  const root = resolve(libraryRoot)
  const resolvedTarget = resolve(target)
  const mediaRoot = resolve(root, '.mediahub')
  if (!isWithinRoot(root, resolvedTarget) || isWithinRoot(mediaRoot, resolvedTarget)) {
    throw new Error('invalid index mirror path')
  }
}

export function indexCachePaths(libraryRoot: string, sourceIndexId: number, sourceRelPath: string): IndexCachePaths {
  if (!Number.isInteger(sourceIndexId) || sourceIndexId < 1) throw new Error('invalid source index id')
  const normalized = validSourceRelativePath(sourceRelPath)
  const root = resolve(libraryRoot)
  const base = join(root, ...normalized.split('/'))
  assertMirrorPath(root, base)
  return {
    libraryRoot: root,
    sourceIndexId,
    sourceRelPath: normalized,
    shortcut: `${base}.lnk`,
    sidecar: `${base}.json`
  }
}

function parsePalette(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : []
  } catch {
    return []
  }
}

export function indexSidecar(asset: AssetRow, sourceRelPath: string): Record<string, unknown> {
  if (asset.source_index_id == null) throw new Error('asset is not indexed')
  return {
    kind: SIDECAR_KIND,
    schemaVersion: 1,
    source: {
      indexId: asset.source_index_id,
      relativePath: validSourceRelativePath(sourceRelPath),
      fingerprint: asset.fingerprint,
      sizeBytes: asset.size_bytes,
      mtimeMs: asset.mtime_ms
    },
    asset: {
      name: asset.name,
      tags: asset.tags,
      note: asset.note,
      sourceUrl: asset.source_url,
      rating: asset.rating,
      favorite: asset.favorite === 1,
      reviewFlag: asset.review_flag === 1,
      folderPath: asset.folder_path
    },
    derived: {
      type: asset.type,
      format: asset.format,
      width: asset.width,
      height: asset.height,
      duration: asset.duration,
      codec: asset.codec,
      fps: asset.fps,
      faceCount: asset.face_count,
      vertices: asset.vertices,
      palette: parsePalette(asset.palette)
    },
    writtenAt: new Date().toISOString()
  }
}

async function isManagedSidecar(path: string, sourceIndexId: number, sourceRelPath: string): Promise<boolean> {
  const payload = await readFile(path, 'utf8').then(
    (value) => JSON.parse(value) as { kind?: string; source?: { indexId?: number; relativePath?: string } },
    () => null
  )
  return (
    payload?.kind === SIDECAR_KIND &&
    payload.source?.indexId === sourceIndexId &&
    payload.source.relativePath === sourceRelPath
  )
}

export async function writeIndexSidecar(path: string, asset: AssetRow, sourceRelPath: string): Promise<void> {
  if (await access(path).then(() => true, () => false)) {
    if (asset.source_index_id == null || !(await isManagedSidecar(path, asset.source_index_id, validSourceRelativePath(sourceRelPath)))) {
      throw new Error('index mirror path collides with an existing JSON file')
    }
  }
  await writeFileAtomically(path, JSON.stringify(indexSidecar(asset, sourceRelPath), null, 2))
}

async function existingShortcutTarget(path: string): Promise<string | null> {
  if (process.platform !== 'win32' || !(await access(path).then(() => true, () => false))) return null
  const result = await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$shell = New-Object -ComObject WScript.Shell; $shell.CreateShortcut($env:MEDIAHUB_LINK_PATH).TargetPath'
    ],
    { windowsHide: true, env: { ...process.env, MEDIAHUB_LINK_PATH: path } }
  )
  return result.stdout.trim() || null
}

export async function writeIndexShortcut(path: string, targetPath: string, allowExistingTarget = false): Promise<void> {
  if (process.platform !== 'win32') throw new Error('Windows shortcuts are only supported on Windows')
  if (!isAbsolute(path) || !isAbsolute(targetPath)) throw new Error('invalid shortcut path')
  const existing = await existingShortcutTarget(path)
  if (!allowExistingTarget && existing && resolve(existing).toLowerCase() !== resolve(targetPath).toLowerCase()) {
    throw new Error('index mirror path collides with an existing shortcut')
  }
  const temp = `${path}.tmp-${process.pid}-${randomUUID()}.lnk`
  await mkdir(dirname(path), { recursive: true })
  try {
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        '$ErrorActionPreference = "Stop"; $shell = New-Object -ComObject WScript.Shell; $link = $shell.CreateShortcut($env:MEDIAHUB_LINK_PATH); $link.TargetPath = $env:MEDIAHUB_TARGET_PATH; $link.WorkingDirectory = [System.IO.Path]::GetDirectoryName($env:MEDIAHUB_TARGET_PATH); $link.Save()'
      ],
      {
        windowsHide: true,
        env: { ...process.env, MEDIAHUB_LINK_PATH: temp, MEDIAHUB_TARGET_PATH: targetPath }
      }
    )
    await rm(path, { force: true })
    await rename(temp, path)
  } finally {
    await rm(temp, { force: true })
  }
}

export async function moveIndexCachePair(from: IndexCachePaths, to: IndexCachePaths, targetPath?: string): Promise<void> {
  if (from.libraryRoot !== to.libraryRoot || from.sourceIndexId !== to.sourceIndexId) {
    throw new Error('cache pair crosses index roots')
  }
  if (targetPath) {
    const existingTarget = await existingShortcutTarget(to.shortcut)
    if (existingTarget && resolve(existingTarget).toLowerCase() !== resolve(targetPath).toLowerCase()) {
      throw new Error('index mirror path collides with an existing shortcut')
    }
    if (await access(to.sidecar).then(() => true, () => false) && !(await isManagedSidecar(to.sidecar, to.sourceIndexId, to.sourceRelPath))) {
      throw new Error('index mirror path collides with an existing JSON file')
    }
  }
  await moveFileIfPresent(from.shortcut, to.shortcut)
  if (await moveFileIfPresent(from.sidecar, to.sidecar)) {
    const payload = await readFile(to.sidecar, 'utf8').then((value) => JSON.parse(value) as { source?: { relativePath?: string } }, () => null)
    if (payload?.source) {
      payload.source.relativePath = to.sourceRelPath
      await writeFileAtomically(to.sidecar, JSON.stringify(payload, null, 2))
    }
  }
  if (targetPath) await writeIndexShortcut(to.shortcut, targetPath, true)
}

export async function removeIndexCachePair(paths: IndexCachePaths): Promise<void> {
  assertMirrorPath(paths.libraryRoot, paths.shortcut)
  assertMirrorPath(paths.libraryRoot, paths.sidecar)
  if (!(await isManagedSidecar(paths.sidecar, paths.sourceIndexId, paths.sourceRelPath))) return
  await rm(paths.shortcut, { force: true })
  await rm(paths.sidecar, { force: true })
}

export async function removeLegacyIndexSourceCache(libraryRoot: string, sourceIndexId: number): Promise<void> {
  const mediaRoot = resolve(libraryRoot, '.mediahub')
  const cacheRoot = resolve(libIndexCacheDir(libraryRoot))
  const sourceRoot = resolve(cacheRoot, `source-${sourceIndexId}`)
  if (!isWithinRoot(cacheRoot, sourceRoot) || sourceRoot === cacheRoot) throw new Error('invalid source cache root')
  await rm(sourceRoot, { recursive: true, force: true })
  await rmdir(cacheRoot).catch(() => undefined)
}

export async function removeIndexSourceCache(libraryRoot: string, sourceIndexId: number): Promise<void> {
  if (!Number.isInteger(sourceIndexId) || sourceIndexId < 1) throw new Error('invalid source index id')
  const root = resolve(libraryRoot)

  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.name === '.mediahub' && entry.isDirectory()) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
        continue
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue
      const payload = await readFile(path, 'utf8').then((value) => JSON.parse(value) as { kind?: string; schemaVersion?: number; source?: { indexId?: number; relativePath?: string } }, () => null)
      if (payload?.kind !== SIDECAR_KIND || payload.schemaVersion !== 1 || payload.source?.indexId !== sourceIndexId || !payload.source.relativePath) continue
      try {
        const paths = indexCachePaths(root, sourceIndexId, payload.source.relativePath)
        if (resolve(paths.sidecar).toLowerCase() !== resolve(path).toLowerCase()) continue
        await removeIndexCachePair(paths)
      } catch {
        // Ignore malformed or stale sidecars; the database cleanup remains authoritative.
      }
    }
  }

  await walk(root)
  await removeLegacyIndexSourceCache(root, sourceIndexId)
}

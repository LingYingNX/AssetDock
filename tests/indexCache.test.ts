import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  indexCachePaths,
  moveIndexCachePair,
  removeIndexCachePair,
  removeIndexSourceCache,
  writeIndexShortcut,
  writeIndexSidecar
} from '../src/main/services/indexCache'
import type { AssetRow } from '../src/main/services/store'
import { ensureThumb } from '../src/main/services/thumbs'

const execFileAsync = promisify(execFile)

function fixtureAsset(): AssetRow {
  return {
    id: 8,
    library_id: 1,
    rel_path: '@index:12/scenery/forest/leaf.png',
    name: 'leaf',
    type: 'image',
    format: 'PNG',
    width: 640,
    height: 480,
    duration: null,
    face_count: null,
    vertices: null,
    material_info: null,
    codec: null,
    fps: null,
    size_bytes: 123,
    mtime_ms: 456,
    fingerprint: 'a1b2c3d4e5f60718293a',
    rating: 4,
    favorite: 1,
    review_flag: 0,
    note: 'reference',
    source_url: 'https://example.test/ref',
    deleted_at: null,
    missing: 0,
    palette: '["#112233"]',
    imported_at: '2026-09-05T12:00',
    source_index_id: 12,
    folder_path: 'inspiration',
    tags: [{ name: 'nature', color: '#3ECF8E' }]
  }
}

async function shortcutTarget(path: string): Promise<string> {
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
  return result.stdout.trim()
}

describe('index mirror', () => {
  it('writes a sidecar next to a root-level shortcut without exposing the source root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-index-mirror-'))
    try {
      const paths = indexCachePaths(root, 12, 'scenery/forest/leaf.png')
      expect(paths.shortcut).toBe(join(root, 'scenery', 'forest', 'leaf.png.lnk'))
      expect(paths.sidecar).toBe(join(root, 'scenery', 'forest', 'leaf.png.json'))

      await writeIndexSidecar(paths.sidecar, fixtureAsset(), 'scenery/forest/leaf.png')
      const parsed = JSON.parse(await readFile(paths.sidecar, 'utf8'))
      expect(parsed).toMatchObject({
        schemaVersion: 1,
        source: {
          indexId: 12,
          relativePath: 'scenery/forest/leaf.png',
          fingerprint: 'a1b2c3d4e5f60718293a',
          sizeBytes: 123,
          mtimeMs: 456
        },
        asset: {
          tags: [{ name: 'nature', color: '#3ECF8E' }],
          note: 'reference',
          sourceUrl: 'https://example.test/ref',
          favorite: true,
          folderPath: 'inspiration'
        },
        derived: { width: 640, height: 480, palette: ['#112233'] }
      })
      expect(JSON.stringify(parsed)).not.toContain(root)
      expect(() => indexCachePaths(root, 12, '../outside.png')).toThrow('invalid source-relative path')
      expect(() => indexCachePaths(root, 12, 'C:/outside.png')).toThrow('invalid source-relative path')
      expect(() => indexCachePaths(root, 12, '.mediahub/escape.png')).toThrow('invalid source-relative path')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('serializes concurrent sidecar refreshes on Windows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-index-mirror-'))
    try {
      const paths = indexCachePaths(root, 12, 'leaf.png')
      await Promise.all([
        writeIndexSidecar(paths.sidecar, fixtureAsset(), 'leaf.png'),
        writeIndexSidecar(paths.sidecar, fixtureAsset(), 'leaf.png')
      ])
      await expect(readFile(paths.sidecar, 'utf8')).resolves.toContain('leaf.png')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform !== 'win32')('creates a Windows shortcut that points to the indexed source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-index-mirror-'))
    try {
      const paths = indexCachePaths(root, 12, 'scenery/leaf.png')
      const target = join(root, 'external', 'scenery', 'leaf.png')
      await writeIndexShortcut(paths.shortcut, target)
      await expect(access(paths.shortcut)).resolves.toBeUndefined()
      await expect(shortcutTarget(paths.shortcut)).resolves.toBe(target)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform !== 'win32')('moves and removes only a root-level shortcut and sidecar pair', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-index-mirror-'))
    try {
      const from = indexCachePaths(root, 12, 'old/leaf.png')
      const to = indexCachePaths(root, 12, 'new/leaf.png')
      const oldTarget = join(root, 'external', 'old', 'leaf.png')
      const newTarget = join(root, 'external', 'new', 'leaf.png')
      await writeIndexShortcut(from.shortcut, oldTarget)
      await writeIndexSidecar(from.sidecar, fixtureAsset(), 'old/leaf.png')

      await moveIndexCachePair(from, to, newTarget)
      await expect(access(to.shortcut)).resolves.toBeUndefined()
      await expect(readFile(to.sidecar, 'utf8')).resolves.toContain('new/leaf.png')
      await expect(shortcutTarget(to.shortcut)).resolves.toBe(newTarget)

      await removeIndexCachePair(to)
      await expect(access(to.shortcut)).rejects.toThrow()
      await expect(access(to.sidecar)).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 15000)

  it.skipIf(process.platform !== 'win32')('removes direct source pairs and legacy cache without touching other files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-index-mirror-'))
    try {
      const paths = indexCachePaths(root, 12, '1/leaf.png')
      const userJson = join(root, 'notes.json')
      await writeIndexShortcut(paths.shortcut, join(root, 'external', '1', 'leaf.png'))
      await writeIndexSidecar(paths.sidecar, fixtureAsset(), '1/leaf.png')
      await writeFile(userJson, '{"keep":true}')
      await mkdir(join(root, '.mediahub', 'index-cache', 'source-12'), { recursive: true })
      await writeFile(join(root, '.mediahub', 'index-cache', 'source-12', 'old.webp'), 'legacy')

      await removeIndexSourceCache(root, 12)

      await expect(access(paths.shortcut)).rejects.toThrow()
      await expect(access(paths.sidecar)).rejects.toThrow()
      await expect(access(userJson)).resolves.toBeUndefined()
      await expect(access(join(root, '.mediahub', 'index-cache', 'source-12'))).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('writes an indexed thumbnail to the library thumbs directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-index-mirror-'))
    try {
      const result = await ensureThumb({
        fingerprint: 'model-fingerprint',
        absPath: join(root, 'unused.glb'),
        type: 'model',
        format: 'GLB',
        dir: join(root, '.mediahub', 'thumbs')
      })

      expect(result).toMatchObject({ path: join(root, '.mediahub', 'thumbs', 'model-fingerprint.webp'), placeholder: false })
      await expect(access(join(root, '.mediahub', 'thumbs', 'model-fingerprint.webp'))).resolves.toBeUndefined()
      await expect(access(join(root, 'models', 'leaf.glb.webp'))).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

import { mkdtemp, readFile, rm, symlink, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openMemoryDb } from '../src/main/services/db'
import { listAssets, upsertScanned } from '../src/main/services/store'
import { readShellAsset, readTextAsset, renameShellAlongside, siblingShellRelPath, writeShellAsset, writeTextAsset } from '../src/main/services/textAssets'
import { thumbJobRows } from '../src/main/services/thumbs'

describe('text asset io', () => {
  it('reads and writes css inside the library', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-text-'))
    const db = openMemoryDb()
    db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'lib', root)
    try {
      await writeFile(join(root, 'loader.css'), '.loader{color:red}')
      upsertScanned(db, 1, [{ relPath: 'loader.css', name: 'loader', type: 'style', format: 'CSS', sizeBytes: 18, mtimeMs: 1, fingerprint: 'old' }])

      const read = await readTextAsset(root, 'loader.css')
      expect(read?.text).toBe('.loader{color:red}')

      const written = await writeTextAsset(db, 1, root, 'loader.css', '.loader{color:seagreen}')
      expect(written).not.toBeNull()
      expect(await readFile(join(root, 'loader.css'), 'utf8')).toBe('.loader{color:seagreen}')

      const asset = listAssets(db, 1)[0]
      expect(asset.size_bytes).toBe(written?.sizeBytes)
      expect(asset.fingerprint).toBe(written?.fingerprint)
      // 保存不应改变 id / 导入时间
      expect(asset.rel_path).toBe('loader.css')
    } finally {
      db.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('queues a fresh thumbnail after saving by advancing the fingerprint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-text-thumb-'))
    const db = openMemoryDb()
    db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'lib', root)
    try {
      await writeFile(join(root, 'loader.css'), '.loader{color:red}')
      upsertScanned(db, 1, [{ relPath: 'loader.css', name: 'loader', type: 'style', format: 'CSS', sizeBytes: 18, mtimeMs: 1, fingerprint: 'old-fp' }])
      expect(thumbJobRows(db, 1).map((r) => r.fingerprint)).toEqual(['old-fp'])

      const written = await writeTextAsset(db, 1, root, 'loader.css', '.loader{color:seagreen;font-weight:700}')
      expect(written?.fingerprint).toBeTruthy()
      expect(written?.fingerprint).not.toBe('old-fp')
      // 预热集合按新指纹取素材:旧指纹不再出现,新指纹会被重新渲染
      expect(thumbJobRows(db, 1).map((r) => r.fingerprint)).toEqual([written?.fingerprint])
    } finally {
      db.close()
      await rm(root, { recursive: true, force: true })
    }
  })
  it('derives the sibling shell path from the css path', () => {
    expect(siblingShellRelPath('styles/loader.css')).toBe('styles/loader.html')
    expect(siblingShellRelPath('a.b.css')).toBe('a.b.html')
    expect(siblingShellRelPath('plain')).toBe('plain.html')
  })

  it('renames the sibling shell along with the css so the pairing survives', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-shell-rename-'))
    try {
      await writeFile(join(root, 'old.css'), '.a{}')
      await writeFile(join(root, 'old.html'), '<div class="a">x</div>')

      expect(await renameShellAlongside(root, 'old.css', 'new.css')).toBe(true)
      expect(await readFile(join(root, 'new.html'), 'utf8')).toContain('class="a"')
      // 旧骨架应已不在
      expect(await readFile(join(root, 'old.html'), 'utf8').catch(() => null)).toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('leaves the shell alone when there is nothing to rename', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-shell-norename-'))
    try {
      await writeFile(join(root, 'old.css'), '.a{}')
      // 没有配套骨架:不动任何文件,也不报错
      expect(await renameShellAlongside(root, 'old.css', 'new.css')).toBe(false)
      // 同名(只改扩展名以外的情况)时不动
      expect(await renameShellAlongside(root, 'same.css', 'same.css')).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('writes and reads the sibling html shell without touching the asset row', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-shell-'))
    const db = openMemoryDb()
    db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'lib', root)
    try {
      await writeFile(join(root, 'loader.css'), '.loader{color:red}')
      upsertScanned(db, 1, [{ relPath: 'loader.css', name: 'loader', type: 'style', format: 'CSS', sizeBytes: 18, mtimeMs: 1, fingerprint: 'f1' }])

      // 骨架尚不存在:读回 null,而不是报错
      expect(await readShellAsset(root, 'loader.css')).toBeNull()

      expect(await writeShellAsset(root, 'loader.css', '<div class="loader">自定义</div>')).toBe(true)
      const shell = await readShellAsset(root, 'loader.css')
      expect(shell?.text).toContain('自定义')
      expect(await readFile(join(root, 'loader.html'), 'utf8')).toContain('自定义')

      // HTML 是附属文件:资产行与指纹不受影响
      expect(listAssets(db, 1)[0].fingerprint).toBe('f1')
    } finally {
      db.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses to write a shell outside the library', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-shell-escape-'))
    const outside = await mkdtemp(join(tmpdir(), 'mediahub-shell-outside-'))
    try {
      await mkdir(join(root, 'sub'))
      try {
        await symlink(outside, join(root, 'sub', 'link'), 'dir')
      } catch {
        return // Windows 上无权限创建符号链接时跳过(CI 环境差异)
      }
      expect(await writeShellAsset(root, 'sub/link/evil.css', '<div/>')).toBe(false)
      expect(await readFile(join(outside, 'evil.html'), 'utf8').catch(() => null)).toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('refuses to read or write through a symlink that escapes the library', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-text-escape-'))
    const outside = await mkdtemp(join(tmpdir(), 'mediahub-text-outside-'))
    const db = openMemoryDb()
    db.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'lib', root)
    try {
      await writeFile(join(outside, 'secret.css'), '.x{}')
      await mkdir(join(root, 'sub'))
      try {
        await symlink(join(outside, 'secret.css'), join(root, 'sub', 'link.css'), 'file')
      } catch {
        return // Windows 上无权限创建符号链接时跳过(CI 环境差异)
      }
      expect(await readTextAsset(root, 'sub/link.css')).toBeNull()
      expect(await writeTextAsset(db, 1, root, 'sub/link.css', '.hacked{}')).toBeNull()
      expect(await readFile(join(outside, 'secret.css'), 'utf8')).toBe('.x{}')
    } finally {
      db.close()
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })
})
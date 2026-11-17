import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openMemoryDb } from '../src/main/services/db'
import { addTag, assetById, listAssets, upsertScanned } from '../src/main/services/store'
import { transferAssets, transferFolderTree } from '../src/main/services/assetTransfer'
import { THUMB_CACHE_VERSION, THUMB_SIZE } from '../src/shared/thumbnailConfig'

describe('cross-library asset transfer', () => {
  let sourceRoot = ''
  let targetRoot = ''
  let sourceDb: ReturnType<typeof openMemoryDb>
  let targetDb: ReturnType<typeof openMemoryDb>

  beforeEach(async () => {
    sourceRoot = await mkdtemp(join(tmpdir(), 'mediahub-transfer-src-'))
    targetRoot = await mkdtemp(join(tmpdir(), 'mediahub-transfer-dst-'))
    sourceDb = openMemoryDb()
    targetDb = openMemoryDb()
    sourceDb.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(1, 'src', sourceRoot)
    targetDb.prepare('INSERT INTO libraries(id, name, path) VALUES (?, ?, ?)').run(2, 'dst', targetRoot)
    await mkdir(join(targetRoot, 'inbox'))
  })
  afterEach(async () => {
    sourceDb.close()
    targetDb.close()
    await rm(sourceRoot, { recursive: true, force: true })
    await rm(targetRoot, { recursive: true, force: true })
  })

  async function seed(name: string, body: string): Promise<number> {
    await writeFile(join(sourceRoot, name), body)
    const [row] = upsertScanned(sourceDb, 1, [{
      relPath: name,
      name: name.replace(/\.[^.]+$/, ''),
      type: 'image',
      format: 'JPG',
      sizeBytes: body.length,
      mtimeMs: 1,
      fingerprint: `fp-${name}`
    }])
    sourceDb.prepare('UPDATE assets SET rating = 5, note = ? WHERE id = ?').run('备注', row.assetId)
    addTag(sourceDb, 1, row.assetId, '保留标签')
    return row.assetId
  }

  it('copies into another library with metadata and leaves the source intact', async () => {
    const id = await seed('a.jpg', 'AAA')

    const result = await transferAssets(
      { libraryId: 1, root: sourceRoot, db: sourceDb },
      { libraryId: 2, root: targetRoot, db: targetDb },
      [id],
      'inbox',
      false
    )

    expect(result).toMatchObject({ transferred: 1, skipped: 0, keptSource: 0 })
    await expect(readFile(join(targetRoot, 'inbox', 'a.jpg'), 'utf8')).resolves.toBe('AAA')
    await expect(readFile(join(sourceRoot, 'a.jpg'), 'utf8')).resolves.toBe('AAA')
    expect(sourceDb.prepare('SELECT COUNT(*) AS n FROM assets WHERE library_id = 1').get()).toEqual({ n: 1 })
    expect(assetById(targetDb, 2, result.targetIds[0])).toMatchObject({
      rel_path: 'inbox/a.jpg',
      rating: 5,
      note: '备注',
      tags: [{ name: '保留标签' }]
    })
  })

  it('cut removes the source record and file after the target copy is committed', async () => {
    const id = await seed('b.jpg', 'BBB')

    const result = await transferAssets(
      { libraryId: 1, root: sourceRoot, db: sourceDb },
      { libraryId: 2, root: targetRoot, db: targetDb },
      [id],
      'inbox',
      true
    )

    expect(result.transferred).toBe(1)
    expect(existsSync(join(sourceRoot, 'b.jpg'))).toBe(false)
    expect(listAssets(sourceDb, 1)).toHaveLength(0)
    expect(listAssets(targetDb, 2).map((row) => row.rel_path)).toEqual(['inbox/b.jpg'])
  })

  it('avoids overwriting a same-named file already in the target folder', async () => {
    const id = await seed('c.jpg', 'NEW')
    await writeFile(join(targetRoot, 'inbox', 'c.jpg'), 'OLD')

    const result = await transferAssets(
      { libraryId: 1, root: sourceRoot, db: sourceDb },
      { libraryId: 2, root: targetRoot, db: targetDb },
      [id],
      'inbox',
      false
    )

    expect(result.targetIds).toHaveLength(1)
    await expect(readFile(join(targetRoot, 'inbox', 'c.jpg'), 'utf8')).resolves.toBe('OLD')
    await expect(readFile(join(targetRoot, 'inbox', 'c (2).jpg'), 'utf8')).resolves.toBe('NEW')
  })

  it('moves within one library by rename without changing the asset id', async () => {
    const id = await seed('d.jpg', 'DDD')
    await mkdir(join(sourceRoot, 'inbox'))

    const result = await transferAssets(
      { libraryId: 1, root: sourceRoot, db: sourceDb },
      { libraryId: 1, root: sourceRoot, db: sourceDb },
      [id],
      'inbox',
      true
    )

    expect(result.targetIds).toEqual([id])
    expect(existsSync(join(sourceRoot, 'inbox', 'd.jpg'))).toBe(true)
    expect(assetById(sourceDb, 1, id)?.rel_path).toBe('inbox/d.jpg')
  })

  it('refuses to transfer between nested library roots', async () => {
    const id = await seed('e.jpg', 'EEE')
    await mkdir(join(sourceRoot, 'nested'))
    targetDb.prepare('UPDATE libraries SET path = ? WHERE id = 2').run(join(sourceRoot, 'nested'))

    await expect(transferAssets(
      { libraryId: 1, root: sourceRoot, db: sourceDb },
      { libraryId: 2, root: join(sourceRoot, 'nested'), db: targetDb },
      [id],
      'inbox',
      false
    )).rejects.toThrow('互相嵌套')
  })

  it('carries the paired html shell for css assets on copy', async () => {
    await writeFile(join(sourceRoot, 'button.css'), '.a{color:red}')
    await writeFile(join(sourceRoot, 'button.html'), '<button class="a">x</button>')
    const [row] = upsertScanned(sourceDb, 1, [{
      relPath: 'button.css',
      name: 'button',
      type: 'css',
      format: 'CSS',
      sizeBytes: 14,
      mtimeMs: 1,
      fingerprint: 'fp-button'
    }])

    await transferAssets(
      { libraryId: 1, root: sourceRoot, db: sourceDb },
      { libraryId: 2, root: targetRoot, db: targetDb },
      [row.assetId],
      'inbox',
      false
    )

    await expect(readFile(join(targetRoot, 'inbox', 'button.html'), 'utf8')).resolves.toContain('class="a"')
    await expect(readFile(join(targetRoot, 'inbox', 'button.css'), 'utf8')).resolves.toBe('.a{color:red}')
  })

  it('moves a whole folder subtree across libraries keeping its relative paths', async () => {
    await mkdir(join(sourceRoot, '参考', '人物'), { recursive: true })
    await writeFile(join(sourceRoot, '参考', 'a.jpg'), 'A')
    await writeFile(join(sourceRoot, '参考', '人物', 'b.jpg'), 'B')
    upsertScanned(sourceDb, 1, [
      { relPath: '参考/a.jpg', name: 'a', type: 'image', format: 'JPG', sizeBytes: 1, mtimeMs: 1, fingerprint: 'fp-a' },
      { relPath: '参考/人物/b.jpg', name: 'b', type: 'image', format: 'JPG', sizeBytes: 1, mtimeMs: 1, fingerprint: 'fp-b' }
    ])

    const result = await transferFolderTree(
      { libraryId: 1, root: sourceRoot, db: sourceDb },
      { libraryId: 2, root: targetRoot, db: targetDb },
      '参考',
      ''
    )

    expect(result).toMatchObject({ transferred: 2, skipped: 0, keptSource: 0, removedFolders: 2 })
    await expect(readFile(join(targetRoot, '参考', 'a.jpg'), 'utf8')).resolves.toBe('A')
    await expect(readFile(join(targetRoot, '参考', '人物', 'b.jpg'), 'utf8')).resolves.toBe('B')
    expect(listAssets(sourceDb, 1)).toHaveLength(0)
    expect(existsSync(join(sourceRoot, '参考'))).toBe(false)
  })

  it('brings files that never entered the database along, so the source folder disappears', async () => {
    await mkdir(join(sourceRoot, '参考'))
    await writeFile(join(sourceRoot, '参考', 'a.jpg'), 'A')
    await writeFile(join(sourceRoot, '参考', '未入库.jsonl'), 'orphan')
    upsertScanned(sourceDb, 1, [
      { relPath: '参考/a.jpg', name: 'a', type: 'image', format: 'JPG', sizeBytes: 1, mtimeMs: 1, fingerprint: 'fp-a' }
    ])

    const result = await transferFolderTree(
      { libraryId: 1, root: sourceRoot, db: sourceDb },
      { libraryId: 2, root: targetRoot, db: targetDb },
      '参考',
      ''
    )

    expect(result).toMatchObject({ transferred: 1, removedFolders: 1 })
    await expect(readFile(join(targetRoot, '参考', 'a.jpg'), 'utf8')).resolves.toBe('A')
    await expect(readFile(join(targetRoot, '参考', '未入库.jsonl'), 'utf8')).resolves.toBe('orphan')
    expect(existsSync(join(sourceRoot, '参考'))).toBe(false)
  })

  it('moves a folder that only holds unindexed files', async () => {
    await mkdir(join(sourceRoot, '配置'))
    await writeFile(join(sourceRoot, '配置', 'index.js'), 'js')

    const ticks: [number, number][] = []
    const result = await transferFolderTree(
      { libraryId: 1, root: sourceRoot, db: sourceDb },
      { libraryId: 2, root: targetRoot, db: targetDb },
      '配置',
      'inbox',
      (done, total) => ticks.push([done, total])
    )

    expect(result).toMatchObject({ transferred: 0, removedFolders: 1 })
    expect(ticks).toEqual([[0, 0]])
    await expect(readFile(join(targetRoot, 'inbox', '配置', 'index.js'), 'utf8')).resolves.toBe('js')
    expect(existsSync(join(sourceRoot, '配置'))).toBe(false)
  })

  it('drops the source parent path, moves unindexed files and counts only live assets', async () => {
    await mkdir(join(sourceRoot, '前端UI组件', '媒体与画廊'), { recursive: true })
    await writeFile(join(sourceRoot, '前端UI组件', '媒体与画廊', 'a.jpg'), 'A')
    await writeFile(join(sourceRoot, '前端UI组件', '媒体与画廊', '索引.jsonl'), 'index')
    upsertScanned(sourceDb, 1, [
      { relPath: '前端UI组件/媒体与画廊/a.jpg', name: 'a', type: 'image', format: 'JPG', sizeBytes: 1, mtimeMs: 1, fingerprint: 'fp-a' },
      { relPath: '前端UI组件/媒体与画廊/丢掉.jpg', name: '丢掉', type: 'image', format: 'JPG', sizeBytes: 1, mtimeMs: 1, fingerprint: 'fp-gone' }
    ])
    /* 文件已不在盘上的行按「缺失」处理,不该进进度条的分母 */
    sourceDb.prepare('UPDATE assets SET missing = 1 WHERE fingerprint = ?').run('fp-gone')

    const ticks: [number, number][] = []
    const result = await transferFolderTree(
      { libraryId: 1, root: sourceRoot, db: sourceDb },
      { libraryId: 2, root: targetRoot, db: targetDb },
      '前端UI组件/媒体与画廊',
      '',
      (done, total) => ticks.push([done, total])
    )

    expect(result).toMatchObject({ transferred: 1, removedFolders: 2 })
    expect(ticks[0]).toEqual([0, 1])
    expect(ticks[ticks.length - 1]).toEqual([1, 1])
    /* 目标库只留文件夹自己的名字:源库的父级 前端UI组件 不重建 */
    await expect(readFile(join(targetRoot, '媒体与画廊', 'a.jpg'), 'utf8')).resolves.toBe('A')
    await expect(readFile(join(targetRoot, '媒体与画廊', '索引.jsonl'), 'utf8')).resolves.toBe('index')
    expect(existsSync(join(targetRoot, '前端UI组件'))).toBe(false)
    expect(existsSync(join(sourceRoot, '前端UI组件'))).toBe(false)
  })

  it('reports a monotonic move progress against the whole subtree total', async () => {
    await mkdir(join(sourceRoot, '参考', '人物'), { recursive: true })
    await writeFile(join(sourceRoot, '参考', 'a.jpg'), 'A')
    await writeFile(join(sourceRoot, '参考', 'b.jpg'), 'B')
    await writeFile(join(sourceRoot, '参考', '人物', 'c.jpg'), 'C')
    upsertScanned(sourceDb, 1, ['参考/a.jpg', '参考/b.jpg', '参考/人物/c.jpg'].map((relPath) => ({
      relPath,
      name: relPath.split('/').pop()!.replace(/\.[^.]+$/, ''),
      type: 'image' as const,
      format: 'JPG',
      sizeBytes: 1,
      mtimeMs: 1,
      fingerprint: `fp-${relPath}`
    })))

    const ticks: [number, number][] = []
    const result = await transferFolderTree(
      { libraryId: 1, root: sourceRoot, db: sourceDb },
      { libraryId: 2, root: targetRoot, db: targetDb },
      '参考',
      '',
      (done, total) => ticks.push([done, total])
    )

    expect(result.transferred).toBe(3)
    expect(ticks[0]).toEqual([0, 3])
    expect(ticks[ticks.length - 1]).toEqual([3, 3])
    expect(ticks.every(([, total]) => total === 3)).toBe(true)
    expect(ticks.every(([done], index) => index === 0 || done >= ticks[index - 1][0])).toBe(true)
  })

  it('lands the subtree inside the chosen folder of the target library', async () => {
    await mkdir(join(sourceRoot, '参考', '人物'), { recursive: true })
    await writeFile(join(sourceRoot, '参考', 'a.jpg'), 'A')
    await writeFile(join(sourceRoot, '参考', '人物', 'b.jpg'), 'B')
    await mkdir(join(targetRoot, '归档', '旧稿'), { recursive: true })
    upsertScanned(sourceDb, 1, [
      { relPath: '参考/a.jpg', name: 'a', type: 'image', format: 'JPG', sizeBytes: 1, mtimeMs: 1, fingerprint: 'fp-a' },
      { relPath: '参考/人物/b.jpg', name: 'b', type: 'image', format: 'JPG', sizeBytes: 1, mtimeMs: 1, fingerprint: 'fp-b' }
    ])

    const result = await transferFolderTree(
      { libraryId: 1, root: sourceRoot, db: sourceDb },
      { libraryId: 2, root: targetRoot, db: targetDb },
      '参考',
      '归档/旧稿'
    )

    expect(result).toMatchObject({ transferred: 2, removedFolders: 2 })
    await expect(readFile(join(targetRoot, '归档', '旧稿', '参考', 'a.jpg'), 'utf8')).resolves.toBe('A')
    await expect(readFile(join(targetRoot, '归档', '旧稿', '参考', '人物', 'b.jpg'), 'utf8')).resolves.toBe('B')
    expect(listAssets(targetDb, 2).map((asset) => asset.rel_path).sort()).toEqual([
      '归档/旧稿/参考/a.jpg',
      '归档/旧稿/参考/人物/b.jpg'
    ])
  })

  it('carries the source thumbnail across under the target fingerprint', async () => {
    const id = await seed('t.jpg', 'AAA')
    const [row] = sourceDb.prepare('SELECT fingerprint FROM assets WHERE id = ?').all(id) as { fingerprint: string }[]
    const thumbDir = join(sourceRoot, '.mediahub', 'thumbs')
    await mkdir(thumbDir, { recursive: true })
    await writeFile(join(thumbDir, `${row.fingerprint}-${THUMB_SIZE}.jpg`), 'THUMB-BYTES')
    await writeFile(
      join(thumbDir, 'index.json'),
      JSON.stringify({
        version: THUMB_CACHE_VERSION,
        size: THUMB_SIZE,
        format: 'jpeg',
        entries: {
          [row.fingerprint]: { relPath: 't.jpg', mtimeMs: 1, sizeBytes: 3, generatedAt: '2026-01-01T00:00:00.000Z', renderer: 2 }
        }
      })
    )

    await transferAssets(
      { libraryId: 1, root: sourceRoot, db: sourceDb },
      { libraryId: 2, root: targetRoot, db: targetDb },
      [id],
      'inbox',
      false
    )

    const [target] = targetDb.prepare('SELECT fingerprint FROM assets WHERE library_id = 2').all() as { fingerprint: string }[]
    expect(target.fingerprint).not.toBe(row.fingerprint)
    await expect(readFile(join(targetRoot, '.mediahub', 'thumbs', `${target.fingerprint}-${THUMB_SIZE}.jpg`), 'utf8')).resolves.toBe('THUMB-BYTES')
    /* 缩略图清单是延迟合写落盘的,等一拍再读 */
    await new Promise((resolve) => setTimeout(resolve, 1700))
    const manifest = JSON.parse(await readFile(join(targetRoot, '.mediahub', 'thumbs', 'index.json'), 'utf8')) as {
      entries: Record<string, { relPath: string; renderer?: number }>
    }
    expect(manifest.entries[target.fingerprint]).toMatchObject({ relPath: 'inbox/t.jpg', renderer: 2 })
  })
})

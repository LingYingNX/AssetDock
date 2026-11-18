import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { collectOrphanFingerprintFiles } from '../src/main/services/cacheFiles'

const LIVE = 'a'.repeat(20)
const DEAD = 'b'.repeat(20)

describe('派生缓存孤儿清理', () => {
  let root = ''
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mediahub-orphan-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('删掉指纹已失效的单文件、页图与视频转码,保留活指纹', async () => {
    for (const name of [`${LIVE}.jpg`, `${LIVE}-3.jpg`, `${LIVE}.mp4`, `${LIVE}.pdf`, `${DEAD}.jpg`, `${DEAD}-2.jpg`, `${DEAD}.mp4`]) {
      await writeFile(join(root, name), 'x')
    }
    expect(await collectOrphanFingerprintFiles(root, new Set([LIVE]))).toBe(3)
    expect((await readdir(root)).sort()).toEqual([`${LIVE}-3.jpg`, `${LIVE}.jpg`, `${LIVE}.mp4`, `${LIVE}.pdf`].sort())
  })

  it('清理失效指纹并跳过进行中的 tmp 目录', async () => {
    await mkdir(join(root, 'tmp-42-1'), { recursive: true })
    for (const name of [`${LIVE}.jpg`, `${DEAD}.jpg`, `${DEAD}-1.jpg`, `${DEAD}.mp4`]) {
      await writeFile(join(root, name), 'x')
    }
    expect(await collectOrphanFingerprintFiles(root, new Set([LIVE]))).toBe(3)
    expect((await readdir(root)).sort()).toEqual([`${LIVE}.jpg`, 'tmp-42-1'].sort())
  })

  it('目录不存在时返回 0 而不是抛错', async () => {
    expect(await collectOrphanFingerprintFiles(join(root, 'missing'), new Set())).toBe(0)
  })
})

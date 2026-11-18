import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { collectOrphanFingerprintFiles, fileExists } from './cacheFiles'
import { renderPdfPagePng } from './thumbnailDecoder'

const active = new Map<string, Promise<string>>()

export function aiPreviewDir(libPath: string): string {
  return join(libPath, '.mediahub', 'previews', 'ai')
}

export function aiPreviewPath(libPath: string, fingerprint: string, page: number): string {
  return join(aiPreviewDir(libPath), `${fingerprint}-${page}.jpg`)
}

export async function countPdfPages(absPath: string): Promise<number> {
  return (await renderPdfPagePng(absPath, 1, 640)).pageCount
}

export function ensureAiPagePreview(
  libPath: string,
  absPath: string,
  fingerprint: string,
  page: number
): Promise<string> {
  if (!/^[0-9a-f]{20}$/i.test(fingerprint)) return Promise.reject(new Error('invalid fingerprint'))
  if (!Number.isInteger(page) || page < 1 || page > 1000) return Promise.reject(new Error('invalid page'))
  const target = aiPreviewPath(libPath, fingerprint, page)
  const key = `${target}`
  const running = active.get(key)
  if (running) return running

  const task = (async () => {
    if (await fileExists(target)) return target
    const preview = await renderPdfPagePng(absPath, page, 1800)
    await mkdir(aiPreviewDir(libPath), { recursive: true })
    const temp = `${target}.tmp-${process.pid}-${Date.now()}.jpg`
    try {
      await sharp(preview.png).jpeg({ quality: 90, mozjpeg: true }).toFile(temp)
      const { rename, rm } = await import('node:fs/promises')
      await rename(temp, target)
      await rm(temp, { force: true }).catch(() => undefined)
    } catch (error) {
      await import('node:fs/promises').then(({ rm }) => rm(temp, { force: true })).catch(() => undefined)
      throw error
    }
    const written = await stat(target)
    if (written.size === 0) throw new Error('AI page preview is empty')
    return target
  })()

  active.set(key, task)
  void task.finally(() => {
    if (active.get(key) === task) active.delete(key)
  }).catch(() => undefined)
  return task
}

export function resetAiPreviewTasks(): void {
  active.clear()
}

/** 扫描期孤儿清理:AI 页面图是纯派生缓存,指纹失效即删。 */
export function collectOrphanAiPreviews(
  libPath: string,
  liveFingerprints: ReadonlySet<string>
): Promise<number> {
  return collectOrphanFingerprintFiles(aiPreviewDir(libPath), liveFingerprints)
}

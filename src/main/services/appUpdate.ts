/**
 * 软件更新检测与下载。
 * 检测走一个可配置的清单地址（默认仓库的 GitHub Releases），下载用流式 fetch
 * 边收边写，进度按字节回调给渲染层。没有引入 electron-updater：本仓库还没有
 * 正式发布通道，一个清单 + 流式下载已经覆盖「检测 → 看日志 → 看进度」这条路径。
 */
import { createWriteStream } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  compareVersion,
  parseUpdateManifest,
  type UpdateCheckResult,
  type UpdateDownloadProgress
} from '../../shared/appUpdate'

/** 主检测地址：仓库最新 release。可用 MEDIAHUB_UPDATE_URL 覆盖为自建发布渠道 */
export const DEFAULT_UPDATE_URL = 'https://api.github.com/repos/LingYingNX/AssetDock/releases/latest'

export function updateUrl(): string {
  const custom = process.env.MEDIAHUB_UPDATE_URL
  return custom && custom.trim() ? custom.trim() : DEFAULT_UPDATE_URL
}

/**
 * 回落清单地址：还没发过 Release 时 releases/latest 返回 404，
 * 改读仓库根的 update-manifest.json，随源码一起维护，发版前就能用。
 * 可用 MEDIAHUB_UPDATE_MANIFEST_URL 覆盖。
 */
export const DEFAULT_MANIFEST_URL = 'https://raw.githubusercontent.com/LingYingNX/AssetDock/master/update-manifest.json'

export function manifestUrl(): string {
  const custom = process.env.MEDIAHUB_UPDATE_MANIFEST_URL
  return custom && custom.trim() ? custom.trim() : DEFAULT_MANIFEST_URL
}

const REQUEST_TIMEOUT_MS = 15_000

/** 携带 HTTP 状态码的错误：只有 404 才是「还没发布」，其余原因要原样上报给用户 */
class UpdateHttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'UpdateHttpError'
    this.status = status
  }
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'MediaHub' }
    })
    if (res.status === 403) throw new UpdateHttpError(403, '更新接口限流，请稍后重试')
    if (!res.ok) throw new UpdateHttpError(res.status, `更新服务器返回 ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 从候选清单文本里取第一个能解析的；null 表示该来源没拿到内容，跳过。
 * 抽成纯函数，让「主地址 → 回落清单」这条选择链可单测。
 */
export function resolveUpdateFromTexts(currentVersion: string, texts: (string | null)[]): UpdateCheckResult {
  for (const text of texts) {
    if (text == null) continue
    const manifest = parseUpdateManifest(text)
    if (manifest) return { hasUpdate: compareVersion(manifest.version, currentVersion) > 0, currentVersion, manifest, error: '' }
  }
  return { hasUpdate: false, currentVersion, manifest: null, error: '暂无可用更新来源' }
}

/**
 * 检测更新：先查 release，404（还没发过版）时回落仓库内清单。
 * 限流/网络错误不做回落，直接上报——回落一个同样 403 的地址只会把真实原因盖住。
 */
export async function checkForUpdate(currentVersion: string): Promise<UpdateCheckResult> {
  try {
    return resolveUpdateFromTexts(currentVersion, [await fetchText(updateUrl())])
  } catch (e) {
    if (!(e instanceof UpdateHttpError) || e.status !== 404) {
      return { hasUpdate: false, currentVersion, manifest: null, error: e instanceof Error ? e.message : '更新检测失败' }
    }
    try {
      return resolveUpdateFromTexts(currentVersion, [await fetchText(manifestUrl())])
    } catch (fallbackError) {
      return { hasUpdate: false, currentVersion, manifest: null, error: fallbackError instanceof Error ? `尚未发布更新：${fallbackError.message}` : '尚未发布更新' }
    }
  }
}

/**
 * 流式下载更新包。destPath 的父目录会自动创建；出错时已写的部分会被清掉，
 * 不留半截安装包让下次检测误以为已经下过。
 */
export async function downloadUpdate(
  url: string,
  destPath: string,
  onProgress: (p: UpdateDownloadProgress) => void
): Promise<void> {
  await mkdir(dirname(destPath), { recursive: true })
  // 不设整段超时：安装包可能上百 MB，慢速网络下 60s 会把正常下载截断
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`下载失败：服务器返回 ${res.status}`)

  const total = Number(res.headers.get('content-length')) || null
  const write = createWriteStream(destPath)
  let received = 0

  /* 等 drain 时必须同时盯 error：磁盘满/权限变更时写流会直接报错，
     只等 drain 会永远挂起。 */
  const waitDrain = (): Promise<void> =>
    new Promise((resolve, reject) => {
      const onDrain = (): void => {
        write.off('error', onError)
        resolve()
      }
      const onError = (err: Error): void => {
        write.off('drain', onDrain)
        reject(err)
      }
      write.once('drain', onDrain)
      write.once('error', onError)
    })

  try {
    for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
      received += chunk.length
      if (!write.write(chunk)) await waitDrain()
      onProgress({ received, total, percent: total ? Math.min(100, Math.round((received / total) * 100)) : 0 })
    }
    await new Promise<void>((resolve, reject) => {
      write.end((err?: Error) => (err ? reject(err) : resolve()))
    })
  } catch (e) {
    write.destroy()
    // 半截安装包会让下次检测误以为已经下过，失败一律清掉
    await rm(destPath, { force: true }).catch(() => {})
    throw e instanceof Error ? e : new Error('下载中断')
  }
}

/** 下载落盘目录：userData/updates，与素材库隔离，清库不影响更新缓存 */
export function updateCacheDir(userData: string): string {
  return join(userData, 'updates')
}

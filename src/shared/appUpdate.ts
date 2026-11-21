/**
 * 软件更新的跨进程纯逻辑：版本比较与更新清单解析。
 * 无 fs、无 electron，主进程与渲染层共用，两侧 tsconfig 都已 include src/shared。
 */

/** 更新清单：自有 manifest.json 与 GitHub Releases API 归一后的形态 */
export interface UpdateManifest {
  version: string
  publishedAt: string
  downloadUrl: string
  sizeBytes: number | null
  notes: string[]
}

/** app:checkUpdate 响应：检测失败时 manifest 为 null，error 给出原因 */
export interface UpdateCheckResult {
  hasUpdate: boolean
  currentVersion: string
  manifest: UpdateManifest | null
  error: string
}

/** app:downloadUpdate 的流式下载进度(主进程按字节推送) */
export interface UpdateDownloadProgress {
  received: number
  total: number | null
  /** 0~100；total 未知时为 0 */
  percent: number
}

/** 语义化版本比较：a 更新返回 1，a 更旧返回 -1，相同返回 0。非法输入按 0.0.0 处理。 */
export function compareVersion(a: string, b: string): number {
  const left = parseSemver(a)
  const right = parseSemver(b)
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1
  }
  return 0
}

function parseSemver(raw: string): [number, number, number] {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(raw ?? '').trim())
  if (!match) return [0, 0, 0]
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/**
 * 解析更新清单。支持两种来源，识别不了返回 null，由调用方决定降级文案：
 * - 自有 manifest.json：{ version, publishedAt, downloadUrl, sizeBytes, notes }
 * - GitHub Releases API：tag_name / body / published_at / assets[]
 */
export function parseUpdateManifest(raw: string): UpdateManifest | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const obj = data as Record<string, unknown>

  if (typeof obj.version === 'string' && obj.version.trim()) {
    return {
      version: obj.version.trim(),
      publishedAt: typeof obj.publishedAt === 'string' ? obj.publishedAt : '',
      downloadUrl: typeof obj.downloadUrl === 'string' ? obj.downloadUrl : '',
      sizeBytes: typeof obj.sizeBytes === 'number' ? obj.sizeBytes : null,
      notes: toNotes(obj.notes)
    }
  }

  const tag = typeof obj.tag_name === 'string' ? obj.tag_name.trim() : ''
  if (!tag) return null
  const asset = pickInstallerAsset(obj.assets)
  return {
    version: tag,
    publishedAt: typeof obj.published_at === 'string' ? obj.published_at.slice(0, 10) : '',
    downloadUrl: asset?.url ?? '',
    sizeBytes: asset?.size ?? null,
    notes: toNotes(obj.body)
  }
}

/** 清单条目：数组直接用；字符串按行拆，剥掉 markdown 的标题/列表前缀 */
function toNotes(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((n): n is string => typeof n === 'string').map((n) => n.trim()).filter(Boolean)
  }
  if (typeof raw !== 'string') return []
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(#{1,6}\s*|[-*+]\s+|\d+[.)]\s+)/, '').trim())
    .filter(Boolean)
}

/** 优先挑原生安装包，其次归档，最后任意资源。缺 url 的资源等于没有。 */
function pickInstallerAsset(assets: unknown): { url: string; size: number | null } | null {
  if (!Array.isArray(assets)) return null
  const rows = assets.filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
  const target =
    rows.find((a) => /\.(exe|msi|dmg|appimage|snap|deb|rpm)$/i.test(String(a.name ?? ''))) ??
    rows.find((a) => /\.(7z|zip)$/i.test(String(a.name ?? ''))) ??
    rows[0]
  if (!target) return null
  return {
    url: typeof target.browser_download_url === 'string' ? target.browser_download_url : '',
    size: typeof target.size === 'number' ? target.size : null
  }
}

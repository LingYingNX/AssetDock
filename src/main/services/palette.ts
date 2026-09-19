import { Worker } from 'node:worker_threads'
import type { Database } from 'better-sqlite3'
import type { PaletteColor } from '../../shared/types'

/**
 * k-means 调色板提取,inline worker(主进程 worker_threads,不卡 UI)。
 * 输入 RGB raw buffer(64px 缩图),输出 ≤5 色 hex + 占比。
 */
const WORKER_CODE = `
const { parentPort } = require('node:worker_threads')
function kmeans(px, k, iters) {
  // px: Uint8Array RGB
  const n = px.length / 3
  const centers = []
  for (let i = 0; i < k; i++) {
    const idx = Math.floor((n * i) / k) * 3
    centers.push([px[idx], px[idx + 1], px[idx + 2]])
  }
  const assign = new Int32Array(n)
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) {
      let best = 0, bestD = Infinity
      for (let c = 0; c < k; c++) {
        const dr = px[i * 3] - centers[c][0], dg = px[i * 3 + 1] - centers[c][1], db = px[i * 3 + 2] - centers[c][2]
        const d = dr * dr + dg * dg + db * db
        if (d < bestD) { bestD = d; best = c }
      }
      assign[i] = best
    }
    const sums = Array.from({ length: k }, () => [0, 0, 0, 0])
    for (let i = 0; i < n; i++) {
      const a = assign[i]
      sums[a][0] += px[i * 3]; sums[a][1] += px[i * 3 + 1]; sums[a][2] += px[i * 3 + 2]; sums[a][3]++
    }
    for (let c = 0; c < k; c++) {
      if (sums[c][3] > 0) {
        centers[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]]
      }
    }
  }
  const counts = new Array(k).fill(0)
  for (let i = 0; i < n; i++) counts[assign[i]]++
  const hex = (v) => Math.round(v).toString(16).padStart(2, '0').toUpperCase()
  return centers
    .map((c, i) => ({ hex: '#' + hex(c[0]) + hex(c[1]) + hex(c[2]), ratio: n ? Math.round((counts[i] / n) * 100) : 0 }))
    .filter((p) => p.ratio > 0)
    .sort((a, b) => b.ratio - a.ratio)
}
parentPort.on('message', ({ id, data, width, height, k }) => {
  try {
    const palette = kmeans(new Uint8Array(data), k || 5, 10)
    parentPort.postMessage({ id, palette })
  } catch (e) {
    parentPort.postMessage({ id, palette: [], error: String(e) })
  }
})
`

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, (p: PaletteColor[]) => void>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(WORKER_CODE, { eval: true })
  worker.on('message', (m: { id: number; palette: PaletteColor[] }) => {
    const res = pending.get(m.id)
    if (res) {
      pending.delete(m.id)
      res(m.palette ?? [])
    }
  })
  worker.unref()
  return worker
}

export function extractPalette(raw: Buffer, width: number, height: number): Promise<PaletteColor[]> {
  const w = getWorker()
  const id = ++seq
  return new Promise((resolve) => {
    pending.set(id, resolve)
    w.postMessage({ id, data: raw, width, height, k: 5 })
    // 提取失败静默降级:3s 超时返回空
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        resolve([])
      }
    }, 3000).unref()
  })
}

/** 从库内原文件取 64px RGB raw 后提取(缩略图缓存已移除,直接解码原图);解码失败静默降级为空 */
export async function extractPaletteFromImage(absPath: string): Promise<PaletteColor[]> {
  try {
    const sharp = (await import('sharp')).default
    const { data, info } = await sharp(absPath)
      .resize(64, 64, { fit: 'inside' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    return await extractPalette(data, info.width, info.height)
  } catch {
    return []
  }
}

export interface RefreshPalettesOptions {
  /** 指定素材 id 时无条件重抽(扫描到内容变化);缺省时只补 palette 为空的行 */
  assetIds?: number[]
  onProgress?: (done: number) => void
}

/**
 * 串行补齐/重抽素材主色并写库。逐个解码原图,k-means 在 worker 内天然串行;
 * 单个失败静默跳过,不打断整批,也不阻塞扫描与监听。
 */
export async function refreshPalettes(
  db: Database,
  libraryId: number,
  libPath: string,
  options: RefreshPalettesOptions = {}
): Promise<number> {
  const { assetIds, onProgress } = options
  const rows = (
    assetIds
      ? db
          .prepare(
            `SELECT id, rel_path FROM assets
             WHERE library_id = ? AND missing = 0 AND deleted_at IS NULL AND type = 'image'
               AND id IN (${assetIds.map(() => '?').join(',')})`
          )
          .all(libraryId, ...assetIds)
      : db
          .prepare(
            `SELECT id, rel_path FROM assets
             WHERE library_id = ? AND missing = 0 AND deleted_at IS NULL AND type = 'image' AND palette = '[]'`
          )
          .all(libraryId)
  ) as { id: number; rel_path: string }[]

  const update = db.prepare('UPDATE assets SET palette = ? WHERE id = ?')
  const join = await import('node:path')
  let done = 0
  for (const row of rows) {
    const abs = join.join(libPath, row.rel_path)
    try {
      const palette = await extractPaletteFromImage(abs)
      if (palette.length > 0) update.run(JSON.stringify(palette), row.id)
    } catch {
      /* 解码失败静默降级:palette 保持为空 */
    }
    done++
    onProgress?.(done)
  }
  return done
}

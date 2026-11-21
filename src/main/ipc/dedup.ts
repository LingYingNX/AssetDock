import { ipcMain } from 'electron'
import type { DedupRule, DedupScanResult } from '../../shared/types'
import { send } from '../events'
import { dHashColor, groupSimilar, normalizeFolder, sortByQuality, splitStoredHash, type DedupInputRow, type DedupKeyed } from '../services/dedup'
import { realPathWithinRoot } from '../services/libResolve'
import { absPathFor, releaseScope, scopeFor, type Scope } from './context'

/** 逐张算哈希的并发度:sharp 自带线程池,过高只会排队不更快 */
const HASH_WORKERS = 6

export function registerDedupIpc(): void {
  ipcMain.handle('dedup:scan', async (_e, libraryId: number, rule: DedupRule, folder?: string | null): Promise<DedupScanResult> => {
    const s = scopeFor(libraryId)
    if (!s) return { error: '素材库不存在' }
    try {
      const scope = normalizeFolder(folder)
      const rows = s.db
        .prepare(
          `SELECT id, rel_path AS relPath, name, width, height, size_bytes AS sizeBytes, format, fingerprint, phash
           FROM assets WHERE library_id = ? AND type = 'image' AND missing = 0 AND deleted_at IS NULL
           ${scope ? 'AND instr(rel_path, ?) = 1' : ''}`
        )
        .all(...(scope ? [libraryId, `${scope}/`] : [libraryId])) as DedupInputRow[]
      const total = rows.length
      const items = await computeHashes(s, rows, (done) => send('dedup:progress', { done, total }))
      const groups = groupSimilar(items, rule).map((group) => ({
        candidates: sortByQuality(group).map((row) => ({
          id: row.id,
          relPath: row.relPath,
          name: row.name,
          width: row.width,
          height: row.height,
          sizeBytes: row.sizeBytes,
          fingerprint: row.fingerprint
        }))
      }))
      return { scanned: total, groups }
    } catch (error) {
      return { error: error instanceof Error ? error.message : '去重扫描失败' }
    } finally {
      releaseScope(s)
    }
  })
}

/**
 * 逐行补哈希并汇总。已存哈希且前缀(指纹)未变的直接复用;
 * 哈希写回 phash 列,解码失败的行不进比对(下次扫描会再试)。
 */
async function computeHashes(
  s: Scope,
  rows: DedupInputRow[],
  onProgress: (done: number) => void
): Promise<DedupKeyed[]> {
  const update = s.db.prepare('UPDATE assets SET phash = ? WHERE id = ?')
  const pending = rows.filter((row) => {
    const stored = splitStoredHash(row.phash)
    return stored.fp !== row.fingerprint || !stored.color
  })
  let done = rows.length - pending.length
  let cursor = 0
  const computed = new Map<number, { hash: string; color: string }>()
  const worker = async (): Promise<void> => {
    while (cursor < pending.length) {
      const row = pending[cursor++]
      const real = await realPathWithinRoot(s.libPath, absPathFor(s, row.relPath))
      const probe = real ? await dHashColor(real) : null
      if (probe) {
        update.run(`${row.fingerprint}:${probe.hash}:${probe.color}`, row.id)
        computed.set(row.id, probe)
      }
      done++
      onProgress(done)
    }
  }
  await Promise.all(Array.from({ length: Math.min(HASH_WORKERS, Math.max(1, pending.length)) }, worker))
  /* 本轮新算的优先(本地行对象的 phash 还是旧值);已存哈希要求前缀即当前指纹,
     对不上且本轮没算出来(解码失败)的行不参与比对 */
  return rows.flatMap((row) => {
    const stored = splitStoredHash(row.phash)
    const fresh = computed.get(row.id)
    const hash = fresh?.hash ?? (stored.fp === row.fingerprint ? stored.hash : null)
    const color = fresh?.color ?? stored.color
    return hash ? [{ ...row, hash, ...(color ? { color } : {}) }] : []
  })
}

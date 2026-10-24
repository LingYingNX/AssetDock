import { generateMissingThumbs, removeThumbsIfUnused, thumbJobRows, type ThumbJob } from '../services/thumbs'
import { refreshPalettes } from '../services/palette'
import type { ScanEntry, ScanUpsertResult } from '../services/store'
import { send } from '../events'
import { absPathFor, releaseScope, scopeFor } from './context'

/** 扫描入库后,对新增/内容变化的图片排队抽主色(串行,失败静默) */
export function queuePaletteRefresh(
  s: { db: import('better-sqlite3').Database; libPath: string },
  libraryId: number,
  entries: ScanEntry[],
  results: ScanUpsertResult[]
): void {
  const imageRels = new Set(entries.filter((e) => e.type === 'image').map((e) => e.relPath))
  const ids = results
    .filter((r) => (r.action === 'added' || r.action === 'changed') && imageRels.has(r.relPath))
    .map((r) => r.assetId)
  if (ids.length === 0) return
  void refreshPalettes(s.db, libraryId, s.libPath, {
    assetIds: ids,
    onProgress: (done) => { if (done % 25 === 0) send('assets:changed', { libraryId }) }
  }).then((count) => { if (count > 0) send('assets:changed', { libraryId }) })
}

/**
 * 每个库一条串行预热链:同一时刻只跑一批,批间有新增则再跑一轮。
 * 已生成过的指纹在 generateMissingThumbs 里直接跳过,所以重复触发只补新素材。
 */
const thumbQueues = new Map<number, { running: boolean; rerun: boolean }>()

function thumbJobs(libraryId: number): ThumbJob[] {
  const s = scopeFor(libraryId)
  if (!s) return []
  try {
    // 需要缩略图的素材集合统一在 thumbs.ts 里定义,避免两处 SQL 漂移
    return thumbJobRows(s.db, libraryId).map((r) => ({
      absPath: absPathFor(s, r.rel_path),
      fingerprint: r.fingerprint,
      format: r.format,
      meta: { relPath: r.rel_path, mtimeMs: r.mtime_ms, sizeBytes: r.size_bytes, libraryId }
    }))
  } finally {
    releaseScope(s)
  }
}

/** 排队补齐该库所有缺失缩略图;新增素材或导入完成后调用 */
export function queueThumbWarmup(libraryId: number): void {
  const state = thumbQueues.get(libraryId) ?? { running: false, rerun: false }
  thumbQueues.set(libraryId, state)
  if (state.running) {
    state.rerun = true
    return
  }
  state.running = true
  void (async () => {
    try {
      do {
        state.rerun = false
        const s = scopeFor(libraryId)
        if (!s) return
        try {
          const jobs = thumbJobs(libraryId)
          if (jobs.length === 0) continue
          // S3-6:收集生成失败计数,随进度事件外报,不再静默吞掉
          let failed = 0
          await generateMissingThumbs(s.libPath, jobs, (done, count) => {
            if (count > 0) send('thumbs:progress', { libraryId, done, total: count, phase: 'running' })
          }, () => { failed++ })
          // 快照后的生成期间素材可能被移入回收站,这里按最新库状态补一次对账,避免缩略图滞留
          const trashed = (s.db
            .prepare("SELECT DISTINCT fingerprint FROM assets WHERE library_id = ? AND deleted_at IS NOT NULL AND fingerprint <> ''")
            .all(libraryId) as { fingerprint: string }[]).map((r) => r.fingerprint)
          if (trashed.length > 0) await removeThumbsIfUnused(s.libPath, s.db, libraryId, trashed)
          send('thumbs:progress', { libraryId, done: 0, total: 0, phase: 'done', ...(failed > 0 ? { failed } : {}) })
        } finally {
          releaseScope(s)
        }
      } while (state.rerun)
    } catch {
      send('thumbs:progress', { libraryId, done: 0, total: 0, phase: 'done' })
    } finally {
      state.running = false
    }
  })()
}

export function _resetThumbQueuesForTest(): void {
  thumbQueues.clear()
}

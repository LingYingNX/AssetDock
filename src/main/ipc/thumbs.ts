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

interface ThumbQueueState {
  running: boolean
  /** undefined=无待跑批次, null=全库, Set=仅这些指纹 */
  rerunScope: Set<string> | null | undefined
}

/**
 * 每个库一条串行预热链:同一时刻只跑一批,批间有新请求则按新范围再跑一轮。
 * 已生成过的指纹在 generateMissingThumbs 里直接跳过,所以重复触发只补新素材。
 */
const thumbQueues = new Map<number, ThumbQueueState>()

function thumbJobs(libraryId: number, fingerprints?: ReadonlySet<string>): ThumbJob[] {
  const s = scopeFor(libraryId)
  if (!s) return []
  try {
    // 需要缩略图的素材集合统一在 thumbs.ts 里定义,避免两处 SQL 漂移
    return thumbJobRows(s.db, libraryId, fingerprints ? [...fingerprints] : undefined).map((r) => ({
      absPath: absPathFor(s, r.rel_path),
      fingerprint: r.fingerprint,
      format: r.format,
      meta: { relPath: r.rel_path, mtimeMs: r.mtime_ms, sizeBytes: r.size_bytes, libraryId }
    }))
  } finally {
    releaseScope(s)
  }
}

/**
 * 排队补齐缩略图。传 fingerprints 时只处理本次新增/变化的素材;
 * 不传时补齐全库。SVG 不进入预热集合,由卡片首次请求时懒生成。
 */
export function queueThumbWarmup(libraryId: number, fingerprints?: readonly string[]): void {
  const requested: Set<string> | null = fingerprints === undefined
    ? null
    : new Set(fingerprints.filter(Boolean))
  if (requested && requested.size === 0) return

  const state = thumbQueues.get(libraryId) ?? { running: false, rerunScope: undefined }
  thumbQueues.set(libraryId, state)
  if (state.running) {
    if (requested === null) {
      state.rerunScope = null
    } else if (state.rerunScope !== null) {
      const pending = state.rerunScope ?? new Set<string>()
      for (const fingerprint of requested) pending.add(fingerprint)
      state.rerunScope = pending
    }
    return
  }

  state.running = true
  void (async () => {
    let scope: Set<string> | null | undefined = requested
    try {
      while (scope !== undefined) {
        state.rerunScope = undefined
        const s = scopeFor(libraryId)
        if (!s) return
        try {
          const jobs = thumbJobs(libraryId, scope ?? undefined)
          if (jobs.length > 0) {
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
          }
        } finally {
          releaseScope(s)
        }
        scope = state.rerunScope
      }
    } catch {
      send('thumbs:progress', { libraryId, done: 0, total: 0, phase: 'done' })
    } finally {
      state.running = false
      state.rerunScope = undefined
    }
  })()
}

export function _resetThumbQueuesForTest(): void {
  thumbQueues.clear()
}

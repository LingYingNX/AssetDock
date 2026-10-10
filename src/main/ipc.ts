/**
 * IPC 注册入口(S1-1 拆分后的薄壳)。
 *
 * 原本 836 行的上帝模块按域拆分到 ipc/ 目录:
 * - context.ts  : Scope 解析/释放、libRootOf、win()(纯查表,无副作用)
 * - watch.ts    : WatchManager、启动迁移/对账/补齐、watcher 生命周期
 * - thumbs.ts   : 缩略图预热队列、主色补齐队列
 * - libraries.ts: library:* / tabs / state / dialog handler
 * - assets.ts   : assets:* / folders:* / eagle:import handler
 *
 * 本文件只做组装:依次注册各域 handler,并保持原公开 API 不变。
 */
import { registerLibraryIpc } from './ipc/libraries'
import { registerAssetsIpc } from './ipc/assets'

export function registerIpc(userData: string): void {
  registerLibraryIpc(userData)
  registerAssetsIpc()
}

export { attachWatchersFor } from './ipc/watch'
export { queueThumbWarmup } from './ipc/thumbs'

import { initDb } from './services/db'

/** 初始化全局 db(原 initServices,语义不变) */
export function initServices(userData: string): void {
  initDb(userData)
}

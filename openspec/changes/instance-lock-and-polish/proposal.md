## Why

Change 5 遗留三项收尾(单实例锁/迁移残留清理/曝光持久化),量小且行为独立,合并为一个收尾 change。

## What Changes

- 单实例锁:第二实例聚焦既有窗口并退出
- 「+」菜单条件项「清理迁移残留(N 项)…」(二重确认,仅清全局兜底数据)
- 影棚曝光写入应用状态,重启恢复

## Capabilities

### New Capabilities

- `single-instance`

### Modified Capabilities

- `library-portable`(迁移残留清理)
- `viewer-3d`(曝光持久化)

## Impact

主进程锁与两个 IPC;渲染层菜单条件项与 Lightbox 初值。风险面:无。

## Why

库迁移、目录改名和媒体协议目前在边界条件下可能读写到错误数据库、生成失效或重复素材记录。它们会破坏已承诺的素材可携带和媒体路径隔离行为，应在继续结构精简前修复并锁定回归。

## What Changes

- 统一库根监听、扫描和缺失标记的数据库作用域；全局回退库按 `library_id` 隔离同名相对路径。
- 重命名非空库内目录时，同步该目录下库内素材的 `rel_path`。
- 收紧 `media://` 实路径根校验，只允许与库根完全一致的路径或其真正子路径。
- 批量移动部分成功时，界面重新读取库数据，避免磁盘/数据库已变更而列表仍显示旧状态。

> **范围收缩（2026-09-19）**：原第 3 条「为索引源建立稳定内部身份、支持同名外部目录」及相关的 `library-index` delta 已随 2026-09-10 用户取消「索引外部目录」概念而整体移除；`thumbnails` 与本文件的索引根表述同步收缩为仅库根。索引身份相关任务记录保留为历史。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `asset-browser`: 文件夹改名和批量拖放后的素材列表、路径与界面状态必须保持一致。
- `library-portable`: 迁移后库内数据库与全局回退数据库的读写和监听必须保持库隔离。
- `thumbnails`: `media://` 协议必须对库根执行分隔符安全的实路径边界校验。

## Impact

- 影响 `src/main/ipc.ts`、`src/main/services/store.ts`、`src/main/services/libResolve.ts`、`src/main/services/media.ts`、`src/main/services/watch.ts` 和渲染器库刷新逻辑。
- 补充迁移库监听、非空目录改名、全局回退多库隔离、协议路径边界和部分成功批量操作的回归测试。
- 不增加依赖，不迁移或删除用户素材；数据变更仅修正现有数据库记录的作用域和相对路径。

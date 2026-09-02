# 验证状态 · instance-lock-and-polish

更新: 2026-09-02。代码与三项运行断言均在独占窗口下复验完成，可归档。

## 实现清单

1. **单实例锁**: `src/main/index.ts` 使用 `requestSingleInstanceLock`; 获取失败的实例退出; `second-instance` 事件恢复并聚焦既有窗口。
2. **迁移残留清理**: IPC `library:legacyStats` / `library:purgeLegacy` 删除全局兜底库的 `assets`、`tags`、`asset_tags`，执行 WAL checkpoint，保留库注册表与应用设置; 「+」菜单在有残留时显示「清理迁移残留(N 项)…」，并要求二次确认。
3. **曝光持久化**: Lightbox 挂载时读取 app_state `viewerExposure`（默认 1.0，夹取 0.4–1.6）；`changeExposure` 写入该状态；Viewer3D 直接更新 `toneMappingExposure`，不重建渲染器或场景。

## 2026-09-02 独占窗口复验

### 单实例锁

- 已启动一个 Electron 实例后再次启动，第二实例正常退出（`SECOND_EXIT=0`），系统中仅保留一个应用窗口。
- 先最小化既有窗口再启动第二实例，既有窗口恢复为 `visibilityState=visible`。
- 自动化运行时终端处于前台，`document.hasFocus()` 为 `false`；该值不作为窗口恢复失败的证据。

### 迁移残留清理

- 向全局兜底库注入 9 条 `assets`、1 条 `tags`、3 条 `asset_tags` 后，菜单显示「清理迁移残留(9 项)…」。
- 经二次确认后，三张兜底表均为 0；`libraries`、`open_tabs`、`app_state` 保留。
- 库内数据库原有 11 条 `assets` 保持不变；残留为 0 时菜单项隐藏。
- 截图: `artifacts/menu-legacy-9.png`。

### 曝光持久化

- GLB 灯箱初始从 app_state 恢复曝光 1.45。
- 通过真实滑杆事件改为 1.30；完全退出并重启后，灯箱恢复 1.30。
- 复验结束后已将 app_state 恢复至验证前的 1.45。

## 新鲜自动化验证

- typecheck 通过。
- vitest 17/17 通过。
- production build 通过。
- `openspec validate instance-lock-and-polish --type change --strict` 通过。

## 工件与边界

- `artifacts/` 为未跟踪的本地验证工件，未纳入提交；其中 `mediahub-pre-legacy-verify.db` 是注入残留前的全局库快照。
- 本次只更新 change 记录与主规格，不删除测试，不扩展产品行为。

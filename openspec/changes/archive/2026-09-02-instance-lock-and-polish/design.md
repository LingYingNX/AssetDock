## Context

Change 5 已交付每库 `.mediahub/library.db`;并发实例会各自打开同一库文件(WAL 允许多进程,但"最后写者胜"的用户预期风险与文件锁竞争真实存在)。全局 userData 库在 Change 5 迁移后仅剩兜底数据。

## Goals / Non-Goals

**Goals:** 单实例约束、兜底数据卫生、曝光记忆。

**Non-Goals:** 多实例协作、完整设置面板、按素材记忆曝光。

## Decisions

1. **requestSingleInstanceLock(非宽锁)**:主进程最先执行;失败即 `app.quit()`;`second-instance` 事件里聚焦主窗(最小化则 restore)。
2. **残留清理:两个 IPC(统计/执行)+ 菜单条件项**。统计=全局兜底 assets 行数;执行=DELETE 兜底 assets/tags/asset_tags + WAL checkpoint,注册表(libraries/open_tabs/app_state)保留;菜单项文案带实时 N。
3. **曝光存全局 app_state(viewerExposure)**:Lightbox 初始化时读,onChange 写;不放库内(曝光是应用偏好而非素材数据)。

## Risks / Trade-offs

- [清理误删兜底] → 二重确认 + 注册表保留;真出事可由 Change 5 迁移器从库内 db 反向重建(不做自动反向,保持单向简单)
- [second-instance 聚焦在 Windows 最小化态] → restore + focus 组合处理

## Migration Plan

无数据迁移(app_state 新键即用)。

## Open Questions

(无。)

# Proposal

## Why

侧栏（左侧导航栏）是主界面的常驻导航，但它此前带有一个可折叠状态 `sideHidden`，并把该状态写进 `uiPrefs` 持久化。唯一入口是灯箱顶栏的「收起侧边栏」按钮：用户在灯箱里点一下收起，此后**每次启动应用**侧栏都是收起的，用户报「打开软件，左侧导航栏不见了」正是上一次会话残留的持久化收起态。侧栏消失后既没有可见入口（灯箱关闭后那个按钮也不在），也没有快捷键，只能去改偏好文件。

## What Changes

- 移除侧栏折叠这一整套能力：`store/ui.ts` 的 `sideHidden` 状态、`toggleSidebar` action、`UiPrefs.sideHidden` 持久化字段与恢复分支。
- `App.tsx` 的 `.layout` 不再拼接 `side-hidden` 类；`styles/sidebar.css` 删除 `.layout.side-hidden` 与 `.layout.side-hidden.insp-hidden` 两条列轨道规则，以及 `.layout.side-hidden .sidebar{visibility:hidden}`。
- `components/Lightbox.tsx` 删除顶栏的侧栏开关按钮（连同「收起侧栏时顺带退出全屏」的分支）。
- 旧库里残留的 `sideHidden: true` 被静默忽略（`restoreUiPrefs` 是白名单式 `setState`，未知键天然丢弃），不再影响启动布局。

## Capabilities

### Added Capabilities

- `asset-browser`: 新增「侧栏常驻」Requirement，即侧栏始终可见、任何视图都不提供收起入口、旧偏好里的收起态不生效。

## Impact

`src/renderer/src/store/ui.ts`、`src/renderer/src/App.tsx`、`src/renderer/src/components/Lightbox.tsx`、`src/renderer/src/styles/sidebar.css`。
不涉及主进程、IPC、数据库与数据格式；不新增依赖。

## 行为变更（破坏性）

- 灯箱顶栏的「收起 / 展开侧边栏」按钮不再存在（顶栏只剩关闭）；想扩大预览面积改走灯箱自身的全屏。
- `uiPrefs` 少写一个 `sideHidden` 字段；旧值读取时被忽略，不做迁移清理。

# Tasks

## 1. 移除折叠链路（store / 布局 / 样式）

- [x] 1.1 `src/renderer/src/store/ui.ts`：删除 `UiPrefs.sideHidden`、`persistUiPrefs` 的写入项、`restoreUiPrefs` 的恢复分支、`UIState` 的 `sideHidden` 字段与 `toggleSidebar` action 及其实现；验证：`npm run typecheck` exit 0
- [x] 1.2 `src/renderer/src/App.tsx:184` 的 `.layout` 模板串去掉 `sideHidden ? ' side-hidden' : ''`，并把注释从「折叠侧栏/检查器」改为只讲检查器；验证：dev 桥读 `document.querySelector('.layout').className` 为 `layout`
- [x] 1.3 `src/renderer/src/styles/sidebar.css`：删除 `.layout.side-hidden`、`.layout.side-hidden.insp-hidden` 两条列轨道规则与 `.layout.side-hidden .sidebar{visibility:hidden}`，并在文件头注释写明「侧栏不参与折叠:它是常驻导航,没有收起态,也不写进 uiPrefs」；验证：全树检索 `side-hidden` 无命中

## 2. 移除灯箱里的唯一入口

- [x] 2.1 `src/renderer/src/components/Lightbox.tsx`：删除顶栏的 `panel-l` 侧栏开关按钮（含 `fullscreen` 联动分支）与 `sideHidden` / `toggleSidebar` 两个 `useUI` 订阅；验证：`npm run typecheck` exit 0，`fullscreen` / `lightboxFullscreen` 仍被 `fsNow` 与 `toggleFullscreen` 消费，无未使用变量
- [x] 2.2 `Icons.tsx` 的 `i-panel-l` 定义保留（共享图标表，其余未使用图标同样保留）；验证：全树检索 `panel-l` 只剩该 symbol 定义一处

## 3. 验证

- [x] 3.1 类型检查：`npm run typecheck` exit 0（node + web 两侧）
- [x] 3.2 全量回归：`npm run test` 22 个文件 145/145 通过（与本 change 前基线一致）
- [x] 3.3 真实 UI 路径（dev 调试桥 `tools/hhead.mjs`）：读 `.layout` 类名、`.sidebar` 宽度与可见性，布局为 `236px 900px 304px`
- [x] 3.4 冷启动 + 旧偏好：先向 `app_state.uiPrefs` 写入含 `sideHidden:true` 的偏好（确认已落盘），再杀进程冷启动；启动后读到旧偏好仍在盘上，而界面为 `.layout`、侧栏宽 236px、`visibility: visible`、store 中已无 `sideHidden` 键。这正是用户报告的「重启软件后左侧导航栏不见了」路径

## 4. 收尾

- [x] 4.1 无遗留 debug 输出；一次性补丁/验证脚本已删除（`tools/.tmp-*.mjs`）

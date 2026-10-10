# Proposal

## Why

主题目前只写在 `<html data-theme>` 上,而设值发生在渲染层启动、异步 IPC 读回 `preferences` **之后**。窗口在 `ready-to-show` 时渲染层还没拿到主题,首帧只能按浅色令牌绘制—夜间用户每次启动都看到一次白闪。同一处时序缺陷还有第二张脸:偏好设置里夜间模式已勾选、界面却是浅色。启动路径上没有任何同步可读的偏好通道(preload 只提供异步 `invoke`),所以问题不是"读得晚",而是"首帧没有可读的记录";同时 `restoreUiPrefs()` 在 `uiPrefs` 为空时整段提前返回,连主题与音视频偏好一起跳过,异常还被 `catch` 静默吞掉。

## What Changes

- 新增渲染层 localStorage 主题镜像键 `mediahub.theme`,值为 `light` / `dark` 明文;在 `src/renderer/index.html` 的 `<head>` 内、模块脚本之前插入一段同步内联脚本,读镜像并在首帧前设置/移除根元素 `data-theme`。
- `src/renderer/index.html` 的 `<meta name="color-scheme">` 从 `light` 改为 `light dark`。
- 明确不改动主进程 `src/main/index.ts`:窗口 `transparent: true`,不透明底色会破坏 `html` 圆角裁剪,且 `show:false` + `ready-to-show` 不会露出首帧之前的底色(见 `design.md` 决定 6)。
- `src/renderer/src/data/theme.ts` 收敛为唯一的主题门面:导出同步读镜像、写镜像、从偏好 JSON 解析主题的纯函数;`applyTheme` 只负责外观与过渡,不写镜像(预览不得污染已保存主题)。
- 拆开 `src/renderer/src/store/ui.ts` 的 `restoreUiPrefs()`:主题引导不再受 `uiPrefs` 为空提前返回的影响,主题应用失败也不再连带吞掉 `hoverVideo` / `hoverSound` 的恢复。
- `src/renderer/src/components/PreferencesDialog.tsx` 关闭时的主题回滚改为同步回到已加载的基线值,去掉异步回滚竞态。

## Capabilities

### New Capabilities

- (无)

### Modified Capabilities

- `glass-theme`: 设计令牌与壁纸这条要求新增首帧约束(同步脚本在模块脚本之前落定主题、`color-scheme` 跟随实际主题);新增一条「主题持久化与首帧一致」要求,规定镜像键、`preferences` 权威与镜像的同步关系、损坏回退浅色。

## Impact

- 渲染层:`src/renderer/index.html`、`src/renderer/src/data/theme.ts`、`src/renderer/src/store/ui.ts`、`src/renderer/src/components/PreferencesDialog.tsx`。
- 主进程:无改动(见上一条)。
- 测试:新增 `tests/theme.test.ts` 覆盖镜像读写与偏好解析纯函数;`tests/uiStore.test.ts` 的 `load()` helper 需按 key 区分返回,否则 `restoreUiPrefs` 新增的按 key 读取会拿到错误字符串。React 组件与真实窗口不在套件范围,首帧行为按仓库约定经 9223 无头调试桥验证。
- 无新增依赖;`preferences` 键的 JSON 结构不变,无需数据库迁移。

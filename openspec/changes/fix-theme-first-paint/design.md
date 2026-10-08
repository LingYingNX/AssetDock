# Design

## Context

主题的取值来自三个地方,之前只有一个:`<html data-theme>`,由 `src/renderer/src/data/theme.ts` 的 `applyTheme()` 写入并带 View Transition 过渡。设值时机在渲染层启动、`restoreUiPrefs()` 异步读回 `preferences` 之后—也就是首次绘制**之后**。窗口是 `show:false` + `ready-to-show`(首次渲染完成才 `show()`),所以"首次渲染"就是用户看到的"打开软件的一瞬间";那一刻令牌还是浅色,夜间用户必然看到一次白闪。

偏好设置的第二个症状同源:面板打开时异步读 `preferences` 填 `draft`,关闭时 `void state.get(...).then((raw) => applyTheme(parseTheme(raw)))` 是**异步回滚**—面板已经关掉,迟到的值会覆盖用户随后的任何切换,于是"勾选夜间、外观白天"。此外 `restoreUiPrefs()` 在 `uiPrefs` 为空时 `if (!raw) return`,连主题与 `hoverVideo`/`hoverSound` 一起跳过。

## Goals / Non-Goals

- 目标:夜间用户启动的首个绘制帧就是夜间;主题单选与实际外观在任何操作序列下都一致;启动引导不再因一个键缺失而整体跳过。
- 非目标:改变主题的视觉配方、令牌或 View Transition 过渡(用户切换时的整窗交叉淡入保持原样);不迁移 `preferences` 的存储结构;不引入新的 IPC 或 preload 方法。

## Decisions

### 1. 首帧只有一个同步可读的通道:localStorage 镜像

渲染层启动前可同步读取的东西只有 `index.html` `<head>` 里的内联脚本 + Web Storage(preload 只暴露异步 `invoke`,IPC 到主进程查 SQLite 一定是异步的)。因此新增镜像键 `mediahub.theme`,值就是 `light` / `dark` 明文。`<head>` 里在模块脚本之前插入同步脚本:

```js
try {
  if (localStorage.getItem('mediahub.theme') === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark')
  }
} catch {}
```

它在文档解析期同步执行,先于任何绘制;窗口又只在首次渲染后 `show()`,所以第一个可见帧已带主题。脚本无法 import 模块,键名与取值靠 `src/renderer/src/data/theme.ts` 的 `THEME_MIRROR_KEY` 常量注释互指(一处注释、两行逻辑,不值得为它上构建期注入)。

`<meta name="color-scheme">` 同步改为 `light dark`:它别名为 `CSS color-scheme` 属性,写死 `light` 会让原生控件(滚动条、日期/下拉)在夜间仍是浅色。

### 2. `preferences` 仍是唯一权威,镜像只是缓存

新洞察:镜像与权威不可能在第一次启动时就一致(老用户 DB 里存着 `dark`,localStorage 里什么都没有)。所以规则不是"镜像优先",而是:

- 首帧用镜像(可能缺失—浅色);
- 启动引导读 `preferences`,用它校正外观**并回写镜像**;
- 此后除非用户改设置,镜像永远与权威一致。

代价是迁移窗口:老用户在新版本第一次启动仍会闪一次(镜像为空),之后永远不闪。**不引入哨兵默认值**(例如"镜像缺失时默认夜间"),因为那会把从没用过夜间的用户的第一帧变成深色,用一个更大的错误换掉一个小的。

### 3. 镜像的写入点只有两处,`applyTheme` 保持只负责外观

写入放在两处能"确立权威值"的位置:`restoreUiPrefs()` 启动校正(用 `preferences` 的值)与 `PreferencesDialog.save()` 写入成功后(用 `draft.theme`)。预览(切单选即时生效)与取消回滚都**不写**镜像—镜像记录的是已保存的主题,预览不是已保存状态;否则中途崩溃会留下"镜像说夜间、权威说浅色"的脏值(下次启动仍会被校正,但没必要制造它)。

拒绝的方案:`applyTheme` 里顺手写镜像(预览也写,脏值风险);把镜像改成存整个 `preferences` JSON 副本(读写都要 JSON 包装,失败面更大)。

### 4. 撤回异步回滚,改为同步回到基线

`PreferencesDialog` 用 `useRef<ThemeMode>` 记住已加载的 `preferences.theme`(打开面板读到时写一次、保存成功后写一次),`close()` 变成同步 `applyTheme(savedTheme.current); setOpenMenu(null)`,不再有迟到的 IPC 值。语义不变(取消—回到已保存主题),竞态消失。

### 5. `restoreUiPrefs()` 拆成三段,互不牵连

`uiPrefs` 与 `preferences` 用 `Promise.all` 并行取(两段一次读盘),各自独立解析:主题段失败不影响 `hoverVideo`/`hoverSound`,反之亦然;`uiPrefs` 缺失只跳过界面偏好,不再 `return` 掉整个函数。新增模块私有 `readState(key)` 返回 `{ value, failed }`,失败与缺失分开:`preferences` 读失败时保留首帧镜像与既有外观(否则读失败会被当成浅色,把有效的夜间首帧覆盖掉);`uiPrefs` 缺失只是"没存过",沿用默认值。

### 6. 明确不做的:主进程 `backgroundColor`

考虑过在 `createWindow()` 里按主题给 `backgroundColor: '#0E1218'`,理由是"比 CSS 更早的一层白闪"。实际上窗口 `transparent: true`,底色会填充 `html` 圆角裁剪之外的区域—换成不透明色会让圆角消失变成方角;而窗口 `show:false` + `ready-to-show` 本来就不显示首帧之前的画面,底色根本没有机会露出来。所以白闪的唯一来源是渲染层首帧令牌,修在渲染层就够了。主进程一行不改。

### 7. View Transition 启动失败时退回直接提交

`document.startViewTransition()` 在文档失去可用性或已有过渡在跑时会**同步抛错**;若让它冒泡,`applyTheme` 就不生效,外观停在旧主题而单选已切换正是"勾选夜间、外观白天"的形态。所以捕获它并退回 `commit()`:过渡是增强,不是主题生效的前提。`tests/theme.test.ts` 覆盖了这条路径。

## Migration & Rollout

- `preferences` 的 JSON 结构不变,无需数据库迁移;`mediahub.theme` 首次由启动引导写入。
- 旧用户(DB `dark`、镜像缺失)在新版本第一次启动闪一次,之后不再闪—已知且不可由镜像机制消除(见决定 2)。
- 本地 localStorage 可被用户清除(或换机),那时按决定 2 的路径重新校正一次。

## Testing & Verification

- 纯逻辑(镜像读写、偏好解析、非法值回退)在 `tests/theme.test.ts` 覆盖,用 `vi.stubGlobal` 伪造 `localStorage`;`restoreUiPrefs` 的键拆分在 `tests/uiStore.test.ts` 补一个按 key 返回的桩。
- React 组件与真实窗口不在测试范围(见 `tests/AGENTS.md`)。首帧行为按仓库约定经 dev 无头桥(`tools/hhead.mjs` → 127.0.0.1:9223)验证:`mediahub.theme` 的写入、重载后首帧令牌是否已为夜间、面板取消后单选与外观是否同步。9223 无头桥只能证明"状态正确",不能证明"没有出现过渡帧";`ready-to-show` 的语义(首次渲染后才显示)与脚本先于绘制的同步执行是"不闪白"的结构性依据,验证任务里如实标注为结构性论证 + 状态证据。
- 收尾:`npm run typecheck`、`npm run test` 全绿并贴出输出;无临时调试输出。

## Risks

- `preferences` 的读取失败时镜像不写—下次启动仍按旧镜像;已有回退(保持镜像/浅色),不阻塞启动。
- 内联脚本与 `theme.ts` 的键名双写:靠 `THEME_MIRROR_KEY` 旁的注释互指,并有 `tests/theme.test.ts` 锁住键名取值。

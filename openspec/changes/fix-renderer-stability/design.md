# Design

## Context

渲染层的现状与本次修复直接相关的约束，均以当前代码为准（动机见 `proposal.md`）。

- 状态层是单个 zustand store：`src/renderer/src/store/ui.ts`。组件普遍以无选择器或无稳定选择器的方式订阅整棵状态树，`src/renderer/src/App.tsx:23` 即 `const s = useUI()`。
- 记录转换集中在一处：`src/renderer/src/store/ui.ts:183` 附近 `palette: JSON.parse((r.palette as string) || '[]')`，位于把主进程行转换为界面对象的同一条路径上，任何一条记录里的非法 JSON 都会让整批加载抛出。
- 异步读库路径已有请求代次守卫，但缺少失败分支：`src/renderer/src/store/ui.ts:448-479` 的 `reloadActiveLibrary` 有 `++reloadSeq` 守卫、`:456` 只有 `.then` 没有 `.catch`；`src/renderer/src/store/ui.ts:492-507` 的 `refreshFolders` 同样无 `.catch`；`src/renderer/src/App.tsx:55-57` 的启动引导是空 `catch {}`。
- 推送式更新存在放大：`src/renderer/src/App.tsx:60` 把 `assets:changed` 直接接到 `reloadActiveLibrary()`，`:64-67` 把 `thumbs:progress` 直接写进 store 的每个进度事件都会触发一轮渲染。
- 刷选在 `src/renderer/src/components/Grid.tsx:83-128`：命中阈值 `THRESHOLD=4`；`:109` 每帧用 `wrapRef.current?.querySelectorAll('.card[data-asset-id]')` 加逐元素 `getBoundingClientRect()` 判定相交；收尾函数 `:121-127` 只摘除 `mousemove` 监听，未处理「窗口外松手」与「拖动期间网格卸载」。
- 破坏性操作无确认：`src/renderer/src/store/ui.ts:696-704` 的 `emptyTrash` / `purgeAsset` 直接发 IPC 并 `reloadActiveLibrary()`，`src/renderer/src/components/Grid.tsx:403-414` 的清空回收站按钮与 `src/renderer/src/components/ContextMenu.tsx:190` 的「彻底删除」都不问用户。仓库已有的二次确认范式是 `window.confirm`（`src/renderer/src/store/ui.ts:783`、`:788` 的 CSS 未保存提示），仓库没有通用 confirm 组件。
- 快捷键目前是全局 keydown 分发（`src/renderer/src/App.tsx:113-121` 处理灯箱方向键），未区分焦点是否位于可编辑控件。
- 三维释放已有骨架：`src/renderer/src/components/Viewer3D.tsx:226-245` 释放 `controls` / `envRT` / `pmrem` / `draco` / 几何体 / 材质 / 渲染器，并 `cancelAnimationFrame`、`ro.disconnect()`、`forceContextLoss()`；但材质只调用 `m.dispose()`，其 `map` / `normalMap` 等贴图未显式释放。
- 测试边界：`tests/AGENTS.md` 规定覆盖主进程纯逻辑与渲染层纯函数（`query.ts`、`folder-drag.ts`、`ui.ts` 的 `rowToAsset`），React 组件与真实 Electron 窗口不在 vitest 范围，那类走 9223 无头调试桥；`vi.mock` 仅允许在 `cssThumb.test.ts` 使用，其余用 `vi.stubGlobal` 注入。
- 约束：不新增第三方依赖；样式改动只用 `tokens.css` 的 `--sheen-*` / `--surface` / `--dur-*` 令牌；渲染层不直接读盘。

## Goals / Non-Goals

**Goals:**

- 让渲染层的更新成本与「实际发生变化的界面部分」相关，而不是与「整棵状态树」相关。
- 让任何一条损坏记录、任何一次失败的 IPC 都有确定的、可见的、可恢复的表现。
- 让刷选在异常收尾路径（窗口外松手、拖动取消、网格卸载）下不残留监听与逐帧几何测量。
- 让回收站的两条不可逆操作在发出 IPC 之前必须经过用户确认。
- 补全三维释放中被遗漏的贴图与环境贴图资源。

**Non-Goals:**

- 不改动主进程的服务边界与 IPC 通道语义（除清空回收站在渲染层的确认前置）。
- 不引入状态管理库、虚拟化库、动画库或确认框组件的第三方替代品。
- 不重写 `asset-browser` 的刷选交互模型（矩形选区语义保持原样，只补收尾与清理）。
- 不为 P2/P3 缺陷立项；它们另开 change。

## Decisions

### D1：订阅粒度按「读什么订什么」收敛，而不是把状态树切碎

把宽订阅改为按需选择器：只读动作（actions）的组件用稳定的动作选择器（`useUI((s) => s.someAction)`），只读字段的组件订到具体字段或该字段派生的原始值。选择器必须返回原始值或稳定引用；需要派生集合时用 `useShallow` 之类的浅比较，或在 store 外用 memo 派生。

**备选**：(a) 拆成多个 store —— 会打散当前集中于 `ui.ts` 的持久化与加载逻辑，回滚成本高；(b) 全面引入 `useSyncExternalStore` 手写订阅 —— 对 22 个组件的收益不足以抵消改造成本。选择选择器收敛，因为它是可逐文件推进的、行为等价的重构。

### D2：选择集判定从「每次全量比较」改为 O(1) 命中

把选中判定从「对选中数组做线性查找 / 每次渲染构造 Set」改为在 store 中维护一个随选中集同步的 `Set`（或等价索引），卡片与工具栏读取它并只订阅自身是否在集合内。

**备选**：在组件内 `useMemo` 构造 Set —— 每次选中变化仍会让所有订阅了选中集的卡片重算；维护在 store 里只让真正的成员变化触发更新。

### D3：卡片媒体加载按视口活跃度分层

网格卡片只在「进入视口且可见」时请求缩略图，离屏卡片保留占位底；缩略图请求沿用现有 `?thumb=1` 约定与 `media://` 协议，不新增缓存层。

**备选**：预加载全部缩略图 —— 在千级素材库下会产生大量并发请求；延后到空闲再加载虽然平滑，但会让快速滚动出现空窗。分层策略是这两者的折中。

### D4：推送式事件合并到帧边界

`assets:changed` 与 `thumbs:progress` 的处理器改为「标记待处理 + 在下一帧（或一个短窗口）内合并为一次」的形式：`assets:changed` 合并为一次重载，`thumbs:progress` 合并为一次进度快照写入。

**备选**：在 store 内部对动作做去抖 —— 会把行为差异藏进 `ui.ts`，且不同调用点需要不同的合并窗口；在事件入口合并，改动集中在 `App.tsx` 的订阅处，且不改变 store 的语义。

### D5：容错放在数据进入界面的唯一入口

`palette` 等可选字段的解析改为「失败降级为空值」的安全解析，并对非数组/空值归一到空数组。放这里而不是每个消费点，因为 `src/renderer/src/store/ui.ts:183` 是主进程行进入界面对象的唯一路径。

**备选**：在主进程侧清洗 —— 主进程返回的是数据库原文，清洗会让「损坏数据」永久不可见；在渲染层降级能保留原始字段供后续排查。

### D6：失败可见性统一为「提示 + 回读真实状态」

所有渲染层发出的库/目录/破坏性操作请求补 `.catch`：给出可见提示（复用已有 toast 通路），并触发一次回读（`reloadActiveLibrary()` / `refreshFolders()`），使界面与磁盘一致。启动引导的失败改为「进入明确空状态 + 可读反馈」，不再空 `catch`。

**备选**：只在 toast 里报错、不回读 —— 乐观更新过的名称/位置会留在界面上与磁盘不符。回读是可接受的开销，因为这些路径本身已经是变更路径。

### D7：破坏性确认沿用仓库既有的 `window.confirm` 范式，不新建组件

`emptyTrash` 与 `purgeAsset` 在发 IPC 前调用 `window.confirm`，文案包含受影响记录数与「只清记录与缩略图缓存、不动磁盘原文件」。这与 `src/renderer/src/store/ui.ts:783` / `:788` 的既有用法一致，且不需要新组件、新样式或新令牌。

**备选**：新建通用 confirm 组件并复用 `PreferencesDialog.tsx:389` / `:423` 的 `role="dialog"` 范式 —— 视觉更统一，但要新增组件、样式、焦点陷阱与无障碍处理，属于超出本次修复范围的重构；留待后续 change。

### D8：快捷键按焦点作用域分流，保留输入语义

全局 keydown 分发前先判断事件目标是否为可编辑控件（`input` / `textarea` / `contenteditable`）或处于模态对话框内：若在可编辑上下文，只有 Ctrl F 与 Esc 继续生效，其余动作（方向键、Enter、Space、Del）不拦截，交由控件处理。

**备选**：把快捷键实现为具名 `data-` 作用域 —— 会散落到各组件；集中在一个分发点上判断焦点类型，改动集中且可测。

### D9：三维释放补全贴图与环境贴图，不改变既有骨架

在 `src/renderer/src/components/Viewer3D.tsx:234-239` 的遍历中，对每个材质先枚举其贴图槽位逐一 `dispose()`，再 `dispose()` 材质本身；保持现有的 `envRT.dispose()`、`pmrem.dispose()`、`cancelAnimationFrame`、`ro.disconnect()`、`forceClientLoss` 顺序不变。判定依据是 `window.__threeStats` 的挂载/释放计数与 GPU 内存回落。

**备选**：改为在重新打开时复用渲染器 —— 与 `viewer-3d` 现有「资源释放」需求相冲突，且会让曝光以外的状态跨素材泄漏。

### D10：可测性优先——把能纯函数化的逻辑从组件里挪出来

刷选的相交判定、进度合并的调度、可编辑上下文判断等，抽成可被 vitest 直接 import 的纯函数或小模块，组件只负责连线。这样新增测试落在 `tests/` 顶层、用 `../src/...` 导入，符合 `tests/AGENTS.md` 的边界；组件级行为（真实窗口、真实协议、真实 GPU）继续走 9223 无头桥验证。

**备选**：用 React Testing Library 测组件 —— 本项目未安装该依赖，且 `tests/AGENTS.md` 明确把 React 组件排除在范围外。

## Risks / Trade-offs

- [订阅粒度重构面广、易引入「不更新」类回归] → 按文件小步推进，每个文件改完即跑 `npm run typecheck` 与 `npm run test`；对关键交互（选中、缩放、视图切换、进度浮层）在 9223 无头桥上逐项复验。
- [选择集索引与既有选中数组出现双份真相] → 让二者在同一动作内原子更新，并补一个纯函数测试断言「任意动作序列后索引与数组一致」。
- [分层加载在极快滚动时出现缩略图空窗] → 保留占位底与既有淡入过渡；空窗只影响观感，不影响选中与打开。
- [帧合并会让极短促的进度更新被丢弃] → 合并的是「同帧内的多次写入」，最后一次快照始终写回；以「最终值正确」而不是「每次中间值都渲染」作为验收口径。
- [`window.confirm` 是阻塞式原生对话框，在无头桥与自动化下难以断言] → 把它当作纯粹的调用点：单元测试断言「取消时不发出 IPC」，确认框本身的视觉归 9223 手动复验。
- [补全贴图释放后，同一素材的重复开关可能出现纹理重上传的开销] → 这是正确性与内存占用的取舍，`viewer-3d` 的验收口径是「不持续增长」而非「零重传」。
- [容错降级会掩盖上游损坏数据] → 降级只作用于界面对象，数据库原文与主进程日志保持原样；如后续需要体检能力，另开 change。
- [失败提示在批量失败时可能连发多条 toast] → 在提示通路上去重（同源同文案在一小段时间内合并为一条）。

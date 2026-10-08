# Tasks

> 约定:每个任务点给出完成判据与验证方式;测试只写一层(纯逻辑走 vitest,React 组件与真实窗口走 9223 无头桥)。改完贴出 `npm run typecheck` 与 `npm run test` 输出。

## 1. 主题门面:镜像读写与偏好解析(`src/renderer/src/data/theme.ts`)

- [x] 1.1 新增 `export const THEME_MIRROR_KEY = 'mediahub.theme'`,并在其上方注释说明它与 `src/renderer/index.html` 内联脚本的键名互指关系(内联脚本读不到模块)
- [x] 1.2 新增 `export function readMirroredTheme(): ThemeMode`:读 `localStorage.getItem(THEME_MIRROR_KEY)`,仅在等于 `'dark'` 时返回 `'dark'`,其余(含 `null`)返回 `'light'`;整体 try/catch,存储不可用时不抛错
- [x] 1.3 新增 `export function writeMirroredTheme(mode: ThemeMode): void`:写入明文 `'dark'` / `'light'`;try/catch 吞错(镜像写失败不得影响外观)
- [x] 1.4 主题解析统一由 `parseTheme(prefsRaw)` 承担(未新增 `parseStoredTheme` 别名,避免两套名字漂移);非法/空回退浅色
- [x] 1.5 `applyTheme(mode)` 内部保持只负责外观(属性 + View Transition),不写镜像;`currentTheme()` / `booted` 语义不变
- 验证:`npm run typecheck` 通过;`tests/theme.test.ts` 覆盖 1.21.4(见任务 5)

## 2. 首帧同步预设(`src/renderer/index.html`)

- [x] 2.1 在 `<head>` 内、`<script type="module" src="/src/main.tsx">` **之前**插入内联同步脚本(不可 `defer`/`async`),读 `mediahub.theme` 并在为 `dark` 时 `document.documentElement.setAttribute('data-theme','dark')`;浅色不写属性
- [x] 2.2 脚本整体包 try/catch(存储被禁用/为 null 时静默跳过)
- [x] 2.3 `<meta name="color-scheme">` 改为 `content="light dark"`;产物 `out/renderer/index.html` 中内联脚本位于哈希后的 module script 之前
- 验证:`npm run dev` 后经 `tools/hhead.mjs` 确认重载页面时 `document.documentElement.getAttribute('data-theme')` 在渲染层启动前后一致(需先经任务 3 让镜像有值);`npm run build` 产物中确认 `out/renderer/index.html` 含该脚本且顺序在模块脚本之前

## 3. 启动引导拆分与镜像回写(`src/renderer/src/store/ui.ts`)

- [x] 3.1 新增模块私有 `readState(key)`;分别记录 IPC 缺失与读取失败,失败时保留首帧镜像
- [x] 3.2 `restoreUiPrefs()` 并行读取 `uiPrefs` 与 `preferences`;缺少 uiPrefs 只跳过界面偏好,主题恢复继续执行
- [x] 3.3 preferences 有效读取后解析主题,应用到 DOM 并回写镜像;主题错误不阻断音视频偏好恢复
- [x] 3.4 音视频偏好独立恢复,保留 hoverVideo / hoverSound 的既有默认回退语义
- 验证:`npm run typecheck` 通过;`npm run test -- tests/uiStore.test.ts` 通过(含任务 5.2 的键拆分用例)

## 4. 偏好设置面板(`src/renderer/src/components/PreferencesDialog.tsx`)

- [x] 4.1 新增 `const savedTheme = useRef<ThemeMode>('light')`;打开面板读到 `preferences` 后写入该 ref(与 `setDraft` 同一处)
- [x] 4.2 `close()` 改为同步 `applyTheme(savedTheme.current); setOpenMenu(null)`,删除 `void window.windowApi.state.get(...).then((raw) => applyTheme(parseTheme(raw)))` 的异步回滚
- [x] 4.3 `save()` 成功后:更新 `savedTheme.current = draft.theme`、`writeMirroredTheme(draft.theme)`,再调 `close()`
- [x] 4.4 预览 effect(`[open, draft.theme]`)保持只调 `applyTheme`,不写镜像
- 验证:纯逻辑无新增测试(React 组件不在套件范围);手动/无头验证见任务 6

## 5. 测试(`tests/`)

- [x] 5.1 新增 `tests/theme.test.ts`:镜像读写(无值/`dark`/非法值/getItem 抛错)、写入键名、`parseTheme` 边界(null/非 JSON/`dark`/`light`/未知值)、`applyTheme` 在 View Transition 抛错时仍提交
- [x] 5.2 更新 `tests/uiStore.test.ts`:`load()` / `loadNav()` 的 `state.get` 桩按 key 返回(`UI_PREFS_KEY` 与 `PREFERENCES_KEY` 各自的值),否则 `restoreUiPrefs` 的键拆分会让新老用例拿到错误数据;新增一条「`uiPrefs` 缺失时仍应用 `preferences` 的主题与音视频偏好」用例
- [x] 5.3 确认没有为通过而放宽/删除既有断言(尤其 `restoreUiPrefs` 的 4 条字段校验用例与 `colw 9999—320`)
- 验证:`npm run test -- tests/theme.test.ts tests/uiStore.test.ts` 通过

## 6. 验证与收尾

- [x] 6.1 `npm run typecheck` 通过(贴出输出)
- [x] 6.2 `npm run test` 全绿(贴出输出与用例数)
- [x] 6.3 无头验证:取消预览恢复已保存主题;保存 light/dark 后 preferences、镜像和实际外观一致;重载后权威值校正镜像
- [x] 6.4 结构性依据:内联同步脚本位于首个 module script 前;BrowserWindow 仅在 ready-to-show 后显示。无头桥只能证明状态,不能证明无过渡帧
- [x] 6.5 清理本任务生成的临时补丁脚本与调试日志,`git status` 仅含预期源码、测试及 OpenSpec 文件
- [ ] 6.6 `openspec validate fix-theme-first-paint` 通过;任务全部完成后提示用户归档该 change

## 7. 明确不做

- [x] 7.1 按 design 决策不改 `src/main/index.ts` 的窗口背景色
- [x] 7.2 未改 preferences JSON 结构,未新增 IPC / preload 方法,未引入哨兵默认值

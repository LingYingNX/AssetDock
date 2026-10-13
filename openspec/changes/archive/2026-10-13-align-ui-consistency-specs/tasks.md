# Tasks

## 1. 代码对齐（本 change 唯一的实现改动）

- [x] 1.1 把 `src/renderer/src/components/Inspector.tsx:129` 的 `placeholder="输入标签,Enter 添加"` 改为全角逗号 `placeholder="输入标签，Enter 添加"`；用 `rg -n "输入标签" src tests` 确认代码侧只剩全角一处、`openspec/specs/inspector/spec.md:8` 的旧半角文本此时尚未变（归档时才更新），并在 `npm run dev` 里打开检查器目视确认占位文本显示为全角。
  - 已改；`rg 输入标签` 在 `src/` 下只命中 `Inspector.tsx:129` 全角一处，`tests/` 零命中；主 spec `openspec/specs/inspector/spec.md:8` 仍是半角（待归档替换）。
  - dev 实例用调试桥取值核对：`placeholder="输入标签，Enter 添加"`，码点序列 `... 7b7e ff0c 45 6e 74 65 72 20 ...`，`commaIsFullWidth: true` / `commaIsHalfWidth: false`，`.tagin` 计算高 28px（= `--h-sm`）。

## 2. 规格 delta 自检（归档前必须成立）

- [x] 2.1 确认 `openspec/changes/align-ui-consistency-specs/specs/` 下四个 delta 文件的 requirement 头与主 spec 逐字一致（`glass-theme` 走 ADDED，其余三个走 MODIFIED）；用 `openspec validate align-ui-consistency-specs --strict` 验证，期望 `valid: true` 且无描述长度告警。
  - `openspec validate align-ui-consistency-specs --strict --json` → `valid: true`、`issues: []`、passed 1 / failed 0。普通模式同样 `valid: true`。
- [x] 2.2 确认 `asset-browser` delta 的三条 MODIFIED 都整块复制了原 requirement（含全部原有 scenario，未丢场景、未改 scenario 名称）；用 `openspec show align-ui-consistency-specs --type change` 对比主 spec `openspec/specs/asset-browser/spec.md`，逐条核对 header 文本与场景数量只增不减。
  - delta 只有 `## MODIFIED Requirements`，三条 header 与主 spec 逐字一致：`筛选条` / `三视图切换` / `素材卡片`。
  - 「筛选条」原 2 场景（拖动缩放滑块、按 CSS 格式筛选）+ 新 1（筛选组与计数各自成组）= 3；「三视图切换」原 2（切换到列表视图、瀑布流列内定位与卡片一致）+ 新 1（网格视图容器比例不随素材变化）= 3；「素材卡片」原 11 场景全在 + 新 1（界内比例仍按 cover 裁切）= 12。场景名无一改动，主 spec 49 场景未被触碰。
- [x] 2.3 确认 `inspector` delta 的「面板结构与内容」整块保留了原 scenario「查看三维素材」，并新增「首块与后续块以分隔线分界」「标签输入框占位文本标点」两条；用 `openspec show align-ui-consistency-specs --type change` 目视核对。
  - 命中 `## MODIFIED Requirements` 下唯一 requirement `面板结构与内容`，场景 = 查看三维素材（原有，保留）/ 首块与后续块以分隔线分界（新）/ 标签输入框占位文本标点（新）。
- [x] 2.4 确认 `menus-shortcuts` delta 只改「下拉菜单」这一条 requirement，整块保留其原有两条 scenario（格式筛选互斥 / 关闭菜单），并新增三条分组相关 scenario（格式下拉按类型分组 / 分组标题不可点且不参与互斥 / 分组标题与选项左对齐）；「右键菜单」「全局键盘快捷键」两条 requirement 不得出现在 delta 里。用 `rg -n "^### Requirement:" openspec/changes/align-ui-consistency-specs/specs/menus-shortcuts/spec.md` 核对只命中一条。
  - 只命中 `5: ### Requirement: 下拉菜单`；场景 5 条 = 格式筛选互斥 / 关闭菜单（原有）+ 格式下拉按类型分组 / 分组标题不可点且不参与互斥 / 分组标题与选项左对齐（新）。「右键菜单」「全局键盘快捷键」未出现。
- [x] 2.5 确认 `glass-theme` delta 只含 ADDED（三条新 requirement：控件级尺寸阶梯 / 分隔线令牌 / 共享视觉常量唯一真源），未出现 `## Purpose` 段落（既有 capability 的 delta 不得带 Purpose）；用 `rg -n "^## " openspec/changes/align-ui-consistency-specs/specs/glass-theme/spec.md` 核对。
  - 只命中 `3: ## ADDED Requirements`，无 `## Purpose`；三条 requirement 与 5 条场景（菜单行高与字号跨组件一致 / 同层图标尺寸同档 / 夜间菜单分组仍可辨 / 两处彩虹色带起点一致 / 未选中星不比选中星更重）。

## 3. 与实现的交叉核对（防止 delta 写了代码没做的事）

- [x] 3.1 逐条核对 `glass-theme` delta 列出的令牌在 `src/renderer/src/styles/tokens.css` 中真实存在且取值一致：`--r-xs` 4px / `--r-sm` 6px / `--r-md` 8px / `--r-pill` 11px；`--h-xs` 24px / `--h-sm` 28px / `--h-md` 32px / `--h-bar` 42px；`--ic-xs` 12px / `--ic-sm` 14px / `--ic-md` 16px / `--ic-lg` 20px / `--ic-xl` 30px；`--fs-micro` 10.5px / `--fs-cap` 11px / `--fs-body` 12.5px / `--fs-sub` 13px / `--fs-title` 14px；`--sep` 浅色 `rgba(18,26,22,.12)` / 夜间 `rgba(255,255,255,.16)`；`--star-off` 浅色 `rgba(18,26,22,.26)` / 夜间 `#3D4454`；`--grad-rainbow` 起点 `#F1616D`。用 `rg -n -- "--r-xs|--h-xs|--ic-xs|--fs-micro|--sep|--star-off|--grad-rainbow" src/renderer/src/styles/tokens.css` 取全部定义行核对。
  - 全部逐条命中且取值一致：`tokens.css:19-22`（r-xs/sm/md/pill）、`:24-27`（h-xs/sm/md/bar）、`:29`（ic 5 档）、`:32`（fs 5 档）、`:35`（grad-rainbow 起点 `#F1616D`）、`:60` 与 `:86`（--sep 浅/夜）、`:7` 与 `:78`（--star-off 浅 `rgba(18,26,22,.26)`/夜 `#3D4454`）。
- [x] 3.2 核对超宽素材例外在代码中的两条落点：`src/renderer/src/components/Card.tsx` 里以 `rawAr > MAX_THUMB_AR` 且 `view !== 'list'` 判定并追加 `uw` 类；`src/renderer/src/styles/grid.css` 里存在 `.thumb.uw img,.thumb.uw video{object-fit:contain}`。用 `rg -n "ultraWide|uw" src/renderer/src/components/Card.tsx src/renderer/src/styles/grid.css` 核对，并确认 `MAX_THUMB_AR` 来自 `src/renderer/src/data/thumb-ratio.ts:20-21`。
  - `Card.tsx:5` import 自 `../data/thumb-ratio`；`:72` `const rawAr = a.width && a.height ? a.width / a.height : undefined`；`:73` `const ultraWide = view !== 'list' && rawAr != null && rawAr > MAX_THUMB_AR`；`:161` 追加 `uw` 类。`grid.css:47` `.thumb.uw img,.thumb.uw video{object-fit:contain}`。`thumb-ratio.ts:20-21` `MIN_THUMB_AR = 1/2` / `MAX_THUMB_AR = 21/9`。
- [x] 3.3 核对筛选条分隔线在代码中的落点：`src/renderer/src/components/FilterBar.tsx` 存在 `<span className="vr vr-lead" />` 且位于五个筛选下拉之后、`.fresult` 之前；`src/renderer/src/styles/content.css` 中 `.filterbar .vr-lead{margin-left:auto}` 且 `.fresult` 本身不再带 `margin-left:auto`。用 `rg -n "vr-lead|fresult" src/renderer/src/components/FilterBar.tsx src/renderer/src/styles/content.css` 核对。
  - `FilterBar.tsx:135` `<span className="vr vr-lead" />`，在 `:134` 的注释之后、`:136` `<span className="fresult">` 之前，五个筛选下拉在其上方。`content.css:50` `.filterbar .vr-lead{margin-left:auto}`；`:47` `.fresult{font-size:var(--fs-cap);color:var(--t3)}` 无 margin-left。
- [x] 3.4 核对检查器分块在代码中的落点：`src/renderer/src/components/Inspector.tsx` 首块为 `className="insp-sec insp-id"`，评分块带 `<div className="insp-h"><Icon name="star" />评分与状态</div>`；`src/renderer/src/styles/inspector.css` 有 `.insp-id{padding-bottom:14px;border-bottom:1px solid var(--sep)}` 与 `.flagrow .flagbtn{margin-left:auto}`。用 `rg -n "insp-id|flagrow" src/renderer/src/components/Inspector.tsx src/renderer/src/styles/inspector.css` 核对。
  - `Inspector.tsx:53` `className="insp-sec insp-id"`；`:81` `.insp-h` + `<Icon name="star" />评分与状态`；`:82` `<div className="flagrow">`。`inspector.css:10` `.insp-id{padding-bottom:14px;border-bottom:1px solid var(--sep)}`；`:26` `.flagrow{display:flex;align-items:center;gap:6px}`；`:29` `.flagrow .flagbtn{margin-left:auto}`。
- [x] 3.5 核对菜单分组在代码中的落点：`src/renderer/src/components/Dropdown.tsx` 的 `MenuItem` 接口含 `heading?: string` 且渲染出 `<div className="menu-head">`；`src/renderer/src/styles/menu.css` 有 `.menu .menu-head` 与 `.menu.pick-menu .menu-head{padding-left:10px}`；`src/renderer/src/components/FilterBar.tsx` 的 `FORMAT_ITEMS` 里四个 `heading` 依次为 图片 / 视频 / 三维 / 代码，且 label 已统一为纯扩展名（`PSD / AI`，无「源文件」）。用 `rg -n "heading|menu-head|FORMAT_ITEMS" src/renderer/src/components/Dropdown.tsx src/renderer/src/components/FilterBar.tsx src/renderer/src/styles/menu.css` 核对。
  - `Dropdown.tsx:17` `heading?: string`；`:118` `{it.heading ? <div className="menu-head">{it.heading}</div> : null}`。`menu.css:29` `.menu .menu-head{padding:8px 9px 4px;font-size:var(--fs-cap);font-weight:600;letter-spacing:.05em;color:var(--t3)}`；`:76` `.menu.pick-menu .menu-head{padding-left:10px}`。`FilterBar.tsx:14/17/18/21` 四个 heading 依次 图片 / 视频 / 三维 / 代码；`:15` `{ id: 'psd-ai', label: 'PSD / AI' }`（无「源文件」）。

## 4. 回归验证

- [x] 4.1 运行 `npm run typecheck`，期望 exit 0 且输出无 `error TS`（本次改动只涉及一个字符串字面量，仍需实跑取真实输出）。
  - 已跑：`typecheck:node` 与 `typecheck:web` 两条 `tsc --noEmit` 均无输出即通过，无 `error TS`；stderr 只有 npm 的 `better_sqlite3_binary_host_mirror` / `sharp_libvips_binary_host_mirror` 配置告警，与本次改动无关。
- [x] 4.2 运行 `npm test`，期望 `Test Files 28 passed (28)` / `Tests 193 passed (193)`；若出现 `Assertion failed: (env) != nullptr` 这类 Vitest 工作进程原生层断言（项目带 better-sqlite3 / sharp，此前出现过一次且未复现），重跑一次并如实记录两次结果，不得以"重跑通过"掩盖首次失败。
  - **第一次（失败）**：`Test Files 27 passed (28)` / `Tests 179 passed (193)` / `Errors 1 error` / exit 1。错误为 vitest pool 的 `Worker forks emitted error` → `Caused by: Error: Worker exited unexpectedly`（`cli-api.CnMVyzaz.js:3090/3092` 的 `ChildProcess.emitUnexpectedExit`），未打印具体用例名，与代码改动无关的原生层崩溃。
  - **第二次（通过）**：`Test Files 28 passed (28)` / `Tests 193 passed (193)`，Duration 2.58s。
  - 结论：该失败与本次改动（单个 placeholder 字符串字面量）无因果关系，属此前已记录过一次的 Vitest 工作进程原生层抖动；**未定位到具体文件、未能稳定复现**。
- [x] 4.3 运行 `npm run build`，期望构建成功且 `out/renderer/assets/` 下产出 CSS 产物无解析错误；记录产物的尺寸哈希行作为凭据。
  - 构建成功。凭据行：`../../out/renderer/assets/index-D5NP5yCH.css  77.25 kB`、`../../out/renderer/assets/index-DTcmUYyC.js  2,050.71 kB`、`✓ built in 2.70s`。仅有两条既有 vite 分块提示（`src/main/services/palette.ts`、`src/renderer/src/data/theme.ts` 的动态/静态双重导入），无 CSS 解析错误。
- [x] 4.4 汇总未验证项：明确写出「未做像素级截图比对（dev 实例无 CDP 端口，只有 DOM/计算样式真值）」，以及本 change 未触及的既有差异（网格 4:3 容器几何、主界面 12.5px 与偏好设置 13px 两套密度）。
  - 未验证（明确披露）：① 未做像素级截图比对——dev 实例只暴露 `127.0.0.1:9223` 的表达式执行桥（`webContents.executeJavaScript`），无 CDP 端口，因此只有 DOM 属性与计算样式真值，没有像素证据；② `npm test` 出现过一次工作进程原生层崩溃（见 4.2），未定位、未复现。
  - 本 change 未触及的既有差异（有意保留）：① 网格视图 4:3 容器几何——`Grid.tsx:273` `rowH = Math.round((colw * 3) / 4) + CAPTION_H` 与 `grid.css:8` `.v-grid .thumb{aspect-ratio:4/3}` 保持原样，本 change 只把「容器几何」与「容器内填充」的管辖范围写进 spec；② 主界面 12.5px（`--fs-body`）与偏好设置 13px（`--fs-sub`）两套密度，作为既有设计决定保留，需另开 change 才能动。

## Workflow follow-up

- 归档：`openspec archive align-ui-consistency-specs`，归档后确认四条 delta 已合入对应主 spec 且场景数只增不减。
- 归档后复核 `openspec/specs/inspector/spec.md:8` 的 placeholder 已随 delta 变为全角，与 `Inspector.tsx` 保持一致。
- 遗留（不在本 change 范围，需另开 change 才能动）：主界面 12.5px / 偏好设置 13px 两套密度的取舍；网格视图超宽素材是否放宽单元格宽度。

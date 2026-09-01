## Context

仓库为空(git 已初始化,无代码)。设计规格 `C:\Users\LYNX\Desktop\素材管理器设计规格.md` 为唯一权威设计源,HTML 设计稿(1312 行,静态 mock)仅作视觉参照。平台 Windows 优先,Electron 已由用户选定。Node 24 / npm 11 可用。

## Goals / Non-Goals

**Goals:**

- 可运行的 Electron 桌面应用,dev 模式一键启动,视觉与交互逐项对齐规格第 12 节验收清单
- 组件化复刻:设计稿一次性 HTML 拆分为可维护的 React 组件树 + 原生 CSS(令牌照抄规格第 2 节)
- mock 数据层抽象成单一数据源模块,后续 change 替换为 SQLite 时 UI 不动

**Non-Goals:**

- 真实文件扫描、缩略图生成、调色板提取(用预置 mock palette 代替)
- SQLite 持久化、文件监听、库的真实目录绑定
- three.js 真实 3D 渲染(用 CSS 立方体)、打包分发(electron-builder 配置留到后续)
- 批量操作条、库存储统计、路径面包屑、状态栏等规格明确不做项

## Decisions

1. **构建脚手架:electron-vite + React + TypeScript**(非 CRA/Vite 手拼)
   - 官方维护、开箱含 main/preload/renderer 三段构建与 HMR;替代方案 electron-forge(模板陈旧)或手动 Vite(配置重复)。CSS 用原生 CSS 文件 + CSS 变量,不引 Tailwind——规格令牌是手写 CSS 形态,照抄最保真。

2. **窗口:BrowserWindow frame:false + preload IPC**
   - `minimize/maximize/close` 三个动作经 contextBridge 暴露;标题栏区域加 `-webkit-app-region: drag`,交互控件 `no-drag`。替代方案 titleBarStyle: hidden + titleBarOverlay——Windows 原生 overlay 与 42px 玻璃标题栏融合差,弃用。

3. **状态管理:zustand**
   - 选中集、视图模式、色带开关、检查器显隐、库标签、菜单开关均为跨组件 UI 态,体量小;替代 Redux(过重)与 Context 手搓(重渲染面大)。

4. **图标:lucide-static 内联 SVG symbol**
   - 与设计稿内置 50+ symbol 同源同风格(1.7px 描边圆头),构建时注入一次 `<defs>`,运行时 `<use href="#i-xxx">`,与设计稿用法一致。

5. **数据:本地测试素材快照 + 合成条目(规格第 8 节 Asset 接口)**
   - 真实主源:`素材/` 目录 3 个文件(2 JPG + 1 MP4)的探测元数据(大小/尺寸/时间)烘焙为静态 TS 数据;再补自拟合成条目覆盖全部格式与视图状态。图片/视频在 dev 经 vite `/@fs/` 静态服务预览,渐变占位兜底。数据模块按"查询函数"组织(按侧栏/筛选过滤),Change 2 换 SQLite 实现时 UI 不动。侧栏计数与结果统计由数据集实时计算(替代设计稿演示数字,用户已确认不复刻演示素材区)。

6. **玻璃配方落地:全局 CSS 类 + 每面板基底透明度变量**
   - 高光渐变/backdrop-filter 双声明/边框/inset 高光抽成 `.glass-panel` 基类,面板仅覆写基底 alpha(.24~.36);liquid-lens 滤镜在 App 根组件注册一次。卡片用独立 `.glass-card`(blur 18,无滤镜)。

7. **键盘与菜单:单一全局 keydown 处理 + 受控菜单组件**
   - 快捷键集中在 renderer 顶层监听,依焦点上下文(灯箱/菜单/网格)分派;菜单为 portal + fixed 定位组件,右键菜单计算光标位置并按视口边界翻转。

## Risks / Trade-offs

- [backdrop-filter url(#liquid-lens) 在部分 Chromium 版本位移过强导致文字发虚] → 严格按规格参数(baseFrequency 0.009 0.014 / scale 60),只挂 7 处大面板;发虚时把滤镜层与内容层分离(滤镜只作用于背景层)。
- [CSS 立方体与 700ms 缩略图缓放在低端机掉帧] → 卡片不挂折射滤镜(规格 3.3 已约束);reduced-motion 全局关动画兜底。
- [mock 数据与未来 SQLite 查询行为不一致导致返工] → mock 模块按"查询函数"而非"静态数组"组织,Change 2 只换实现。
- [无边框窗口在 Windows 最大化时遮挡任务栏或双击标题栏不还原] → 主进程禁用系统边框处理,拖拽交给 -webkit-app-region,最大化走 IPC `maximize/unmaximize` 切换。
- [lucide-static 与设计稿个别 symbol 不完全同名] → 缺失图标以设计稿内联 path 为准补录,不强行改名。

## Open Questions

(无——本阶段全部行为已由规格钉死;灯箱末张切换行为规格留白,实现取"停在最后",任务中固定。)

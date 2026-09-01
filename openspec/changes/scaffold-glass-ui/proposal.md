## Why

MediaHub 素材管理器目前只有一份静态 HTML 设计稿。第一个里程碑先把 Electron 壳与整套液态玻璃 UI 用 mock 数据复刻为可运行桌面应用,让视觉与交互先得到验证,再接入真实数据管线。

## What Changes

- 新建 electron-vite + React + TypeScript 脚手架(main / preload / renderer 三进程结构)
- 无边框窗口 + 自定义标题栏:Logo、库标签页(切换/关闭/新建)、最小化/最大化/关闭走 IPC
- 全量落地设计令牌、壁纸蓝色光斑、三层玻璃面板配方、liquid-lens SVG 折射滤镜
- 侧栏四分组(快捷访问/文件夹树/标签/颜色筛选)、筛选条五下拉、色带、结果统计
- 素材网格三视图(瀑布流/网格/列表)、缩略图缩放滑块(170–320px)、检查器显隐开关
- 检查器单面板(颜色构造/文件名/星级+待审/文件信息/标签/来源链接/备注)
- 灯箱预览(3D 舞台本阶段用 CSS 转台立方体)、下拉菜单、右键菜单、键盘快捷键
- 数据层使用本地测试素材快照(`素材/` 目录:2 JPG + 1 MP4,真实元数据)+ 自拟合成条目覆盖全部格式;真实图片/视频经 dev 静态服务预览,侧栏计数与结果统计由数据集实时计算;不含运行时文件扫描、缩略图生成、SQLite

## Capabilities

### New Capabilities

- `app-shell`:窗口骨架、无边框窗口、标题栏、库标签页、工具栏、窗口控制 IPC
- `glass-theme`:设计令牌、壁纸光斑、玻璃面板配方、折射滤镜、动效纪律(reduced-motion)
- `asset-browser`:侧栏导航、筛选条、色带筛选、三视图素材网格、卡片选中与缩放
- `inspector`:检查器面板结构、内容渲染与显隐行为
- `lightbox`:预览灯箱、3D 转台舞台(本阶段 CSS 立方体)、图片/视频大图展示
- `menus-shortcuts`:下拉菜单、右键菜单、全局键盘快捷键

### Modified Capabilities

(无,首个 change)

## Impact

- 新增全部应用代码;新增依赖:electron、electron-vite、react、react-dom、typescript、zustand、lucide-static
- 不涉及真实文件系统访问、数据库、缩略图生成、打包分发(属后续 change)
- 唯一权威设计源:`C:\Users\LYNX\Desktop\素材管理器设计规格.md`;HTML 设计稿仅作参照,值冲突以规格为准

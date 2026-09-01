## Why

Change 1–3 交付后对照设计规格与主 specs 审计出 9 个缺口:P1(虚拟滚动、已绑定库重开、色带动态聚合、文件夹树真实化)影响日常可用;P2(GLB 面数解析、空态升级、编码/帧率标注、3D 加载进度与曝光)属打磨;P3 为数据卫生。本 change 按序补齐。

## What Changes

- **P1-1 虚拟滚动**:网格/列表视图 >500 项启用 @tanstack/react-virtual 窗口化;瀑布流大库启用 `content-visibility:auto` 跳渲染(设计权衡,见 design);缩放滑块与三视图切换行为不变
- **P1-2 已绑定库重开**:标题栏「+」改为下拉(新建库 + 已绑定库列表,点击即开标签);重复绑定目录不再报错而是直接打开
- **P1-3 色带动态聚合**:色带由当前视图范围素材的 palette 加权聚合生成(前 8 色 + 占比),随筛选/导航实时变化;无 palette 数据时显示空态文案
- **P1-4 文件夹树真实化**:库模式侧栏文件夹树按素材目录链动态构建并计数;演示模式保持演示树
- **P2-5 GLB/glTF 元数据解析**:扫描时解析 GLB JSON chunk 得面数/顶点入库;卡片与检查器显示真实面数
- **P2-6 空态升级 + 建库引导**:空结果/空库/空回收站改为插画级空态(图形 + 主文案 + 动作按钮);演示模式显示显式「新建素材库」引导卡
- **P2-7 视频编码/帧率标注**:ffmpeg 解析编码(H.264/HEVC 等)与 fps 入库;检查器信息栏 small 显示
- **P2-8 3D 加载进度与曝光**:灯箱 3D 加载显示百分比进度;控制条新增曝光滑杆(默认 1.0,调节不重建渲染器)
- **P3-9 清理 missing 测试记录**:新增 `assets:purgeMissing` IPC(仅删「missing=1 且文件确实不存在」的记录),无 UI 入口;实施期经桥执行一次清理

## Capabilities

### New Capabilities

(无——全部为既有能力的需求增补)

### Modified Capabilities

- `app-shell`:「库标签页」——「+」升级为新建+重开入口
- `asset-browser`:「侧栏导航」——库模式文件夹树动态化;「色带」——动态聚合;新增「虚拟滚动」「空态与建库引导」
- `library-scan`:新增「三维元数据解析」「视频编码信息」
- `viewer-3d`:新增「加载进度与曝光」

## Impact

- 新增依赖:@tanstack/react-virtual(dev 面向窗口化)
- 渲染层:Grid/Sidebar/FilterBar(色带)/Titlebar(+菜单)/Lightbox(进度+曝光)改造;Card 不动
- 主进程:scan(videoMeta 扩展 codec/fps、GLB 解析器)、ipc(purgeMissing、library 列表已有)
- 风险面:content-visibility 与列布局的兼容、大库聚合计算量(主线程一次 O(n) 可接受)、曝光滑杆与既有控制条布局

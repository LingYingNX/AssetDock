## Why

Change 1 的界面运行在内存数据集上:星级/标签/收藏/备注刷新即失,素材不是真实文件,缩略图是渐变占位。MediaHub 要成为可用工具,必须把数据落到真实文件系统与数据库。

## What Changes

- 新增「新建素材库」真实流程:选择本地文件夹 → 递归扫描(扩展名过滤:JPG/PNG/WEBP/GIF/PSD/SVG/MP4/MOV/GLB/FBX/OBJ)→ 入库
- better-sqlite3 持久化:素材、标签(多对多)、收藏、评分、备注、来源链接、回收站(删除/恢复)全部落库;应用重启不丢
- chokidar 监听已绑定目录:新增/修改/删除文件增量更新索引(删除文件 → 素材标记缺失,不物理删记录)
- 缩略图管线:图片经 sharp 生成 320px WebP 缓存(`userData/thumbs/`);视频经 ffmpeg-static 抽 1s 处帧后走同一 sharp 管线;PSD/AI 无解码 → 通用占位图;缩略图文件名 = 内容哈希,不随路径变化失效
- 调色板提取:缩至 64px 后 Worker 内 k-means 聚 5 色,随入库写入
- 卡片/灯箱大图改读真实文件(经自定义 `media://` 协议安全暴露);UI 查询层从 SQLite 读,`queryAssets` 语义不变
- 明确排除(用户指示):打包发布、库存储统计、真实 3D 渲染(Change 3)

## Capabilities

### New Capabilities

- `library-scan`:库的创建/绑定、目录扫描、扩展名过滤、chokidar 增量监听与缺失标记
- `asset-store`:SQLite 持久化 schema、编辑操作落库(评分/标签/收藏/备注/来源/回收站)、重启后数据完整
- `thumbnails`:图片/视频缩略图生成、内容哈希缓存、PSD/AI 占位降级、灯箱大图 media 协议
- `palette`:Worker k-means 调色板提取、入库时序、色带/颜色筛选数据来源切换

### Modified Capabilities

- `app-shell`:「＋新建素材库」从内存占位变为真实建库流程(选目录→扫描→开标签);「在资源管理器中显示」对库内素材全部可用
- `asset-browser`:「本地测试数据集」requirement 替换为「SQLite 数据集」——侧栏计数/筛选/色带改读数据库;回收站删除/恢复真实生效
- `inspector`:编辑交互持久化要求补入(重启后保留);备注/来源/标签写入数据库
- `lightbox`:大图/视频源改为真实文件;信息面板数据来自库记录

## Impact

- 新增依赖:better-sqlite3(需 @electron/rebuild 对齐 ABI)、chokidar、sharp、ffmpeg-static;新增 devDep @electron/rebuild
- 主进程新增 `src/main/services/`(db/scan/watch/thumbs/palette)与 `media://` 协议;preload 增加 IPC API
- 渲染层 `data/query.ts` 查询语义保持,数据源由静态数组换为 IPC;mock 数据集保留为「未建库时的演示模式」
- 风险面:原生模块 ABI、大目录扫描性能(增量 + 懒生成缩略图)、中文路径(SQLite 路径统一 UTF-8 存储)

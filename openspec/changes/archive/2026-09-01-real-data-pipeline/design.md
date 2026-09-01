## Context

Change 1 已交付完整 UI(渲染层查询接口 `queryAssets` 语义稳定)与 dev HTTP 桥无头验证工具。本 change 把数据从内存换到真实文件系统 + SQLite。Node 24 / Electron 33,Windows 优先,中文路径是常态。打包发布按用户指示排除。

## Goals / Non-Goals

**Goals:**

- 建库 → 扫描 → 浏览 → 编辑 → 重启不丢,全链路真实数据
- 缩略图/调色板懒生成,大库不卡 UI
- UI 改动最小化:查询语义不变,组件基本不动

**Non-Goals:**

- 打包发布(用户指示跳过)、库存储统计、真实 3D 渲染(Change 3)
- 多库合并视图、跨库搜索、素材物理移动/重命名真实文件
- 全文搜索、智能相册、去重

## Decisions

1. **better-sqlite3(同步 API,主进程独占)**
   - 主进程单线程持有连接,事务简单可靠;WAL 模式降低读写互斥。替代 sql.js(要自己管落盘)与 tauri-sql(不适用)。原生模块用 `@electron/rebuild` 对齐 Electron ABI,postinstall 接入。
2. **扫描器:一次全量 + 增量监听**
   - 首扫 walk 目录(异步 fs.readdir 递归,并发 8);之后 chokidar(_ignoreInitial)维持增量。文件指纹 = sha1(前 64KB + size)(读 64KB 而非全文件,平衡速度与准确性),作缩略图缓存键。
3. **缩略图:串行队列 + 懒触发**
   - 渲染层请求可见卡片缩略图 → IPC → 队列(串行)→ sharp;视频先 ffmpeg-static `-ss 1 -frames:v 1` 出帧。PSD/AI/失败 → 内置占位 WebP。缓存 `userData/thumbs/<fingerprint>.webp`。
4. **media:// 协议:protocol.handle + 路径白名单**
   - 请求携带库名+相对路径(URL 编码),主进程解析为绝对路径并校验前缀属于任一库目录,杜绝目录穿越;Range 支持视频拖动。
5. **调色板:主进程 worker_threads(inline eval)**
   - 缩略图生成后主进程已有 320px WebP,直接 sharp 取 64px raw 喂给 worker_threads 内联 k-means,结果即写库——免去渲染层取字节/回传/二次解码的链路。与原「渲染层 Worker」设想相比实现更短、同规格要求(Worker 线程、不卡 UI)。
6. **查询:全量取轻量行 + 渲染层过滤**
   - 单库素材预期 <5 万,列表查询只取展示字段一次拉回,过滤沿用 Change 1 渲染层逻辑;避免把五组筛选翻译成 SQL 的复杂度。分页留到性能问题实际出现。
7. **演示模式:mock 数据集保留**
   - 无库时渲染层沿用 Change 1 数据集并显示建库引导;`queryAssets` 签名不变,上游换数据源。

## Risks / Trade-offs

- [better-sqlite3 与 Electron ABI 不匹配] → @electron/rebuild 进 postinstall;CI 无,本地跑 rebuild 验证一次
- [ffmpeg-static 体积 ~70MB] → 打包被排除,dev 体积无碍;未来打包用 asarUnpack
- [大目录首扫慢] → 并发 8 + 进度显示 + 边扫边入库;缩略图懒生成不阻塞
- [中文/空格路径] → SQLite 参数化查询全 UTF-8;media:// URL encodeURIComponent;路径校验用 realpath 防符号链接逃逸
- [chokidar 重复事件] → 300ms debounce per path;mtime+size 未变则忽略
- [编辑落库失败静默丢] → toast 提示 + 重试按钮;事务保证无半写

## Migration Plan

- 数据库 schema 首版直接建;字段演进用 user_version pragma 迁移(本 change 内无旧库迁移问题)
- 回滚:功能开关不设——未建库即自然回退演示模式,数据不可损坏(只增不删原文件)

## Open Questions

(无。缩略图尺寸 320px、k=5、抽帧 1s 均按设计规格 11 节固定。)

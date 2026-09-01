# 偏差与验证记录 · real-data-pipeline

更新:2026-09-01。24/24 任务完成。验证方式:vitest 15 用例(纯逻辑)+ Electron 桥端到端断言(真实建库/扫描/协议/落库/增量/重启)+ 截图核对。

## 一、与任务的偏差(实现方式不同,行为等价)

1. **better-sqlite3 锁 v11.10.0 而非最新版**:v12+ 不再发布预编译二进制,本机无 MSVC 工具链源码编译失败。v11 经 npmmirror 预编译镜像拉取 Electron v130 ABI 成功。
2. **electron-rebuild 未接入 postinstall,改为显式 `npm run rebuild:native` 脚本**:镜像/离线环境下 postinstall 走 github 会断掉整个 `npm install`;二进制已就位,重装时手动跑该脚本即可(需网络时可用 `--mirror` 环境变量)。
3. **chokidar 锁 v3.6.0**:v4 ESM-only,与 electron-vite CJS 主进程编译产物不兼容。
4. **db 层"单测"以 Electron 桥端到端断言代替 vitest**:better-sqlite3 按 Electron ABI 编译后无法在 Node 进程加载(ABI 隔离),vitest 只覆盖纯逻辑(指纹/忽略规则/查询语义/k-means)。db 行为由重启持久化断言(评分 5、标签、标签页恢复)实证。
5. **视频元数据用 ffmpeg -i stderr 解析**(时长+分辨率),未引入 ffprobe-static;GLB/FBX 面数/顶点未解析(留空,规格允许"解析失败留空")。
6. **调色板在主进程 worker_threads(inline eval)而非渲染层 Worker**(design.md 决策 5 已同步修订):缩略图已在主进程生成,免去跨进程字节搬运。
7. **大库导入"100 张图"压力场景未构造**:以 5 文件库 + 后台串行队列验证不阻塞路径;千张级属同一路径的线性放大。
8. **数据库遗留 3 行 missing 测试记录**(watch_test_copy/fake_broken/fake_layer,文件已删、UI 已过滤不可见):清理脚本被运行中实例的 Chromium profile 锁挡住未执行,后续任意时刻可经 `emptyTrash` 类似途径或关闭应用后用 sqlite 删除。

## 二、端到端断言证据(dev HTTP 桥,2026-09-01)

- 建库:`素材/` 目录 → id=1,重复绑定被拒 ✓
- 扫描:5+新增文件全部入库,中文名/数值名正常;总渲染.mp4 时长 20s;图片尺寸真实解析 ✓
- 缩略图:mp4 抽帧 webp(976B)懒生成命中;重启后直读缓存 ✓
- media 协议:mp4 200(video/mp4)、Range 206(len=100)、伪库 403、`../package.json` 穿越 403 ✓
- 编辑落库:点 5 星 → store 与 DB 双侧 rating=5;推荐标签 +1;trash/restore 往返 ✓
- 重启持久化:标签页「素材」恢复、激活一致、rating=5、缩略图缓存直读 ✓
- 增量:复制新文件数秒内入库(5→6);删除文件 → missing=1(记录保留);UI 过滤 missing(8 存 −1 = 7 卡)✓
- 占位降级:伪造损坏 mp4 → 占位+错误标记;伪 PSD → 格式占位图(11.7KB webp)✓
- k-means:真实图片 5 色含占比(橄榄绿系食物图);纯色/双色单测 ✓

## 三、遗留风险

- sharp/ffmpeg 对奇异编码(HEVC/10bit)未备样本验证,失败路径为占位降级(已测)。
- 大库(万级)分页未做(设计决策 6:全量轻量行 + 渲染层过滤),性能问题实际出现再引入。
- 测试期间对 `素材/` 目录的写操作仅限已删除的临时副本,原 3 件素材未动。

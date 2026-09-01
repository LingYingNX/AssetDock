# 偏差与验证记录 · library-structure-index

更新:2026-09-01。10/10 任务完成。验证:Electron 桥端到端(迁移/索引增删/协议/越界/整目录携带)+ 截图。

## 一、实现说明与偏差

1. **db 层验证以 Electron 桥端到端断言代替 vitest**(任务 1.1/1.2 写明 vitest 内存模式):better-sqlite3 按 Electron ABI 编译后 Node 进程不可加载(ABI 隔离,与 Change 2 同因)。纯逻辑无新增,桥断言覆盖迁移一致性/索引增删/防重叠/携带。
2. **libraryDb.ts/libResolve.ts 曾在本会话早期以未接线草稿存在并被误删**:本轮按工件重建并补全(迁移含 open_tabs/codec/fps 列、防重叠校验、指纹跨库查找)。
3. **新增"退出前 wal_checkpoint(TRUNCATE)"**(design 未列):保证关闭后 `.mediahub/library.db` 自包含,"整目录复制携带"场景才成立——实测未 checkpoint 时副本打开 0 行,checkpoint 后 11 行 ✓。
4. **每库 db 打开时重打 library_id**(幂等 UPDATE):整目录复制为新库注册时,携带行内的旧 library_id 需改写为当前注册 id,否则过滤为 0——实测修复后副本 11 项 ✓。
5. **media 白名单扩展为"每库根 + 其索引根"**,大小写/正反斜杠归一后前缀比对(修复索引素材 403);防自我索引/防他库重叠/防穿越(`../`)断言全过。
6. **index 素材 rel 虚拟路径 = `索引名/相对路径`**,侧栏树索引顶层节点由既有动态树机制自然呈现(folders 前缀链),未新增树代码;信息面板来源行显示「索引 · <名>」。

## 二、端到端证据(2026-09-01,dev 桥)

- 迁移:lib1(素材,10 项)启动迁移至 `素材/.mediahub/library.db`,浏览/编辑/缩略图/编码元数据全部照旧 ✓
- 索引:add(E:/mh_extern_ref)→ 虚拟 rel `mh_extern_ref/ref_a.jpg` 入库(总 11)→ 信息面板来源「索引 · mh_extern_ref」✓
- 防重叠:索引库自身目录被拒 ✓;media 索引素材 200、Range 206、`../package.json` 穿越 403 ✓
- 移除:remove 后索引素材记录清零、index_sources 清空、外部目录文件原样 ✓
- 携带:整目录复制 → 新注册打开 → 11 项、缩略图缓存直读(200)、h264 元数据完整 ✓
- 缺失:外部文件删除 → missing=1 从默认视图隐藏;启动对账补标记(sub/inner 嵌套目录入库/缺失往返)✓

## 三、遗留风险

- 双实例并发写同一库 db(WAL)理论可行但未做并发测试;建议后续加 `requestSingleInstanceLock` 单实例锁。
- 迁移为一次性复制式,全局旧库保留不删(可回滚);如需回收全局空间,后续可加"确认后清理"入口。
- 索引目录含大量文件时首扫与库根同性能特征(并发 8)。

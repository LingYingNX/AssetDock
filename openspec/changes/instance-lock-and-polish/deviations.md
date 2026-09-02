# 验证状态 · instance-lock-and-polish

更新:2026-09-01。**代码全部就位;运行断言被并行会话污染,归档待独占窗口复验。**

## 实现清单(全部就位)

1. **单实例锁**:`src/main/index.ts` requestSingleInstanceLock;失败实例 quit;`second-instance` 事件 restore+focus 既有窗口
2. **迁移残留清理**:IPC `library:legacyStats` / `library:purgeLegacy`(删兜底 assets/tags/asset_tags + WAL checkpoint;注册表与应用设置保留);「+」菜单尾部条件项「清理迁移残留(N 项)…」(N>0 显示,二次确认)
3. **曝光持久化**:Lightbox 挂载读 app_state `viewerExposure`(默认 1.0,夹取 0.4–1.6);`changeExposure` 同步写入;Viewer3D 曝光 prop 直改 toneMappingExposure 不重建

## 已确证

- typecheck 0 错、vitest 17/17、build ✓
- 桥断言:曝光写入 state=1.3 成功;legacyStats 读取正常(当前 0——并行会话已清,菜单正确隐藏)

## 未完成断言(并行会话污染,见下)

- 双开实测单实例锁(第二实例聚焦+退出)
- purge 的 N>0 场景(残留已被并行会话清空,现 0 行;purge 空删幂等已验)
- 曝光重启恢复:写入 1.3 后重开读回 1.25——**并行会话同时在写 viewerExposure**(恰为本 change 要根治的并发症状);单实例锁生效后需复验一次

## 并行会话冲突记录

执行期间检测到另一会话(sess_85c458bb)在同一工作区:完成并归档 Change 5 `library-structure-index`(提交 0ac9cf2)、杀本会话 electron、清理 legacy 数据、并发写曝光。本 change 的实现已提交(基线 ee6e854 之后),归档动作建议在关闭并行会话后执行:复验上述三项断言 → 勾选 tasks → `openspec archive`。

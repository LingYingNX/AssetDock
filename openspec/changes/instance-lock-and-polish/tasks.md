## 1. 单实例锁

- [ ] 1.1 主进程 requestSingleInstanceLock + second-instance 聚焦(restore+focus);手测:双开仅一窗口且聚焦

## 2. 迁移残留清理

- [ ] 2.1 IPC `library:legacyStats` / `library:purgeLegacy`(删兜底 assets/tags/asset_tags,checkpoint;注册表保留);桥断言:统计数正确、清理后为 0、库内数据不变
- [ ] 2.2 「+」菜单尾部条件项「清理迁移残留(N 项)…」(N=0 隐藏;二重确认 confirm);桥断言+截图

## 3. 曝光持久化

- [ ] 3.1 Lightbox 初始化读 app_state(viewerExposure,默认 1.0),曝光变更写入;桥断言:改值→重启→恢复

## 4. 验证收尾

- [ ] 4.1 typecheck/build/test 全绿;对照 specs 逐 scenario 勾稽;偏差记录入 change 目录

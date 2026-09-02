## Purpose

保证同一时刻只有一个 MediaHub 实例访问库数据库。

## ADDED Requirements

### Requirement: 单实例运行
应用启动时 SHALL 获取单实例锁;获取失败(已有实例运行)时 SHALL 聚焦既有主窗口并退出当前进程,不出现两个并发实例写库。

#### Scenario: 第二实例聚焦
- **WHEN** 应用已在运行时用户再次启动 MediaHub
- **THEN** 既有窗口被聚焦到前台,新进程退出,库数据库无并发写入

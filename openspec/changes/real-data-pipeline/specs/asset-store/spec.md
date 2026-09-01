## Purpose

SQLite 持久层:素材、标签、收藏、评分、备注、来源、回收站全部落库,编辑实时写库、重启不丢,查询经 IPC 供渲染层。

## ADDED Requirements

### Requirement: 数据库 Schema
应用 SHALL 在用户数据目录维护单个 SQLite 数据库(better-sqlite3),包含 libraries、assets、tags、asset_tags 表;素材记录含库 id、相对路径、类型/格式、尺寸/时长/面数等元数据、大小、mtime、评分、收藏、待审、备注、来源、deletedAt、missing 标记与 palette JSON;路径以 UTF-8 存储,支持中文与空格。

#### Scenario: 重启数据完整
- **WHEN** 用户编辑评分/标签/备注/收藏后完全退出并重新启动应用
- **THEN** 全部编辑内容与库结构原样恢复

### Requirement: 编辑落库
检查器与灯箱的全部编辑操作(评分、收藏、待审、重命名记录、标签增删、备注、来源链接、删除/恢复)SHALL 即时写入数据库(事务),UI 联动不等刷新;写库失败 SHALL 提示且不产生半写状态。

#### Scenario: 编辑即持久
- **WHEN** 修改任一素材的评分或标签后立即杀进程再启动
- **THEN** 该编辑仍在(无「退出时保存」环节)

### Requirement: 查询 IPC
渲染层 SHALL 经 IPC(invoke/handle)获取素材列表、侧栏计数与单条记录;过滤(侧栏/五筛选/搜索/颜色)语义与 Change 1 的 `queryAssets` 保持一致;未绑定任何库时回退演示数据集(Change 1 mock)。

#### Scenario: 演示模式回退
- **WHEN** 首次启动且尚未建库
- **THEN** 界面以演示数据集运行并提供「新建素材库」引导

### Requirement: 删除与恢复
删除 SHALL 置 deletedAt(移入回收站视图),恢复 SHALL 清除标记;两者均只改数据库,SHALL NOT 移动或删除磁盘文件;回收站支持单条恢复与清空(清空仅删数据库记录,不动文件)。

#### Scenario: 回收站恢复
- **WHEN** 在回收站对素材执行恢复
- **THEN** 素材回到原文件夹视图,磁盘文件始终未被动过

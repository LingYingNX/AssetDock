## Purpose

素材浏览的数据源从内置测试数据集切换为已绑定库的 SQLite 数据,回收站删除/恢复真实生效,未建库时保留演示模式。

## REMOVED Requirements

### Requirement: 本地测试数据集
**Reason**: 数据源升级为 SQLite(`asset-store` 能力),静态快照与合成条目不再作为默认数据。
**Migration**: 数据集模块保留为「演示模式」回退(未绑定任何库时使用,见下方 ADDED「SQLite 数据集」);`queryAssets` 过滤语义不变。

## ADDED Requirements

### Requirement: SQLite 数据集
素材浏览 SHALL 以已绑定库的数据库记录为数据源:侧栏计数、结果统计、色带分布由数据库实时计算;五组筛选、搜索、颜色筛选的过滤语义与既有 `queryAssets` 保持一致;已删除(deletedAt)素材仅出现在回收站视图,缺失(missing)文件不出现在默认视图;未绑定任何库时应用 SHALL 进入演示模式(内置数据集 + 新建库引导)。

#### Scenario: 建库后浏览真实素材
- **WHEN** 绑定真实文件夹并完成扫描
- **THEN** 网格展示库内素材,缩略图为真实画面,侧栏计数与库内容一致

#### Scenario: 演示模式回退
- **WHEN** 首次启动且尚未绑定任何库
- **THEN** 以演示数据集运行,并可见「新建素材库」引导入口

#### Scenario: 回收站删除与恢复
- **WHEN** 对库内素材执行删除后再执行恢复
- **THEN** 素材先进入回收站视图、后回到原文件夹视图,磁盘文件全程未变

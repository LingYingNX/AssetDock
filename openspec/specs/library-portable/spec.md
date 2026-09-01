## Purpose

## Requirements

### Requirement: 库内存储
每个库 SHALL 在其目录下维护 `.mediahub/library.db`(SQLite)与 `.mediahub/thumbs/`(缩略图缓存);素材、标签、收藏、评分、备注、回收站、索引列表全部落库于该文件;应用 SHALL NOT 在库目录内产生其他散落文件;`.mediahub/` 永不作为素材入库。

#### Scenario: 库目录可整体携带
- **WHEN** 复制整个素材库文件夹(含 .mediahub)到另一台机器并以本应用打开副本
- **THEN** 素材、标签、评分、缩略图全部原样可用,无需重新扫描/生成

### Requirement: 启动迁移
应用启动 SHALL 检测全局目录中的既有库数据并迁移到对应库目录的 .mediahub/library.db:复制式迁移(源数据保留不删除);迁移后所有读写走库内库;迁移失败(库目录不可写等)SHALL 回退继续使用全局数据并提示。

#### Scenario: 旧库自动迁移
- **WHEN** 以包含既有全局库数据的状态启动应用
- **THEN** 各库目录出现 .mediahub/library.db 且数据完整,应用浏览/编辑行为不变

### Requirement: 索引入口菜单
「+」库管理菜单 SHALL 增补「索引目录到当前库…」项:选择外部目录挂到当前激活库(语义见 `library-index`);演示模式或无激活库时该项禁用。

#### Scenario: 菜单发起索引
- **WHEN** 用户经「+」菜单选择「索引目录到当前库…」并选定外部目录
- **THEN** 当前库新增索引,素材入网格(同 `library-index` 各场景)

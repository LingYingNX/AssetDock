## MODIFIED Requirements

### Requirement: 外部目录引用索引

应用 SHALL 将外部目录作为只读引用式索引来源。索引 SHALL NOT 复制、移动、删除或写入源文件、源缩略图、JSON 或隐藏元数据目录；索引身份 SHALL 使用 `source_index_id` 与 `@index:<id>/<source-relative-path>` 内部键，显示名 SHALL NOT 作为身份或路径解析依据。

#### Scenario: 索引 E 盘素材目录不修改源文件

- **WHEN** 用户将 `E:\素材` 添加为当前库的索引来源并完成扫描
- **THEN** 资产记录与用户主动创建的元数据只写入当前库，`E:\素材` 的文件和目录不被创建、修改、移动或删除

### Requirement: 索引派生数据留在库内并按需维护

索引素材 SHALL 直接引用并预览源文件。当前库根目录 SHALL NOT 生成 Windows `.lnk` 快捷方式、素材 JSON、WebP 缩略图或其他源文件镜像。素材 JSON SHALL 位于 `.mediahub/metadata/<source-index-id>/<source-relative-file>.json`，且仅在用户编辑标签、备注、链接、评分、收藏、审核标记或分类时创建或更新。新增、修改、重命名、目录移动和删除 SHALL 增量同步已有 JSON 与资产记录。

#### Scenario: 源素材目录改名保留资产元数据

- **WHEN** 同一索引来源中的素材或含素材的目录改名
- **THEN** 卡片、资产 ID、标签、备注、链接和分类路径保持；若存在 JSON，则它移动至新的 `.mediahub/metadata/` 层级；源文件不被写入且库根不生成镜像

#### Scenario: 源素材真正删除

- **WHEN** 索引来源中的文件在 1500 ms 内未作为同指纹重命名恢复
- **THEN** 应用删除该资产的数据库记录和已有 JSON，不删除源文件或库内用户文件夹

#### Scenario: 未编辑的索引素材不创建 JSON

- **WHEN** 索引素材完成扫描或被打开预览，但用户没有编辑素材信息
- **THEN** 应用不为该素材创建 JSON

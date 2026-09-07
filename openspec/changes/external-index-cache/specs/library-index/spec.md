## MODIFIED Requirements

### Requirement: 外部目录引用索引

应用 SHALL 将外部目录作为只读引用式索引来源。索引 SHALL NOT 复制、移动、删除或写入源文件、源缩略图、JSON 或隐藏元数据目录；索引身份 SHALL 使用 `source_index_id` 与 `@index:<id>/<source-relative-path>` 内部键，显示名 SHALL NOT 作为身份或路径解析依据。

#### Scenario: 索引 E 盘素材目录不修改源文件

- **WHEN** 用户将 `E:\素材` 添加为当前库的索引来源并完成扫描
- **THEN** 资产记录和派生文件只写入当前库，`E:\素材` 的文件和目录不被创建、修改、移动或删除

### Requirement: 索引派生缓存随源层级同步

索引素材 SHALL 在当前库根目录中按源相对路径生成同层级的 Windows `.lnk` 快捷方式与 `.json` sidecar；快捷方式目标 SHALL 指向源文件，sidecar SHALL 不包含绝对源路径。索引缩略图 SHALL 继续位于当前库 `.mediahub/thumbs/<fingerprint>.webp`。新增、修改、重命名、目录移动和删除 SHALL 增量同步快捷方式、sidecar、缩略图与资产记录。

#### Scenario: 源素材目录改名保留资产元数据

- **WHEN** 同一索引来源中的素材或含素材的目录改名
- **THEN** 卡片、资产 ID、标签、备注、链接和分类路径保持，`.lnk` 与 `.json` 移动至新层级，快捷方式仍指向源文件，源文件不被写入

#### Scenario: 源素材真正删除

- **WHEN** 索引来源中的文件在 1500 ms 内未作为同指纹重命名恢复
- **THEN** 应用删除该资产的数据库记录、`.lnk`、`.json` 和所属缩略图，并不删除源文件或库内用户文件夹

### Requirement: 索引监听为低开销增量监听

索引来源 SHALL 使用系统原生文件事件，不得在 Windows 上常态轮询。常规事件 SHALL 只处理受影响的文件或子树；应用启动时 SHALL 对索引根执行一次静默对账。

#### Scenario: 空闲索引目录

- **WHEN** 外部索引目录空闲
- **THEN** 应用不以固定时间间隔扫描目录，直到系统报告文件事件或下次启动对账

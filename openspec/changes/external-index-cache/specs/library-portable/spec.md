## MODIFIED Requirements

### Requirement: 库目录携带派生索引数据

每个库 SHALL 在 `.mediahub/` 下维护 `library.db` 与按需元数据 `metadata/`。索引素材 SHALL 不在库根或其子目录创建 `.lnk`、JSON、缩略图或其他镜像。JSON SHALL 为 SQLite 的单向可审阅副本且不含绝对源路径。整个库目录（包含 `.mediahub/`）SHALL 随库移动或复制。

#### Scenario: 复制含索引素材的库目录

- **WHEN** 用户复制或移动一个库目录
- **THEN** 数据库与已创建的索引素材 JSON 随库目录一同存在，原始外部目录仍保持引用而不被复制

### Requirement: 可命名创建资源库

应用 SHALL 允许用户输入资源库显示名称并选择库目录创建资源库。库创建成功后 SHALL 在所选目录的 `.mediahub/` 内存储配置和派生数据。

#### Scenario: 用户从偏好设置创建资源库

- **WHEN** 用户输入有效名称、选择有效目录并确认创建
- **THEN** 应用以该名称绑定目录、创建必要的 `.mediahub/` 存储并打开新资源库

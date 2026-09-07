## MODIFIED Requirements

### Requirement: 库目录携带派生索引数据

每个库 SHALL 在 `.mediahub/` 下维护 `library.db` 与缩略图 `thumbs/`；索引 `.lnk` 与 JSON sidecar SHALL 按源相对层级直接位于库根及其子目录，JSON SHALL 为 SQLite 的单向可审阅副本且不含绝对源路径。整个库目录（包含 `.mediahub/` 与索引镜像文件）SHALL 随库移动或复制。

#### Scenario: 复制含索引素材的库目录

- **WHEN** 用户复制或移动一个库目录
- **THEN** 已有库自有缩略图以及索引素材 `.lnk`/JSON 镜像随库目录一同存在，原始外部目录仍保持引用而不被复制

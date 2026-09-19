## Context

素材库以 `.mediahub/library.db` 保存资产、标签和索引来源。外部目录由 `source_index_id` 与 `@index:<id>/<relative-path>` 绑定，只引用源文件。

## Storage

索引素材不生成镜像、快捷方式或缩略图。用户编辑后才在下列位置创建 JSON：

```text
<library>/.mediahub/metadata/<source-index-id>/<source-relative-file>.json
```

SQLite 为权威数据源。JSON 不含绝对源路径或媒体字节，通过原子写入更新。

## Preview And Synchronization

图片、视频和三维模型都使用受控 `media://` 协议直接读取原文件。媒体 URL 含资产指纹，源文件变化后会得到新 URL。协议只接受登记库或索引来源内的相对路径，并支持视频 Range。

Windows 使用原生事件监听。重命名保持资产 ID 与已有 JSON；文件真正删除时仅删除已有 JSON 和数据库记录。应用启动时删除旧 `.mediahub/thumbs/` 和应用数据 `thumbs/`，不删除 `.mediahub/metadata/`、数据库或用户文件。

## Verification

测试覆盖按需 JSON、索引重命名与删除、无缩略图目录创建、直接 `media://` URL 和扫描不再受预览调度阻塞；随后执行类型检查、构建、严格 OpenSpec 校验和无头 Electron 验收。

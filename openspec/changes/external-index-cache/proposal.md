## Why

外部素材目录已经可以被引用索引，但索引素材的缩略图仍落在扁平缓存中，标签、链接和备注只存在 SQLite。源目录结构变化时，缓存无法镜像层级，重命名可能丢失用户元数据，Windows 的轮询监听也会产生不必要的常驻资源消耗。

## What Changes

- 为索引素材在库根建立按源相对路径镜像的 Windows `.lnk` 快捷方式与同级 JSON sidecar。
- 索引缩略图继续写入所属库 `.mediahub/thumbs/`，不在库根重复铺设 WebP 文件。
- 保持 SQLite 为权威数据源；JSON 仅由 SQLite 原子生成，绝不回写或修改源素材。
- 将 Windows 索引监听改为原生事件模式，并在新增、内容修改、重命名和删除时增量维护索引记录及派生文件。
- 通过稳定内部路径和短暂的重命名配对窗口保留移动素材的标签、备注、链接及其他用户元数据。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `library-index`: 索引来源应以只读方式生成并同步层级化派生缓存。
- `thumbnails`: 索引素材的实际缩略图位置应为所属库 `.mediahub/thumbs/` 内容寻址缓存，内容变更应刷新缩略图。
- `library-portable`: 库内 `.mediahub/` 应携带索引素材的缩略图，库根及其子目录应携带 `.lnk` 与 JSON sidecar 镜像。

## Impact

- 影响主进程索引镜像、扫描、存储、监听、缩略图协议和 IPC 处理。
- 不增加第三方依赖，不复制、移动、删除或写入 `E:\素材` 的任何文件。
- 不实现剪切库、图片直开或视频/3D 的新预览规则。

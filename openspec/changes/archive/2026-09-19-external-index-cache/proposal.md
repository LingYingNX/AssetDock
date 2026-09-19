## Why

纯索引库直接引用源素材，但旧缩略图缓存会在库内累积大量 WebP 文件。库应直接预览源文件，同时继续安全保存用户主动编辑后的元数据。

## What Changes

- 索引素材直接引用并打开源文件，不生成 `.lnk`、镜像或缩略图缓存。
- 图片、视频和三维模型直接从已绑定源文件加载预览。
- JSON 仅在用户编辑标签、备注、链接、评分、收藏、审核标记或分类时原子写入 `.mediahub/metadata/`。
- Windows 原生监听仅同步资产记录与已有 JSON；旧 `.mediahub/thumbs/` 和全局 `thumbs/` 缓存会被清理。

## Capabilities

### Modified Capabilities

- `library-index`
- `library-portable`
- `thumbnails`

## Impact

- 影响扫描、监听、媒体预览协议、索引元数据与旧缓存清理。
- 不复制、移动、删除或写入 `E:\素材` 的任何源文件。

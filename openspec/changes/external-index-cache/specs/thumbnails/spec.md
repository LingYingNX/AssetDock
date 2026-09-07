## MODIFIED Requirements

### Requirement: 索引缩略图生成与读取

图片、视频和模型索引素材 SHALL 在需要时生成 WebP 缩略图。索引缩略图 SHALL 与库自有素材一样使用所属库 `.mediahub/thumbs/<fingerprint>.webp` 内容寻址缓存；索引源文件的库根镜像 SHALL 仅包含 `.lnk` 与同级 `.json`。`thumb://` SHALL 读取资产解析出的精确缓存路径。

#### Scenario: 索引素材首次显示

- **WHEN** 索引素材首次需要缩略图
- **THEN** 应用在所属库 `.mediahub/thumbs/` 创建 WebP，并在库根对应层级创建 `.lnk` 与 `.json`，完成后通过既有 `thumbs:ready` 通知刷新界面，不在源目录写入缩略图

#### Scenario: 索引素材内容修改

- **WHEN** 索引素材修改时间或采样内容变化
- **THEN** 应用更新资产指纹并原子替换所属库 `.mediahub/thumbs/` 中的 WebP，同时更新同级 sidecar，后续 `thumb://` 请求不会返回旧缩略图

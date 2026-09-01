## Purpose

缩略图缓存随库迁移,thumb 协议支持跨库指纹查找。

## MODIFIED Requirements

### Requirement: 图片缩略图
图片素材 SHALL 在首次浏览时异步生成 320px WebP 缩略图(sharp,保持宽高比),存于**所属库目录的 `.mediahub/thumbs/`**(`library-portable` 能力);文件名用内容指纹(文件大小 + mtime + 相对路径摘要),路径或重命名变化不导致缓存失效;生成前显示渐变占位,完成后淡入替换;索引素材的缩略图同样落入当前库缓存。

#### Scenario: 首次浏览懒生成
- **WHEN** 打开一个尚未生成缩略图的库
- **THEN** 卡片先显示占位,逐张异步替换为真实缩略图,UI 不卡顿

#### Scenario: 缓存命中
- **WHEN** 重启应用再次浏览同一库
- **THEN** 缩略图直接读库内缓存,不重新解码原图

#### Scenario: 库目录携带缓存
- **WHEN** 整目录复制库到新机器
- **THEN** 缩略图随 `.mediahub/thumbs/` 直接可用,无需重新生成

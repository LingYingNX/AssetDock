## Purpose

定义素材预览与媒体读取路径的契约:卡片与灯箱直接读取资源库内的原始文件而不生成持久化缩略图缓存,并约束 `media://` 协议的放行范围与目录穿越防护。

## Requirements

### Requirement: 原始素材预览

图片和视频素材 SHALL 直接从当前资源库内的原文件加载预览，不得生成或读取持久化 WebP 缩略图。图片卡片直接显示原图；视频卡片由原生视频元素按需加载首帧；三维模型继续由已有 WebGL 查看器直接读取原模型。

#### Scenario: 首次浏览

- **WHEN** 用户打开素材库
- **THEN** 卡片只请求当前显示素材的原文件，不创建 `.mediahub/thumbs/` 或全局 `thumbs/` 缓存

#### Scenario: 源文件修改

- **WHEN** 监听到素材内容或路径变化
- **THEN** 资产记录刷新，并以新指纹组成的媒体 URL 重新加载预览

### Requirement: 无预览缓存清理

应用 SHALL 不创建缩略图生成队列、缩略图协议或磁盘缩略图缓存。启动时 SHALL 删除此前版本遗留的资源库 `.mediahub/thumbs/` 与应用数据 `thumbs/` 缓存目录；不得删除 `.mediahub/metadata/`、数据库或用户文件。

#### Scenario: 打开旧资源库

- **WHEN** 用户打开含旧缩略图缓存的资源库
- **THEN** 旧缓存目录被删除，素材仍可直接从原文件预览

### Requirement: 预览缓存与重挂载

`media://` 响应 SHALL 携带缓存头:预览 URL 带指纹版本参数(`?v=`)时返回 `cache-control: public, max-age=31536000, immutable` 与对应 `etag`,使切换文件夹时命中 Chromium 缓存而不重新下载原文件;无指纹时 SHALL 返回 `cache-control: public, max-age=0, must-revalidate` 并以 `last-modified` 兜底。卡片 SHALL 记住已成功解码的预览 URL,重新挂载时直接以可见态渲染,SHALL NOT 再次播放 `opacity: 0` 入场;指纹变化导致 URL 变化时 SHALL 视为未解码并正常淡入。

#### Scenario: 切走再切回同一文件夹

- **WHEN** 用户离开某文件夹后返回
- **THEN** 该文件夹的缩略图以已解码状态直接显示,不出现整片重新淡入

#### Scenario: 首次浏览新文件夹

- **WHEN** 用户首次进入一个未浏览过的文件夹
- **THEN** 缩略图仍按 `opacity: 0` → 1 正常淡入

### Requirement: media 安全协议
渲染层 SHALL 经自定义 `media://` 协议读取当前资源库内的原始文件(灯箱大图/视频播放);协议 SHALL 仅放行该库目录本身及其真正子路径，拒绝库外任意路径、目录穿越、符号链接或 Junction 导向的越界路径，以及仅共享字符串前缀的相邻目录，并支持视频 Range 请求。

#### Scenario: 协议越界拒绝
- **WHEN** 以 media 协议请求库目录之外的路径，或请求经符号链接/Junction 逃逸到库外的路径
- **THEN** 请求被拒绝，不返回文件内容

#### Scenario: 相邻前缀目录拒绝
- **WHEN** 库根为 `C:\\Media`，请求最终实路径位于 `C:\\Media-backup`
- **THEN** 请求被拒绝，不因路径字符串以前者为前缀而放行

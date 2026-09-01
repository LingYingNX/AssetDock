## Purpose

## Requirements

### Requirement: 图片缩略图
图片素材 SHALL 在首次浏览时异步生成 320px WebP 缩略图(sharp,保持宽高比),存于用户数据目录 `thumbs/`;文件名用内容指纹(文件大小 + mtime + 相对路径摘要),路径或重命名变化不导致缓存失效;生成前显示渐变占位,完成后淡入替换。

#### Scenario: 首次浏览懒生成
- **WHEN** 打开一个尚未生成缩略图的库
- **THEN** 卡片先显示占位,逐张异步替换为真实缩略图,UI 不卡顿

#### Scenario: 缓存命中
- **WHEN** 重启应用再次浏览同一库
- **THEN** 缩略图直接读缓存,不重新解码原图

### Requirement: 视频抽帧
视频素材 SHALL 用 ffmpeg-static(官方 FFmpeg 静态构建)抽取约 1 秒处单帧,经同一 sharp 管线生成缩略图;时长与分辨率由 ffprobe/ffmpeg 解析入库;抽帧失败(损坏/编码不支持)降级为占位图并记录错误标记。

#### Scenario: 视频缩略图
- **WHEN** 浏览含 MP4/MOV 的库
- **THEN** 视频卡片显示真实画面帧,时长徽章来自解析结果

### Requirement: 占位降级
PSD/AI 等无系统解码的格式 SHALL 使用通用占位缩略图(格式徽章清晰可辨);损坏文件同样降级并标记,SHALL NOT 阻塞其余缩略图生成。

#### Scenario: PSD 占位
- **WHEN** 库内包含 PSD 文件
- **THEN** 卡片显示 PSD 占位图与 PSD 徽章,浏览不报错

### Requirement: media 安全协议
渲染层 SHALL 经自定义 `media://` 协议读取库内原始文件(灯箱大图/视频播放);协议仅放行已绑定库目录内的文件路径,拒绝库外任意路径,防目录穿越。

#### Scenario: 协议越界拒绝
- **WHEN** 以 media 协议请求库目录之外的路径
- **THEN** 请求被拒绝,不返回文件内容

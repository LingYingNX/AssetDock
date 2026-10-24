# Spec Delta

## MODIFIED Requirements

### Requirement: 640px JPG 缩略图缓存

应用 SHALL 为库内可生成封面的素材生成 640px 长边、JPEG 编码的缩略图,存放于 `<库>/.mediahub/thumbs/`。封面来源 SHALL 包括位图、视频关键帧、三维模型离屏渲染和 CSS 渲染截图。网格卡片的 `previewUrl` SHALL 携带 `?thumb=1` 指向缩略图缓存;灯箱大图、视频播放与三维渲染 SHALL 继续读取原文件(`originalUrl`),SHALL NOT 使用缩略图,以保证观看清晰度与可播放性。缩略图 SHALL 在素材入库(扫描、监听新增、Eagle 导入)与打开库时按能力注册表排队生成,并受并发上限约束;已生成过的指纹 SHALL 直接跳过,只补缺失项。应用 SHALL 把生成进度推送给渲染层,界面以不占布局、不拦截指针的悬浮浮层展示「已完成/总数」,生成结束即隐藏。生成失败时 SHALL 落格式占位图并记录可区分的原因,不得中断网格渲染。

#### Scenario: 素材入库即预热

- **WHEN** 扫描、监听新增或 Eagle 导入把图片写入库
- **THEN** 主进程排队生成其 640px JPG 缩略图,并推送 `thumbs:progress` 进度

#### Scenario: 再次浏览同一文件夹

- **WHEN** 用户离开后再次进入该文件夹
- **THEN** 卡片直接命中库内缩略图,不再读取原图

#### Scenario: 观看原图

- **WHEN** 用户打开灯箱或播放视频
- **THEN** 读取原文件而非缩略图

#### Scenario: 新图片格式封面

- **WHEN** 一个 HEIC 或 TIFF 文件入库
- **THEN** 系统按能力注册表选择解码器生成 JPG 缩略图

#### Scenario: 外部工具不可用

- **WHEN** 一个 BLEND 文件入库但本机没有可用的 Blender
- **THEN** 卡片显示 BLEND 占位封面，并在诊断中记录缺少外部工具

## ADDED Requirements

### Requirement: 缩略图解码器路由

应用 SHALL 按格式能力注册表选择缩略图解码器，不得把所有非 CSS 格式都交给同一图片解码器。路由结果 SHALL 包含实际解码器、是否使用外部进程和失败兜底。

#### Scenario: 图片走原生解码

- **WHEN** 生成 JPG、PNG、WebP、AVIF 或 TIFF 缩略图
- **THEN** 使用原生图片解码器，不启动外部进程

#### Scenario: 视频走关键帧

- **WHEN** 生成 MP4、MOV、MKV 或 AVI 缩略图
- **THEN** 使用内置媒体工具抽取关键帧并压缩为 JPG

#### Scenario: 三维走离屏渲染

- **WHEN** 生成 PMX、STL、PLY 或 GLB 缩略图
- **THEN** 使用对应三维加载器离屏渲染并输出 JPG

### Requirement: 视频封面试探

视频缩略图 SHALL 优先取时长内可解码的关键帧，关键帧失败时回退到首个可解码帧。抽帧 SHALL 有超时和输出尺寸上限，不得把整段视频解码后写入缓存。

#### Scenario: 关键帧损坏

- **WHEN** 视频前段关键帧损坏
- **THEN** 系统尝试后续可解码帧；仍失败时写入视频格式占位图

### Requirement: 三维封面降级

内置三维加载器无法解析时，应用 SHALL 依次尝试外部工具和格式占位图。外部工具生成结果 SHALL 与内置结果使用同一指纹缓存和清单位置。

#### Scenario: BLEND 外部渲染

- **WHEN** 本机 Blender 可用且 `.blend` 文件有效
- **THEN** 外部渲染结果作为该指纹的缩略图，下次浏览直接命中

### Requirement: 缩略图失败记录

缩略图清单 SHALL 记录失败类别（不支持、损坏、超时、缺少外部工具、资源超限）和生成时间。纯文本错误信息 SHALL NOT 作为权威失败判据，文件指纹变化后 SHALL 重新尝试。

#### Scenario: 失败原因可区分

- **WHEN** C4D 缺少外部软件且 EXR 文件损坏
- **THEN** 两个素材都显示占位，但诊断中分别标记为缺少外部工具和文件损坏

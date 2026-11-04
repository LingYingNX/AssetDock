## Purpose

定义素材预览与媒体读取路径的契约:网格卡片经库内 `.mediahub/thumbs/` 的 640px JPG 缩略图缓存读取预览,灯箱大图、视频播放与三维渲染直接读取原文件,并约束 `media://` 协议的放行范围与目录穿越防护。

## Requirements

### Requirement: 640px JPG 缩略图缓存

应用 SHALL 为库内可生成封面的素材生成 640px 长边、JPEG 编码的缩略图,存放于 `<库>/.mediahub/thumbs/`。封面来源 SHALL 包括位图、视频关键帧、三维模型离屏渲染和 CSS 渲染截图。网格卡片的 `previewUrl` SHALL 携带 `?thumb=1` 指向缩略图缓存;灯箱大图、视频播放与三维渲染 SHALL 继续读取原文件(`originalUrl`),SHALL NOT 使用缩略图。应用 SHALL 把生成进度推送给渲染层,界面以不占布局、不拦截指针的悬浮浮层展示「已完成/总数」,生成结束即隐藏。生成失败时 SHALL 落格式占位图并记录可区分的原因,不得中断网格渲染。

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

### Requirement: 缩略图预热范围

位图、视频、三维、CSS 与文档封面 SHALL 在打开库或新增/变化时按能力注册表排队生成,并受并发上限约束。导入动作 SHALL 只预热本次新增或变化的指纹,已生成过的指纹 SHALL 直接跳过。SVG SHALL NOT 进入全库或导入预热队列。

#### Scenario: 非 SVG 素材入库即预热

- **WHEN** 扫描、监听新增或 Eagle 导入把非 SVG 图片写入库
- **THEN** 主进程仅按本次新增或变化的指纹排队生成 640px JPG 缩略图,并推送 `thumbs:progress` 进度

#### Scenario: SVG 不参与批量预热

- **WHEN** 导入 SVG 或打开含 SVG 的素材库
- **THEN** 主进程不预先栅格化该 SVG

### Requirement: SVG 按需缩略图与源文件查看

SVG 网格封面 SHALL 在卡片首次请求 `?thumb=1` 时懒生成并缓存;SVG 灯箱 SHALL 以 sandbox iframe 直接读取原始 SVG,SHALL NOT 使用 JPG 缩略图。

#### Scenario: SVG 卡片按需生成

- **WHEN** 某张 SVG 卡片首次进入视口并请求 `?thumb=1`
- **THEN** 主进程按需生成并缓存 640px JPG,随后替换网格占位图

#### Scenario: SVG 灯箱直接查看

- **WHEN** 用户打开 SVG 灯箱
- **THEN** 灯箱以 sandbox iframe 直接读取原始 SVG,而非 JPG 缩略图

### Requirement: 缩略图命名与清单

缩略图文件 SHALL 以 `<指纹>-<尺寸>.jpg` 命名并附 `index.json` 清单,记录 `version`/`size`/`format` 与 `指纹 → { relPath, mtimeMs, sizeBytes, generatedAt }` 映射。指纹只由内容、大小与 mtime 决定,与原图路径无关,因此原图移动或改名后缩略图 SHALL 继续有效,无需重新生成;清单是缓存元数据而非权威数据源,权威来源始终是库内数据库 `assets` 表。尺寸或版本变化时 SHALL 视为整体失效并重新生成。

#### Scenario: 清单记录映射

- **WHEN** 生成一张缩略图
- **THEN** `index.json` 出现该指纹条目,含原图相对路径与生成时间

#### Scenario: 清单损坏

- **WHEN** `index.json` 缺失或无法解析
- **THEN** 按空清单重建,不抛错、不阻塞浏览

### Requirement: 随原图移动与删除

原图移动或改名时缩略图文件 SHALL 保留(内容寻址),仅同步清单中的可读路径;素材移入回收站时 SHALL 立即删除对应缩略图文件与清单条目,从回收站恢复时 SHALL 重新排队生成。原图被彻底清除(清空回收站、单条彻底删除、清理缺失记录)时 SHALL 删除对应缩略图文件与清单条目并立即落盘;清理缺失记录 SHALL 仅在文件确实已不在磁盘上时才动手。启动时 SHALL 对账:剔除清单中文件已不存在的条目,并删除既不被库内 `assets` 引用、也不在清单中的残留文件,以及不符合当前命名约定(无尺寸后缀或旧尺寸)的旧产物。

#### Scenario: 原图移动

- **WHEN** 库内素材被移动到另一文件夹
- **THEN** 缩略图文件保持不变,清单中的 `relPath` 更新为新路径

#### Scenario: 移入回收站

- **WHEN** 素材被移入回收站
- **THEN** 其缩略图与清单条目立即删除;恢复后重新生成

#### Scenario: 彻底删除

- **WHEN** 素材记录被彻底清除(清空回收站或单条彻底删除)
- **THEN** 其缩略图与清单条目一并删除

#### Scenario: 清理缺失记录时文件仍在

- **WHEN** 记录标记为缺失但原文件实际仍在磁盘上
- **THEN** 保留记录与其缩略图,不做删除

#### Scenario: 启动清理残留

- **WHEN** 应用启动且缓存目录存在旧命名或孤儿文件
- **THEN** 这些文件被删除,当前尺寸的有效缩略图保留

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

### Requirement: 缩略图参数受限

`media://` 缩略图请求的 `v` 参数 SHALL 只接受内容指纹格式。包含路径分隔符、`.`、`..` 或其它非法字符的值 SHALL 返回 403，SHALL NOT 参与文件路径拼接。

#### Scenario: 拒绝指纹路径穿越

- **WHEN** 请求携带 `v=../../Windows/file` 的缩略图参数
- **THEN** 协议返回 403，不读取或写入目标路径

### Requirement: Range suffix

`media://` 的 Range 解析 SHALL 按 HTTP 语义处理 `bytes=-N`，返回文件最后 N 字节；起始位置大于结束位置的请求 SHALL 返回 416，而不是返回 500。

#### Scenario: 请求最后一段

- **WHEN** 客户端请求 `bytes=-200`，文件大小为 1000 字节
- **THEN** 响应返回 801 到 999 字节

#### Scenario: 非法区间

- **WHEN** 客户端请求 `bytes=900-100`
- **THEN** 响应返回 416

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

# Proposal

## Why

当前扫描白名单只覆盖 14 种格式。素材库里的 AI、C4D、BLEND、PMD/PMX、HDR、EXR、常见视频容器和多数三维格式会被直接忽略，或虽然能入库却只有占位图。用户需要的是按能力分级支持：能入库、能生成缩略图、能在灯箱真实预览、需要外部软件时能明确降级，而不是把所有格式都伪装成“支持”。

本变更建立统一的格式能力层，先覆盖用户点名的专有格式和常见媒体格式，再用真实文件验证解码、缩略图、预览和失败降级。

## What Changes

- 扩展扫描白名单，并为每个扩展名登记类型、规范格式名、元数据探针、缩略图解码器、预览器和所需外部工具。
- 建立统一的解码优先级：原生解码（sharp/three）优先，`ffmpeg` 兜底，专用解析器其次，外部软件再次，最后才是格式占位图。
- 支持 Adobe Illustrator `AI` 的 PDF 兼容文件：生成首屏缩略图并支持灯箱内翻页预览；非 PDF 兼容的 AI 明确提示无法解析，不静默失败。
- 支持 `PSD` 合成图预览、`HEIC` 解码、`AVIF/TIFF/BMP/ICO/TGA` 等常见图片格式。
- 支持 `HDR`、`EXR` 的缩略图 tone mapping 和环境图真实预览。
- 支持 `PMD/PMX` 三维模型预览；补齐 `STL/PLY/3DS/DAE/USDZ/3MF/AMF/VRML` 等 three.js 已具备加载器的格式。
- 支持 `BLEND`：探测本机 Blender，调用 CLI 生成缩略图或转出可预览缓存；未安装时保留入库并提示安装/配置。
- 支持 `C4D`：探测本机 Cinema 4D；能调用其命令行渲染时生成缩略图，否则入库、占位并提供外部打开。C4D 没有公开解码器，不承诺内置真实预览。
- 扩展视频容器：`WebM/MKV/AVI/FLV/WMV/MPEG/TS/M4V` 等入库与抽帧；Chromium 不能直接播放的容器按需经 `ffmpeg` 转码为可播放缓存。
- 同步格式筛选菜单、卡片格式徽章和检查器能力提示，删除“PSD / AI”这类名不副实的合并项。
- 为每种能力增加真实样本验证：扫描入库、元数据、缩略图、灯箱预览、失败降级、重复打开缓存命中和解码进程不泄漏。
- 所有成功入库的格式继续共享同一套评级、标签、来源链接、备注、收藏、回收站和文件夹语义；元数据存储不按格式分叉。

**Non-goals**

- 不承诺 C4D、BLEND 的像素级一致渲染；结果取决于本机软件版本、授权和项目外部资源。
- 不实现 AI/PSD/BLEND/C4D 的可视化编辑，只做读取与预览。
- 不承诺所有 HDR/EXR 都做完整色彩管理；首版以可视预览和可预期降级为准。
- 不引入任意第三方格式插件市场。

## Capabilities

### New Capabilities

- `media-format-support`: 统一格式能力注册、解码优先级、外部工具探测、能力分级、失败状态和诊断信息。

### Modified Capabilities

- `library-scan`: 扩展扫描白名单，增加新格式的扩展名识别、元数据探测和增量监听。
- `thumbnails`: 按格式路由缩略图解码器，覆盖 AI/PSD/HEIC/EXR/HDR/新三维格式，并记录占位原因。
- `viewer-3d`: 扩展真实三维预览格式，增加 MMD、STL、PLY、3DS、DAE、USDZ、3MF、AMF、VRML、EXR/HDR 环境和外部 Blender/C4D 预览。
- `lightbox`: 增加 AI/PSD/HEIC/HDR/EXR 的详情展示，以及不兼容视频容器的按需转码播放。
- `asset-browser`: 格式筛选、徽章和能力提示与实际支持矩阵保持一致。
- `asset-store`: 明确所有入库格式共享评级、标签、来源链接、备注等元数据写入语义。

## Impact

- 主进程：`src/main/services/ignore.ts`、`scan.ts`、`thumbs.ts`、`media.ts`、`videoMeta.ts`、`libraryDb.ts`、`store.ts`，以及新的格式探测与外部工具服务。
- 渲染层：`Viewer3D.tsx`、`Lightbox.tsx`、`FilterBar.tsx`、`Card.tsx`、`data/query.ts`、`data/types.ts`。
- 依赖：新增 AI/PSD/HEIC/MMD 解码依赖；继续复用 `sharp`、`ffmpeg-static`、`three`。外部工具探测 Blender 和 Cinema 4D，不随应用打包。
- 缓存：缩略图继续放 `.mediahub/thumbs/`；转码缓存需要新增可重建目录，并随库目录携带。
- 测试：需要真实样本 fixtures 或用户提供的样片；覆盖解码成功、格式损坏、缺少外部工具、超时、超大文件和缓存命中。

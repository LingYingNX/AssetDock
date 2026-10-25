# Design

## Context

当前实现把格式判断集中在 `EXT_WHITELIST`，图片元数据依赖 `sharp`，视频依赖 `ffmpeg-static`，三维预览在渲染层按 GLB/FBX/OBJ 分支。这个结构适合少量格式，但新增 AI、BLEND、C4D、PMD/PMX、HDR/EXR 后会出现三类分叉：扫描器不认识文件、缩略图错误地把所有格式交给 `sharp`、灯箱和卡片各写一套格式判断。

本设计新增一个格式能力注册表，让扫描、缩略图、协议、灯箱和筛选共享同一份格式事实。数据库字段已经足够，不需要为格式扩展改 schema；所有格式继续使用同一条 `assets` 行和标签关联表。

## Goals / Non-Goals

**Goals:**

- 用一份注册表描述扩展名、规范格式、类型、探测方式、缩略图策略、预览策略和外部工具依赖。
- 覆盖用户点名的 AI、C4D、BLEND、PMD/PMX、HDR、EXR，以及常见图片、视频和 three.js 可加载的三维格式。
- 让每个格式都有明确的成功路径和降级路径，失败原因可区分、可缓存、可诊断。
- 保持元数据写入、便携库、回收站和 `media://` 安全边界不变。

**Non-Goals:**

- 不实现 C4D/BLEND 的原生二进制解析器。
- 不把 Blender 或 Cinema 4D 打包进应用。
- 不实现视频编辑、三维编辑或 AI/PSD 图层编辑。
- 不承诺所有专有格式在所有软件版本下渲染一致。

## Decisions

### 1. 统一格式能力注册表

在 `src/shared` 或主进程服务中建立只读注册表，条目至少包含：

```ts
interface FormatSpec {
  ext: string
  type: AssetKind
  format: string
  probe: 'sharp' | 'ffmpeg' | 'pdf' | 'psd' | 'heic' | 'external' | 'none'
  thumbnail: 'sharp' | 'ffmpeg' | 'pdf' | 'psd' | 'heic' | 'three' | 'external' | 'none'
  preview: 'image' | 'pdf' | 'video' | 'three' | 'envmap' | 'external' | 'none'
  external?: 'blender' | 'cinema4d'
}
```

扫描器、`thumbJobRows`、`media://`、格式筛选和灯箱都读取这份注册表，不再各自维护扩展名数组。

**替代方案**：为每个格式写一个 service。格式数量达到几十种时会产生大量重复的分支和测试，且容易让扫描与筛选漂移。

### 2. 解码优先级

固定顺序：

```text
原生解码 (sharp)
  -> 内置媒体工具 (ffmpeg)
  -> 专用解析器 (pdfjs / ag-psd / heic-convert)
  -> three.js loader
  -> 外部软件 (Blender / Cinema 4D)
  -> 格式占位图
```

每一级失败都记录原因，下一级仍可尝试。最终失败不是异常退出，而是带原因的可缓存占位结果。

**替代方案**：统一用 ffmpeg 解码所有格式。ffmpeg 不支持 AI、PSD、C4D、BLEND、PMD/PMX，也不适合作为三维 loader。

### 3. 图片与文档格式

- `AI`：用 `pdfjs-dist` 渲染页面。AI 文件只有在保存时勾选 PDF 兼容才可解析；非兼容文件显示明确错误。
- `PSD`：用 `ag-psd` 读取合成图；缺少合成图时显示占位，不尝试还原完整图层结构。
- `HEIC/HEIF`：优先 `heic-convert`（WASM/libheif）；失败后尝试 ffmpeg。当前 `sharp` 预编译只声明 AVIF，不把 HEIC 交给 sharp 猜测。
- `AVIF/TIFF/GIF/SVG`：继续使用 sharp。
- `BMP/ICO/TGA`：用 ffmpeg 解码并转 PNG，再交给 sharp 生成缩略图。
- `HDR/EXR`：缩略图由 ffmpeg 的 `zscale + tonemap` 转成 SDR PNG；灯箱用 three 的 `RGBELoader`/`EXRLoader` 作为环境图预览。

**替代方案**：重编译 sharp 带 PDF/HEIC/Magick 支持。会引入更大的原生构建和平台差异，且仍无法覆盖 AI 渲染。

### 4. 视频

- 扫描阶段只用 ffmpeg 读文件头，读取容器、编码、时长、分辨率、fps。
- 缩略图阶段用 ffmpeg 抽关键帧，失败回退首个可解码帧。
- Chromium 可直接播放的 MP4/WebM 继续走原文件。
- MKV/AVI/FLV/WMV/MPEG/TS 等容器按需转码为 H.264/AAC MP4，缓存到 `.mediahub/transcodes/<fingerprint>.mp4`。
- 同一指纹的转码任务去重；首次显示进度，完成后返回缓存 URL。

**替代方案**：所有视频统一预转码。会浪费大量磁盘和 CPU，且用户可能只看一次。

### 5. 三维

内置 loader：

- 现有：GLB/glTF、FBX、OBJ、STL、PLY、3DS、Collada、USDZ、3MF、AMF、VRML、VRM。
- MMD：优先 `@moeru/three-mmd`（peer 支持 three >= 0.184）；若 API 或渲染不达标，回退 `mmd-parser` 加最小加载层。
- HDR/EXR：作为环境图；不进入普通模型 loader。

BLEND：

- 探测本机 Blender，用 CLI 把 `.blend` 导出为 `.glb` 缓存，再走内置 GLB 预览和离屏缩略图。
- 缓存路径：`.mediahub/external/blend/<fingerprint>.glb`。
- Blender 版本无法打开文件时显示版本/资源错误，不删除原文件。

C4D：

- 探测本机 Cinema 4D，尝试其命令行渲染或用户配置的命令模板。
- 成功时缓存预览图；失败时保留入库、显示“需 Cinema 4D”和外部打开。
- 不承诺内置 C4D 解析。

### 6. 三维缩略图

复用现有 CSS 离屏渲染思路：新增受控的离屏页面，加载 three loader，按统一相机/环境/背景渲染一帧并截图。渲染窗口只在主进程预热或 miss 时创建，完成即释放。

**替代方案**：在主进程直接使用 headless WebGL。会新增另一套原生渲染栈，且和现有 Viewer3D 的材质/环境行为不一致。

### 7. 外部工具配置与探测

- 偏好中保存 Blender、Cinema 4D 可执行文件路径。
- 启动时不阻塞；首次需要时探测版本和可用性。
- 统一用 `execFile` 参数数组调用，不经过 shell，避免中文路径和注入问题。
- 超时、并发、输出大小均有上限。

### 8. 缓存与失败状态

```text
.mediahub/
  thumbs/                 # 现有 640px JPG
  previews/ai/            # AI 页面渲染缓存
  external/blend/         # BLEND 导出的 GLB
  transcodes/             # 视频转码缓存
```

缩略图清单继续按指纹索引，新增失败类别：

- `unsupported`：没有可用解码器
- `corrupt`：解析器确认文件损坏
- `timeout`：外部进程或解码超时
- `missing-tool`：缺少 Blender/Cinema 4D
- `too-large`：超过资源上限

失败状态与指纹绑定。文件内容变化后指纹变化，自动重新尝试。

### 9. 元数据不随格式分叉

格式扩展只改变扫描和预览能力。评级、标签、来源链接、备注、收藏、待审、回收站和文件夹继续写入当前库的 SQLite。没有任何格式获得独立 JSON 配置文件。

## Risks / Trade-offs

- [C4D 没有公开解码器] → 只承诺外部软件预览或占位；在 UI 明确显示依赖，不伪装成内置支持。
- [BLEND 依赖 Blender 版本] → 使用用户指定版本；失败时保留原文件并提供错误和外部打开。
- [MMD 生态库兼容性] → 先做 spike，验证 PMD/PMX 纹理、材质和 three 0.185；不达标时回退 `mmd-parser`。
- [HEIC WASM 解码慢] → 限并发、按指纹缓存、首次显示处理中状态。
- [HDR/EXR tone mapping 过曝] → 固定基础曝光和 tone mapping 参数，灯箱保留曝光调节。
- [视频转码占用 CPU/磁盘] → 只对不兼容容器按需转码，任务去重，限制并发，缓存可清空。
- [离屏三维渲染窗口崩溃] → 独立隐藏窗口、超时和窗口销毁兜底；失败只影响封面。
- [真实样本不足] → 实现前收集每类至少一个有效样本和一个损坏样本；无法获得的格式只声明能力，不声称已验证。

## Migration Plan

1. 先加入格式注册表和纯函数测试，不改变现有格式行为。
2. 扩展扫描白名单，旧库下次扫描即可发现新文件；数据库无需迁移。
3. 新增缩略图解码器并保留旧 `thumbs/` 缓存；新格式生成新指纹条目。
4. 新增预览路由，旧格式继续走现有路径。
5. 外部工具和转码缓存均为可重建派生数据；回滚时删除对应缓存目录即可。
6. 若新注册表导致行为异常，可按格式关闭能力项回退到占位，不影响元数据。

## Open Questions

- 用户能否提供真实样本目录，覆盖 AI（PDF 兼容与非兼容）、C4D、BLEND、PMD/PMX、HDR、EXR、以及至少一种 Chromium 不支持的视频容器？
- 本机 Blender 和 Cinema 4D 的实际安装路径与版本，需在实现 spike 时探测。

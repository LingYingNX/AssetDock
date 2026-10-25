# Format Support

验证日期：2026-10-25。验证环境：Windows、Electron 44、Blender 5.2.0；Cinema 4D 2024 已安装但 MaxonApp/授权不可用。

能力分为四级：

- 可预览：灯箱直接解码或由内置 three.js loader 渲染。
- 需转码：先缓存为 H.264/AAC MP4，再由灯箱播放。
- 需外部工具：应用负责探测、缓存可预览结果或明确降级，不嵌入外部软件窗口。
- 仅入库：保留素材与全部元数据，生成占位封面并说明原因。

## 图片

| 格式 | 入库 | 缩略图 | 灯箱预览 | 验证结果 |
| --- | --- | --- | --- | --- |
| JPG/JPEG、PNG | 是 | sharp | 原图 | JPG、JPEG 别名和 PNG 已通过 |
| WEBP、GIF、SVG、AVIF、TIFF | 是 | sharp | 原图 | 样本级解码通过；AVIF、TIFF 已真实加载 |
| HEIC/HEIF | 是 | heic-convert，失败回退 ffmpeg | 缓存大图预览 | 真实 HEIC（1280×854）已通过；HEIF 别名复用同一指纹缓存 |
| PSD | 是 | ag-psd 合成图 | 缓存大图合成预览 | 真实 PSD（1600×1000）已通过 |
| AI | 是 | pdfjs-dist | 首屏及多页翻页 | 2 页 PDF 兼容 AI 已通过 |
| HDR、EXR | 是 | ffmpeg tone mapping | RGBELoader/EXRLoader 环境图 | 有效样本、曝光和坏文件降级已通过 |
| BMP、ICO、TGA | 是 | ffmpeg 转 PNG | 640px 预览 | 三种真实样本均已通过 |

AI 只有保存 PDF 兼容数据时可分页预览；其它 AI 显示失败原因，并提供重试和系统外部打开。

PSD/HEIC 的灯箱大图不复用卡片的 640px 缓存：首次打开按需解码到 `.mediahub/previews/images/<fingerprint>.jpg`（最长边 2400px、原子写、任务去重），之后直接命中缓存；卡片仍是 640px JPEG。

## 视频

| 格式 | 入库与探测 | 灯箱路径 | 验证结果 |
| --- | --- | --- | --- |
| MP4、WebM | ffmpeg | Chromium 直接播放 | 真实样本通过 |
| MKV、MOV、AVI、FLV、WMV、MP4V、MPEG/MPG、TS | ffmpeg | 按需转码为缓存 MP4 | MKV、MOV 已在应用内验证；其余容器已有真实 metadata 单元测试 |

转码按内容指纹去重，并发请求复用同一任务，缓存位于 `.mediahub/transcodes/`。失败时显示 ffmpeg 原因，并提供重试和系统外部打开。

## 三维

| 格式 | 加载器 | 卡片封面 | 灯箱 | 验证结果 |
| --- | --- | --- | --- | --- |
| GLB、glTF | GLTFLoader + Draco | 离屏 three.js | 真实预览 | GLB、内嵌 glTF、外链 buffer glTF 通过 |
| FBX、OBJ + MTL | FBXLoader、OBJLoader/MTLLoader | 离屏 three.js | 真实预览 | 通过 |
| PMD、PMX | @moeru/three-mmd | 离屏 three.js | 真实预览 | 真实 PMD/PMX 通过；英文与日文文件名、日文目录均通过；封面与灯箱按 rest pose 顶点包围盒取景 |
| STL、PLY、3DS、DAE、USDZ、3MF、AMF、VRML/WRL、VRM | three.js 对应 loader | 离屏 three.js | 真实预览 | 每个格式至少一个真实样本通过 |
| BLEND | 本机 Blender CLI 导出 GLB | Blender + 离屏 three.js | 缓存 GLB | Blender 5.2 真实文件通过 |
| C4D | 无内置解析器 | 占位 | 外部软件 | 仅验证不可用降级；没有可用授权与真实 C4D 文件，真实预览未验证 |

三维缩略图固定为 640px JPEG，使用深灰棚底和统一相机取景。PMX 的绝对 morph target 不参与默认取景，避免极端变形值把 rest pose 模型缩成一条；三维封面记录 renderer 版本，取景规则变化时自动重建旧缓存。内置预览限制为 512MB、20 秒加载；环境图限制为 512MB、30 秒加载。解析失败会释放 WebGL canvas。

## 验证矩阵

数据来自隔离验证实例（独立样本库 + 独立 userData），逐项在渲染层真实打开并断言，不是单元测试推断。

| 样本 | 格式 | 缩略图 | 灯箱 | 实测结果 |
| --- | --- | --- | --- | --- |
| `example.heic`（libheif 样本） | HEIC | 640×427 JPEG | 1280×854 缓存大图 | 通过 |
| `photo.heif` | HEIC | 同指纹复用 | 同上 | 通过（别名归一） |
| `art.psd`（1600×1000） | PSD | 640px 合成图 | `?imagePreview=1` 1600×1000 | 通过 |
| `poster.ai`（PDF 兼容，2 页） | AI | 640×384 | 分页预览 | 通过 |
| `poster.avif`、`scan.tiff` | AVIF、TIFF | 640×360 | 原图 | 通过 |
| `legacy.bmp`、`legacy.tga`、`icon.ico` | BMP、TGA、ICO | 640×360、640×360、640×640 | 640px 预览 | 通过 |
| `light.hdr`、`render.exr` | HDR、EXR | 640×360 tone mapping | 环境球 + 曝光 | 通过 |
| `clip.mkv`、`clip.avi` | MKV、AVI | 关键帧 640px | 转码后播放（readyState=4、可 seek） | 通过 |
| `miku_v2.pmd` | PMD | 离屏 three.js | 真实网格，17 材质 | 通过 |
| `Alicia_blade.pmx` | PMX | 离屏 three.js | 真实网格，7 材质 | 通过 |
| `日本語素材/アリシア.pmx` | PMX | 离屏 three.js | 日文文件名与日文目录解析正常 | 通过 |
| `notex/Alicia_notex.pmx`（移除贴图） | PMX | 离屏 three.js | 几何保留，材质降级不崩溃 | 通过 |
| `broken-model.pmx` | PMX | 占位 | 「3D 模型加载失败」，无残留 canvas | 通过 |
| `portalgun.3ds` | 3DS | 离屏 three.js | 真实网格 | 通过 |
| `saeukkang.usdz` | USDZ | 离屏 three.js | 真实网格 | 通过 |
| `cube_gears.3mf` | 3MF | 离屏 three.js | 真实网格，17 材质 | 通过 |
| `house.wrl` | VRML | 离屏 three.js | 真实网格，138 材质 | 通过 |
| `twist.vrm` | VRM | 离屏 three.js | 真实网格，13 材质 | 通过 |
| `scene.blend` | BLEND | Blender 导出 GLB 后离屏 | 缓存 GLB 预览 | 通过 |
| `model.c4d` | C4D | 占位 | 「需 Cinema 4D」+ 外部打开入口 | 通过（仅降级路径） |
| `e2e-huge.glb`（644MB） | GLB | 占位 | 拒绝加载并提示失败 | 通过（体积上限） |

未验证项：

- HEIC 之外的 HEIF 容器变体（多 `hevc` item、缺少缩略图 item 等）没有独立样本，本机只有同一个 libheif 样本。
- C4D 有效工程文件：本机无可用授权，无法产生真实预览缓存。
- PMX 引用**日文纹理文件名**：已验证日文模型名与日文目录，样本贴图名仍是 ASCII（`eyeM2.bmp`）。
- 三维 20 秒加载超时:隔离实例中把 GLB 请求替换为永不落地的 fetch,逐秒采样显示 19.6s 仍在加载、20.6s 转为「3D 模型加载失败」;解除拦截后同一文件可正常重开。
- 缩略图失败类别的 `timeout` 分类没有真实样本：已实测 `corrupt`（`broken.psd`、`broken.exr`、`bad.ai`、`bad.mkv`、`broken-model.pmx`）与 `missing-tool`（`scene.blend`、`scene.c4d`）。
- 视频转码超时未单独用超长视频触发；`runFfmpeg` 的超时终止有单元测试（`tests/ffmpeg.test.ts`），转码层复用同一封装。取消、磁盘失败、分辨率上限分别有测试与实测。

## 元数据与缓存

所有格式共用 `<库>/.mediahub/library.db` 中的同一条 `assets` 记录和 `asset_tags` 关联。评级、收藏、备注、来源链接、回收站与文件夹不按格式分叉，也不写回原素材文件。

可重建派生数据：

- `.mediahub/thumbs/`：640px JPEG 和失败记录。
- `.mediahub/previews/ai/`：AI 页面缓存。
- `.mediahub/previews/images/`：PSD/HEIC 灯箱大图缓存（最长边 2400px）。
- `.mediahub/external/blend/`：Blender 导出的 GLB。
- `.mediahub/transcodes/`：视频播放缓存。

删除派生目录不会删除素材，也不会丢失标签、备注或评级。

## 已知边界

- 格式内编码仍可能损坏或使用罕见 profile；失败按文件内容指纹缓存，文件变化后自动重试。
- MMD 缺少外部贴图时保留几何，但不能凭空恢复纹理。
- BLEND/C4D 的渲染结果取决于本机软件版本、授权和工程外部资源。

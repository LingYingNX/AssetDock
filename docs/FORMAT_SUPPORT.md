# Format Support

验证日期：2026-10-27。验证环境：Windows、Electron 44、Blender 5.2.0；Cinema 4D 2024 已安装但 MaxonApp/授权不可用。

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

## 文档

| 格式 | 入库与探测 | 缩略图 | 灯箱预览 | 实测结果 |
| --- | --- | --- | --- | --- |
| TXT | UTF-8、UTF-8 BOM、UTF-16、GB18030 识别 | 首段文本 640×480 JPEG | 只读文本滚动 | 中文 UTF-8 BOM 样本通过 |
| Markdown | UTF-8 等编码识别 | 首屏静态 HTML 640×480 | 表格、代码、标题与库内图片 | 含表格、相对图片与脚本的样本通过；脚本被清理，相对图片内联为 `data:` |
| CSV | 分隔符探测、RFC 4180 引号与换行 | 首个表格区域 640×480 | 真实表格 | 含逗号、双引号与嵌入换行的样本通过 |
| DOC | OLE/CFB Word 二进制解析 | 首页 HTML 640×480 | `@file-viewer/doc` 静态 HTML | 3 份真实中文样本通过；22 表、6 图与单图样本均正常，不依赖 Office/WPS/LibreOffice |
| DOCX/DOCM | OOXML 解包与页数探测 | 首页 HTML 640×480 | `docx-preview` 静态 HTML | Apache POI 真实 DOCX（表格、页眉页脚、页眉图片、多级列表、3–4 页）与 `SimpleMacro.docm` 通过；页数按渲染 `section` 校准 |
| XLSX/XLSM | ExcelJS 读取工作表 | 首个工作表 640×480 | 真实表格、合并单元格、样式与标签切换 | 真实工作簿 SampleSS（3 表）、with_table、WithChart 与 `45431.xlsm` 通过；合并区域超限与不支持的过滤特性分别降级 |
| PPTX/PPTM | `pptx2json` 幻灯片模型 | 首张幻灯片 640×480 | 坐标定位静态页面与翻页 | 真实 PPTX（SampleShow、sample、table_test、pie-chart）与 `SimpleMacro.pptm` 通过；3 页样本翻页与缩放通过 |
| XLS/XLSB/ODS/FODS | SheetJS CE 0.20.3 读取 | 首个工作表 640×480 | 同 XLSX 的表格与工作表标签 | 爱给网真实 `.xls`（10 表 3369 格、1 表 968 格）与 Apache POI `SampleSS.ods`（3 表）通过；保真上限见下方说明 |
| RTF | 自研 RTF 子集解析（无第三方依赖） | 首页 HTML 640×480 | 段落、表格、内嵌 PNG/JPEG、字体与颜色 | 5 份真实 RTF（含 22 表临床报告、中文 GBK 说明文档、中文许可协议）通过；WMF/EMF 图片跳过 |
| ODT/OTT | 自研 `content.xml` 解析 | 首页 HTML 640×480 | 标题、段落样式、列表、表格、库内图片 | LibreOffice 官方测试样本（普通表、合并单元格、边框表、`tdf151375.ott`）通过 |
| ODP | 自研 `content.xml` 解析 | 首张幻灯片 640×480 | 按坐标定位的静态页面与翻页 | LibreOffice 官方测试样本（文本框、嵌入图片）通过；页面尺寸按母版取 28×15.75cm |

SheetJS 社区版只暴露填充色与数字格式，字体、边框与对齐读不到，因此 `.xls/.xlsb/.ods/.fods` 的保真度低于 `.xlsx`，这是依赖能力上限而不是渲染遗漏。

文档预览缓存位于 `.mediahub/previews/documents/<fingerprint>/preview.json`，缩略图仍写入 `.mediahub/thumbs/`。失败类别包括 `corrupt`、`encrypted`、`missing-tool`、`too-large`、`timeout`、`unsupported`；失败按内容指纹缓存，显式重试会绕过失败缓存。

文档预览交互：全部文档类型支持 50%–300% 缩放（步进 25%）、适应窗口与重置（双击内容或按 `0`），`+`/`-` 也可缩放。XLSX 用 `←`/`→` 切换工作表，PPTX 用 `←`/`→` 翻页；工作表标签、页码与缩放胶囊保持固定尺寸，不随内容缩放。XLSX 表格放大后可同时横向与纵向滚动，PPTX 放大后溢出部分可滚动到左上角；DOCX 与 Markdown 在 iframe 内重排并保持自身滚动。

硬上限：OOXML 文件 128 MB、旧版 DOC 64 MB、解压总量 512 MB、压缩包条目 5000、文本 16 MB / 400 万字符、工作表 64 / 2000 行 / 200 列 / 10 万单元格、合并区域 2000、幻灯片 300 / 元素 3000、文档 HTML 12 MB、单次解析 30 秒。DOC 单张内嵌图片限制 16 MB；超限文件在进入解析器前快速降级，避免主进程被长时间占用；DOCX 解析串行执行，缩略图预热共用队列并发闸。

扫描期只做低成本结构探测（DOCX 按分页符、XLSX 按工作表、PPTX 按幻灯片计数）。灯箱首次解析成功后，用实际渲染结果回写 `page_count`/`sheet_count`/`slide_count` 并推送一次增量事件，因此卡片与灯箱的结构信息会按解析结果校准。

第二阶段已内置 `DOC`（`@file-viewer/doc`）、`XLS/XLSB/ODS/FODS`（SheetJS）、`RTF`、`ODT`、`ODP`。`PPT/WPS/ET/DPS` 仍走外部转换器路径：本机没有安装 Microsoft Office、WPS 或 LibreOffice，灯箱显示「缺少可用的外部办公软件转换器」、重试与外部打开，不宣称已能转换预览。`.et` 需要 1 个真实 WPS 表格样本才能确认 SheetJS 的 CFB `/Workbook` 读取路径，当前没有样本，保持外部档；`.dps` 同理。旧版 DOC 不采用约 242 MB 的 LibreOffice WASM，因为不符合随应用少量嵌入依赖的目标。

第二阶段新增硬上限：ODF `content.xml` 64 MB、单文档 8 万节点、2 万单元格（重复列按 50 次封顶）、RTF 32 MB、单张 RTF 图片 8 MB、渲染 HTML 12 MB，仍共用 30 秒超时。

## 文档渲染依赖

| 依赖 | 版本 | 许可证 | node_modules 体积 |
| --- | --- | --- | --- |
| docx-preview | 0.4.1 | Apache-2.0 | 955 KB |
| linkedom | 0.18.14 | ISC | 2.4 MB |
| exceljs | 4.4.0 | MIT | 21.4 MB |
| pptx2json | 0.0.10 | MIT | 4.8 MB |
| markdown-it | 15.0.3 | MIT | 2.0 MB |
| sanitize-html | 2.18.1 | MIT | 83 KB |
| jszip | 3.10.2 | MIT OR GPL-3.0-or-later | 1.6 MB |
| @xmldom/xmldom | 0.9.12 | MIT | 430 KB |
| @file-viewer/doc | 3.3.0 | MIT | 333 KB |
| xlsx（官方 CDN 发行版） | 0.20.3 | Apache-2.0 | 7.7 MB |

`docx-preview` 需要全局 `window`/`document`/`FileReader`，主进程用 linkedom 提供 DOM 并在 `finally` 中恢复原全局；文件内图片按 `useBase64URL` 转为 `data:`，避免把 `blob:` 地址带进沙箱 iframe。

ODT/ODP/RTF 为自研解析，不新增依赖。评估过的 `officeparser` 8.3.0 解包 34.5 MB：ODT 表格单元格文本会丢空、ODP 只输出文本流没有坐标，达不到「打开是什么样、预览就大概是什么样」的要求，因此未采用。

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
| `说明.txt`（UTF-8 BOM） | TXT | 640×480 JPEG | 只读文本 | 通过 |
| `notes/README.md`（表格、相对图片、脚本） | Markdown | 640×480 JPEG | 表格与内联图片 | 通过；脚本未执行 |
| `data.csv`（引号与嵌入换行） | CSV | 640×480 JPEG | 真实表格 | 通过 |
| `plan.docx`（标题、表格、分页） | DOCX | 640×480 JPEG | 静态 HTML，2 页 | 通过；页数回写后卡片同步为 2 |
| `book.xlsx`（2 表、合并单元格、样式） | XLSX | 640×480 JPEG | 工作表标签切换 | 通过 |
| `deck.pptx`（3 页，含图片） | PPTX | 640×480 JPEG | 页码 1/3 → 2/3 | 通过 |
| `legacy.doc`（文本伪装样本） | DOC | 占位 | 「文档损坏或格式不受支持」+ 重试/外部打开 | 通过（损坏分类） |
| `SampleDoc.docx`（Apache POI 真实样本） | DOCX | 640×480 JPEG | 3 个渲染 section | 通过；扫描期 4 页被解析结果校准为 3 页 |
| `Bug66263-table.docx`、`TestTableColumns.docx` | DOCX | 640×480 JPEG | 真实表格 | 通过 |
| `DiffFirstPageHeadFoot.docx`、`ThreeColHeadFoot.docx`、`HeaderFooterUnicode.docx` | DOCX | 640×480 JPEG | 分页页眉页脚 | 通过 |
| `headerPic.docx`（页眉图片） | DOCX | 640×480 JPEG | 页眉内 `data:image/jpeg` | 通过（FileReader shim 修复前图片无 `src`） |
| `ComplexNumberedLists.docx`、`protected_sample.docx` | DOCX | 640×480 JPEG | 多级列表、受保护文档 | 通过 |
| `SampleSS.xlsx`（3 个工作表） | XLSX | 640×480 JPEG | 3 个标签、表格内容 | 通过 |
| `tall.xlsx`（2500 行）、`wide.xlsx`（300 列） | XLSX | 640×480 JPEG | 截断到 2000 行 / 200 列 | 通过；放大 250% 后纵向可滚动 135183px |
| `many-merges.xlsx`（5 万个合并区域） | XLSX | 占位 | 「文档超过预览资源上限」+ 重试/外部打开 | 通过（解析前拦截，未占用主进程） |
| `ConditionalFormattingSamples.xlsx`（iconFilter） | XLSX | 占位 | 「文档包含暂不支持的预览特性」 | 通过（18 个工作表仍完整入库） |
| `locked.xlsx`（CFB 容器） | XLSX | 占位 | 「文档已加密，需要密码」 | 通过 |
| `huge.docx` / `huge.xlsx` / `huge.pptx`（129 MB） | 三种 | 占位 | 「文档超过预览资源上限」 | 通过（<0.3 s 降级） |
| `broken.docx` / `broken.xlsx` / `broken.pptx` | 三种 | 占位 | 「文档损坏或格式不受支持」 | 通过（无空白舞台） |
| `SampleShow.pptx`、`sample.pptx`（各 2 页） | PPTX | 640×480 JPEG | 页码与 2 页翻页 | 通过 |
| `table_test.pptx` | PPTX | 640×480 JPEG | 幻灯片内表格按坐标渲染 | 通过 |
| `pie-chart.pptx` | PPTX | 640×480 JPEG | 图表页降级为形状 + 文本 | 通过 |

第二阶段内置格式实测（2026-10-28，样本在 `artifacts/research/samples/`，全部经 `ensureDocumentPreview` 生产路径解析）：

| 样本 | 格式 | 解析结果 | 耗时 |
| --- | --- | --- | --- |
| `aigei-xls-finance.xls` | XLS | 10 个工作表、3369 个单元格、2202 个带样式 | 186 ms |
| `aigei-xls-sop.xls` | XLS | 1 个工作表、968 个单元格 | 79 ms |
| `poi-SampleSS.ods` | ODS | 3 个工作表（SheetJS 报告 3 处条件格式数字格式不支持，降级为数值） | 17 ms |
| `lo-feature_table*.odt` | ODT | 表格结构正确（`Hello`/`World`、合并单元格、边框表都在单元格内） | 6–9 ms |
| `lo-slide_with_text.odp` | ODP | 页面 1058×595、2 个元素，正文三段列表完整 | 32 ms |
| `lo-media_embedding.odp` | ODP | 页面 1058×794、4 个元素，含 1 张嵌入图片 | 33 ms |
| `rtf-r2rtf-ae_example.rtf` | RTF | 22 张表、段落样式与字号保留 | 16 ms |
| `rtf-duivision-test.rtf` | RTF | 8 张表、775 个汉字、1 张 PNG | 43 ms |
| `rtf-zh-chromego-readme.rtf` | RTF | 487 个汉字（GBK 代码页）、1 张 PNG | 13 ms |
| `rtf-zh-inno-license.rtf` | RTF | 1426 个汉字、无表格 | 11 ms |
| `rtf-sample-basic.rtf` | RTF | 5 张表；3 张图为 WMF，按设计跳过 | 14 ms |
| `aigei-doc-contract.doc` | DOC | 1 张表、中文正文、37.8 KB HTML | 54 ms |
| `aigei-doc-tables.doc` | DOC | 22 张表、6 张内嵌图片、1.2 MB HTML、1 条降级警告 | 427 ms |
| `sample.doc` | DOC | 1 张表、1 张图片、166 KB HTML | 25 ms |

另用真实 Chromium 渲染合并页面复查（与应用同款 CSS 与幻灯片定位规则）：ODT 边框表、中文 RTF（标题居中、加粗、链接色、二维码图片）、ODP 嵌入图片页与 ODP 项目符号页版式均正确；列表项显示为 `•`。

真实窗口复查（2026-10-28，`npm run build` 产物 + 隔离 `MEDIAHUB_TEST_USER_DATA` + 独立素材库）：

- 双击入灯箱：RTF/ODT/OTT/DOCM 走 `iframe.doc-frame`，ODP 走 `.doc-slide`，XLS/XLSM 走 `.doc-sheet-table`。
- `aigei-xls-finance.xls`：10 个中文工作表标签；切到「资产负债表」后单元格从 8888 变为 563，底部出现超限截断提示。
- `lo-AllTransitions-fresh.odp`：76 页；页码 `1 / 76`，按方向键后为 `2 / 76`。
- 11 个文档都生成了 640px JPEG 缩略图（RTF 中文页、ODP 首页、XLS 表页都有内容，不是空白占位）。
- 损坏 `.rtf` / `.odt`：显示「文档损坏或格式不受支持」与 `重试`/`外部打开`，没有空白舞台；修复后重开可恢复，`assets:preparePreview({force:true})` 直接返回 `kind=document`。
- ODP 扫描探测修正：`<draw:page-thumbnail` 不再被算作一页（同一文件旧记录 152 → 修正后 76），回归用例见 `tests/documentMeta.test.ts`。
- 截图留在 `artifacts/doc-preview-verify-20261028/`（gitignored，不入库）。

旧版 DOC 真实窗口复查（2026-10-28，`npm run build` 产物 + 独立 userData / 素材库）：

- 三份 `.doc` 均扫描为 `document` / `DOC`，卡片缩略图加载为 640×480 JPEG，检查器显示“内置只读预览”，没有外部工具缺失提示。
- `aigei-doc-contract.doc` 灯箱显示中文合同、标题、段落与表格；`aigei-doc-tables.doc` 显示封面、109 个分页标记、22 张表和 6 张内嵌图片，首屏不再被前导空段落占满；`sample.doc` 保留 1 张表、1 张图片和分页。
- 三份 DOC 的生成 HTML 均未包含 `<script>`、`@import` 或 CSS `url()`；`aigei-doc-tables.doc` 的文本框定位降级警告保留在 `unsupported` 字段。
- 追加 21 B 的损坏 `.doc` 后，灯箱显示“文档损坏或格式不受支持”、解析器详情与“重试/外部打开”；点击重试仍稳定回到同一失败态，没有空白舞台。
- 重启隔离实例后复用原 `preview.json`（`generatedAt` 与文件时间不变），缓存命中耗时约 3–11 ms；缩略图缓存仍为 640×480。
- 验证中发现生产 `file://` 页面请求 `media://` 时 Chromium 清空 Referer，导致所有卡片缩略图 403；`media.ts` 已改为仅在生产文档允许空 Referer，dev 仍要求精确 origin，修复后三张缩略图与灯箱胶片带均加载成功。
- 截图与隔离库留在 `artifacts/doc-ui-verify-20261028065458/`（gitignored，不入库）。

未验证项：

- HEIC 之外的 HEIF 容器变体（多 `hevc` item、缺少缩略图 item 等）没有独立样本，本机只有同一个 libheif 样本。
- C4D 有效工程文件：本机无可用授权，无法产生真实预览缓存。
- PMX 引用**日文纹理文件名**：已验证日文模型名与日文目录，样本贴图名仍是 ASCII（`eyeM2.bmp`）。
- 三维 20 秒加载超时:隔离实例中把 GLB 请求替换为永不落地的 fetch,逐秒采样显示 19.6s 仍在加载、20.6s 转为「3D 模型加载失败」;解除拦截后同一文件可正常重开。
- 缩略图失败类别的 `timeout` 分类没有真实样本：已实测 `corrupt`（`broken.psd`、`broken.exr`、`bad.ai`、`bad.mkv`、`broken-model.pmx`）与 `missing-tool`（`scene.blend`、`scene.c4d`）。
- 视频转码超时未单独用超长视频触发；`runFfmpeg` 的超时终止有单元测试（`tests/ffmpeg.test.ts`），转码层复用同一封装。取消、磁盘失败、分辨率上限分别有测试与实测。
- 真实 Office 样本取自 Apache POI 测试数据（由 Word/Excel/PowerPoint 导出）；简单 `.docm/.pptm` 已验证静态内容，但复杂宏项目、ActiveX、SmartArt、嵌入 OLE 对象与图表数据系列仍缺专项样本。
- 加密样本文档用 OLE/CFB 容器头构造（与 Office 密码保护容器一致），没有用真实密码文件交叉验证解密外的其它分支。
- 文档解析超时分类由 30 秒 `Promise.race` 保证 UI 不会无限加载；隔离实例中出现过一次真实超时提示（前序大表阻塞事件循环导致），但没有独立的慢解析样本复验。
- `DOC` 的页眉页脚、脚注、批注、文本框精确定位与复杂浮动对象没有逐项保真承诺；当前保留解析器可恢复的正文、基础样式、表格、图片与分页信息。
- `PPT/WPS/ET/DPS` 外部转换路径未验证；本机没有 Microsoft Office、WPS 或 LibreOffice。
- `.et` 没有真实样本，未纳入内置档；SheetJS 的 CFB `/Workbook` 读取路径对 WPS 表格未实测。
- `.dps` 没有真实样本，仍为 `inventory-only`。
- ODT/ODP 只用 LibreOffice 官方英文测试样本验证过结构与版式；中文 ODF 的 `style:font-name-asian`、ruby 与竖排没有专项样本。
- RTF 只覆盖段落、字符格式、颜色/高亮、超链接文本、表格与 PNG/JPEG；WMF/EMF 图片、脚注、批注、嵌套表格、纵向合并不渲染。

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

# Proposal

## Why

素材库目前只识别图片、视频、三维与 CSS。TXT、Markdown、CSV、Office 和 WPS 文档即使放入库目录也不会入库，用户无法在应用内快速查看其结构。用户需要的是只读、结构可信的便捷浏览，不是编辑，也不是把表格降级成纯文本。

## What Changes

- 新增 `document` 资产类型，覆盖 `TXT`、`MD`、`CSV`、`DOC`、`DOCX`、`XLSX`、`PPTX`。
- 第一阶段使用内置只读解析器：TXT 自动识别编码；Markdown 渲染为静态排版；CSV 渲染为真实表格；DOCX 保留标题、段落、列表、表格、图片、页眉页脚；XLSX 保留工作表、合并单元格、列宽、数字格式与常用样式；PPTX 按幻灯片显示静态页面。
- 文档卡片、缩略图、检查器、格式筛选和灯箱支持文档类型。缩略图分别取文档首页、第一张工作表或第一张幻灯片。
- 文档预览继续经 `media://` 读取库内文件，在隔离 iframe 或静态页面中展示。禁止执行文档脚本、宏、事件处理器、外部网络请求与任意文件访问。
- 文档默认只读，不提供保存、回写原文件、编辑公式或执行宏。
- 第二阶段先扩大内置范围：`DOC` 使用随应用打包的 MIT 解析器生成受控静态 HTML，`XLS` 使用 SheetJS，`RTF`、`ODT`、`ODS`、`ODP` 继续使用已有内置解析器。最终用户不需要安装 Office、WPS 或 LibreOffice。
- 仍依赖外部办公软件的格式收敛为 `PPT`、`WPS`、`ET`、`DPS`；应用允许配置 WPS、Microsoft Office 或 LibreOffice，转为 PDF 后复用现有页面渲染链路。
- 外部转换器不可用、文档加密、损坏、超时或超过资源上限时，保留素材入库并提供可区分说明、重试与外部打开入口，不得伪装成成功预览。
- 文档不参与图片形状与尺寸筛选；格式、评分、标签、收藏、回收站和搜索语义与现有素材一致。

## Capabilities

### New Capabilities

- `document-preview`: 文档格式注册、只读解析、页面导航、缩略图来源、外部转换器、失败降级与安全边界。

### Modified Capabilities

- `library-scan`: 扫描、监听与拖入导入接受文档扩展名，并为文档采集可获得的页数、工作表数、幻灯片数等元数据。
- `thumbnails`: 文档缩略图按首页、首个工作表或首张幻灯片生成，并纳入指纹缓存、失败记录和清理流程。
- `lightbox`: 双击文档后进入只读文档舞台，支持页/工作表/幻灯片切换、缩放、重试与外部打开。
- `asset-browser`: 增加文档分组与格式筛选，定义文档卡片信息，并让文档豁免图片形状与尺寸筛选。

## Impact

- 共享格式与类型：`src/shared/formats.ts`、`src/shared/types.ts`。
- 扫描与导入：`src/main/services/ignore.ts`、`scan.ts`、`watch.ts`、`fileImport.ts`、`store.ts`。
- 预览与缓存：新增文档解析/转换服务；调整 `thumbnails`、`thumbs.ts`、`media.ts`、`ipc/assets.ts`、`preload/index.ts`。
- 渲染层：`Lightbox.tsx`、`Card.tsx`、`Filmstrip.tsx`、`FilterBar.tsx`、`Inspector.tsx`、`data/query.ts`、`data/types.ts` 与样式。
- 依赖：第一阶段新增 DOCX、XLSX、PPTX 与 Markdown 的只读解析依赖；第二阶段新增体积约 333 KB 的 `@file-viewer/doc` 解析器用于旧版 Word。Office、WPS、LibreOffice 本体不随应用打包。
- 数据：继续使用现有 `assets` 行与标签关联表，不新增旁路元数据文件；文档派生预览缓存可随时重建。
- 验证：必须使用真实 TXT、Markdown、CSV、DOC、DOCX、XLSX、PPTX 样本；`PPT/WPS/ET/DPS` 的外部转换器路径需在安装对应软件的机器上单独验证。当前机器未探测到 Office、WPS 或 LibreOffice，因此这些外部路径不能提前宣称通过。

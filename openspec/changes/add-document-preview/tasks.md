# Tasks

## 1. 格式注册与资产链路

- [x] 1.1 在 `src/shared/types.ts` 增加 `document` 资产类型，在 `src/shared/formats.ts` 注册 `TXT/MD/MARKDOWN/CSV/DOCX/XLSX/PPTX` 及预览形态；运行 `npm run test -- tests/formats.test.ts` 验证扩展名、别名、去重与分组
- [x] 1.2 扩展扫描、监听与拖入导入，使文档与现有素材共用 `detectKind`；运行 `npm run test -- tests/ignore.test.ts tests/scanFormats.test.ts tests/fileImport.test.ts` 验证新增、修改、删除与导入
- [x] 1.3 更新缩略图预热查询、资产列表映射、卡片类型与检查器类型，使 `document` 不落入图片分支；运行 `npm run typecheck` 验证共享类型与渲染层同步
- [x] 1.4 为文档扫描增加有界元数据探测：页数、工作表数、幻灯片数、文本编码；用真实 TXT、DOCX、XLSX、PPTX 样本验证探测结果，损坏或加密文件留空字段且不阻断扫描

## 2. 文本、Markdown 与 CSV

- [x] 2.1 实现带资源上限的文本解码与只读文本视图，覆盖 UTF-8、UTF-8 BOM、UTF-16 与常见本地编码；用中文样本验证无乱码
- [x] 2.2 实现 Markdown 静态渲染，保留标题、列表、引用、代码块、表格与本地图片，禁用原始 HTML 与脚本；用含表格和图片的真实 Markdown 样本验证
- [x] 2.3 实现 CSV 解析与真实表格视图，覆盖逗号、引号、双引号转义、嵌入换行和空单元格；运行新增的 CSV 单元测试并打开真实样本验证
- [x] 2.4 为文本类文档建立解析失败、编码失败、超限与空文件状态，并在灯箱显示可重试提示；用损坏或超限样本验证不无限加载

## 3. DOCX

- [x] 3.1 接入 DOCX 只读解析依赖并验证 Electron 主进程、Node 测试与 Vite 构建均可加载；记录安装体积与许可证，不修改无关依赖
- [x] 3.2 将 DOCX 转为受控静态 HTML，保留标题、段落、列表、表格、图片、页眉、页脚与分页；用真实 DOCX 样本验证结构和图片
- [x] 3.3 对生成 HTML 执行白名单清理与 CSP 隔离，禁止脚本、事件属性、远程图片和外部导航；用恶意 HTML/脚本文档验证不执行
- [x] 3.4 实现 DOCX 失败分类与缓存，区分损坏、加密、超时与资源超限；连续打开同一损坏文件验证第二次命中失败缓存

## 4. XLSX

- [x] 4.1 接入 XLSX 只读解析依赖并验证构建；用真实工作簿验证多工作表、单元格值与数字格式
- [x] 4.2 建立有行数、列数和单元格数量上限的工作表模型，保留合并单元格、列宽、对齐、字体、字号、字重、颜色与边框；用含合并单元格和样式的真实样本验证
- [x] 4.3 实现 XLSX 真实表格视图与工作表标签切换，禁止公式重算和编辑；验证切换工作表、滚动大表和重置缩放
- [x] 4.4 为超大工作簿、加密工作簿和损坏工作簿实现可区分降级；用超限和加密样本验证保留素材记录与元数据

## 5. PPTX

- [x] 5.1 建立 PPTX OOXML 包解析与幻灯片模型，读取幻灯片顺序、页面尺寸、文本、图片、表格和常用形状；用真实 PPTX 样本验证页数与页面顺序
- [x] 5.2 实现按幻灯片坐标定位的静态页面渲染，保留文本框、图片、表格、基础填充和几何；对不支持的效果显示可读降级，不得退化为整页纯文本
- [x] 5.3 实现上一张、下一张、页码与缩放控制；用多页真实 PPTX 验证翻页和重置缩放
- [x] 5.4 实现 PPTX 解析超时、损坏与资源超限状态；用损坏样本验证不残留空白舞台

## 6. 文档缩略图与缓存

- [x] 6.1 实现文档缩略图路由：TXT/Markdown/DOCX 取开头或首页，CSV/XLSX 取第一张工作表，PPTX 取第一张幻灯片；用真实样本验证输出为 640px JPG
- [x] 6.2 将文档预览与缩略图缓存写入 `.mediahub/previews/documents/<fingerprint>/`，记录渲染器版本、页数、工作表数、幻灯片数和失败类别；验证内容或渲染器变化后重建
- [x] 6.3 将文档缩略图纳入清单、进度、回收站清理与孤儿回收；验证清空回收站只删派生缓存、不删原始文档
- [x] 6.4 对解析并发、解压总量、文件大小、页数、单元格数和超时设置硬上限；用超限样本验证主进程不阻塞、内存不失控

## 7. 灯箱、卡片、筛选与检查器

- [x] 7.1 在灯箱增加文档舞台，接入加载中、成功、失败、重试与外部打开；验证文档打开不会落入图片或视频分支
- [x] 7.2 实现文档页面导航：XLSX 工作表标签、PPTX 幻灯片翻页、长 DOCX 滚动定位；验证键盘与点击操作
- [x] 7.3 更新卡片、胶片带、格式徽章与检查器，显示文档格式、大小和可用结构信息；信息不可用时显示破折号
- [x] 7.4 在格式筛选增加文档分组并接入 `queryAssets`；验证 DOCX 与 DOC 分离、Markdown 别名归一
- [x] 7.5 让文档豁免图片形状与尺寸筛选；验证选择方形或尺寸筛选时文档不被误分类
- [x] 7.6 更新文档预览样式，保证浅色与深色主题、窄窗口与移动尺寸下工具栏、页码、工作表标签和内容滚动可用；用真实窗口验证

## 8. 安全与失败验证

- [x] 8.1 验证文档预览 iframe 使用严格 CSP、`sandbox` 和清理后的 HTML，脚本、事件属性、宏与远程请求均不执行
- [x] 8.2 验证文档内图片、字体和链接只能走受控库内资源或外部打开动作，不能读取库外文件
- [x] 8.3 验证损坏、加密、超时、资源超限与不支持特性分别显示不同提示，并提供重试与外部打开
- [x] 8.4 验证同一指纹的失败结果复用，文件内容变化后重新探测，渲染器升级后旧缓存失效

## 9. 集成验证

- [x] 9.1 运行 `npm run typecheck`，确认 node 与 web 两侧均无 TypeScript 错误
- [x] 9.2 运行 `npm run test`，确认新增与既有测试全部通过；若出现已知 `eagle.test.ts` worker 退出，单独重跑并如实记录
- [x] 9.3 运行 `npm run build`，确认 electron-vite 构建产物包含文档解析器且无打包错误
- [x] 9.4 用隔离 userData 与真实样本库启动 Electron，逐项打开 TXT、Markdown、CSV、DOCX、XLSX、PPTX，验证卡片缩略图、灯箱结构、翻页、筛选与重启持久化
- [x] 9.5 验证文档的标签、评分、备注、来源链接、收藏、回收站与文件夹语义和 JPG 素材一致
- [x] 9.6 运行 `openspec validate add-document-preview --strict`，确认 0 ERROR 且 0 WARNING

## 10. 第二阶段决策记录（2026-10-27 调研，实施前必读）

依据 GitHub 源码取证与本机真机验证；证据留在 `artifacts/research/`（gitignored，不入库）。

已验证（可作实现前提）：

- WPS Writer `.wps` 是 OLE2/CFB 容器，内含 `WordDocument` / `0Table` / `Data` 流与 Word FIB（`0xA5EC`），并带 `KSOProductBuildVer` 标记。
- LibreOffice Portable 7.5.3 直接导入 `.wps` 转 PDF 成功：2 页、200588 字节，495 个汉字完整，无需改名 `.doc`。证据 `artifacts/research/conv-out/sample.pdf`。
- 本机 Electron 44.9.1 运行时为 Node 24.22.0，满足 `officeparser` 的 `engines` 要求（>= 22.13）。

未验证（不得声明已支持）：

- WPS 表格 `.et`、演示 `.dps`：没有真实样本，SheetJS 与 LibreOffice 均未实测。
- `@matbee/libreoffice-converter` WASM 版未在本机跑过：体积、内存、中文字体均未知。
- kkFileView 对外声明支持 wps/et/dps，但其仓库内无对应样本，其声明无法复核。

结论：第二阶段不再只做外部转换器。先内置（10A），再评估 WASM（10B），外部转换器保留为兜底（10C）。

## 10A. 内置渲染（不依赖外部软件）

- [x] 10A.1 用 SheetJS CE（Apache-2.0）读取 XLS/XLSB/ODS/FODS 到既有 `DocumentSheet`：合并单元格、列宽、数字格式、常见样式；沿用行列、合并数与解压体积上限及既有失败分类
- 保真上限（CE 版 SheetJS 只暴露填充色与数字格式，字体、边框、对齐读不到）；实现取 `xlsx@0.20.3` 官方 CDN 发行版，npm 上的 0.18.5 带 GHSA-4r6h-8v6p-xvw6 与 GHSA-5pgg-2g8v-p4x9 两个 high 漏洞
- 已到手真实样本（`artifacts/research/samples/`，gitignored）：`.xls` × 4（POI 两份、爱给网 SOP 12MB 与财务报表 10 表）、`.ods` × 1、`.odt` × 4、`.odp` × 2、`.rtf` × 5（含中文 GBK 与表格样本）、`.doc` × 3、`.ppt` × 1、`.wps` × 2；仍缺 `.et`、`.dps` 与密码保护的 `.xls`
- [x] 10A.2 用真实 `.xls` 与 `.ods` 样本逐项验证：`aigei-xls-finance.xls`（10 表 3369 格 2202 带样式）、`aigei-xls-sop.xls`（1 表 968 格）、`poi-SampleSS.ods`（3 表）全部走 `ensureDocumentPreview` 通过
- [ ] 10A.2b `.et` 真实样本验证（阻塞：爱给网无 `.et`，GitHub/Bing 也无命中；无样本前 `.et` 保持外部档，不宣称支持）
- [x] 10A.3 ODF spike 完成并落地方案 A：自解析 `content.xml`（复用 `documentZip.ts` + `@xmldom/xmldom`，零新增依赖）。方案 B officeParser 8.3.0 实测解包 34.5 MB，`feature_table*.odt` 的单元格文本全部解析为空、ODP 只给文本流没有坐标，因此弃用；方案 A 在 4 份 ODT 与 2 份 ODP 上表格/图片/页面尺寸均正确
- [x] 10A.4 自研 RTF 子集解析转只读 HTML（段落、字符格式、颜色/高亮、表格、PNG/JPEG、GBK 代码页与 `\u` 转义），复用 sanitize 与 CSP 沙箱；5 份真实 RTF 验证通过（22 表临床报告、8 表 775 汉字、1426 汉字许可协议等），WMF/EMF 图片跳过
- [x] 10A.5 将 `rtf/odt/odp` 在 `src/shared/formats.ts` 从 `external: 'office'` 改为内置 document（`ods` 已于 10A.1 切完），顺带补上同解析器的别名 `docm/xlsm/pptm/ott`（POI 与 LibreOffice 真实样本验证），`DOCUMENT_RENDERER_VERSION` 升到 2，并在 `docs/FORMAT_SUPPORT.md` 标注能力等级、依赖与未验证项

## 10B. 旧版 Word DOC 内置

- [x] 10B.1 接入 `@file-viewer/doc` 3.3.0（MIT，node_modules 约 333 KB），确认 ESM-only 包被主进程 bundle 而不是运行时 `require`；记录许可证、体积与传递依赖
- [x] 10B.2 将 `.doc` 从外部 office 档切为内置 document 档，限制源文件 64 MB、单图 16 MB、生成 HTML 12 MB，并阻止外部链接与外部资源
- [x] 10B.3 把解析 HTML/CSS 合并后复用 `sanitizeDocumentHtml()`，确认脚本、事件属性、`@import`、`url()` 与 `expression()` 均被清理
- [x] 10B.4 将 `DOCUMENT_RENDERER_VERSION` 升到 3，验证旧 `missing-tool` 失败缓存失效，DOC 自动走既有缩略图、灯箱与解析缓存
- [x] 10B.5 用三份真实 `.doc` 验证中文、表格与图片：`aigei-doc-contract.doc`、`aigei-doc-tables.doc`、`sample.doc`；补损坏 DOC 分类测试、类型检查与生产构建
- [x] 10B.6 用隔离 Electron 实例打开真实 `.doc`，验证卡片缩略图、灯箱、重试/外部打开、缓存落盘与重启复用

## 10C. 外部转换器（兜底，原 10.1-10.4）

- [ ] 10C.1 增加可配置的外部办公转换器设置，支持 WPS、Microsoft Office 与 LibreOffice；验证无工具时显示明确缺失状态
- [ ] 10C.2 通过 `execFile` 参数数组执行无头转 PDF，限制超时、并发、输出大小和临时目录；用真实 `PPT/WPS/ET/DPS` 样本验证转换
- [ ] 10C.3 注册 `PPT/WPS/ET/DPS` 的外部路径，复用 PDF 页面渲染、缩略图与缓存清理；在安装对应软件的机器上逐项验证
- [ ] 10C.4 验证外部转换器版本变化、转换失败、文件加密和超时不会破坏原文件或素材元数据

## 11. HTML/HTM 静态页面

- [x] 11.1 在 `src/shared/formats.ts` 注册 `HTML/HTM` 为内置 document，补 `html` 文档形态与文本编码探测；运行 `npm run test -- tests/formats.test.ts tests/documentMeta.test.ts` 验证别名、分组与编码
- [x] 11.2 复用 `sanitizeDocumentHtml()`、`documentThumbnailHtml()` 与 `DocumentStage` 的 sandbox iframe，清理脚本、事件属性、`@import`、`url()` 与外部资源；运行 `npm run test -- tests/documentPreview.test.ts tests/fileImport.test.ts` 验证安全清理与拖入导入
- [x] 11.3 用独立 HTML 在隔离 Electron 实例验证：导入结果为 `imported=1`、`skipped=0`，卡片缩略图为 640×480 JPEG，灯箱显示静态 HTML 且不执行脚本
- [x] 11.4 让侧栏物理文件夹行接收外部文件拖放：高亮目标、复制进该文件夹并复用统一导入提示；用 CDP 带本地文件路径拖放到「我的分类」验证入库成功

## Workflow follow-up

- 归档前确认所有真实样本验证结果已写入 `docs/FORMAT_SUPPORT.md`。
- 按项目规范运行 OpenSpec 归档流程，并同步主规格。

# Spec Delta

## Purpose

定义素材管理器对文档文件的只读浏览能力，包括格式范围、结构保真、页面导航、内置解析、外部转换、安全边界与失败降级，确保“能打开”不等于“只显示一堆纯文本”。

## ADDED Requirements

### Requirement: 第一阶段文档格式范围

应用 SHALL 将 `TXT`、`MD`、`MARKDOWN`、`CSV`、`DOCX`、`XLSX`、`PPTX` 作为文档素材入库并支持应用内只读预览。扩展名匹配 SHALL 大小写不敏感，别名 SHALL 归一为同一规范格式名。

#### Scenario: 七类文档同批入库

- **WHEN** 库目录同时包含 `notes.txt`、`README.md`、`data.csv`、`plan.docx`、`book.xlsx` 与 `deck.pptx`
- **THEN** 六个文件都获得文档素材记录，且不因其中任一解析失败而阻断其它文件

#### Scenario: Markdown 别名

- **WHEN** 扫描 `guide.md` 与 `guide.markdown`
- **THEN** 两者都归一为 Markdown 文档格式，同时保留各自的原始相对路径

### Requirement: HTML/HTM 静态页面文档

应用 SHALL 将 `HTML` 与 `HTM` 作为文档素材入库并支持应用内只读预览；扩展名 SHALL 大小写不敏感，别名 SHALL 归一为同一规范格式名。预览 SHALL 复用受控静态 HTML 路径与「文档预览安全隔离」要求：脚本、事件属性、`@import`、`url()` 与外部网络资源 SHALL NOT 执行或加载。

#### Scenario: 拖入独立 HTML

- **WHEN** 用户把一个库外 `.html` 文件拖到素材工作区
- **THEN** 文件被复制进当前文件夹并生成 HTML 文档素材，而不是计入「不支持或库内文件」

#### Scenario: HTML 内的脚本与外部资源

- **WHEN** 独立 HTML 同时包含样式、脚本和远程图片
- **THEN** 预览保留静态结构与样式，不执行脚本，也不请求远程图片

### Requirement: 只读文档预览

文档 SHALL 以只读方式展示。应用 SHALL NOT 提供编辑正文、保存回原文件、修改公式、执行宏、执行脚本或改变文档内容的入口。

#### Scenario: 打开文档

- **WHEN** 用户双击一个 DOCX 或 XLSX 素材
- **THEN** 灯箱展示文档内容，不出现保存按钮，也不修改原文件

#### Scenario: 文档中的脚本与宏

- **WHEN** 文档包含脚本、宏或事件处理器
- **THEN** 预览只展示静态内容，不执行这些代码

### Requirement: 文本与 Markdown 结构保真

TXT SHALL 以可读文本展示，并自动识别 UTF-8、UTF-8 BOM、UTF-16 与常见本地编码。Markdown SHALL 渲染为静态排版，保留标题层级、段落、列表、引用、代码块、表格、链接文字与本地图片。

#### Scenario: UTF-8 与 UTF-16 文本

- **WHEN** 用户分别打开 UTF-8 中文 TXT 与 UTF-16 TXT
- **THEN** 两者都显示正常中文，不出现乱码

#### Scenario: Markdown 表格

- **WHEN** 用户打开含 Markdown 表格的文档
- **THEN** 表格显示为有行有列的表格，而不是竖线分隔的纯文本

### Requirement: 表格结构保真

CSV 与 XLSX SHALL 显示为真实表格。CSV SHALL 正确识别分隔符、引号与换行。XLSX SHALL 保留工作表名称、单元格行列结构、合并单元格、列宽、数字格式与常用字体、字号、字重、颜色、对齐和边框。

#### Scenario: CSV 引号与换行

- **WHEN** CSV 单元格包含逗号、双引号或嵌入换行
- **THEN** 预览仍按原单元格边界显示，不拆成额外列或额外行

#### Scenario: 多工作表切换

- **WHEN** 用户打开含多个工作表的 XLSX
- **THEN** 应用显示工作表标签，用户可切换并查看对应表格

#### Scenario: 合并单元格

- **WHEN** XLSX 含跨行或跨列合并单元格
- **THEN** 预览保留合并后的占位与对齐，不把内容重复填入每个被合并单元格

### Requirement: 文档分页浏览

DOC 与 DOCX SHALL 按分页或连续阅读模式展示，并保留标题、段落、列表、表格、图片、页眉、页脚与脚注中可解析的内容。PPTX SHALL 以幻灯片页面展示，并提供上一张、下一张与页码。应用 SHALL NOT 用单一纯文本流替代这些结构。

#### Scenario: DOC 与 DOCX 表格图片

- **WHEN** 用户打开含表格、图片和页眉的 DOC 或 DOCX
- **THEN** 灯箱显示表格、图片与页眉，而不是只显示文字段落

#### Scenario: PPTX 翻页

- **WHEN** 用户打开含多张幻灯片的 PPTX
- **THEN** 灯箱显示当前幻灯片与总页数，上一张和下一张按钮可切换

### Requirement: 文档缩略图

文档卡片 SHALL 使用文档内容的静态缩略图：TXT、Markdown、DOC、DOCX 取文档开头或首页；CSV、XLSX 取第一张工作表；PPTX 取第一张幻灯片。缩略图 SHALL 与文档内容指纹和渲染器版本绑定，内容或渲染规则变化后 SHALL 重新生成。

#### Scenario: XLSX 首工作表封面

- **WHEN** XLSX 的第一张工作表含表格内容
- **THEN** 卡片缩略图显示该工作表的表格画面，而不是通用文件图标

#### Scenario: 文档内容变化

- **WHEN** 用户修改 DOC 或 DOCX 内容且文件指纹变化
- **THEN** 旧缩略图失效并在下次浏览时按新内容重建

### Requirement: 旧版 Word DOC 内置预览

应用 SHALL 使用随应用打包的解析器读取旧版 Word `.doc`，不得要求最终用户安装 Microsoft Office、WPS 或 LibreOffice。解析结果 SHALL 保留可识别的段落、字符样式、表格、内嵌图片与分页信息，并 SHALL 阻止外部链接、外部资源和活动内容。

#### Scenario: 未安装办公软件

- **WHEN** 目标机器没有任何 Office、WPS 或 LibreOffice，用户打开一个有效 `.doc`
- **THEN** 应用仍生成只读文档预览，不显示“缺少外部工具”

#### Scenario: DOC 表格与图片

- **WHEN** 用户打开包含中文、多个表格和内嵌图片的 `.doc`
- **THEN** 灯箱保留表格边界与图片内容，文字不乱码

### Requirement: 文档解析资源边界

应用 SHALL 为文档预览设置文件大小、解压总量、页数、工作表数、幻灯片数、单元格数量、生成 HTML 体积与解析超时上限。旧版 `.doc` SHALL 限制源文件为 64 MB、单张图片为 16 MB、生成 HTML 为 12 MB。超限时 SHALL 返回可解释的降级结果，不得让主进程或渲染进程无限等待或耗尽内存。

#### Scenario: 超大工作簿

- **WHEN** 用户打开超过单元格数量上限的 XLSX
- **THEN** 应用显示资源超限说明，保留素材卡片与元数据，不尝试渲染完整工作簿

#### Scenario: 解压炸弹

- **WHEN** OOXML 文件的解压总量超过上限
- **THEN** 应用终止解析并显示安全限制提示

### Requirement: 文档预览安全隔离

文档预览 SHALL 在隔离环境中显示，禁止执行脚本、宏、事件处理器与外部网络请求。文档内的图片、字体和媒体 SHALL 只能经受控库内资源路径读取；外部超链接 SHALL NOT 在预览页面内直接导航。

#### Scenario: 恶意脚本文档

- **WHEN** DOCX 或生成的预览 HTML 含脚本标签
- **THEN** 预览不执行脚本，主界面不受影响

#### Scenario: 远程图片

- **WHEN** 文档引用远程图片地址
- **THEN** 预览不发起网络请求，显示缺失资源占位或省略该图片

#### Scenario: 外部链接

- **WHEN** 用户点击文档内的外部链接
- **THEN** 预览页自身不导航；仅在明确的外部打开动作下交给系统浏览器

### Requirement: 文档失败与重试

应用 SHALL 区分损坏、加密、缺少外部工具、资源超限、解析超时与不支持的文档特性。失败结果 SHALL 绑定内容指纹，同一失败在缓存有效期内不得反复启动高成本解析。文件内容变化后 SHALL 重新尝试。

#### Scenario: 加密文档

- **WHEN** 用户打开受密码保护的 DOCX
- **THEN** 应用显示“文档已加密”及外部打开入口，不显示空白或无限加载

#### Scenario: 失败缓存

- **WHEN** 用户连续两次打开同一损坏 XLSX
- **THEN** 第二次直接显示已知失败原因，不重复完整解析

#### Scenario: 文件被修复

- **WHEN** 用户用有效文件替换此前的损坏文件
- **THEN** 新指纹触发重新解析并允许正常预览

### Requirement: 外部办公软件转换

仍依赖外部办公软件的 `PPT`、`WPS`、`ET`、`DPS` 格式 SHALL 允许用户配置 WPS、Microsoft Office 或 LibreOffice 转换器，并通过受控无头转换生成 PDF，再以现有 PDF 页面链路只读展示。`DOC`、`XLS`、`RTF`、`ODT`、`ODS`、`ODP` SHALL 优先走内置解析路径，不得因外部工具缺失而降级。

#### Scenario: 外部转换成功

- **WHEN** 用户打开 `.ppt` 且已配置可用的 WPS、Office 或 LibreOffice
- **THEN** 应用生成并缓存 PDF 页面预览，显示文档结构而非纯文本

#### Scenario: 缺少外部转换器

- **WHEN** 用户打开 `.wps` 且本机没有可用转换器
- **THEN** 素材仍保留在库中，灯箱显示缺失工具说明、重试与外部打开入口

#### Scenario: 转换超时

- **WHEN** 外部转换器超过超时时间仍未完成
- **THEN** 应用终止该任务、记录超时状态并显示可重试提示

### Requirement: 文档能力分级

每个文档扩展名 SHALL 声明入库、缩略图、内置预览、外部转换依赖与保真等级。应用 SHALL NOT 把仅能提取文字或只能依赖外部软件的格式标记为“内置完整预览”。

#### Scenario: 内置与外部依赖

- **WHEN** 用户查看 DOC、DOCX 与 PPT 的能力说明
- **THEN** DOC 与 DOCX 标记为内置只读预览，PPT 标记为需外部办公软件转换

#### Scenario: 失败降级可见

- **WHEN** 文档仅能显示降级结果
- **THEN** 检查器和灯箱显示具体能力等级与缺失项，不让用户从空白画面猜测

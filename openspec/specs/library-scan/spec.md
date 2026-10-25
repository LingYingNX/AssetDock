## Purpose

定义资源库的建库与目录绑定、递归扫描、文件监听、忽略规则与视频编码解析:把库目录内的原始素材增量登记进库,并让磁盘变化及时反映到素材记录。

## Requirements

### Requirement: 建库与目录绑定
「＋新建素材库」SHALL 打开系统目录选择对话框;选定后创建库记录(库名默认取文件夹名,可改名),路径入库;同一文件夹 SHALL NOT 被重复绑定为第二个库;关闭库标签页不删除库与数据,重新打开应用可恢复。

#### Scenario: 新建绑定库
- **WHEN** 用户点「+」并选择一个含素材的文件夹
- **THEN** 出现新库标签并激活,扫描自动开始,完成后素材出现在网格中

#### Scenario: 重复绑定被拒
- **WHEN** 用户选择一个已绑定的文件夹
- **THEN** 提示该目录已是素材库,不创建重复库

### Requirement: 递归扫描
建库后 SHALL 递归扫描目录,按扩展名白名单筛选文件并入库,大小写不敏感。白名单 SHALL 覆盖图片(AI/PSD/HEIC/HEIF/AVIF/TIFF/TIF/BMP/ICO/TGA/HDR/EXR)、视频(MP4/MOV/WebM/MKV/AVI/FLV/WMV/M4V/MPG/MPEG/TS)、三维(GLB/glTF/FBX/OBJ/PMD/PMX/STL/PLY/3DS/DAE/USDZ/3MF/AMF/VRML/VRM/BLEND/C4D)与 CSS，并保留现有 JPG/JPEG/PNG/WEBP/GIF/SVG。扫描 SHALL 记录相对路径、大小、mtime；图片取尺寸，视频取时长与分辨率，三维取可获得的格式信息；CSS 不采集尺寸、时长与主色。扫描进度(已扫文件数)SHALL 可见；扫描不阻塞 UI。

#### Scenario: 中文路径库扫描
- **WHEN** 绑定含中文与空格路径的文件夹并完成扫描
- **THEN** 库内素材元数据(名称/大小/时间)与文件系统一致

#### Scenario: 扫描进度
- **WHEN** 大目录扫描进行中
- **THEN** 界面显示进度且可继续浏览已入库部分

#### Scenario: CSS 文件入库
- **WHEN** 库目录中存在 `styles/loader.css`
- **THEN** 该文件作为 CSS 素材入库,尺寸与时长字段留空,不阻塞同批其它文件的扫描

#### Scenario: 新格式与旧格式同批入库
- **WHEN** 同一目录同时包含 `poster.ai`、`scene.blend`、`girl.pmx` 和 `photo.jpg`
- **THEN** 四个文件都获得素材记录，扫描错误不会阻断其它文件

### Requirement: 增量监听
库绑定后 SHALL 用文件监听(chokidar)维护素材记录:新增文件 → 入库;文件修改(mtime/size 变化)→ 更新元数据;文件删除 → 对应素材标记「缺失」且不再出现在默认浏览视图(回收站素材保持原状),文件恢复后自动解除缺失标记。白名单内的 CSS 文件 SHALL 与其它素材走同一条监听路径。监听本身 SHALL NOT 触发缩略图生成;缩略图 SHALL 仅在渲染层请求预览时按需生成。

#### Scenario: 新增文件自动出现
- **WHEN** 向库目录复制入一张新 JPG
- **THEN** 数秒内网格出现该素材,预览直接读取原文件

#### Scenario: 新增 CSS 自动出现
- **WHEN** 向库目录复制入一个 `.css` 文件
- **THEN** 数秒内网格出现该 CSS 素材,缩略图按需生成

#### Scenario: 删除文件标记缺失
- **WHEN** 在资源管理器中删除库内一个文件
- **THEN** 该素材从浏览视图消失,数据库记录保留;文件放回后素材恢复显示

### Requirement: 忽略规则
扫描与监听 SHALL 忽略隐藏文件、缩略图缓存目录与常见临时文件(`~$` 前缀、`.tmp`/`.crdownload` 后缀、`thumbs/`、`.mediahub/`)。

#### Scenario: 临时文件不入库
- **WHEN** 目录中出现 `~$a.psd` 与 `b.tmp`
- **THEN** 两者均不入库

### Requirement: 视频编码信息
扫描视频时 SHALL 经 ffmpeg 解析容器、视频编码(如 H.264/HEVC/ProRes/VP9/AV1)与帧率(fps)入库;检查器文件信息 SHALL 在时长行以 small 标注 fps、在类型行以 small 标注编码;解析失败留空不阻塞。(三维面数/顶点解析按用户指示撤销,不做。)

#### Scenario: 检查器编码标注
- **WHEN** 查看库内 MP4 素材的检查器
- **THEN** 类型行显示「MP4 视频 H.264」样式 small 标注,时长行显示 fps

#### Scenario: 不支持直接播放的容器
- **WHEN** 扫描到一个 MKV 或 AVI 视频
- **THEN** 仍记录时长、分辨率、编码和 fps，不因容器不受 Chromium 支持而拒绝入库

### Requirement: 视频元数据探测不完整解码

视频元数据探测 SHALL 只读取文件头和元数据，SHALL NOT 解码完整视频。视频探测并发 SHALL 有界，避免大库扫描同时启动大量 ffmpeg 进程。

#### Scenario: 大库扫描只读视频头

- **WHEN** 库内包含一百个长视频
- **THEN** 扫描在读取元数据后继续，不把每个视频完整解码一遍

### Requirement: 扫描分批入库

递归扫描 SHALL 按批次把已发现的素材写入数据库并推送增量事件。扫描进行中用户 SHALL 能浏览已入库素材，不必等待整库扫描结束。

#### Scenario: 万级素材可见进度

- **WHEN** 用户首次扫描含一万个文件的目录
- **THEN** 网格逐步出现已入库素材，进度持续更新

### Requirement: 新格式元数据探测
扫描新图片格式时 SHALL 尽力读取宽高；扫描三维格式时 SHALL 记录能从文件头可靠获得的格式信息。探测失败或需要外部软件时 SHALL 留空对应字段并照常入库，不得让单个文件拖垮整批扫描。

#### Scenario: EXR 尺寸
- **WHEN** 扫描一个有效的 EXR 文件
- **THEN** 素材记录包含宽高，格式为 EXR

#### Scenario: C4D 无法解析
- **WHEN** 扫描一个 C4D 文件且本机没有可用的 Cinema 4D
- **THEN** 素材仍入库，三维字段留空，错误计入扫描诊断

### Requirement: 监听新格式
文件监听 SHALL 与扫描共用同一格式能力注册表。新增、修改、删除或恢复上述任何格式时，素材记录 SHALL 与 JPG 走相同的增量更新和缺失标记语义。

#### Scenario: 新增 PMX
- **WHEN** 向已监听库复制一个 PMX 文件
- **THEN** 数秒内出现 PMX 素材卡片，缩略图按能力注册表排队生成

#### Scenario: 删除 BLEND
- **WHEN** 从磁盘删除一个 BLEND 文件
- **THEN** 对应素材标记缺失并从默认视图消失，数据库元数据保留

# Spec Delta

## MODIFIED Requirements

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

### Requirement: 视频编码信息
扫描视频时 SHALL 经 ffmpeg 解析容器、视频编码(如 H.264/HEVC/ProRes/VP9/AV1)与帧率(fps)入库;检查器文件信息 SHALL 在时长行以 small 标注 fps、在类型行以 small 标注编码;解析失败留空不阻塞。(三维面数/顶点解析按用户指示撤销,不做。)

#### Scenario: 检查器编码标注
- **WHEN** 查看库内 MP4 素材的检查器
- **THEN** 类型行显示「MP4 视频 H.264」样式 small 标注,时长行显示 fps

#### Scenario: 不支持直接播放的容器
- **WHEN** 扫描到一个 MKV 或 AVI 视频
- **THEN** 仍记录时长、分辨率、编码和 fps，不因容器不受 Chromium 支持而拒绝入库

## ADDED Requirements

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

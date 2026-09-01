## Purpose

扫描阶段的元数据增补:三维模型面数/顶点解析、视频编码与帧率,补齐卡片与检查器的真实展示数据。

## ADDED Requirements

### Requirement: 三维元数据解析
扫描 GLB/glTF 时 SHALL 解析文件头部 JSON chunk(无需读入全文件),统计面数(indexed:三角形索引数之和;非 indexed:顶点数/3)与顶点数(POSITION accessor 计数之和)入库;解析失败或字段缺失留空;卡片元信息与检查器显示真实面数(千分位)。

#### Scenario: GLB 面数入库
- **WHEN** 扫描含有效 GLB 的库
- **THEN** 该素材的面数/顶点非空,检查器「面数」显示千分位数字与「三角面」标注

#### Scenario: 解析失败留空
- **WHEN** GLB 头部损坏或非标准结构
- **THEN** 面数/顶点留空(界面显示 —),不影响入库

### Requirement: 视频编码信息
扫描视频时 SHALL 经 ffmpeg 解析视频编码(如 H.264/HEVC/ProRes)与帧率(fps)入库;检查器文件信息 SHALL 在时长行以 small 标注 fps、在类型行以 small 标注编码;解析失败留空不阻塞。

#### Scenario: 检查器编码标注
- **WHEN** 查看库内 MP4 素材的检查器
- **THEN** 类型行显示「MP4 视频 H.264」样式 small 标注,时长行显示 fps

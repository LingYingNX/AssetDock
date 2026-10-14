## Purpose

定义素材主色数据的提取与消费:入库时提取每张素材的代表色,并让颜色构造浮层基于库内 palette 而非演示数据。

## Requirements

### Requirement: 提取算法
图片素材 SHALL 由库内原文件缩至 64px 后在 Worker 线程执行 k-means 聚类(5 色,含占比,取整为 hex),随入库或主色补齐写入素材记录;非图片素材与提取失败者 palette 为空。

#### Scenario: 提取结果入库
- **WHEN** 扫描含图片的库完成且主色补齐结束
- **THEN** 每张图片素材的 palette 含不超过 5 个 hex 与占比,之和约 100%

### Requirement: 筛选数据源切换
颜色构造浮层 SHALL 改读库内 palette;无 palette 的素材不参与颜色筛选结果;颜色构造浮层展示当前视图范围内素材的加权主色分布(前 8 色 + 占比)。

#### Scenario: 点色筛选真实数据
- **WHEN** 用户点选色带某色块
- **THEN** 结果为库内 palette 含该色系的素材,计数实时联动

### Requirement: 不阻塞与降级
提取 SHALL 在 Worker 线程执行(主进程与渲染进程不卡);补齐任务串行执行,失败静默降级为空 palette,SHALL NOT 中断扫描或文件监听。

#### Scenario: 大库导入不卡 UI
- **WHEN** 导入上千张图片
- **THEN** 窗口保持可交互,调色板逐步补全

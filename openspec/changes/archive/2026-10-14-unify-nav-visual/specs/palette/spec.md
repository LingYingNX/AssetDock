## MODIFIED Requirements

### Requirement: 筛选数据源切换
颜色构造浮层 SHALL 改读库内 palette;无 palette 的素材不参与颜色筛选结果;颜色构造浮层展示当前视图范围内素材的加权主色分布(前 8 色 + 占比)。

#### Scenario: 点色筛选真实数据
- **WHEN** 用户点选色带某色块
- **THEN** 结果为库内 palette 含该色系的素材,计数实时联动
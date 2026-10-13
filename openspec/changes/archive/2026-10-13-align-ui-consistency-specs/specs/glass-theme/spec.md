# Spec Delta

## ADDED Requirements

### Requirement: 控件级尺寸阶梯

应用 SHALL 提供一套控件级尺寸令牌,与面板级半径令牌(`--r-s` 8px / `--r-m` 14px / `--r-l` 18px)并存并区分语义:圆角 `--r-xs` 4px / `--r-sm` 6px / `--r-md` 8px / `--r-pill` 11px;控件高 `--h-xs` 24px / `--h-sm` 28px / `--h-md` 32px / `--h-bar` 42px;图标 `--ic-xs` 12px / `--ic-sm` 14px / `--ic-md` 16px / `--ic-lg` 20px / `--ic-xl` 30px;字号 `--fs-micro` 10.5px / `--fs-cap` 11px / `--fs-body` 12.5px / `--fs-sub` 13px / `--fs-title` 14px。同一层级的同类控件 SHALL 取同一档;控件高度 SHALL 落在 4px 栅格上;界面样式 SHALL 引用这些令牌,SHALL NOT 就地写同一语义的字面值。

#### Scenario: 菜单行高与字号跨组件一致
- **WHEN** 依次打开素材右键菜单、筛选下拉与齿轮菜单
- **THEN** 三者的菜单项高度同为 `--h-md`(32px)、字号同为 `--fs-body`(12.5px),不再出现 31px / 27px / 36px 三种行高

#### Scenario: 同层图标尺寸同档
- **WHEN** 对比筛选条按钮图标、菜单项图标与侧栏导航图标
- **THEN** 同一层级的图标取同一档 `--ic-*` 令牌,不存在 11 / 13 / 15 / 17px 并存

### Requirement: 分隔线令牌

菜单与列表的分隔线 SHALL 使用专用令牌 `--sep`(浅色 `rgba(18,26,22,.12)`,夜间 `rgba(255,255,255,.16)`)。SHALL NOT 复用纹理令牌 `--hatch` 充当分隔线:后者为斜纹纹理调色,夜间仅 .09 白,落在 `--menu-solid`(#1B2430)上不可见,分组会断掉。

#### Scenario: 夜间菜单分组仍可辨
- **WHEN** 在夜间主题下打开含分组分隔线的下拉菜单
- **THEN** 分隔线与菜单底色可辨,分组边界清晰,不出现「分组消失」

### Requirement: 共享视觉常量唯一真源

彩虹色带 SHALL 只有一处定义(令牌 `--grad-rainbow`,`conic-gradient` 起点 `#F1616D`),色轮按钮与「全部颜色」色块 SHALL 引用同一令牌,SHALL NOT 各写一份各自的渐变。未选中星色 SHALL 使用令牌 `--star-off`(浅色 `rgba(18,26,22,.26)`,夜间 `#3D4454`),SHALL NOT 就地硬编码。

#### Scenario: 两处彩虹色带起点一致
- **WHEN** 并排观察筛选条色轮按钮与「全部颜色」色块
- **THEN** 两者的红端起点相同,不存在起始色偏移

#### Scenario: 未选中星不比选中星更重
- **WHEN** 在浅色主题下观察检查器星级控件
- **THEN** 未选中星使用 `--star-off` 的淡灰,视觉重量低于金色已选中星

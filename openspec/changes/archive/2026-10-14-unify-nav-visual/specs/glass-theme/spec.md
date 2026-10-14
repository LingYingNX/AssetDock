## REMOVED Requirements

### Requirement: 共享视觉常量唯一真源
**Reason**: 该 requirement 的彩虹色带子句把「色轮按钮与「全部颜色」色块」并列为 `--grad-rainbow` 的两个引用点;侧栏「颜色筛选」分组删除后「全部颜色」色块不再存在,子句与场景「两处彩虹色带起点一致」都指向已不存在的元素。场景只能随 requirement 整体重写,故以 REMOVED + ADDED 换名。
**Migration**: `--grad-rainbow` 现由筛选条色轮按钮 `.cball`(`src/renderer/src/styles/content.css`)单独消费;新增彩虹元素时仍 SHALL 引用该令牌,SHALL NOT 就地另写渐变。

## ADDED Requirements

### Requirement: 彩虹色带与星色令牌唯一真源
彩虹色带 SHALL 只有一处定义(令牌 `--grad-rainbow`,`conic-gradient` 起点 `#F1616D`),色轮按钮 SHALL 引用该令牌,SHALL NOT 就地另写一份渐变。未选中星色 SHALL 使用令牌 `--star-off`(浅色 `rgba(18,26,22,.26)`,夜间 `#3D4454`),SHALL NOT 就地硬编码。

#### Scenario: 彩虹色带单点定义
- **WHEN** 全仓检索 `conic-gradient` 的彩虹起点 `#F1616D`
- **THEN** 只有 `--grad-rainbow` 一处定义,色轮按钮引用该令牌

#### Scenario: 未选中星不比选中星更重
- **WHEN** 在浅色主题下观察检查器星级控件
- **THEN** 未选中星使用 `--star-off` 的淡灰,视觉重量低于金色已选中星
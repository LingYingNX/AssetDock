## Why

文件夹树已有底层移动与排序能力，但拖拽区域依赖不可见的右侧阈值，用户无法判断放下后会排序还是成为子文件夹。需要把文件夹整理交互明确为可见、可预测的三段投放规则，使其能像桌面素材管理器一样直接维护目录顺序和层级。

## What Changes

- 文件夹行拖拽明确区分三种投放结果：行上方插入、行中央移入成为子文件夹、行下方插入。
- 拖动时显示与结果一致的插入线或目标行高亮。
- 保留现有真实目录移动、同级持久化排序、素材路径同步与循环层级保护；拖拽完成后树结构和当前导航立即同步。
- 不改变索引目录或 Eagle 文件夹的只读属性，也不新增依赖或改变数据库格式。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `asset-browser`: 文件夹树 SHALL 提供可见且可预测的拖拽排序和父子级移动反馈与结果。

## Impact

- 影响 `src/renderer/src/components/Sidebar.tsx` 与 `src/renderer/src/styles/sidebar.css` 的拖放命中判断和视觉状态。
- 复用现有 `folders:move` IPC、文件夹移动服务及 `folder_orders` 持久化，不新增主进程 API、数据迁移或依赖。
- 新增针对三段投放规则、不可投放目标和文件夹移动结果的测试覆盖。

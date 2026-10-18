# Spec Delta

## ADDED Requirements

### Requirement: 按当前集合翻页

灯箱的上一张和下一张 SHALL 使用当前侧栏导航、搜索、五组筛选和颜色筛选结果。灯箱 SHALL NOT 进入当前视图之外的素材。

#### Scenario: 收藏筛选内翻页

- **WHEN** 用户在“收藏”视图中打开灯箱并按右方向键
- **THEN** 下一张仍然是收藏素材；到达末尾时停在末项或回到首项

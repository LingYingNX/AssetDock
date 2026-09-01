## Why

两个独有目标(用户明确):①库配置/元数据必须随素材文件夹走(.mediahub),当前存全局目录,拷库丢全部数据;②素材分散在不可移动的目录,需要"索引"引用方式纳入当前库浏览。本 change 为 `close-spec-gaps`(已归档)之后的增量:重复能力(动态文件夹树、虚拟滚动、库重开菜单)已由该 change 落地并合入主 specs,此处不再涉及。

## What Changes

- **库内存储**:`<库>/.mediahub/library.db` + `.mediahub/thumbs/`;启动复制式迁移全局库数据(原子 rename,失败回退,旧数据保留)
- **索引目录**:引用外部目录(不复制/移动/修改原文件);素材缩略图/调色板/监听/缺失全走同管线;可移除(仅删引用与记录);media/thumb 协议白名单扩展至索引根
- **菜单增量**:「+」菜单加「索引目录到当前库…」;侧栏树加索引顶层节点
- 明确排除:打包发布、3D 离屏缩略图、素材物理移动、跨库浏览

## Capabilities

### New Capabilities

- `library-portable`:库内 .mediahub 存储、启动迁移、索引入口菜单项
- `library-index`:索引语义、监听与缺失、移除、协议放行、树中索引节点

### Modified Capabilities

- `asset-browser`:「SQLite 数据集」补索引素材同视图
- `app-shell`:「库标签页」菜单补索引入口项
- `thumbnails`:缓存位置改库内 .mediahub/thumbs,协议跨库指纹查找

## Impact

- 主进程:db 句柄按库化(.mediahub/library.db)、迁移器、index_sources 表与监听、协议白名单
- 渲染层:菜单项、树索引节点、信息面板来源标注
- 风险面:迁移原子性(临时文件 rename)、索引目录含库目录的防重叠、并行会话干扰(需独占窗口执行,见验证记录)

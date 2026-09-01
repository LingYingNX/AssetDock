## Context

Change 2 交付了全局单库 SQLite + 全量 DOM 渲染;Change 3 交付真实 3D。本 change 回应三个实际痛点:大库卡顿、库配置不随文件夹走、外部目录无法纳入。规格数据模型不变(`asset-store` 表结构新增 `index_sources` 与 assets 源标记)。

## Goals / Non-Goals

**Goals:**

- 万级库滚动/筛选流畅(虚拟化)
- 库目录自包含(.mediahub/library.db + thumbs),整目录可携带
- 不动用户文件的前提下纳入外部目录
- 文件夹树与真实结构一致

**Non-Goals:**

- 打包发布(用户指示)、3D 离屏缩略图、素材物理移动/复制、跨库搜索/合并浏览、性能基准测试自动化

## Decisions

1. **每库一 db:`<库>/.mediahub/library.db`**
   - `asset-store` schema 原样移植;新增 `index_sources(id, library_id, path, name, created_at)` 与 `assets.source_index_id`(可空,索引素材来源标记)。全局 userData db 退化为:app_state/迁移前的旧库兜底。
   - 迁移:启动时对全局 db 中每个 library,若目标 `.mediahub/library.db` 不存在 → 复制式建库并搬数据(资产/标签/关联/open_tabs);失败回退全局库并提示。旧全局库不删除(兜底与可回滚)。
2. **db 句柄管理:按库懒打开 + LRU 关闭**
   - 打开的库标签对应句柄常驻;未打开的库读写(指纹查找/协议)按需打开并缓存,上限 8 个句柄 LRU 关闭(SQLite 文件句柄轻量)。
3. **虚拟滚动:@tanstack/react-virtual 三视图统一改造**
   - 列表/网格:行虚拟化(动态 measureElement 处 4:3 行高恒定可预估)。
   - 瀑布流:按 `--colw` 计算列数,把排序后的素材**按列均衡分配**(累计高度贪心),每列一个虚拟列容器;列内项绝对定位。自研列分配 + react-virtual 纵向窗口,避免引入多列虚拟库。
   - overscan 2 屏;筛选/视图/列宽变化时 scrollTo(0)。
4. **文件夹树:rel_path 父链归并**
   - 由素材列表内存构建(同一遍历聚合 counts);索引目录作为独立根节点(路径前缀 = 索引名);节点过滤沿用 `nav=folder:<路径>`(匹配前缀,含子目录)。演示模式沿用静态树。
5. **索引:引用记录 + 同管线复用**
   - `index_sources` 记录绝对路径;索引素材 `assets.rel_path` 存 `索引名/相对路径` 虚拟路径,`source_index_id` 指向来源;abs 路径 = 索引根 + 相对段。扫描/监听/缩略图/调色板对索引根走与库根完全相同的函数;media/thumb 协议白名单 = 库根 + 全部索引根(realpath 校验)。
   - 防自我索引:候选路径 realpath 与库根或既有索引根互为前缀 → 拒绝。
6. **移除索引:级联删该 source_index_id 的素材记录与孤儿标签关联**
   - 只删引用与记录,绝不触碰原目录;thumb 缓存按指纹自然失效(同名内容在别处仍可复用缓存)。
7. **thumb 协议跨库查找:遍历已打开库句柄逐库按指纹查**
   - 指纹全局近似唯一(内容+size);命中任一库即用其缓存;找不到则按素材表源文件生成(路径来自指纹命中的库)。

## Risks / Trade-offs

- [迁移中断留下半拷贝 db] → 复制到临时文件名完成后原子 rename;失败删除临时文件回退全局
- [瀑布流列分配与原始顺序视觉差异] → 分配保持每列按序贪心,视觉顺序与 CSS 多列一致(列优先);与 Change 1 对照确认
- [万级全量行一次拉取的内存(~几 MB)] → 可接受;真正瓶颈在 DOM,已虚拟化
- [索引目录即另一个库的目录导致双库重叠] → 防自我索引同时拦截"索引目标已是其他库根"的场景(校验全局库路径列表)
- [虚拟化后 Lightbox 导航序号基于过滤集不变] → 不受影响(queryAssets 输出即数据源)

## Migration Plan

- 启动自动迁移(复制式,原子 rename);失败回退全局库;不删旧数据
- 回滚:删除库目录 .mediahub 后重启即回到全局库模式(数据仍在)

## Open Questions

(无。瀑布流列分配算法、overscan、LRU 上限为实现默认,任务中固定。)

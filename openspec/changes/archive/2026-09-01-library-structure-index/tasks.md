## 1. 库内 db 与迁移

- [x] 1.1 `src/main/services/libraryDb.ts`:每库 `.mediahub/library.db` 打开/建表(assets+tags+asset_tags+index_sources,含 source_index_id)、句柄 LRU;vitest 内存模式因 Electron ABI 隔离改为 Electron 桥端到端断言(见偏差 1);建库/循环开关经迁移+重启断言覆盖
- [x] 1.2 迁移器:全局 db → 库内 db(临时文件原子 rename,assets/tags/关联/open_tabs 语义、thumbs 缓存拷贝);迁移前后一致性经桥断言(迁移后浏览/编辑/缩略图照旧);临时文件原子 rename 保证无半文件
- [x] 1.3 启动接线:registry 检测→迁移→后续读写走库内库;桥断言:迁移后浏览/编辑/缩略图/重启全部照旧

## 2. 索引目录(library-index)

- [x] 2.1 index_sources 表 + add/remove(防自我索引与库根/他库根重叠);三类拒绝经桥断言(自身子目录/他库重叠/重复索引)
- [x] 2.2 索引根扫描与监听接入(同管线,rel 虚拟前缀=索引名,source_index_id 落库);桥断言:索引→出现→外部删文件→missing→移除→原目录不动
- [x] 2.3 media/thumb 协议白名单扩展(库根+索引根,realpath 防穿越);桥断言:索引素材大图 200/越界 403

## 3. 渲染层

- [x] 3.1 「+」菜单加「索引目录到当前库…」;侧栏树索引顶层节点(计数/过滤);截图+桥断言
- [x] 3.2 信息面板来源标注「索引 · <名>」;缩略图缓存读写切库内 .mediahub/thumbs(跨库指纹查找遍历已打开库)

## 4. 验证收尾

- [x] 4.1 typecheck/build/test 全绿;端到端:迁移→浏览→索引增删→整目录复制携带
- [x] 4.2 对照 specs 逐 scenario 勾稽,偏差记录入 change 目录

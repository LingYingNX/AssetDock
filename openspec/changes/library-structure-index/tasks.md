## 1. 依赖与库内 db 基座

- [ ] 1.1 安装 `@tanstack/react-virtual`;typecheck 通过
- [ ] 1.2 `src/main/services/libraryDb.ts`:每库 `.mediahub/library.db` 打开/建表(schema 同 asset-store + index_sources/source_index_id)、句柄 LRU;单测(vitest,内存模式):建库/打开/关闭循环
- [ ] 1.3 迁移器:全局 db → 各库目录 db(临时文件 + 原子 rename,含 assets/tags/asset_tags/open_tabs/index_sources);单测:迁移前后行数/标签一致、中断不留半文件

## 2. 主进程接线改造

- [ ] 2.1 db/store/scan/watch/thumbs/palette/ipc 全链路改用"按库句柄"接口;media/thumb 协议白名单 = 库根 + 索引根(realpath 校验);桥断言:迁移后浏览/编辑/缩略图/协议全部照旧
- [ ] 2.2 索引服务:add/remove/防自我索引(含与其他库根重叠拒绝)、索引根扫描与监听接入、移除级联删记录;桥断言:索引→出现→移除→原目录不动

## 3. 渲染层:虚拟浏览

- [ ] 3.1 列表/网格视图接 @tanstack/react-virtual(行虚拟化、滚动复位、列宽重排);桥断言:DOM 卡片数有界、筛选切换复位
- [ ] 3.2 瀑布流列分配虚拟化(按 --colw 列数、累计高度贪心分列、列内绝对定位、overscan);桥断言:万级合成数据 DOM 有界、滑块 232→320 无错位
- [ ] 3.3 万级压力样例:临时合成 1 万条记录的测试库(仅内存数据,不动真实素材目录),滚动帧率与 DOM 数观测记录

## 4. 渲染层:树与库管理

- [ ] 4.1 Sidebar 文件夹树动态构建(rel_path 父链、计数、索引节点、folder:<路径> 前缀过滤、演示回退);桥断言:层级/计数/点击过滤
- [ ] 4.2 标题栏「+」下拉菜单(新建/打开已绑定库/索引目录);演示模式入口;桥断言:关闭标签后重新打开同库数据完整

## 5. 信息标注与收尾

- [ ] 5.1 信息面板索引来源标注(检查器/灯箱"来源:索引·<名>");回收站/缺失语义对索引素材回归
- [ ] 5.2 端到端手测清单:迁移→浏览万级→索引增删→文件夹树→重开库;对照 specs 逐 scenario 勾稽;typecheck/build/test 全绿;偏差记录入 change 目录

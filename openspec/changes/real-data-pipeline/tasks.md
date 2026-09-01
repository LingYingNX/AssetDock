## 1. 依赖与原生模块

- [x] 1.1 安装 better-sqlite3 / sharp / chokidar / ffmpeg-static,devDep @electron/rebuild;`npx electron-rebuild` 后在主进程 require 四个原生/二进制模块成功(冒烟:db 内存建表、sharp 读一张测试图、ffmpeg -version 输出)
- [x] 1.2 package.json postinstall 接入 electron-rebuild,`npm run build` 与 `npm run dev` 均正常启动

## 2. 数据库与 store 服务

- [x] 2.1 `src/main/services/db.ts`:打开 userData/mediahub.db(WAL),建 libraries/assets/tags/asset_tags 表 + user_version 迁移骨架;单测:内存库建表/重开持久
- [x] 2.2 CRUD 服务:upsertAssets、编辑操作(评分/收藏/待审/重命名/标签增删/备注/来源/trash/restore)事务写入;单测:编辑后重读一致、事务回滚无半写
- [x] 2.3 查询服务:按库取素材列表(轻量行)+ 侧栏计数;单测:deletedAt/missing 过滤语义正确

## 3. 扫描与监听(library-scan)

- [x] 3.1 目录选择对话框 + 建库(重名库拒绝);单测:重复路径拒绝
- [x] 3.2 递归扫描器(并发 8、扩展名白名单、忽略规则、图片尺寸/视频 ffprobe 元数据、进度事件);集成测试:对测试目录扫描结果与文件系统一致(中文/空格路径)
- [x] 3.3 chokidar 增量:add 入库、change 更新+重生成缩略图、unlink 标 missing、恢复取消;集成测试:复制/修改/删除/还原四步断言
- [x] 3.4 文件指纹服务(sha1 前 64KB+size);单测:同内容同指纹、修改后变化

## 4. IPC 与安全协议

- [x] 4.1 preload 暴露 `library:*` / `assets:*` / `thumbs:*` invoke API 与事件订阅(扫描进度、增量更新);主进程 handle 全量接线;手测 dev 桥调用链
- [x] 4.2 `media://` 协议(protocol.handle):库名+相对路径→绝对路径,白名单校验 + realpath 防穿越 + Range 支持;测试:库内 200/库外 403/穿越 403/视频 Range 206

## 5. 缩略图管线

- [x] 5.1 sharp 管线:320px WebP 生成与 `thumbs/<fingerprint>.webp` 缓存读写;单测:二次生成命中缓存
- [x] 5.2 ffmpeg 抽帧(-ss 1 -frames:v 1)接同一管线;MP4/MOV/损坏文件三例断言(成功/成功/占位+错误标记)
- [x] 5.3 串行队列 + 懒请求(渲染层可见卡片触发)+ 占位图(PSD/AI/失败);手测大目录浏览 UI 不卡

## 6. 调色板

- [x] 6.1 Worker k-means(64px、k=5、迭代 10,hex+占比);单测:纯色图返回单色 100%
- [x] 6.2 入库排队提取并写库,失败空 palette 不阻塞;集成测试:100 张图导入 UI 可交互、palette 逐步补全

## 7. 渲染层切换

- [x] 7.1 数据源接线:有库读 IPC,无库回退演示数据集 + 建库引导;`queryAssets` 语义回归(既有过滤用例全过)
- [x] 7.2 卡片/灯箱换 media:// 真实源,加载失败占位提示;回收站视图补「恢复/清空」入口
- [x] 7.3 编辑动作(检查器/灯箱/右键)全部改走落库 IPC,失败 toast;手测:编辑后杀进程重启数据保留
- [x] 7.4 标题栏「+」接建库流程,标签持久化与重启恢复;「在资源管理器中显示」对真实文件生效

## 8. 验证收尾

- [x] 8.1 vitest 单测+集成测试全绿(db/scan/fingerprint/thumbs/palette);`npm run typecheck`、`npm run build` 通过
- [x] 8.2 端到端手测清单:建库(素材/ 目录)→浏览→编辑→重启→恢复→删除文件→还原;对照本 change specs 逐 scenario 勾稽,偏差记录入 change 目录

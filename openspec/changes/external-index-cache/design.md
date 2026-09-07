## Context

每个可携带素材库已在 `.mediahub/library.db` 存储资产、标签和索引来源，并在 `.mediahub/thumbs/` 保存库自有素材的内容寻址缩略图。外部目录由 `source_index_id` 和 `@index:<id>/<relative-path>` 绑定，必须维持只引用而不接管源文件的边界。

## Storage

索引素材镜像落在：

```text
<library>/<source-relative-file>.lnk
<library>/<source-relative-file>.json
```

原文件扩展名保留在派生文件名中，以区分 `a.jpg` 与 `a.png`。缩略图统一落在 `<library>/.mediahub/thumbs/<fingerprint>.webp`。JSON 含 schema 版本、稳定索引来源 ID、源相对路径、指纹、扫描元数据、标签、备注、链接、评分、标记、分类路径和调色板；不含绝对源路径或媒体字节。快捷方式由 Windows `WScript.Shell` 创建，目标指向源文件。

SQLite 是唯一权威数据。数据库提交后，JSON 通过临时文件与原子 rename 物化；失败不回滚数据库，而在下一次扫描、缩略图请求或编辑时重试。缩略图也用相同的原子替换方式生成；快捷方式先写入临时 `.lnk` 再替换目标。

## Synchronization

扫描和 watcher 都返回每个 upsert 的结果：新增、未变、内容更新或从缺失记录重定位。内容指纹包含采样内容、文件大小和修改时间，使等大小修改也刷新缩略图。索引素材的 `thumb://` 解析到所属库 `.mediahub/thumbs/<fingerprint>.webp`，不在库根重复生成缩略图。

Windows 使用原生事件监听并保留 300 ms 写入稳定等待。索引 `unlink` 先标记缺失，等待 1500 ms；同来源、同指纹的 `add` 会将旧记录重定位到新路径，保留原 ID 与元数据。若新增先到，再由 `unlink` 将临时新记录合并回原记录。窗口结束时仍缺失的记录会删除对应 `.lnk`、JSON、缩略图与数据库行；不会为了清理镜像而删除库内用户目录。

应用启动时对库根和索引根静默对账，以同步应用关闭期间的变化。已注册的源根路径若整体移动，视为断开并要求用户重新绑定；不得扫描磁盘推测新位置。

## Safety

镜像路径拒绝空、绝对、`.` 和 `..` 的源相对段，并在写入、移动或删除前检查目标仍位于库根内且不进入 `.mediahub`。真正移除整个索引来源时，只能删除由该来源 JSON 标记的 `.lnk`/JSON 以及旧版已验证的 `index-cache/source-<id>` 残留。源目录 `E:\\素材` 永不写入。

## Verification

测试覆盖库根镜像层级、Windows 快捷方式目标、JSON 字段、原子写入、内容更新、两种重命名事件顺序、目录移动、删除清理、索引移除、旧缓存迁移、原生非轮询 watcher 和 `thumb://` 路由。使用 Electron Node ABI 执行 Vitest，再执行类型检查、构建和运行中的 Electron 人工验收。


import { useMemo, useState } from 'react'
import { useUI } from '../store/ui'
import { Icon } from './Icons'

interface MenuItem {
  icon: string
  label: string
  k?: string
  danger?: boolean
  /** 子菜单项：悬停/聚焦展开右侧面板，点击父项本身不执行动作 */
  children?: { label: string; hint?: string; swatch?: string; fn: () => void }[]
  /** 子菜单底部附带一个新建输入行(标签用) */
  tagInput?: boolean
  fn?: () => void
  /** 该项之前插入分隔线(数据驱动，不依赖数组下标) */
  sepBefore?: boolean
}

/** 素材右键菜单:跟随光标,屏边防溢出翻转 */
export function ContextMenu(): React.JSX.Element | null {
  const ctxMenu = useUI((s) => s.ctxMenu)
  const setCtxMenu = useUI((s) => s.setCtxMenu)
  const openLightbox = useUI((s) => s.openLightbox)
  const setRenaming = useUI((s) => s.setRenaming)
  const toggleFavorite = useUI((s) => s.toggleFavorite)
  const trashAsset = useUI((s) => s.trashAsset)
  const restoreAsset = useUI((s) => s.restoreAsset)
  const moveAssetsToFolder = useUI((s) => s.moveAssetsToFolder)
  const addTag = useUI((s) => s.addTag)
  const assets = useUI((s) => s.assets)
  const selectedIds = useUI((s) => s.selectedIds)
  const folderPaths = useUI((s) => s.folderPaths)
  const [openSub, setOpenSub] = useState<string | null>(null)
  const [tagDraft, setTagDraft] = useState('')

  /** 右键的素材若不在选中集内,则操作只针对它;否则针对整个选中集 */
  const targetIds = useMemo(() => {
    if (!ctxMenu) return []
    return selectedIds.includes(ctxMenu.assetId) ? selectedIds : [ctxMenu.assetId]
  }, [ctxMenu, selectedIds])

  /** 库内已用标签(按使用次数降序),供子菜单快速选择 */
  const knownTags = useMemo(() => {
    const stats = new Map<string, { color: string; n: number }>()
    for (const asset of assets) {
      if (asset.missing || asset.deletedAt) continue
      for (const tag of asset.tags) {
        const entry = stats.get(tag.name) ?? { color: tag.color, n: 0 }
        entry.n++
        stats.set(tag.name, entry)
      }
    }
    return [...stats.entries()].sort((x, y) => y[1].n - x[1].n).map(([name, v]) => ({ name, color: v.color }))
  }, [assets])

  if (!ctxMenu) return null
  const a = assets.find((x) => x.id === ctxMenu.assetId)
  const dbIds = targetIds
    .map((id) => assets.find((x) => x.id === id))
    .filter((x): x is NonNullable<typeof x> => x != null && x.dbId != null && x.libraryId != null)
  const libraryId = dbIds[0]?.libraryId
  const copyable = dbIds.length > 0
  const movable = dbIds.filter((x) => !x.missing && !x.deletedAt).length > 0

  const close = (): void => setCtxMenu(null)
  const act = (fn: () => void): void => {
    fn()
    close()
  }
  /** 子菜单动作:执行后关闭整个菜单 */
  const subAct = (fn: () => void): (() => void) => () => act(fn)

  const copySelection = (): void => {
    if (!copyable || libraryId == null) return
    void window.windowApi.assets.copy(libraryId, dbIds.map((x) => x.dbId as number))
  }

  const exportSelection = (): void => {
    if (!copyable || libraryId == null) return
    void window.windowApi.assets.export(libraryId, dbIds.map((x) => x.dbId as number))
  }

  const moveTargets = folderPaths.filter((path) => path !== '')
  const moveItems = moveTargets.length
    ? moveTargets.map((path) => ({
        label: path.split('/').pop() ?? path,
        hint: path.includes('/') ? path : undefined,
        fn: subAct(() => moveAssetsToFolder(targetIds, path))
      }))
    : [{ label: '库根目录', fn: subAct(() => moveAssetsToFolder(targetIds, '')) }]

  const tagItems = knownTags.map((tag) => ({
    label: tag.name,
    swatch: tag.color,
    fn: subAct(() => {
      for (const id of targetIds) addTag(id, tag.name)
    })
  }))

  const items: MenuItem[] = [
    {
      icon: 'external',
      label: '在资源管理器中显示',
      fn: a?.absPath ? () => window.windowApi.showInFolder(a.absPath as string) : undefined
    },
    { icon: 'edit', label: '重命名', k: 'F2', fn: () => setRenaming(true) },
    { icon: 'folder', label: '移动到…', sepBefore: true, children: moveItems },
    { icon: 'tag', label: '添加标签…', children: tagItems, tagInput: true },
    ...(a?.deletedAt
      ? [{ icon: 'sync', label: '从回收站恢复', fn: () => restoreAsset(ctxMenu.assetId) }]
      : [{ icon: 'heart', label: '添加到收藏', fn: () => toggleFavorite(ctxMenu.assetId) }]),
    { icon: 'copy', label: '复制', k: 'Ctrl C', sepBefore: true, fn: copyable ? copySelection : undefined },
    { icon: 'download', label: '导出…', fn: copyable ? exportSelection : undefined },
    { icon: 'info', label: '文件信息', k: 'Ctrl I', sepBefore: true, fn: () => openLightbox(ctxMenu.assetId) },
    { icon: 'trash', label: a?.deletedAt ? '彻底删除(仅记录)' : '删除', k: 'Del', sepBefore: true, danger: true, fn: () => trashAsset(ctxMenu.assetId) }
  ]

  const row = (it: MenuItem, key: string): React.JSX.Element => {
    // 带输入行的子菜单(标签)始终可用:即使暂无已有标签,也允许现场新建
    const hasSub = it.children != null && (it.children.length > 0 || it.tagInput === true)
    const enabled = it.fn != null || hasSub
    const expanded = openSub === key
    return (
      <div key={key} className="menu-row">
        <div className={it.danger ? 'danger' : undefined}>
          <button
            disabled={!enabled}
            aria-haspopup={hasSub ? 'menu' : undefined}
            aria-expanded={hasSub ? expanded : undefined}
            onMouseEnter={() => setOpenSub(hasSub ? key : null)}
            onFocus={() => setOpenSub(hasSub ? key : null)}
            onClick={() => {
              if (hasSub) {
                setOpenSub(expanded ? null : key)
                return
              }
              it.fn?.()
              close()
            }}
          >
            <Icon name={it.icon} />
            {it.label}
            {hasSub ? <Icon name="chev-r" className="ic sub" /> : null}
            {it.k ? <span className="k">{it.k}</span> : null}
          </button>
        </div>
        {hasSub && expanded ? (
          <div className="menu glass-menu open submenu" role="menu">
            {it.children!.length === 0 && !it.tagInput ? (
              <div className="menu-empty">暂无可选项</div>
            ) : null}
            {it.children!.map((child, i) => (
              <button key={`${child.label}-${i}`} onClick={child.fn}>
                {child.swatch ? <span className="dot" style={{ background: child.swatch }} /> : null}
                {child.label}
                {child.hint ? <span className="sub">{child.hint}</span> : null}
              </button>
            ))}
            {it.tagInput ? (
              <input
                className="menu-input"
                autoFocus
                placeholder="新建标签,回车确认"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && tagDraft.trim()) {
                    for (const id of targetIds) addTag(id, tagDraft.trim())
                    close()
                  }
                }}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 95 }}
      onClick={close}
      onContextMenu={(e) => { e.preventDefault(); close() }}
    >
      <div
        className="menu glass-menu open ctx-menu"
        style={{
          top: Math.min(ctxMenu.y, window.innerHeight - 380),
          left: Math.min(ctxMenu.x, window.innerWidth - 230)
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((it) => (
          <div key={it.label}>
            {it.sepBefore ? <div className="sep" /> : null}
            {row(it, it.label)}
          </div>
        ))}
      </div>
    </div>
  )
}

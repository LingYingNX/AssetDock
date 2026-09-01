import { useUI } from '../store/ui'
import { Icon } from './Icons'

/** 素材右键菜单:跟随光标,屏边防溢出翻转 */
export function ContextMenu(): React.JSX.Element | null {
  const ctxMenu = useUI((s) => s.ctxMenu)
  const setCtxMenu = useUI((s) => s.setCtxMenu)
  const openLightbox = useUI((s) => s.openLightbox)
  const setRenaming = useUI((s) => s.setRenaming)
  const toggleFavorite = useUI((s) => s.toggleFavorite)
  const trashAsset = useUI((s) => s.trashAsset)
  const restoreAsset = useUI((s) => s.restoreAsset)
  const assets = useUI((s) => s.assets)

  if (!ctxMenu) return null
  const a = assets.find((x) => x.id === ctxMenu.assetId)

  const close = (): void => setCtxMenu(null)
  const act = (fn: () => void): void => {
    fn()
    close()
  }

  const items: { icon: string; label: string; k?: string; sub?: boolean; danger?: boolean; fn?: () => void }[] = [
    { icon: 'eye', label: '打开预览', k: 'Enter', fn: () => openLightbox(ctxMenu.assetId) },
    {
      icon: 'external',
      label: '在资源管理器中显示',
      fn: a?.absPath ? () => window.windowApi.showInFolder(a.absPath as string) : undefined
    },
    { icon: 'edit', label: '重命名', k: 'F2', fn: () => setRenaming(true) },
    { icon: 'folder', label: '移动到…', sub: true },
    { icon: 'tag', label: '添加标签…', sub: true },
    ...(a?.deletedAt
      ? [{ icon: 'sync', label: '从回收站恢复', fn: () => restoreAsset(ctxMenu.assetId) }]
      : [{ icon: 'heart', label: '添加到收藏', fn: () => toggleFavorite(ctxMenu.assetId) }]),
    { icon: 'copy', label: '复制', k: 'Ctrl C' },
    { icon: 'download', label: '导出…' },
    { icon: 'info', label: '文件信息', k: 'Ctrl I', fn: () => openLightbox(ctxMenu.assetId) },
    { icon: 'trash', label: a?.deletedAt ? '彻底删除(仅记录)' : '删除', k: 'Del', danger: true, fn: () => trashAsset(ctxMenu.assetId) }
  ]

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 95 }}
      onClick={close}
      onContextMenu={(e) => { e.preventDefault(); close() }}
    >
      <div
        className="menu glass-menu open"
        style={{
          top: Math.min(ctxMenu.y, window.innerHeight - 380),
          left: Math.min(ctxMenu.x, window.innerWidth - 230),
          minWidth: 210
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((it, i) => (
          <div key={it.label}>
            {(i === 2 || i === 7 || i === 8) && <div className="sep" />}
            {it.danger ? (
              <div className="danger">
                <button disabled={!it.fn} onClick={() => it.fn && act(it.fn)}>
                  <Icon name={it.icon} />
                  {it.label}
                  {it.k ? <span className="k">{it.k}</span> : null}
                </button>
              </div>
            ) : (
              <button disabled={!it.fn} onClick={() => it.fn && act(it.fn)}>
                <Icon name={it.icon} />
                {it.label}
                {it.sub ? <svg className="ic sub" style={{ width: 11, height: 11, marginLeft: 'auto' }}><use href="#i-chev-r" /></svg> : null}
                {it.k ? <span className="k">{it.k}</span> : null}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

import { useUI } from '../store/ui'
import { Dropdown } from './Dropdown'
import { Icon } from './Icons'

export function Titlebar(): React.JSX.Element {
  const tabs = useUI((s) => s.tabs)
  const activeTabId = useUI((s) => s.activeTabId)
  const openTab = useUI((s) => s.openTab)
  const closeTab = useUI((s) => s.closeTab)
  const createLibraryFlow = useUI((s) => s.createLibraryFlow)
  const indexFlow = useUI((s) => s.indexFlow)
  const openMenu = useUI((s) => s.openMenu)
  const setOpenMenu = useUI((s) => s.setOpenMenu)

  const dragStyle = {
    WebkitAppRegion: openMenu ? 'no-drag' : 'drag'
  } as React.CSSProperties

  return (
    <header
      className="titlebar glass-titlebar"
      style={dragStyle}
      onPointerDown={() => setOpenMenu(null)}
    >
      <div className="logo">
        <span className="logo-mark"><Icon name="layers" /></span>
      </div>
      <nav
        className="lib-tabs"
        style={dragStyle}
        aria-label="素材库切换"
      >
        {tabs.map((t) => {
          const menuId = `tab-${t.id}`

          return (
            <button
              key={t.id}
              className={`lib-tab${t.id === activeTabId ? ' on' : ''}`}
              title={`${t.name} · 本地库`}
              data-menu={menuId}
              onClick={() => openTab(t.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                setOpenMenu(menuId)
              }}
            >
              <Icon name="drive" />
              {t.name}
              <span
                className="ic x"
                role="button"
                title="关闭"
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(t.id)
                }}
              >
                <svg className="ic"><use href="#i-x" /></svg>
              </span>
              <Dropdown
                compact
                id={menuId}
                items={[{ id: 'index', label: '索引目录到当前库…', icon: 'scan', disabled: t.libraryId == null }]}
                value=""
                onPick={() => {
                  openTab(t.id)
                  indexFlow()
                }}
              />
            </button>
          )
        })}
        <button
          className="lib-add"
          data-menu="m-libs"
          title="新建素材库"
          onClick={() => setOpenMenu(openMenu === 'm-libs' ? null : 'm-libs')}
        >
          <Icon name="plus" />
        </button>
        <Dropdown
          compact
          id="m-libs"
          items={[{ id: 'new', label: '新建素材库' }]}
          value=""
          onPick={(id) => {
            if (id === 'new') createLibraryFlow()
          }}
        />
      </nav>
      <div
        className="tb-spacer"
        style={{ WebkitAppRegion: openMenu ? 'no-drag' : 'drag' } as React.CSSProperties}
        onPointerDown={() => setOpenMenu(null)}
      />
      <div className="win-ctrls">
        <button className="tb-btn" title="最小化" onClick={() => window.windowApi.minimize()}>
          <Icon name="minus" />
        </button>
        <button className="tb-btn" title="最大化" onClick={() => window.windowApi.maximize()}>
          <Icon name="sq" />
        </button>
        <button className="tb-btn close" title="关闭" onClick={() => window.windowApi.close()}>
          <Icon name="x" />
        </button>
      </div>
    </header>
  )
}

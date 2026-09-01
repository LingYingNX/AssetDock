import { useUI } from '../store/ui'
import { Dropdown, type MenuItem } from './Dropdown'
import { Icon } from './Icons'

export function Titlebar(): React.JSX.Element {
  const tabs = useUI((s) => s.tabs)
  const activeTabId = useUI((s) => s.activeTabId)
  const openTab = useUI((s) => s.openTab)
  const closeTab = useUI((s) => s.closeTab)
  const addTab = useUI((s) => s.addTab)
  const libraries = useUI((s) => s.libraries)
  const createLibraryFlow = useUI((s) => s.createLibraryFlow)
  const openLibrary = useUI((s) => s.openLibrary)
  const openMenu = useUI((s) => s.openMenu)
  const setOpenMenu = useUI((s) => s.setOpenMenu)

  const libItems: MenuItem[] = [
    { id: 'new', label: '新建素材库(选择文件夹…)', icon: 'plus', groupEnd: true },
    ...libraries.map((l) => {
      const opened = tabs.some((t) => t.libraryId === l.id)
      return {
        id: `lib-${l.id}`,
        label: opened ? `${l.name}(已打开)` : l.name,
        icon: 'drive',
        disabled: opened
      }
    })
  ]

  return (
    <header className="titlebar glass-titlebar">
      <div className="logo">
        <span className="logo-mark"><Icon name="layers" /></span>
      </div>
      <nav className="lib-tabs" aria-label="素材库切换">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`lib-tab${t.id === activeTabId ? ' on' : ''}`}
            title={`${t.name} · 本地库`}
            onClick={() => openTab(t.id)}
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
          </button>
        ))}
        <button className="lib-add" data-menu="m-libs" title="新建素材库 / 打开已绑定库" onClick={addTab}>
          <Icon name="plus" />
        </button>
        <Dropdown
          id="m-libs"
          items={libItems}
          value=""
          onPick={(id) => {
            if (id === 'new') createLibraryFlow()
            else {
              const l = libraries.find((x) => `lib-${x.id}` === id)
              if (l) openLibrary(l.id, l.name)
            }
          }}
        />
      </nav>
      <div className="tb-spacer" />
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

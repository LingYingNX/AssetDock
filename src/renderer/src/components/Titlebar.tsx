import { useUI } from '../store/ui'
import { Dropdown } from './Dropdown'
import { Icon } from './Icons'
import { SettingsMenu } from './SettingsMenu'

export function Titlebar(): React.JSX.Element {
  const tabs = useUI((s) => s.tabs)
  const activeTabId = useUI((s) => s.activeTabId)
  const openTab = useUI((s) => s.openTab)
  const closeTab = useUI((s) => s.closeTab)
  const createLibraryFlow = useUI((s) => s.createLibraryFlow)
  const openMenu = useUI((s) => s.openMenu)
  const setOpenMenu = useUI((s) => s.setOpenMenu)

  // 只有下拉/齿轮这类浮层需要「点击标题栏其它区域关闭」,因此打开时暂停标题栏拖拽;
  // 偏好设置是带全屏遮罩的模态对话框,不依赖点击标题栏关闭,保持标题栏可拖拽。
  const modalOpen = openMenu === 'preferences'
  const dragStyle = {
    WebkitAppRegion: openMenu && !modalOpen ? 'no-drag' : 'drag'
  } as React.CSSProperties

  return (
    <header
      className="titlebar glass-titlebar"
      style={dragStyle}
    >
      <div className="brand-section">
        <div className="logo">
          <span className="logo-mark"><Icon name="layers" /></span>
        </div>
        <button
          className={`settings-btn${openMenu === 'settings' ? ' on' : ''}`}
          data-menu="settings"
          title="软件设置"
          aria-label="软件设置"
          aria-expanded={openMenu === 'settings'}
          onClick={() => setOpenMenu(openMenu === 'settings' ? null : 'settings')}
        >
          <Icon name="gear" />
        </button>
      </div>
      <SettingsMenu />
      <nav
        className="lib-tabs"
        style={dragStyle}
        aria-label="素材库切换"
      >
        {tabs.map((t) => {
          return (
            <button
              key={t.id}
              className={`lib-tab${t.id === activeTabId ? ' on' : ''}`}
              title={`${t.name} · 本地库`}
              onClick={() => {
                setOpenMenu(null)
                openTab(t.id)
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
                  setOpenMenu(null)
                  closeTab(t.id)
                }}
              >
                  <svg className="ic"><use href="#i-x" /></svg>
                </span>
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

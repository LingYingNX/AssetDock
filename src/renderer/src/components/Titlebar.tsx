import { useUI } from '../store/ui'
import { Icon } from './Icons'
import { SettingsMenu } from './SettingsMenu'

export function Titlebar(): React.JSX.Element {
  const tabs = useUI((s) => s.tabs)
  const activeTabId = useUI((s) => s.activeTabId)
  const openTab = useUI((s) => s.openTab)
  const openMenu = useUI((s) => s.openMenu)
  const setOpenMenu = useUI((s) => s.setOpenMenu)

  return (
    <header className="titlebar glass-titlebar">
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
      <nav className="lib-tabs" aria-label="素材库切换" onContextMenu={(e) => e.preventDefault()}>
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`lib-tab${t.id === activeTabId ? ' on' : ''}`}
            title={`${t.name} · 本地库`}
            onClick={() => openTab(t.id)}
          >
            {t.name}
          </button>
        ))}
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

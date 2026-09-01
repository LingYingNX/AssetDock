import { useUI } from '../store/ui'
import { Icon } from './Icons'

export function Titlebar(): React.JSX.Element {
  const tabs = useUI((s) => s.tabs)
  const activeTabId = useUI((s) => s.activeTabId)
  const openTab = useUI((s) => s.openTab)
  const closeTab = useUI((s) => s.closeTab)
  const addTab = useUI((s) => s.addTab)

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
        <button className="lib-add" title="新建素材库" onClick={addTab}>
          <Icon name="plus" />
        </button>
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

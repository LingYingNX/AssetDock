import { useUI } from '../store/ui'
import { Icon } from './Icons'
import { SettingsMenu } from './SettingsMenu'

export function Titlebar(): React.JSX.Element {
  const tabs = useUI((s) => s.tabs)
  const activeTabId = useUI((s) => s.activeTabId)
  const openTab = useUI((s) => s.openTab)
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
      {/* 品牌区只剩齿轮:logo 方块已删除(它是个没有文字的孤立色块,和下面的窗口控制、
          库按钮都不同尺寸,只贡献噪音)。齿轮是「创建资源库 / 资源库管理 / 偏好设置」
          的唯一入口,必须留着。 */}
      <div className="brand-section">
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
      {/* 素材库切换:每个库一颗胶囊(样式见 app.css 的 .lib-tab)。
          这里既不挂「关闭」也不挂「新建」——它们在标题栏里就是浏览器标签页的样子,
          且一颗胶囊才 32px 高,塞进第二个图标后命中区会挤成一团。
          库的新建/关闭改由齿轮菜单承载:创建资源库 / 资源库管理 › 关闭当前素材库。 */}
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
            </button>
          )
        })}
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

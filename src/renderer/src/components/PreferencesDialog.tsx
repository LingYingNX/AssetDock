import { useEffect, useMemo, useRef, useState } from 'react'
import { formatBytes } from '../data/query'
import { useUI } from '../store/ui'
import { Icon } from './Icons'
import { applyTheme, currentTheme, parseTheme, writeMirroredTheme, type ThemeMode } from '../data/theme'

type CloseAction = 'minimize' | 'quit'
type PreferenceState = {
  openMode: 'recent' | 'specified'
  autoSync: boolean
  theme: ThemeMode
  autoLaunch: boolean
  closeAction: CloseAction
  hoverAudio: boolean
  hoverVideo: boolean
  hoverGif: boolean
  hoverSound: boolean
}

const PREFERENCES_KEY = 'preferences'
const DEFAULT_PREFERENCES: PreferenceState = {
  openMode: 'recent',
  autoSync: true,
  theme: 'light',
  autoLaunch: false,
  closeAction: 'minimize',
  hoverAudio: true,
  hoverVideo: true,
  hoverGif: true,
  hoverSound: false
}

type SectionKey = 'general' | 'library' | 'media' | 'interface' | 'operation' | 'shortcuts' | 'notify'

const SECTIONS: { key: SectionKey; icon: string; label: string }[] = [
  { key: 'general', icon: 'sliders', label: '常用' },
  { key: 'library', icon: 'drive', label: '资源库' },
  { key: 'media', icon: 'film', label: '音视频' },
  { key: 'interface', icon: 'grid', label: '界面' },
  { key: 'operation', icon: 'edit', label: '操作' },
  { key: 'shortcuts', icon: 'more-h', label: '快捷键' },
  { key: 'notify', icon: 'info', label: '通知' }
]

/**
 * 快捷键清单。只列 App.tsx / CssEditor.tsx 里真实绑定的键,不写"计划中"的条目——
 * 文档与实现漂移比没有文档更坏。
 */
const SHORTCUT_GROUPS: { group: string; items: { keys: string; label: string }[] }[] = [
  {
    group: '全局',
    items: [
      { keys: 'Ctrl F', label: '聚焦搜索框' },
      { keys: 'Ctrl ,', label: '打开偏好设置' },
      { keys: 'Ctrl A', label: '全选当前视图' },
      { keys: 'Ctrl 滚轮', label: '调整缩略图大小' },
      { keys: 'Esc', label: '关闭浮层 / 取消重命名' }
    ]
  },
  {
    group: '素材浏览',
    items: [
      { keys: 'Enter', label: '打开选中素材' },
      { keys: 'Space', label: '选中 / 取消选中' },
      { keys: 'F2', label: '重命名' },
      { keys: 'Del', label: '移入回收站' },
      { keys: 'Ctrl I', label: '查看文件信息' }
    ]
  },
  {
    group: '灯箱',
    items: [
      { keys: '← →', label: '上一个 / 下一个' },
      { keys: 'Enter', label: '收藏 / 取消收藏' },
      { keys: 'Esc', label: '关闭' }
    ]
  },
  {
    group: 'CSS 编辑器',
    items: [
      { keys: 'Ctrl S', label: '保存到原文件' },
      { keys: 'Tab', label: '插入两个空格' }
    ]
  }
]

function readPreferences(raw: string | null): PreferenceState {
  if (!raw) return DEFAULT_PREFERENCES
  try {
    const value = JSON.parse(raw) as Partial<PreferenceState>
    return {
      openMode: value.openMode === 'specified' ? 'specified' : 'recent',
      autoSync: value.autoSync !== false,
      theme: parseTheme(raw),
      autoLaunch: value.autoLaunch === true,
      closeAction: value.closeAction === 'quit' ? 'quit' : 'minimize',
      hoverAudio: value.hoverAudio !== false,
      hoverVideo: value.hoverVideo !== false,
      hoverGif: value.hoverGif !== false,
      hoverSound: value.hoverSound === true
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

function Choice({ checked, disabled, label, name, onChange }: { checked: boolean; disabled?: boolean; label: string; name: string; onChange?: () => void }): React.JSX.Element {
  return (
    <label className={`pref-choice${disabled ? ' disabled' : ''}`}>
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} />
      <span>{label}</span>
    </label>
  )
}

function Check({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }): React.JSX.Element {
  return (
    <label className="pref-choice">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  )
}

export function PreferencesDialog(): React.JSX.Element | null {
  const open = useUI((s) => s.openMenu === 'preferences')
  const setOpenMenu = useUI((s) => s.setOpenMenu)
  const libraries = useUI((s) => s.libraries)
  const tabs = useUI((s) => s.tabs)
  const activeTabId = useUI((s) => s.activeTabId)
  const assets = useUI((s) => s.assets)
  const createLibraryFlow = useUI((s) => s.createLibraryFlow)
  const [section, setSection] = useState<SectionKey>('general')
  const [draft, setDraft] = useState<PreferenceState>(DEFAULT_PREFERENCES)
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [libraryName, setLibraryName] = useState('')
  const [libraryPath, setLibraryPath] = useState('')
  const [autoLaunchSupported, setAutoLaunchSupported] = useState(true)
  /** 偏好是否已从磁盘加载完成:draft 初值是默认浅色,加载前拿它预览会把夜间切成白天 */
  const [draftLoaded, setDraftLoaded] = useState(false)
  /** 已保存的主题:面板打开时从权威记录读到的值,关闭时据此同步回滚 */
  const savedTheme = useRef<ThemeMode>('light')

  const activeLibrary = useMemo(() => {
    const libraryId = tabs.find((tab) => tab.id === activeTabId)?.libraryId
    return libraries.find((library) => library.id === libraryId)
  }, [activeTabId, libraries, tabs])
  const libraryAssets = useMemo(
    () => assets.filter((asset) => asset.libraryId === activeLibrary?.id && !asset.deletedAt && !asset.missing),
    [activeLibrary?.id, assets]
  )
  const librarySize = useMemo(() => libraryAssets.reduce((total, asset) => total + asset.sizeBytes, 0), [libraryAssets])

  useEffect(() => {
    if (!open) return
    // 打开面板不立即预览:draft 此刻还是默认值(浅色)。先标记未加载,
    // 等读到真正保存的偏好再允许预览,否则点开设置就会把夜间外观切成白天。
    setDraftLoaded(false)
    // 兜底基线:偏好读取失败时,关闭要回滚到打开前的真实外观,而不是默认浅色。
    savedTheme.current = currentTheme()
    let cancelled = false
    void window.windowApi.state.get(PREFERENCES_KEY).then((raw) => {
      if (cancelled) return
      const loaded = readPreferences(raw)
      savedTheme.current = loaded.theme
      setDraft(loaded)
      setDraftLoaded(true)
    })
    void window.windowApi.app.getAutoLaunch().then((r) => {
      if (!cancelled) setAutoLaunchSupported(r.supported)
    })
    return () => { cancelled = true }
  }, [open])

  // 主题即时预览:切换单选项立刻生效;取消关闭时回滚为已保存值。
  // 必须等偏好加载完成:加载前 draft 是默认浅色,预览会误切主题。
  useEffect(() => {
    if (!open || !draftLoaded) return
    applyTheme(draft.theme)
  }, [open, draftLoaded, draft.theme])

  /* 遮罩与对话框都是整窗尺寸的层,原来直接 return null 卸载 —— 0ms 硬消失。
     改成:mounted 决定是否在 DOM 里,shown 决定外观两态,关闭后再等退场走完才卸载。
     卸载定时器不能省:reduced-motion 下过渡被全局移除,transitionend 永不触发,
     只靠事件会让关闭后的弹窗永远留在 DOM 里。 */
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (open) setMounted(true)
  }, [open])

  useEffect(() => {
    if (!open) return
    // 下一帧才置 shown:让「已挂载但未显形」这一帧成为过渡起点
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [open])

  useEffect(() => {
    if (open) return
    setShown(false)
    if (!mounted) return
    const t = window.setTimeout(() => setMounted(false), 180)
    return () => window.clearTimeout(t)
  }, [open, mounted])

  if (!mounted) return null

  const close = (): void => {
    // 同步回滚到已保存主题。原来是 state.get() 异步取回后才 applyTheme—面板已经关掉,
    // 迟到的值会覆盖用户随后的任何切换,于是"勾选夜间、外观白天"。
    applyTheme(savedTheme.current)
    setOpenMenu(null)
  }
  const closeCreate = (force = false): void => {
    if (creating && !force) return
    setCreateOpen(false)
    setLibraryName('')
    setLibraryPath('')
  }
  const save = (): void => {
    if (saving) return
    setSaving(true)
    void window.windowApi.state
      .set(PREFERENCES_KEY, JSON.stringify(draft))
      .then(() => {
        // 保存成功才算"已保存主题":回滚基线与首帧镜像一起更新
        savedTheme.current = draft.theme
        writeMirroredTheme(draft.theme)
        if (autoLaunchSupported) void window.windowApi.app.setAutoLaunch(draft.autoLaunch)
        // 立即同步到运行中的界面,不必重启即可看到音视频偏好生效
        useUI.getState().setHoverPlayback(draft.hoverVideo, draft.hoverSound)
        close()
      })
      .catch(() => useUI.getState().showToast('保存偏好设置失败,请重试', 'warn'))
      .finally(() => setSaving(false))
  }
  const browseLibraryPath = (): void => {
    void window.windowApi.pickFolder().then((path) => {
      if (path) setLibraryPath(path)
    })
  }
  const createLibrary = (): void => {
    const name = libraryName.trim()
    if (!name) {
      useUI.getState().showToast('请输入资源库名称', 'warn')
      return
    }
    if (!libraryPath) {
      useUI.getState().showToast('请选择存储文件夹路径', 'warn')
      return
    }
    setCreating(true)
    void createLibraryFlow(name, libraryPath).then((created) => {
      if (created) closeCreate(true)
    }).finally(() => setCreating(false))
  }

  const generalPane = (
    <>
      <section className="pref-section">
        <h2>主题</h2>
        <div className="pref-row">
          <Choice name="theme" label="白天模式" checked={draft.theme === 'light'} onChange={() => setDraft({ ...draft, theme: 'light' })} />
          <Choice name="theme" label="夜间模式" checked={draft.theme === 'dark'} onChange={() => setDraft({ ...draft, theme: 'dark' })} />
        </div>
      </section>
      <section className="pref-section">
        <h2>启动</h2>
        <div className="pref-options">
          <Check
            checked={draft.autoLaunch}
            label={autoLaunchSupported ? '开机时自动启动' : '开机时自动启动（打包后可用）'}
            onChange={() => setDraft({ ...draft, autoLaunch: !draft.autoLaunch })}
          />
        </div>
      </section>
      <section className="pref-section">
        <h2>关闭按钮</h2>
        <div className="pref-row">
          <Choice name="close-action" label="最小化" checked={draft.closeAction === 'minimize'} onChange={() => setDraft({ ...draft, closeAction: 'minimize' })} />
          <Choice name="close-action" label="退出软件" checked={draft.closeAction === 'quit'} onChange={() => setDraft({ ...draft, closeAction: 'quit' })} />
        </div>
      </section>
    </>
  )

  const libraryPane = (
    <>
      <section className="pref-section">
        <h2>默认打开</h2>
        <div className="pref-options">
          <Choice name="open-mode" label="默认打开最近使用资源库" checked={draft.openMode === 'recent'} onChange={() => setDraft({ ...draft, openMode: 'recent' })} />
          <Choice name="open-mode" label="启动时打开指定资源库" checked={draft.openMode === 'specified'} disabled />
        </div>
      </section>
      <section className="pref-section">
        <h2>打开资源库是否自动同步</h2>
        <div className="pref-row">
          <Choice name="auto-sync" label="是" checked={draft.autoSync} onChange={() => setDraft({ ...draft, autoSync: true })} />
          <Choice name="auto-sync" label="否" checked={!draft.autoSync} onChange={() => setDraft({ ...draft, autoSync: false })} />
        </div>
      </section>
      <section className="pref-section">
        <h2>资源库信息</h2>
        <div className="pref-library">
          <div className="pref-library-badge">
            <span className="pref-library-icon"><Icon name="layers" /></span>
            <span className="pref-current">(当前)</span>
            <span>{activeLibrary?.name ?? '未打开资源库'}</span>
          </div>
          <div className="pref-library-details">
            <span>资源库大小：{formatBytes(librarySize)}</span>
            <span>素材数量：{libraryAssets.length.toLocaleString('en-US')}</span>
            <span className="pref-library-path">{activeLibrary?.path ?? '—'}</span>
            {activeLibrary ? <button className="pref-link" onClick={() => window.windowApi.showInFolder(activeLibrary.path)}>打开</button> : null}
          </div>
        </div>
        <div className="pref-create-bar">
          <button className="pref-create-library" onClick={() => setCreateOpen(true)}><Icon name="plus" />创建资源库</button>
        </div>
      </section>
    </>
  )

  const mediaPane = (
    <>
      <section className="pref-section">
        <h2>列表模式悬浮是否自动播放</h2>
        <div className="pref-row">
          <Check checked={draft.hoverAudio} label="音频自动播放" onChange={() => setDraft({ ...draft, hoverAudio: !draft.hoverAudio })} />
          <Check checked={draft.hoverVideo} label="视频自动播放" onChange={() => setDraft({ ...draft, hoverVideo: !draft.hoverVideo })} />
          <Check checked={draft.hoverGif} label="GIF 自动播放" onChange={() => setDraft({ ...draft, hoverGif: !draft.hoverGif })} />
        </div>
      </section>
      <section className="pref-section">
        <h2>列表模式是否开启音量</h2>
        <div className="pref-row">
          <Choice name="hover-sound" label="静音" checked={!draft.hoverSound} onChange={() => setDraft({ ...draft, hoverSound: false })} />
          <Choice name="hover-sound" label="开启音量" checked={draft.hoverSound} onChange={() => setDraft({ ...draft, hoverSound: true })} />
        </div>
      </section>
    </>
  )

  const emptyPane = (label: string): React.JSX.Element => (
    <section className="pref-section pref-empty-pane">
      <h2>{label}</h2>
      <p>该分类暂无可用设置。</p>
    </section>
  )

  /* 快捷键为只读速查表:无草稿可改,故不参与「保存/取消」那套提交语义 */
  const shortcutsPane = (
    <>
      {SHORTCUT_GROUPS.map((g) => (
        <section className="pref-section" key={g.group}>
          <h2>{g.group}</h2>
          <div className="pref-keys">
            {g.items.map((it) => (
              <div className="pref-key-row" key={`${g.group}-${it.label}`}>
                <span className="pref-key-label">{it.label}</span>
                <span className="pref-key-combo">
                  {it.keys.split(' ').map((k) => <kbd key={k}>{k}</kbd>)}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  )

  const panes: Record<SectionKey, React.JSX.Element> = {
    general: generalPane,
    library: libraryPane,
    media: mediaPane,
    interface: emptyPane('界面'),
    operation: emptyPane('操作'),
    shortcuts: shortcutsPane,
    notify: emptyPane('通知')
  }

  return (
    <div className={`pref-backdrop${shown ? ' show' : ''}`} role="presentation">
      <section className={`pref-dialog glass-preferences${shown ? ' show' : ''}`} role="dialog" aria-modal="true" aria-label="偏好设置">
        <header className="pref-header">
          <span className="pref-title">偏好设置</span>
          <button className="pref-close" title="关闭" aria-label="关闭" onClick={close}><Icon name="x" /></button>
        </header>
        <div className="pref-body">
          <nav className="pref-nav" aria-label="偏好设置分类">
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                type="button"
                className={`pref-nav-item${section === s.key ? ' on' : ''}`}
                aria-current={section === s.key ? 'page' : undefined}
                onClick={() => setSection(s.key)}
              >
                <Icon name={s.icon} />
                {s.label}
              </button>
            ))}
          </nav>
          <main className="pref-content">
            {panes[section]}
            {/* 快捷键是只读速查表,没有草稿可提交,给出「保存」只会让人以为需要点 */}
            {section === 'shortcuts' ? null : (
              <footer className="pref-footer">
                <button className="pref-cancel" onClick={close}>取消</button>
                <button className="pref-save" disabled={saving} onClick={save}>{saving ? '保存中…' : '保存'}</button>
              </footer>
            )}
          </main>
        </div>
      </section>
      {createOpen ? (
        <div className="pref-create-backdrop" role="presentation">
          <section className="pref-create-dialog glass-preferences" role="dialog" aria-modal="true" aria-label="创建资源库">
            <header className="pref-create-header">创建资源库</header>
            <label className="pref-field">
              <span>资源库名称</span>
              <input autoFocus value={libraryName} placeholder="例如：设计素材库" onChange={(event) => setLibraryName(event.target.value)} />
            </label>
            <label className="pref-field">
              <span>存储路径</span>
              <span className="pref-path-picker">
                <input value={libraryPath} placeholder="请选择存储文件夹路径..." readOnly onClick={browseLibraryPath} />
                <button type="button" onClick={browseLibraryPath}>浏览...</button>
              </span>
            </label>
            <footer className="pref-create-footer">
              <button type="button" className="pref-cancel" disabled={creating} onClick={() => closeCreate()}>取消</button>
              <button type="button" className="pref-save" disabled={creating} onClick={createLibrary}>{creating ? '创建中…' : '确认创建'}</button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  )
}

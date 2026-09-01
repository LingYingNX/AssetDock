import { useState } from 'react'
import { useUI } from '../store/ui'
import { FOLDERS, SWATCHES } from '../data/dataset'
import { sidebarCounts } from '../data/query'
import { Icon } from './Icons'

export function Sidebar(): React.JSX.Element {
  const nav = useUI((s) => s.nav)
  const setNav = useUI((s) => s.setNav)
  const swatches = useUI((s) => s.swatches)
  const toggleSwatch = useUI((s) => s.toggleSwatch)
  const clearSwatches = useUI((s) => s.clearSwatches)
  const assets = useUI((s) => s.assets)
  const c = sidebarCounts(assets)
  const tagStats = assets.reduce<Record<string, { color: string; n: number }>>((acc, a) => {
    for (const t of a.tags) {
      acc[t.name] = acc[t.name] ?? { color: t.color, n: 0 }
      acc[t.name].n++
    }
    return acc
  }, {})

  const [expFolders, setExpFolders] = useState<string[]>(['03 视频素材'])
  const toggleFolder = (name: string): void =>
    setExpFolders((xs) => (xs.includes(name) ? xs.filter((x) => x !== name) : [...xs, name]))

  return (
    <aside className="sidebar glass-sidebar">
      <div className="side-scroll">
        <section className="side-sec">
          <div className="side-title"><Icon name="clock" />快捷访问</div>
          <button className={`nav-item${nav === 'all' ? ' on' : ''}`} onClick={() => setNav('all')}>
            <Icon name="layers" />全部素材<span className="cnt">{c.all.toLocaleString('en-US')}</span>
          </button>
          <button className={`nav-item${nav === 'recent' ? ' on' : ''}`} onClick={() => setNav('recent')}>
            <Icon name="clock" />最近导入<span className="cnt">{c.recent}</span>
          </button>
          <button className={`nav-item${nav === 'untagged' ? ' on' : ''}`} onClick={() => setNav('untagged')}>
            <Icon name="inbox" />未分类<span className="cnt">{c.untagged}</span>
          </button>
          <button className={`nav-item${nav === 'fav' ? ' on' : ''}`} onClick={() => setNav('fav')}>
            <Icon name="heart" />收藏<span className="cnt">{c.fav}</span>
          </button>
          <button className={`nav-item${nav === 'trash' ? ' on' : ''}`} onClick={() => setNav('trash')}>
            <Icon name="trash" />回收站<span className="cnt">{c.trash}</span>
          </button>
        </section>

        <section className="side-sec">
          <div className="side-title"><Icon name="folder" />文件夹</div>
          {FOLDERS.map((f) => {
            const key = `folder:${f.name}` as const
            const exp = expFolders.includes(f.name)
            return (
              <div key={f.name}>
                <button
                  className={`nav-item${exp ? ' exp' : ''}${nav === key ? ' on' : ''}`}
                  onClick={() => {
                    setNav(key)
                    if (f.children) toggleFolder(f.name)
                  }}
                >
                  {f.children ? <Icon name="chev-r" className="chev" /> : <span style={{ width: 15 }} />}
                  <Icon name="folder" />
                  {f.name}
                  <span className="cnt">{c.folders[f.name] ?? 0}</span>
                </button>
                {exp && f.children && (
                  <div className="nav-tree">
                    {f.children.map((ch) => {
                      const ck = `folder:${ch}` as const
                      return (
                        <button
                          key={ch}
                          className={`nav-item${nav === ck ? ' on' : ''}`}
                          onClick={() => setNav(ck)}
                        >
                          <Icon name="folder" />
                          {ch}
                          <span className="cnt">{c.folders[ch] ?? 0}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
          <button className="side-add"><Icon name="plus" />新建文件夹</button>
        </section>

        <section className="side-sec">
          <div className="side-title"><Icon name="tag" />标签</div>
          {Object.entries(tagStats).map(([name, info]) => {
            const key = `tag:${name}` as const
            return (
              <button key={name} className={`nav-item${nav === key ? ' on' : ''}`} onClick={() => setNav(key)}>
                <span className="dot" style={{ background: info.color }} />
                {name}
                <span className="cnt">{info.n}</span>
              </button>
            )
          })}
          <button className="side-add"><Icon name="edit" />管理标签</button>
        </section>

        <section className="side-sec">
          <div className="side-title"><Icon name="image" />颜色筛选</div>
          <div className="swatches" role="group" aria-label="按颜色筛选">
            <button
              className="sw all"
              title="全部颜色"
              onClick={clearSwatches}
            />
            {SWATCHES.filter((sw) => sw.color).map((sw) => {
              const color = sw.color as string
              const on = swatches.includes(color)
              return (
                <button
                  key={color}
                  className={`sw${on ? ' on' : ''}`}
                  style={{ background: color }}
                  title={sw.title}
                  onClick={() => toggleSwatch(color)}
                />
              )
            })}
          </div>
        </section>
      </div>
    </aside>
  )
}

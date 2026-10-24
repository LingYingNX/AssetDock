import { useEffect, useState } from 'react'
import { useUI } from '../store/ui'
import { SUGGESTED_TAGS } from '../data/dataset'
import { infoRows } from '../data/query'
import { Icon } from './Icons'
import { formatSpec } from '../../../shared/formats'

export function Inspector(): React.JSX.Element {
  const assets = useUI((s) => s.assets)
  const activeId = useUI((s) => s.activeId)
  const firstSelectedId = useUI((s) => s.selectedIds[0] ?? null)
  const renaming = useUI((s) => s.renaming)
  const setRenaming = useUI((s) => s.setRenaming)
  const startRenaming = useUI((s) => s.startRenaming)
  const renameAsset = useUI((s) => s.renameAsset)
  const setRating = useUI((s) => s.setRating)
  const addTag = useUI((s) => s.addTag)
  const removeTag = useUI((s) => s.removeTag)
  const setNote = useUI((s) => s.setNote)
  const setSourceUrl = useUI((s) => s.setSourceUrl)
  const [tagInput, setTagInput] = useState('')

  /* 当前素材:激活项 > 选中第一项 */
  const a = assets.find((x) => x.id === activeId) ?? assets.find((x) => x.id === firstSelectedId)
  const spec = a ? formatSpec(a.format) : undefined
  const external = spec && 'external' in spec ? spec.external : undefined

  if (!a) {
    return (
      <aside className="inspector glass-inspector">
        <div className="insp-empty">
          <Icon name="info" />
          <span>选中素材查看详情</span>
        </div>
      </aside>
    )
  }

  return (
    <aside className="inspector glass-inspector">
      <div className="insp-scroll">
        {a.type === 'image' && (
          <div className="palette" style={{ marginBottom: 14 }}>
            {a.palette.map((p) => (
              <div key={p.hex} className="pal" style={{ background: p.hex }}>
                <em>{p.ratio}%</em>
                <span>{p.hex}</span>
              </div>
            ))}
          </div>
        )}

        {/* 首块承担面板标题的角色:名字 + 改名入口,下面压一条分隔线把「这是什么素材」
            与「它的属性」分开。此前它和评分行、文件信息行只有同一种 16px 间距,
            三块连读像一段没有层次的清单。 */}
        <div className="insp-sec insp-id">
          <div className="fname">
            {renaming && activeId === a.id ? (
              <input
                defaultValue={a.name}
                ref={(el) => {
                  // 像 Windows 那样进入即全选,直接输入就能替换整个名字
                  if (!el) return
                  el.focus()
                  el.select()
                }}
                onBlur={(e) => renameAsset(a.id, e.target.value.trim() || a.name)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') renameAsset(a.id, (e.target as HTMLInputElement).value.trim() || a.name)
                  if (e.key === 'Escape') setRenaming(false)
                }}
              />
            ) : (
              <b>{a.name}</b>
            )}
            {!(renaming && activeId === a.id) && (
              <button
                className="rename-btn"
                type="button"
                title="重命名"
                aria-label="重命名"
                onClick={() => startRenaming(a.id)}
              >
                <Icon name="edit" />
              </button>
            )}
          </div>
        </div>

        <div className="insp-sec">
          <div className="insp-h"><Icon name="star" />评分</div>
          <span className="rate big">
            {[1, 2, 3, 4, 5].map((v) => (
              <span
                key={v}
                className={`star${a.rating >= v ? ' fill' : ''}`}
                onClick={() => setRating(a.id, a.rating === v ? v - 1 : v)}
              >
                <svg><use href="#i-star" /></svg>
              </span>
            ))}
          </span>
        </div>

        <div className="insp-sec">
          <div className="insp-h"><Icon name="info" />文件信息</div>
          <dl className="dl">
            {infoRows(a).map(([k, v, sub]) => (
              <Row key={k} k={k} v={v} sub={sub} />
            ))}
          </dl>
        </div>

        {external ? (
          <div className="insp-sec">
            <button
              className="dirin"
              type="button"
              onClick={() => {
                if (a.libraryId == null || a.dbId == null) return
                void window.windowApi.assets.openExternal(a.libraryId, a.dbId).then((result) => {
                  if ('error' in result) useUI.getState().showToast(result.error, 'warn')
                }).catch(() => useUI.getState().showToast('无法启动外部软件', 'warn'))
              }}
            >
              <Icon name="external" />
              <span>用 {external === 'blender' ? 'Blender' : 'Cinema 4D'} 打开</span>
            </button>
          </div>
        ) : null}

        <div className="insp-sec">
          <div className="insp-h"><Icon name="tag" />标签</div>
          <div className="tags">
            {a.tags.map((t) => (
              <span key={t.name} className="tag">
                <span className="dot" style={{ background: t.color }} />
                {t.name}
                <span className="x" onClick={() => removeTag(a.id, t.name)}>
                  <svg className="ic"><use href="#i-x" /></svg>
                </span>
              </span>
            ))}
          </div>
          <label className="tagin">
            <Icon name="plus" />
            <input
              type="text"
              placeholder="输入标签，Enter 添加"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tagInput.trim()) {
                  addTag(a.id, tagInput.trim())
                  setTagInput('')
                }
              }}
            />
            <kbd>Enter</kbd>
          </label>
          <div className="sugg">
            {SUGGESTED_TAGS.map((name) => {
              const used = a.tags.some((t) => t.name === name)
              return (
                <span
                  key={name}
                  className={used ? 'used' : ''}
                  onClick={() => addTag(a.id, name)}
                >
                  + {name}
                </span>
              )
            })}
          </div>
        </div>

        {a.absPath && (
          <div className="insp-sec">
            <button
              className="dirin"
              type="button"
              title={a.absPath}
              aria-label="在资源管理器中显示素材所在目录"
              onClick={() => window.windowApi.showInFolder(a.absPath as string)}
            >
              <Icon name="folder" />
              <span>{a.absPath.replace(/[\\/][^\\/]+$/, '')}</span>
            </button>
          </div>
        )}

        <div className="insp-sec">
          <div className="insp-h"><Icon name="external" />来源链接</div>
          <label className="linkin">
            <Icon name="external" />
            <input
              key={`source-${a.id}`}
              type="url"
              placeholder="粘贴素材来源链接 https://…"
              defaultValue={a.sourceUrl ?? ''}
              onBlur={(e) => setSourceUrl(a.id, e.target.value.trim())}
            />
          </label>
        </div>

        <div className="insp-sec">
          <div className="insp-h"><Icon name="edit" />备注</div>
          <textarea
            key={`note-${a.id}`}
            className="note"
            placeholder="添加备注、拍摄信息、使用限制…"
            defaultValue={a.note}
            onBlur={(e) => setNote(a.id, e.target.value)}
          />
        </div>
      </div>
    </aside>
  )
}

function Row({ k, v, sub }: { k: string; v: string; sub?: string }): React.JSX.Element {
  return (
    <>
      <dt>{k}</dt>
      <dd>
        {v}
        {sub ? <small>{sub}</small> : null}
      </dd>
    </>
  )
}

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
  const startRenaming = useUI((s) => s.startRenaming)
  const setRating = useUI((s) => s.setRating)
  const toggleFavorite = useUI((s) => s.toggleFavorite)
  const addTag = useUI((s) => s.addTag)
  const removeTag = useUI((s) => s.removeTag)
  const setNote = useUI((s) => s.setNote)
  const setSourceUrl = useUI((s) => s.setSourceUrl)
  const [tagInput, setTagInput] = useState('')

  /* 推荐标签默认不出现:只在用户开始输入时给出匹配候选 */
  const typedTag = tagInput.trim()
  const tagSuggestions = typedTag ? SUGGESTED_TAGS.filter((name) => name.includes(typedTag)) : []

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
          <div className="palette">
            {a.palette.map((p) => (
              <div key={p.hex} className="pal" style={{ background: p.hex }} title={`${p.ratio}% ${p.hex}`}>
                <em>{p.ratio}%</em>
                <span>{p.hex.replace("#", "")}</span>
              </div>
            ))}
          </div>
        )}

        {/* 首块承担面板标题的角色:名字 + 改名入口,下面压一条分隔线把「这是什么素材」
            与「它的属性」分开。此前它和评分行、文件信息行只有同一种 16px 间距,
            三块连读像一段没有层次的清单。 */}
        <div className="insp-sec insp-id">
          <div className="fname">
            <b title={a.name}>{a.name}</b>
            <button
              className="rename-btn"
              type="button"
              title="重命名"
              aria-label="重命名"
              onClick={() => startRenaming(a.id)}
            >
              <Icon name="edit" />
            </button>
          </div>
          {/* 评分并进标题卡:单独一张卡只放五颗星,占掉一整行高度却几乎不承载信息 */}
          <div className="insp-rate">
            <span className="insp-rate-k">评分</span>
            <span className="rate big" role="group" aria-label="评分">
            {[1, 2, 3, 4, 5].map((v) => (
              <button
                type="button"
                key={v}
                className={`star${a.rating >= v ? ' fill' : ''}`}
                aria-label={`${v} 星`}
                aria-pressed={a.rating >= v}
                onClick={() => setRating(a.id, a.rating === v ? v - 1 : v)}
              >
                <svg aria-hidden="true"><use href="#i-star" /></svg>
              </button>
            ))}
            </span>
            <span className="insp-rate-sep" aria-hidden="true" />
            <button
              type="button"
              className={`insp-fav${a.favorite ? ' on' : ''}`}
              title={a.favorite ? '取消收藏' : '收藏'}
              aria-label={a.favorite ? '取消收藏' : '收藏'}
              aria-pressed={a.favorite}
              onClick={() => toggleFavorite(a.id)}
            >
              <Icon name="heart" />
            </button>
          </div>
        </div>

        <div className="insp-group">
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
              <span>用 {external === 'blender' ? 'Blender' : external === 'office' ? '办公软件' : 'Cinema 4D'} 打开</span>
            </button>
          </div>
        ) : null}

        <div className="insp-sec">
          <div className="insp-h"><Icon name="tag" />标签</div>
          <div className="tags">
            {a.tags.map((t) => (
              <span key={t.name} className="tag">
                {t.name}
                <button
                  type="button"
                  className="x"
                  aria-label={`移除标签 ${t.name}`}
                  title={`移除标签 ${t.name}`}
                  onClick={() => removeTag(a.id, t.name)}
                >
                  <svg className="ic" aria-hidden="true"><use href="#i-x" /></svg>
                </button>
              </span>
            ))}
          </div>
          <label className="tagin">
            <input
              type="text"
              placeholder="输入标签，Enter 添加"
              aria-label="新标签名称"
              name="asset-tags"
              autoComplete="off"
              spellCheck={false}
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
          {tagSuggestions.length > 0 && (
          <div className="sugg">
            {tagSuggestions.map((name) => {
              const used = a.tags.some((t) => t.name === name)
              return (
                <button
                  type="button"
                  key={name}
                  className={used ? 'used' : ''}
                  disabled={used}
                  aria-label={used ? `${name} 已添加` : `添加标签 ${name}`}
                  onClick={() => addTag(a.id, name)}
                >
                  + {name}
                </button>
              )
            })}
          </div>
          )}
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
              aria-label="素材来源链接"
              name="source-url"
              autoComplete="off"
              spellCheck={false}
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
            aria-label="素材备注"
            name="asset-note"
            autoComplete="off"
            defaultValue={a.note}
            onBlur={(e) => setNote(a.id, e.target.value)}
          />
        </div>
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

import { useEffect, useState } from 'react'
import { useUI } from '../store/ui'
import { SUGGESTED_TAGS } from '../data/dataset'
import { infoRows } from '../data/query'
import { Icon } from './Icons'

export function Inspector(): React.JSX.Element {
  const assets = useUI((s) => s.assets)
  const activeId = useUI((s) => s.activeId)
  const selectedIds = useUI((s) => s.selectedIds)
  const renaming = useUI((s) => s.renaming)
  const setRenaming = useUI((s) => s.setRenaming)
  const renameAsset = useUI((s) => s.renameAsset)
  const setRating = useUI((s) => s.setRating)
  const toggleReviewFlag = useUI((s) => s.toggleReviewFlag)
  const addTag = useUI((s) => s.addTag)
  const removeTag = useUI((s) => s.removeTag)
  const setNote = useUI((s) => s.setNote)
  const setSourceUrl = useUI((s) => s.setSourceUrl)
  const [tagInput, setTagInput] = useState('')

  /* 当前素材:激活项 > 选中第一项 */
  const a = assets.find((x) => x.id === activeId) ?? assets.find((x) => x.id === selectedIds[0])

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

        <div className="insp-sec">
          <div className="fname">
            {renaming && activeId === a.id ? (
              <input
                autoFocus
                defaultValue={a.name}
                onBlur={(e) => renameAsset(a.id, e.target.value.trim() || a.name)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') renameAsset(a.id, (e.target as HTMLInputElement).value.trim() || a.name)
                }}
              />
            ) : (
              <b>{a.name}</b>
            )}
            <Icon name="edit" />
          </div>
        </div>

        <div className="insp-sec">
          <div className="flagrow">
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
            <button
              className={`flagbtn${a.reviewFlag ? ' on' : ''}`}
              style={{ marginLeft: 'auto' }}
              onClick={() => toggleReviewFlag(a.id)}
            >
              <Icon name="flag" />待审
            </button>
          </div>
        </div>

        <div className="insp-sec">
          <div className="insp-h"><Icon name="info" />文件信息</div>
          <dl className="dl">
            {infoRows(a).map(([k, v, sub]) => (
              <Row key={k} k={k} v={v} sub={sub} />
            ))}
          </dl>
        </div>

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
              placeholder="输入标签,Enter 添加"
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

        <div className="insp-sec">
          <div className="insp-h"><Icon name="external" />来源链接</div>
          <label className="linkin">
            <Icon name="external" />
            <input
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

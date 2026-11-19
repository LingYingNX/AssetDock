import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FORMAT_GROUPS, FORMAT_OPTIONS } from '../../../shared/formats'
import { useUI, type DisplayPrefs } from '../store/ui'
import { Icon } from './Icons'
import { useMenuFocus } from './useMenuFocus'

const MENU_ID = 'm-display'

/** 格式角标可单独隐藏的格式清单(去重后按注册表顺序) */
const ALL_FORMATS = FORMAT_OPTIONS.map((spec) => spec.format)

/** 格式所属大类:图片/视频/文档/三维,其余(如 CSS)归「其它」 */
const TYPE_OF = new Map<string, string>(FORMAT_GROUPS.flatMap((g) => g.formats.map((f) => [f, g.type])))
const MAIN_TYPES = ['image', 'video', 'document', 'model']

/** 卡片显示开关:四组都能独立关掉,菜单点选后不关闭 */
export function DisplayMenu(): React.JSX.Element | null {
  const openMenu = useUI((s) => s.openMenu)
  const setOpenMenu = useUI((s) => s.setOpenMenu)
  const display = useUI((s) => s.display)
  const setDisplay = useUI((s) => s.setDisplay)
  const assets = useUI((s) => s.assets)
  const nav = useUI((s) => s.nav)
  const ref = useRef<HTMLDivElement>(null)
  const open = openMenu === MENU_ID
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(open)
  const [fmtOpen, setFmtOpen] = useState(false)
  const [tab, setTab] = useState(0)
  useMenuFocus(open && mounted, ref, () => setOpenMenu(null))

  /** 只列当前文件夹里出现过的格式,避免 60 多个用不到的格式撑满菜单 */
  const present = useMemo(() => {
    const folder = nav.startsWith('folder:') ? nav.slice('folder:'.length) : null
    const list = folder ? assets.filter((a) => a.folders.includes(folder)) : assets
    const set = new Set(list.map((a) => a.format))
    return ALL_FORMATS.filter((f) => set.has(f))
  }, [assets, nav])
  const formats = present.length ? present : ALL_FORMATS

  const cats = useMemo(() => {
    const of = (type: string | undefined): string[] =>
      type === 'other'
        ? formats.filter((f) => !MAIN_TYPES.includes(TYPE_OF.get(f) ?? ''))
        : formats.filter((f) => TYPE_OF.get(f) === type)
    return [
      { label: '图片', formats: of('image') },
      { label: '视频', formats: of('video') },
      { label: '文档', formats: of('document') },
      { label: '三维', formats: of('model') },
      { label: '其它', formats: of('other') }
    ].filter((c) => c.formats.length > 0)
  }, [formats])

  const active = cats.length ? cats[Math.min(tab, cats.length - 1)] : null

  const setFormatsVisible = (list: readonly string[], visible: boolean): void => {
    const hidden = new Set(display.hiddenFormats)
    for (const f of list) {
      if (visible) hidden.delete(f)
      else hidden.add(f)
    }
    setDisplay({ hiddenFormats: [...hidden] })
  }

  useEffect(() => {
    if (open) {
      setMounted(true)
      setShown(true)
      return
    }
    setFmtOpen(false)
    if (useUI.getState().openMenu !== null) {
      setShown(false)
      setMounted(false)
      return
    }
    setShown(false)
    const timer = window.setTimeout(() => setMounted(false), 160)
    return () => window.clearTimeout(timer)
  }, [open])

  useLayoutEffect(() => {
    if (!open || !mounted) return
    const el = ref.current
    const btn = document.querySelector(`[data-menu="${MENU_ID}"]`)
    if (!el || !btn) return
    const r = btn.getBoundingClientRect()
    el.style.top = `${r.bottom + 6}px`
    if (r.left + el.offsetWidth > window.innerWidth - 8) {
      el.style.left = 'auto'
      el.style.right = `${Math.max(8, window.innerWidth - r.right)}px`
    } else {
      el.style.left = `${r.left}px`
      el.style.right = 'auto'
    }
  }, [open, mounted, fmtOpen, tab])

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      const trigger = document.querySelector(`[data-menu="${MENU_ID}"]`)
      if (ref.current?.contains(target) || trigger?.contains(target)) return
      setOpenMenu(null)
    }
    document.addEventListener('pointerdown', close, true)
    return () => document.removeEventListener('pointerdown', close, true)
  }, [open, setOpenMenu])

  if (!mounted) return null

  const toggleRow = (key: 'res' | 'size' | 'name', label: string): React.JSX.Element => (
    <button
      key={key}
      type="button"
      role="menuitemcheckbox"
      aria-checked={display[key]}
      className={display[key] ? 'on' : undefined}
      onClick={() => setDisplay({ [key]: !display[key] } as Partial<DisplayPrefs>)}
    >
      <span className="lbl">{label}</span>
      <span className="sw" aria-hidden="true" />
    </button>
  )


  return createPortal(
    <div
      ref={ref}
      className={`menu glass-menu pick-menu display-menu${shown ? ' open' : ' closing'}`}
      role="menu"
      aria-label="卡片显示选项"
    >
      {toggleRow('res', '分辨率')}
      {toggleRow('name', '名字')}
      {toggleRow('size', '大小')}
      <div className="disp-row">
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={display.fmt}
          className={display.fmt ? 'on' : undefined}
          onClick={() => setDisplay({ fmt: !display.fmt })}
        >
          <span className="lbl">格式</span>
          <span className="sw" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={fmtOpen ? 'disp-chev up' : 'disp-chev'}
          aria-expanded={fmtOpen}
          aria-label="展开格式列表"
          onClick={() => setFmtOpen((v) => !v)}
        >
          <Icon name={fmtOpen ? 'chev-d' : 'chev-r'} />
        </button>
      </div>
      {fmtOpen ? (
        <div className="fmt-panel">
          <div className="fmt-cats" role="tablist" aria-label="格式大类">
            {cats.map((c, i) => (
              <button
                key={c.label}
                type="button"
                role="tab"
                aria-selected={active === c}
                className={active === c ? 'fmt-cat on' : 'fmt-cat'}
                onClick={() => setTab(i)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="fmt-cells" role="group" aria-label="按格式显示">
            {(active?.formats ?? []).map((f) => {
              const on = !display.hiddenFormats.includes(f)
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={on}
                  className={on ? 'fmt-cell on' : 'fmt-cell'}
                  onClick={() => setFormatsVisible([f], !on)}
                >
                  {f}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
      <div className="sep" />
      <div className="menu-head">动图</div>
      <div className="display-seg" role="group" aria-label="动图播放方式">
        <button
          type="button"
          aria-pressed={display.gif === 'auto'}
          className={display.gif === 'auto' ? 'on' : undefined}
          onClick={() => setDisplay({ gif: 'auto' })}
        >
          自动播放
        </button>
        <button
          type="button"
          aria-pressed={display.gif === 'hover'}
          className={display.gif === 'hover' ? 'on' : undefined}
          onClick={() => setDisplay({ gif: 'hover' })}
        >
          悬停播放
        </button>
      </div>
    </div>,
    document.body
  )
}
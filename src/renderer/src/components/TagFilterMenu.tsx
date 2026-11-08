import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fmtCount } from '../data/query'
import {
  assignTagToGroup,
  tagItemsForCategory,
  visibleTagMenuItems,
  type TagCategory,
  type TagGroupDefinition,
  type TagMenuItem,
  type TagSort
} from '../data/filter-menu'
import { useUI } from '../store/ui'
import { Icon } from './Icons'
import { useMenuFocus } from './useMenuFocus'

const TAG_DRAG_TYPE = 'application/x-mediahub-tag'
const EMPTY_GROUPS: TagGroupDefinition[] = []

interface TagFilterMenuProps {
  id: string
  items: TagMenuItem[]
  value: string[]
  libraryId: number | null
  onPick: (id: string, additive: boolean) => void
  onPointerEnter?: () => void
}

export function TagFilterMenu({
  id,
  items,
  value,
  libraryId,
  onPick,
  onPointerEnter
}: TagFilterMenuProps): React.JSX.Element | null {
  const openMenu = useUI((s) => s.openMenu)
  const setOpenMenu = useUI((s) => s.setOpenMenu)
  const groupsByLibrary = useUI((s) => s.tagGroups)
  const setTagGroups = useUI((s) => s.setTagGroups)
  const ref = useRef<HTMLDivElement>(null)
  const addInputRef = useRef<HTMLInputElement>(null)
  const open = openMenu === id
  const groups = libraryId == null ? EMPTY_GROUPS : groupsByLibrary[String(libraryId)] ?? EMPTY_GROUPS
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(open)
  const [category, setCategory] = useState<TagCategory>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<TagSort>('count-desc')
  const [adding, setAdding] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [addError, setAddError] = useState(false)
  const [draggingTag, setDraggingTag] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [assignMenu, setAssignMenu] = useState<{ tag: string; x: number; y: number } | null>(null)
  const assignRef = useRef<HTMLDivElement>(null)
  const selectedSet = useMemo(() => new Set(value), [value])
  useMenuFocus(open && mounted, ref, () => setOpenMenu(null), 'dialog')
  useMenuFocus(assignMenu != null, assignRef, () => setAssignMenu(null))

  const categoryItems = useMemo(
    () => tagItemsForCategory(items, category, groups, value),
    [items, category, groups, value]
  )
  const visible = useMemo(
    () => visibleTagMenuItems(categoryItems, query, sort),
    [categoryItems, query, sort]
  )
  const ungroupedItems = useMemo(
    () => tagItemsForCategory(items, 'ungrouped', groups, value),
    [items, groups, value]
  )

  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    setAdding(false)
    setDraftName('')
    setAddError(false)
    setDraggingTag(null)
    setDropTarget(null)
    setAssignMenu(null)
    if (useUI.getState().openMenu !== null) {
      setShown(false)
      setMounted(false)
      return
    }
    setShown(false)
    const timer = window.setTimeout(() => setMounted(false), 160)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!assignMenu) return
    const onPointerDown = (event: PointerEvent): void => {
      if (assignRef.current?.contains(event.target as Node)) return
      setAssignMenu(null)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [assignMenu])

  useEffect(() => {
    if (!assignMenu) return
    const id = requestAnimationFrame(() => {
      assignRef.current?.querySelector<HTMLElement>('[role="menuitemradio"]')?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [assignMenu])

  useEffect(() => {
    if (!open || !mounted) return
    setShown(true)
  }, [open, mounted])

  useEffect(() => {
    if (adding) addInputRef.current?.focus()
  }, [adding])

  useEffect(() => {
    if (category === 'selected' && value.length === 0) setCategory('all')
    if (category.startsWith('group:') && !groups.some((group) => `group:${group.id}` === category)) {
      setCategory('all')
    }
  }, [category, groups, value])

  useLayoutEffect(() => {
    if (!open || !mounted) return
    const el = ref.current
    const trigger = document.querySelector(`[data-menu="${id}"]`)
    if (!el || !trigger) return
    const r = trigger.getBoundingClientRect()
    el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 438))}px`
    el.style.top = `${Math.max(8, Math.min(r.bottom + 6, window.innerHeight - 258))}px`
  }, [open, mounted, id])

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      const trigger = document.querySelector(`[data-menu="${id}"]`)
      if (ref.current?.contains(target) || trigger?.contains(target)) return
      setOpenMenu(null)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, id, setOpenMenu])

  if (!mounted) return null

  const addGroup = (): void => {
    const name = draftName.trim()
    if (libraryId == null || !name || groups.some((group) => group.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setAddError(true)
      return
    }
    const group: TagGroupDefinition = { id: crypto.randomUUID(), name, tagNames: [] }
    setTagGroups(libraryId, [...groups, group])
    setCategory(`group:${group.id}`)
    setAdding(false)
    setDraftName('')
    setAddError(false)
  }

  const removeGroup = (group: TagGroupDefinition): void => {
    if (libraryId == null) return
    setTagGroups(libraryId, groups.filter((item) => item.id !== group.id))
    if (category === `group:${group.id}`) setCategory('all')
  }

  const assignTag = (tagName: string, targetGroupId: string | null): void => {
    if (libraryId == null || !items.some((item) => item.id === tagName)) return
    setTagGroups(libraryId, assignTagToGroup(groups, tagName, targetGroupId))
  }

  const openAssignMenu = (tag: string, x: number, y: number): void => {
    setAssignMenu({
      tag,
      x: Math.max(8, Math.min(x, window.innerWidth - 188)),
      y: Math.max(8, Math.min(y, window.innerHeight - 260))
    })
  }

  const renderCategory = (
    categoryId: TagCategory,
    label: string,
    count: number,
    hasSelected: boolean,
    dropGroupId?: string | null,
    onDelete?: () => void
  ): React.JSX.Element => {
    const active = categoryId === category
    const canDrop = dropGroupId !== undefined
    return (
      <div
        key={categoryId}
        className={`tag-filter-cat-row${dropTarget === categoryId ? ' drop' : ''}`}
        onDragOver={(event) => {
          if (!canDrop || !draggingTag) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          if (dropTarget !== categoryId) setDropTarget(categoryId)
        }}
        onDragLeave={(event) => {
          const next = event.relatedTarget
          if (next instanceof Node && event.currentTarget.contains(next)) return
          if (dropTarget === categoryId) setDropTarget(null)
        }}
        onDrop={(event) => {
          if (!canDrop || !draggingTag) return
          event.preventDefault()
          assignTag(draggingTag, dropGroupId ?? null)
          setDraggingTag(null)
          setDropTarget(null)
        }}
      >
        <button
          type="button"
          className={active ? 'on' : ''}
          disabled={categoryId === 'selected' && value.length === 0}
          aria-pressed={active}
          onClick={() => setCategory(categoryId)}
        >
          {active ? <span className="tag-filter-cat-indicator" /> : null}
          <span className="tag-filter-cat-label">{label}</span>
          {hasSelected ? <span className="tag-filter-cat-dot" /> : null}
          <span className="tag-filter-cat-count">{count}</span>
        </button>
        {onDelete ? (
          <button
            type="button"
            className="tag-filter-cat-delete"
            aria-label={`删除总分类 ${label}`}
            title={`删除总分类 ${label}`}
            onClick={onDelete}
          >
            <Icon name="x" />
          </button>
        ) : null}
      </div>
    )
  }

  const selectedInAll = items.some((item) => selectedSet.has(item.id))
  const selectedInUngrouped = ungroupedItems.some((item) => selectedSet.has(item.id))
  const selectedInView = items.filter((item) => selectedSet.has(item.id)).length
  const emptyText = query.trim()
    ? '未匹配到标签'
    : category.startsWith('group:')
      ? '拖动标签到此分类'
      : '此分类暂无标签'

  const node = (
    <div
      ref={ref}
      className={`tag-filter-menu glass-menu${shown ? ' open' : ' closing'}`}
      role="dialog"
      aria-label="标签筛选"
      onPointerEnter={onPointerEnter}
      onPointerLeave={() => setOpenMenu(null)}
    >
      <header className="tag-filter-head">
        <div className="tag-filter-search">
          <Icon name="search" />
          <input
            type="text"
            value={query}
            aria-label="搜索标签"
            placeholder="搜索标签…"
            name="tag-search"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button type="button" aria-label="清空标签搜索" onClick={() => setQuery('')}>
              <Icon name="x" />
            </button>
          ) : null}
        </div>
        <div className="tag-filter-head-tools">
          <select value={sort} name="tag-sort" aria-label="标签排序" onChange={(event) => setSort(event.target.value as TagSort)}>
            <option value="count-desc">数量 ↓</option>
            <option value="count-asc">数量 ↑</option>
            <option value="name-asc">名称 A-Z</option>
          </select>
          <button
            type="button"
            className={value.length === 0 ? 'on' : ''}
            aria-pressed={value.length === 0}
            onClick={() => onPick('all', false)}
          >
            全部
          </button>
        </div>
      </header>

      <div className="tag-filter-body">
        <aside className="tag-filter-cats" aria-label="标签分类">
          <div className="tag-filter-cats-scroll">
            {renderCategory('all', '全部标签', items.length, selectedInAll)}
            {renderCategory(
              'selected',
              '已选标签',
              selectedInView,
              selectedInAll,
              undefined,
              undefined
            )}
            <div className="tag-filter-sep" />
            {renderCategory(
              'ungrouped',
              '未分类',
              ungroupedItems.length,
              selectedInUngrouped,
              null
            )}
            {groups.map((group) => {
              const members = tagItemsForCategory(items, `group:${group.id}`, groups, value)
              return renderCategory(
                `group:${group.id}`,
                group.name,
                members.length,
                members.some((item) => selectedSet.has(item.id)),
                group.id,
                () => removeGroup(group)
              )
            })}
          </div>
          <div className="tag-filter-add-wrap">
            {adding ? (
              <form
                className={`tag-filter-add-form${addError ? ' invalid' : ''}`}
                onSubmit={(event) => {
                  event.preventDefault()
                  addGroup()
                }}
              >
                <input
                  ref={addInputRef}
                  value={draftName}
                  maxLength={24}
                  aria-label="新总分类名称"
                  aria-invalid={addError}
                  placeholder={addError ? '名称无效或重复' : '分类名'}
                  onChange={(event) => {
                    setDraftName(event.target.value)
                    setAddError(false)
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') return
                    event.stopPropagation()
                    setAdding(false)
                    setDraftName('')
                    setAddError(false)
                  }}
                />
                <button type="submit" aria-label="创建总分类" title="创建总分类">
                  <Icon name="check" />
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="tag-filter-add"
                disabled={libraryId == null}
                onClick={() => {
                  setAdding(true)
                  setAddError(false)
                }}
              >
                <Icon name="plus" />
                新增总分类
              </button>
            )}
          </div>
        </aside>

        <div className="tag-filter-main">
          <div className="tag-filter-scroll">
            {visible.length > 0 ? (
              <div className="tag-filter-grid">
                {visible.map((item) => {
                  const selected = selectedSet.has(item.id)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`tag-filter-strip${selected ? ' on' : ''}`}
                      aria-pressed={selected}
                      draggable
                      title={`${item.label} · ${fmtCount(item.count)} · Shift 点击多选 · 右键或 Shift+F10 归类`}
                      aria-keyshortcuts="Shift+F10"
                      onClick={(event) => onPick(item.id, event.shiftKey)}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        openAssignMenu(item.id, event.clientX, event.clientY)
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
                        event.preventDefault()
                        event.stopPropagation()
                        const rect = event.currentTarget.getBoundingClientRect()
                        openAssignMenu(item.id, rect.left, rect.bottom + 4)
                      }}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData(TAG_DRAG_TYPE, item.id)
                        event.dataTransfer.setData('text/plain', item.id)
                        setDraggingTag(item.id)
                      }}
                      onDragEnd={() => {
                        setDraggingTag(null)
                        setDropTarget(null)
                      }}
                    >
                      <span
                        className="tag-filter-dot"
                        style={{ background: item.dotColor, boxShadow: `0 0 3px ${item.dotColor}` }}
                      />
                      <span className="tag-filter-name">{item.label}</span>
                      <span className="tag-filter-count">{fmtCount(item.count)}</span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="tag-filter-empty">{emptyText}</div>
            )}
          </div>
        </div>
      </div>

    </div>
  )

  const currentGroup = assignMenu ? groups.find((group) => group.tagNames.includes(assignMenu.tag))?.id ?? null : null
  const assignNode = assignMenu ? (
    <div
      ref={assignRef}
      className="menu glass-menu pick-menu tag-assign-menu"
      role="menu"
      aria-label={`归类标签 ${assignMenu.tag}`}
      style={{ position: 'fixed', left: assignMenu.x, top: assignMenu.y }}
    >
      <div className="menu-head">归入分类</div>
      <button
        type="button"
        role="menuitemradio"
        aria-checked={currentGroup === null}
        onClick={() => {
          assignTag(assignMenu.tag, null)
          setAssignMenu(null)
        }}
      >
        未分类
      </button>
      {groups.map((group) => (
        <button
          key={group.id}
          type="button"
          role="menuitemradio"
          aria-checked={currentGroup === group.id}
          onClick={() => {
            assignTag(assignMenu.tag, group.id)
            setAssignMenu(null)
          }}
        >
          {group.name}
        </button>
      ))}
      {groups.length === 0 ? <div className="menu-empty">暂无自定义分类</div> : null}
    </div>
  ) : null
  return createPortal(<>{node}{assignNode}</>, document.body)
}

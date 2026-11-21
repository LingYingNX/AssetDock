import { useEffect, useMemo, useRef, useState } from 'react'
import { formatBytes } from '../data/query'
import { useUI } from '../store/ui'
import { Icon } from './Icons'
import type { DedupCandidate, DedupGroup, DedupRule } from '../../../shared/types'

type Phase = 'idle' | 'scanning' | 'ready'

const RULE_KEY = 'dedup-rule'

const RULES: { key: DedupRule; label: string }[] = [
  { key: 'strict', label: '严格' },
  { key: 'balanced', label: '适中' },
  { key: 'loose', label: '宽松' }
]

function CandidateCard({
  candidate,
  libraryId,
  selected,
  recommended,
  onSelect
}: {
  candidate: DedupCandidate
  libraryId: number
  selected: boolean
  recommended: boolean
  onSelect: () => void
}): React.JSX.Element {
  const url = `media://${libraryId}/${encodeURIComponent(candidate.relPath)}?v=${candidate.fingerprint}`
  return (
    <button
      type="button"
      className={`dedup-card${selected ? ' on' : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="dedup-card-img">
        <img src={url} alt={candidate.name} loading="lazy" />
        {recommended ? <span className="dedup-card-badge"><Icon name="check" />推荐</span> : null}
        {selected ? <span className="dedup-card-check"><Icon name="check" /></span> : null}
      </span>
      <span className="dedup-card-meta">
        <span className="dedup-card-name" title={candidate.name}>{candidate.name}</span>
        <span className="dedup-card-dims">
          {candidate.width && candidate.height ? `${candidate.width}×${candidate.height}` : '尺寸未知'}
          {' · '}
          {formatBytes(candidate.sizeBytes)}
        </span>
      </span>
    </button>
  )
}

export function DedupDialog(): React.JSX.Element | null {
  const open = useUI((s) => s.openMenu === 'dedup')
  const setOpenMenu = useUI((s) => s.setOpenMenu)
  const tabs = useUI((s) => s.tabs)
  const activeTabId = useUI((s) => s.activeTabId)
  const nav = useUI((s) => s.nav)
  const reloadActiveLibrary = useUI((s) => s.reloadActiveLibrary)
  const showToast = useUI((s) => s.showToast)

  const libraryId = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId)?.libraryId ?? null,
    [tabs, activeTabId]
  )

  const dialogRef = useRef<HTMLElement>(null)
  const openFocus = useRef<HTMLElement | null>(null)
  const aliveRef = useRef(true)
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(false)
  const [rule, setRule] = useState<DedupRule>('balanced')
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [groups, setGroups] = useState<DedupGroup[]>([])
  const [keepers, setKeepers] = useState<number[]>([])
  const [scannedCount, setScannedCount] = useState(0)
  const [cleaning, setCleaning] = useState(false)

  useEffect(() => {
    if (open) setMounted(true)
  }, [open])

  useEffect(() => {
    if (open) return
    setShown(false)
    if (!mounted) return
    const timer = window.setTimeout(() => setMounted(false), 180)
    return () => window.clearTimeout(timer)
  }, [open, mounted])

  /* 与偏好面板同规则:下一帧才显形,退场走完再卸载 */
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [open])

  useEffect(() => {
    if (!mounted) {
      const target = openFocus.current
      openFocus.current = null
      if (target?.isConnected) target.focus()
      return
    }
    openFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const id = requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('.dedup-close')?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [mounted])

  /* Esc 走关闭路径并截断冒泡,别让全局 Esc 再叠一次 */
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      setOpenMenu(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, setOpenMenu])

  /* 模态面板自己收住 Tab */
  useEffect(() => {
    if (!open || !mounted) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const root = dialogRef.current
      if (!root) return
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      )).filter((el) => el.getClientRects().length > 0)
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (!root.contains(active)) {
        event.preventDefault()
        first.focus()
        return
      }
      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, mounted])

  useEffect(() => {
    if (!open) return
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [open])

  useEffect(() => {
    if (!open) return
    const off = window.windowApi.on('dedup:progress', (payload) => {
      if (phase === 'scanning') setProgress(payload)
    })
    return off
  }, [open, phase])

  /* 规则是长期偏好:上次选过的相似度下次打开还在 */
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void window.windowApi.state.get(RULE_KEY).then((raw) => {
      if (cancelled) return
      if (raw === 'strict' || raw === 'balanced' || raw === 'loose') setRule(raw)
    })
    return () => { cancelled = true }
  }, [open])

  const chooseRule = (next: DedupRule): void => {
    setRule(next)
    void window.windowApi.state.set(RULE_KEY, next).catch(() => {})
  }

  /* 左侧选中的文件夹即扫描范围;其他导航(view)下回落整库 */
  const folder = nav.startsWith('folder:') ? nav.slice('folder:'.length) : null

  const startScan = async (): Promise<void> => {
    if (libraryId == null) return
    setPhase('scanning')
    setProgress({ done: 0, total: 0 })
    const result = await window.windowApi.dedup.scan(libraryId, rule, folder)
    if (!aliveRef.current) return
    if ('error' in result) {
      setPhase('idle')
      showToast(result.error, 'warn')
      return
    }
    setGroups(result.groups)
    setKeepers(result.groups.map((group) => group.candidates[0].id))
    setScannedCount(result.scanned)
    setPhase('ready')
  }

  const selectKeeper = (groupIndex: number, candidateId: number): void => {
    setKeepers((prev) => {
      const next = [...prev]
      next[groupIndex] = candidateId
      return next
    })
  }

  const cleanup = async (): Promise<void> => {
    if (cleaning || libraryId == null) return
    const now = new Date().toISOString()
    const targets: number[] = []
    groups.forEach((group, index) => {
      const keeper = keepers[index]
      for (const candidate of group.candidates) {
        if (candidate.id !== keeper) targets.push(candidate.id)
      }
    })
    if (targets.length === 0) return
    if (!window.confirm(`将 ${targets.length} 个重复素材移入回收站？`)) return
    setCleaning(true)
    const results = await Promise.all(
      targets.map((id) =>
        window.windowApi.assets.update(libraryId, id, { deleted_at: now }).then((r) => r?.ok === true).catch(() => false)
      )
    )
    if (!aliveRef.current) return
    setCleaning(false)
    const failed = results.filter((ok) => !ok).length
    reloadActiveLibrary()
    if (failed === 0) {
      showToast(`已清理 ${targets.length} 个重复素材`)
      setGroups([])
      setKeepers([])
      setScannedCount(0)
      setPhase('idle')
      return
    }
    showToast(`有 ${failed} 个素材未能移入回收站，请重试`, 'warn')
  }

  const toDelete = groups.reduce((total, group, index) => total + group.candidates.filter((c) => c.id !== keepers[index]).length, 0)
  const scanning = phase === 'scanning'

  if (!mounted) return null

  return (
    <div className={`dedup-backdrop${shown ? ' show' : ''}`} role="presentation">
      <section ref={dialogRef} className={`dedup-dialog glass-preferences${shown ? ' show' : ''}`} role="dialog" aria-modal="true" aria-label="重复素材清理">
        <header className="dedup-header">
          <span className="dedup-title">重复素材清理</span>
          <button className="dedup-close" title="关闭" aria-label="关闭" onClick={() => setOpenMenu(null)}><Icon name="x" /></button>
        </header>
        <div className="dedup-toolbar">
          <div className="dedup-rule">
            <span className="dedup-rule-label">相似度</span>
            <div className="dedup-seg" role="radiogroup" aria-label="相似度">
              {RULES.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  role="radio"
                  aria-checked={rule === r.key}
                  className={`dedup-seg-item${rule === r.key ? ' on' : ''}`}
                  onClick={() => chooseRule(r.key)}
                >{r.label}</button>
              ))}
            </div>
          </div>
          <button className="dedup-scan" disabled={scanning || libraryId == null} onClick={() => void startScan()}>
            {scanning ? '扫描中…' : '扫描素材'}
          </button>
        </div>
        {scanning && progress.total > 0 ? (
          <div className="dedup-progress" aria-live="polite">
            <span className="dedup-progress-text">已扫描 {progress.done} / {progress.total}</span>
            <span className="dedup-progress-bar" style={{ width: `${progress.total ? Math.min(100, (progress.done / progress.total) * 100) : 0}%` }} />
          </div>
        ) : null}
        <div className="dedup-body">
          {phase === 'idle' ? (
            <div className="dedup-empty">
              <Icon name="scan" className="dedup-empty-icon" />
              <p>扫描素材，自动找出相似图片</p>
            </div>
          ) : phase === 'scanning' ? (
            <div className="dedup-empty">
              <Icon name="scan" className="dedup-empty-icon spin" />
              <p>正在比对图片…</p>
            </div>
          ) : groups.length === 0 ? (
            <div className="dedup-empty">
              <Icon name="check" className="dedup-empty-icon" />
              <p>已扫描 {scannedCount} 张，没有发现相似素材</p>
            </div>
          ) : (
            <div className="dedup-groups">
              {groups.map((group, index) => (
                <div className="dedup-group" key={group.candidates[0].id}>
                  <div className="dedup-group-cards">
                    {group.candidates.map((candidate, candidateIndex) => (
                      <CandidateCard
                        key={candidate.id}
                        candidate={candidate}
                        libraryId={libraryId as number}
                        selected={candidate.id === keepers[index]}
                        recommended={candidateIndex === 0}
                        onSelect={() => selectKeeper(index, candidate.id)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {phase === 'ready' ? (
          <footer className="dedup-footer">
            <span className="dedup-footer-count">保留 {groups.length} 组 · 待清理 {toDelete} 个</span>
            <button className="dedup-clean" disabled={cleaning || toDelete === 0} onClick={() => void cleanup()}>
              {cleaning ? '清理中…' : '清理重复'}
            </button>
          </footer>
        ) : null}
      </section>
    </div>
  )
}

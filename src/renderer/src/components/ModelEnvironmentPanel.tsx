import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { HDR_PRESETS, hdrPreset, type HdrId } from '../data/hdr-presets'
import { Icon } from './Icons'

interface Props {
  resetKey: string | null
  hdr: HdrId
  rotation: number
  strength: number
  opacity: number
  blur: number
  onHdr: (id: HdrId) => void
  onRotation: (value: number) => void
  onStrength: (value: number) => void
  onOpacity: (value: number) => void
  onBlur: (value: number) => void
}

interface SliderProps {
  icon: string
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  onChange: (value: number) => void
}

function EnvSlider({ icon, label, value, min, max, step, display, onChange }: SliderProps): React.JSX.Element {
  const fill = `${((value - min) / (max - min)) * 100}%`
  return (
    <label className="blender-env-row" style={{ '--env-fill': fill } as CSSProperties}>
      <span className="blender-env-row-icon"><Icon name={icon} /></span>
      <span className="blender-env-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output>{display}</output>
    </label>
  )
}

export function ModelEnvironmentPanel({
  resetKey,
  hdr,
  rotation,
  strength,
  opacity,
  blur,
  onHdr,
  onRotation,
  onStrength,
  onOpacity,
  onBlur
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setOpen(false)
  }, [resetKey])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  return (
    <div className="env-controls" ref={rootRef}>
      <div className="env-controls-collapsed">
        <button
          type="button"
          className="hdr-ball"
          style={{ backgroundImage: `url(${hdrPreset(hdr).thumbUrl})` }}
          title={`HDR 环境：${hdrPreset(hdr).label}`}
          aria-label={`HDR 环境：${hdrPreset(hdr).label}，点击打开环境面板`}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        />
        <button
          type="button"
          className="hdr-ball-arrow"
          title={open ? '收起环境面板' : '展开环境面板'}
          aria-label={open ? '收起环境面板' : '展开环境面板'}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name={open ? 'chev-u' : 'chev-d'} />
        </button>
      </div>

      {open && (
        <section className="blender-env-panel" role="dialog" aria-label="Blender 环境设置">
          <div className="blender-env-preview">
            <div
              className="blender-env-preview-ball"
              style={{ backgroundImage: `url(${hdrPreset(hdr).thumbUrl})` }}
              aria-hidden="true"
            />
          </div>
          <div className="blender-env-presets" aria-label="HDR 环境">
            {HDR_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`blender-env-preset${preset.id === hdr ? ' on' : ''}`}
                style={{ backgroundImage: `url(${preset.thumbUrl})` }}
                title={preset.label}
                aria-label={preset.label}
                aria-pressed={preset.id === hdr}
                onClick={() => onHdr(preset.id)}
              />
            ))}
          </div>
          <EnvSlider
            icon="rotate-3d"
            label="旋转"
            value={rotation}
            min={0}
            max={360}
            step={0.1}
            display={`${rotation.toFixed(1)}°`}
            onChange={onRotation}
          />
          <EnvSlider
            icon="spark"
            label="强度"
            value={strength}
            min={0}
            max={10}
            step={0.01}
            display={strength.toFixed(3)}
            onChange={onStrength}
          />
          <EnvSlider
            icon="monitor"
            label="世界不透明度"
            value={opacity}
            min={0}
            max={1}
            step={0.001}
            display={opacity.toFixed(3)}
            onChange={onOpacity}
          />
          <EnvSlider
            icon="zoom-fit"
            label="模糊"
            value={blur}
            min={0}
            max={1}
            step={0.01}
            display={blur.toFixed(2)}
            onChange={onBlur}
          />
        </section>
      )}
    </div>
  )
}

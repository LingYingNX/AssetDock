interface Cube3DProps {
  /** 立方体边长,如 "58px";灯箱舞台为 186px */
  cs?: string
  /** 定格 transform(如 rotateX(-24deg) rotateY(90deg));为空时匀速自转 */
  transform?: string
  className?: string
}

/** CSS 转台立方体:六面半透明蓝玻璃,18s 匀速自转 */
export function Cube3D({ cs, transform, className }: Cube3DProps): React.JSX.Element {
  const style: React.CSSProperties = {}
  if (cs) (style as Record<string, string>)['--cs'] = cs
  if (transform) {
    (style as Record<string, string>).transform = transform
  }
  return (
    <div className={`cube3d${transform ? ' static' : ''}${className ? ` ${className}` : ''}`} style={style}>
      <i /><i /><i /><i /><i /><i />
    </div>
  )
}

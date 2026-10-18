import type { EmptyKind } from '../data/empty-state'

function Art({ kind }: { kind: EmptyKind }): React.JSX.Element {
  if (kind === 'library') {
    return (
      <svg width="120" height="88" viewBox="0 0 120 88" aria-hidden="true">
        <defs>
          <linearGradient id="eg1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#DCEBFB" />
            <stop offset="1" stopColor="#9CC5F5" />
          </linearGradient>
        </defs>
        <rect x="18" y="30" width="84" height="46" rx="10" fill="url(#eg1)" stroke="rgba(255,255,255,.9)" />
        <rect x="30" y="18" width="34" height="14" rx="5" fill="#BBD9F8" stroke="rgba(255,255,255,.85)" />
        <circle cx="60" cy="50" r="12" fill="rgba(255,255,255,.55)" />
        <path d="M54 50h12M60 44v12" stroke="#5B8DD6" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'trash') {
    return (
      <svg width="120" height="88" viewBox="0 0 120 88" aria-hidden="true">
        <rect x="34" y="26" width="52" height="50" rx="10" fill="#E7F0FA" stroke="rgba(255,255,255,.9)" />
        <rect x="44" y="18" width="32" height="10" rx="5" fill="#BBD9F8" stroke="rgba(255,255,255,.85)" />
        <path d="M48 38v28M60 38v28M72 38v28" stroke="#9DB8D8" strokeWidth="3" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg width="120" height="88" viewBox="0 0 120 88" aria-hidden="true">
      <rect x="16" y="16" width="38" height="26" rx="7" fill="#DCEBFB" stroke="rgba(255,255,255,.85)" />
      <rect x="62" y="30" width="42" height="30" rx="7" fill="#D3E6FA" stroke="rgba(255,255,255,.85)" />
      <rect x="30" y="50" width="40" height="26" rx="7" fill="#CFE2FA" stroke="rgba(255,255,255,.85)" />
      <circle cx="88" cy="20" r="4" fill="#9CC5F5" />
      <circle cx="22" cy="80" r="3" fill="#B7D6F6" />
    </svg>
  )
}

export function EmptyState({
  kind,
  title,
  actionLabel,
  onAction
}: {
  kind: EmptyKind
  title: string
  actionLabel?: string
  onAction?: () => void
}): React.JSX.Element {
  return (
    <div className="empty">
      <Art kind={kind} />
      <span>{title}</span>
      {actionLabel && onAction ? (
        <button className="btn-clear" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}

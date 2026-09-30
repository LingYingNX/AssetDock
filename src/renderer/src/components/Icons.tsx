import type React from 'react'

interface IconProps {
  name: string
  className?: string
}

/** 通用线性图标(设计稿同源 symbol,1.7px 描边圆头) */
export function Icon({ name, className }: IconProps): React.JSX.Element {
  return <svg className={`ic${className ? ` ${className}` : ''}`}><use href={`#i-${name}`} /></svg>
}

/**
 * 全局 SVG defs:图标 symbol 库 + liquid-lens 折射滤镜,App 根部挂载一次。
 */
export function SvgDefs(): React.JSX.Element {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <symbol id="i-layers" viewBox="0 0 24 24"><path d="M12 3 3 8l9 5 9-5-9-5Z" /><path d="m3 13 9 5 9-5" /></symbol>
        <symbol id="i-chev-d" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></symbol>
        <symbol id="i-chev-r" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6" /></symbol>
        <symbol id="i-chev-l" viewBox="0 0 24 24"><path d="m15 6-6 6 6 6" /></symbol>
        <symbol id="i-arr-l" viewBox="0 0 24 24"><path d="M19 12H5" /><path d="m11 18-6-6 6-6" /></symbol>
        <symbol id="i-arr-r" viewBox="0 0 24 24"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></symbol>
        <symbol id="i-arr-d" viewBox="0 0 24 24"><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></symbol>
        <symbol id="i-arr-u" viewBox="0 0 24 24"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></symbol>
        <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></symbol>
        <symbol id="i-filter" viewBox="0 0 24 24"><path d="M4 6h9M17 6h3M20 12h-9M7 12H4M4 18h9M17 18h3" /><circle cx="15" cy="6" r="2" /><circle cx="5" cy="12" r="2" /><circle cx="15" cy="18" r="2" /></symbol>
        <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></symbol>
        <symbol id="i-folder" viewBox="0 0 24 24"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></symbol>
        <symbol id="i-folder-plus" viewBox="0 0 24 24"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /><path d="M12 10v6M9 13h6" /></symbol>
        <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></symbol>
        <symbol id="i-inbox" viewBox="0 0 24 24"><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></symbol>
        <symbol id="i-heart" viewBox="0 0 24 24"><path d="M19.5 12.6 12 20l-7.5-7.4A5 5 0 1 1 12 6.3a5 5 0 1 1 7.5 6.3Z" /></symbol>
        <symbol id="i-star" viewBox="0 0 24 24"><path d="m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.4L12 17.8 6.2 20.8l1.1-6.4L2.6 9.8l6.5-.9L12 3Z" /></symbol>
        <symbol id="i-trash" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /></symbol>
        <symbol id="i-spark" viewBox="0 0 24 24"><path d="m12 4 1.7 4.3L18 10l-4.3 1.7L12 16l-1.7-4.3L6 10l4.3-1.7L12 4Z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></symbol>
        <symbol id="i-tag" viewBox="0 0 24 24"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" /><circle cx="7.5" cy="7.5" r="1.3" /></symbol>
        <symbol id="i-scan" viewBox="0 0 24 24"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><circle cx="12" cy="12" r="3" /></symbol>
        <symbol id="i-copy" viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2h8c1.1 0 2 .9 2 2" /></symbol>
        <symbol id="i-image" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.5" /><path d="m21 15-5-5L5 21" /></symbol>
        <symbol id="i-film" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4M3 12h18" /></symbol>
        <symbol id="i-mosaic" viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="11" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="17" width="7" height="3" rx="1.5" /></symbol>
        <symbol id="i-waterfall" viewBox="0 0 24 24"><rect x="4" y="5" width="4.5" height="14" rx="1.5" /><rect x="9.75" y="8" width="4.5" height="11" rx="1.5" /><rect x="15.5" y="5" width="4.5" height="9" rx="1.5" /></symbol>
        <symbol id="i-grid" viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></symbol>
        <symbol id="i-list" viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" /><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" /></symbol>
        <symbol id="i-sort" viewBox="0 0 24 24"><path d="M7 20V5M3.5 8.5 7 5l3.5 3.5M17 4v15M13.5 15.5 17 19l3.5-3.5" /></symbol>
        <symbol id="i-more-h" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" /></symbol>
        <symbol id="i-download" viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></symbol>
        <symbol id="i-external" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H11" /></symbol>
        <symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><circle cx="12" cy="8" r=".5" fill="currentColor" /></symbol>
        <symbol id="i-check" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5" /></symbol>
        <symbol id="i-x" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></symbol>
        <symbol id="i-play" viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5L8 5.5Z" fill="currentColor" stroke="none" /></symbol>
        <symbol id="i-pause" viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" stroke="none" /></symbol>
        <symbol id="i-vol" viewBox="0 0 24 24"><path d="M4 10v4h3l4 3.5v-11L7 10H4Z" /><path d="M15.5 9.5a4 4 0 0 1 0 5M18 7a7.5 7.5 0 0 1 0 10" /></symbol>
        <symbol id="i-expand" viewBox="0 0 24 24"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" /></symbol>
        <symbol id="i-sync" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /></symbol>
        <symbol id="i-flag" viewBox="0 0 24 24"><path d="M5 21V4" /><path d="M5 4h12l-2.5 4L17 12H5" /></symbol>
        <symbol id="i-check-c" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></symbol>
        <symbol id="i-drive" viewBox="0 0 24 24"><rect x="2.5" y="12" width="19" height="7" rx="2" /><path d="M7.5 5.5h9a2 2 0 0 1 1.8 1.1L20.5 12" /><circle cx="6.5" cy="15.5" r="1" fill="currentColor" stroke="none" /></symbol>
        <symbol id="i-sliders" viewBox="0 0 24 24"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></symbol>
        <symbol id="i-gear" viewBox="0 0 24 24"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></symbol>
        <symbol id="i-help" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M9.6 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2-2.4 3.2" /><circle cx="12" cy="17" r=".5" fill="currentColor" /></symbol>
        <symbol id="i-minus" viewBox="0 0 24 24"><path d="M5 12h14" /></symbol>
        <symbol id="i-sq" viewBox="0 0 24 24"><rect x="6.5" y="6.5" width="11" height="11" rx="1.5" /></symbol>
        <symbol id="i-code" viewBox="0 0 24 24"><path d="m9 7-5 5 5 5" /><path d="m15 7 5 5-5 5" /></symbol>
        <symbol id="i-markup" viewBox="0 0 24 24"><path d="m8 6-5 6 5 6" /><path d="m16 6 5 6-5 6" /><path d="M13.5 4 10.5 20" /></symbol>
        <symbol id="i-save" viewBox="0 0 24 24"><path d="M5 4h11l3 3v13H5z" /><path d="M9 4v5h6V4" /><path d="M9 20v-6h6v6" /></symbol>
        <symbol id="i-edit" viewBox="0 0 24 24"><path d="m4 20 1-4L16.5 4.5a2.12 2.12 0 0 1 3 3L8 19l-4 1Z" /><path d="m14.5 6.5 3 3" /></symbol>
        <symbol id="i-zoom-fit" viewBox="0 0 24 24"><path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3" /><circle cx="12" cy="12" r="2.5" /></symbol>
        <symbol id="i-monitor" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M9 20h6M12 16v4" /></symbol>
        <symbol id="i-cube" viewBox="0 0 24 24"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></symbol>
        <symbol id="i-panel-r" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></symbol>
        <symbol id="i-rotate-3d" viewBox="0 0 24 24"><path d="M16.466 7.5C15.643 4.237 13.952 2 12 2 9.239 2 7 6.477 7 12s2.239 10 5 10c.342 0 .677-.069 1-.2" /><path d="m15.194 13.707 3.814 1.861 1.861-3.814" /><path d="M19 15.57c-1.464 2.642-3.567 4.43-5.898 4.43" /></symbol>
        <filter id="liquid-lens" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.009 0.014" numOctaves="2" seed="92" result="noise" />
          <feGaussianBlur in="noise" stdDeviation="2" result="soft" />
          <feDisplacementMap in="SourceGraphic" in2="soft" scale="60" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  )
}

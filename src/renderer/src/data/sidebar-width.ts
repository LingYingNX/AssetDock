export const SIDEBAR_DEFAULT = 236
export const SIDEBAR_MIN = 180
export const SIDEBAR_MAX = 380

export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_DEFAULT
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(value)))
}

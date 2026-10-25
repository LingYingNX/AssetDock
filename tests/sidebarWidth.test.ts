import { describe, expect, it } from 'vitest'
import {
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  clampSidebarWidth
} from '../src/renderer/src/data/sidebar-width'

describe('sidebar width', () => {
  it('keeps values inside the draggable range', () => {
    expect(clampSidebarWidth(120)).toBe(SIDEBAR_MIN)
    expect(clampSidebarWidth(280)).toBe(280)
    expect(clampSidebarWidth(900)).toBe(SIDEBAR_MAX)
  })

  it('falls back to the default for invalid persisted values', () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT)
  })
})

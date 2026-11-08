import { describe, expect, it } from 'vitest'
import { nextMenuIndex } from '../src/renderer/src/data/menu-focus'

describe('menu arrow navigation', () => {
  it('wraps in both directions', () => {
    expect(nextMenuIndex('ArrowDown', 2, 3)).toBe(0)
    expect(nextMenuIndex('ArrowUp', 0, 3)).toBe(2)
  })

  it('enters at the correct edge when nothing is focused', () => {
    expect(nextMenuIndex('ArrowDown', -1, 3)).toBe(0)
    expect(nextMenuIndex('ArrowUp', -1, 3)).toBe(2)
  })

  it('supports Home and End', () => {
    expect(nextMenuIndex('Home', 2, 3)).toBe(0)
    expect(nextMenuIndex('End', 0, 3)).toBe(2)
  })

  it('ignores other keys and empty menus', () => {
    expect(nextMenuIndex('Enter', 0, 3)).toBeNull()
    expect(nextMenuIndex('ArrowDown', 0, 0)).toBeNull()
  })
})

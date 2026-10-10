import { describe, expect, it } from 'vitest'
import { isPathWithinRoot } from '../src/main/services/libResolve'

describe('isPathWithinRoot', () => {
  it('accepts the root itself', () => {
    expect(isPathWithinRoot('C:/Lib', 'C:/Lib')).toBe(true)
  })

  it('accepts direct children and nested paths', () => {
    expect(isPathWithinRoot('C:/Lib', 'C:/Lib/a.png')).toBe(true)
    expect(isPathWithinRoot('C:/Lib', 'C:/Lib/sub/inner/b.png')).toBe(true)
  })

  it('rejects paths outside the root', () => {
    expect(isPathWithinRoot('C:/Lib', 'C:/Other/a.png')).toBe(false)
    expect(isPathWithinRoot('C:/Lib', 'C:/Lib/../evil.png')).toBe(false)
  })

  it('rejects sibling directories sharing a name prefix', () => {
    expect(isPathWithinRoot('C:/Lib', 'C:/Library/a.png')).toBe(false)
  })
})

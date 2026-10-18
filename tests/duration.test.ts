import { describe, expect, it } from 'vitest'
import { mmss } from '../src/renderer/src/store/ui'

describe('video duration formatting', () => {
  it('carries rounded seconds into the next minute', () => {
    expect(mmss(59.6)).toBe('01:00')
    expect(mmss(20.04)).toBe('00:20')
  })
})

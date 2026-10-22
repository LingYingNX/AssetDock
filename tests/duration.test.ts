import { describe, expect, it } from 'vitest'
import { mmss } from '../src/renderer/src/store/ui'
import { formatTime } from '../src/renderer/src/components/VideoControls'

describe('video duration formatting', () => {
  it('carries rounded seconds into the next minute', () => {
    expect(mmss(59.6)).toBe('01:00')
    expect(mmss(20.04)).toBe('00:20')
  })

  it('keeps two-digit minute and second fields in the player timecode', () => {
    expect(formatTime(4)).toBe('00:04')
    expect(formatTime(20)).toBe('00:20')
  })
})

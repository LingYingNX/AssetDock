import { describe, expect, it } from 'vitest'
import { isExternalFileDrag } from '../src/renderer/src/data/drop-files'

describe('external file drop guard', () => {
  it('accepts a real system file drag', () => {
    expect(isExternalFileDrag({ types: ['Files'] })).toBe(true)
  })

  it('leaves application asset and folder drags untouched', () => {
    expect(isExternalFileDrag({ types: ['application/x-mediahub-assets'] })).toBe(false)
    expect(isExternalFileDrag({ types: ['application/x-mediahub-folder'] })).toBe(false)
    expect(isExternalFileDrag(null)).toBe(false)
  })
})

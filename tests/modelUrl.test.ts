import { describe, expect, it } from 'vitest'
import { modelBaseUrl, objMaterialUrls } from '../src/renderer/src/data/model-url'

describe('model base URL', () => {
  it('resolves a sibling buffer from a media glTF URL', () => {
    const base = modelBaseUrl('media://7/models/scene.gltf?v=0123456789abcdef0123')
    expect(base).toBe('media://7/models/')
    expect(new URL('scene.bin', base).href).toBe('media://7/models/scene.bin')
  })

  it('falls back to an empty base for an invalid URL', () => {
    expect(modelBaseUrl('not a url')).toBe('')
  })
})

describe('OBJ material libraries', () => {
  it('resolves backslash paths relative to the model and deduplicates', () => {
    const base = modelBaseUrl('media://7/models/hero.obj?v=0123456789abcdef0123')
    const text = 'mtllib mats\\body.mtl\nmtllib extra.mtl\nmtllib mats/body.mtl'
    expect(objMaterialUrls(text, base)).toEqual([
      'media://7/models/mats/body.mtl',
      'media://7/models/extra.mtl'
    ])
  })
})

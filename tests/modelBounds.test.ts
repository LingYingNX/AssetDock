import {
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  Object3D,
  Vector3
} from 'three'
import { describe, expect, it } from 'vitest'
import { modelBounds } from '../src/renderer/src/data/model-bounds'

describe('modelBounds', () => {
  it('recomputes a stale geometry bounding box from current positions', () => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute([
      -1, -1, -1,
      1, 1, 1
    ], 3))
    geometry.boundingBox = new Box3(
      new Vector3(-100, -100, -100),
      new Vector3(100, 100, 100)
    )
    const model = new Object3D()
    model.add(new Mesh(geometry))

    const box = modelBounds(model)

    expect(box.min.toArray()).toEqual([-1, -1, -1])
    expect(box.max.toArray()).toEqual([1, 1, 1])
  })

  it('ignores absolute morph targets when fitting the rest pose', () => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute([
      -1, -1, -1,
      1, 1, 1
    ], 3))
    geometry.morphAttributes.position = [
      new Float32BufferAttribute([
        0, 0, 0,
        100, 100, 100
      ], 3)
    ]
    const model = new Object3D()
    model.add(new Mesh(geometry))

    const box = modelBounds(model)

    expect(box.min.toArray()).toEqual([-1, -1, -1])
    expect(box.max.toArray()).toEqual([1, 1, 1])
  })

  it('supports interleaved position attributes', () => {
    const geometry = new BufferGeometry()
    const data = new InterleavedBuffer(new Float32Array([
      -2, -3, -4,
      2, 3, 4
    ]), 3)
    geometry.setAttribute('position', new InterleavedBufferAttribute(data, 3, 0))
    const model = new Object3D()
    model.add(new Mesh(geometry))

    const box = modelBounds(model)

    expect(box.min.toArray()).toEqual([-2, -3, -4])
    expect(box.max.toArray()).toEqual([2, 3, 4])
  })
})

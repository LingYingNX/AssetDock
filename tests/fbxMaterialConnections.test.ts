import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  readFbxMaterialData,
  readFbxMaterialTextureIds,
  resolveFbxMaterialTextures
} from '../src/renderer/src/data/fbx-material-connections'

function stringProp(value: string): Buffer {
  const text = Buffer.from(value, 'utf8')
  const out = Buffer.alloc(5 + text.length)
  out[0] = 0x53
  out.writeUInt32LE(text.length, 1)
  text.copy(out, 5)
  return out
}

function int64Prop(value: number): Buffer {
  const out = Buffer.alloc(9)
  out[0] = 0x4c
  out.writeBigInt64LE(BigInt(value), 1)
  return out
}

function doubleProp(value: number): Buffer {
  const out = Buffer.alloc(9)
  out[0] = 0x44
  out.writeDoubleLE(value, 1)
  return out
}

function buildNode(
  at: number,
  name: string,
  properties: Buffer[],
  children: ((offset: number) => Buffer)[] = []
): Buffer {
  const nameBytes = Buffer.from(name, 'ascii')
  const propertyBytes = Buffer.concat(properties)
  const headerSize = 13 + nameBytes.length + propertyBytes.length
  const childAt = at + headerSize
  const builtChildren: Buffer[] = []
  let cursor = childAt
  for (const build of children) {
    const child = build(cursor)
    builtChildren.push(child)
    cursor += child.length
  }
  const childBytes = Buffer.concat(builtChildren)
  const end = childAt + childBytes.length + 13
  const out = Buffer.alloc(end - at)
  out.writeUInt32LE(end, 0)
  out.writeUInt32LE(properties.length, 4)
  out.writeUInt32LE(propertyBytes.length, 8)
  out[12] = nameBytes.length
  nameBytes.copy(out, 13)
  propertyBytes.copy(out, 13 + nameBytes.length)
  childBytes.copy(out, headerSize)
  return out
}

function buildFbx(): ArrayBuffer {
  const header = Buffer.alloc(27)
  Buffer.from('Kaydara FBX Binary  ', 'ascii').copy(header, 0)
  header[20] = 0
  header[21] = 0x1a
  header[22] = 0
  header.writeUInt32LE(7400, 23)

  const materialId = 100
  const baseId = 201
  const alphaId = 202
  const metalId = 203
  const roughId = 204
  const objects = (at: number): Buffer => buildNode(at, 'Objects', [], [
    (offset) => buildNode(offset, 'Material', [
      int64Prop(materialId),
      stringProp('Clothes'),
      stringProp('Material')
    ], [
      (propertiesOffset) => buildNode(propertiesOffset, 'Properties70', [], [
        (propertyOffset) => buildNode(propertyOffset, 'P', [
          stringProp('ReflectionFactor'),
          stringProp('Number'),
          stringProp(''),
          stringProp('A'),
          doubleProp(0.35)
        ]),
        (propertyOffset) => buildNode(propertyOffset, 'P', [
          stringProp('ShininessExponent'),
          stringProp('Number'),
          stringProp(''),
          stringProp('A'),
          doubleProp(36)
        ])
      ])
    ]),
    (offset) => buildNode(offset, 'Texture', [int64Prop(baseId), stringProp('base_texture')]),
    (offset) => buildNode(offset, 'Texture', [int64Prop(alphaId), stringProp('alpha_texture')]),
    (offset) => buildNode(offset, 'Texture', [int64Prop(metalId), stringProp('metal_texture')]),
    (offset) => buildNode(offset, 'Texture', [int64Prop(roughId), stringProp('rough_texture')])
  ])
  const connections = (at: number): Buffer => buildNode(at, 'Connections', [], [
    (offset) => buildNode(offset, 'C', [
      stringProp('OP'), int64Prop(baseId), int64Prop(materialId), stringProp('DiffuseColor')
    ]),
    (offset) => buildNode(offset, 'C', [
      stringProp('OP'), int64Prop(alphaId), int64Prop(materialId), stringProp('TransparencyFactor')
    ]),
    (offset) => buildNode(offset, 'C', [
      stringProp('OP'), int64Prop(metalId), int64Prop(materialId), stringProp('ReflectionFactor')
    ]),
    (offset) => buildNode(offset, 'C', [
      stringProp('OP'), int64Prop(roughId), int64Prop(materialId), stringProp('ShininessExponent')
    ])
  ])

  const objectsBytes = objects(27)
  const connectionsBytes = connections(27 + objectsBytes.length)
  const file = Buffer.concat([header, objectsBytes, connectionsBytes])
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
}

describe('fbx material connections', () => {
  it('reads explicit OP texture bindings by material name', () => {
    const connections = readFbxMaterialTextureIds(buildFbx())
    expect(connections.get('Clothes')).toEqual({
      DiffuseColor: 201,
      TransparencyFactor: 202,
      ReflectionFactor: 203,
      ShininessExponent: 204
    })
  })

  it('reads explicit FBX scalar material values', () => {
    const data = readFbxMaterialData(buildFbx()).get('Clothes')
    expect(data?.scalars).toEqual({
      reflectionFactor: 0.35,
      shininessExponent: 36
    })
  })

  it('resolves only textures that were actually loaded', () => {
    const metal = new THREE.Texture()
    const resolved = resolveFbxMaterialTextures(
      { ReflectionFactor: 203, ShininessExponent: 204 },
      new Map([[203, metal]])
    )
    expect(resolved?.ReflectionFactor).toBe(metal)
    expect(resolved?.ShininessExponent).toBeUndefined()
  })

  it('returns an empty map for a non-binary FBX buffer', () => {
    expect(readFbxMaterialTextureIds(new ArrayBuffer(8)).size).toBe(0)
  })
})

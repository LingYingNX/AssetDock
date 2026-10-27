import type * as THREE from 'three'

export type FbxTextureProperty =
  | 'DiffuseColor'
  | 'NormalMap'
  | 'EmissiveColor'
  | 'TransparencyFactor'
  | 'TransparentColor'
  | 'ReflectionFactor'
  | 'ReflectionColor'
  | 'ShininessExponent'

export type FbxMaterialTextureIds = Partial<Record<FbxTextureProperty, number>>
export type FbxMaterialTextures = Partial<Record<FbxTextureProperty, THREE.Texture>>
export interface FbxMaterialScalars {
  reflectionFactor?: number
  shininessExponent?: number
}
export interface FbxMaterialData {
  textures: FbxMaterialTextureIds
  scalars: FbxMaterialScalars
}

const TEXTURE_PROPERTIES = new Set<FbxTextureProperty>([
  'DiffuseColor',
  'NormalMap',
  'EmissiveColor',
  'TransparencyFactor',
  'TransparentColor',
  'ReflectionFactor',
  'ReflectionColor',
  'ShininessExponent'
])

const BINARY_MAGIC = 'Kaydara FBX Binary  '
const BINARY_HEADER_SIZE = 23

interface FbxNode {
  name: string
  end: number
  propertyCount: number
  propertiesStart: number
  propertiesEnd: number
}

function isBinaryFbx(bytes: Uint8Array): boolean {
  if (bytes.length < BINARY_HEADER_SIZE + 4) return false
  return new TextDecoder().decode(bytes.subarray(0, BINARY_MAGIC.length)) === BINARY_MAGIC
}

function readUint64(view: DataView, offset: number): number {
  return Number(view.getBigUint64(offset, true))
}

function readNode(bytes: Uint8Array, view: DataView, offset: number, version: number): FbxNode | null {
  const wide = version >= 7500
  const headerSize = wide ? 25 : 13
  if (offset + headerSize > bytes.length) return null

  const end = wide ? readUint64(view, offset) : view.getUint32(offset, true)
  if (end === 0) return null
  const propertyCount = wide ? readUint64(view, offset + 8) : view.getUint32(offset + 4, true)
  const propertyLength = wide ? readUint64(view, offset + 16) : view.getUint32(offset + 8, true)
  const nameLength = bytes[offset + (wide ? 24 : 12)]
  const nameStart = offset + (wide ? 25 : 13)
  const propertiesStart = nameStart + nameLength
  const propertiesEnd = propertiesStart + propertyLength
  if (propertiesEnd > bytes.length || end < propertiesEnd || end > bytes.length) return null

  return {
    name: new TextDecoder().decode(bytes.subarray(nameStart, propertiesStart)),
    end,
    propertyCount,
    propertiesStart,
    propertiesEnd
  }
}

function readChildren(
  bytes: Uint8Array,
  view: DataView,
  parent: FbxNode,
  version: number
): FbxNode[] {
  const children: FbxNode[] = []
  let offset = parent.propertiesEnd
  while (offset < parent.end) {
    const child = readNode(bytes, view, offset, version)
    if (!child) break
    children.push(child)
    offset = child.end
  }
  return children
}

interface PropertyValue {
  value: number | string
  end: number
}

function readProperty(bytes: Uint8Array, view: DataView, offset: number): PropertyValue | null {
  if (offset + 1 > bytes.length) return null
  const type = String.fromCharCode(bytes[offset])
  const start = offset + 1
  switch (type) {
    case 'C':
      return { value: bytes[start], end: start + 1 }
    case 'I':
      return { value: view.getInt32(start, true), end: start + 4 }
    case 'L':
      return { value: Number(view.getBigInt64(start, true)), end: start + 8 }
    case 'F':
      return { value: view.getFloat32(start, true), end: start + 4 }
    case 'D':
      return { value: view.getFloat64(start, true), end: start + 8 }
    case 'S':
    case 'R': {
      const length = view.getUint32(start, true)
      const valueStart = start + 4
      return {
        value: type === 'S' ? new TextDecoder().decode(bytes.subarray(valueStart, valueStart + length)) : '',
        end: valueStart + length
      }
    }
    default:
      return null
  }
}

function readProperties(bytes: Uint8Array, view: DataView, node: FbxNode): PropertyValue[] | null {
  const values: PropertyValue[] = []
  let offset = node.propertiesStart
  for (let index = 0; index < node.propertyCount; index += 1) {
    const property = readProperty(bytes, view, offset)
    if (!property || property.end > node.propertiesEnd) return null
    values.push(property)
    offset = property.end
  }
  return values
}

function cleanFbxName(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\0.*$/, '').trim() : ''
}

/**
 * Three 的 FBXLoader 不处理 ReflectionFactor / ShininessExponent 的贴图连接。
 * 这里只读 FBX 的节点骨架与 OP 连接，几何和动画仍交给 FBXLoader。
 */
export function readFbxMaterialData(buffer: ArrayBuffer): Map<string, FbxMaterialData> {
  const bytes = new Uint8Array(buffer)
  if (!isBinaryFbx(bytes)) return new Map()

  const view = new DataView(buffer)
  const version = view.getUint32(BINARY_HEADER_SIZE, true)
  const roots: FbxNode[] = []
  let offset = BINARY_HEADER_SIZE + 4
  while (offset < bytes.length) {
    const node = readNode(bytes, view, offset, version)
    if (!node) break
    roots.push(node)
    offset = node.end
  }

  const objects = roots.find((node) => node.name === 'Objects')
  const connections = roots.find((node) => node.name === 'Connections')
  if (!objects || !connections) return new Map()

  const materialNames = new Map<number, string>()
  const materialNodes = new Map<number, FbxNode>()
  const textureIds = new Set<number>()
  for (const node of readChildren(bytes, view, objects, version)) {
    if (node.name !== 'Material' && node.name !== 'Texture') continue
    const properties = readProperties(bytes, view, node)
    if (!properties || properties.length < 2) continue
    const id = properties[0]?.value
    if (typeof id !== 'number') continue
    const name = cleanFbxName(properties[1]?.value)
    if (node.name === 'Texture') textureIds.add(id)
    else if (name) {
      materialNames.set(id, name)
      materialNodes.set(id, node)
    }
  }

  const result = new Map<string, FbxMaterialData>()
  for (const [id, name] of materialNames) {
    const node = materialNodes.get(id)
    const properties = node ? readChildren(bytes, view, node, version) : []
    const properties70 = properties.find((child) => child.name === 'Properties70')
    const scalars: FbxMaterialScalars = {}
    if (properties70) {
      for (const propertyNode of readChildren(bytes, view, properties70, version)) {
        if (propertyNode.name !== 'P') continue
        const values = readProperties(bytes, view, propertyNode)
        const propertyName = values?.[0]?.value
        const propertyValue = values?.[4]?.value
        if (typeof propertyValue !== 'number') continue
        if (propertyName === 'ReflectionFactor') scalars.reflectionFactor = propertyValue
        if (propertyName === 'ShininessExponent') scalars.shininessExponent = propertyValue
      }
    }
    result.set(name, { textures: {}, scalars })
  }

  for (const node of readChildren(bytes, view, connections, version)) {
    if (node.name !== 'C') continue
    const properties = readProperties(bytes, view, node)
    if (!properties || properties.length < 4) continue
    const [kind, childId, parentId, propertyName] = properties.map((property) => property.value)
    if (kind !== 'OP' || typeof childId !== 'number' || typeof parentId !== 'number') continue
    const materialName = materialNames.get(parentId)
    const property = typeof propertyName === 'string' ? propertyName : ''
    if (!materialName || !textureIds.has(childId) || !TEXTURE_PROPERTIES.has(property as FbxTextureProperty)) {
      continue
    }
    const data = result.get(materialName)
    if (!data) continue
    if (data.textures[property as FbxTextureProperty] === undefined) {
      data.textures[property as FbxTextureProperty] = childId
    }
  }
  return result
}

export function readFbxMaterialTextureIds(buffer: ArrayBuffer): Map<string, FbxMaterialTextureIds> {
  const result = new Map<string, FbxMaterialTextureIds>()
  for (const [name, data] of readFbxMaterialData(buffer)) {
    if (Object.keys(data.textures).length > 0) result.set(name, data.textures)
  }
  return result
}

export function resolveFbxMaterialTextures(
  connections: FbxMaterialTextureIds | undefined,
  textures: Map<number, THREE.Texture>
): FbxMaterialTextures | undefined {
  if (!connections) return undefined
  const result: FbxMaterialTextures = {}
  let found = false
  for (const property of TEXTURE_PROPERTIES) {
    const id = connections[property]
    const texture = id === undefined ? undefined : textures.get(id)
    if (!texture) continue
    result[property] = texture
    found = true
  }
  return found ? result : undefined
}

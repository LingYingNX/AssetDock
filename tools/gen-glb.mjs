// 生成最小有效 GLB(蓝色立方体):手工写 JSON+BIN chunk,不依赖 DOM
import { writeFileSync } from 'node:fs'

const positions = new Float32Array([
  // 6 面 × 4 顶点,单位立方体
  -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1, // 前 z+
  -1, -1, -1, -1, 1, -1, 1, 1, -1, 1, -1, -1, // 后 z-
  -1, 1, -1, -1, 1, 1, 1, 1, 1, 1, 1, -1, // 顶 y+
  -1, -1, -1, 1, -1, -1, 1, -1, 1, -1, -1, 1, // 底 y-
  1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, // 右 x+
  -1, -1, -1, -1, -1, 1, -1, 1, 1, -1, 1, -1 // 左 x-
])
const normals = new Float32Array(positions.length)
for (let f = 0; f < 6; f++) {
  const n = [[0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0]][f]
  for (let v = 0; v < 4; v++) {
    const i = (f * 4 + v) * 3
    normals[i] = n[0]; normals[i + 1] = n[1]; normals[i + 2] = n[2]
  }
}
const indices = new Uint16Array(36)
for (let f = 0; f < 6; f++) {
  const b = f * 4
  const o = f * 6
  indices[o] = b; indices[o + 1] = b + 1; indices[o + 2] = b + 2
  indices[o + 3] = b; indices[o + 4] = b + 2; indices[o + 5] = b + 3
}

const posBin = Buffer.from(positions.buffer)
const norBin = Buffer.from(normals.buffer)
const idxBin = Buffer.from(indices.buffer)
const pad4 = (b) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]) : b)
const bin = Buffer.concat([posBin, norBin, idxBin])

const json = {
  asset: { version: '2.0', generator: 'MediaHub test fixture' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: '演示立方体' }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
  materials: [
    {
      name: '蓝色玻璃',
      pbrMetallicRoughness: { baseColorFactor: [0.18, 0.49, 0.96, 1], metallicFactor: 0.4, roughnessFactor: 0.3 }
    }
  ],
  buffers: [{ byteLength: bin.length }],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: posBin.length, target: 34962 },
    { buffer: 0, byteOffset: posBin.length, byteLength: norBin.length, target: 34962 },
    { buffer: 0, byteOffset: posBin.length + norBin.length, byteLength: idxBin.length, target: 34963 }
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 24, type: 'VEC3', min: [-1, -1, -1], max: [1, 1, 1] },
    { bufferView: 1, componentType: 5126, count: 24, type: 'VEC3' },
    { bufferView: 2, componentType: 5123, count: 36, type: 'SCALAR' }
  ]
}

const padJson = (b) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), 0x20)]) : b)
const jsonBuf = padJson(Buffer.from(JSON.stringify(json), 'utf8'))
const binChunk = pad4(bin)
const total = 12 + 8 + jsonBuf.length + 8 + binChunk.length
const header = Buffer.alloc(12)
header.writeUInt32LE(0x46546c67, 0) // glTF
header.writeUInt32LE(2, 4)
header.writeUInt32LE(total, 8)
const jsonHead = Buffer.alloc(8)
jsonHead.writeUInt32LE(jsonBuf.length, 0)
jsonHead.writeUInt32LE(0x4e4f534a, 4) // JSON
const binHead = Buffer.alloc(8)
binHead.writeUInt32LE(binChunk.length, 0)
binHead.writeUInt32LE(0x004e4942, 4) // BIN

writeFileSync('E:/zcode项目/素材管理器/素材/演示立方体.glb', Buffer.concat([header, jsonHead, jsonBuf, binHead, binChunk]))
console.log('GLB_WRITTEN ' + total + 'B')

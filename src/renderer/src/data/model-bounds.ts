import * as THREE from 'three'

/** 骨骼不完整时 SkinnedMesh.computeBoundingBox 会抛错，取景改用几何本体的包围盒。 */
export function modelBounds(model: THREE.Object3D): THREE.Box3 {
  model.updateMatrixWorld(true)
  const box = new THREE.Box3()
  const part = new THREE.Box3()
  const point = new THREE.Vector3()
  model.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    const position = mesh.geometry.getAttribute('position')
    if (!position) return
    // PMX 的绝对 morph target 会把 geometry.boundingBox 撑大；封面对齐 rest pose。
    if (position instanceof THREE.BufferAttribute) {
      part.setFromBufferAttribute(position)
    } else {
      part.makeEmpty()
      for (let i = 0; i < position.count; i++) {
        part.expandByPoint(point.fromBufferAttribute(position, i))
      }
    }
    part.applyMatrix4(mesh.matrixWorld)
    box.union(part)
  })
  return box.isEmpty() ? new THREE.Box3().setFromObject(model) : box
}

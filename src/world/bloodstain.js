// 地面像素血迹，无实体尸体。每块贴片独立贴合台阶顶面，不穿透地形。
import * as THREE from 'three';
export function makeBloodstain({ own = false, seed = '' } = {}) {
  const group = new THREE.Group();
  group.name = 'death-bloodstain';
  const material = new THREE.MeshBasicMaterial({ color: own ? 0xa52f32 : 0x782b30, transparent: true, opacity: 0.88,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
  let hash = 0; for (const c of String(seed)) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) >>> 0;
  const patches = [[0, 0, .66, .72], [.42, .08, .38, .48], [-.4, -.2, .32, .42], [.04, -.52, .28, .36], [.65, -.4, .15, .18], [-.6, .42, .18, .22]];
  for (const [x, z, w, d] of patches) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(hash % 2 ? -x : x, .035, z);
    group.add(mesh);
  }
  return group;
}
export function placeBloodstain(group, record, height) {
  group.position.set(record.x, 0, record.z);
  for (const patch of group.children) patch.position.y = height(record.x + patch.position.x, record.z + patch.position.z) + .035;
}
export function disposeBloodstain(group) {
  const materials = new Set();
  group.traverse(o => { o.geometry?.dispose(); if (o.material) materials.add(o.material); });
  for (const material of materials) material.dispose();
  group.removeFromParent();
}

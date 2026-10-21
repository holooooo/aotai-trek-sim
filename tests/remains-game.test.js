import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Game } from '../src/sim/game.js';
import { makeBloodstain, placeBloodstain, disposeBloodstain } from '../src/world/bloodstain.js';
import { RemainsClient } from '../src/sim/remains.js';

const sample = { id: 'death_example_1', world: 'aotai-winter-v1', path: 'main', x: 0, z: 0, role: 'student', difficulty: 'normal', cause: 'fall', gameMinute: 600, core: 36.5, health: 0, food: 60, water: 40, stress: 80, altitude: 3200, createdAt: 1000 };
function fixture() {
  const client = new RemainsClient({ storage: null, fetcher: null });
  client.local = [{ record: sample, pending: false }];
  const scene = new THREE.Scene();
  const g = Object.create(Game.prototype);
  Object.assign(g, { st: { path: 'main', body: { core: 37, stress: 25 }, camp: null }, pos: new THREE.Vector3(1, 5, 1),
    world: { scene, height: () => 5 }, ui: { modalOpen: false, setRemainsPrompt(r) { this.prompt = r; }, async dialog(options) { this.options = options; } }, remains: client });
  return g;
}

test('only nearby bloodstains are instantiated and leaving range disposes geometry and material', () => {
  const g = fixture();
  g.updateRemains(1);
  assert.equal(g.remainsRt.size, 1); assert.equal(g.world.scene.children.length, 1);
  const rt = [...g.remainsRt.values()][0];
  let disposedGeometry = 0, disposedMaterial = 0;
  rt.mesh.children.forEach(p => p.geometry.addEventListener('dispose', () => disposedGeometry++));
  rt.mesh.children[0].material.addEventListener('dispose', () => disposedMaterial++);
  g.pos.x = 100; g.updateRemains(1);
  assert.equal(g.remainsRt.size, 0); assert.equal(g.world.scene.children.length, 0);
  assert.equal(disposedGeometry, 6); assert.equal(disposedMaterial, 1);
  assert.equal(g.ui.prompt, null);
});

test('inspect requires physical proximity and same height, and does not mutate body, time or inventory', async () => {
  const g = fixture();
  g.st.time = 1234; g.st.inv = { chocolate: 2 }; g.autoWalk = true;
  const before = structuredClone(g.st);
  g.updateRemains(1);
  await g.inspectRemains();
  assert.equal(g.autoWalk, false);
  assert.match(g.ui.options.text.join(''), /死因：滑坠/);
  assert.match(g.ui.options.text.join(''), /最终体温 36.5℃/);
  assert.deepEqual(g.st, before);
  g.ui.options = null; g.pos.y = 15;
  await g.inspectRemains();
  assert.equal(g.ui.options, null);
  g.pos.y = 5; g.pos.x = 10;
  await g.inspectRemains();
  assert.equal(g.ui.options, null);
});

test('disabling removes visible meshes and restoring the setting reloads own nearby markers', () => {
  const g = fixture(); g.updateRemains(1);
  g.remains.setEnabled(false); g.updateRemains(1);
  assert.equal(g.remainsRt.size, 0);
  assert.equal(g.world.scene.children.length, 0);
  g.remains.setEnabled(true); g.updateRemains(1);
  assert.equal(g.remainsRt.size, 1);
  g.clearRemains();
  assert.equal(g.remainsRt.size, 0); assert.equal(g.world.scene.children.length, 0);
});

test('bloodstain patches follow actual terrain height and share just one material per marker', () => {
  const mesh = makeBloodstain({ own: true, seed: 'test' });
  placeBloodstain(mesh, { x: 10, z: -12 }, (x, z) => Math.floor(x) + Math.floor(z));
  for (const p of mesh.children) assert.equal(p.position.y, Math.floor(mesh.position.x + p.position.x) + Math.floor(mesh.position.z + p.position.z) + .035);
  assert.equal(new Set(mesh.children.map(p => p.material)).size, 1);
  disposeBloodstain(mesh);
});

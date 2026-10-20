import test from 'node:test';
import assert from 'node:assert/strict';
import { BRANCHES, WAYPOINTS } from '../src/data/route.js';
import { branches } from '../src/world/terrain.js';
import { clearMapTerrainCache, routeMapSVG } from '../src/ui/map-renderer.js';

function assertWellFormedSvg(svg) {
  assert.match(svg, /^<svg\b[\s\S]*<\/svg>$/);
  const stack = [];
  for (const match of svg.matchAll(/<\/?([a-zA-Z][\w:-]*)\b[^>]*>/g)) {
    const token = match[0];
    const name = match[1];
    if (token.startsWith('</')) {
      assert.equal(stack.pop(), name, `unexpected closing ${name}`);
    } else if (!token.endsWith('/>')) {
      stack.push(name);
    }
  }
  assert.deepEqual(stack, []);
}

test('route map output is deterministic and contains valid, escaped SVG text', () => {
  clearMapTerrainCache();
  const original = WAYPOINTS[0].name;
  WAYPOINTS[0].name = `入口 <& "坡>`;
  try {
    const state = { path: 'main', s: 0, maxS: 0, dir: 1, visited: {} };
    const first = routeMapSVG(state);
    const second = routeMapSVG(state);
    assert.equal(first, second);
    assertWellFormedSvg(first);
    assert.match(first, /入口 &lt;&amp; &quot;坡&gt;/);
    assert.match(first, /游戏地形示意，非真实卫星影像\/不可导航/);
    assert.doesNotMatch(first, /NaN|undefined/);
  } finally {
    WAYPOINTS[0].name = original;
    clearMapTerrainCache();
  }
});

test('satellite and elevation modes have distinct terrain and explicit legends', () => {
  const state = { path: 'main', s: 900, maxS: 800, dir: 1, pos: { x: 10, z: 20 }, visited: {} };
  const satellite = routeMapSVG(state, { mode: 'satellite', scope: 'nearby' });
  const elevation = routeMapSVG(state, { mode: 'elevation', scope: 'nearby' });
  assert.notEqual(satellite, elevation);
  assert.match(satellite, /aria-label="鳌太线卫星式示意地图"/);
  assert.match(satellite, /森林|草甸|石海/);
  assert.match(elevation, /aria-label="鳌太线高程示意地图"/);
  assert.match(elevation, /等高线/);
  assertWellFormedSvg(satellite);
  assertWellFormedSvg(elevation);
});

test('nearby view preserves the active branch and player direction marker', () => {
  const [branchId] = Object.keys(BRANCHES);
  const branch = branches[branchId];
  const s = Math.min(25, branch.length / 3);
  const p = branch.pointAt(s);
  const svg = routeMapSVG({
    path: branchId,
    s,
    maxS: branch.fromS,
    dir: -1,
    pos: { x: p.x, z: p.z },
    visited: { c2800: 1 },
  }, { scope: 'nearby' });
  assert.match(svg, new RegExp(`data-route-id="${branchId}"`));
  assert.match(svg, new RegExp(`data-route-id="${branchId}-walked"`));
  assert.match(svg, /data-player-marker="true"/);
  assert.match(svg, /data-branch-end=/);
  assertWellFormedSvg(svg);
});

test('all-scope renders every configured branch without browser globals', () => {
  const previousDocument = globalThis.document;
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: new Proxy({}, { get() { throw new Error('renderer must not access document'); } }),
  });
  try {
    const svg = routeMapSVG({ path: 'main', s: 300, maxS: 300, dir: 1, visited: {} }, { scope: 'all' });
    for (const id of Object.keys(BRANCHES)) assert.match(svg, new RegExp(`data-route-id="${id}"`));
    assert.match(svg, /全线概览/);
    assertWellFormedSvg(svg);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: previousDocument });
  }
});

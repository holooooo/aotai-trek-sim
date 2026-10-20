// 只在事件镜头中存在的体素道具；没有导航或碰撞效果。
import * as THREE from 'three';
import { VoxBuilder, voxMaterial } from './models.js';

export function makeEventProp(id) {
  const b = new VoxBuilder();
  if (id === 'takin') {
    const fur = 0xb6a47c, dark = 0x584b39;
    b.box(-.85, .65, -.42, 1.7, .9, .84, fur);
    b.box(.57, 1.12, -.34, .58, .65, .68, fur);
    b.box(.94, 1.12, -.25, .3, .28, .5, dark);
    for (const x of [-.63, .54]) for (const z of [-.31, .18]) b.box(x, 0, z, .23, .82, .23, dark);
    b.box(.65, 1.69, -.43, .13, .35, .13, dark);
    b.box(.65, 1.69, .30, .13, .35, .13, dark);
    b.box(-1, .95, -.08, .3, .1, .16, dark);
    b.box(.97, 1.56, -.345, .05, .07, .05, 0x171b1b);
    b.box(.97, 1.56, .295, .05, .07, .05, 0x171b1b);
  } else if (id === 'loose_marker') {
    b.box(-.07, 0, -.05, .12, 1.6, .1, 0x625347);
    b.box(0, 1.06, -.06, .82, .2, .12, 0xa3372d);
    b.box(.56, .8, -.06, .14, .4, .12, 0xa3372d);
  } else if (id === 'false_trail') {
    for (let i = 0; i < 7; i++) for (const direction of [-1, 1]) {
      const z = i * .35, x = direction * i * .27 + (i % 2 ? .1 : -.1);
      b.box(x, .03, z, .15, .04, .28, 0x8c9da5);
    }
  } else return null;
  return new THREE.Mesh(b.build(), voxMaterial);
}

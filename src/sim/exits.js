// 只用于游戏判定，不代表真实山地出口或可行路线。
import { mainPath, branches } from '../world/terrain.js';
import { voxToAlt } from '../data/route.js';

export function canFreeDescent(st) {
  return Object.values(branches).some(b => st.maxS >= b.fromS || st.path === b.id) || !!st.visited?.c2800;
}

export function villagePosition(pos) {
  const p = mainPath.pointAt(0), x = pos.x - p.x, z = pos.z - p.z;
  return { along: x * p.dx + z * p.dz, side: -x * p.dz + z * p.dx };
}

export function travelEnding(st, pos, { falling = false, groundY = pos.y } = {}) {
  if (falling || st.camp?.inside || Math.abs(pos.y - groundY) > 1.2) return null;
  if (st.path === 'main') {
    const v = villagePosition(pos);
    // 要真正走过村口的摊位，再向村外走；初始 s=4 或最近点钳到 s=0 都不会直接结局。
    if ((st.stats?.walked || 0) > 7 && Math.hypot(v.along + 6, v.side - 4.5) < 10) st.flags.passedHomeStall = true;
    if (st.flags.passedHomeStall && v.along < -22 && Math.abs(v.side) < 32) return 'sigma';
  }
  const branch = branches[st.path];
  if (branch && !st.flags.freeDescent) {
    // 走完游戏连接、到达接触点才结算；不是一降到某个海拔就自动获救。
    const end = branch.pointAt(branch.length);
    return st.s >= branch.length - 6 && Math.hypot(pos.x - end.x, pos.z - end.z) <= 8 ? 'retreat_branch' : null;
  }
  if (canFreeDescent(st) && voxToAlt(groundY) < 1600) return 'retreat_wild';
  return null;
}

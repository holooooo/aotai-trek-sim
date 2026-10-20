// 行进配速的游戏参数；不是现实中的速度或风险预测。
const WALK = Object.freeze({ speed: 1, effort: 1, risk: 1 });
const FAST = Object.freeze({ speed: 1.55, effort: 2.2, risk: 2.4 });
const RUNNER_FAST = Object.freeze({ speed: 1.9, effort: 2.6, risk: 2.8 });

export function paceProfile(st, braced = false) {
  if (st?.pace !== 'fast' || braced || st?.camp?.inside) return WALK;
  return st.role === 'runner' ? RUNNER_FAST : FAST;
}

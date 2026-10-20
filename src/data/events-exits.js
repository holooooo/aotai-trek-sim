// 四条下撤/迷路支线的中段抉择事件。
// 事件借鉴公开报道中的风险机制；人物、连接、方向与选择均为游戏虚构，不构成现实路线或安全建议。
import { ITEMS } from './items.js';

const COMMON_BOUNDARY = {
  safetyConclusion: '鳌太线穿越被禁止；任何报道中的获救地点、设施或搜救范围，都不能推出一条可复制或安全的下撤路线。',
  notInferred: [
    '报道地点之间的真实连通、方向、里程和通行条件未由本事件确认。',
    '游戏中的 branch/path 连接是虚构的，不是导航数据，也不是救援指引。',
  ],
};

export const EXIT_SOURCE_LINKS = Object.freeze({
  hetaoping: 'https://news.hsw.cn/system/2025/0219/1824598.shtml',
  qingfengxia: 'https://news.sina.com.cn/c/2012-08-22/022225010064.shtml',
  dudumen: 'http://tbpark.com/html/2018/scenic_0503/1313.html',
  diaoyutai: 'https://www.ctdsb.net/c1716_202501/2345362.html',
});

export const EXIT_FACT_BOUNDARY = Object.freeze({
  hetaoping: {
    verified: ['2025 报道称失联者在 2800 米营地下方一公里多、核桃坪附近山域被找到。', '报道提到其沿河向下游行走并发生多次滑坠。'],
    notInferred: COMMON_BOUNDARY.notInferred,
    safety: COMMON_BOUNDARY.safetyConclusion,
  },
  qingfengxia: {
    verified: ['2012 报道记录了一支队伍误判塘口方向、偏离原线路并在河谷方向寻找出路的搜救经过。', '报道中的搜救组织和接触地点是个案信息。'],
    notInferred: COMMON_BOUNDARY.notInferred,
    safety: COMMON_BOUNDARY.safetyConclusion,
  },
  dudumen: {
    verified: ['2018 太白山官网报道提到失联者原计划经过老庙子沟、跑马梁、都督门、周至老县城，搜救覆盖多个区域。', '报道最终记载其在大爷海附近被找到。'],
    notInferred: COMMON_BOUNDARY.notInferred,
    safety: COMMON_BOUNDARY.safetyConclusion,
  },
  diaoyutai: {
    verified: ['2025 报道称一名失联者在跑马梁后走岔，数日后从钓鱼台方向走出并遇到水电站工作人员。', '报道记载其有冻伤，不能把走出个案当成路线验证。'],
    notInferred: COMMON_BOUNDARY.notInferred,
    safety: COMMON_BOUNDARY.safetyConclusion,
  },
});

export const EXIT_EVENT_OPTION_IDS = Object.freeze({
  exit_hetaoping_river: ['mark_position', 'check_phone', 'follow_drainage'],
  exit_qingfengxia_bearing: ['compare_bearing', 'reverse_segment', 'keep_heading'],
  exit_dudumen_landmarks: ['compare_landmarks', 'turn_back', 'continue_ridge'],
  exit_diaoyutai_signal: ['call_out', 'hold_position', 'retrace'],
});

const source = (branch) => [EXIT_SOURCE_LINKS[branch]];
const boundary = (branch) => EXIT_FACT_BOUNDARY[branch];
const choose = (id, label, sub, disabled = false) => ({ id, label, sub, disabled });
const effects = (g) => {
  g.st.story ||= {};
  g.st.story.effects ||= {};
  return g.st.story.effects;
};
const mark = (g, branch, key, value = true) => {
  g.recordStory(`exit_${branch}_${key}`, value);
};
const hasGps = (g) => g.hasItem('gps') && g.st.bat.gps >= 3;
const hasFood = (g) => Object.keys(g.st.inv).some((id) => ITEMS[id]?.kind === 'food' && !ITEMS[id].alcohol && g.hasItem(id));
const firstFood = (g) => Object.keys(g.st.inv).find((id) => ITEMS[id]?.kind === 'food' && !ITEMS[id].alcohol && g.hasItem(id));
const commsAvailable = (g) => {
  const c = g.comms();
  return c.sat ? g.st.bat.satcomm >= 4 : c.phone && g.st.bat.phone >= 5;
};
const spendComms = (g) => {
  const c = g.comms();
  if (!commsAvailable(g)) return false;
  return g.spendBattery(c.sat ? 'satcomm' : 'phone', c.sat ? 4 : 5);
};
const eatRation = (g) => {
  const id = firstFood(g);
  if (!id || !g.hasItem(id)) return false;
  if (typeof g.eat === 'function') {
    const before = g.st.inv[id] || 0;
    g.eat(id);
    return (g.st.inv[id] || 0) === before - 1;
  }
  return g.takeItem(id);
};
const pause = (g, minutes) => g.eventPause(minutes);
const checked = (g, branch, minutes = 120) => {
  effects(g).navigationCheckedUntil = g.st.time + minutes;
  mark(g, branch, 'checked', true);
};
const doubt = (g, branch, minutes = 150) => {
  effects(g).navigationDoubtUntil = g.st.time + minutes;
  mark(g, branch, 'doubt', true);
};
const contact = (g, branch) => {
  mark(g, branch, 'contact', true);
  mark(g, branch, 'contactAt', g.st.time);
};
const event = ({ id, branch, fromFraction = 0.38, toFraction = 0.62, who, text, options }) => {
  const optionIds = options.map((item) => item.id);
  return {
    id,
    path: branch,
    branchId: branch,
    once: true,
    ambient: true,
    weight: 1,
    priority: 38,
    optionIds,
    sourceLinks: source(branch),
    factBoundary: boundary(branch),
    cond: (g) => {
      const route = typeof g.path === 'function' ? g.path() : null;
      const fraction = Number(g.st?.s) / Number(route?.length);
      return g.st?.path === branch && !g.st?.camp?.inside && Number.isFinite(fraction) && fraction >= fromFraction && fraction <= toFraction;
    },
    async run(g) {
      const c = await g.storyDialog(id, {
        who,
        sub: '虚构情境 · 公开报道只提供风险背景，不证明路线连通或安全',
        text,
        choices: options.map(({ run: _run, disabled: isDisabled, ...choiceData }) => ({ ...choiceData, disabled: !!(typeof isDisabled === 'function' ? isDisabled(g) : isDisabled) })),
      });
      if (!c || g.over) return;
      const selected = options.find((item) => item.id === c);
      if (!selected || (typeof selected.disabled === 'function' && selected.disabled(g))) return;
      await selected.run(g);
      if (!g.over) mark(g, branch, 'choice', c);
    },
  };
};

export const EXIT_EVENTS = [
  event({
    id: 'exit_hetaoping_river', branch: 'hetaoping', who: '2800 米营地下方的河谷',
    text: [
      '雾气把 2800 米营地的方向遮成一片灰。下面传来水声，河谷里有零碎的脚印和被冲走的包装袋。',
      '有人曾在这片区域失联后被找到，但报道中的搜救位置和行走经历，不等于一条能照着走的下撤路线。',
    ],
    options: [
      {
        ...choose('mark_position', '停下来，用 GPS 记录当前位置', '需要 GPS 和 3 格电；记录位置不会自动召来救援。', (g) => !hasGps(g)),
        async run(g) {
          if (!hasGps(g) || !await pause(g, 10) || !g.spendBattery('gps', 3)) return;
          checked(g, 'hetaoping', 120);
          g.changeBody('stamina', -2);
        },
      },
      {
        ...choose('check_phone', '找高处试着联系外界', '需要可用通讯和 5 格手机/4 格卫星电量；能送出消息不代表已经获救。', (g) => !commsAvailable(g)),
        async run(g) {
          if (!commsAvailable(g) || !await pause(g, 5) || !spendComms(g)) return;
          contact(g, 'hetaoping');
          g.changeBody('stress', -2);
        },
      },
      {
        ...choose('follow_drainage', '沿着水声继续向下切', '会更快离开高处参照物，消耗时间、体力、饮食储备；下方并非已确认道路。'),
        async run(g) {
          if (!await pause(g, 18)) return;
          g.st.dir = 1;
          g.changeBody('stamina', -8);
          g.changeBody('water', -4);
          g.changeBody('food', -3);
          g.addStress(4);
          doubt(g, 'hetaoping');
        },
      },
    ],
  }),
  event({
    id: 'exit_qingfengxia_bearing', branch: 'qingfengxia', who: '雾里的方向判断',
    text: [
      '山脊拐过一个缺口，手绘方向和地形都指向不同的答案。你想起曾有人把塘口方向判断反，后来在河谷一侧被搜救。',
      '那个个案只能说明误判会扩大搜救范围，不能说明青峰峡或任何河谷是可安全通行的出口。',
    ],
    options: [
      {
        ...choose('compare_bearing', '用 GPS 对照地形和当前方向', '需要 GPS 和 3 格电；对照结果仍可能受雾和偏离路线影响。', (g) => !hasGps(g)),
        async run(g) {
          if (!hasGps(g) || !await pause(g, 12) || !g.spendBattery('gps', 3)) return;
          checked(g, 'qingfengxia', 140);
          g.changeBody('stamina', -2);
        },
      },
      {
        ...choose('reverse_segment', '退回最近一个能辨认的标记', '先回看走过的地形；会损失时间和体力，也不保证标记仍可见。'),
        async run(g) {
          if (!await pause(g, 16)) return;
          g.st.dir = -1;
          g.changeBody('stamina', -5);
          g.addStress(2);
          checked(g, 'qingfengxia', 80);
        },
      },
      {
        ...choose('keep_heading', '按当前判断继续向前', '不再停下来核对；会消耗饮食和体力，之后的方向判断更不稳定。'),
        async run(g) {
          if (!await pause(g, 20)) return;
          g.st.dir = 1;
          g.changeBody('stamina', -6);
          g.changeBody('water', -3);
          g.changeBody('food', -2);
          g.addStress(5);
          doubt(g, 'qingfengxia');
        },
      },
    ],
  }),
  event({
    id: 'exit_dudumen_landmarks', branch: 'dudumen', who: '一条旧的行程计划',
    text: [
      '包里夹着一张旧计划：老庙子沟、跑马梁、都督门、周至老县城。它和眼前的山脊只对上了几个名字。',
      '公开搜救记录说明过搜寻范围与最终发现位置，但没有给这条游戏支线补上一段可导航的连接。',
    ],
    options: [
      {
        ...choose('compare_landmarks', '用 GPS 逐项核对地标', '需要 GPS 和 3 格电；地名相同不代表位置或路线相同。', (g) => !hasGps(g)),
        async run(g) {
          if (!hasGps(g) || !await pause(g, 10) || !g.spendBattery('gps', 3)) return;
          checked(g, 'dudumen', 150);
          g.changeBody('stamina', -2);
        },
      },
      {
        ...choose('turn_back', '沿已确认的脊线退回', '保留可辨认地形；退回本身也会消耗时间、体力和电量窗口。'),
        async run(g) {
          if (!await pause(g, 15)) return;
          g.st.dir = -1;
          g.changeBody('stamina', -5);
          g.addStress(1);
          checked(g, 'dudumen', 70);
        },
      },
      {
        ...choose('continue_ridge', '继续沿山脊寻找旧计划中的方向', '旧计划不是路标；前进会消耗饮食和体力，不能把搜救范围当作出口。'),
        async run(g) {
          if (!await pause(g, 22)) return;
          g.st.dir = 1;
          g.changeBody('stamina', -8);
          g.changeBody('food', -3);
          g.changeBody('water', -3);
          g.addStress(5);
          doubt(g, 'dudumen');
        },
      },
    ],
  }),
  event({
    id: 'exit_diaoyutai_signal', branch: 'diaoyutai', who: '远处的设施灯',
    text: [
      '天色暗下来，远处像是有一盏固定的灯。你听说过有人从跑马梁后走岔，几天后在钓鱼台方向遇到水电站工作人员。',
      '那是一个被报道的个案，不是设施可达性证明；你现在看见的灯也可能只是雪面反光。',
    ],
    options: [
      {
        ...choose('call_out', '先用通讯报出自己的状态', '需要可用通讯和 5 格手机/4 格卫星电量；只确认消息送出，不直接触发救援结局。', (g) => !commsAvailable(g)),
        async run(g) {
          if (!commsAvailable(g) || !await pause(g, 5) || !spendComms(g)) return;
          contact(g, 'diaoyutai');
          g.changeBody('stress', -2);
        },
      },
      {
        ...choose('hold_position', '原地停下，观察灯光和地形', '会消耗一点水分与时间；观察不是确认设施，也不保证有人能看到你。'),
        async run(g) {
          if (!await pause(g, 20)) return;
          g.changeBody('water', -3);
          g.changeBody('stamina', -1);
          g.addStress(2);
          checked(g, 'diaoyutai', 60);
        },
      },
      {
        ...choose('retrace', '吃一点东西，退回个人标记处', '需要一份现有口粮；退回会翻转方向并消耗体力，不代表能回到安全地点。', (g) => !hasFood(g)),
        async run(g) {
          if (!hasFood(g) || !await pause(g, 18) || !eatRation(g)) return;
          g.st.dir = -1;
          g.changeBody('stamina', -6);
          g.addStress(3);
          checked(g, 'diaoyutai', 80);
        },
      },
    ],
  }),
];

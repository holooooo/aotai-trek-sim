// 虚构路遇与个人选择，不对应特定遇难者；不是现实导航或医疗建议。
import { ITEMS } from './items.js';
import { packWeight, packCapacity } from '../sim/state.js';

const inside = (g) => !!g.st.camp?.inside;
const outside = (g) => !inside(g);
const choice = (id, label, sub, disabled = false) => ({ id, label, sub, disabled });
const event = (id, opts) => ({ id, once: true, ambient: true, weight: 1, priority: 20, ...opts });
const mark = (g, key, value = true) => g.recordStory(key, value);
const effect = (g, key, value) => { g.st.story.effects ||= {}; g.st.story.effects[key] = value; };
const ask = (g, id, who, text, choices) => g.storyDialog(id, { who, text, choices });
const food = (g) => ['bar', 'biscuit', 'chocolate'].find((id) => g.hasItem(id));
const spare = (g) => ['camera', 'baijiu'].find((id) => g.hasItem(id));
const navTool = (g) => g.hasItem('gps') && g.st.bat.gps >= 3 || g.hasItem('compass') && g.daylight() && !g.foggy();
const checkNav = (g, minutes = 120) => {
  // 仅改善后续判断，不改坐标、s或lost；浓雾中的指北针不能凭空确定位置。
  if (!navTool(g)) return false;
  if (g.hasItem('gps') && g.st.bat.gps >= 3 && !g.spendBattery('gps', 3)) return false;
  effect(g, 'navigationCheckedUntil', g.st.time + minutes);
  return true;
};
const shareLoad = (g) => {
  const id = g.st.companions.find((n) => g.st.npcs[n] && !g.st.npcs[n].dead && g.st.npcs[n].cond > 35);
  if (!id) return false;
  g.npcCond(id, -4); // 合作有代价，不修改任何库存或背包重量。
  effect(g, 'sharedLoadUntil', g.st.time + 120);
  return true;
};
const placeStamp = (g) => ({ at: g.st.time, x: g.pos.x, z: g.pos.z, path: g.st.path });
const nearStamp = (g, stamp) => stamp && stamp.path === g.st.path && Math.hypot(g.pos.x - stamp.x, g.pos.z - stamp.z) < 35;

export const EXPANDED_EVENTS = [
  // 通用首发：12个。priority均低于危急事件保留线100，cond不含随机数。
  event('ridge_shelter', {
    weight: 1.2, priority: 58,
    cond: (g) => outside(g) && g.onExposedRidge() && g.wx().wind > 15 && g.st.body.stress > 35,
    async run(g) {
      const c = await ask(g, 'ridge_shelter', '风口边缘', ['风把雪粒压在脸上。你本想赶到下一处营地，现在连站稳都费劲。', '背风位置需要实地选择，没有哪块岩石能保证安全。'], [
        choice('check', '先站稳，观察周围', '需要停留，风里仍可能继续散热'),
        choice('camp', '看看这里能不能扎营', '需要平地和装备；没有帐篷就只能考虑露宿'),
        choice('push', '沿着山脊继续走', '保留当前行程；风中行走会继续消耗体力'),
      ]);
      if (c === 'check') { if (!await g.eventPause(8)) return; g.changeBody('stress', -4); mark(g, 'shelterSought'); }
      else if (c === 'camp') { g.autoWalk = false; mark(g, 'shelterChosen'); await g.beginCamp(); }
      else { g.changeBody('stamina', -4); g.changeBody('stress', 5); }
    },
  }),
  event('hot_water_share', {
    allowCamp: true, weight: 1.15, priority: 48,
    cond: (g) => inside(g) && g.st.thermos.l >= 0.5 && g.st.thermos.temp > 45 && g.st.body.core > 34.5,
    async run(g) {
      const c = await ask(g, 'hot_water_share', '隔壁帐篷', ['旁边营地的人用手电示意：他的水瓶冻住了，想借一杯热水。', '分水会减少你的储备，不能因此认定他已脱离失温危险。'], [
        choice('share', '分一杯热水给他', '会减少保温杯里的储备'),
        choice('guide', '告诉他你知道的烧水和避风做法', '需要交谈一会儿；他仍要自行处理寒冷'),
        choice('decline', '先保留热水，说明自己的情况', '保留手边储备，之后仍可能惦记这件事'),
      ]);
      if (c === 'share') {
        if (g.st.thermos.l < 0.25 || g.st.thermos.temp <= 40) return g.toast('热水已不足，没能分出这一杯。', 'warn');
        g.st.thermos.l = Math.max(0, g.st.thermos.l - 0.25);
        mark(g, 'hotWaterShared'); mark(g, 'hotWaterSharePlace', placeStamp(g)); g.changeBody('stress', -3);
      } else if (c === 'guide') { if (!await g.eventPause(5)) return; mark(g, 'hotWaterGuided'); }
      else { mark(g, 'hotWaterDeclined'); g.changeBody('stress', 3); }
    },
  }),
  event('family_callback', {
    weight: 1.05, priority: 42,
    cond: (g) => g.signal() > 0 && !g.st.airplane && g.st.bat.phone >= 6 && g.st.s * 0.04 > 4,
    async run(g) {
      const c = await ask(g, 'family_callback', '未接来电', ['手机跳出几条家人的留言：“到了记得说一声。”', '你看了看剩余电量，还要靠这部手机联系外界。'], [
        choice('call', '回拨，说明目前位置和打算', '会占用手机电量；通话时要停留一会儿'),
        choice('text', '发一条简短消息', '会占用手机电量；文字不等同于向救援机构报警'),
        choice('later', '暂时不回复，继续留着电量', '不消耗电量；家人只能保留之前的信息'),
      ]);
      if (c === 'later') { mark(g, 'homeDeferred'); g.changeBody('stress', 2); return; }
      if (!g.spendBattery('phone', c === 'call' ? 4 : 2)) return g.toast('电量不足，消息没能发出。', 'warn');
      mark(g, 'contactHome'); mark(g, 'familyCallbackAt', g.st.time);
      if (c === 'call' && !await g.eventPause(8)) return;
      g.changeBody('stress', c === 'call' ? -8 : -4); g.toast('你把目前的位置和计划告诉了家人。', 'info');
    },
  }),
  event('rescue_update', {
    allowCamp: true, weight: 1.25, priority: 88,
    cond: (g) => !!g.st.rescue?.self && !g.storyValue('rescueUpdated') && (g.st.rescue.moved || g.st.rescue.eta - g.st.time < 240) && g.comms().any,
    async run(g) {
      const c = await ask(g, 'rescue_update', '旧的报告点', ['救援记录里是上一次报告的位置。你是否还在那里？', '重新报告需要电量和可用通信，不会让救援队瞬间到达。'], [
        choice('update', '向救援队补充当前位置', '会占用现有通讯资源；即便接通仍需等待'),
        choice('hold', '留在这里等候，不发送新位置', '不额外使用通讯；若已离开旧报告点，搜寻可能有偏差'),
        choice('camp', '先检查附近能否安置营地', '需要花时间并消耗保温储备；营地位置不会自动传给救援队'),
      ]);
      if (c === 'update') {
        if (!await g.updateRescuePosition()) return g.toast('没有接通，救援坐标未更新。', 'warn');
        if (g.over) return;
        mark(g, 'rescueContact'); mark(g, 'rescueUpdated'); mark(g, 'rescueUpdatedAt', g.st.time); g.changeBody('stress', -4);
      } else if (c === 'camp') { g.autoWalk = false; await g.beginCamp(); }
      else { g.autoWalk = false; mark(g, 'rescueHoldChosen'); g.changeBody('stress', 2); }
    },
  }),
  event('loose_marker', {
    weight: 1.1, priority: 56,
    cond: (g) => outside(g) && g.foggy() && g.st.flags.lost,
    async run(g) {
      const c = await ask(g, 'loose_marker', '松落的红布', ['灌木上挂着一条红布，和你以为的路线方向不同。它也可能是很久以前留下的。', '路标颜色和脚印都不能证明前方安全。'], [
        choice('check', '停下查看手边的定位工具', '需要可用的GPS或能辨方向的罗盘；GPS会耗电，没有工具就只能继续判断'),
        choice('camp', '检查附近能否暂时停留', '需要现场判断地形和装备'),
        choice('follow', '沿红布方向走一小段再观察', '离开目前位置后还要重新判断回程方向'),
      ]);
      if (c === 'check') {
        if (!await g.eventPause(10)) return;
        const checked = checkNav(g, 180); mark(g, 'markerChecked', checked);
        g.toast(checked ? '你核对了定位资料，仍需沿可确认路线移动。' : '没有可靠定位依据，红布不能替你决定方向。', checked ? 'info' : 'warn');
      } else if (c === 'camp') { g.autoWalk = false; await g.beginCamp(); }
      else { if (!await g.eventPause(5)) return; g.changeBody('stamina', -3); g.changeBody('stress', 5); mark(g, 'markerDoubted'); }
    },
  }),
  event('hand_warmth', {
    weight: 1.15, priority: 66,
    cond: (g) => outside(g) && g.st.body.frostbite > 12 && g.st.body.core < 35.8,
    async run(g) {
      const c = await ask(g, 'hand_warmth', '扣不上拉链', ['手指越来越笨，拉链总从指尖滑走。你把双手藏回衣服里。', '避免摩擦麻木的部位；辅助热源不保证冻伤逆转，仍需避风、保温与必要的救援。'], [
        choice('warmer', '在躯干部位使用暖宝宝', '会消耗暖宝宝并占用整理时间；不直接消除冻伤', g.st.warmers < 1),
        choice('insulate', '停下来穿上保暖层', '需要有可穿的保暖衣物；停留处仍可能受冷', !g.hasInsul()),
        choice('move', '先继续移动，之后再处理', '不消耗物资；手部麻木会影响后续操作'),
      ]);
      if (c === 'warmer') {
        if (g.st.warmers < 1) return; g.useWarmer();
        if (!await g.eventPause(4)) return; mark(g, 'handsProtected');
      } else if (c === 'insulate') {
        if (!g.hasInsul()) return; g.autoWalk = false; await g.setInsulation(true);
        if (g.over) return;
        if (!await g.eventPause(6)) return; mark(g, 'handsProtected');
      } else { g.changeBody('stress', 4); mark(g, 'handsDelayed'); }
    },
  }),
  event('windproof_lash', {
    once: false, cooldown: 120, allowCamp: true, weight: 1.05, priority: 70,
    cond: (g) => inside(g) && !g.st.camp.bivy && !g.st.camp.collapsed && !g.storyValue('tentSeamPatched') && (g.st.story.effects?.tentLeak || g.wx().wind > 12 && g.st.camp.health < 75),
    async run(g) {
      const c = await ask(g, 'windproof_lash', '帐布上的裂口', ['侧面帐布磨开一道小口，雪末从缝里吹进来。', '这次是帐布漏风，缝合不能提高帐杆的抗风等级。'], [
        choice('patch', '用急救包里的胶带封住裂口', '需要急救包和停留时间；只处理漏口，不改变帐篷抗风能力', !g.hasItem('firstaid')),
        choice('stitch', '把帐布收拢后绑好', '需要在原地处理一阵，会消耗体力，之后仍要观察'),
        choice('stay', '暂时让裂口留着', '漏风会持续；之后还可以再找时间修补'),
      ]);
      const camp = g.st.camp;
      effect(g, 'tentLeak', true);
      if (c === 'patch') { if (!g.takeItem('firstaid')) return; if (!await g.eventPause(12)) return; }
      else if (c === 'stitch') { if (!await g.eventPause(25)) return; g.changeBody('stamina', -4); }
      else { mark(g, 'tentLeakDeferred'); g.changeBody('stress', 4); return; }
      if (g.st.camp !== camp || camp.collapsed) return;
      effect(g, 'tentPatched', true); effect(g, 'tentLeak', false); mark(g, 'tentSeamPatched');
    },
  }),
  event('false_trail', {
    weight: 1.2, priority: 62,
    cond: (g) => outside(g) && g.foggy() && !g.st.flags.lost && g.st.body.stress > 55 && g.st.s * 0.04 > 8,
    async run(g) {
      const c = await ask(g, 'false_trail', '两道脚印', ['一串脚印往坡下，另一串横切山脊。它们在雾里都只延伸十几步。', '前人也可能走错。跟着脚印不等于跟着一条安全路线。'], [
        choice('check', '留在原处核对方向', '需要停留；只有可靠工具才能改善后续判断，不会改变当前位置'),
        choice('track', '沿脚印试着看一段', '会离开当前路线判断；即使回头也可能误判地形'),
        choice('stop', '先停下来，看看能否扎营', '会损失一些行程时间；营地需要现场确认'),
      ]);
      if (c === 'check') {
        if (!await g.eventPause(10)) return;
        const checked = checkNav(g, 150); mark(g, 'falseTrailChecked', checked); g.changeBody('stress', checked ? -3 : 2);
      } else if (c === 'track') { if (!await g.eventPause(8)) return; g.changeBody('stamina', -4); g.changeBody('stress', 5); mark(g, 'falseTrailRisked'); }
      else { g.autoWalk = false; mark(g, 'falseTrailStopped'); await g.beginCamp(); }
    },
  }),
  event('headlamp_contact', {
    once: false, cooldown: 120, allowCamp: true, weight: 1, priority: 64,
    cond: (g) => g.hasItem('headlamp') && !g.storyValue('headlampResolved') && (g.st.story.effects?.headlampFault || outside(g) && g.night() && g.st.bat.headlamp >= 5),
    async run(g) {
      effect(g, 'headlampFault', true);
      const c = await ask(g, 'headlamp_contact', '忽明忽暗的头灯', ['每次低头，灯光就闪一下。你怀疑是低温让触点接触不良。', '照明变弱会影响判断脚下；修理期间也不能停止保暖。'], [
        choice('fix', '停下检查电池触点', '需要停留；恢复接触不等于增加电量'),
        choice('warm', '把头灯贴身回温后再看', '需要留有头灯余量；避免直接加热电池', g.st.bat.headlamp < 2),
        choice('defer', '先把灯留着，边走边留意', '有效照明会变弱；之后还能再尝试处理'),
      ]);
      if (c === 'fix') { if (!await g.eventPause(10)) return; effect(g, 'headlampFault', false); }
      else if (c === 'warm') {
        if (!g.spendBattery('headlamp', 2)) return;
        if (!await g.eventPause(15)) return; effect(g, 'headlampFault', false);
      } else {
        // 延后会留下故障；随后通过同一修复节点恢复，不永久锁死。
        mark(g, 'headlampDeferredAt', g.st.time); g.changeBody('stress', 3);
      }
      if (c !== 'defer') mark(g, 'headlampResolved');
      mark(g, 'headlampContactChoice', c);
    },
  }),
  event('fuel_check', {
    allowCamp: true, weight: 1.05, priority: 50,
    cond: (g) => inside(g) && g.hasItem('stove') && g.hasItem('pot') && g.st.gas.normal + g.st.gas.alpine > 0 && g.st.gas.normal + g.st.gas.alpine <= 2,
    async run(g) {
      const c = await ask(g, 'fuel_check', '最后一点燃料', ['气罐已经很轻了。剩余燃料不够让你不断烧水试错。', '没有补给点，低温和风还可能让炉头效率降低。'], [
        choice('cook', '现在烧一次水', '会消耗现有燃料和时间；结果要看当前条件'),
        choice('save', '把燃料留到后面', '保留当前余量；眼下的寒冷和缺水不会自行缓解'),
        choice('retreat', '把燃料算进下撤安排', '需要重新规划路线；原定进度会被打乱'),
      ]);
      mark(g, 'fuelChecked', c);
      if (c === 'cook') { g.lightCampFire(); await g.cook(true); if (g.over) return; }
      else if (c === 'retreat') await g.retreatMenu();
      else g.changeBody('stress', 2);
    },
  }),
  event('emergency_bivouac', {
    weight: 1.3, priority: 92,
    cond: (g) => outside(g) && (g.st.body.core < 34.5 || g.st.body.health < 35) && g.st.body.stamina < 25,
    async run(g) {
      const c = await ask(g, 'emergency_bivouac', '走不动了', ['你扶着背包站了很久，才意识到自己一直没有迈步。', '现在需要停止盲目推进。停留也有风险，露宿和保暖都不保证能够撑到天亮。'], [
        choice('camp', '查看当前位置能否停下', '可能缺少宿营条件；停留仍会消耗身体储备'),
        choice('sos', '尝试用现有通信求救', '需要可用通信；救援可能需要等待', !g.comms().any),
        choice('retreat', '打开下撤选择，重新安排', '不是立即到达安全点；移动仍有脚下和体温风险'),
      ]);
      g.autoWalk = false; mark(g, 'emergencyDecision', c);
      if (c === 'camp') await g.beginCamp();
      else if (c === 'sos') { if (!g.comms().any) return; await g.sos({}); if (g.over) return; }
      else await g.retreatMenu();
    },
  }),
  event('shared_load', {
    weight: 1.1, priority: 48,
    cond: (g) => outside(g) && g.st.companions.some((id) => g.st.npcs[id]?.cond > 35 && !g.st.npcs[id]?.dead) && g.st.body.stamina < 50,
    async run(g) {
      const c = await ask(g, 'shared_load', '调整队形', ['同行者看你落后，提出轮换带路、互相提醒脚下，而不是让一个人硬撑。', '协作不让背包重量凭空消失，对方也要额外花力气。'], [
        choice('accept', '接受这段协作安排', '同伴也要付出体力，同行节奏会改变；背包重量不变'),
        choice('rest', '一起停下来休息一会儿', '天气和救援时钟仍会推进，停留也会散热'),
        choice('decline', '各自保持原来的节奏', '不增加同伴负担；你的疲劳仍需自己处理'),
      ]);
      if (c === 'accept') { if (!shareLoad(g)) return; mark(g, 'sharedLoadDone'); g.changeBody('stress', -3); }
      else if (c === 'rest') { if (!await g.eventPause(12)) return; mark(g, 'sharedRestDone'); }
      else { mark(g, 'sharedLoadDeclined'); g.changeBody('stress', 2); }
    },
  }),

  // 角色首发：6个；每个身份仅对应一个事件，不给其他身份资格。
  event('student_shortcut', {
    role: 'student', weight: 1.2, priority: 46,
    cond: (g) => g.st.role === 'student' && outside(g) && g.st.s * 0.04 > 3 && g.foggy(),
    async run(g) {
      const c = await ask(g, 'student_shortcut', '收藏夹里的近路', ['你想起视频里一句“从这块石头旁边切过去更快”。眼前的石头却没有一块能确定。'], [
        choice('check', '想起视频内容，查查手边定位工具', '要停留一阵；GPS会耗电，没有工具无法据此定位'),
        choice('stay', '沿眼前能辨认的方向继续判断', '绕行可能多花些时间；雾仍影响定位'),
        choice('try', '试着从坡面走一段看看', '会花时间和体力；坡面方向仍不确定'),
      ]);
      if (c === 'check') { if (!await g.eventPause(8)) return; mark(g, 'studentChecked', checkNav(g)); }
      else if (c === 'stay') { if (!await g.eventPause(4)) return; mark(g, 'studentStayedOnRoute'); }
      else { if (!await g.eventPause(6)) return; g.changeBody('stamina', -4); g.changeBody('stress', 4); mark(g, 'studentShortcutRisked'); }
    },
  }),
  event('veteran_confidence', {
    role: 'veteran', weight: 1.1, priority: 46,
    cond: (g) => g.st.role === 'veteran' && outside(g) && g.st.s * 0.04 > 8 && g.wx().wind > 17,
    async run(g) {
      const c = await ask(g, 'veteran_confidence', '夏季走过的山', ['山形似曾相识，但雪、风和结冰的坡面都不是夏天的样子。', '熟悉感不能替代对当前条件的判断。'], [
        choice('check', '重新看看眼下的冬季条件', '需要停留一阵；定位工具只能辅助判断'),
        choice('retreat', '打开下撤选项，看看回程安排', '会结束当前推进；回程路况仍要自行判断'),
        choice('push', '按原计划继续向前', '继续消耗体力，前方条件仍需应对'),
      ]);
      if (c === 'check') { if (!await g.eventPause(8)) return; mark(g, 'veteranRechecked', checkNav(g, 180)); }
      else if (c === 'retreat') { mark(g, 'veteranReconsidered'); await g.retreatMenu(); }
      else { mark(g, 'veteranPushed'); g.changeBody('stamina', -4); g.changeBody('stress', 3); }
    },
  }),
  event('blogger_honest_cut', {
    role: 'blogger', weight: 1.1, priority: 46,
    cond: (g) => g.st.role === 'blogger' && g.hasItem('camera') && g.st.s * 0.04 > 6 && g.signal() > 0 && !g.st.airplane && g.st.bat.phone >= 4,
    async run(g) {
      const c = await ask(g, 'blogger_honest_cut', '剪辑框里的警告', ['你可以把一路上的普通镜头剪成“轻松速通”，也可以把禁入提示、寒冷和撤退的犹豫一起留下。', '视频不是求救信息，更不应成为模仿攻略。'], [
        choice('honest', '发布带有天气和装备说明的版本', '会耗用手机电量，整理发布时也要停留'),
        choice('hype', '发布以画面为主的版本', '会耗用手机电量；不会增加素材或定位信息'),
        choice('save', '先把草稿留在手机里', '不耗电，也暂时不向外发布内容'),
      ]);
      if (c === 'save') { mark(g, 'footageDeferred'); return; }
      if (!g.spendBattery('phone', 4)) return;
      mark(g, 'honestFootage', c === 'honest');
      if (c === 'honest' && !await g.eventPause(6)) return;
      g.changeBody('stress', c === 'honest' ? -4 : 2);
    },
  }),
  event('runner_heat', {
    role: 'runner', weight: 1.15, priority: 46,
    cond: (g) => g.st.role === 'runner' && outside(g) && g.isWalking() && (g.st.body.wet > 18 || g.st.body.stamina < 65),
    async run(g) {
      const c = await ask(g, 'runner_heat', '速度不是保温层', ['你仍能比别人跑得快，但汗湿的衣领已经开始发冷。', '用持续运动掩盖寒冷，并不能保证停下来以后安全。'], [
        choice('slow', '关掉自动行走，放慢节奏', '之后一段时间会走得更慢，运动强度也会随之调整'),
        choice('eat', '取一份能量补给再看', '会用掉手边已有的食物；补给不能替代保温', !food(g) && !g.hasItem('gel')),
        choice('push', '保持当前速度继续走', '衣物中的潮气可能累积，体力也会继续消耗'),
      ]);
      if (c === 'slow') { g.autoWalk = false; effect(g, 'runnerPaceUntil', g.st.time + 120); if (!await g.eventPause(6)) return; mark(g, 'runnerSlowed'); }
      else if (c === 'eat') { const id = g.hasItem('gel') ? 'gel' : food(g); if (!id) return; g.eat(id); mark(g, 'runnerFueled'); }
      else { g.changeBody('wet', 4); g.changeBody('stamina', -3); mark(g, 'runnerPushed'); }
    },
  }),
  event('nurse_triage', {
    role: 'nurse', weight: 1.1, priority: 84,
    cond: (g) => g.st.role === 'nurse' && outside(g) && (g.st.body.core < 35 || g.st.body.health < 55),
    async run(g) {
      const c = await ask(g, 'nurse_triage', '轮到自己分诊', ['你能辨认危险的身体指标，却不能靠专业经验在山里凭空造出医疗条件。', '先减少暴露，决定是否求救；处理伤口不等于处理失温。'], [
        choice('sos', '先尝试报告位置', '需要可用通信；之后仍需等待回应', !g.comms().any),
        choice('camp', '先看看附近能否停留', '需要检查装备与地形；停下不代表身体状况会自动改善'),
        choice('aid', '查看现有急救包能否派上用场', '需要急救包；会按当前伤病消耗物资', !g.hasItem('firstaid')),
      ]);
      g.autoWalk = false; mark(g, 'nurseTriage', c);
      if (c === 'sos') { if (!g.comms().any) return; await g.sos({}); if (g.over) return; }
      else if (c === 'camp') await g.beginCamp();
      else if (g.hasItem('firstaid')) { g.useFirstAid(); if (!await g.eventPause(8)) return; }
    },
  }),
  event('coder_overload', {
    role: 'coder', weight: 1, priority: 46,
    cond: (g) => g.st.role === 'coder' && outside(g) && g.st.s * 0.04 > 3 && (packWeight(g.st) > 12 || packWeight(g.st) > packCapacity(g.st) || g.st.body.stamina < 60),
    async run(g) {
      const item = spare(g);
      const c = await ask(g, 'coder_overload', '装备清单之外', ['每件装备都买得有理由，背着它们爬升却是另一回事。一位正在下撤的人愿意把你不需要的物品带回村里。', '能放弃的是非关键物品，不能把食物、燃料和保温装备一股脑丢掉。'], [
        choice('drop', item ? `让下撤者把${ITEMS[item].name}带回去` : '没有可舍弃的非关键物品', '这件物品交出去后不能再取用', !item),
        choice('share', '请同行者帮忙分担一段', '同伴会承担额外体力；背包重量不变', !g.st.companions.some((id) => g.st.npcs[id]?.cond > 35)),
        choice('repack', '停下重新整理装备', '需要停留；整理后仍要承担原有负重'),
      ]);
      if (c === 'drop') { if (!item || !g.takeItem(item)) return; mark(g, 'coderRelinquished', item); g.changeBody('stress', -2); }
      else if (c === 'share') { if (!shareLoad(g)) return; mark(g, 'coderSharedPace'); }
      else { if (!await g.eventPause(12)) return; mark(g, 'coderRepacked'); }
    },
  }),

  // 连续剧情：3个后续节点，不计入首发数；凭精确线程、时间和地点取得资格。
  event('mutual_followup', {
    followup: true, allowCamp: true, weight: 0.9, priority: 40,
    cond: (g) => inside(g) && g.storyValue('hotWaterShared') === true && nearStamp(g, g.storyValue('hotWaterSharePlace')) && g.st.time - g.storyValue('hotWaterSharePlace').at >= 120,
    async run(g) {
      const c = await ask(g, 'mutual_followup', '隔壁的人还醒着', ['两小时后，隔壁帐篷有人低声问你状况。他没有声称已恢复，只提出可以互相核对信息。', '他缺一条保温毯，有两块压缩饼干可以交换；双方都得留下足够储备。'], [
        choice('check', '和他一起核对定位信息', '需要各自有可靠工具；核对结果仍需自己判断'),
        choice('trade', '用保温毯换些饼干', '需要保温毯；会改变双方的物资储备', !g.hasItem('blanket')),
        choice('wave', '互道保重，各自照看营地', '不交换物资；也不代表对方已经安全'),
      ]);
      if (c === 'check') { if (!await g.eventPause(6)) return; mark(g, 'mutualRouteChecked', checkNav(g, 150)); }
      else if (c === 'trade') { if (!g.takeItem('blanket')) return; g.giveItem('biscuit', 2); mark(g, 'mutualTradeCompleted'); }
      else mark(g, 'mutualStayedIndependent');
      mark(g, 'mutualFollowupDone');
    },
  }),
  event('family_followup', {
    followup: true, allowCamp: true, weight: 0.9, priority: 40,
    cond: (g) => g.storyValue('contactHome') === true && Number.isFinite(g.storyValue('familyCallbackAt')) && g.st.time - g.storyValue('familyCallbackAt') >= 180 && g.signal() > 0 && !g.st.airplane && g.st.bat.phone >= 2,
    async run(g) {
      const c = await ask(g, 'family_followup', '一条回复', ['之前发出的消息终于有了回音：“我们看到了，别赶，安全最重要。”', '他们知道你在山里，但这不是救援机构已受理求救的证明。'], [
        choice('reply', '回复当前位置和后续计划', '会占用手机电量；只是让家人知道近况'),
        choice('sos', '尝试向救援机构求救', '需要可用通信；接通与否取决于当前条件', !g.comms().any),
        choice('save', '读完后先不发送消息', '留住手机电量；家人只能依据上次联系判断情况'),
      ]);
      mark(g, 'familyReplied');
      if (c === 'reply') { if (!g.spendBattery('phone', 2)) return; mark(g, 'homePlanUpdated'); g.changeBody('stress', -4); }
      else if (c === 'sos') { if (!g.comms().any) return; await g.sos({}); if (g.over) return; }
      else g.changeBody('stress', -1);
      mark(g, 'familyFollowupDone');
    },
  }),
  event('rescue_followup', {
    followup: true, allowCamp: true, weight: 1, priority: 94,
    cond: (g) => g.storyValue('rescueUpdated') === true && !!g.st.rescue && !g.st.rescue.moved && g.st.time - Number(g.storyValue('rescueUpdatedAt') ?? Infinity) >= 30 && g.comms().any,
    async run(g) {
      const device = g.comms().sat ? 'satcomm' : 'phone';
      if (!g.spendBattery(device, 1)) return;
      const c = await ask(g, 'rescue_followup', '确认收到坐标', ['通讯器收到确认：新的报告点已记录。天气和山路仍会影响到达时间。', '请留在报告点附近保温，别把这条回信理解成“再走一段就能迎到救援”。'], [
        choice('hold', '在报告点附近继续等候', '本次联络已占用一些通讯电量；等待期间仍需照看体温'),
        choice('camp', '看看报告点附近能否扎营', '本次联络已占用一些通讯电量；搭营还要消耗时间和装备'),
        choice('wait', '继续等待救援队到达', '本次联络已占用一些通讯电量；天气和身体状况仍会变化'),
      ]);
      g.autoWalk = false; mark(g, 'rescueFollowupDone');
      if (c === 'hold') g.changeBody('stress', -4);
      else if (c === 'camp') await g.beginCamp();
      else { await g.waitForRescue(); if (g.over) return; }
    },
  }),
];

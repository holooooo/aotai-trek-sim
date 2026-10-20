// Fictional everyday interruptions. Costs are game mechanics, not outdoor/medical instructions.
const choice = (id, label, sub, disabled = false) => ({ id, label, sub, disabled });
const outside = (g) => !g.st.camp?.inside;
const ration = (g) => ['bar', 'biscuit', 'chocolate'].find((id) => g.hasItem(id));
const mark = (g, id, value) => g.recordStory(`random_${id}`, value);
const ask = (g, id, who, text, choices) => g.storyDialog(id, { who, text, choices });
const event = (id, fromKm, toKm, options) => ({
  id, path: 'main', fromKm, toKm, randomEncounter: true, encounterChance: 0.66,
  once: true, ambient: true, weight: 1, priority: 24, ...options,
  cond: (g) => g.st.path === 'main' && g.st.s * 0.04 >= fromKm && g.st.s * 0.04 <= toKm && options.cond(g),
});

export const RANDOM_EVENTS = [
  event('pack_rattle', 4, 24, {
    optionIds: ['unpack', 'pad', 'ignore'],
    cond: (g) => outside(g) && g.st.body.stress > 15,
    async run(g) {
      const c = await ask(g, 'pack_rattle', '背后的轻响', ['包里有什么东西一下一下撞着扣环。停下时，声音也跟着消失。', '可能只是装包时留的空隙。你想起还在村口时，自己急着拉上拉链的样子。'], [
        choice('unpack', '卸下包，重新安排里面的东西', '需要停留并重新背包'),
        choice('pad', '用一张保温毯隔开碰撞的物件', '会占用一张保温毯，之后不能再作应急物资', !g.hasItem('blanket')),
        choice('ignore', '先让它响着，继续走', '不消耗物资，声音会跟着你'),
      ]);
      if (!c) return;
      if (c === 'unpack') { if (!await g.eventPause(12)) return; g.changeBody('stamina', -3); g.changeBody('stress', -5); }
      else if (c === 'pad') { if (!g.takeItem('blanket') || !await g.eventPause(4)) return; g.changeBody('stress', -3); }
      else if (c === 'ignore') g.changeBody('stress', 3);
      else return;
      mark(g, 'pack_rattle', c);
    },
  }),
  event('ice_flask', 12, 42, {
    optionIds: ['loosen', 'pour', 'later'],
    cond: (g) => outside(g) && g.st.thermos.l >= 0.15 && g.airT() < -5,
    async run(g) {
      const c = await ask(g, 'ice_flask', '拧不动的杯盖', ['水汽在保温杯口结成了薄冰。你隔着手套拧了两次，杯盖没动。', '杯身里还有水，手里的力气却不如出发时顺。'], [
        choice('loosen', '找个能停脚的位置，慢慢处理杯盖', '要留出时间，手部操作也会消耗体力'),
        choice('pour', '松开一点缝，倒掉杯口的一点水', '会损失少量杯中储备'),
        choice('later', '把杯子收回去，稍后再弄', '保留储备，眼下仍喝不到这一口'),
      ]);
      if (!c) return;
      if (c === 'loosen') { if (!await g.eventPause(10)) return; g.changeBody('stamina', -2); g.changeBody('stress', -2); }
      else if (c === 'pour') {
        if (g.st.thermos.l < 0.1) return;
        g.st.thermos.l = Math.max(0, g.st.thermos.l - 0.1);
        if (!await g.eventPause(4)) return;
        g.changeBody('stress', -1);
      } else if (c === 'later') g.changeBody('stress', 3);
      else return;
      mark(g, 'ice_flask', c);
    },
  }),
  event('paper_route', 20, 60, {
    optionIds: ['compare', 'photo', 'leave'],
    cond: (g) => outside(g) && g.daylight(),
    async run(g) {
      const canCompare = g.hasItem('gps') && g.st.bat.gps >= 3;
      const c = await ask(g, 'paper_route', '塑封袋里的手绘图', ['石边压着一张手绘图。几段折线旁写着营地的简称，却没有日期和比例尺。', '纸角的字迹被水洇开了。它可能是某个人的行程，也可能只是草稿。'], [
        choice('compare', '留在原处，用GPS资料比对这张图', '需要GPS与电量，要停下来检查', !canCompare),
        choice('photo', '拍下纸页，先不改变自己的方向', '会使用手机电量，照片不能代替定位', g.st.bat.phone < 2),
        choice('leave', '把纸压回原处，按自己的资料走', '不增加新的信息，也不额外占用设备'),
      ]);
      if (!c) return;
      if (c === 'compare') {
        if (!canCompare || !g.spendBattery('gps', 3) || !await g.eventPause(10)) return;
        g.st.story.effects.navigationCheckedUntil = g.st.time + 100;
        g.changeBody('stress', -2);
      } else if (c === 'photo') { if (!g.spendBattery('phone', 2) || !await g.eventPause(3)) return; }
      else if (c === 'leave') g.changeBody('stress', 1);
      else return;
      mark(g, 'paper_route', c);
    },
  }),
  event('dropped_ration', 28, 70, {
    optionIds: ['retrieve', 'eat', 'leave'],
    cond: (g) => outside(g) && !!ration(g) && g.wx().wind > 8,
    async run(g) {
      const item = ration(g);
      const c = await ask(g, 'dropped_ration', '滚到石头后的口粮', ['整理侧袋时，一包口粮落在脚边，又被风吹进几步外的碎石缝。', '你还能看见包装的一角。伸手够它，需要先把背包卸下来。'], [
        choice('retrieve', '卸下包，把那份口粮拿回来', '要花时间，重新起身会费些力气'),
        choice('eat', '拿回来后就在这里吃掉', '消耗这份口粮，也会占用停留时间'),
        choice('leave', '放弃这一份，先照顾手边的东西', '随身口粮会减少，之后无法取回'),
      ]);
      if (!c || !item) return;
      if (c === 'retrieve') { if (!await g.eventPause(10)) return; g.changeBody('stamina', -5); }
      else if (c === 'eat') {
        if (!g.takeItem(item) || !await g.eventPause(12)) return;
        g.changeBody('food', 10); g.changeBody('water', -3); g.changeBody('stamina', -2);
      } else if (c === 'leave') { if (!g.takeItem(item)) return; g.changeBody('stress', 2); }
      else return;
      mark(g, 'dropped_ration', c);
    },
  }),
  event('phone_draft', 38, 88, {
    allowCamp: true, optionIds: ['voice', 'write', 'pocket'],
    cond: (g) => g.st.bat.phone >= 3 && g.st.body.stress > 30 && g.signal() === 0,
    async run(g) {
      const c = await ask(g, 'phone_draft', '一条还发不出去的消息', ['手机没有信号。你还是点开了和家人的聊天框，光标闪了很久。', '此刻写下的内容只能留在本机，不能让山下的人知道你在哪里。'], [
        choice('voice', '录一小段话，留到有信号时再说', '使用手机电量，也要停留片刻'),
        choice('write', '写下几句很短的话', '使用少量手机电量；现在不会发送'),
        choice('pocket', '锁上屏幕，把话留到以后', '保留设备电量，消息仍然空着'),
      ]);
      if (!c) return;
      if (c === 'voice') { if (!g.spendBattery('phone', 3) || !await g.eventPause(6)) return; g.changeBody('stress', -7); }
      else if (c === 'write') { if (!g.spendBattery('phone', 1) || !await g.eventPause(4)) return; g.changeBody('stress', -3); }
      else if (c === 'pocket') g.changeBody('stress', 2);
      else return;
      mark(g, 'phone_draft', c); // This flag never claims that a message or rescue request was sent.
    },
  }),
  event('tent_neighbor_song', 8, 100, {
    allowCamp: true, optionIds: ['listen', 'share', 'quiet'],
    cond: (g) => !!g.st.camp?.inside && g.night(),
    async run(g) {
      const item = ration(g);
      const c = await ask(g, 'tent_neighbor_song', '隔着帐布的半首歌', ['附近有个人很轻地哼歌，唱到中间忘了词，自己笑了一声。', '你听不清他的名字，也不知道他从哪边来的。帐布外仍是风声。'], [
        choice('listen', '应一声，隔着帐篷聊一阵', '会占用本来留给休息的时间'),
        choice('share', '留一份吃的，过去打个招呼', '需要走出帐篷，会减少自己的口粮', !item),
        choice('quiet', '把声音留在外面，继续安排自己的事', '不分出食物，也不继续交谈'),
      ]);
      if (!c) return;
      if (c === 'listen') { if (!await g.eventPause(12)) return; g.changeBody('stress', -5); }
      else if (c === 'share') {
        if (!item || !g.takeItem(item)) return;
        g.changeBody('wet', 2);
        if (!await g.eventPause(7)) return;
        g.changeBody('stress', -4);
      } else if (c === 'quiet') { if (!await g.eventPause(3)) return; g.changeBody('stress', 1); }
      else return;
      mark(g, 'tent_neighbor_song', c);
    },
  }),
  event('ridge_echo', 48, 110, {
    optionIds: ['listen', 'call', 'move'],
    cond: (g) => outside(g) && g.night() && g.st.body.stress > 35,
    async run(g) {
      const c = await ask(g, 'ridge_echo', '身后的脚步', ['你停下，身后的声音也停了。再走两步，碎石又响了两下。', '也许是包带，也许是风卷动了石片。黑暗里看不出什么。'], [
        choice('listen', '留在原处，等声音再出现', '停留会占用时间，寒冷不会暂停'),
        choice('call', '叫一声，再用头灯看一看', '需要头灯电量，声音未必有回应', !g.hasItem('headlamp') || g.st.bat.headlamp < 2),
        choice('move', '把注意力放回脚下，继续原来的方向', '不调查声音，心里的疑虑仍在'),
      ]);
      if (!c) return;
      if (c === 'listen') { if (!await g.eventPause(9)) return; g.changeBody('stress', -2); }
      else if (c === 'call') {
        if (!g.hasItem('headlamp') || !g.spendBattery('headlamp', 2) || !await g.eventPause(5)) return;
        g.changeBody('stress', -4);
      } else if (c === 'move') { g.changeBody('stamina', -2); g.changeBody('stress', 4); }
      else return;
      mark(g, 'ridge_echo', c);
    },
  }),
  event('strap_snag', 58, 104, {
    optionIds: ['unload', 'pull', 'rest'],
    cond: (g) => outside(g) && g.st.body.stamina < 75,
    async run(g) {
      const c = await ask(g, 'strap_snag', '挂在石缝的肩带', ['侧身挤过两块岩石时，一截散开的肩带挂住了。你回头看，只能看见包的一角。', '背包把你往后扯，转身的空间很小。'], [
        choice('unload', '先站稳，把背包卸下来处理', '需要时间和重新背包的力气'),
        choice('pull', '扭过肩膀，试着直接拉出来', '能否松开取决于肩带和石缝；拉扯可能擦伤'),
        choice('rest', '先保持姿势喘口气，再慢慢退出', '会停留一阵；紧张和疲劳仍在'),
      ]);
      if (!c) return;
      if (c === 'unload') { if (!await g.eventPause(12)) return; g.changeBody('stamina', -3); }
      else if (c === 'pull') { if (!await g.eventPause(3)) return; g.changeBody('stamina', -6); g.changeBody('health', -3); }
      else if (c === 'rest') { if (!await g.eventPause(8)) return; g.changeBody('stress', 4); g.changeBody('stamina', -1); }
      else return;
      mark(g, 'strap_snag', c);
    },
  }),
];

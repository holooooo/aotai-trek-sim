// Fictional strain/recovery scenes. None diagnoses illness or treats an injury.
import { ITEMS } from './items.js';
const choice = (id, label, sub, disabled = false) => ({ id, label, sub, disabled });
const ask = (g, id, who, text, choices) => g.storyDialog(id, { who, text, choices });
const mark = (g, id, value) => g.recordStory(id, value);
const food = (g) => Object.keys(g.st.inv).find(id => ITEMS[id]?.kind === 'food' && !ITEMS[id].alcohol && g.hasItem(id));
const companion = (g) => g.st.companions.find(id => g.st.npcs[id]?.following && !g.st.npcs[id].dead && g.st.npcs[id].cond > 20);
const outside = (g) => !g.st.camp?.inside;
const event = (id, stressMin, options) => ({
  id, stressMin, once: false, cooldown: 720, allowCamp: true, ambient: false, priority: 62, weight: 1,
  ...options,
  cond: (g) => g.st.body.stress >= stressMin && (!options.cond || options.cond(g)),
});

export const STRESS_EVENTS = [
  event('stress_checklist', 65, {
    optionIds: ['sort', 'read', 'continue'],
    async run(g) {
      const c = await ask(g, 'stress_checklist', '又摸了一遍侧袋', ['你记得东西就放在里面，手却又伸进侧袋确认了一次。刚拉好的扣带也想再拉一拉。', '每次检查都很短，合在一起却让你越来越难把注意力放回眼前。'], [
        choice('sort', '停下来，把眼下要用的东西集中放好', '会花12分钟和一点体力，天气仍照常变化'),
        choice('read', '用手机记一张简短的清单', '花4分钟和1格手机电量', g.st.bat.phone < 1),
        choice('continue', '先不整理，把注意力放回行程', '不花设备电量；仍要带着烦乱走一段'),
      ]);
      if (!c) return;
      if (c === 'sort') { if (!await g.eventPause(12)) return; g.changeBody('stamina', -2); g.changeBody('stress', -5); }
      else if (c === 'read') { if (!g.spendBattery('phone', 1) || !await g.eventPause(4)) return; g.changeBody('stress', -3); }
      else if (c === 'continue') { g.changeBody('stamina', -3); g.changeBody('stress', 3); }
      else return;
      mark(g, 'stress_checklist', c);
    },
  }),
  event('pain_focus', 60, {
    priority: 67, cooldown: 1080, optionIds: ['pause', 'repack', 'continue'],
    cond: (g) => g.st.body.fracture > 0 || g.st.body.sprain > 0 || g.st.body.frostbite >= 10,
    async run(g) {
      const c = await ask(g, 'pain_focus', '总绕回疼痛的念头', ['你在想下一段路，念头却又回到疼痛上。刚才还勉强放在一旁的担心，此刻显得很近。', '慢一点整理思绪也不会让伤势消失；继续行程，仍要面对身体的限制。'], [
        choice('pause', '先停10分钟，给接下来的事排个先后', '停留期间仍会散热、耗水；不会治疗伤势'),
        choice('repack', '用7分钟重新分放随手要用的东西', '会花一点体力，减少反复翻包的困扰'),
        choice('continue', '暂时不处理念头，继续当前安排', '不转移物资，但疼痛和消耗仍在'),
      ]);
      if (!c) return;
      if (c === 'pause') { if (!await g.eventPause(10)) return; g.changeBody('stress', -4); }
      else if (c === 'repack') { if (!await g.eventPause(7)) return; g.changeBody('stamina', -3); g.changeBody('stress', -2); }
      else if (c === 'continue') { g.changeBody('stamina', -5); g.changeBody('stress', 4); }
      else return;
      mark(g, 'pain_focus', c);
    },
  }),
  event('stress_recheck', 70, {
    priority: 64, cooldown: 900, optionIds: ['gps', 'notes', 'walk'],
    cond: (g) => outside(g) && (g.st.flags.lost || g.foggy()),
    async run(g) {
      const canGps = g.hasItem('gps') && g.st.bat.gps >= 3;
      const c = await ask(g, 'stress_recheck', '同一段轨迹看了三遍', ['你把刚才的判断从头想了一遍，还是不能确信。屏幕上的线并没有因为反复查看而变得更清楚。', '现在得到的新信息，和为了安心而重复的动作，已经有些难分。'], [
        choice('gps', '站在原处，完整核对一次定位资料', '花10分钟和3格GPS电量；仍要自己确认路线', !canGps),
        choice('notes', '先把能确认和不能确认的事分开记下', '花6分钟和1格手机电量；不会补出缺失的坐标', g.st.bat.phone < 1),
        choice('walk', '收起资料，先继续眼下的安排', '不再使用设备，疑虑还会留着'),
      ]);
      if (!c) return;
      if (c === 'gps') {
        if (!canGps || !g.spendBattery('gps', 3) || !await g.eventPause(10)) return;
        g.st.story.effects.navigationCheckedUntil = g.st.time + 90;
        g.changeBody('stress', -4);
      } else if (c === 'notes') { if (!g.spendBattery('phone', 1) || !await g.eventPause(6)) return; g.changeBody('stress', -2); }
      else if (c === 'walk') { g.changeBody('stamina', -4); g.changeBody('stress', 3); }
      else return;
      mark(g, 'stress_recheck', c);
    },
  }),
  event('stress_ration', 55, {
    priority: 63, optionIds: ['eat', 'water', 'later'],
    cond: (g) => g.st.body.food < 35 || g.st.body.water < 35,
    async run(g) {
      const item = food(g);
      const c = await ask(g, 'stress_ration', '空腹时的小事', ['一点拉链声都让你烦躁。你想催自己快点，可嘴里发干，胃里也空着。', '身上的储备和包里的储备是两回事。吃喝要动用后面的余量，不吃不喝也有代价。'], [
        choice('eat', '拿出一份口粮，留8分钟吃一点', '会消耗这一份现有食物', !item),
        choice('water', '花4分钟喝一点杯里的水', '会减少保温杯储备，不会自动补满水瓶', g.st.thermos.l < 0.05),
        choice('later', '把这些留到下一次停下来时', '不使用物资，当前饥渴仍会继续'),
      ]);
      if (!c) return;
      if (c === 'eat') {
        if (!item || !g.hasItem(item)) return;
        g.eat(item);
        if (g.over || !await g.eventPause(8)) return;
        g.changeBody('stress', -2);
      } else if (c === 'water') {
        if (g.st.thermos.l < 0.05) return;
        g.drinkThermos();
        if (g.over || !await g.eventPause(4)) return;
        g.changeBody('stress', -1);
      } else if (c === 'later') g.changeBody('stress', 3);
      else return;
      mark(g, 'stress_ration', c);
    },
  }),
  event('stress_company', 65, {
    priority: 61, cooldown: 1080, optionIds: ['talk', 'voice', 'quiet'],
    async run(g) {
      const other = companion(g);
      const c = await ask(g, 'stress_company', '一句还没说出口的话', ['有些担心一直在脑子里转，却还没有变成完整的一句话。你想把它说出来，又担心说完也改变不了什么。', other ? '同行的人还在附近收拾东西。交谈会占用两个人的停留时间。' : '身边暂时没有同行的人。手机可以留下一段声音，但不会替你把话传到山下。'], [
        choice('talk', '请同行的人听你说一会儿', '一起停12分钟；不会替对方恢复体力', !other),
        choice('voice', '录下几句话，暂时留在本机', '花6分钟和2格手机电量，不会发送消息', g.st.bat.phone < 2),
        choice('quiet', '先安静3分钟，稍后再说', '短暂停留，仍要面对天气与身体消耗'),
      ]);
      if (!c) return;
      if (c === 'talk') {
        if (!other || !companion(g) || !await g.eventPause(12)) return;
        g.changeBody('stress', -6);
      } else if (c === 'voice') { if (!g.spendBattery('phone', 2) || !await g.eventPause(6)) return; g.changeBody('stress', -4); }
      else if (c === 'quiet') { if (!await g.eventPause(3)) return; g.changeBody('stress', -1); }
      else return;
      mark(g, 'stress_company', c);
    },
  }),
  event('restless_shelter', 55, {
    priority: 60, cooldown: 1440, optionIds: ['sleep', 'sort', 'wait'],
    cond: (g) => !!g.st.camp?.inside && !g.st.camp.bivy && !g.st.camp.collapsed && g.st.camp.health > 0 && g.st.body.core >= 35.6,
    async run(g) {
      const c = await ask(g, 'restless_shelter', '帐篷里还停不下来的念头', ['人已经停下，脑子却还在走路。你躺着想了很久，连下一次醒来时要做什么也提前想了一遍。', '如果睡得暖、吃喝也够，时间能让精神缓过来一些。挨冻和饥渴不会因为闭上眼睛就停止。'], [
        choice('sleep', '把这段时间留给睡眠', '按当前营地作息睡一段；天气照常变化，睡眠不会治伤'),
        choice('sort', '先花15分钟整理明早要用的东西', '保持清醒，整理会消耗一点体力'),
        choice('wait', '暂不入睡，再安静待10分钟', '会占用时间，也不会替你补充食物和水'),
      ]);
      if (!c) return;
      if (c === 'sleep') { mark(g, 'restless_shelter', c); await g.sleep(); return; }
      if (c === 'sort') { if (!await g.eventPause(15)) return; g.changeBody('stamina', -2); g.changeBody('stress', -5); }
      else if (c === 'wait') { if (!await g.eventPause(10)) return; g.changeBody('stress', -2); }
      else return;
      mark(g, 'restless_shelter', c);
    },
  }),
];

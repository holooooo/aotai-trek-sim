// Entirely fictional encounters. No character is a real missing person or a rescue guarantee.
const pause = (g, minutes) => g.eventPause(minutes);
const food = (g) => ['bar', 'biscuit', 'chocolate'].find((id) => g.hasItem(id));
const mark = (g, id, value) => g.recordStory(`npc_${id}_choice`, value);
const depart = (g, npc, fate, dir = 1) => { g.setFate(npc.id, fate); g.walkAway(npc.id, dir); };
const choice = (id, label, sub, disabled = false) => ({ id, label, sub, disabled });
const person = (id, data) => ({
  id, age: '虚构人物', path: 'main', pose: 'stand', side: 2.4, speed: 0.85,
  encounterChance: 0.7, ...data,
});

export const EXTRA_NPCS = [
  person('linqiao', {
    name: '林桥', age: '28岁', fromKm: 6.5, toKm: 15,
    look: { jacket: 0xc77b43, pants: 0x40464a, hat: 0x577969, pack: 0x464848 },
    optionIds: ['photo', 'trade', 'leave'],
    fates: {
      portrait: '林桥收好了相机。你手机里留下了一张两个人都被风吹眯了眼的照片；这不是他后续行程的记录。',
      traded: '你们交换了随身口粮。他沿自己的计划走开，此后没有新的消息。',
      parted: '林桥向你挥手，你们没有继续攀谈。后来是否下撤，你并不知道。',
    },
    async meet(g, npc) {
      const c = await g.dialog({
        who: '林桥', sub: '相机上贴着一条褪色的胶带',
        text: ['他把相机藏回衣服里：“电池又罢工了。能不能用你的手机给我拍一张？不用走到边缘，就站这儿。”', '他又摸出两包饼干：“或者换点别的吃的？一路都吃这个，腻了。”'],
        choices: [
          choice('photo', '用手机拍下此刻', '要停下来取出手机，会用掉一点电', g.st.bat.phone < 2),
          choice('trade', '用一根能量棒交换饼干', '你要交出随身的一根能量棒', !g.hasItem('bar')),
          choice('leave', '和他道别，继续自己的行程', '相机的事留给他自己处理'),
        ],
      });
      if (!c) return;
      if (c === 'photo') {
        if (!g.spendBattery('phone', 2) || !await pause(g, 6)) return;
        g.changeBody('stress', -4); mark(g, npc.id, c); depart(g, npc, 'portrait');
      } else if (c === 'trade') {
        if (!g.takeItem('bar')) return;
        if (!await pause(g, 4)) return;
        g.giveItem('biscuit', 2); mark(g, npc.id, c); depart(g, npc, 'traded');
      } else if (c === 'leave') {
        g.changeBody('stress', 1); mark(g, npc.id, c); depart(g, npc, 'parted');
      }
    },
  }),
  person('heyan', {
    name: '何雁', age: '35岁', fromKm: 18, toKm: 32, pose: 'sit', speed: 0.78,
    look: { jacket: 0x588393, pants: 0x424555, hat: 0xc0b695, pack: 0x765747 },
    optionIds: ['tape', 'together', 'leave'],
    fates: {
      patched: '你们一起缠好了背包扣环。那圈胶带能撑多久，你无法知道；何雁继续了她自己的行程。',
      following: '何雁暂时和你同行。你们都还需要管理自己的体力与物资。',
      survived: '何雁和你一起结束了这段山路。她拆掉背包上卷翘的胶带，说要把扣环留下来。',
      rescued: '救援接应了你们。何雁背包上的扣环仍用胶带缠着。',
      died: '何雁没能和你一起走出这段山路。同行并没有抵消风雪和消耗。',
      parted: '何雁还在整理背包，你已离开。你没有听到她后来的消息。',
    },
    async meet(g, npc) {
      const c = await g.dialog({
        who: '何雁', sub: '背包腰带的一边松脱了',
        text: ['她把包放在膝上，试着把裂开的扣环重新卡住：“刚才搬包时听见响了一声。”', '她不认识前面的其他人。你们能一起商量的，只有眼下这段路。'],
        choices: [
          choice('tape', '拿出急救包里的胶带，一起缠一缠', '会用掉一份急救包并停留一阵', !g.hasItem('firstaid')),
          choice('together', '帮她整理背包，暂时结伴', '需要花力气收拾；之后两个人都要维持体力'),
          choice('leave', '说明自己也要赶路，先行离开', '不转移物资，也不承诺稍后会合'),
        ],
      });
      if (!c) return;
      if (c === 'tape') {
        if (!g.takeItem('firstaid') || !await pause(g, 12)) return;
        g.npcCond(npc.id, 5); mark(g, npc.id, c); depart(g, npc, 'patched');
      } else if (c === 'together') {
        if (!await pause(g, 8)) return;
        g.changeBody('stamina', -3); g.recruit(npc.id); g.setFate(npc.id, 'following'); mark(g, npc.id, c);
      } else if (c === 'leave') {
        g.changeBody('stress', 2); mark(g, npc.id, c); depart(g, npc, 'parted');
      }
    },
  }),
  person('luomo', {
    name: '罗默', age: '42岁', fromKm: 43, toKm: 59, encounterChance: 0.64,
    look: { jacket: 0x888356, pants: 0x333d44, hat: 0x804e49, pack: 0x506579 },
    optionIds: ['listen', 'swap', 'leave'],
    fates: {
      listened: '罗默说完了没能在电话里讲完的故事。你记得那个名字，却没有得到他之后的消息。',
      traded: '一包巧克力换成了能量棒。罗默把包装纸折好收回口袋，和你分开走了。',
      parted: '你们只互相点了点头。山风很快吞没了他的脚步声。',
    },
    async meet(g, npc) {
      const c = await g.dialog({
        who: '罗默', sub: '他把一本小画册包在透明袋里',
        text: ['“是我女儿画的。”他指着一只歪歪扭扭的蓝色鸟，像是在等你问下一句。', '你看了看天色。听一个人的故事，也会占用山上的时间。'],
        choices: [
          choice('listen', '留一会儿，听他说完', '会在原处停留，天气和身体照常变化'),
          choice('swap', '把巧克力换成他的一根能量棒', '交换一份食物，之后各自赶路', !g.hasItem('chocolate')),
          choice('leave', '祝他一路顺利，告辞', '不再停留，也不认识他计划中的下一站'),
        ],
      });
      if (!c) return;
      if (c === 'listen') {
        if (!await pause(g, 15)) return;
        g.changeBody('stress', -7); mark(g, npc.id, c); depart(g, npc, 'listened');
      } else if (c === 'swap') {
        if (!g.takeItem('chocolate') || !await pause(g, 3)) return;
        g.giveItem('bar'); mark(g, npc.id, c); depart(g, npc, 'traded');
      } else if (c === 'leave') {
        g.changeBody('stress', 1); mark(g, npc.id, c); depart(g, npc, 'parted');
      }
    },
  }),
  person('qiaoan', {
    name: '乔安', age: '31岁', fromKm: 66, toKm: 82, pose: 'sit',
    look: { jacket: 0xa65c76, pants: 0x3b4249, hat: 0xc4b797, pack: 0x6d7a55 },
    optionIds: ['message', 'water', 'leave'],
    fates: {
      messaged: '你借手机发出了一条乔安口述的消息。这只说明消息已发送，不说明她后来到了哪里。',
      shared: '乔安把空杯子还给你，杯口留了一圈水汽。此后你没有再遇见她。',
      parted: '乔安把手机收回衣袋。你不知道她后来有没有联系上家里。',
    },
    async meet(g, npc) {
      const canMessage = g.signal() > 0 && !g.st.airplane && g.st.bat.phone >= 3;
      const c = await g.dialog({
        who: '乔安', sub: '手机屏幕上只亮起一个电池图标',
        text: ['“我的手机开不了机了。能借你手机发一句话吗？就说我今天会晚一点，具体到哪儿再联系。”', '她低声把要说的话念了一遍，又停下来，看着你手里的手机。'],
        choices: [
          choice('message', '借手机，让她给家里留句话', '需要当前信号和手机电量；不是向救援机构报警', !canMessage),
          choice('water', '先分一点保温杯里的水', '会减少你自己的热水储备', g.st.thermos.l < 0.25 || g.st.thermos.temp <= 40),
          choice('leave', '说明自己的余量，先行离开', '她还要自行处理通信与储备'),
        ],
      });
      if (!c) return;
      if (c === 'message') {
        if (!canMessage || !g.spendBattery('phone', 3) || !await pause(g, 6)) return;
        g.changeBody('stress', -3); mark(g, npc.id, c); depart(g, npc, 'messaged');
      } else if (c === 'water') {
        if (g.st.thermos.l < 0.25 || g.st.thermos.temp <= 40) return;
        g.st.thermos.l -= 0.25;
        if (!await pause(g, 4)) return;
        g.npcCond(npc.id, 8); mark(g, npc.id, c); depart(g, npc, 'shared');
      } else if (c === 'leave') {
        g.changeBody('stress', 2); mark(g, npc.id, c); depart(g, npc, 'parted');
      }
    },
  }),
  person('suyan', {
    name: '苏砚', age: '26岁', fromKm: 92, toKm: 106, encounterChance: 0.66, speed: 0.8,
    look: { jacket: 0x927258, pants: 0x34424a, hat: 0x4f7f82, pack: 0x884b4b },
    optionIds: ['together', 'food', 'leave'],
    fates: {
      following: '苏砚收起写了一半的纸页，暂时加入了你的行程。',
      survived: '苏砚和你一起走出了山路。那张纸页最后一行只写了日期。',
      rescued: '你们等到了接应。苏砚把那张皱纸收进外套，先腾出手来。',
      died: '苏砚没能走到这段行程的终点。纸页没有替她挡住寒冷。',
      shared: '你把食物递给苏砚。你们在这里分开，之后没有新消息。',
      parted: '苏砚仍在收拾自己的东西。你继续往前，没有约定会合。',
    },
    async meet(g, npc) {
      const ration = food(g);
      const c = await g.dialog({
        who: '苏砚', sub: '纸页上写着几个被划掉的目的地',
        text: ['“出发前写的计划，”她把纸翻过来，“现在只剩下一件事一件事处理。”', '她想找人暂时同行，但没有人能替另一人负担整段路。'],
        choices: [
          choice('together', '帮她收好东西，暂时同行', '会花时间和体力；同行后仍需分配储备'),
          choice('food', '留给她一份随身食物，自己先走', '你的食物会减少', !ration),
          choice('leave', '各自收拾，照原来的节奏走', '不转移物资，也不承诺会合'),
        ],
      });
      if (!c) return;
      if (c === 'together') {
        if (!await pause(g, 7)) return;
        g.changeBody('stamina', -4); g.recruit(npc.id); g.setFate(npc.id, 'following'); mark(g, npc.id, c);
      } else if (c === 'food') {
        if (!ration || !g.takeItem(ration) || !await pause(g, 4)) return;
        g.npcCond(npc.id, 10); mark(g, npc.id, c); depart(g, npc, 'shared');
      } else if (c === 'leave') {
        g.changeBody('stress', 2); mark(g, npc.id, c); depart(g, npc, 'parted');
      }
    },
  }),
];

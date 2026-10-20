// 路遇驴友。人物均为化名或虚构，情节改编自公开报道与"神秘园"系列视频讲述的事件，仅用于安全警示。
// 每个 NPC 的 meet(g, npc) 是一段异步剧情，g 为游戏接口（见 sim/game.js 中的 NpcApi）。

export const NPCS = [
  {
    id: 'speedteam',
    name: '速通四人组',
    age: '19–30岁',
    looks: [
      { jacket: 0x222222, pants: 0x333333, hat: 0xbb2222, pack: 0x3a6ea5 },
      { jacket: 0xe0e0e0, pants: 0x444444, hat: 0x222222, pack: 0x222222 },
      { jacket: 0x9c27b0, pants: 0x2b2b2b, hat: 0xffffff, pack: 0x555555 },
      { jacket: 0x2e7d32, pants: 0x1f1f1f, hat: 0x333333, pack: 0x795548 },
    ],
    pose: 'stand',
    path: 'main', fromKm: 3.5, toKm: 7.5, side: 2.5,
    speed: 1.0,
    fates: {
      safe: '他们在林子里犹豫了很久，最后掉头下了山。那天晚上，他们在县城吃了烤串。',
      warned: '他们没有回头，但关掉了飞行模式。第二天下午，其中一人的求救电话被准确定位，救援队赶在天黑前找到了他们。',
      danger: '你再也没有见过他们。后来你在新闻里看到：一支轻装进山、开着飞行模式的队伍，在山上遇到了降雪降温……',
      helped: '你在药王洞把掉队的男生裹进了自己的装备里，等到了救援。',
      died: '掉队的男生没能等到天亮。',
    },
    async meet(g, npc) {
      const c = await g.dialog({
        who: '速通四人组', sub: '四个年轻人，背着二三十升的小包',
        text: [
          '"哥们儿也去小鳌太？我们打算今天一天穿过去，晚上下山吃烧烤！"',
          '你注意到他们只背着一日轻装包，没有帐篷，也没有睡袋。领头的男生晃了晃手机："都开飞行模式了，免得被定位罚款。"',
        ],
        choices: [
          { id: 'persuade', label: '和他们聊聊是否继续走', sub: '谈谈装备、天气和这条线的情况' },
          { id: 'warn', label: '聊聊手机的联络方式', sub: '把自己的顾虑告诉他们' },
          { id: 'leave', label: '各走各的', sub: '不介入他们的安排' },
        ],
      });
      if (c === 'persuade') {
        const p = g.persuadeChance(0.45);
        await g.passTime(15);
        if (g.roll(p)) {
          g.setFate(npc.id, 'safe');
          g.addStress(-8);
          await g.say('速通四人组', ['你说了很久。说到夜里零下二十多度、说到2026年元旦那支同样开着飞行模式的队伍。', '他们沉默了一会儿。"……算了，回去吧，去景区吃根烤肠。"', '四个人转身下山了。'], '目送他们离开');
          g.despawn(npc.id);
          return;
        }
        await g.say('速通四人组', ['"没事的哥，我们查过天气了，明天才降温。"', '他们笑着摆摆手，先走了。'], '……');
        g.setFate(npc.id, 'danger');
      } else if (c === 'warn') {
        g.setFate(npc.id, g.roll(0.7) ? 'warned' : 'danger');
        await g.say('速通四人组', ['"行吧行吧。"有人嘟囔着把飞行模式关了。', '他们加快脚步走在了你前面。'], '继续');
      } else {
        g.setFate(npc.id, 'danger');
        g.addStress(3);
      }
      g.walkAway(npc.id);
    },
  },
  {
    id: 'straggler',
    name: '掉队的男生',
    age: '20岁',
    look: { jacket: 0xe0e0e0, pants: 0x444444, hat: 0x222222, pack: 0x222222 },
    pose: 'sit',
    path: 'main', fromKm: 20, toKm: 26, side: 3,
    requires: (g) => g.fate('speedteam') === 'danger' || g.fate('speedteam') === 'warned',
    speed: 0.7,
    fates: {
      helped: '你在石洞里陪他熬过了那一夜。救援队找到你们时，他还能自己站起来。',
      rescued: '你发出的坐标让救援队直奔药王洞。他被直升机接下了山。',
      followed: '他跟着你一路走到了下撤点，活了下来。',
      died: '你离开后，他在石头后面蜷了一夜。后来的搜救报告里写着：失温。',
    },
    async meet(g, npc) {
      g.addStress(10);
      const c = await g.dialog({
        who: '掉队的男生', sub: '速通四人组里的一个',
        text: [
          '他缩在一块大石头后面，嘴唇发紫，手指已经不太能弯。',
          '"他们……他们说前面有个营地，让我在这儿等……"他的卫衣湿透了，冻得硬邦邦的。',
          g.isNurse() ? '【护士】他说话含糊、动作迟缓，寒战已经很微弱——中度失温。必须马上保温，不能让他再走动消耗。' : '他抖得越来越轻了。你不确定这是好事还是坏事。',
        ],
        choices: [
          { id: 'warm', label: '先帮他把身上捂暖', sub: (g.st.warmers > 0 || g.hasItem('blanket') || (g.st.thermos.l >= 0.25 && g.st.thermos.temp > 40)) ? '会消耗手边可用的保暖物资' : '你没有多余的保暖物资' },
          { id: 'sos', label: '发送他的求救坐标', sub: g.commsLabel(), disabled: !g.comms().any },
          { id: 'take', label: '扶他一起走', sub: '速度会变慢，你们需要一起找下撤点' },
          { id: 'leave', label: '从他身边离开，继续走', sub: '留下他在原处，自己继续前进' },
        ],
      });
      if (c === 'warm' || c === 'take' || c === 'sos') {
        const w = g.warmNpc(npc.id);
        if (c === 'warm' && !w) await g.say('掉队的男生', ['你翻遍了背包，没有多余的保暖物资。'], '……');
      }
      if (c === 'sos') {
        const r = await g.sos({ forNpc: npc.id });
        if (r.ok) {
          g.setFate(npc.id, 'rescued');
          const c2 = await g.dialog({ who: '掉队的男生', text: ['求救已发出。救援队需要时间。', '你可以陪他等，也可以把物资留给他，自己继续。'],
            choices: [{ id: 'stay', label: '留下来陪他等', sub: '需要一起安排原地停留，等待救援' }, { id: 'go', label: '把物资留下，自己继续走' }] });
          if (c2 === 'stay') { g.recruit(npc.id); g.st.rescue.withNpc = npc.id; return; }
          g.warmNpc(npc.id);
          g.despawn(npc.id, false);
          return;
        }
      }
      if (c === 'take' || c === 'warm') {
        g.recruit(npc.id);
        g.setFate(npc.id, 'followed');
        g.toast('他跟上了你。照顾好他：给他热水和吃的。', 'info');
        return;
      }
      if (c === 'leave') {
        g.setFate(npc.id, 'died');
        g.addStress(18);
        g.despawn(npc.id, false);
      }
    },
  },
  {
    id: 'mou',
    name: '小牟',
    age: '22岁',
    look: { jacket: 0x1565c0, pants: 0x263238, hat: 0xff8f00, pack: 0x37474f },
    pose: 'stand',
    path: 'main', fromKm: 29, toKm: 34, side: 2.2,
    speed: 1.05,
    fates: {
      safe: '小牟后来平安下山了。他说，那趟之后再也没去过鳌太。',
      together: '你和小牟一起原路撤回了塘口。下山的路上，他一直在说那个坐在雪里的大哥。',
    },
    async meet(g, npc) {
      const forecast = g.forecastText();
      const c = await g.dialog({
        who: '小牟', sub: '22岁，深圳人，迎面走来的年轻驴友',
        text: [
          '一个背大包的年轻人迎面走来，帽檐上全是霜。',
          '"兄弟，前面飞机梁风大得站不住，我撤了。"他指指身后，"刚才路过一个大哥，坐在雪里歇着，我帮他把帐篷搭上了，留了点吃的……他说歇一晚就好。"',
        ],
        choices: [
          { id: 'ask', label: '问问前面的情况' },
          { id: 'together', label: '和他一起往回走', sub: '需要沿来路返回塘口' },
          { id: 'trade', label: '问他手头有什么可以交换', sub: '看他现有余量，也要看你们如何分配' },
          { id: 'go', label: '道别，继续往前' },
        ],
      });
      if (c === 'ask') {
        await g.say('小牟', [`"${forecast}"`, '"实在不行就到2800营地往南坡下，那边有林子，能挡风。千万别在山梁上硬扛。"'], '记下了');
        g.flags.knowsBailout = true;
        return npc.def.meetAgain(g, npc);
      }
      if (c === 'trade') {
        const got = g.npcGiveSupply();
        await g.say('小牟', [got ? `他二话没说，从包里掏出${got}塞给你。"出门在外，互相帮一把。"` : '"我这儿也不多了，你先顾好自己。"'], '谢谢');
        return npc.def.meetAgain(g, npc);
      }
      if (c === 'together') {
        g.recruit(npc.id);
        g.setFate(npc.id, 'together');
        g.retreat('back');
        g.addStress(-12);
        g.toast('你决定和小牟一起原路下撤。下撤不丢人。', 'good');
        return;
      }
      g.setFate(npc.id, 'safe');
      await g.say('小牟', ['"兄弟，保重。要是看到那个大哥，劝劝他。"'], '保重');
      g.walkAway(npc.id, -1);
    },
    async meetAgain(g, npc) {
      const c = await g.dialog({
        who: '小牟', text: ['"还有什么要问的？"'],
        choices: [
          { id: 'together', label: '和他一起往回走', sub: '需要沿来路返回' },
          { id: 'go', label: '道别，继续往前' },
        ],
      });
      if (c === 'together') {
        g.recruit(npc.id);
        g.setFate(npc.id, 'together');
        g.retreat('back');
        g.addStress(-12);
        g.toast('你决定和小牟一起原路下撤。下撤不丢人。', 'good');
        return;
      }
      g.setFate(npc.id, 'safe');
      g.walkAway(npc.id, -1);
    },
  },
  {
    id: 'wu',
    name: '老吴',
    age: '53岁',
    look: { jacket: 0x8d6e63, pants: 0x37474f, hat: 0x5d4037, pack: 0x455a64, skin: 0xcfa27e },
    pose: 'sit',
    path: 'main', fromKm: 35, toKm: 44, side: 2.5,
    speed: 0.6,
    tentNearby: true,
    fates: {
      died: '老吴没能撑过那一夜。他的保温杯里还是满的——那壶热水，他一直没舍得喝。',
      rescued: '救援队顶着风雪在第二天中午找到了老吴。他在医院里住了半个月。',
      survived: '你们一起走到了2800营地。老吴在林子里喝下一杯热水，哭了。',
    },
    async meet(g, npc) {
      g.addStress(8);
      let warmed = false;
      for (let round = 0; round < 3; round++) {
        const c = await g.dialog({
          who: '老吴', sub: '53岁，郑州人，独自坐在雪里',
          text: round === 0 ? [
            '一个五十多岁的大哥坐在雪里，背靠着刚搭好的帐篷。他说话很慢："没事……我歇一会儿就好。"',
            '他的保温杯挂在背包外侧，杯盖结了一层霜——一直没打开过。',
            g.isNurse() ? '【护士】他已经不怎么发抖了，反应迟钝——中度失温的征兆。这时候他自己判断不了自己的状况。' : '他的眼神有点发直。',
          ] : ['老吴靠着帐篷，眼睛半闭着。'],
          choices: [
            { id: 'thermos', label: '打开他的保温杯', sub: warmed ? '杯子已经打开过' : '里面的水还可能有温度', disabled: warmed },
            { id: 'persuade', label: '请他和你一起往回走', sub: '需要重新安排两个人的速度和路线' },
            { id: 'sos', label: '替他尝试发出求救', sub: g.commsLabel(), disabled: !g.comms().any },
            { id: 'leave', label: '用手边的保暖物资帮他整理，自己继续走', sub: '会消耗可用的保温物资，不带他同行' },
          ],
        });
        if (c === 'thermos') {
          warmed = true;
          g.npcCond(npc.id, 25);
          await g.say('老吴', ['你拧开杯盖，热气冒了出来。老吴捧着杯子喝了几口，手抖得厉害，眼神慢慢有了点焦点。', '"……还是热的。"'], '继续');
          continue;
        }
        if (c === 'persuade') {
          const p = g.persuadeChance(warmed ? 0.55 : 0.35);
          await g.passTime(20);
          if (g.roll(p)) {
            g.recruit(npc.id);
            g.setFate(npc.id, 'following');
            await g.say('老吴', ['老吴盯着你看了很久，终于撑着登山杖站了起来。', '"……行，听你的。"', '他走得很慢。去2800营地的路还很长。'], '出发');
            return;
          }
          await g.say('老吴', ['"不用不用，我休息好了，明天自己走。"他摆摆手，钻进了帐篷。'], '……');
          continue;
        }
        if (c === 'sos') {
          const r = await g.sos({ forNpc: npc.id });
          if (r.ok) {
            g.setFate(npc.id, 'rescued');
            g.warmNpc(npc.id);
            await g.say('老吴', ['坐标发出去了。你把一片暖宝宝贴在他后背，帮他钻进睡袋。', '"谢谢你啊，小伙子。"'], '继续');
            g.despawn(npc.id, false);
            return;
          }
          continue;
        }
        if (c === 'leave') {
          g.warmNpc(npc.id);
          g.setFate(npc.id, 'died');
          g.addStress(12);
          await g.say('老吴', ['你把一些吃的放在他的帐篷门口。他点点头，钻进了帐篷。', '风越来越大了。'], '离开');
          g.despawn(npc.id, false);
          return;
        }
      }
      g.setFate(npc.id, 'died');
      g.addStress(10);
      g.despawn(npc.id, false);
    },
  },
  {
    id: 'boy',
    name: '石缝里的少年',
    age: '18岁',
    look: { jacket: 0x0d47a1, pants: 0x212121, hat: 0x9e9e9e, pack: null },
    pose: 'lie',
    path: 'main', fromKm: 46, toKm: 52, side: 9,
    speed: 0.55,
    calls: true,
    fates: {
      rescued: '他在医院里接上了骨折的手。后来他说，最难熬的不是冷，是不知道有没有人会来。',
      survived: '你们一起走出了山。他的父母在山下等了十天。',
      died: '你离开时听见他在喊什么。风太大，你没听清。',
      helped: '你给他固定了手臂、留下了食物。几天后，搜救队在2800营地附近找到了他。',
    },
    async meet(g, npc) {
      g.addStress(10);
      const c = await g.dialog({
        who: '石缝里的少年', sub: '18岁，独自穿越，失联第9天',
        text: [
          '石缝里缩着一个十八九岁的男孩，右手不自然地垂着，背包不见了。',
          '他盯着你看了很久："你……是真的人吗？"',
          '"我的充电宝第四天就冻死机了……滑坠的时候包摔破了，吃的全没了。我吃了两天牙膏。"',
        ],
        choices: [
          { id: 'aid', label: '查看能否处理他的手臂', sub: g.hasItem('firstaid') ? '使用急救包固定手臂' : '没有急救包，只能用登山杖和绳子凑合', },
          { id: 'feed', label: '分给他一些吃的和喝的', sub: g.feedLabel() },
          { id: 'sos', label: '发送他的求救坐标', sub: g.commsLabel(), disabled: !g.comms().any },
          { id: 'leave', label: '先离开石缝', sub: '自己继续安排路程' },
        ],
      });
      if (c === 'leave') {
        g.setFate(npc.id, 'died');
        g.addStress(22);
        g.despawn(npc.id, false);
        return;
      }
      if (c === 'aid') {
        const ok = g.treatNpc(npc.id);
        await g.say('石缝里的少年', [ok ? '你用夹板把他的手臂固定好。他疼得直抽气，但眼神清醒了些。' : '你用登山杖和背包带勉强固定住了他的手臂。'], '继续');
      }
      if (c === 'feed') {
        const f = g.feedNpc(npc.id);
        await g.say('石缝里的少年', [f ? `他几乎是抢过${f}，狼吞虎咽。` : '你没有多余的食物了。'], '继续');
      }
      if (c === 'sos') {
        const r = await g.sos({ forNpc: npc.id });
        if (r.ok) {
          g.setFate(npc.id, 'rescued');
          const c2 = await g.dialog({ who: '石缝里的少年', text: ['坐标已发出。救援队知道要来2800营地附近找人了。'],
            choices: [{ id: 'stay', label: '留在这里陪他等' }, { id: 'go', label: '留下物资，自己继续走' }] });
          if (c2 === 'stay') { g.recruit(npc.id); g.st.rescue.withNpc = npc.id; return; }
          g.feedNpc(npc.id); g.warmNpc(npc.id);
          g.despawn(npc.id, false);
          return;
        }
      }
      const c3 = await g.dialog({
        who: '石缝里的少年', text: ['"你能……带我出去吗？"'],
        choices: [
          { id: 'take', label: '带他一起往前走', sub: '需要一起寻找能下撤的路线' },
          { id: 'leave2', label: '留下食物，让他自己决定去留', sub: '他需要自行选择停在原处还是继续移动' },
        ],
      });
      if (c3 === 'take') {
        g.recruit(npc.id);
        g.setFate(npc.id, 'following');
        g.toast('他跟上了你。他走得很慢。', 'info');
      } else {
        g.feedNpc(npc.id);
        g.setFate(npc.id, 'helped');
        g.despawn(npc.id, false);
      }
    },
  },
  {
    id: 'chen',
    name: '老陈',
    age: '50岁',
    look: { jacket: 0x6d4c41, pants: 0x3e2723, hat: 0x424242, pack: 0x5d4037, skin: 0xbf9270 },
    pose: 'sit',
    path: 'hetaoping', fromKm: 2, toKm: 5, side: 3.5,
    speed: 0.6,
    fates: {
      survived: '老陈被送进医院时，体重掉了二十多斤。他说，林子里那些烂野果，他一辈子都不会忘。',
      rescued: '救援队在林子里找到了老陈。被困第九天，他活下来了。',
      died: '你走后的第三天，林子里又下了一场雪。',
      helped: '你留下的食物撑到了救援队到来。',
    },
    async meet(g, npc) {
      g.addStress(8);
      const c = await g.dialog({
        who: '老陈', sub: '被困林中第八天',
        text: [
          '树下坐着一个瘦得脱了相的男人，胡子上挂着冰碴。他手里攥着一个空了的腐乳瓶。',
          '"我……在这儿第八天了。"他嗓子哑得厉害，"跟我一起上山的老吴……你在山上见过他吗？"',
          '他靠吃烂掉的野果、树叶，还有一瓶过期的腐乳活到了现在。',
        ],
        choices: [
          { id: 'feed', label: '分给他一些吃的和水', sub: g.feedLabel() },
          { id: 'take', label: '扶他一起往林道下方走', sub: '需要一起沿林道寻找下撤方向' },
          { id: 'sos', label: '发送他的求救坐标', sub: g.commsLabel(), disabled: !g.comms().any },
          { id: 'leave', label: '记下位置，先继续下撤', sub: '信息需要在有条件时再转交' },
        ],
      });
      if (g.fate('wu')) {
        const wuFate = g.fate('wu');
        await g.say('老陈', [wuFate === 'survived' || wuFate === 'rescued' ? '你告诉他，老吴得救了。老陈愣了很久，然后捂着脸笑出了声。' : '你没有说话。老陈看着你的表情，什么都明白了。'], '……');
      }
      if (c === 'feed') {
        const f = g.feedNpc(npc.id);
        await g.say('老陈', [f ? `他捧着${f}，手抖得几乎拿不住。` : '你的包里已经没有能分出去的东西了。'], '继续');
        g.recruit(npc.id);
        g.setFate(npc.id, 'following');
        return;
      }
      if (c === 'take') {
        g.recruit(npc.id);
        g.setFate(npc.id, 'following');
        return;
      }
      if (c === 'sos') {
        const r = await g.sos({ forNpc: npc.id });
        if (r.ok) { g.setFate(npc.id, 'rescued'); g.feedNpc(npc.id); g.despawn(npc.id, false); return; }
      }
      g.setFate(npc.id, 'reportLater');
      g.flags.reportChen = true;
      g.addStress(10);
      g.despawn(npc.id, false);
    },
  },
  {
    id: 'yu',
    name: '小雨',
    age: '26岁',
    look: { jacket: 0xd81b60, pants: 0x263238, hat: 0xffffff, pack: 0x5c6bc0 },
    pose: 'sit',
    path: 'main', fromKm: 74, toKm: 79, side: 4,
    speed: 0.75,
    collapsedTent: true,
    fates: {
      rescued: '你发出的坐标让救援队少绕了一整天。小雨被接下山时，一直抱着阿峰的登山杖。',
      followed: '你带着小雨走到了大爷海。她在工作人员的小屋里，终于哭出了声。',
      waited: '她在原地守了一天一夜。她报出的位置偏了好几公里，救援队顶着暴雨找了很久，最后在2800营地接到了她。',
    },
    async meet(g, npc) {
      g.addStress(16);
      const c = await g.dialog({
        who: '小雨', sub: '和男友结伴穿越',
        text: [
          '营地边有一顶被雪压塌了一半的帐篷。一个女孩跪在帐篷外，声音已经哭哑了。',
          '"他昨晚一直说冷……早上就叫不醒了。"',
          '"我报了警，可是我说不清我们在哪儿……我说的地名，他们说对不上。"',
          g.isNurse() ? '【护士】你探了帐篷里那个男人的颈动脉。已经没有了。' : '帐篷里的人一动不动。',
        ],
        choices: [
          { id: 'coord', label: '把当前位置发给救援队', sub: g.commsLabel(), disabled: !g.comms().any },
          { id: 'take', label: '陪她沿路线向前走', sub: '前方是否有人和信号，需要到现场确认' },
          { id: 'stay', label: '留在这里陪她等', sub: '需要一起安排原地停留' },
          { id: 'leave', label: '留下能用的物资，自己继续走', sub: '她仍需自行决定下一步' },
        ],
      });
      if (c === 'coord') {
        const r = await g.sos({ forNpc: npc.id, accurate: true });
        if (r.ok) {
          g.setFate(npc.id, 'rescued');
          const c2 = await g.dialog({ who: '小雨', text: ['"谢谢……谢谢你。"', '坐标发出去了。救援队回复：已收到，正在调整搜索方向。'],
            choices: [{ id: 'stay', label: '留在这里陪她等' }, { id: 'go', label: '留下物资，自己继续走' }] });
          if (c2 === 'stay') { g.recruit(npc.id); g.st.rescue.withNpc = npc.id; return; }
          g.warmNpc(npc.id); g.despawn(npc.id, false);
          return;
        }
      }
      if (c === 'take') {
        g.recruit(npc.id);
        g.setFate(npc.id, 'followed');
        return;
      }
      if (c === 'stay') {
        g.recruit(npc.id);
        g.setFate(npc.id, 'waited');
        g.toast('扎营陪她等吧。如果你有通讯手段，也可以随时求救。', 'info');
        return;
      }
      g.warmNpc(npc.id);
      g.setFate(npc.id, 'waited');
      g.despawn(npc.id, false);
    },
  },
];

export const npcById = (id) => NPCS.find((n) => n.id === id);

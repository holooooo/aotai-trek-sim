// 路途事件（随机/条件触发）。g 为游戏接口。
export const EVENTS = [
  {
    id: 'ridge_wind',
    once: true,
    cond: (g) => g.atWaypoint('aoliang'),
    async run(g) {
      await g.say('鳌山大梁', [
        '走出林线的一瞬间，风像一堵墙一样撞过来。',
        '在山脊上，阵风可以把人直接推倒。听到风声变尖时，按住【稳住】压低重心。',
        '扎营时，找背风坡，帐篷尾部对着来风。',
      ], '明白');
    },
  },
  {
    id: 'navtower',
    once: true,
    cond: (g) => g.atWaypoint('daohang'),
    async run(g) {
      const lines = ['锈红色的铁架孤零零地立在山顶。这是鳌山的最高处，也是你回头的最后一个"容易"的地方。'];
      if (g.signal() > 0 && !g.st.airplane) lines.push('手机震了一下——有一格信号。');
      await g.say('导航架 · 海拔约3475m', lines, '继续');
    },
  },
  {
    id: 'plane',
    once: true,
    cond: (g) => g.atWaypoint('feiji'),
    async run(g) {
      g.addStress(4);
      await g.say('飞机梁', ['雪地里露出一截扭曲的金属，上面的油漆早就褪成了灰绿色。', '这道山梁因为它得名。两侧是看不见底的陡坡。'], '继续');
    },
  },
  {
    id: 'leigong',
    once: true,
    cond: (g) => g.atWaypoint('leigong'),
    async run(g) {
      g.addStress(5);
      await g.say('雷公庙', ['只剩几段残墙。', '2017年五一，一场暴风雪困住了这条线上的几十个人。最后一名失联的女驴友，就是在雷公庙以东的山梁南侧被找到的。死因：失温。'], '继续');
    },
  },
  {
    id: 'old_tent',
    once: true,
    cond: (g) => g.inWanxian() && g.roll(0.5),
    async run(g) {
      g.addStress(14);
      await g.say('万仙阵', ['石阵里，一顶褪色的旧帐篷半埋在雪中，门帘被风撕成了布条。', '你没有走近。', '这条线上，有些人再也没有被找到。'], '……');
    },
  },
  {
    id: 'blogger_shot',
    once: false,
    cooldown: 600,
    cond: (g) => g.st.role === 'blogger' && g.onExposedRidge() && g.daylight() && g.roll(0.25),
    async run(g) {
      const c = await g.dialog({
        who: '流量焦虑', text: ['眼前是绵延的雪脊和翻滚的云海。', '"这个镜头能爆。"你脑子里冒出一个念头：站到崖边，让风把冲锋衣吹起来，拍一段。'],
        choices: [
          { id: 'shoot', label: '站到崖边取景', sub: '画面会更靠近崖边，风也更直接' },
          { id: 'safe', label: '在离崖边远些的地方拍几张' },
          { id: 'no', label: '收起相机，继续赶路' },
        ],
      });
      if (c === 'shoot') {
        if (!await g.eventPause(15)) return;
        if (g.roll(0.12 + g.windDanger() * 0.25)) {
          await g.fall(6 + Math.random() * 10, '你在崖边被一阵风吹得失去平衡。');
        } else {
          g.addStress(-10);
          g.st.flags.footage = (g.st.flags.footage || 0) + 1;
          g.toast('拍到了。你的手指冻得几乎失去知觉。', 'warn');
          g.st.body.frostbite += 6;
        }
      } else if (c === 'safe') {
        if (!await g.eventPause(5)) return;
        g.addStress(-3);
      }
    },
  },
  {
    id: 'keepwarm_tip',
    once: true,
    cond: (g) => !g.st.keepWarm && g.airT() < -10 && g.st.bat.phone < 70,
    async run(g) {
      const c = await g.dialog({
        who: '电量告急', text: [`手机电量掉到了${Math.round(g.st.bat.phone)}%。低温会让锂电池快速掉电，甚至直接关机。`, '有经验的人会把手机、充电宝、气罐揣在贴身的口袋里。'],
        choices: [{ id: 'yes', label: '把电子设备和气罐放进贴身口袋' }, { id: 'no', label: '暂时还是放在包里' }],
      });
      if (c === 'yes') { g.st.keepWarm = true; g.toast('电子设备和气罐已贴身放好。', 'good'); }
    },
  },
  {
    id: 'sweat_tip',
    once: true,
    cond: (g) => g.st.wearInsul && g.isWalking() && g.st.body.sweating > 0.5,
    async run(g) {
      g.toast('你开始出汗了。走路时穿着羽绒服，汗水会打湿衣物——湿了就不保暖了。', 'warn', 6000);
    },
  },
  {
    id: 'rest_cold_tip',
    once: true,
    cond: (g) => !g.st.wearInsul && g.hasInsul() && g.isResting() && g.st.body.core < 36.4,
    async run(g) {
      g.toast('停下来以后很快就冷了。休息时把保暖层穿上（背包 → 保暖层）。', 'warn', 6000);
    },
  },
  {
    id: 'water_frozen',
    once: true,
    cond: (g) => g.st.water.frozen > 0.4 && g.st.water.liquid < 0.2,
    async run(g) {
      await g.say('水冻住了', ['你拧开水瓶，里面是一坨冰。', '冬季高山上，水瓶要倒着放（冰从上往下冻）、贴身放，晚上塞进睡袋。冻住的水只能靠炉头化开。'], '知道了');
    },
  },
  {
    id: 'hallucination',
    once: false,
    cooldown: 360,
    cond: (g) => (g.st.body.stress > 78 || g.st.body.core < 33.8) && (g.night() || g.foggy()) && g.roll(0.35),
    async run(g) {
      const spot = g.hallucinationSpot();
      g.world.showHallucination(spot.x, spot.z, true);
      const c = await g.dialog({
        who: '……', text: ['雾里亮起了一团暖黄色的光。', '你揉揉眼睛——是一个小摊。烤肠机在转，油滋滋地响，有人在冲你招手："来一根？刚烤好的！"'],
        choices: [
          { id: 'go', label: '朝那团光走几步', sub: '看起来像有个摊位' },
          { id: 'stop', label: '停下来调整呼吸，观察周围', sub: '先看看光线和周围景物有没有变化' },
        ],
      });
      if (c === 'go') {
        g.addStress(6);
        g.setLure(spot);
        g.toast('你朝着光走去……', 'danger');
      } else {
        g.world.showHallucination(0, 0, false);
        g.addStress(-6);
        g.toast('光灭了。那里什么都没有。门口没有烤肠的山……', 'info', 5000);
      }
    },
  },
  {
    id: 'undress',
    once: false,
    cooldown: 240,
    cond: (g) => g.st.body.core < 32.6 && !g.inTent(),
    async run(g) {
      const c = await g.dialog({
        who: '热', text: ['你突然觉得浑身燥热，像是在蒸桑拿。', '衣服勒得喘不过气。脱掉外套，一定会舒服很多……'],
        shuffle: g.st.body.stress > 60,
        choices: [
          { id: 'strip', label: '脱掉外套', sub: '衣服一松，身体会觉得轻些' },
          { id: 'hold', label: '先不脱外套，检查保暖层', sub: '整理现有衣物，留意身体变化' },
        ],
      });
      if (c === 'strip') {
        await g.removeOuterClothing();
        if (g.over) return;
        g.st.flags.stripped = true;
        g.st.body.core -= 0.6;
        g.toast('冷风灌进了你的身体。你却觉得很舒服。', 'danger', 5000);
      } else {
        await g.setInsulation(true);
        if (g.over) return;
        g.st.flags.blanketOn = g.hasItem('blanket');
        g.toast('你逼自己清醒过来。这是失温的"反常脱衣"——很多遇难者被发现时衣衫不整。', 'warn', 6000);
      }
    },
  },
  {
    id: 'takin',
    once: true,
    cond: (g) => g.st.path === 'hetaoping' && g.roll(0.4),
    async run(g) {
      const c = await g.dialog({
        who: '羚牛', text: ['林子里传来一声闷响。一头羚牛站在十几米外，低着头盯着你，鼻孔里喷着白气。', '秦岭羚牛看起来笨重，发起狂来比熊还危险。'],
        choices: [
          { id: 'back', label: '沿侧面慢慢退开' },
          { id: 'shout', label: '出声让它离开' },
          { id: 'run', label: '转身加快脚步' },
        ],
      });
      if (c === 'back') { if (!await g.eventPause(25)) return; g.addStress(5); g.toast('你绕了一大圈，羚牛没有追来。', 'good'); }
      else if (c === 'shout') {
        if (g.roll(0.5)) { g.addStress(8); g.toast('羚牛甩甩头，慢吞吞地走开了。', 'info'); }
        else { g.hurt(18, 'injury'); g.addStress(18); g.toast('羚牛冲了过来！你被顶翻在雪地里。', 'danger'); }
      } else {
        g.hurt(10, 'injury');
        g.st.body.sprain = Math.max(g.st.body.sprain, 1);
        g.addStress(15);
        g.toast('你在林子里摔了一跤，崴了脚。', 'danger');
      }
    },
  },
  {
    id: 'signal',
    once: false,
    cooldown: 720,
    cond: (g) => g.signal() > 0 && !g.st.airplane && g.st.bat.phone > 3 && !g.st.rescue && g.st.s > 60,
    async run(g) {
      const c = await g.dialog({
        who: '有信号了', text: ['手机震了一下，屏幕上跳出几十条消息。家里人问你元旦在哪儿过。'],
        choices: [
          { id: 'call', label: '给家里打个电话', sub: '会占用电量，也许能让你缓一口气' },
          { id: 'sos', label: '报警求救', sub: '说明你的位置，等待救援' },
          { id: 'live', label: '开一段直播', sub: '需博主身份和足够手机电量；当前位置会在线公开', disabled: g.st.role !== 'blogger' || g.st.bat.phone < 8 },
          { id: 'no', label: '暂时不回复，继续留着电量' },
        ],
      });
      if (c === 'call') { if (!g.spendBattery('phone', 4)) return; g.addStress(-15); g.recordStory('contactHome'); g.recordStory('familyCallbackAt', g.st.time); if (!await g.eventPause(10)) return; g.toast('妈妈在电话那头说："注意安全，早点下山。"', 'info', 5000); }
      if (c === 'sos') await g.sos({});
      if (c === 'live') { if (!g.spendBattery('phone', 8)) return; g.addStress(-12); g.st.flags.livePos = true; g.toast('直播间涌进来几万人。有人留言："主播快下撤吧！"', 'info', 5000); }
    },
  },
];

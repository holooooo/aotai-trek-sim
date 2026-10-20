// 取材于公开报道中的风险机制；人物、地点与选择均为虚构，不重演真实当事人的结局。
const event = (id, data) => ({ id, once: true, ambient: true, weight: 1, priority: 45, ...data });
export const REPORTED_EVENTS = [
  event('reported_solo_probe', {
    sourceTitle: '独自探路，失联近三天',
    cond: (g) => !g.st.camp?.inside && g.st.companions.length > 0 && g.foggy() && g.st.s > 150,
    async run(g) {
      const c = await g.storyDialog('reported_solo_probe', {
        who: '雾里的岔口', sub: '虚构情境 · 灵感见事故档案「独自探路，失联近三天」',
        text: ['前面的坡面被雾遮住了。同行者提议各看一个方向，你也想起有人独自探路后失联的报道。', '熟悉路线的人也会走错。这里没有能保证重新会合的视线或通信条件。'],
        choices: [
          { id: 'together', label: '保持联络，一起核对方向', sub: '耗时15分钟；暂时降低导航漂移，不保证不会迷路' },
          { id: 'probe', label: '仍然独自试探', sub: '耗时20分钟、体力下降；后续判断更混乱' },
          { id: 'back', label: '放弃推进，原路下撤', sub: '改变行进方向；回程仍有风险' },
        ],
      });
      if (c === 'back') return g.retreat('back');
      if (!await g.eventPause(c === 'probe' ? 20 : 15)) return;
      if (c === 'together') {
        g.st.story.effects.navigationCheckedUntil = g.st.time + 180;
        g.addStress(-4);
        g.toast('你们没有分头行动，核对后才重新出发。', 'good');
      } else if (c === 'probe') {
        g.st.story.effects.navigationDoubtUntil = g.st.time + 150;
        g.changeBody('stamina', -6);
        g.addStress(8);
        g.toast('你绕回队伍，仍没能确认前方方向。接下来的导航判断更不稳定。', 'warn');
      }
    },
  }),
  event('reported_weather_turn', {
    sourceTitle: '五一并不意味着温暖',
    cond: (g) => !g.st.camp?.inside && g.airT() < -10 && g.wx().wind > 12 && g.st.body.wet > 30,
    async run(g) {
      const c = await g.storyDialog('reported_weather_turn', {
        who: '身上的暖意正在消失', sub: '虚构冬季情境 · 灵感见事故档案「五一并不意味着温暖」',
        text: ['你走得发热，停下来时却发现衣服已经潮了，风从袖口往里钻。', '有人在五月的鳌太线上遭遇极端天气并失温。季节、刚才的体感，都不是此刻安全的证据。'],
        choices: [
          { id: 'shelter', label: '停止推进，寻找避风营地', sub: '进入现有扎营流程，需要真实装备和时间' },
          { id: 'layer', label: '停下穿保暖层，重新评估', sub: '需保暖衣物；停留10分钟，继续行走仍可能出汗', disabled: !g.hasInsul() },
          { id: 'push', label: '继续赶路，靠运动撑着', sub: '体力消耗、潮湿增加；停止后失温风险更高' },
        ],
      });
      if (c === 'shelter') return g.beginCamp();
      if (c === 'layer') {
        g.st.wearInsul = true;
        if (!await g.eventPause(10)) return;
        g.addStress(-3);
        g.toast('你穿好保暖层。继续走前还需评估出汗与天气，衣物不是免险保证。', 'info');
      } else if (c === 'push') {
        g.changeBody('stamina', -5);
        g.changeBody('wet', 5);
        g.addStress(4);
      }
    },
  }),
  event('reported_last_seen', {
    allowCamp: true,
    sourceTitle: '暴雨中分离，求救尚未结束',
    cond: (g) => g.st.flags.gateDone && g.st.s > 300 && !g.storyValue('reportNote'),
    async run(g) {
      const c = await g.storyDialog('reported_last_seen', {
        who: '一条尚未移交的线索', sub: '虚构情境 · 灵感见事故档案「暴雨中分离，求救尚未结束」',
        text: ['一位正在下撤的徒步者向你说明：同伴在风雪中走散，他记下了最后见到对方的位置和时间，但还没能完整报给警方。', '这是虚构人物的线索，不是现实案件的位置；记录与移交并不等于已经找到人。'],
        choices: [
          { id: 'note', label: '记下位置、时间和描述，出山后报警', sub: '耗时8分钟；结局时还需要实际移交信息' },
          { id: 'send', label: '用现有通讯移交线索', sub: '手机需5%或卫星设备4%电量；不替代继续搜救', disabled: !g.comms().any },
          { id: 'decline', label: '让他继续向警方说明，自己先下撤', sub: '不持有线索；不推定失联者结局' },
        ],
      });
      if (c === 'note') {
        if (!await g.eventPause(8)) return;
        g.recordStory('reportNote', true);
        g.toast('你记下了线索。下山后仍需交给警方，不能把“记住”当成“报过警”。', 'info', 6000);
      } else if (c === 'send') {
        const comms = g.comms();
        if (!comms.any || !g.spendBattery(comms.sat ? 'satcomm' : 'phone', comms.sat ? 4 : 5)) return;
        g.recordStory('reportNote', true);
        g.recordStory('reportNoteCompleted', true);
        g.recordStory('reportCompleted', true);
        g.toast('线索已移交。这里仅确认信息送达，不宣告失联者获救。', 'good', 6000);
      }
    },
  }),
];

// 鳌太线路线数据（游戏化近似值）。
// 海拔、里程为根据公开资料整理的近似数值，仅用于游戏，绝不可作为实际出行依据。
// 鳌太线自 2018 年起被明令禁止穿越。

export const KM_PER_UNIT = 0.04; // 1 体素 = 40 米（水平）
export const M_PER_VOXEL = 25; // 1 体素 = 25 米（垂直，略有夸张）
export const BASE_ALT = 1500; // 体素高度 0 对应海拔

export const altToVox = (alt) => (alt - BASE_ALT) / M_PER_VOXEL;
export const voxToAlt = (v) => BASE_ALT + v * M_PER_VOXEL;

// 地形类型：影响速度、体力、滑坠、迷路风险和视觉
export const TERRAIN = {
  village: { name: '村落土路', speed: 1.0, stamina: 0.8, steep: 0.18, amp: 0.6, snow: 0.2 },
  forest: { name: '针叶林', speed: 0.85, stamina: 1.1, steep: 0.32, amp: 1.2, snow: 0.9 },
  meadow: { name: '高山草甸', speed: 0.9, stamina: 1.0, steep: 0.22, amp: 1.6, snow: 0.6 },
  ridge: { name: '山脊', speed: 0.85, stamina: 1.15, steep: 0.55, amp: 3.0, snow: 0.5 },
  knife: { name: '刃脊', speed: 0.6, stamina: 1.3, steep: 1.25, amp: 3.5, snow: 0.4 },
  stone: { name: '石海', speed: 0.55, stamina: 1.35, steep: 0.5, amp: 2.4, snow: 0.6 },
  plateau: { name: '高山塬', speed: 0.9, stamina: 1.0, steep: 0.16, amp: 1.2, snow: 0.7 },
};

// 途经点（主线，自西向东：鳌山 → 太白山）
// terrain 指从该点到下一个点之间的主要地形
export const WAYPOINTS = [
  { id: 'tangkou', name: '塘口村', alt: 1740, km: 0, terrain: 'village', signal: 2,
    desc: '太白县塘口村，鳌太线西端入口。高铁到宝鸡南，打车一百多块就能到这里——门槛低得吓人。' },
  { id: 'gate', name: '管护站', alt: 1900, km: 1.6, terrain: 'forest', signal: 2,
    desc: '保护区管护站和铁丝网。2018年起，鳌太穿越被明令禁止。' },
  { id: 'c2900', name: '2900营地', alt: 2900, km: 9, terrain: 'meadow', signal: 0, camp: true,
    desc: '林线附近的营地。从塘口到这里，十来公里要爬升一千多米。' },
  { id: 'aoliang', name: '鳌山大梁', alt: 3320, km: 13, terrain: 'ridge', signal: 1, bailout: 'qingfengxia',
    desc: '走出林线，第一次站上山脊。从这里开始，风再也不会停。' },
  { id: 'daohang', name: '导航架', alt: 3475, km: 17, terrain: 'ridge', signal: 1,
    desc: '鳌山顶的铁架标志塔，海拔约3475米。大雾天，它是你能找到的最后一个确定坐标。' },
  { id: 'yaowang', name: '药王洞', alt: 3380, km: 23, terrain: 'stone', signal: 0,
    desc: '一处浅浅的石洞，能挡一点风。' },
  { id: 'qiaomai', name: '荞麦梁', alt: 3450, km: 28, terrain: 'ridge', signal: 0,
    desc: '连绵的石海。石头上不会留下脚印，起雾时最容易走丢。' },
  { id: 'shuiwozi', name: '水窝子营地', alt: 3400, km: 33, terrain: 'ridge', signal: 0, camp: true, water: true,
    desc: '山脊上难得的水源，冬天是一个结冰的水洼。传统营地，但几乎没有遮挡。' },
  { id: 'feiji', name: '飞机梁', alt: 3500, km: 40, terrain: 'knife', signal: 0,
    desc: '山梁上散落着飞机残骸，据说因此得名。两侧是陡坡，风大时站都站不稳。' },
  { id: 'c2800', name: '2800营地', alt: 2850, km: 50, terrain: 'forest', signal: 0, camp: true, water: true, bailout: 'hetaoping',
    desc: '林线附近的营地。2025年有迷路者在核桃坪附近山域获救；报道并不能证明这里存在一条固定、安全的下撤道路。地图上的连接是游戏虚构。' },
  { id: 'jinzita', name: '金字塔', alt: 3380, km: 57, terrain: 'stone', signal: 0,
    desc: '一座金字塔形的石峰。从2800营地爬上来，要重新回到3300米以上。' },
  { id: 'xiyuan', name: '西塬', alt: 3450, km: 63, terrain: 'plateau', signal: 0,
    desc: '开阔平缓的高山塬。看起来好走，可大雾里四面八方长得一模一样。' },
  { id: 'taibailiang', name: '太白梁', alt: 3523, km: 70, terrain: 'ridge', signal: 1,
    desc: '海拔约3523米。偶尔能搜到一格信号。' },
  { id: 'dashihe', name: '大石河营地', alt: 3300, km: 77, terrain: 'plateau', signal: 0, camp: true, water: true,
    desc: '河源附近的营地，冬天溪水冻成了冰。' },
  { id: 'dongyuan', name: '东塬', alt: 3450, km: 84, terrain: 'stone', signal: 0,
    desc: '又一片高山塬，往东接上连绵的石海。' },
  { id: 'wanxian', name: '万仙阵', alt: 3500, km: 92, terrain: 'stone', signal: 0,
    desc: '第四纪冰川留下的石阵，怪石林立，像迷宫一样。' },
  { id: 'leigong', name: '雷公庙', alt: 3600, km: 99, terrain: 'knife', signal: 0,
    desc: '只剩残墙的小庙。2017年五一暴风雪，最后一名失联者在雷公庙以东的山梁南侧被找到，死因失温。' },
  { id: 'paoma', name: '跑马梁', alt: 3650, km: 105, terrain: 'ridge', signal: 1, bailout: 'dudumen', bailouts: ['dudumen', 'diaoyutai'],
    desc: '名字听起来很开阔，其实是全线海拔最高的一段山脊之一。' },
  { id: 'dayehai', name: '大爷海', alt: 3590, km: 110, terrain: 'ridge', signal: 2, camp: true, water: true,
    desc: '太白山的高山湖泊，历史上发生过大雾走散与暴风雪搜救。高山区域可因雨雪封闭，现实中不能假定小屋、索道、信号或工作人员一定可用。' },
  { id: 'baxian', name: '拔仙台', alt: 3771, km: 113, terrain: 'ridge', signal: 2, end: true,
    desc: '太白山主峰，海拔约3771米，青藏高原以东的最高点。' },
];

// 历史事件参考的虚构支线。仅区域名/事故机制有来源；连接、方位、
// 里程、海拔与接触点都是游戏设定，不构成真实道路或成功下撤的证明。
export const BRANCHES = {
  hetaoping: {
    id: 'hetaoping', name: '核桃坪参考支线', fromWaypoint: 'c2800', lengthKm: 10, endAlt: 1550,
    terrain: 'forest', endName: '核桃坪参考接触点', side: 1, undulations: 60, forestAt: 0,
    fictional: true, basis: '2025年2800营地下方、核桃坪附近的搜救报道',
    desc: '沿游戏中的林缘与溪谷起伏下行，必须真正走到接触点；海拔降低本身不等于脱险。',
    warning: '该报道只确认事故发现区域，未证实固定下撤道路、朝向和长度。沿河下切曾导致多次滑坠。',
    sourceLinks: [{ label: '华商网 · 2025年核桃坪附近搜救', url: 'https://news.hsw.cn/system/2025/0219/1824598.shtml' }],
  },
  qingfengxia: {
    id: 'qingfengxia', name: '青峰峡事故参考支线', fromWaypoint: 'aoliang', lengthKm: 12, endAlt: 1500,
    terrain: 'forest', endName: '青峰峡参考接触点', side: -1, undulations: 90, forestAt: 0.22,
    fictional: true, basis: '2012年误判塘口方向、后在青峰峡侧接触救援的案例',
    desc: '游戏西段的一条长距离下行分支，有石坡、回升和林缘；不是从鳌山大梁到青峰峡的实测道路。',
    warning: '真实队伍未找到前队标识，误判下山方向后迷失数日。报道不能确认地图上这条连接。',
    sourceLinks: [{ label: '华商报 · 2012年鳌山迷失搜救', url: 'https://news.sina.com.cn/c/2012-08-22/022225010064.shtml' }],
  },
  dudumen: {
    id: 'dudumen', name: '都督门计划参考支线', fromWaypoint: 'paoma', lengthKm: 16, endAlt: 1525,
    terrain: 'forest', endName: '都督门参考接触点', side: 1, undulations: 110, forestAt: 0.38,
    fictional: true, basis: '2018年公告中的跑马梁—都督门原计划与搜救范围',
    desc: '游戏中的后段替代行程，需要先穿过暴露石坡再进入林地；体力和后半夜天气仍然重要。',
    warning: '官方只公布原计划与搜寻范围，当事人最后在大爷海被找到；不能据此认定该计划走通或冬季安全。',
    sourceLinks: [{ label: '太白山官方 · 2018年搜救通告', url: 'https://www.tbpark.com/html/2018/scenic_0503/1313.html' }],
  },
  diaoyutai: {
    id: 'diaoyutai', name: '钓鱼台事故参考支线', fromWaypoint: 'paoma', lengthKm: 18, endAlt: 1475,
    terrain: 'forest', endName: '钓鱼台参考接触点', side: -1, undulations: 130, forestAt: 0.3,
    fictional: true, basis: '2025年报道：跑马梁后迷路者最终在钓鱼台遇到人类设施',
    desc: '长距离的虚构林谷行程，绕行与回升会消耗储备。地名参考一次走失后的偶然接触，不代表现成出口。',
    warning: '该人失联九天后才走出；进山点铁甲树与钓鱼台不能据此拼成已知通道，不保证任何人重现这一结果。',
    sourceLinks: [{ label: '极目新闻 · 失联九天后遇到水电站人员', url: 'https://www.ctdsb.net/c1716_202501/2345362.html' }],
  },
};

export const ROUTE_TOTAL_KM = WAYPOINTS[WAYPOINTS.length - 1].km;
export const waypointById = (id) => WAYPOINTS.find((w) => w.id === id);

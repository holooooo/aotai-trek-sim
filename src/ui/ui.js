import { distribution } from '../analytics/polls.js';
// DOM 界面：标题、角色、商店、HUD、弹窗、背包、地图、营地、结局、事故档案。
import { ROLES, roleById } from '../data/roles.js';
import { ITEMS, CATEGORIES, SHOP_ORDER, SLOT_NAMES } from '../data/items.js';
import { ARCHIVE, LESSONS } from '../data/archive.js';
import { ENDINGS, EPILOGUES, SLOGAN } from '../data/endings.js';
import { WAYPOINTS, BRANCHES } from '../data/route.js';
import { npcById } from '../data/npcs.js';
import { createState, addItem, removeItem, has, packWeight, packCapacity } from '../sim/state.js';
import { isClothWorn, garmentWetness, dryableClothes, canDryClothes } from '../sim/clothes.js';
import { ensureFire, fireCostAvailable } from '../sim/fire.js';
import { routeMapSVG } from './map-renderer.js';
import { DIFFICULTIES, difficultyProfile } from '../sim/difficulty.js';
import { fmtClock, fmtDateTime } from '../sim/game.js';
import { foodEffectSummary, activeFoodEffects } from '../sim/nutrition.js';
import { ensureLampMode } from '../sim/lighting.js';
import { icon, WEATHER_ICON } from './icons.js';
import { loadRecords, clearRecords, summarize, ENDING_LIST, EPILOGUE_LIST } from '../sim/records.js';
import { isRoleUnlocked, unlockRole } from '../sim/role-unlocks.js';
import { getLocale, setLocale, translate } from '../i18n.js';

// 作者主页（标题页引流）
const SOCIALS = [
  { name: 'X', handle: '@holooooox', url: 'https://x.com/holooooox',
    svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.9 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.3 4.7H5.5l11.2 14.5Z"/></svg>' },
  { name: 'B站', handle: '主页', url: 'https://space.bilibili.com/3546871144384669',
    svg: '<svg viewBox="0 0 24 24" aria-hidden="true" shape-rendering="crispEdges"><path fill="currentColor" d="M6 2h2v2h2v2h4V4h2V2h2v2h-2v2h4v2h2v12h-2v2H4v-2H2V8h2V6h4V4H6V2Zm-1 7v10h14V9H5Zm3 3h2v3H8v-3Zm6 0h2v3h-2v-3Z"/></svg>' },
  { name: '抖音', handle: '耙耙柑', url: 'https://www.douyin.com/user/MS4wLjABAAAAcvrzbqpq6fhnCeniTItWgcz5kRWEtAEGCyQ_TWHBwI8',
    svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#25f4ee" d="M9.4 9.6v-1A6.6 6.6 0 1 0 14 21.1a6.6 6.6 0 0 1-4.6-11.5Z" opacity=".9"/><path fill="#fe2c55" d="M16.4 6.9A4.5 4.5 0 0 1 14.5 3h-3v12.9a2.7 2.7 0 1 1-2.1-2.7V10a5.8 5.8 0 1 0 5 5.7V9.2a7.3 7.3 0 0 0 4.4 1.4V7.6a4.4 4.4 0 0 1-2.4-.7Z"/><path fill="currentColor" d="M15.5 8.5a7.3 7.3 0 0 0 4.3 1.4V7a4.4 4.4 0 0 1-2.4-.7 4.5 4.5 0 0 1-2-3.2h-2.9V15a2.7 2.7 0 1 1-2-2.6V9.5A5.8 5.8 0 1 0 15.5 15V8.5Z"/></svg>' },
  { name: 'GitHub', handle: '源码', url: 'https://github.com/holooooo/aotai-trek-sim',
    svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1.5a10.5 10.5 0 0 0-3.3 20.5c.5.1.7-.2.7-.5v-1.8c-2.9.6-3.5-1.4-3.5-1.4-.5-1.2-1.2-1.5-1.2-1.5-1-.7.1-.7.1-.7 1 .1 1.6 1.1 1.6 1.1.9 1.6 2.5 1.1 3.1.9.1-.7.4-1.1.7-1.4-2.3-.3-4.8-1.2-4.8-5.2 0-1.1.4-2.1 1.1-2.8-.1-.3-.5-1.3.1-2.8 0 0 .9-.3 2.9 1.1a10 10 0 0 1 5.2 0c2-1.4 2.9-1.1 2.9-1.1.6 1.5.2 2.5.1 2.8.7.7 1.1 1.7 1.1 2.8 0 4-2.5 4.9-4.8 5.2.4.3.7 1 .7 2v2.9c0 .3.2.6.7.5A10.5 10.5 0 0 0 12 1.5Z"/></svg>' },
];

const VITAL_ICON = { core: 'core', stamina: 'stamina', food: 'food', water: 'water', stress: 'stress', health: 'health', wet: 'wet' };
const ICON_ARROW = '<svg class="navarrow" viewBox="0 0 16 16" shape-rendering="crispEdges"><path d="M8 1 L14 13 L8 10 L2 13Z" fill="currentColor"/></svg>';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 像素烤肠
export const SAUSAGE_SVG = `<svg class="sausage" viewBox="0 0 28 12" shape-rendering="crispEdges" aria-hidden="true">
<rect x="0" y="5" width="28" height="2" fill="#9a9a9a"/>
<rect x="4" y="2" width="18" height="8" fill="#b5532a"/><rect x="2" y="3" width="2" height="6" fill="#b5532a"/><rect x="22" y="3" width="2" height="6" fill="#b5532a"/>
<rect x="5" y="3" width="15" height="2" fill="#d8743f"/>
<rect x="7" y="2" width="1" height="8" fill="#7a3418"/><rect x="11" y="2" width="1" height="8" fill="#7a3418"/><rect x="15" y="2" width="1" height="8" fill="#7a3418"/><rect x="19" y="2" width="1" height="8" fill="#7a3418"/>
</svg>`;


const VITALS = [
  ['core', '体温'], ['stamina', '体力'], ['food', '饱食'], ['water', '水分'], ['stress', '压力'], ['health', '健康'], ['wet', '潮湿'],
];

export class UI {
  constructor({ mobile, audio, input }) {
    this.isMobile = mobile;
    this.audio = audio;
    this.input = input;
    this.app = null;
    this.game = null;
    this.dialogOpen = false;
    this.sheetOpen = null;
    this.screenOpen = null;
    this.dialogQueue = Promise.resolve();
    this.el = {
      screen: $('#screen'), hud: $('#hud'), sheet: $('#sheet'), dialog: $('#dialog'), card: $('#card'),
      busy: $('#busy'), toasts: $('#toasts'), joy: $('#joy'), canvas: $('#c'),
      fx: {
        cold: $('.fx-cold'), hunger: $('.fx-hunger'), thirst: $('.fx-thirst'), fatigue: $('.fx-fatigue'), wet: $('.fx-wet'), altitude: $('.fx-altitude'),
        hurt: $('.fx-hurt'), stress: $('.fx-stress'), white: $('.fx-white'), dark: $('.fx-dark'), flash: $('.fx-flash'),
        frost: $('.fx-frost'), wind: $('.fx-wind'),
      },
    };
    this.el.sheet.addEventListener('pointerdown', (e) => { if (e.target === this.el.sheet) this.closeSheet(); });
    document.addEventListener('click', (e) => {
      if (e.target.closest('button')) this.audio?.click();
    });
  }

  get modalOpen() { return this.dialogOpen || !!this.sheetOpen || !!this.screenOpen; }
  get compactHud() { return this.isMobile || matchMedia('(max-width: 640px) and (orientation: portrait)').matches; }
  _syncInput() {
    this.input?.setEnabled(!this.modalOpen);
    this.el.hud.classList.toggle('ui-blocked', !!this.modalOpen);
    this.el.hud.classList.toggle('dialog-mode', this.dialogOpen);
    this.el.joy.classList.toggle('ui-blocked', !!this.modalOpen);
  }

  // 简单事件委托：data-act
  _bind(root, handlers) {
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || !root.contains(b) || b.disabled) return;
      const fn = handlers[b.dataset.act];
      if (fn) fn(b.dataset, b, e);
    });
  }

  // ———————————————————— 页面 ————————————————————
  _page(html, cls = 'dim', name = 'page') {
    this.el.screen.innerHTML = `<div class="page ${cls}">${html}</div>`;
    this.screenOpen = name;
    this._syncInput();
    const page = this.el.screen.firstElementChild;
    page.scrollTop = 0;
    return page;
  }

  closeScreen() {
    this.el.screen.innerHTML = '';
    this.screenOpen = null;
    this._syncInput();
  }

  privacyControls(locale = getLocale()) {
    const t = (key, vars) => translate(locale, key, vars);
    return `<div class="privacy-controls"><p>${t('privacyText')}</p><button class="sbtn alt" data-act="privacy" aria-pressed="${!!this.analytics?.enabled}">${this.analytics?.enabled ? t('analyticsOn') : t('analyticsOff')}</button></div>`;
  }

  remainsControls(locale = getLocale()) {
    const t = (key, vars) => translate(locale, key, vars);
    const r = this.remains;
    return `<div class="privacy-controls remains-controls"><h4>${t('remainsTitle')}</h4><p>${t('remainsText')}</p>
      <button class="sbtn ${r?.enabled ? 'on' : 'alt'}" data-act="remains" aria-pressed="${!!r?.enabled}">${r?.enabled ? t('remainsOn') : t('remainsOff')}</button>
      <button class="sbtn ${r?.shared ? 'on' : 'alt'}" data-act="remains-shared" aria-pressed="${!!r?.shared}" ${r?.enabled ? '' : 'disabled'}>${r?.shared ? t('sharedOn') : t('sharedOff')}</button>
      <p>${t('remainsDetails')}</p>
      <button class="sbtn alt" data-act="remains-clear">${t('clearRemains')}</button></div>`;
  }

  showTitle({ hasSave }) {
    const locale = getLocale();
    const t = (key, vars) => translate(locale, key, vars);
    let secretClicks = 0;
    const page = this._page(`
      <div class="title-block">
        <div class="title-kicker">${t('titleKicker')}</div>
        <div class="title-main"><span>${t('titleMain')}</span><span class="title-edition">${t('titleEdition')}</span></div>
        <div class="title-sub">${t('titleSub')}</div>
        <button type="button" class="stamp title-secret-stamp" data-act="secret-stamp" aria-label="${locale === 'en' ? 'Do not cross' : '禁止穿越'}">${locale === 'en' ? 'DO NOT CROSS' : '禁止穿越'}</button>
        <div class="tagline">${SAUSAGE_SVG}<span>${t('tagline')}</span></div>
        <div class="title-actions">
          ${hasSave ? `<button class="btn primary" data-act="continue">${t('continue')} <small>${t('continueSmall')}</small></button>` : ''}
          <button class="btn ${hasSave ? '' : 'primary'}" data-act="new">${t('start')} <small>${t('startSmall')}</small></button>
          <button class="btn ghost" data-act="records">${t('records')} <small>${loadRecords().length ? t('recordsCount', { count: loadRecords().length }) : t('recordsEmpty')}</small></button>
          <button class="btn ghost" data-act="archive">${t('archive')} <small>${t('archiveSmall')}</small></button>
          <button class="btn ghost" data-act="about">${t('about')} <small>${t('aboutSmall')}</small></button>
          <button class="btn ghost language-switch" data-act="language" aria-label="${t('language')}">${t('language')}</button>
        </div>
        <div class="socials">
          <div class="socials-k">${locale === 'en' ? 'AUTHOR · FOLLOW' : '作者 · 关注我'}</div>
          <div class="socials-row">${SOCIALS.map((x) => `<a class="social" href="${x.url}" target="_blank" rel="noopener">${x.svg}<span><b>${esc(x.name)}</b><small>${esc(x.handle)}</small></span></a>`).join('')}</div>
        </div>
      </div>
      <div class="title-foot">
        ${this.privacyControls(locale)}
        ${this.remainsControls(locale)}
        ${t('footer1')}<b>${t('footer2')}</b>${t('footer3')}
        ${t('footer4')}<b>${t('footer5')}</b>${t('footer6')}
      </div>`, 'title-page', 'title');
    this._bind(page, {
      'secret-stamp': () => {
        if (isRoleUnlocked('qu')) return;
        secretClicks += 1;
        if (secretClicks >= 10 && unlockRole('qu')) this.toast(locale === 'en' ? 'Something hidden has been uncovered.' : '印章下面好像藏着什么。', 'info', 2500);
      },
      language: () => { setLocale(locale === 'en' ? 'zh-CN' : 'en'); this.showTitle({ hasSave }); },
      privacy: () => { this.app.toggleAnalytics(); this.showTitle({ hasSave }); },
      remains: () => { this.app.toggleRemains(); this.showTitle({ hasSave }); },
      'remains-shared': () => { this.app.toggleRemains(true); this.showTitle({ hasSave }); },
      'remains-clear': () => { this.app.clearRemains(); this.showTitle({ hasSave }); },
      continue: () => this.app.continueGame(),
      new: () => this.showRoles(),
      records: () => this.showRecords(() => this.app.toTitle()),
      archive: () => this.showArchive(() => this.app.toTitle()),
      about: () => this.showAbout(() => this.app.toTitle()),
    });
  }

  showRecords(onBack) {
    const list = loadRecords();
    const sum = summarize(list);
    const fmt = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
    const endName = (k) => ENDING_LIST.find((e) => e.id === k)?.name ?? k;
    const tone = (r) => (r.type === 'dead' ? 'died' : r.type === 'cross' || r.type === 'rescued' ? '' : 'ok');
    const S = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    const page = this._page(`
      <div class="page-head"><div><span class="tag">RECORDS</span><h2>游玩记录</h2><div class="kicker">记录保存在这台设备的浏览器里，清除浏览器数据后会丢失。</div></div>
        <button class="btn ghost" data-act="back">返回</button></div>
      <div class="archive">
        <div class="end-grid" style="margin:0">
          ${S('总局数', sum.total)}${S('生还', sum.alive)}${S('遇难', sum.deaths)}${S('最远到达', sum.best.toFixed(1) + 'km')}
        </div>
        <div class="end-sec" style="margin:8px 0 0"><h3><span class="tag">结局</span>收集 ${ENDING_LIST.filter((e) => sum.unlocked.has(e.id)).length} / ${ENDING_LIST.length}</h3>
          <div class="checklist">${ENDING_LIST.map((e) => `<span class="chip ${sum.unlocked.has(e.id) ? (e.id.startsWith('dead') ? 'no' : 'ok') : ''}">${sum.unlocked.has(e.id) ? esc(e.name) : '？？？'}</span>`).join('')}</div>
        </div>
        <div class="end-sec" style="margin:8px 0 0"><h3><span class="tag">尾声</span>收集 ${sum.unlockedEpilogues.size} / ${EPILOGUE_LIST.length}</h3>
          <div class="checklist">${EPILOGUE_LIST.map((e) => `<span class="chip ${sum.unlockedEpilogues.has(e.id) ? 'ok' : ''}">${sum.unlockedEpilogues.has(e.id) ? esc(e.name) : '？？？'}</span>`).join('')}</div><p class="kicker">同一局可以留下多个故事尾声。</p></div>
        <div class="end-sec" style="margin:8px 0 0"><h3><span class="tag">历史</span>最近 ${list.length} 局</h3>
          ${list.length ? list.map((r) => `<div class="fate ${tone(r)}"><b>${esc(endName(r.key))}</b> <small style="color:var(--muted)">${esc(r.roleName)} · ${esc(difficultyProfile(r.difficulty).name)} · ${fmt(r.at)}</small>
            <p>${r.key === 'sausage' ? '没有进山。去景区吃了一根烤肠。' : `走到 ${r.progress}km · 山上 ${r.days} 天`} ${r.key === 'sausage' ? '' : ` · 最高 ${r.maxAlt}m · 最低体温 ${r.minCore}℃`}${r.saved ? ` · 帮助了 ${r.saved} 人` : ''}${r.lost ? ` · ${r.lost} 人没能下山` : ''}</p>
            ${(r.epilogues || []).filter((id) => EPILOGUES[id]).length ? `<div class="checklist">${r.epilogues.filter((id) => EPILOGUES[id]).map((id) => `<span class="chip ok">${esc(EPILOGUES[id].title)}</span>`).join('')}</div>` : ''}
            ${this._storyDecisions(r.decisions || [])}</div>`).join('') : '<div style="color:var(--muted)">还没有完成过一局。</div>'}
        </div>
        ${list.length ? '<div><button class="btn danger" data-act="clear">清空记录</button></div>' : ''}
      </div>`, 'dim', 'records');
    this._bind(page, {
      back: onBack,
      clear: async () => {
        const c = await this.dialog({ who: '清空游玩记录？', text: ['所有历史和结局收集都会被删除。'], choices: [{ id: 'y', label: '清空' }, { id: 'n', label: '取消' }] });
        if (c === 'y') { clearRecords(); this.showRecords(onBack); }
      },
    });
  }

  _avatar(look) {
    const hex = (n) => '#' + n.toString(16).padStart(6, '0');
    return `<div class="avatar" style="--h:${hex(look.hat)};--s:${hex(look.skin)};--j:${hex(look.jacket)};--l:${hex(look.pants)}">
      <i class="a-hat"></i><i class="a-face"></i><i class="a-body"></i><i class="a-legs"></i></div>`;
  }

  showRoles() {
    let sel = null;
    let difficulty = 'easy';
    const availableRoles = ROLES.filter((role) => !role.hidden || isRoleUnlocked(role.id));
    const card = (r) => `
      <button class="role" data-act="pick" data-id="${r.id}">
        <div class="role-top">${this._avatar(r.look)}<div><h3>${esc(r.name)}</h3><div class="quote">${esc(r.tagline)}</div></div></div>
        <div class="money">¥${r.money.toLocaleString()}</div>
        <div class="desc">${esc(r.desc)}</div>
        <ul>${r.skills.map((s) => `<li><b>${esc(s.name)}</b>：${esc(s.desc)}</li>`).join('')}
            ${r.flaws.map((s) => `<li class="flaw"><b>${esc(s.name)}</b>：${esc(s.desc)}</li>`).join('')}</ul>
        <div class="gear">初始装备：${Object.keys(r.inv).map((id) => esc(ITEMS[id]?.name ?? id)).join('、')}</div>
      </button>`;
    const page = this._page(`
      <div class="page-head"><div><span class="tag">STEP 1/2</span><h2>选择身份</h2><div class="kicker">12月31日，元旦假期。一年中最冷、事故最集中的时候之一。</div></div>
        <button class="btn ghost" data-act="back">返回</button></div>
      <div class="difficulty-picker panel" style="padding:12px;margin-bottom:14px">
        <div class="kicker" style="margin-bottom:8px">行程难度</div>
        <div class="btns" role="group" aria-label="行程难度">${DIFFICULTIES.map((d) => `<button class="btn ${d.id === difficulty ? 'primary' : 'ghost'}" data-act="difficulty" data-id="${d.id}" aria-pressed="${d.id === difficulty}">${esc(d.name)}</button>`).join('')}</div>
        <p class="kicker" data-difficulty-note style="margin:8px 0 0">轻松：双倍健康，仍会受伤、失温和消耗补给。</p>
      </div>
      <div class="roles">${availableRoles.map(card).join('')}</div>
      <div class="role-bar"><button class="btn primary" data-act="go" disabled>先选一个身份</button></div>`, 'dim', 'roles');
    const go = $('[data-act="go"]', page);
    this._bind(page, {
      back: () => this.app.toTitle(),
      pick: (d, b) => {
        if (!availableRoles.some((role) => role.id === d.id)) return;
        sel = d.id;
        page.querySelectorAll('.role').forEach((x) => x.classList.toggle('sel', x === b));
        go.disabled = false;
        go.textContent = `以「${roleById(sel).short}」身份前往塘口村 →`;
        if (this.isMobile) b.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      },
      difficulty: (d) => {
        difficulty = d.id;
        page.querySelectorAll('[data-act="difficulty"]').forEach((b) => {
          const selected = b.dataset.id === difficulty;
          b.classList.toggle('primary', selected); b.classList.toggle('ghost', !selected);
          b.setAttribute('aria-pressed', String(selected));
        });
        page.querySelector('[data-difficulty-note]').textContent = difficulty === 'spring' ? '春游：气温与体感保持在0℃以上，健康、消耗与伤害更宽松。' : difficulty === 'easy' ? '轻松：双倍健康，仍会受伤、失温和消耗补给。' : difficulty === 'hardcore' ? '真实：散热、消耗与伤害更严苛；仍是游戏化模型，不是现实预测。' : '标准：原有生理与伤害数值。';
      },
      go: () => sel && this.showShop(createState(sel, difficulty)),
    });
  }

  // ———————————————————— 商店 ————————————————————
  showShop(st) {
    const role = roleById(st.role);
    const bought = {};
    let cat = 'camp';
    const page = this._page(`
      <div class="page-head"><div><span class="tag">STEP 2/2</span><h2>塘口村 · 小卖部 &amp; 户外店</h2>
        <div class="kicker">凌晨四点半。老板披着军大衣，打着哈欠给你开了门。这是最后一个能买到东西的地方。</div></div>
        <button class="btn ghost" data-act="back">返回</button></div>
      <div class="shop">
        <div>
          <div class="shop-tabs">${CATEGORIES.map((c) => `<button data-act="cat" data-id="${c.id}">${c.name}</button>`).join('')}</div>
          <div class="items"></div>
        </div>
        <div class="cart panel"></div>
      </div>`, 'dim', 'shop');
    const itemsEl = $('.items', page);
    const cartEl = $('.cart', page);

    const ownedCount = (id) => {
      const it = ITEMS[id];
      if (['water', 'gas'].includes(it.kind) || ['warmer', 'powerbank', 'hotwater_fill', 'insurance'].includes(id)) return bought[id] || 0;
      return st.inv[id] || 0;
    };
    const canBuy = (id) => {
      const it = ITEMS[id];
      if (it.soldOut) return false;
      if (st.money < it.price) return false;
      if (it.needs && !has(st, it.needs)) return false;
      if ((id === 'hotwater_fill' || id === 'insurance') && bought[id]) return false;
      if (it.kind === 'pack' && has(st, id)) return false;
      if (['tent', 'bag', 'pad', 'cloth'].includes(it.kind) && (st.inv[id] || 0) >= 1) return false;
      if (['tool'].includes(it.kind) && !['firstaid', 'blanket'].includes(id) && (st.inv[id] || 0) >= 1 && id !== 'powerbank') return false;
      return true;
    };
    const undo = (id) => {
      const it = ITEMS[id];
      if (!bought[id]) return;
      bought[id]--;
      this.analytics?.track('shop_refund', st, { itemId: id, quantity: 1, cost: it.price });
      st.money += it.price;
      if (it.kind === 'water') st.water.liquid = Math.max(0, st.water.liquid - it.liters);
      else if (it.kind === 'gas') { const k = id === 'gas_alpine' ? 'alpine' : 'normal'; st.gas[k] = Math.max(0, st.gas[k] - it.units); }
      else if (id === 'warmer') st.warmers = Math.max(0, st.warmers - it.pieces);
      else if (id === 'powerbank') { st.powerbank = Math.max(0, st.powerbank - it.charges); removeItem(st, 'powerbank'); }
      else if (id === 'hotwater_fill') { st.thermos.l = 0; st.thermos.temp = 20; }
      else if (id === 'insurance') st.flags.insurance = false;
      else removeItem(st, id);
      if (id === 'thermos' && !has(st, 'thermos') && bought.hotwater_fill) undo('hotwater_fill');
    };

    const renderItems = () => {
      page.querySelectorAll('.shop-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.id === cat));
      const ids = SHOP_ORDER.filter((id) => ITEMS[id].cat === cat && !ITEMS[id].hidden);
      itemsEl.innerHTML = ids.map((id) => {
        const it = ITEMS[id];
        const n = ownedCount(id);
        const startOwned = (role.inv[id] || 0) > 0;
        if (it.soldOut) {
          return `<div class="item soldout"><div class="nm">${esc(it.name)}</div><div class="meta">¥${it.price}</div>
            <div class="ds">${esc(it.desc)}</div><div class="stamp">本店不卖</div></div>`;
        }
        return `<div class="item ${startOwned ? 'owned' : ''}">
          <div class="nm">${esc(it.name)}</div>
          <div class="qty"><button data-act="minus" data-id="${id}" ${bought[id] ? '' : 'disabled'}>−</button><span>${n}</span>
            <button data-act="plus" data-id="${id}" ${canBuy(id) ? '' : 'disabled'}>+</button></div>
          <div class="meta"><b>¥${it.price}</b> · ${it.weight ? it.weight + 'kg' : '—'}</div>
          <div class="ds">${esc(it.desc)}</div></div>`;
      }).join('');
    };

    const renderCart = () => {
      const w = packWeight(st), cap = packCapacity(st);
      const pct = Math.min(100, (w / cap) * 100);
      cartEl.innerHTML = `
        <div class="row"><span>${esc(role.name)} · ${esc(difficultyProfile(st).name)}</span><span>余额</span></div>
        <div class="big mono" style="color:${st.money < 200 ? 'var(--red)' : 'var(--green)'}">¥${st.money.toLocaleString()}</div>
        <div class="row"><span>负重</span><span class="mono" style="font-size:20px;color:${w > cap ? 'var(--red)' : 'var(--ink)'}">${w.toFixed(1)} / ${cap} kg</span></div>
        <div class="meter"><i style="width:${pct}%;background:${w > cap ? 'var(--red)' : pct > 80 ? 'var(--yellow)' : 'var(--green)'}"></i></div>
        <div class="shop-note hide-m">含身上穿的衣服。超过背包承重会更慢、更累。</div>
        <button class="btn primary" data-act="depart">出发 →</button>`;
    };
    const render = () => { renderItems(); renderCart(); };
    render();
    this._bind(page, {
      back: () => this.showRoles(),
      cat: (d) => { cat = d.id; renderItems(); },
      plus: (d) => { const it = ITEMS[d.id]; if (!canBuy(d.id)) return; st.money -= it.price; addItem(st, d.id); this.analytics?.track('shop_buy', st, { itemId: d.id, quantity: 1, cost: it.price }); bought[d.id] = (bought[d.id] || 0) + 1; render(); },
      minus: (d) => { undo(d.id); render(); },
      depart: () => this.app.depart(st),
    });
  }

  // ———————————————————— 档案 / 说明 ————————————————————
  showArchive(onBack) {
    const page = this._page(`
      <div class="page-head"><div><span class="tag">ARCHIVE</span><h2>事故档案</h2><div class="kicker">以下内容根据公开报道整理。每一行数字背后，都是一个没能回家的人。</div></div>
        <button class="btn ghost" data-act="back">返回</button></div>
      <div class="archive">${ARCHIVE.map((a) => `
        <div class="case"><div class="when">${esc(a.when)}</div><div><h4>${esc(a.title)}</h4><p>${esc(a.body)}</p>${a.mechanic ? `<p class="lesson">${esc(a.mechanic)}</p>` : ''}
          <div class="src">来源：${a.src.map((s) => `<a href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.t)}</a>`).join('')}</div></div></div>`).join('')}
      </div>
      <div class="slogan">${SAUSAGE_SVG}${SLOGAN}</div>`, 'dim', 'archive');
    this._bind(page, { back: onBack });
  }

  showAbout(onBack) {
    const page = this._page(`
      <div class="page-head"><div><span class="tag">ABOUT</span><h2>说明</h2></div><button class="btn ghost" data-act="back">返回</button></div>
      <div class="about">
        <h3>目标</h3>
        <p>从塘口村出发，沿鳌山—太白山山脊走到拔仙台（约113公里），或者在合适的时候下撤。你会在一年中最冷的元旦假期出发。</p>
        <h3>操作</h3>
        <p>电脑：<kbd>WASD</kbd>/方向键移动，鼠标拖拽转视角，滚轮缩放，<kbd>Q</kbd><kbd>E</kbd>转视角；<kbd>F</kbd> 沿路走，<kbd>V</kbd> 切换速穿，<kbd>空格</kbd> 按住稳住（抗阵风），<kbd>R</kbd> 休息，<kbd>C</kbd> 扎营，<kbd>B</kbd> 背包，<kbd>M</kbd> 地图，<kbd>Esc</kbd> 菜单，<kbd>1</kbd>-<kbd>5</kbd> 选择对话选项。</p>
        <p>手机：左下角拖动摇杆移动，右侧拖动屏幕转视角，双指缩放。横屏、竖屏都可以玩。</p>
        <p>速穿可以随时切回常速：步子更快，体力、食物和水消耗更多，也更容易受伤；越野跑者能跑得更快。</p>
        <h3>身体</h3>
        <p><b>核心体温</b>是最重要的数值。风寒、潮湿、饥饿、疲劳都会让它下降；吃热的、喝热的、穿上保暖层、钻进睡袋能让它回升。低于35℃是失温，低于28℃就是死亡。只有护士能读出准确数字，其他人只能凭感觉。</p>
        <p><b>穿衣</b>：走路产热多，穿着羽绒服会出汗，湿掉的衣服不保暖；停下来不穿保暖层，很快就会冷。<b>棉质衣物</b>湿了几乎不保暖。</p>
        <p><b>压力</b>过高会出现幻觉。<b>水</b>会结冰，普通气罐在低温下很难点着。</p>
        <h3>山脊</h3>
        <p>大风天在山脊上会有<b>阵风</b>，看到"阵风！"提示时按住【稳住】压低重心，否则可能被吹倒，甚至被推下刃脊。<b>大雾</b>里路标会消失，"沿路走"可能会带偏，GPS能帮你找回路线。</p>
        <p><b>扎营</b>要看风：在背风坡、大石头后扎营；帐篷尾部（低矮的一端）对着来风。门朝来风会灌风积雪，侧面迎风容易被吹塌。</p>
        <h3>下撤与求救</h3>
        <p>任何时候都可以原路返回。过了2800营地，也可以在下撤菜单选择自行下撤，手动控制方向；游戏中降到1600米以下算成功。该判定不代表现实中已经脱险。有信号（且没开飞行模式）或有卫星通讯器时可以求救，求救后请原地等待——救援队会去你报告的位置。</p>
        <h3>声明</h3>
        <p>本游戏根据公开报道和"神秘园"系列视频讲述的事件改编，人物均为化名或虚构，情节经过艺术加工，仅用于安全警示。鳌太线自2018年起禁止穿越。游戏中的路线、海拔、气温与生理模型均为近似值，不能作为出行依据。</p>
        <p>字体：站酷庆科黄油体、VT323（SIL OFL 1.1）。引擎：three.js。</p>
      </div>`, 'dim', 'about');
    this._bind(page, { back: onBack });
  }

  // ———————————————————— HUD ————————————————————
  showHud(on) {
    const hud = this.el.hud;
    if (!on) { hud.hidden = true; this.el.joy.hidden = true; return; }
    if (!hud.dataset.built) {
      hud.dataset.built = '1';
      const ticks = WAYPOINTS.map((w) => `<i class="tick ${w.camp ? 'camp' : ''} ${w.bailout ? 'bail' : ''}" data-wp="${w.id}" style="left:${(w.km / WAYPOINTS[WAYPOINTS.length - 1].km) * 100}%"></i>`).join('');
      hud.innerHTML = `
        <div class="hud-left">
          <div class="device hcard">
            <div class="dev-top">
              <div class="dev-clock"><b data-h="clock">05:30</b><small data-h="date"></small></div>
              <div class="dev-wx"><span data-h="wxicon"></span><span data-h="wx"></span></div>
            </div>
            <div class="dev-grid">
              <div><small>气温</small><b data-h="air"></b></div>
              <div><small>体感</small><b data-h="feel"></b></div>
              <div class="dev-wind" data-h="windbox">
                <svg class="dial" viewBox="0 0 30 30"><circle class="ring" cx="15" cy="15" r="13"/><g class="needle" data-h="needle"><path d="M15 3 L20 19 L15 15.5 L10 19Z" fill="currentColor"/></g></svg>
                <div><small data-h="windk">风</small><b data-h="wind"></b></div>
              </div>
              <div><small>海拔</small><b data-h="alt"></b></div>
            </div>
          </div>
          <div class="route hcard">
          <div class="route-head"><span data-h="routek"></span><b data-h="km"></b></div>
          <div class="route-bar"><div class="track"></div><div class="done" data-h="done"></div>${ticks}<div class="me" data-h="me"></div></div>
          <div class="route-next" data-h="next"></div>
        </div>
          <div class="vitals hcard">
            ${VITALS.map(([k, n]) => `<div class="vital ${['food', 'water', 'stress', 'wet'].includes(k) ? 'vital-secondary' : ''}" data-v="${k}" aria-label="${n}">${icon(VITAL_ICON[k], { size: 16 })}<span class="lb">${n}</span><div class="bar"><i></i></div><span class="num"></span></div>`).join('')}
            <div class="chips"></div>
            <div class="comp" hidden></div>
          </div>
          <div class="alerts">
            <div class="pill gps" data-h="gps" hidden></div>
            <div class="pill lost" data-h="lost" hidden>${icon('warn', { size: 14 })} 偏离路线</div>
            <div class="pill rescue" data-h="rescue" hidden></div>
          </div>
        </div>
        <div class="hud-right">
          <div class="ibtns">
            <button class="ibtn" data-act="pack" title="背包 B">${icon('pack', { size: 24 })}<span>背包</span></button>
            <button class="ibtn" data-act="map" title="地图 M">${icon('map', { size: 24 })}<span>地图</span></button>
            <button class="ibtn" data-act="menu" title="菜单 Esc">${icon('menu', { size: 24 })}<span>菜单</span></button>
            <button class="ibtn more" data-act="hudmore" title="展开/收起次要信息" aria-expanded="false" aria-controls="hudSecondary">${icon('rest', { size: 24 })}<span data-h="moreLabel">更多</span></button>
          </div>
          <div class="pill phone" data-h="phone"></div>
        </div>
        <div class="actions">
          <div class="act-row act-row-secondary" id="hudSecondary" data-h="actSecondary">
            <button class="abtn" data-act="rest">${icon('rest', { size: 20 })}休息<kbd>R</kbd></button>
            <button class="abtn" data-act="retreat">${icon('retreat', { size: 20 })}下撤<kbd>X</kbd></button>
            <button class="abtn sos" data-act="sos">${icon('sos', { size: 20, accent: '#e5383b' })}求救<kbd>H</kbd></button>
          </div>
          <div class="act-row">
            <button class="abtn" data-act="camp">${icon('camp', { size: 20 })}扎营<kbd>C</kbd></button>
            <button class="abtn" data-act="pace" title="切换速穿 V" aria-pressed="false">${icon('walk', { size: 20 })}<span data-h="paceLabel">速穿</span><kbd>V</kbd></button>
            <button class="abtn big hold" data-hold="crouch">${icon('brace', { size: 26 })}稳住<kbd>␣</kbd></button>
            <button class="abtn big" data-act="auto">${icon('auto', { size: 26 })}沿路走<kbd>F</kbd></button>
          </div>
        </div>        ${this.isMobile ? '' : '<div class="keyhint"><span><kbd>WASD</kbd>移动</span><span><kbd>拖拽</kbd><kbd>Q</kbd><kbd>E</kbd>视角</span><span><kbd>F</kbd>沿路走</span><span><kbd>V</kbd>速穿</span><span><kbd>空格</kbd>稳住</span><span><kbd>B</kbd>背包</span><span><kbd>M</kbd>地图</span><span><kbd>G</kbd>查看血迹</span></div>'}
        <div class="gust">阵　风<small>按住【稳住】</small></div>
        <button class="remains-prompt" data-act="inspect-remains" hidden>查看血迹 <kbd>G</kbd></button>`;
      this.h = {};
      hud.querySelectorAll('[data-h]').forEach((e) => { this.h[e.dataset.h] = e; });
      this.hv = {};
      hud.querySelectorAll('[data-v]').forEach((e) => { this.hv[e.dataset.v] = { root: e, bar: e.querySelector('i'), num: e.querySelector('.num') }; });
      this.hTicks = [...hud.querySelectorAll('.tick')];
      this.hDevice = hud.querySelector('.device');
      this.hChips = hud.querySelector('.chips');
      this.hComp = hud.querySelector('.comp');
      this.hActions = hud.querySelector('.actions');
      this.hAuto = hud.querySelector('[data-act="auto"]');
      this.hPace = hud.querySelector('[data-act="pace"]');
      this.hCrouch = hud.querySelector('[data-hold="crouch"]');
      this.hGust = hud.querySelector('.gust');
      this._bind(hud, {
        pack: () => this.openPack(),
        map: () => this.openMap(),
        menu: () => this.openMenu(),
        'inspect-remains': () => void this.game?.inspectRemains(),
        auto: () => this.app.toggleAuto(),
        pace: () => this.app.togglePace(),
        rest: () => this.app.restMenu(),
        camp: () => this.app.camp(),
        retreat: () => this.app.retreat(),
        sos: () => this.app.sos(),
        hudmore: () => this.toggleHudMore(),
      });
    }
    hud.classList.toggle('compact', this.compactHud);
    const expanded = !this.compactHud || hud.classList.contains('hud-more');
    hud.querySelector('.vitals').hidden = false;
    hud.querySelector('.alerts').hidden = false;
    hud.querySelectorAll('.vital-secondary').forEach((e) => { e.hidden = !expanded; });
    this.h.actSecondary.hidden = !expanded;
    hud.hidden = false;
    this.el.joy.hidden = !this.isMobile;
  }

  setRemainsPrompt(record) {
    const id = record?.id || null;
    if (this._remainsPromptId === id) return;
    this._remainsPromptId = id;
    const button = this.el.hud.querySelector('.remains-prompt');
    if (!button) return;
    button.hidden = !record;
    if (record) button.textContent = record.own ? '查看自己的血迹　G' : '查看旅人血迹　G';
  }

  toggleHudMore() {
    const hud = this.el.hud;
    const on = !hud.classList.contains('hud-more');
    hud.classList.toggle('hud-more', on);
    const btn = hud.querySelector('[data-act="hudmore"]');
    if (btn) {
      btn.setAttribute('aria-expanded', String(on));
      const label = btn.querySelector('[data-h="moreLabel"]');
      if (label) label.textContent = on ? '收起' : '更多';
    }
    if (this._lastHud) this.hud(this._lastHud);
    this.audio?.click();
  }

  _set(el, html) { if (el._v !== html) { el._v = html; el.innerHTML = html; } }

  hud(d) {
    if (!this.h) return;
    const h = this.h;
    this._lastHud = d;
    this._set(h.clock, d.clock);
    this._set(h.date, `${d.date} · 第${d.day}天`);
    this.hDevice.classList.toggle('night', d.night);
    this._set(h.wxicon, icon(WEATHER_ICON[d.wid === 'clear' && d.night ? 'clearNight' : d.wid] || 'cloud', { size: 24 }));
    this._set(h.wx, d.weather);
    this._set(h.air, `${d.air}<em>°</em>`);
    this._set(h.feel, `<span class="${d.feel < -30 ? 'feel-danger' : ''}">${d.feel}</span><em>°</em>`);
    h.needle.style.transform = `rotate(${d.windRel}rad)`;
    h.windbox.classList.toggle('danger', d.bft >= 8);
    h.windbox.classList.toggle('warn', d.bft >= 6 && d.bft < 8);
    this._set(h.windk, `风 ${d.bft}级`);
    this._set(h.wind, `${d.wind}<em>m/s</em>`);
    this._set(h.alt, `${d.alt}<em>m</em>`);
    this._set(h.routek, esc(d.route));
    this._set(h.km, `${d.km.toFixed(1)}<em> / ${d.total.toFixed(0)} km</em>`);
    const tot = d.total || 1;
    h.done.style.width = `${Math.min(100, (d.maxKm / tot) * 100)}%`;
    h.me.style.left = `${Math.min(100, (d.km / tot) * 100)}%`;
    const showTicks = d.onMain;
    for (const t of this.hTicks) { t.style.display = showTicks ? '' : 'none'; t.classList.toggle('seen', !!d.visited[t.dataset.wp]); }
    this._set(h.next, d.next ? `<span>下一站 <b>${esc(d.next.name)}</b></span><span class="mono">${d.next.km.toFixed(1)} km</span>` : '');
    const hudCollapsed = this.compactHud && !this.el.hud.classList.contains('hud-more');
    this.el.hud.classList.toggle('compact', this.compactHud);
    h.actSecondary.hidden = hudCollapsed;
    h.gps.hidden = !d.gpsArrow;
    if (d.gpsArrow) h.gps.innerHTML = `${ICON_ARROW.replace('class="navarrow"', `class="navarrow" style="transform:rotate(${-d.gpsArrow.rel}rad)"`)}GPS ${d.gpsArrow.off > 80 ? `偏离 <b>${d.gpsArrow.off}</b>m` : '在轨迹上'}`;
    h.lost.hidden = !d.status.lost;
    h.rescue.hidden = d.rescue === null;
    if (d.rescue !== null) this._set(h.rescue, `${icon('flag', { size: 14 })} 等待搜救`);
    const sig = d.signal < 0 ? `${icon('plane', { size: 14 })}飞行模式` : d.signal === 0 ? '无信号' : `${icon('signal', { size: 14 })}${d.signal > 1 ? '信号良好' : '弱信号'}`;
    this._set(h.phone, `${icon('phone', { size: 14 })}<b>${d.phone}</b>% ${sig}`);
    h.phone.classList.toggle('air', d.signal < 0);
    h.phone.classList.toggle('low', d.phone < 15);

    const set = (k, pct, num, color, crit) => {
      const v = this.hv[k];
      v.bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
      v.bar.style.setProperty('--c', color);
      if (v.num.textContent !== String(num)) v.num.textContent = num;
      v.root.classList.toggle('crit', !!crit);
      v.root.hidden = hudCollapsed && v.root.classList.contains('vital-secondary') && !crit;
    };
    const coreColor = d.core >= 36.3 ? 'var(--green)' : d.core >= 35 ? 'var(--yellow)' : 'var(--red)';
    set('core', ((d.core - 30) / 7) * 100, d.showCore ? d.core.toFixed(1) : d.coreFeel, coreColor, d.core < 35);
    this.hv.core.num.classList.toggle('txt', !d.showCore);
    const lvl = (v) => (v > 50 ? 'var(--green)' : v > 25 ? 'var(--yellow)' : 'var(--red)');
    set('stamina', d.stamina, Math.round(d.stamina), lvl(d.stamina), d.stamina < 12);
    set('food', d.food, Math.round(d.food), lvl(d.food), d.food < 10);
    set('water', d.water, Math.round(d.water), lvl(d.water), d.water < 10);
    set('stress', d.stress, Math.round(d.stress), d.stress < 50 ? 'var(--blue)' : d.stress < 75 ? 'var(--yellow)' : 'var(--red)', d.stress > 80);
    const healthPct = d.health / (d.maxHealth || 100) * 100;
    set('health', healthPct, Math.round(d.health), lvl(healthPct), healthPct < 25);
    this.hv.health.root.setAttribute('aria-label', `健康 ${Math.round(d.health)} / ${d.maxHealth || 100}`);
    set('wet', d.wet, Math.round(d.wet), d.wet < 30 ? 'var(--blue)' : d.wet < 60 ? 'var(--yellow)' : 'var(--red)', d.wet > 70);

    const s = d.status;
    const chips = [[d.difficulty || '标准', 'g']];
    if (s.collapsed) chips.push(['体力耗尽 · 可爬行', '']);
    if (s.shiver) chips.push(['发抖', 'w']);
    if (s.sweat) chips.push(['出汗', 'w']);
    if (s.wet) chips.push(['衣服湿了', 'w']);
    if (s.sprain) chips.push(['崴脚', '']);
    if (s.fracture) chips.push(['骨折', '']);
    if (s.frost) chips.push(['冻伤', '']);
    if (s.snowblind) chips.push(['雪盲', '']);
    if (s.alt) chips.push(['高反', 'w']);
    if (s.drunk) chips.push(['酒精', 'w']);
    if (s.warmer) chips.push(['暖宝宝', 'g']);
    chips.push([d.insul ? '穿着保暖层' : d.hasInsul ? '未穿保暖层' : '无保暖层', d.insul ? 'g' : 'w']);
    const visibleChips = hudCollapsed ? chips.filter(([t,c]) => c !== 'g' && !['未穿保暖层', '无保暖层'].includes(t)).slice(0, 2) : chips;
    this.hChips.hidden = visibleChips.length === 0;
    this._set(this.hChips, visibleChips.map(([t, c]) => `<span class="${c}">${t}</span>`).join(''));

    const visibleCompanions = hudCollapsed ? d.companions.filter((c) => c.cond < 20) : d.companions;
    this.hComp.hidden = visibleCompanions.length === 0;
    this._set(this.hComp, visibleCompanions.map((c) => `<div class="vital ${c.cond < 20 ? 'crit' : ''}">${icon('walk', { size: 16 })}<span class="lb">${esc(c.name)}</span><div class="bar"><i style="width:${c.cond}%;--c:${c.cond > 50 ? 'var(--green)' : c.cond > 25 ? 'var(--yellow)' : 'var(--red)'}"></i></div><span class="num">${Math.round(c.cond)}</span></div>`).join(''));

    this.hAuto.classList.toggle('on', d.auto);
    this.hPace.classList.toggle('on', !!d.fast);
    this.hPace.setAttribute('aria-pressed', String(!!d.fast));
    this._set(h.paceLabel, d.fast ? '速穿中' : '速穿');
    this.hCrouch.classList.toggle('held', d.crouch);
    this.hActions.hidden = d.inCamp;
    this.el.joy.hidden = !this.isMobile || d.inCamp;
    if (this.busyClock) this.busyClock.textContent = d.clock;
  }

  gustWarn() {
    if (!this.hGust) return;
    this.hGust.classList.remove('on');
    void this.hGust.offsetWidth;
    this.hGust.classList.add('on');
    this.hCrouch.classList.add('alert');
    clearTimeout(this._gustT);
    this._gustT = setTimeout(() => this.hCrouch.classList.remove('alert'), 1300);
  }

  setEffects(e) {
    const f = this.el.fx;
    f.cold.style.opacity = (e.cold * 0.7).toFixed(2);
    f.hunger.style.opacity = (e.hunger * 0.62).toFixed(2);
    f.thirst.style.opacity = (e.thirst * 0.58).toFixed(2);
    f.fatigue.style.opacity = (e.fatigue * 0.7).toFixed(2);
    f.wet.style.opacity = (e.wet * 0.62).toFixed(2);
    f.altitude.style.opacity = (e.altitude * 0.62).toFixed(2);
    f.hurt.style.opacity = (e.hurt * 0.8).toFixed(2);
    f.stress.style.opacity = (e.stress * 0.8).toFixed(2);
    f.white.style.opacity = e.white.toFixed(2);
    f.dark.style.opacity = e.dark.toFixed(2);
    f.frost.style.opacity = Math.min(1, (e.frost || 0) * 0.55 + e.cold * 0.6).toFixed(2);
    f.wind.style.opacity = ((e.wind || 0) * 0.9).toFixed(2);
    const blur = Math.min(3, e.blur * 3);
    const key = blur.toFixed(1);
    if (key !== this._blurKey) {
      this._blurKey = key;
      this.el.canvas.style.filter = blur > 0.1 ? `blur(${key}px)` : '';
    }
  }

  flash() {
    const f = this.el.fx.flash;
    f.style.opacity = '1';
    setTimeout(() => { f.style.opacity = '0'; }, 120);
  }

  toast(text, kind = 'info', ms = 3800) {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    this.el.toasts.appendChild(t);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstElementChild.remove();
    if (kind === 'danger') this.audio?.alert();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, ms);
  }

  card(name, sub, desc) {
    const c = this.el.card;
    c.innerHTML = `<div class="cn">${esc(name)}</div><div class="cs">${esc(sub)}</div><div class="cd">${esc(desc)}</div>`;
    c.classList.remove('on');
    void c.offsetWidth;
    c.classList.add('on');
  }

  setBusy(text, showClock = false) {
    const b = this.el.busy;
    if (!text) { b.classList.remove('on'); this.busyClock = null; return; }
    b.innerHTML = `<div class="bx"><div class="bt">${esc(text)}</div>${showClock ? '<div class="bc"></div>' : ''}</div>`;
    this.busyClock = showClock ? b.querySelector('.bc') : null;
    if (this.busyClock && this._lastHud) this.busyClock.textContent = this._lastHud.clock;
    b.classList.add('on');
  }

  // ———————————————————— 对话 ————————————————————
  dialog(opts) {
    const run = () => new Promise((resolve) => {
      this.dialogOpen = true;
      this._syncInput();
      const d = this.el.dialog;
      let choices = opts.choices.map((c, i) => ({ ...c, i }));
      if (opts.shuffle) choices = choices.sort(() => Math.random() - 0.5);
      const paras = (opts.text || []).filter(Boolean).map((p) => `<p class="${p.startsWith('【护士】') ? 'nurse' : ''}">${esc(p)}</p>`).join('');
      d.innerHTML = `<div class="dlg ${opts.shuffle ? 'shaky' : ''}">
        <div class="dlg-head"><h3>${esc(opts.who || '')}</h3>${opts.sub ? `<div class="sub">${esc(opts.sub)}</div>` : ''}</div>
        <div class="dlg-body">${paras}</div>
        <div class="dlg-choices">${choices.map((c, k) => `<button class="choice" data-id="${esc(c.id)}" ${c.disabled ? 'disabled' : ''}>
          <b>${this.isMobile ? '' : `<span class="mono" style="color:var(--muted);margin-right:6px">${k + 1}</span>`}${esc(c.label)}</b>${c.sub ? `<small>${esc(c.sub)}</small>` : ''}</button>`).join('')}</div></div>`;
      d.classList.add('open');
      let selected = null, settled = false, resultReady = false;
      const finish = (id) => {
        if (settled) return;
        settled = true;
        d.classList.remove('open');
        d.innerHTML = '';
        window.removeEventListener('keydown', onKey);
        this.dialogOpen = false;
        this._syncInput();
        resolve(id);
      };
      const select = async (id) => {
        if (selected !== null || settled) return;
        selected = id;
        const canPoll = opts.poll && this.analytics && (import.meta.env.PROD || globalThis.__AOTAI_TEST_ANALYTICS__);
        if (!canPoll) return finish(id);
        d.querySelector('.dlg').classList.add('showing-results');
        d.querySelectorAll('.choice').forEach(b => {
          b.disabled = true;
          b.classList.toggle('is-picked', b.dataset.id === id);
          const score = document.createElement('span');
          score.className = 'poll-score'; score.textContent = '…'; b.appendChild(score);
          const bar = document.createElement('i'); bar.className = 'poll-bar'; b.appendChild(bar);
        });
        const footer = document.createElement('div');
        footer.className = 'dlg-poll-feedback';
        footer.innerHTML = `<div class="poll-status" role="status" aria-live="polite">正在读取玩家选择分布…</div><div class="poll-actions">${this.analytics.enabled ? '' : '<button class="sbtn alt" data-act="poll-consent">参与匿名统计</button>'}<button class="sbtn" data-act="poll-continue" disabled>继续</button></div>`;
        d.querySelector('.dlg').appendChild(footer);
        const status = footer.querySelector('.poll-status');
        const next = footer.querySelector('[data-act="poll-continue"]');
        next.addEventListener('click', () => { if (resultReady) finish(id); });
        let loadSeq = 0;
        const load = async () => {
          const ticket = ++loadSeq;
          resultReady = false; next.disabled = true; status.textContent = '正在读取玩家选择分布…';
          let result = null, deadline;
          try {
            result = await Promise.race([
              this.analytics.choose(this.game?.st, opts.poll, id),
              new Promise(resolve => { deadline = setTimeout(() => resolve(null), 2500); }),
            ]);
          } catch {} finally { clearTimeout(deadline); }
          if (settled || !footer.isConnected || ticket !== loadSeq) return;
          const stats = distribution(opts.poll, result);
          d.querySelectorAll('.choice').forEach(b => {
            const v = stats?.values[b.dataset.id];
            b.querySelector('.poll-score').textContent = v?.percent == null ? '—' : `${v.percent}%`;
            b.querySelector('.poll-bar').style.width = `${v?.percent || 0}%`;
            if (v) b.setAttribute('aria-label', `${choices.find(c => c.id === b.dataset.id)?.label}，${v.count}次选择${v.percent == null ? '，暂无比例' : `，${v.percent}%`}${b.dataset.id === id ? '，本次已选' : ''}`);
          });
          status.textContent = !stats ? '统计暂不可用，可继续游玩。' : !stats.total ? '暂无已上报选择，不代表任何选项更好。' : `${stats.total.toLocaleString()}次有效首选${stats.total < 20 ? ' · 样本较少' : ''} · 比例不代表正确率${result.recorded ? ' · 含本次' : ''}`;
          if (!this.analytics.enabled) status.textContent += ' 你的选择仅保存在本机。';
          resultReady = true; next.disabled = false;
        };
        const join = footer.querySelector('[data-act="poll-consent"]');
        join?.addEventListener('click', async () => {
          join.disabled = true;
          this.analytics.setEnabled(true);
          this.analytics.beginRun(this.game?.st, { fresh: false });
          this.game?.save();
          join.remove();
          await load();
        });
        void load();
      };
      const onKey = (e) => {
        if (selected !== null) {
          if ((e.key === 'Enter' || e.key === ' ') && resultReady) { e.preventDefault(); finish(selected); }
          return;
        }
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= choices.length && !choices[n - 1].disabled) { e.preventDefault(); void select(choices[n - 1].id); }
      };
      window.addEventListener('keydown', onKey);
      const openedAt = performance.now();
      d.querySelectorAll('.choice').forEach((b) => b.addEventListener('click', () => {
        // 防止弹窗出现时手指/鼠标正好落在选项上造成误触
        if (performance.now() - openedAt < 450) return;
        this.audio?.click();
        void select(b.dataset.id);
      }));
    });
    const p = this.dialogQueue.then(run);
    this.dialogQueue = p.catch(() => {});
    return p;
  }

  // ———————————————————— 抽屉 ————————————————————
  _sheet(name, title, body, wide = false) {
    this.sheetOpen = name;
    this._syncInput();
    this.el.sheet.innerHTML = `<div class="drawer ${wide ? 'wide' : ''}"><div class="drawer-head"><h3>${title}</h3><button class="sbtn alt" data-act="close">关闭</button></div>
      <div class="drawer-body">${body}</div></div>`;
    this.el.sheet.classList.add('open');
    return this.el.sheet.firstElementChild;
  }

  closeSheet() {
    this.el.sheet.classList.remove('open');
    this.el.sheet.innerHTML = '';
    this.sheetOpen = null;
    this._syncInput();
  }

  toggleSheet(name) {
    if (this.sheetOpen === name) return this.closeSheet();
    if (name === 'pack') this.openPack();
    if (name === 'map') this.openMap();
    if (name === 'menu') this.openMenu();
  }

  openPack(keepScroll = false) {
    const g = this.game, st = g.st;
    if (!st) return;
    const prevScroll = keepScroll ? this.el.sheet.querySelector('.drawer-body')?.scrollTop : 0;
    const b = st.body;
    const clothIds = Object.keys(st.inv).filter((id) => ITEMS[id]?.kind === 'cloth' && st.inv[id] > 0);
    const w = packWeight(st), cap = packCapacity(st);
    const foods = Object.keys(ITEMS).filter((id) => ITEMS[id].kind === 'food' && has(st, id));
    const fire = ensureFire(st);
    const canCook = has(st, 'stove') && has(st, 'pot') && fireCostAvailable(st, 1);
    const gasN = st.gas.normal + st.gas.alpine;
    const stat = (k, v, cls = '') => `<div class="stat"><div class="k">${k}</div><div class="v ${cls}">${v}</div></div>`;
    const injuries = [b.sprain > 0 && '崴脚', b.fracture >= 1 && '骨折', b.fracture > 0 && b.fracture < 1 && '骨折（已固定）', b.frostbite > 25 && `冻伤 ${Math.round(b.frostbite)}`, b.snowblind > 30 && '雪盲', b.altSick > 30 && '高反'].filter(Boolean);
    const sig = g.signal();
    const devRow = (name, sub, btns) => `<div class="row"><div class="l"><b>${name}</b><small>${sub}</small></div><div class="r">${btns}</div></div>`;
    const effects = st.story?.effects || {};
    const foodEffects = activeFoodEffects(st);
    const activeEffects = [effects.headlampFault && '头灯接触不良：夜间有效照明降低', effects.tentLeak && '帐篷漏风：帐内保暖下降', effects.navigationCheckedUntil > st.time && '已核对导航：暂时减小雾中漂移', effects.runnerPaceUntil > st.time && '调整配速：速度降低、运动强度降低', effects.sharedLoadUntil > st.time && '同行协作：队形速度暂时改善'].filter(Boolean);
    const lampMode = ensureLampMode(st);
    const foodDescription = (id) => {
      const item = ITEMS[id];
      const base = item.needsHot ? (st.thermos.l >= 0.3 && st.thermos.temp > 50 ? '可用保温杯热水冲泡' : '没有热水，只能干嚼') : item.alcohol ? '酒精会增加失温风险' : `饱食 +${item.food || 0}`;
      return [base, foodEffectSummary(id)].filter(Boolean).join(' · ');
    };
    const body = `
      ${activeEffects.length || foodEffects.length ? `<div class="sec"><h4>路途状态</h4>${activeEffects.length ? `<ul>${activeEffects.map((v) => `<li>${esc(v)}</li>`).join('')}</ul>` : ''}
         ${foodEffects.length ? `<div class="food-effects"><span class="effect-label">食物效果</span>${foodEffects.map((effect) => `<span class="effect-chip" data-effect="${esc(effect.id)}">${esc(effect.label)} · ${effect.minutes}分钟</span>`).join('')}</div>` : ''}
        ${effects.headlampFault ? '<button class="sbtn" data-act="repair" data-id="headlamp_contact">检查头灯触点</button>' : ''}
        ${effects.tentLeak && st.camp?.inside ? '<button class="sbtn" data-act="repair" data-id="windproof_lash">修补帐布裂口</button>' : ''}</div>` : ''}
      ${st.rescue?.self ? `<div class="sec"><h4>救援联络</h4>${devRow('重新报告当前位置', st.rescue.moved ? '你已离开报告点；联系成功才更新坐标。' : '必要转移时保持联系；更新不等于救援已到达。', `<button class="sbtn" data-act="rescueUpdate" ${g.comms().any ? '' : 'disabled'}>更新坐标</button>`)}</div>` : ''}
      <div class="sec"><h4>身体</h4>
        <div class="grid2">
          ${stat('核心体温', g.role.mods.showCore ? b.core.toFixed(1) + '℃' : esc(this._lastHud?.coreFeel ?? ''), b.core < 35 ? 'danger-text' : '')}
          ${stat('健康', Math.round(b.health), b.health < 30 ? 'danger-text' : '')}
          ${stat('衣物潮湿', Math.round(b.wet) + '%', b.wet > 50 ? 'warn-text' : '')}
          ${stat('压力', Math.round(b.stress), b.stress > 75 ? 'danger-text' : '')}
        </div>
        <div class="pressure-tip">压力提示：温暖睡眠、吃饱且有水时睡眠更能缓解；美味食物可缓压。伤痛、低温、饥渴、低体力会持续增压，骨折恶化可能带来一次冲击。</div>
        ${devRow('急救包', `剩 ${st.inv.firstaid || 0} 个${g.role.mods.firstAid >= 1 ? ' · 护士处理效果翻倍' : ''}`, `<button class="sbtn" data-act="aid" ${has(st, 'firstaid') ? '' : 'disabled'}>处理伤口</button>`)}
        ${devRow('暖宝宝', st.warmerLeft > 0 ? `正在发热，还剩约 ${Math.round(st.warmerLeft / 60)} 小时 · 剩 ${st.warmers} 片` : `剩 ${st.warmers} 片`, `<button class="sbtn" data-act="warmer" ${st.warmers > 0 ? '' : 'disabled'}>贴一片</button>`)}
      </div>
      <div class="sec clothing-sec"><h4>穿着 <em>${clothIds.length} 件</em></h4>
                 ${clothIds.length ? clothIds.map((id) => {
           const item = ITEMS[id];
           const wornNow = isClothWorn(st, id);
           const wet = Math.round(garmentWetness(st, id));
           const wetClass = wet >= 60 ? 'wet-high' : wet >= 25 ? 'wet-mid' : '';
           return devRow(`${esc(item.name)} <span class="slot-tag">${esc(SLOT_NAMES[item.slot] || item.slot)}</span>`, `${wornNow ? '穿着中' : '收在包里'} · 湿度 <span class="${wetClass}">${wet}%</span>`, `<button class="sbtn ${wornNow ? 'on' : 'alt'}" data-act="clothing" data-id="${esc(id)}">${wornNow ? '脱下' : '穿上'}</button>`);
         }).join('') : '<div class="empty-note">没有可穿的衣物。</div>'}
        <div style="font-size:12px;color:var(--muted);margin:4px 0 6px">衣物可按件换穿；脱下后仍留在背包。行走会出汗，湿衣保暖效果较差。</div>
      </div>
      <div class="sec"><h4>饮水 <em>${gasN > 0 ? `气罐 ${st.gas.alpine ? '高山' + st.gas.alpine : ''}${st.gas.alpine && st.gas.normal ? ' / ' : ''}${st.gas.normal ? '普通' + st.gas.normal : ''} 次` : '无气罐'}</em></h4>
        ${has(st, 'thermos') ? devRow('保温杯', `${st.thermos.l.toFixed(2)} L · ${st.thermos.l > 0.04 ? Math.round(st.thermos.temp) + '℃' : '空'}`, `<button class="sbtn" data-act="thermos" ${st.thermos.l > 0.04 ? '' : 'disabled'}>喝一口</button>`) : ''}
        ${devRow('水瓶', `液态 ${st.water.liquid.toFixed(2)} L · 结冰 ${st.water.frozen.toFixed(2)} L`, `<button class="sbtn" data-act="water" ${st.water.liquid > 0.04 ? '' : 'disabled'}>喝一口</button>`)}
        ${devRow('烧雪化水', canCook ? `已点火 · 火焰余额${fire.balance} · 帐外约15分钟` : fire.active ? `火焰余额${fire.balance}不足或需要炉头和锅` : '需要先在营地页点火，再回到帐外烧水', `<button class="sbtn" data-act="cook" ${canCook ? '' : 'disabled'}>烧水</button>`)}
        ${devRow('吃雪', '解渴很少，消耗体温', '<button class="sbtn alt" data-act="snow">吃雪</button>')}
      </div>
      <div class="sec"><h4>食物 <em>饱食 ${Math.round(b.food)}</em></h4>
        ${foods.length ? foods.map((id) => devRow(`${esc(ITEMS[id].name)} ×${st.inv[id]}`, esc(foodDescription(id)), `<button class="sbtn" data-act="eat" data-id="${id}">吃</button>`)).join('') : '<div class="empty-note">没有食物了。</div>'}
      </div>
      <div class="sec"><h4>设备</h4>
        ${devRow('手机', `电量 ${Math.round(st.bat.phone)}% · ${st.airplane ? '飞行模式' : sig ? '有信号' : '无信号'}`, `<button class="sbtn ${st.airplane ? 'on' : 'alt'}" data-act="air">${st.airplane ? '关飞行' : '开飞行'}</button>${st.powerbank > 0 ? '<button class="sbtn alt" data-act="charge" data-id="phone">充电</button>' : ''}`)}
        ${has(st, 'gps') ? devRow('手持GPS', `电量 ${Math.round(st.bat.gps)}% · ${st.gpsOn ? '开启' : '关闭'}`, `<button class="sbtn ${st.gpsOn ? 'on' : 'alt'}" data-act="gps">${st.gpsOn ? '关闭' : '打开'}</button>${st.powerbank > 0 ? '<button class="sbtn alt" data-act="charge" data-id="gps">充电</button>' : ''}`) : ''}
        ${has(st, 'headlamp') ? devRow('头灯', `电量 ${Math.round(st.bat.headlamp)}% · ${st.lampOn ? '当前亮' : '当前灭'} · ${lampMode === 'auto' ? '自动' : lampMode === 'on' ? '常亮' : '关闭'}`, `<div class="mode-buttons" role="group" aria-label="头灯模式">${[['auto', '自动'], ['on', '常亮'], ['off', '关闭']].map(([mode, label]) => `<button class="sbtn ${lampMode === mode ? 'on' : 'alt'}" data-act="lampMode" data-mode="${mode}" aria-pressed="${lampMode === mode}">${label}</button>`).join('')}</div>${st.powerbank > 0 ? '<button class="sbtn alt" data-act="charge" data-id="headlamp">充电</button>' : ''}`) : ''}
        ${has(st, 'satcomm') ? devRow('北斗卫星通讯器', `电量 ${Math.round(st.bat.satcomm)}% · 无信号也能求救`, '') : ''}
        ${devRow('充电宝', st.powerbank > 0 ? `还能充 ${st.powerbank} 次` : '没有了', '')}
        ${devRow('贴身保暖', '把手机、充电宝、气罐揣在怀里，减缓低温掉电和气罐失效', `<button class="sbtn ${st.keepWarm ? 'on' : 'alt'}" data-act="warm">${st.keepWarm ? '已贴身' : '揣进怀里'}</button>`)}
      </div>
      ${st.companions.length ? `<div class="sec"><h4>同伴</h4>${st.companions.map((id) => devRow(esc(npcById(id).name), `状况 ${Math.round(st.npcs[id].cond)}`, `<button class="sbtn" data-act="care" data-id="${id}" data-w="hot">热水</button><button class="sbtn" data-act="care" data-id="${id}" data-w="food">吃的</button><button class="sbtn alt" data-act="care" data-id="${id}" data-w="warmer">暖宝宝</button>`)).join('')}</div>` : ''}
      <div class="sec"><h4>背包 <em style="color:${w > cap ? 'var(--red)' : 'inherit'}">${w.toFixed(1)}/${cap} kg</em></h4>
        <div style="font-size:13px;color:var(--ink2)">${Object.keys(st.inv).filter((id) => ['tent', 'bag', 'pad', 'tool', 'pack', 'med'].includes(ITEMS[id]?.kind)).map((id) => esc(ITEMS[id].name) + (st.inv[id] > 1 ? '×' + st.inv[id] : '')).join('、') || '—'}</div>
      </div>`;
    const el = this._sheet('pack', '背包', body);
    if (keepScroll) el.querySelector('.drawer-body').scrollTop = prevScroll;
    const re = () => { this.openPack(true); };
    this._bind(el, {
      close: () => this.closeSheet(),
      repair: async (d) => { this.closeSheet(); await g.repairEquipment(d.id); },
      rescueUpdate: () => { g.updateRescuePosition(); re(); },
      aid: () => { g.useFirstAid(); re(); },
      warmer: () => { g.useWarmer(); re(); },
      clothing: async (d) => { if (typeof g.equipClothing === 'function') await g.equipClothing(d.id); re(); },
      thermos: () => { g.drinkThermos(); re(); },
      water: () => { g.drinkWater(); re(); },
      snow: () => { g.eatSnow(); re(); },
      cook: async () => { this.closeSheet(); await g.cook(); },
      eat: (d) => { g.eat(d.id); re(); },
      air: () => { st.airplane = !st.airplane; re(); },
      gps: () => { st.gpsOn = !st.gpsOn && st.bat.gps > 0; re(); },
      lampMode: (d) => { if (typeof g.setLampMode === 'function') g.setLampMode(d.mode); else st.lampMode = ['auto', 'on', 'off'].includes(d.mode) ? d.mode : 'auto'; re(); },
      charge: (d) => { g.charge(d.id); re(); },
      warm: () => { st.keepWarm = !st.keepWarm; re(); },
      care: (d) => { g.careNpc(d.id, d.w); re(); },
    });
  }

  openMap(mode = 'satellite', scope = 'nearby', scrollTop = 0) {
    const g = this.game, st = g.st;
    if (!st) return;
    const selectedMode = mode === 'elevation' ? 'elevation' : 'satellite';
    const selectedScope = scope === 'all' ? 'all' : 'nearby';
    const notes = (w) => [w.camp && '营地', w.water && '水源', w.signal && (w.signal > 1 ? '信号好' : '弱信号'), w.bailout && '下撤参考', w.end && '终点'].filter(Boolean).join(' · ');
    const render = (nextMode, nextScope, keepScroll = 0) => {
      const branchRows = Object.values(BRANCHES).map((branch) => {
        const sourceLinks = (branch.sourceLinks || []).filter((source) => typeof source.url === 'string' && source.url.startsWith('https://'));
        return `<details class="branch-reference"><summary><b>${esc(branch.name || '事故参考支线')}</b><small>${esc(branch.basis || '事故区域参考')} · ${Number.isFinite(branch.lengthKm) ? `${branch.lengthKm}km（游戏设定）` : '里程为游戏设定'}</small></summary>
          <div class="branch-reference-body"><p>${esc(branch.desc || '')}</p><p><b>事实边界：</b>${esc(branch.warning || '仅供游戏叙事参考，不代表存在固定道路或安全出口。')}</p>
            ${sourceLinks.length ? `<ul>${sourceLinks.map((source) => `<li><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.label || '查看来源')}</a></li>`).join('')}</ul>` : ''}</div></details>`;
      }).join('');
      const wps = WAYPOINTS.map((w) => ({ ...w, visited: !!st.visited[w.id] }));
      const waypointRows = wps.map((w) => `<div class="row ${w.visited ? 'done' : ''}"><div class="l"><b>${esc(w.name)}</b><small>${esc(notes(w))}</small></div><div class="r mono map-km">${w.km}km · ${w.alt}m</div></div>`).join('');
      const svg = routeMapSVG(st, { mode: nextMode, scope: nextScope, width: 900, height: 650 });
      const body = `
        <div class="map-controls" role="group" aria-label="地图显示">
          <div class="map-segment" role="group" aria-label="地图样式">
            <button class="sbtn ${nextMode === 'satellite' ? 'on' : 'alt'}" data-act="mapMode" data-mode="satellite" aria-pressed="${nextMode === 'satellite'}">卫星式</button>
            <button class="sbtn ${nextMode === 'elevation' ? 'on' : 'alt'}" data-act="mapMode" data-mode="elevation" aria-pressed="${nextMode === 'elevation'}">高程</button>
          </div>
          <div class="map-segment" role="group" aria-label="地图范围">
            <button class="sbtn ${nextScope === 'nearby' ? 'on' : 'alt'}" data-act="mapScope" data-scope="nearby" aria-pressed="${nextScope === 'nearby'}">当前位置</button>
            <button class="sbtn ${nextScope === 'all' ? 'on' : 'alt'}" data-act="mapScope" data-scope="all" aria-pressed="${nextScope === 'all'}">全线与支线</button>
          </div>
        </div>
        <div class="route-map-frame">${svg}</div>
        <p class="map-disclaimer">地图为游戏内地形示意，不是真实卫星影像或导航资料。虚线仅为事故参考·虚构支线，连接、方位和里程均为游戏设定，不代表现实道路或安全下撤通道。</p>
        <div class="sec branch-list"><h4>事故参考·虚构下撤支线 <em>${Object.keys(BRANCHES).length}条</em></h4>
          <p class="map-disclaimer">仅供游戏情节参考；事故搜救区域或原计划节点，不证明存在固定通道。展开查看来源与事实边界。</p>
          ${branchRows || '<div class="empty-note">当前没有支线资料。</div>'}
        </div>
        <details class="map-waypoints"><summary>途经点资料 · ${wps.length}处（海拔与里程为近似游戏设定）</summary><div class="wplist">${waypointRows}</div></details>
        <div class="sec"><h4>行程日志</h4><div class="loglist">
          ${st.log.slice().reverse().map((l) => `<div><span class="t">${fmtDateTime(l.t)}</span>${esc(l.text)}</div>`).join('') || '<div>还没有记录。</div>'}
        </div></div>`;
      const el = this._sheet('map', '路线地图', body, true);
      el.querySelector('.drawer-body').scrollTop = keepScroll;
      this._bind(el, {
        close: () => this.closeSheet(),
        mapMode: (d) => render(d.mode, nextScope, el.querySelector('.drawer-body').scrollTop),
        mapScope: (d) => render(nextMode, d.scope, el.querySelector('.drawer-body').scrollTop),
      });
    };
    render(selectedMode, selectedScope, scrollTop);
  }

  openMenu() {
    const muted = this.audio?.muted;
    const world = this.game.world;
    const qBtn = (k, n) => `<button class="sbtn ${world.qname === k ? 'on' : 'alt'}" data-act="q" data-id="${k}">${n}</button>`;
    const vol = this.music ? Math.round(this.music.volume * 100) : 0;
    const el = this._sheet('menu', '菜单', `
      <div class="sec" style="display:flex;flex-direction:column;gap:10px">
        <button class="btn primary" data-act="close">继续</button>
      </div>
      <div class="sec"><h4>画质</h4>
        <div class="row"><div class="l"><b>渲染质量</b><small>精美：实时阴影、泛光、调色；流畅：适合老手机</small></div>
          <div class="r">${qBtn('low', '流畅')}${qBtn('mid', '均衡')}${qBtn('high', '精美')}</div></div>
      </div>
      <div class="sec"><h4>声音</h4>
        <div class="row"><div class="l"><b>全部声音</b><small>风声、脚步、音乐</small></div><div class="r"><button class="sbtn ${muted ? 'alt' : 'on'}" data-act="sound">${muted ? '已关闭' : '开启'}</button></div></div>
        <div class="row"><div class="l"><b>背景音乐</b><small>随处境变化的配乐 · ${vol}%</small></div>
          <div class="r"><button class="sbtn alt" data-act="vol" data-d="-0.15">−</button><button class="sbtn alt" data-act="vol" data-d="0.15">＋</button></div></div>
      </div>
      <div class="sec" style="display:flex;flex-direction:column;gap:10px">
        <button class="btn ghost" data-act="archive">事故档案</button>
        <button class="btn ghost" data-act="about">操作说明</button>
        <button class="btn danger" data-act="quit">放弃本局，回到标题</button>
      </div>
      ${this.privacyControls()}
      ${this.remainsControls()}
      <div style="font-size:12px;color:var(--muted)">游戏会在抵达途经点、睡觉后自动存档。</div>`);
    this._bind(el, {
      close: () => this.closeSheet(),
      privacy: () => { this.app.toggleAnalytics(); this.openMenu(); },
      remains: () => { this.app.toggleRemains(); this.openMenu(); },
      'remains-shared': () => { this.app.toggleRemains(true); this.openMenu(); },
      'remains-clear': () => { this.app.clearRemains(); this.openMenu(); },
      q: (d) => { world.applyQuality(d.id); this.openMenu(); },
      sound: () => { this.audio?.setMuted(!this.audio.muted); this.openMenu(); },
      vol: (d) => { if (this.music) this.music.setVolume(Math.max(0, Math.min(1, this.music.volume + Number(d.d)))); this.openMenu(); },
      archive: () => { this.closeSheet(); this.showArchive(() => this.closeScreen()); },
      about: () => { this.closeSheet(); this.showAbout(() => this.closeScreen()); },
      quit: async () => {
        this.closeSheet();
        const c = await this.dialog({ who: '放弃本局？', text: ['存档会被删除。'], choices: [{ id: 'y', label: '放弃' }, { id: 'n', label: '再想想' }] });
        if (c === 'y') this.app.quit();
      },
    });
  }

  // ———————————————————— 营地 ————————————————————
  showCampPlacer(info, h) {
    this.hideCampPlacer();
    const box = document.createElement('div');
    box.className = 'campbox panel';
    box.id = 'campPlacer';
    document.body.appendChild(box);
    this._placerH = h;
    this.updateCampPlacer(info);
    this._bind(box, {
      l: () => h.rotate(-Math.PI / 8), r: () => h.rotate(Math.PI / 8), best: () => h.best(), ok: () => h.confirm(), no: () => h.cancel(),
    });
    this.hActions && (this.hActions.hidden = true);
  }

  updateCampPlacer(info) {
    const box = $('#campPlacer');
    if (!box) return;
    box.innerHTML = `
      <h4>选择扎营朝向 <span class="mono" style="font-size:18px;color:var(--blue)">${esc(info.windDir)} ${info.windMs}m/s</span></h4>
      <div class="info">
        <span>风暴露</span><span class="grade-${info.exposure.includes('低') ? 'good' : info.exposure.includes('高') ? 'bad' : 'mid'}">${esc(info.exposure)}</span>
        <span>帐篷朝向</span><span class="grade-${info.grade}">${esc(info.orient)}</span>
        ${info.risk ? `<span>抗风</span><span>${esc(info.risk)}</span>` : ''}
      </div>
      <div class="tip">${esc(info.tip)} 白色箭头是风吹去的方向。</div>
      <div class="btns">
        <button class="btn ghost" data-act="l">⟲</button><button class="btn ghost" data-act="r">⟳</button>
        ${info.canBest ? '<button class="btn ghost" data-act="best">老驴经验：对准</button>' : ''}
        <button class="btn primary" data-act="ok">在这里扎营</button><button class="btn ghost" data-act="no">取消</button>
      </div>`;
  }

  hideCampPlacer() {
    $('#campPlacer')?.remove();
  }

  showCampMenu(info) {
    this.hideCampMenu();
    const box = document.createElement('div');
    box.className = 'campbox panel';
    box.id = 'campMenu';
    const g = this.game;
    const canDry = info.canDry ?? canDryClothes(g.st);
    const dryCount = canDry ? dryableClothes(g.st).length : 0;
    box.innerHTML = `
      <h4>${info.bivy ? '露宿' : '营地'} · ${esc(g.placeName())}
        ${info.tentHealth !== null ? `<span class="mono" style="font-size:18px;color:${info.tentHealth < 40 ? 'var(--red)' : 'var(--muted)'}">帐篷 ${info.tentHealth}%</span>` : ''}</h4>
      ${info.rescue !== null ? `<div class="tip" style="border-color:var(--orange)">搜救正在进行，抵达时间无法确认。保持体温，原地等待。</div>` : ''}
       <div class="tip fire-tip" style="border-color:${info.fireLit ? 'var(--orange)' : 'var(--line2)'}">${info.fireLit ? `炉火已点燃 · ${info.fireFuel === 'alpine' ? '高山气罐' : '普通气罐'} · 火焰余额 ${info.fireBalance}` : info.canLightFire ? '炉火未点燃。先点火，才能烧水、煮方便面或用火烘衣。' : '没有可点燃的完整炉具（需要炉头、打火机和气罐）。'}${info.fireScrapped ? ` · 已报废 ${info.fireScrapped} 瓶` : ''}</div>
       ${canDry ? `<div class="tip dry-tip">帐内只安全晾衣，不生明火。${dryCount ? `可晾 ${dryCount} 件未穿湿衣。` : '请先在背包脱下湿衣，并留足一层保暖衣。'}</div>` : ''}
      <div class="btns">
        <button class="btn primary" data-act="sleep">${info.night ? '睡到天亮' : '小睡两小时'}</button>
        <button class="btn" data-act="rest">休息1小时</button>
        ${info.canLightFire ? '<button class="btn" data-act="light">点火</button>' : ''}
         <button class="btn" data-act="cook" ${info.canCook ? '' : 'disabled'}>烧水${info.fireLit ? ` · ${info.fireBalance}` : ''}</button>
         <button class="btn" data-act="noodle" ${info.canNoodle ? '' : 'disabled'}>煮方便面</button>
         ${info.canDryFire ? `<button class="btn" data-act="dryFire">火烘湿衣 · ${dryCount}件</button>` : ''}
         ${canDry ? `<button class="btn" data-act="dry" ${dryCount ? '' : 'disabled'}>晾干湿衣${dryCount ? ` · ${dryCount}件` : ''}</button>` : ''}
        <button class="btn" data-act="pack">背包</button>
        ${info.rescue !== null ? '<button class="btn" data-act="wait">等待救援</button>' : info.canSos ? '<button class="btn danger" data-act="sos">求救</button>' : ''}
        <button class="btn ghost" data-act="go">${info.bivy ? '起身出发' : '收帐篷出发'}</button>
      </div>`;
    document.body.appendChild(box);
    this._bind(box, {
      sleep: () => g.sleep(),
      rest: async () => { this.hideCampMenu(); await g.restFor(60); if (g.st?.camp && !g.over) this.showCampMenu(g.campMenuInfo()); },
      light: () => g.lightCampFire(),
       cook: async () => { this.hideCampMenu(); await g.cook(); if (g.st?.camp && !g.over) this.showCampMenu(g.campMenuInfo()); },
       noodle: async () => { this.hideCampMenu(); await g.cookNoodles(); if (g.st?.camp && !g.over) this.showCampMenu(g.campMenuInfo()); },
       dryFire: async () => { this.hideCampMenu(); await g.dryClothesByFire(); if (g.st?.camp && !g.over) this.showCampMenu(g.campMenuInfo()); },
      pack: () => this.openPack(),
       sos: async () => { await g.sos({}); if (g.st?.camp && !g.over) this.showCampMenu(g.campMenuInfo()); },
      wait: async () => { this.hideCampMenu(); await g.waitForRescue(); if (g.st?.camp && !g.over) this.showCampMenu(g.campMenuInfo()); },
      dry: async () => { this.hideCampMenu(); await g.dryClothes(); if (g.st?.camp && !g.over) this.showCampMenu(g.campMenuInfo()); },
       go: () => g.packCamp(),
    });
  }

  hideCampMenu() { $('#campMenu')?.remove(); }

  _storyDecisions(decisions) {
    if (!Array.isArray(decisions) || !decisions.length) return '';
    return `<details class="story-decisions"><summary>回看关键选择</summary><ol>${decisions.slice(-12).map((d) => `<li><span class="kicker">${esc(d.who || d.id)} · ${esc(fmtDateTime(d.time))}</span><p>${esc(d.label)}</p></li>`).join('')}</ol></details>`;
  }

  // ———————————————————— 结局 ————————————————————
  showEnding({ type, cause, role, stats, fates = [], epilogues = [], newEpilogues = [], decisions = [], resolutions = [] }) {
    const E = type === 'dead' ? { ...ENDINGS.dead[cause] ?? ENDINGS.dead.hypothermia, grade: '遇难', tone: 'bad' } : ENDINGS[type];
    this.endingTone = E.tone;
    const lesson = type === 'dead' ? LESSONS[cause] ?? LESSONS.hypothermia : type === 'sigma' ? '不需要证明什么，现在回家就很好。' : type === 'sausage' ? '最安全的鳌太线，是没有走过的鳌太线。' : LESSONS.hypothermia;
    const related = type === 'dead' && cause === 'fall' ? [ARCHIVE[7], ARCHIVE[4]] : type === 'rescued' ? [ARCHIVE[6], ARCHIVE[4]] : [ARCHIVE[1], ARCHIVE[7]];
    const S = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    const okFate = (f) => ['safe', 'rescued', 'survived', 'followed', 'together', 'helped', 'warned', 'waited'].includes(f);
    const page = this._page(`
      <div class="ending">
        <div class="end-head"><h1>${esc(E.title)}</h1><div class="stamp ${E.tone}">${esc(E.grade)}</div></div>
        <div style="color:var(--muted);margin-bottom:10px">${esc(role.name)} · ${esc(stats.time)}${stats.collected ? ` · 结局收集 ${stats.collected}` : ''}${stats.newEnding ? ' · <span style="color:var(--yellow)">新结局！</span>' : ''}</div>
        <div class="end-story">${E.lines.map((l, i) => `<p style="animation-delay:${i * 0.25}s">${esc(l)}</p>`).join('')}</div>
        ${type !== 'sausage' ? `<div class="end-grid">
          ${S('山上天数', stats.days)}${S('实际游玩', stats.realMin + '分钟')}${S('最远到达', stats.progress + 'km')}${S('行走距离', stats.dist + 'km')}
          ${S('最高海拔', stats.maxAlt + 'm')}${S('最低体温', stats.minCore + '℃')}${S('最冷体感', stats.coldest + '℃')}${S('露营夜数', stats.nights)}
        </div>
        ${stats.fines || stats.rescueCost ? `<div class="lesson" style="border-color:var(--line2);margin-bottom:10px">
          ${stats.fines ? `违规穿越罚款：<b class="mono" style="font-size:20px">¥${stats.fines.toLocaleString()}</b>。` : ''}
          ${stats.rescueCost ? `商业救援费用可达<b class="mono" style="font-size:20px">¥${stats.rescueCost.toLocaleString()}</b>量级。` : ''}
          ${stats.insurance ? '你买的户外险：违规进入禁止区域，不予理赔。' : ''}</div>` : ''}` : ''}
        ${epilogues.length ? `<div class="end-sec"><h3><span class="tag">尾声</span>这次选择留下了什么 <small>${esc(stats.epilogueCollected || '')}</small></h3>
          ${epilogues.filter((id) => EPILOGUES[id]).map((id) => `<div class="fate ok"><b>${esc(EPILOGUES[id].title)}</b>${newEpilogues.includes(id) ? ' <span class="chip ok">新尾声</span>' : ''}${EPILOGUES[id].lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div>`).join('')}
          <p class="kicker">尾声可叠加，均为虚构后续。</p></div>` : ''}
        ${resolutions.length ? `<div class="end-sec"><h3><span class="tag">回信</span>山下的后续</h3>${resolutions.map((r) => `<div class="fate"><b>${esc(r.title)}</b><p>${esc(r.text)}</p></div>`).join('')}</div>` : ''}
        ${this._storyDecisions(decisions)}
        ${fates.length ? `<div class="end-sec"><h3><span class="tag">路遇</span>他们后来怎么样了</h3>
          ${fates.map((f) => `<div class="fate ${okFate(f.fate) ? 'ok' : f.fate === 'died' || f.fate === 'danger' ? 'died' : ''}"><b>${esc(f.name)}</b> <small style="color:var(--muted)">${esc(f.age || '')}</small><p>${esc(f.text)}</p></div>`).join('')}
          <div style="font-size:12px;color:var(--muted)">人物为化名或虚构，情节改编自公开报道与"神秘园"系列视频讲述的事件。</div></div>` : ''}
        <div class="end-sec"><h3><span class="tag">教训</span>你需要知道的</h3><div class="lesson">${esc(lesson)}</div></div>
        <div class="end-sec"><h3><span class="tag">真实</span>这些事真的发生过</h3>
          ${related.map((a) => `<div class="case"><div class="when">${esc(a.when)}</div><div><h4>${esc(a.title)}</h4><p>${esc(a.body)}</p></div></div>`).join('')}</div>
        <div class="slogan">${SAUSAGE_SVG}${SLOGAN}</div>
        <div class="end-actions">
          <button class="btn primary" data-act="again">再来一次</button>
          <button class="btn ghost" data-act="records">游玩记录</button>
          <button class="btn ghost" data-act="archive">全部事故档案</button>
          <button class="btn ghost" data-act="title">回到标题</button>
        </div>
      </div>`, 'dim', 'ending');
    this._bind(page, {
      again: () => this.showRoles(),
      archive: () => this.showArchive(() => this.showEnding({ type, cause, role, stats, fates, epilogues, newEpilogues, decisions, resolutions })),
      records: () => this.showRecords(() => this.showEnding({ type, cause, role, stats, fates, epilogues, newEpilogues, decisions, resolutions })),
      title: () => this.app.toTitle(),
    });
  }
}

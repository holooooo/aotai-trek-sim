// 统一输入层：桌面（键盘 + 鼠标）与手机（虚拟摇杆 + 拖拽视角 + 双指缩放）。
// 全部使用 Pointer Events，并按 pointerId 逐指追踪，摇杆拇指与视角拇指可同时工作。

const JOY_RADIUS = 52;      // 摇杆最大位移（px）
const JOY_DEADZONE = 0.12;  // 摇杆死区（归一化）
const KEY_ROTATE_SPEED = 260; // Q/E 旋转视角速度（px/s）
const WHEEL_ZOOM_K = 0.0012;  // 滚轮缩放系数
const MAX_DT = 0.1;         // cameraDelta 中 dt 上限，避免长时间不调用后视角突跳

// 当焦点在文本输入类元素里时，不处理键盘
function isTypingTarget(t) {
  if (!t || !t.tagName) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t.isContentEditable;
}

export class Input {
  constructor({ canvas = null, joyZone = null, joyBase = null, joyKnob = null, isMobile = false } = {}) {
    this.canvas = canvas;
    this.joyZone = joyZone;
    this.joyBase = joyBase;
    this.joyKnob = joyKnob;
    this.isMobile = !!isMobile; // 仅供参考，代码对两种平台一视同仁
    this.enabled = true;

    this._held = new Set();      // 按住的物理键（e.code），不受 Shift/输入法影响
    this._keyCbs = [];           // onKey 回调
    this._crouchPtrs = new Map(); // pointerId -> 触发蹲下的元素
    this._cam = new Map();       // 画布上的指针 pointerId -> {x, y}（最多 2 个）
    this._pinchDist = 0;         // 上一次双指距离
    this._joyId = null;          // 摇杆指针 id
    this._joyOrigin = { x: 0, y: 0 };
    this._joyVec = { x: 0, y: 0, mag: 0 };
    this._dx = 0; this._dy = 0; this._zoom = 1; // 自上次 cameraDelta 起的累积量
    this._lastT = performance.now();

    this._bind();
  }

  // ---------------------------------------------------------------- 公共 API

  /** 移动向量：x 右为正，y 前为正，mag ∈ [0,1]。摇杆优先，否则键盘。 */
  move() {
    if (!this.enabled) return { x: 0, y: 0, mag: 0 };
    if (this._joyVec.mag > 0) return { ...this._joyVec };
    const k = this._held;
    let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const len = Math.hypot(x, y);
    if (len === 0) return { x: 0, y: 0, mag: 0 };
    return { x: x / len, y: y / len, mag: 1 }; // 斜向归一化
  }

  /** 蹲下：Space 按住，或任一 [data-hold="crouch"] 元素正被按住。 */
  crouchHeld() {
    return this.enabled && (this._held.has('Space') || this._crouchPtrs.size > 0);
  }

  /** 取走自上次调用以来的视角增量（并清零）。 */
  cameraDelta() {
    const now = performance.now();
    const dt = Math.min((now - this._lastT) / 1000, MAX_DT);
    this._lastT = now;

    if (!this.enabled) return { dx: 0, dy: 0, zoom: 1, active: false };

    let dx = this._dx;
    const dy = this._dy;
    const zoom = this._zoom;
    // Q/E 键旋转视角：Q 向左（dx 减），E 向右（dx 加）
    const rot = (this._held.has('KeyE') ? 1 : 0) - (this._held.has('KeyQ') ? 1 : 0);
    if (rot !== 0) dx += rot * KEY_ROTATE_SPEED * dt;

    const active = this._cam.size > 0 || dx !== 0 || dy !== 0 || zoom !== 1 || rot !== 0;
    this._dx = 0; this._dy = 0; this._zoom = 1;
    return { dx, dy, zoom, active };
  }

  /** 注册按键回调 cb(key)；返回取消注册函数（可忽略）。 */
  onKey(cb) {
    if (typeof cb !== 'function') return () => {};
    this._keyCbs.push(cb);
    return () => {
      const i = this._keyCbs.indexOf(cb);
      if (i >= 0) this._keyCbs.splice(i, 1);
    };
  }

  /** 禁用时：移动/蹲下/拖拽全部失效，并清空所有状态。 */
  setEnabled(b) {
    this.enabled = !!b;
    if (!this.enabled) this.reset();
  }

  /** 清空所有按键、指针、摇杆与累积增量。 */
  reset() {
    this._held.clear();
    this._crouchPtrs.clear();
    this._cam.clear();
    this._pinchDist = 0;
    this._dx = 0; this._dy = 0; this._zoom = 1;
    this._endJoystick();
  }

  // ---------------------------------------------------------------- 事件绑定

  _bind() {
    const { canvas, joyZone } = this;

    // 键盘
    window.addEventListener('keydown', (e) => this._onKeyDown(e));
    window.addEventListener('keyup', (e) => this._held.delete(e.code || ''));
    window.addEventListener('blur', () => this._held.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this._held.clear();
    });

    // 指针：move/up/cancel 挂 window，保证拖出元素外也能收到
    window.addEventListener('pointermove', (e) => this._onPointerMove(e));
    window.addEventListener('pointerup', (e) => this._onPointerEnd(e));
    window.addEventListener('pointercancel', (e) => this._onPointerEnd(e));

    // 蹲下按钮：委托到 document，动态创建的按钮也有效
    document.addEventListener('pointerdown', (e) => this._onHoldDown(e));
    // pointerleave 不冒泡，用捕获阶段监听
    document.addEventListener('pointerleave', (e) => this._onHoldLeave(e), true);

    if (canvas) {
      canvas.style.touchAction = 'none';
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      canvas.addEventListener('pointerdown', (e) => this._onCanvasDown(e));
      canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    }
    if (joyZone && this.joyBase && this.joyKnob) {
      joyZone.style.touchAction = 'none';
      joyZone.addEventListener('contextmenu', (e) => e.preventDefault());
      joyZone.addEventListener('pointerdown', (e) => this._onJoyDown(e));
    }
  }

  // ---------------------------------------------------------------- 键盘

  _onKeyDown(e) {
    if (e.metaKey || isTypingTarget(e.target)) return; // Cmd 组合键的 keyup 不会送达，避免卡键
    const key = typeof e.key === 'string' ? e.key.toLowerCase() : '';
    if (key === 'tab' || e.code === 'Space') e.preventDefault();
    if (e.code) this._held.add(e.code);
    if (e.repeat || e.ctrlKey || e.altKey) return; // 忽略自动重复与 Ctrl/Alt 组合
    for (const cb of this._keyCbs.slice()) {
      try { cb(key); } catch (err) { console.error(err); }
    }
  }

  // ---------------------------------------------------------------- 蹲下按钮

  _onHoldDown(e) {
    const el = e.target && e.target.closest ? e.target.closest('[data-hold="crouch"]') : null;
    if (!el || !this.enabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this._crouchPtrs.set(e.pointerId, el);
  }

  _onHoldLeave(e) {
    // 指针离开了按下时的那个按钮即视为松开
    if (this._crouchPtrs.get(e.pointerId) === e.target) this._crouchPtrs.delete(e.pointerId);
  }

  // ---------------------------------------------------------------- 摇杆

  _onJoyDown(e) {
    if (!this.enabled || this._joyId !== null) return; // 同一时间只允许一个摇杆指针
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const { joyZone, joyBase } = this;
    this._joyId = e.pointerId;
    this._joyOrigin = { x: e.clientX, y: e.clientY };

    // 动态原点：把摇杆底座中心移到触点（坐标相对 joyZone）
    const r = joyZone.getBoundingClientRect();
    joyBase.style.left = `${e.clientX - r.left - joyBase.offsetWidth / 2}px`;
    joyBase.style.top = `${e.clientY - r.top - joyBase.offsetHeight / 2}px`;
    joyBase.style.right = 'auto';
    joyBase.style.bottom = 'auto';
    joyZone.classList.add('active');
    try { joyZone.setPointerCapture(e.pointerId); } catch (_) { /* 合成事件等情况忽略 */ }
    this._updateJoystick(e);
  }

  _updateJoystick(e) {
    let ox = e.clientX - this._joyOrigin.x;
    let oy = e.clientY - this._joyOrigin.y;
    const len = Math.hypot(ox, oy);
    if (len > JOY_RADIUS) { ox = ox / len * JOY_RADIUS; oy = oy / len * JOY_RADIUS; }
    this.joyKnob.style.transform = `translate(${ox}px, ${oy}px)`;

    // 死区之外线性重映射到 [0,1]，避免越过死区时输出突跳
    const raw = Math.min(len / JOY_RADIUS, 1);
    if (raw < JOY_DEADZONE) { this._joyVec = { x: 0, y: 0, mag: 0 }; return; }
    const mag = (raw - JOY_DEADZONE) / (1 - JOY_DEADZONE);
    const dist = Math.hypot(ox, oy);
    this._joyVec = { x: ox / dist * mag, y: -oy / dist * mag, mag }; // 屏幕向上 = 前进(+y)
  }

  _endJoystick() {
    if (this._joyId !== null && this.joyZone) {
      try { this.joyZone.releasePointerCapture(this._joyId); } catch (_) { /* 已释放 */ }
    }
    this._joyId = null;
    this._joyVec = { x: 0, y: 0, mag: 0 };
    if (this.joyZone) this.joyZone.classList.remove('active');
    if (this.joyKnob) this.joyKnob.style.transform = '';
    if (this.joyBase) { // 回到 CSS 默认位置
      this.joyBase.style.left = '';
      this.joyBase.style.top = '';
      this.joyBase.style.right = '';
      this.joyBase.style.bottom = '';
    }
  }

  // ---------------------------------------------------------------- 视角拖拽 / 缩放

  _onCanvasDown(e) {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return; // 鼠标仅左键拖拽
    if (this._cam.size >= 2) return;                          // 最多追踪两指
    this._cam.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) { /* 忽略 */ }
    if (this._cam.size === 2) this._pinchDist = this._pointerDistance();
  }

  _onWheel(e) {
    e.preventDefault();
    if (!this.enabled) return;
    // deltaMode: 0 像素 / 1 行 / 2 页，统一折算成像素
    const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
    this._zoom *= Math.exp(dy * WHEEL_ZOOM_K);
  }

  _pointerDistance() {
    const [a, b] = this._cam.values();
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  _onPointerMove(e) {
    if (!this.enabled) return;
    // 鼠标在窗口外松开可能丢失 pointerup，这里兜底
    if (e.pointerType === 'mouse' && !(e.buttons & 1) && this._cam.has(e.pointerId)) {
      this._onPointerEnd(e);
      return;
    }
    if (e.pointerId === this._joyId) { this._updateJoystick(e); return; }

    const p = this._cam.get(e.pointerId);
    if (!p) return;
    if (this._cam.size === 1) {            // 单指：拖拽
      this._dx += e.clientX - p.x;
      this._dy += e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
    } else {                               // 双指：捏合，期间不累积拖拽
      p.x = e.clientX; p.y = e.clientY;
      const d = this._pointerDistance();
      if (this._pinchDist > 0.5 && d > 0.5) this._zoom *= this._pinchDist / d;
      this._pinchDist = d;
    }
  }

  _onPointerEnd(e) {
    if (e.pointerId === this._joyId) this._endJoystick();
    this._crouchPtrs.delete(e.pointerId);
    if (this._cam.delete(e.pointerId)) this._pinchDist = 0; // 剩余单指自然转为拖拽
  }
}

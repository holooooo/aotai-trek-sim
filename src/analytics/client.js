const CONSENT_KEY = 'aotai-analytics-consent-v1';
const VISITOR_KEY = 'aotai-analytics-visitor-v1';
const QUEUE_KEY = 'aotai-analytics-queue-v1';
const MAX_QUEUE = 100;
const BATCH_SIZE = 25;
const CHECKPOINT_SECONDS = 120;
const DEFAULT_TIMEOUT = 2000;
const EVENT_TYPES = new Set([
  'run_started', 'run_resumed', 'run_checkpoint', 'shop_buy', 'shop_refund',
  'event_started', 'event_completed', 'run_ended',
]);
const EXTRA_FIELDS = Object.freeze({
  run_started: ['fresh'],
  run_resumed: ['fresh'],
  run_checkpoint: [],
  shop_buy: ['itemId', 'quantity', 'cost'],
  shop_refund: ['itemId', 'quantity', 'cost'],
  event_started: ['eventId'],
  event_completed: ['eventId'],
  run_ended: ['ending', 'cause', 'death'],
});
const ROLE_IDS = new Set(['student', 'veteran', 'blogger', 'runner', 'nurse', 'coder', 'cook', 'geographer', 'porter', 'photographer']);
const DIFFICULTY_IDS = new Set(['easy', 'normal', 'hardcore']);
const ENDING_IDS = new Set(['sausage', 'sigma', 'retreat_wild', 'turnback', 'retreat', 'retreat_branch', 'rescued', 'cross', 'dayehai', 'dead']);
const CAUSE_IDS = new Set(['hypothermia', 'fall', 'dehydration', 'starvation', 'injury', 'exhaustion']);
const OPTION_ID = /^[A-Za-z0-9_-]{1,32}$/;
const QUESTION_ID = /^[A-Za-z0-9_:|\-]+$/;
const IDENTIFIER = /^[A-Za-z0-9_-]{8,96}$/;

const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const integer = (value) => Number.isSafeInteger(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function safeStorage(storage) {
  try { return storage && typeof storage.getItem === 'function' ? storage : null; } catch { return null; }
}
function defaultStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

function safeGet(storage, key) {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}
function safeSet(storage, key, value) {
  try { storage?.setItem?.(key, value); } catch { /* private mode or quota */ }
}
function safeRemove(storage, key) {
  try { storage?.removeItem?.(key); } catch { /* private mode or quota */ }
}
function randomId() {
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return uuid;
  } catch { /* unavailable in older or restricted contexts */ }
  try {
    const bytes = new Uint8Array(16);
    globalThis.crypto?.getRandomValues?.(bytes);
    if (bytes.some((byte) => byte !== 0)) return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch { /* no secure random source */ }
  return null;
}

function sanitizeQueuedEvent(input) {
  if (!object(input) || !EVENT_TYPES.has(input.type)) return null;
  const type = input.type;
  if (typeof input.id !== 'string' || !/^[A-Za-z0-9_-]{8,96}$/.test(input.id)) return null;
  if (typeof input.runId !== 'string' || !/^[A-Za-z0-9_-]{8,96}$/.test(input.runId)) return null;
  if (!integer(input.at) || input.at < 0 || input.at > 4102444800000) return null;
  const event = { id: input.id, runId: input.runId, type, at: input.at };
  if (own(input, 'role')) { if (!ROLE_IDS.has(input.role)) return null; event.role = input.role; }
  if (own(input, 'difficulty')) { if (!DIFFICULTY_IDS.has(input.difficulty)) return null; event.difficulty = input.difficulty; }
  if (own(input, 'activeSeconds')) { if (!finite(input.activeSeconds) || input.activeSeconds < 0 || input.activeSeconds > 604800) return null; event.activeSeconds = input.activeSeconds; }
  if (type === 'run_started') { if (own(input, 'fresh') && input.fresh !== true) return null; event.fresh = true; }
  if (type === 'run_resumed' && own(input, 'fresh')) { if (input.fresh !== false) return null; event.fresh = false; }
  if (type.startsWith('shop_')) {
    if (typeof input.itemId !== 'string' || !OPTION_ID.test(input.itemId) || !integer(input.quantity) || input.quantity < 1 || input.quantity > 100 || !finite(input.cost) || input.cost < 0 || input.cost > 1000000) return null;
    event.itemId = input.itemId; event.quantity = input.quantity; event.cost = input.cost;
  }
  if (type.startsWith('event_')) {
    if (typeof input.eventId !== 'string' || !/^(?:[A-Za-z0-9_-]+|(?:event|npc|scene):[A-Za-z0-9_-]+)$/.test(input.eventId)) return null;
    event.eventId = input.eventId;
  }
  if (type === 'run_ended') {
    if (!ENDING_IDS.has(input.ending)) return null;
    event.ending = input.ending;
    event.death = input.ending === 'dead';
    if (own(input, 'death') && input.death !== event.death) return null;
    if (event.death) {
      if (own(input, 'cause') && !CAUSE_IDS.has(input.cause)) return null;
      event.cause = input.cause || 'hypothermia';
    } else if (own(input, 'cause') && input.cause !== null) return null;
  }
  return event;
}

function readQueue(storage) {
  const raw = safeGet(storage, QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    return parsed.map(sanitizeQueuedEvent).filter(Boolean).filter((event) => !seen.has(event.id) && (seen.add(event.id), true)).slice(-MAX_QUEUE);
  } catch { return []; }
}

function normalizeQuestion(question) {
  if (!object(question)) return null;
  const questionId = question.questionId;
  const optionIds = Array.isArray(question.optionIds) ? question.optionIds : null;
  if (typeof questionId !== 'string' || questionId.length > 160 || !QUESTION_ID.test(questionId)) return null;
  if (!optionIds || optionIds.length < 2 || optionIds.length > 8 || optionIds.some((id) => typeof id !== 'string' || !OPTION_ID.test(id))) return null;
  const sorted = [...optionIds].sort();
  if (new Set(sorted).size !== sorted.length) return null;
  const pieces = questionId.split(':');
  if (pieces.length !== 3 || questionId !== `${pieces.slice(0, 2).join(':')}:${sorted.join('|')}`) return null;
  return { questionId, optionIds: sorted };
}

function validChoiceResult(value, question, allowVoteMeta = false) {
  if (!object(value) || value.questionId !== question.questionId || !integer(value.total) || value.total < 0 || !object(value.counts)) return null;
  const allowedKeys = allowVoteMeta ? ['questionId', 'total', 'counts', 'recorded', 'previousOptionId'] : ['questionId', 'total', 'counts'];
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) return null;
  if (allowVoteMeta && own(value, 'recorded') && typeof value.recorded !== 'boolean') return null;
  if (allowVoteMeta && own(value, 'previousOptionId') && !question.optionIds.includes(value.previousOptionId)) return null;
  const keys = Object.keys(value.counts);
  if (keys.length !== question.optionIds.length || keys.some((key) => !question.optionIds.includes(key))) return null;
  const counts = {};
  for (const id of question.optionIds) {
    const count = value.counts[id];
    if (!integer(count) || count < 0) return null;
    counts[id] = count;
  }
  if (value.total !== Object.values(counts).reduce((sum, count) => sum + count, 0)) return null;
  const result = { questionId: value.questionId, total: value.total, counts };
  if (allowVoteMeta && own(value, 'recorded')) result.recorded = value.recorded;
  if (allowVoteMeta && own(value, 'previousOptionId')) result.previousOptionId = value.previousOptionId;
  return result;
}

export class AnalyticsClient {
  constructor({
    storage = defaultStorage(),
    fetcher = (typeof globalThis !== 'undefined' ? globalThis.fetch?.bind(globalThis) : null),
    now = Date.now,
    telemetryUrl = '/api/telemetry',
    choicesUrl = '/api/choices',
    timeoutMs = DEFAULT_TIMEOUT,
    setTimeoutFn = (typeof globalThis !== 'undefined' ? globalThis.setTimeout?.bind(globalThis) : null),
    clearTimeoutFn = (typeof globalThis !== 'undefined' ? globalThis.clearTimeout?.bind(globalThis) : null),
  } = {}) {
    this.storage = safeStorage(storage);
    this.fetcher = typeof fetcher === 'function' ? fetcher : null;
    this.now = typeof now === 'function' ? now : Date.now;
    this.telemetryUrl = telemetryUrl || '/api/telemetry';
    this.choicesUrl = choicesUrl || '/api/choices';
    this.timeoutMs = finite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT;
    this.setTimeoutFn = typeof setTimeoutFn === 'function' ? setTimeoutFn : null;
    this.clearTimeoutFn = typeof clearTimeoutFn === 'function' ? clearTimeoutFn : null;
    this.queue = [];
    this.visitorId = null;
    this.flight = null;
    this.controllers = new Set();
    this.generation = 0;
    const savedConsent = safeGet(this.storage, CONSENT_KEY);
    this.enabledState = savedConsent !== 'false';
    if (this.enabledState) {
      safeSet(this.storage, CONSENT_KEY, 'true');
      this.visitorId = this._getOrCreateVisitor();
      this.queue = readQueue(this.storage);
    } else {
      safeSet(this.storage, CONSENT_KEY, 'false');
      safeRemove(this.storage, VISITOR_KEY);
      safeRemove(this.storage, QUEUE_KEY);
    }
  }

  get enabled() { return this.enabledState === true; }

  _getOrCreateVisitor() {
    if (!this.enabled) return null;
    const existing = safeGet(this.storage, VISITOR_KEY);
    if (typeof existing === 'string' && IDENTIFIER.test(existing)) return existing;
    const id = randomId('visitor');
    safeSet(this.storage, VISITOR_KEY, id);
    return id;
  }

  _persistQueue() {
    if (!this.enabled) return;
    this.queue = this.queue.slice(-MAX_QUEUE);
    if (this.queue.length) safeSet(this.storage, QUEUE_KEY, JSON.stringify(this.queue));
    else safeRemove(this.storage, QUEUE_KEY);
  }

  setEnabled(value) {
    const next = value === true;
    if (!next) {
      this.enabledState = false;
      this.generation++;
      for (const controller of this.controllers) { try { controller.abort(); } catch { /* abort is best effort */ } }
      this.controllers.clear();
      this.flight = null;
      this.queue = [];
      this.visitorId = null;
      safeSet(this.storage, CONSENT_KEY, 'false');
      safeRemove(this.storage, VISITOR_KEY);
      safeRemove(this.storage, QUEUE_KEY);
      return false;
    }
    this.enabledState = true;
    safeSet(this.storage, CONSENT_KEY, 'true');
    this.visitorId = this._getOrCreateVisitor();
    this.queue = readQueue(this.storage);
    return true;
  }

  _telemetry(st, create = false) {
    if (!object(st)) return null;
    if (!object(st.telemetry) && create && this.enabled) st.telemetry = {};
    if (!object(st.telemetry)) return null;
    const t = st.telemetry;
    if (typeof t.runId !== 'string' || !IDENTIFIER.test(t.runId)) {
      if (!create || !this.enabled) return null;
      t.runId = randomId();
    }
    if (!t.runId) return null;
    if (!finite(t.activeSeconds) || t.activeSeconds < 0) t.activeSeconds = 0;
    if (typeof t.startedTracked !== 'boolean') t.startedTracked = false;
    if (typeof t.endedTracked !== 'boolean') t.endedTracked = false;
    if (!Array.isArray(t.eventKeys)) t.eventKeys = [];
    return t;
  }

  beginRun(st, options = {}) {
    try { return this._beginRun(st, options); } catch { return null; }
  }

  _beginRun(st, options = {}) {
    const fresh = object(options) && options.fresh === true;
    if (!this.enabled || !object(st)) return null;
    const old = object(st.telemetry) ? st.telemetry : null;
    const draft = old && typeof old.runId === 'string' && IDENTIFIER.test(old.runId) && !old.startedTracked;
    this._telemetry(st, true);
    if (fresh && !draft) {
      st.telemetry = { runId: randomId(), activeSeconds: 0, startedTracked: false, endedTracked: false, eventKeys: [] };
    }
    const current = this._telemetry(st, true);
    if (fresh && !current.startedTracked) {
      this.track('run_started', st, { fresh: true });
    } else if (!fresh && !current.startedTracked) {
      this.track('run_resumed', st, { fresh: false });
      current.startedTracked = true;
    } else if (!fresh) {
      this.track('run_resumed', st, { fresh: false });
    }
    return current.runId;
  }

  _eventFields(type, st, fields) {
    const source = object(fields) ? fields : {};
    const event = {
      id: randomId('evt'),
      runId: this._telemetry(st, true)?.runId,
      type,
      at: Math.max(0, Math.floor(Number(this.now()) || 0)),
    };
    const role = st?.role;
    const difficulty = st?.difficulty;
    if (ROLE_IDS.has(role)) event.role = role;
    if (DIFFICULTY_IDS.has(difficulty)) event.difficulty = difficulty;
    const activeSeconds = this._telemetry(st)?.activeSeconds;
    if (finite(activeSeconds) && activeSeconds >= 0) event.activeSeconds = activeSeconds;
    for (const key of EXTRA_FIELDS[type] || []) {
      if (!own(source, key)) continue;
      const value = source[key];
      if (key === 'fresh' && typeof value === 'boolean') event.fresh = value;
      else if (key === 'itemId' && typeof value === 'string' && value.length <= 96 && OPTION_ID.test(value)) event.itemId = value;
      else if (key === 'eventId' && typeof value === 'string' && value.length <= 96 && /^(?:[A-Za-z0-9_-]+|(?:event|npc|scene):[A-Za-z0-9_-]+)$/.test(value)) event.eventId = value;
      else if (key === 'quantity' && integer(value) && value >= 1 && value <= 100) event.quantity = value;
      else if (key === 'cost' && finite(value) && value >= 0 && value <= 1000000) event.cost = value;
      else if (key === 'ending' && ENDING_IDS.has(value)) event.ending = value;
      else if (key === 'cause' && CAUSE_IDS.has(value)) event.cause = value;
      else if (key === 'death' && typeof value === 'boolean') event.death = value;
    }
    if (type === 'run_ended' && event.ending) {
      if (event.ending === 'dead') { event.death = true; if (!event.cause) event.cause = 'hypothermia'; }
      else { delete event.cause; event.death = false; }
    }
    return event;
  }

  track(type, st, fields = {}) {
    try { return this._track(type, st, fields); } catch { return null; }
  }

  _track(type, st, fields = {}) {
    if (!this.enabled || !EVENT_TYPES.has(type) || !object(st)) return null;
    const telemetry = this._telemetry(st, true);
    if (!telemetry?.runId) return null;
    if (type === 'run_started' && telemetry.startedTracked) return null;
    if (type === 'run_ended' && telemetry.endedTracked) return null;
    const uniqueKey = object(fields) && typeof fields.uniqueKey === 'string' ? fields.uniqueKey.slice(0, 96) : null;
    if (uniqueKey && telemetry.eventKeys.includes(uniqueKey)) return null;
    const event = this._eventFields(type, st, fields);
    if (!event.runId) return null;
    if (type.startsWith('shop_') && !(event.itemId && integer(event.quantity) && finite(event.cost))) return null;
    if (type.startsWith('event_') && !event.eventId) return null;
    if (type === 'run_ended' && !event.ending) return null;
    if (uniqueKey) {
      telemetry.eventKeys.push(uniqueKey);
      if (telemetry.eventKeys.length > 120) telemetry.eventKeys = telemetry.eventKeys.slice(-120);
    }
    if (type === 'run_started') { telemetry.startedTracked = true; telemetry.startEventId = event.id; }
    if (type === 'run_ended') telemetry.endedTracked = true;
    this.queue.push(event);
    this.queue = this.queue.slice(-MAX_QUEUE);
    this._persistQueue();
    return event;
  }

  tick(st, dt) {
    try { return this._tick(st, dt); } catch { return 0; }
  }

  _tick(st, dt) {
    if (!this.enabled || !object(st) || !finite(dt) || dt <= 0) return 0;
    const telemetry = this._telemetry(st);
    if (!telemetry) return 0;
    const before = telemetry.activeSeconds;
    telemetry.activeSeconds = Math.min(604800, telemetry.activeSeconds + dt);
    const oldCheckpoint = Math.floor(before / CHECKPOINT_SECONDS);
    const newCheckpoint = Math.floor(telemetry.activeSeconds / CHECKPOINT_SECONDS);
    for (let i = oldCheckpoint; i < newCheckpoint; i++) this.track('run_checkpoint', st, { uniqueKey: `checkpoint:${i + 1}` });
    return telemetry.activeSeconds;
  }

  async _request(url, options = {}, { allowWithoutConsent = false } = {}) {
    if (!this.fetcher) return null;
    const generation = this.generation;
    let timer = null;
    let controller = null;
    try {
      controller = typeof AbortController === 'function' ? new AbortController() : null;
      if (controller) this.controllers.add(controller);
      const request = { ...options, ...(controller ? { signal: controller.signal } : {}) };
      const fetchPromise = Promise.resolve().then(() => this.fetcher(url, request));
      const timeout = new Promise((resolve) => {
        if (!this.setTimeoutFn) return;
        timer = this.setTimeoutFn(() => { try { controller?.abort?.(); } catch {} resolve(null); }, this.timeoutMs);
      });
      const response = this.setTimeoutFn ? await Promise.race([fetchPromise, timeout]) : await fetchPromise;
      if (generation !== this.generation || !this.enabled && !allowWithoutConsent) return null;
      if (!response || typeof response !== 'object') return null;
      const status = Number(response.status);
      return response.ok === true || status >= 200 && status < 300 ? response : null;
    } catch { return null; }
    finally {
      if (timer !== null) { try { this.clearTimeoutFn?.(timer); } catch {} }
      this.controllers.delete(controller);
    }
  }

  async _readJson(response) {
    if (!response || typeof response.json !== 'function') return null;
    let timer = null;
    try {
      const body = Promise.resolve().then(() => response.json());
      if (!this.setTimeoutFn) return await body;
      const timeout = new Promise((resolve) => {
        timer = this.setTimeoutFn(() => resolve(null), this.timeoutMs);
      });
      return await Promise.race([body, timeout]);
    } catch { return null; }
    finally { if (timer !== null) { try { this.clearTimeoutFn?.(timer); } catch {} } }
  }

  flush() {
    if (this.flight) return this.flight;
    if (!this.enabled || !this.queue.length || !this.visitorId) return Promise.resolve({ sent: 0, remaining: this.queue.length });
    const batch = this.queue.slice(0, BATCH_SIZE);
    const generation = this.generation;
    const flight = (async () => {
      const response = await this._request(this.telemetryUrl, {
        method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId: this.visitorId, events: batch }),
      });
      if (response && generation === this.generation && this.enabled) {
        const sentIds = new Set(batch.map((event) => event.id));
        this.queue = this.queue.filter((event) => !sentIds.has(event.id));
        this._persistQueue();
        return { sent: batch.length, remaining: this.queue.length };
      }
      return { sent: 0, remaining: this.queue.length };
    })().catch(() => ({ sent: 0, remaining: this.queue.length })).finally(() => { if (this.flight === flight) this.flight = null; });
    this.flight = flight;
    return flight;
  }

  async choose(st, question, optionId) {
    try {
      const normalized = normalizeQuestion(question);
      if (!normalized || !normalized.optionIds.includes(optionId)) return null;
      const submit = this.enabled && this.visitorId && this._telemetry(st, true)?.runId;
      let response;
      if (submit) {
        response = await this._request(this.choicesUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visitorId: this.visitorId, runId: this._telemetry(st).runId, questionId: normalized.questionId, optionId, optionIds: normalized.optionIds }),
        });
      } else {
        const params = new URLSearchParams({ questionId: normalized.questionId, optionIds: normalized.optionIds.join(',') });
        response = await this._request(`${this.choicesUrl}?${params}`, { method: 'GET' }, { allowWithoutConsent: true });
      }
      if (!response || typeof response.json !== 'function') return null;
      return validChoiceResult(await this._readJson(response), normalized, !!submit);
    } catch { return null; }
  }
}

export const ANALYTICS_STORAGE_KEYS = Object.freeze({ CONSENT_KEY, VISITOR_KEY, QUEUE_KEY });

import test from 'node:test';
import assert from 'node:assert/strict';
import { EXIT_EVENTS, EXIT_EVENT_OPTION_IDS } from '../src/data/events-exits.js';
import { ITEMS } from '../src/data/items.js';

const BRANCHES = ['hetaoping', 'qingfengxia', 'dudumen', 'diaoyutai'];
const clone = (value) => JSON.parse(JSON.stringify(value));

function fixture({ branch = 'hetaoping', fraction = 0.5, resources = true, inventory = null, choice = null, dieOnPause = false } = {}) {
  const choices = [];
  const st = {
    path: branch,
    s: fraction * 100,
    time: 1000,
    dir: 1,
    bat: { phone: resources ? 80 : 0, satcomm: resources ? 80 : 0, gps: resources ? 80 : 0 },
    inv: inventory ?? (resources ? { gps: 1, bar: 2 } : {}),
    body: { stamina: 70, food: 70, water: 70, stress: 20 },
    story: { effects: {}, threads: {} },
    airplane: false,
  };
  const g = {
    st,
    over: false,
    calls: [],
    path() { return { length: 100 }; },
    hasItem(id) { return (st.inv[id] || 0) > 0; },
    comms() { return { sat: st.bat.satcomm > 3 && this.hasItem('satcomm'), phone: st.bat.phone > 3, any: st.bat.phone > 3 || (st.bat.satcomm > 3 && this.hasItem('satcomm')) }; },
    spendBattery(id, n) { if (st.bat[id] < n) return false; st.bat[id] -= n; this.calls.push(['battery', id, n]); return true; },
    async eventPause(minutes) { this.calls.push(['pause', minutes]); st.time += minutes; if (dieOnPause) { this.over = true; return false; } return !this.over; },
    changeBody(key, delta) { if (this.over) return; st.body[key] = Math.max(0, st.body[key] + delta); this.calls.push(['body', key, delta]); },
    addStress(delta) { if (this.over) return; st.body.stress = Math.max(0, Math.min(100, st.body.stress + delta)); this.calls.push(['stress', delta]); },
    recordStory(key, value = true) { st.story.threads[key] = value; },
    takeItem(id) { if (!this.hasItem(id)) return false; st.inv[id]--; return true; },
    eat(id) { if (!this.takeItem(id)) return; st.body.food = Math.min(100, st.body.food + 12); this.calls.push(['eat', id]); },
    async storyDialog(id, opts) {
      choices.push({ id, opts });
      return choice;
    },
  };
  return { g, st, choices };
}

function eventFor(branch) {
  return EXIT_EVENTS.find((event) => event.branchId === branch);
}
function economics(st) {
  return JSON.stringify({ time: st.time, dir: st.dir, bat: st.bat, body: st.body, inv: st.inv, effects: st.story.effects, threads: st.story.threads });
}

test('exports exactly four branch events with stable option IDs and boundary metadata', () => {
  assert.deepEqual(EXIT_EVENTS.map((event) => event.branchId), BRANCHES);
  assert.equal(new Set(EXIT_EVENTS.map((event) => event.id)).size, 4);
  for (const event of EXIT_EVENTS) {
    assert.equal(event.path, event.branchId);
    assert.equal(event.once, true);
    assert.equal(event.ambient, true);
    assert.ok(event.priority < 80);
    assert.deepEqual(event.optionIds, EXIT_EVENT_OPTION_IDS[event.id]);
    assert.equal(new Set(event.optionIds).size, event.optionIds.length);
    assert.equal(event.optionIds.length, 3);
    assert.ok(event.sourceLinks.length > 0);
    assert.ok(event.sourceLinks.every((url) => /^https?:\/\//.test(url)));
    assert.ok(event.factBoundary.verified.length >= 1);
    assert.ok(event.factBoundary.notInferred.length >= 1);
    assert.match(event.factBoundary.safety, /禁止|安全|导航/);
  }
});

test('each event is restricted to its own branch and its middle trigger window', () => {
  for (const event of EXIT_EVENTS) {
    assert.equal(event.cond(fixture({ branch: event.branchId, fraction: 0.5 }).g), true, event.id);
    assert.equal(event.cond(fixture({ branch: event.branchId, fraction: 0.2 }).g), false, `${event.id}:before`);
    assert.equal(event.cond(fixture({ branch: event.branchId, fraction: 0.8 }).g), false, `${event.id}:after`);
    assert.equal(event.cond(fixture({ branch: 'main', fraction: 0.5 }).g), false, `${event.id}:main`);
  }
});

test('every option executes with real helper-shaped costs and produces distinct outcomes', async () => {
  for (const event of EXIT_EVENTS) {
    const outcomes = new Set();
    for (const id of event.optionIds) {
      const { g, st, choices } = fixture({ branch: event.branchId, fraction: 0.5, choice: id });
      const before = clone({ dir: st.dir, bat: st.bat, body: st.body, inv: st.inv });
      await event.run(g);
      assert.deepEqual(choices[0].opts.choices.map((choice) => choice.id), event.optionIds, event.id);
      assert.ok(g.calls.some(([kind]) => kind === 'pause'), `${event.id}:${id} must spend time`);
      if (id === 'mark_position' || id === 'compare_bearing' || id === 'compare_landmarks') assert.equal(st.bat.gps, before.bat.gps - 3, `${event.id}:${id}`);
      if (id === 'check_phone' || id === 'call_out') assert.equal(st.bat.phone, before.bat.phone - 5, `${event.id}:${id}`);
      if (['reverse_segment', 'turn_back', 'retrace'].includes(id)) assert.equal(st.dir, -before.dir, `${event.id}:${id}`);
      if (id === 'retrace') assert.equal(st.inv.bar, before.inv.bar - 1);
      if (id === 'follow_drainage') assert.ok(st.body.stamina < before.body.stamina && st.body.water < before.body.water && st.body.food < before.body.food);
      if (id === 'keep_heading' || id === 'continue_ridge') assert.ok(st.body.stamina < before.body.stamina && st.body.food < before.body.food);
      outcomes.add(economics(st));
    }
    assert.equal(outcomes.size, event.optionIds.length, `${event.id} options need distinct observable costs`);
  }
});

test('resource-dependent options are disabled and cannot mutate a no-resource run', async () => {
  for (const event of EXIT_EVENTS) {
    const ids = event.optionIds;
    const { g, st, choices } = fixture({ branch: event.branchId, fraction: 0.5, resources: false, choice: ids[0] });
    await event.run(g);
    const offered = choices[0].opts.choices;
    const selected = offered.find((item) => item.id === ids[0]);
    assert.ok(selected, `${event.id} should offer every option`);
    assert.equal(selected.disabled, true, `${event.id}:${ids[0]} should be disabled without its resource`);
    assert.equal(st.time, 1000, `${event.id}:${ids[0]} disabled option must not spend time`);
    assert.equal(st.dir, 1, `${event.id}:${ids[0]} disabled option must not turn around`);
  }
  const gpsEvent = eventFor('hetaoping');
  const gpsProbe = fixture({ branch: 'hetaoping', fraction: 0.5, resources: false, choice: 'mark_position' });
  await gpsEvent.run(gpsProbe.g);
  assert.equal(gpsProbe.choices[0].opts.choices.find((item) => item.id === 'mark_position').disabled, true);
  const retraceEvent = eventFor('diaoyutai');
  const rationProbe = fixture({ branch: 'diaoyutai', fraction: 0.5, resources: false, choice: 'retrace' });
  await retraceEvent.run(rationProbe.g);
  assert.equal(rationProbe.choices[0].opts.choices.find((item) => item.id === 'retrace').disabled, true);
});

test('retrace accepts every catalog non-alcohol food and consumes exactly one item', async () => {
  const foods = Object.keys(ITEMS).filter((id) => ITEMS[id]?.kind === 'food' && !ITEMS[id].alcohol);
  assert.ok(foods.includes('rice_ball'), 'new rice_ball item must be covered');
  assert.ok(foods.includes('glucose'), 'glucose food-kind item must be covered');
  for (const id of foods) {
    const { g, st, choices } = fixture({
      branch: 'diaoyutai', fraction: 0.5, inventory: { [id]: 2 }, choice: 'retrace',
    });
    await eventFor('diaoyutai').run(g);
    assert.equal(choices[0].opts.choices.find((option) => option.id === 'retrace').disabled, false, `${id} should enable retrace`);
    assert.equal(st.inv[id], 1, `${id} should consume one unit`);
    assert.ok(g.calls.some(([kind, eaten]) => kind === 'eat' && eaten === id), `${id} should be eaten`);
  }
  const alcohol = fixture({ branch: 'diaoyutai', fraction: 0.5, inventory: { baijiu: 2 }, choice: 'retrace' });
  await eventFor('diaoyutai').run(alcohol.g);
  assert.equal(alcohol.choices[0].opts.choices.find((option) => option.id === 'retrace').disabled, true);
  assert.equal(alcohol.st.inv.baijiu, 2, 'alcohol must remain untouched');
  assert.equal(alcohol.st.time, 1000, 'disabled alcohol-only retrace must not spend time');
});

test('a death/ended pause stops the selected option before later effects', async () => {
  for (const event of EXIT_EVENTS) {
    for (const id of event.optionIds) {
      const { g, st } = fixture({ branch: event.branchId, fraction: 0.5, choice: id, dieOnPause: true });
      const before = clone({ dir: st.dir, bat: st.bat, body: st.body, inv: st.inv, effects: st.story.effects });
      await event.run(g);
      assert.equal(g.over, true, `${event.id}:${id}`);
      assert.deepEqual({ dir: st.dir, bat: st.bat, body: st.body, inv: st.inv, effects: st.story.effects }, before, `${event.id}:${id} mutated after death`);
    }
  }
});

test('events only record fictional contact and never grant direct rescue', async () => {
  for (const event of EXIT_EVENTS) {
    for (const id of event.optionIds) {
      const { g, st } = fixture({ branch: event.branchId, fraction: 0.5, choice: id });
      g.sos = async () => { throw new Error('exit events must not grant rescue through sos'); };
      await event.run(g);
      assert.equal(st.rescue, undefined, `${event.id}:${id}`);
      const shouldRecordContact = id === 'check_phone' || id === 'call_out';
      assert.equal(!!st.story.threads[`exit_${event.branchId}_contact`], shouldRecordContact, `${event.id}:${id}`);
    }
  }
});

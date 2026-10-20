import test from 'node:test';
import assert from 'node:assert/strict';
import { makeQuestion, distribution } from '../src/analytics/polls.js';
import { EVENTS } from '../src/data/events.js';
import { EXPANDED_EVENTS } from '../src/data/events-expanded.js';
import { REPORTED_EVENTS } from '../src/data/events-reported.js';
import { NPCS } from '../src/data/npcs.js';
import { ITEMS } from '../src/data/items.js';
import { EVENT_IDS, NPC_IDS, ITEM_CATEGORIES, QUESTION_OPTIONS } from '../server/analytics-catalog.js';

test('canonical questions survive reordered choices and reject ambiguous identities', () => {
  assert.deepEqual(makeQuestion('scene:gate', [{id:'home'}, {id:'go'}]), {questionId:'scene:gate:go|home',optionIds:['go','home']});
  assert.equal(makeQuestion('scene:gate',[{id:'go'}]),null);
  assert.equal(makeQuestion('scene:gate',[{id:'go'},{id:'go'}]),null);
  assert.equal(makeQuestion('missing',[{id:'go'},{id:'home'}]),null);
});
test('display percentages total 100 without inventing zero-sample certainty', () => {
  const q=makeQuestion('event:takin',[{id:'run'},{id:'back'},{id:'shout'}]);
  const result=distribution(q,{questionId:q.questionId,total:3,counts:{run:1,back:1,shout:1}});
  assert.equal(Math.round(Object.values(result.values).reduce((n,v)=>n+v.percent,0)*10),1000);
  assert.equal(result.values.back.percent,33.4);
  const zero=distribution(q,{questionId:q.questionId,total:0,counts:{run:0,back:0,shout:0}});
  assert.equal(zero.values.run.percent,null);
  assert.equal(distribution(q,{questionId:q.questionId,total:3,counts:{run:3,back:-1,shout:1}}),null);
  assert.equal(distribution(q,{questionId:q.questionId,total:4,counts:{run:1,back:1,shout:1}}),null);
});
test('backend catalog covers actual event/NPC choices and shop categories', () => {
  const all=[...EVENTS,...EXPANDED_EVENTS,...REPORTED_EVENTS];
  for(const ev of all) {
    assert.ok(EVENT_IDS.has(ev.id),ev.id);
    for(const [,id] of ev.run.toString().matchAll(/\bid:\s*'([a-z0-9_]+)'/g)) assert.ok(QUESTION_OPTIONS.get(`event:${ev.id}`)?.has(id),`${ev.id}:${id}`);
  }
  for(const npc of NPCS) {
    assert.ok(NPC_IDS.has(npc.id),npc.id);
    for(const [,id] of npc.meet.toString().matchAll(/\bid:\s*'([a-z0-9_]+)'/g)) assert.ok(QUESTION_OPTIONS.get(`npc:${npc.id}`)?.has(id),`${npc.id}:${id}`);
  }
  for(const [id,it] of Object.entries(ITEMS)) assert.equal(ITEM_CATEGORIES[id],it.cat,`shop ${id}`);
});

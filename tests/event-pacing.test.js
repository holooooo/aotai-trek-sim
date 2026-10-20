import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../src/sim/state.js';
import { Game } from '../src/sim/game.js';
import { ensureEventPacing, advanceEventPacing, chooseEvent, completeEvent, recordDialog, DIALOG_GAP } from '../src/sim/event-director.js';
const ordinary = { id: 'quiet_test', once: false, ambient: true, cond: () => true };
const g = () => ({st:createState('student')});

test('no ordinary event before the player actually begins, even if game time is advanced', () => {
  const game=g();game.st.time+=20000;advanceEventPacing(game.st,500,false);
  assert.equal(chooseEvent([ordinary],game),null);assert.equal(game.st.story.pacing.elapsed,0);
});
test('first encounter needs both exploration time and actual movement', () => {
 const game=g();advanceEventPacing(game.st,100,true);assert.equal(chooseEvent([ordinary],game),null);
 game.st.stats.walked=20;assert.equal(chooseEvent([ordinary],game),ordinary);
});
test('dialogues impose a shared quiet period; resting forward does not bypass it', () => {
 const game=g();game.st.stats.walked=20;advanceEventPacing(game.st,100,true);
 completeEvent(game.st,ordinary);game.st.time+=1440;assert.equal(chooseEvent([ordinary],game),null);
 advanceEventPacing(game.st,DIALOG_GAP+45);assert.equal(chooseEvent([ordinary],game),ordinary);
});
test('the quiet period survives a save reload without reset or immediate resampling', () => {
 const game=g();game.st.stats.walked=20;advanceEventPacing(game.st,100,true);recordDialog(game.st);
 const before=structuredClone(game.st.story.pacing);game.st=JSON.parse(JSON.stringify(game.st));
 assert.deepEqual(ensureEventPacing(game.st),before);assert.equal(chooseEvent([ordinary],game),null);
});
test('an unfinished choice resumes regardless of the new quiet-period rules', () => {
 const game=g();game.st.story.pendingEvent=ordinary.id;assert.equal(chooseEvent([ordinary],game),ordinary);
});
test('critical reminders bypass ordinary cooldown without forming a dialog chain', () => {
 const game=g();game.st.stats.walked=20;advanceEventPacing(game.st,100,true);recordDialog(game.st);
 const urgent={id:'undress',cond:()=>true};assert.equal(chooseEvent([urgent],game),null);
 advanceEventPacing(game.st,12);assert.equal(chooseEvent([ordinary,urgent],game),urgent);
});
test('fresh idle Game updates do not consume time or resources before the first move', () => {
 const game=Object.create(Game.prototype);game.st=createState('student');game.over=false;game.ui={modalOpen:false};
 let steps=0;game.simulate=()=>steps++;game.updateMovement=()=>{};game.updateGust=()=>{};game.checkTriggers=()=>{};
 game.updateNpcs=()=>{};game.updateVisuals=()=>{};game.refreshHud=()=>{};game.hudTimer=1;game.saveTimer=0;game.restTimer=0;
 for(let i=0;i<200;i++)game.update(.1);assert.equal(steps,0);
 game.updateMovement=()=>{game.moving=true;game.st.stats.walked+=1;};game.update(.1);assert.equal(steps,1);
});
test('a pending choice resumes in an idle fresh frame without simulating resources', () => {
 const game=Object.create(Game.prototype);game.st=createState('student');game.st.story.pendingEvent='headlamp_contact';game.over=false;game.ui={modalOpen:false};
 let triggers=0,steps=0;game.simulate=()=>steps++;game.checkTriggers=()=>triggers++;game.updateMovement=()=>{};game.updateGust=()=>{};
 game.updateNpcs=()=>{};game.updateVisuals=()=>{};game.refreshHud=()=>{};game.hudTimer=1;game.saveTimer=0;game.restTimer=0;
 game.update(.1);assert.equal(triggers,1);assert.equal(steps,0);assert.equal(game.st.story.pacing.started,false);
});

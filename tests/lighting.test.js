import test from 'node:test';
import assert from 'node:assert/strict';
import { ambientBrightness, updateLamp } from '../src/sim/lighting.js';
const state=()=>({inv:{headlamp:1},bat:{headlamp:100},lampOn:false,lampMode:'auto'});
test('brightness responds to sun, cloud, fog and forest shade rather than a fixed hour',()=>{
 const base={sunEl:0.5,wx:{},terrain:'ridge'};assert.equal(ambientBrightness({...base,sunEl:-0.2}),0);
 assert.ok(ambientBrightness({...base,terrain:'forest'})<ambientBrightness(base));assert.ok(ambientBrightness({...base,wx:{fog:1,overcast:1}})<ambientBrightness(base));
});
test('auto mode turns on in darkness and off in sufficient daylight',()=>{
 const s=state();assert.equal(updateLamp(s,{sunEl:-0.2}).on,true);assert.equal(updateLamp(s,{sunEl:0.5}).on,false);
});
test('dual brightness thresholds prevent repeated dawn/dusk flicker',()=>{
 const s=state();updateLamp(s,{sunEl:0.005});assert.equal(s.lampOn,false);s.lampOn=true;updateLamp(s,{sunEl:0.005});assert.equal(s.lampOn,true);
 updateLamp(s,{sunEl:0.04});assert.equal(s.lampOn,false);updateLamp(s,{sunEl:-0.04});assert.equal(s.lampOn,true);
});
test('dark foggy forest can need a lamp even during daytime',()=>{
 const s=state();updateLamp(s,{sunEl:0.5,wx:{overcast:1,fog:1},terrain:'forest'});assert.equal(s.lampOn,true);
 updateLamp(s,{sunEl:0.5,wx:{overcast:0,fog:0},terrain:'forest'});assert.equal(s.lampOn,false);
});
test('manual on/off survive changing light and intact shelter',()=>{
 const s=state();s.lampMode='off';updateLamp(s,{sunEl:-0.2});assert.equal(s.lampOn,false);
 s.lampMode='on';updateLamp(s,{sunEl:0.5,inTent:true});assert.equal(s.lampOn,true);
 const saved=JSON.parse(JSON.stringify(s));updateLamp(saved,{sunEl:-0.2});assert.equal(saved.lampMode,'on');assert.equal(saved.lampOn,true);
});
test('missing equipment and empty battery cannot emit light in any mode',()=>{
 const s=state();s.lampMode='on';s.bat.headlamp=0;assert.equal(updateLamp(s,{sunEl:-0.2}).on,false);
 s.bat.headlamp=100;delete s.inv.headlamp;assert.equal(updateLamp(s,{sunEl:-0.2}).on,false);
});
test('auto saves battery in intact shelter but not collapsed tents or bivouacs',()=>{
 const s=state();s.camp={inside:true,health:100,bivy:false,collapsed:false};assert.equal(updateLamp(s,{sunEl:-0.2}).on,false);
 s.camp.collapsed=true;assert.equal(updateLamp(s,{sunEl:-0.2}).on,true);s.camp.collapsed=false;s.camp.bivy=true;assert.equal(updateLamp(s,{sunEl:-0.2}).on,true);
});
test('legacy or malformed modes normalize to auto without altering battery or inventory',()=>{
 const s=state();delete s.lampMode;const inv=structuredClone(s.inv),bat=structuredClone(s.bat);updateLamp(s,{sunEl:-0.2});assert.equal(s.lampMode,'auto');assert.deepEqual(s.inv,inv);assert.deepEqual(s.bat,bat);
});

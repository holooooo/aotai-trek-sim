import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, wornItems } from '../src/sim/state.js';
import { clothing } from '../src/sim/body.js';
import { ensureClothes, garmentWetness, isClothWorn, changeClothing, clothingExchangeCost, beginClothesDrying, stepGarmentMoisture, dryableClothes } from '../src/sim/clothes.js';
const make=()=>{const s=createState('nurse');s.inv={base_merino:1,base_cotton:1,mid_fleece:1,insul_down:1,shell_pro:1,pants_hard:1,boots:1};delete s.clothes;ensureClothes(s);return s;};
const tent=s=>{s.inv.tent_alpine=1;s.camp={inside:true,bivy:false,tent:'tent_alpine',health:100,collapsed:false};};
const env=s=>({T:5,Teff:5,precip:0,wind:0,cl:clothing(s),tentInfo:s.camp?{Tin:5}:null});
test('legacy wetness migrates only to actually worn garments and preserves a dry packed insulation layer',()=>{
 const s=make();delete s.clothes;s.body.wet=63;ensureClothes(s);
 assert.equal(garmentWetness(s,'base_merino'),63);assert.equal(garmentWetness(s,'base_cotton'),0);assert.equal(garmentWetness(s,'insul_down'),0);
 assert.ok(Math.abs(s.body.wet-63)<1e-9);
});
test('taking a wet garment off and on preserves inventory and its own wetness',()=>{
 const s=make();s.body.wet=70;ensureClothes(s);const inv=structuredClone(s.inv);
 changeClothing(s,'mid_fleece',{Teff:10});assert.equal(isClothWorn(s,'mid_fleece'),false);assert.equal(garmentWetness(s,'mid_fleece'),70);
 changeClothing(s,'mid_fleece',{Teff:10});assert.equal(isClothWorn(s,'mid_fleece'),true);assert.equal(garmentWetness(s,'mid_fleece'),70);assert.deepEqual(s.inv,inv);
});
test('a deliberately empty slot survives save/reload instead of auto-equipping the best garment again',()=>{
 let s=make();changeClothing(s,'mid_fleece',{Teff:10});s=JSON.parse(JSON.stringify(s));ensureClothes(s);
 assert.equal(wornItems(s).mid,undefined);assert.equal(s.inv.mid_fleece,1);
});
test('different garments in one slot retain independent wetness when replaced',()=>{
 const s=make();s.body.wet=80;ensureClothes(s);changeClothing(s,'base_cotton',{Teff:10});
 assert.equal(isClothWorn(s,'base_cotton'),true);assert.equal(garmentWetness(s,'base_cotton'),0);assert.equal(garmentWetness(s,'base_merino'),80);
 changeClothing(s,'base_merino',{Teff:10});assert.equal(garmentWetness(s,'base_merino'),80);
});
test('one wet insulation layer loses only its own warmth rather than weakening all dry layers',()=>{
 const s=make();s.wearInsul=true;ensureClothes(s);const before=clothing(s).clo;s.clothes.wetness.insul_down=100;ensureClothes(s);
 assert.ok(Math.abs(before-clothing(s).clo-1.3)<1e-9);assert.equal(garmentWetness(s,'mid_fleece'),0);
});
test('sweat and precipitation affect worn garments but not packed spares',()=>{
 const s=make();stepGarmentMoisture(s,{...env(s),T:1,precip:1},{mode:'walk',snowDeep:1},10,2);
 assert.ok(garmentWetness(s,'base_merino')>0);assert.ok(garmentWetness(s,'shell_pro')>0);assert.equal(garmentWetness(s,'base_cotton'),0);assert.equal(garmentWetness(s,'insul_down'),0);
});
test('changing in cold wind costs more core temperature than inside shelter or warm weather',()=>{
 const s=make();const cold=clothingExchangeCost(s,'base_merino',{Teff:-20,wind:20});const sheltered=clothingExchangeCost(s,'base_merino',{Teff:-20,wind:20,tentInfo:{}});
 assert.ok(cold.coreCost>sheltered.coreCost);assert.equal(clothingExchangeCost(s,'base_merino',{Teff:12}).coreCost,0);
 const core=s.body.core;changeClothing(s,'base_merino',{Teff:-20,wind:20});assert.ok(s.body.core<core);assert.ok(cold.minutes>0);
});
test('drying requires an intact tent and detached damp garments and never consumes a warmer on failure',()=>{
 const s=make();s.warmers=2;assert.equal(beginClothesDrying(s,{assisted:true}),null);tent(s);assert.equal(beginClothesDrying(s,{assisted:true}),null);
 s.body.wet=80;ensureClothes(s);changeClothing(s,'mid_fleece',{Teff:10});s.camp.collapsed=true;assert.equal(beginClothesDrying(s,{assisted:true}),null);assert.equal(s.warmers,2);
});
test('ventilated hanging dries slowly; a consumed chemical warmer assists without instantaneous drying',()=>{
 const s=make();tent(s);s.body.wet=80;ensureClothes(s);changeClothing(s,'mid_fleece',{Teff:10});s.warmers=2;
 const air=structuredClone(s),heated=structuredClone(s);beginClothesDrying(air);beginClothesDrying(heated,{assisted:true});
 stepGarmentMoisture(air,env(air),{mode:'rest'},30);stepGarmentMoisture(heated,env(heated),{mode:'rest'},30);
 assert.ok(garmentWetness(heated,'mid_fleece')<garmentWetness(air,'mid_fleece'));assert.ok(garmentWetness(air,'mid_fleece')<80);assert.ok(garmentWetness(heated,'mid_fleece')>0);assert.equal(heated.warmers,1);
});
test('rewearing hanging clothes stops assisted drying of that garment',()=>{
 const s=make();tent(s);s.body.wet=80;ensureClothes(s);changeClothing(s,'mid_fleece',{Teff:10});s.warmers=1;beginClothesDrying(s,{assisted:true});
 changeClothing(s,'mid_fleece',{Teff:10});assert.equal(s.clothes.drying.includes('mid_fleece'),false);const before=garmentWetness(s,'mid_fleece');stepGarmentMoisture(s,env(s),{mode:'rest'},30);
 assert.ok(before-garmentWetness(s,'mid_fleece')<3);
});
test('legacy story changes to aggregate wetness affect worn clothes only',()=>{
 const s=make();s.body.wet=40;ensureClothes(s);changeClothing(s,'mid_fleece',{Teff:10});s.body.wet+=10;ensureClothes(s);
 assert.equal(garmentWetness(s,'base_merino'),50);assert.equal(garmentWetness(s,'mid_fleece'),40);assert.ok(dryableClothes(s).includes('mid_fleece'));
});

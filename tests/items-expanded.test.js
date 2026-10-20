import test from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS, SHOP_ORDER } from '../src/data/items.js';

test('new camp equipment preserves old IDs and has complete unique shop ordering', () => {
  for (const id of ['tent_light', 'tent_alpine', 'bag_summer', 'bag_3s', 'bag_winter', 'pad_foam', 'pad_air']) assert.ok(ITEMS[id]);
  const tents = Object.entries(ITEMS).filter(([, item]) => item.kind === 'tent');
  const bags = Object.entries(ITEMS).filter(([, item]) => item.kind === 'bag');
  const pads = Object.entries(ITEMS).filter(([, item]) => item.kind === 'pad');
  assert.ok(tents.length >= 5);
  assert.ok(bags.length >= 6);
  assert.ok(pads.length >= 5);
  for (const [, item] of tents) assert.ok(item.ventilation >= 0 && item.ventilation <= 1);
  assert.equal(new Set(SHOP_ORDER).size, SHOP_ORDER.length);
  assert.deepEqual(SHOP_ORDER.filter((id) => !ITEMS[id]), []);
  for (const [id, item] of Object.entries(ITEMS)) if (!item.hidden) assert.ok(SHOP_ORDER.includes(id), `${id} missing from SHOP_ORDER`);
});

test('food catalog has at least eight new foods with bounded nutrition values and summaries', () => {
  const newFoodIds = ['trail_mix', 'oat_bar', 'dried_fruit', 'tuna_can', 'soup_pack', 'rice_ball', 'freeze_dried', 'nut_butter'];
  assert.ok(newFoodIds.every((id) => ITEMS[id]?.kind === 'food'));
  for (const id of newFoodIds) {
    const item = ITEMS[id];
    assert.ok(item.food > 0 && item.food <= 40);
    assert.equal(typeof item.summary, 'string');
    for (const effect of item.foodEffects || []) assert.ok(effect.minutes > 0 && effect.minutes <= 240);
  }
});

test('camp data exposes ventilation and contains no fire-drying behavior', () => {
  const source = JSON.stringify(ITEMS).toLowerCase();
  assert.equal(source.includes('dryfire'), false);
  assert.equal(source.includes('明火烘干'), false);
  assert.equal(source.includes('fire_dry'), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { isRoleUnlocked, unlockRole, clearRoleUnlocks } from '../src/sim/role-unlocks.js';

function store(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

test('role unlocks persist independently and are idempotent', () => {
  const a = store();
  assert.equal(isRoleUnlocked('qu', a), false);
  assert.equal(unlockRole('qu', a), true);
  assert.equal(unlockRole('qu', a), false);
  assert.equal(isRoleUnlocked('qu', a), true);
  const b = store({ 'aotai-role-unlocks-v1': a.getItem('aotai-role-unlocks-v1') });
  assert.equal(isRoleUnlocked('qu', b), true);
  clearRoleUnlocks(a);
  assert.equal(isRoleUnlocked('qu', a), false);
});

test('malformed unlock data and unavailable storage fail closed without throwing', () => {
  assert.equal(isRoleUnlocked('qu', store({ 'aotai-role-unlocks-v1': '{bad' })), false);
  const broken = { getItem: () => { throw new Error('private'); }, setItem: () => { throw new Error('private'); }, removeItem: () => { throw new Error('private'); } };
  assert.equal(isRoleUnlocked('qu', broken), false);
  assert.equal(unlockRole('qu', broken), true);
  assert.equal(isRoleUnlocked('qu', broken), true);
  assert.doesNotThrow(() => clearRoleUnlocks(broken));
});

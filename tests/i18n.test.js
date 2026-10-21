import test from 'node:test';
import assert from 'node:assert/strict';
import { getLocale, setLocale, toggleLocale, translate } from '../src/i18n.js';

function store() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
}

test('locale defaults to Chinese, toggles, and persists', () => {
  const s = store();
  assert.equal(getLocale(s), 'zh-CN');
  assert.equal(setLocale('en', s), 'en');
  assert.equal(getLocale(s), 'en');
  assert.equal(toggleLocale(s), 'zh-CN');
  assert.equal(translate('en', 'start'), 'START');
  assert.match(translate('zh-CN', 'recordsCount', { count: 3 }), /3/);
});

test('invalid locale and storage errors fail safely', () => {
  const s = { getItem: () => '{bad', setItem: () => { throw new Error('private'); } };
  assert.equal(getLocale(s), 'zh-CN');
  assert.equal(setLocale('fr', s), 'zh-CN');
  assert.equal(toggleLocale(s), 'en');
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
function reader() {
  const requests = [], timers = [];
  const context = { state: { authReady: true, me: { id: 'a' } }, contentCache: new Map(),
    setTimeout: fn => timers.push(fn), normalizeDefaultReaderTab: x => x, $: () => null,
    window: { qmRequestJson: (path, opts) => new Promise((resolve, reject) => requests.push({ path, opts, resolve, reject })) } };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('const entryPrefetches ='), source.indexOf('/* UI-MOBILE: infinite list.')), context);
  vm.runInContext(source.slice(source.indexOf('function setCurrentUser('), source.indexOf('function activeSourceForEntry(')), context);
  vm.runInContext(source.slice(source.indexOf('async function api('), source.indexOf('async function loadSources(')), context);
  return { ...context, requests, timers };
}
const ready = { entry: { id: 'one', content: 'original' }, rewrite: { body: '中文正文' } };
test('concurrent and repeated article opens reuse one delivered body for a bounded interval', async () => {
  const r = reader();
  const first = r.readEntryBundle('one'); const concurrent = r.readEntryBundle('one');
  assert.equal(r.requests.length, 1); r.requests[0].resolve(ready);
  assert.deepEqual(await first, await concurrent);
  assert.deepEqual(await r.readEntryBundle('one'), ready); assert.equal(r.requests.length, 1);
  r.timers[0](); const expired = r.readEntryBundle('one');
  assert.equal(r.requests.length, 2); r.requests[1].resolve(ready); await expired;
});
test('failed and not-ready responses do not prevent a fresh read', async () => {
  for (const failed of [true, false]) {
    const r = reader(); const first = r.readEntryBundle('one');
    if (failed) { r.requests[0].reject(Error('offline')); await assert.rejects(first); }
    else { r.requests[0].resolve({ entry: { id: 'one' }, rewrite: null }); await first; }
    const next = r.readEntryBundle('one'); assert.equal(r.requests.length, 2);
    r.requests[1].resolve(ready); await next;
  }
});
test('account changes discard delivered bodies, while same-account refresh preserves them', async () => {
  const r = reader(); const first = r.readEntryBundle('one'); r.requests[0].resolve(ready); await first;
  r.setCurrentUser({ id: 'a' }); await r.readEntryBundle('one'); assert.equal(r.requests.length, 1);
  r.setCurrentUser(null); const loggedOut = r.readEntryBundle('one');
  assert.equal(r.requests.length, 2); r.requests[1].resolve(ready); await loggedOut;
});
test('rewriting or deleting an entry invalidates reuse, but recording a view does not', async () => {
  const r = reader(); const first = r.readEntryBundle('one'); r.requests[0].resolve(ready); await first;
  const view = r.api('/api/entry/one/view', { method: 'POST' }); r.requests[1].resolve({}); await view;
  await r.readEntryBundle('one'); assert.equal(r.requests.length, 2);
  const change = r.api('/api/entry/one/rewrite', { method: 'POST' }); r.requests[2].resolve({}); await change;
  const refreshed = r.readEntryBundle('one'); assert.equal(r.requests.length, 4); r.requests[3].resolve(ready); await refreshed;
  const remove = r.api('/api/entry/one', { method: 'DELETE' }); r.requests[4].resolve({}); await remove;
  const deleted = r.readEntryBundle('one'); assert.equal(r.requests.length, 6); r.requests[5].reject(Error('not found')); await assert.rejects(deleted);
});

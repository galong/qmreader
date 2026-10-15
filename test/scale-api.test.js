const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-scale-'));
process.env.QMREADER_DATA_DIR = dataDir;
process.env.CLIENT_IP_HEADER = 'cf-connecting-ip';

const store = require('../lib/store');
const { createResponseCache, sendCached } = require('../lib/response-cache');
const { clientIp } = require('../lib/client-ip');
const { encodeCursor, decodeCursor, afterCursor, parseSince } = require('../lib/api-v1');

function fakeRes() {
  const res = { headers: {}, statusCode: 200, body: null };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = code => { res.statusCode = code; return res; };
  res.end = body => { res.body = body; return res; };
  return res;
}

test('response cache computes once per TTL window and serves ETag 304 without CDN persistence', () => {
  const cache = createResponseCache({ ttlMs: 1000 });
  let calls = 0;
  const produce = () => { calls += 1; return { n: calls, pad: 'x'.repeat(3000) }; };
  const a = cache.get('k', produce);
  const b = cache.get('k', produce);
  assert.equal(calls, 1);
  assert.equal(a, b);
  const res = fakeRes();
  sendCached({ headers: { 'accept-encoding': 'gzip' } }, res, a, { shared: true });
  assert.equal(res.headers['content-encoding'], 'gzip');
  assert.equal(res.headers['cache-control'], 'no-store');
  const res304 = fakeRes();
  sendCached({ headers: { 'if-none-match': a.etag } }, res304, a);
  assert.equal(res304.statusCode, 304);
});

test('private responses are never marked public', () => {
  const entry = createResponseCache().get('k', () => ({ ok: true }));
  const res = fakeRes();
  sendCached({ headers: {} }, res, entry, { shared: false });
  assert.equal(res.headers['cache-control'], 'private, no-cache');
});

test('client ip prefers the proxy header only when it is a valid address', () => {
  assert.equal(clientIp({ headers: { 'cf-connecting-ip': '203.0.113.9' }, ip: '172.70.0.1' }), '203.0.113.9');
  assert.equal(clientIp({ headers: { 'cf-connecting-ip': 'not-an-ip' }, ip: '172.70.0.1' }), '172.70.0.1');
});

test('cursor pagination is stable and strictly after the cursor', () => {
  const a = { publishedTs: 300, id: 'b' };
  const b = { publishedTs: 300, id: 'a' };
  const c = { publishedTs: 200, id: 'z' };
  const cursor = decodeCursor(encodeCursor(a));
  assert.deepEqual(cursor, { publishedTs: 300, id: 'b' });
  assert.equal(afterCursor(a, cursor), false);
  assert.equal(afterCursor(b, cursor), true);
  assert.equal(afterCursor(c, cursor), true);
  assert.equal(decodeCursor('%%%'), null);
  assert.equal(parseSince('2026-01-01T00:00:00Z'), Date.parse('2026-01-01T00:00:00Z'));
  assert.equal(parseSince('1700000000000'), 1700000000000);
});

test('API tokens are hashed, revocable and capped', () => {
  const user = store.createUser({ email: 'tok@example.com', password: 'password-12345', displayName: 'Tok' });
  const userId = user.user ? user.user.id : user.id;
  const created = store.createApiToken(userId, 'obsidian');
  assert.match(created.token, /^qmr_/);
  assert.equal(store.getUserByApiToken(created.token).id, userId);
  assert.equal(store.getUserByApiToken('qmr_wrong'), null);
  assert.equal(store.listApiTokens(userId).length, 1);
  assert.equal(JSON.stringify(store.listApiTokens(userId)).includes(created.token), false);
  assert.equal(store.revokeApiToken(userId, created.id), true);
  assert.equal(store.getUserByApiToken(created.token), null);
  for (let i = 0; i < 10; i += 1) store.createApiToken(userId, `t${i}`);
  assert.throws(() => store.createApiToken(userId, 'overflow'), /最多/);
});

test('entry views are batched and flushed in one write', () => {
  store.upsertEntries([{ id: 'view-test', sourceId: 'test', title: 't', link: 'https://example.com/a', published: new Date().toISOString(), publishedTs: Date.now(), summary: '', content: '' }]);
  store.recordEntryView('does-not-exist');
  const stats = () => store.getEntryStats(['view-test'])['view-test'].viewCount;
  const before = stats();
  store.recordEntryView('view-test');
  store.recordEntryView('view-test');
  assert.equal(stats(), before);
  store.flushEntryViews();
  assert.equal(stats(), before + 2);
});

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-batch-spread-'));
process.env.QMREADER_DATA_DIR = dir;
const { spreadBatchTimestamps } = require('../lib/fetcher');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const batchTs = Date.parse('2026-10-28T07:01:00Z');
const batch = ids => ids.map(id => ({ id, sourceId: 'producthunt', publishedTs: batchTs, published: '2026-10-28T07:01:00Z' }));

test('a daily batch is spread backwards from its stamp, never into the future', () => {
  const spread = spreadBatchTimestamps({ id: 'producthunt' }, batch(['c', 'a', 'b']));
  const byId = Object.fromEntries(spread.map(entry => [entry.id, entry.publishedTs]));
  assert.equal(byId.a, batchTs);
  assert.equal(byId.b, batchTs - 40 * 60 * 1000);
  assert.equal(byId.c, batchTs - 80 * 60 * 1000);
  assert.ok(spread.every(entry => entry.publishedTs <= batchTs));
  assert.equal(spread.find(entry => entry.id === 'b').published, new Date(byId.b).toISOString());
});

test('slots are stable across refetches regardless of feed order', () => {
  const first = spreadBatchTimestamps({ id: 'producthunt' }, batch(['a', 'b', 'c']));
  const again = spreadBatchTimestamps({ id: 'producthunt' }, batch(['c', 'b', 'a']));
  const ts = list => Object.fromEntries(list.map(entry => [entry.id, entry.publishedTs]));
  assert.deepEqual(ts(again), ts(first));
});

test('large batches stay within 20 hours and ordinary feeds are untouched', () => {
  const ids = Array.from({ length: 40 }, (_, i) => `p${String(i).padStart(2, '0')}`);
  const spread = spreadBatchTimestamps({ id: 'huggingface' }, batch(ids));
  assert.ok(Math.min(...spread.map(entry => entry.publishedTs)) >= batchTs - 20 * 60 * 60 * 1000);
  assert.equal(new Set(spread.map(entry => entry.publishedTs)).size, 40);
  const blog = batch(['x', 'y']).map(entry => ({ ...entry, sourceId: 'simonwillison' }));
  assert.deepEqual(spreadBatchTimestamps({ id: 'simonwillison' }, blog), blog);
});

test('history script spreads stored batches and leaves content hashes alone', () => {
  const store = require('../lib/store');
  const { plan } = require('../scripts/spread-batch-history');
  const now = Date.now();
  const stamp = now - 60 * 60 * 1000;
  store.upsertEntries(['h1', 'h2', 'h3'].map(id => ({ id, sourceId: 'producthunt', title: id, content: `<p>${id}</p>`, publishedTs: stamp, published: new Date(stamp).toISOString() })));
  const hash = store.getEntry('h2').contentHash;
  const changes = plan({ days: 1, now });
  assert.deepEqual(changes.map(c => c.id).sort(), ['h2', 'h3']);
  for (const change of changes) store.setEntryPublishedTs(change.id, change.to);
  assert.equal(store.getEntry('h2').publishedTs, stamp - 40 * 60 * 1000);
  assert.equal(store.getEntry('h2').contentHash, hash);
  assert.deepEqual(plan({ days: 1, now }), [], 'running it again changes nothing');
});

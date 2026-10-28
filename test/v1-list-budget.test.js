const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-list-budget-'));
process.env.QMREADER_DATA_DIR = directory;
const store = require('../lib/store');
const fetcher = require('../lib/fetcher');
const express = require('express');
const { mount } = require('../lib/api-v1');

test('a small API page only loads assets for its own entries and keeps cursor, search and visibility', async t => {
  const entries = Array.from({ length: 90 }, (_, i) => ({
    id: `page-budget-${String(i).padStart(3, '0')}`, sourceId: 'qiaomu-blog',
    title: `Article ${i}`, link: `https://example.com/${i}`, content: '<p>Searchable original.</p>',
    summary: 'Original summary', publishedTs: 100000 - i,
  }));
  store.upsertEntries(entries);
  store.saveRewrite(entries[0].id, { body: '完整的中文内容', title: '中文标题', model: 'deepseek-flash' });
  store.softDeleteEntry(entries[1].id);
  store.upsertEntries([{ ...entries[0], id: 'private-opt-in', sourceId: 'podscribe-pivot', publishedTs: 200000 }]);
  fs.writeFileSync(path.join(directory, 'cache.json'), JSON.stringify({ 'qiaomu-blog': { entries } }));
  fetcher.loadDisk({ upsert: false });
  const assetBatches = [];
  const original = store.getEntryAssetSummaries;
  store.getEntryAssetSummaries = ids => { assetBatches.push([...ids]); return original(ids); };
  const app = express();
  mount(app, { fetcher, store, createRateLimiter: () => (req, res, next) => next(), clientIp: () => 'test', requireLogin: (req, res, next) => next() });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    store.getEntryAssetSummaries = original;
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/api/v1/entries`;
  async function page(query) {
    assetBatches.length = 0;
    const response = await fetch(base + query);
    assert.equal(response.status, 200);
    const body = await response.json();
    const returned = new Set(body.entries.map(entry => entry.id));
    assert.ok(assetBatches.flat().every(id => returned.has(id)), 'list must not load asset bodies for entries outside the requested page');
    return body;
  }
  const first = await page('?limit=5');
  assert.deepEqual(first.entries.map(e => e.id), [entries[0], ...entries.slice(2, 6)].map(e => e.id));
  assert.equal(first.entries[0].assets.rewrite, true);
  assert.ok(first.entries[0].stats);
  assert.equal('content' in first.entries[0], false);
  const second = await page('?limit=5&cursor=' + encodeURIComponent(first.nextCursor));
  assert.deepEqual(second.entries.map(e => e.id), entries.slice(6, 11).map(e => e.id));
  const search = await page('?limit=3&q=Searchable');
  assert.equal(search.entries.length, 3);
  const since = await page('?limit=5&since=99997');
  assert.deepEqual(since.entries.map(e => e.id), [entries[0].id, entries[2].id]);
});

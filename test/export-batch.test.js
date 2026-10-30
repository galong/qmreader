const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-export-batch-'));
process.env.QMREADER_DATA_DIR = directory;
const store = require('../lib/store');
const fetcher = require('../lib/fetcher');

test('export pages hydrate once and retain exact single-entry content, assets and deletion behavior', t => {
  const entries = Array.from({ length: 30 }, (_, index) => ({
    id: `export-batch-${index}`, sourceId: 'qiaomu-blog', title: `Article ${index}`,
    link: `https://example.com/${index}`, content: '<p>Stored content</p>',
    publishedTs: 100000 - index,
  }));
  store.upsertEntries(entries);
  store.saveRewrite(entries[0].id, { body: '完整的中文正文', title: '中文标题', model: 'deepseek-flash' });
  store.softDeleteEntry(entries[1].id);
  const cached = [{ ...entries[0], content: '<p>Newer full cached content</p>' }, ...entries.slice(1, 12)];
  fs.writeFileSync(path.join(directory, 'cache.json'), JSON.stringify({ 'qiaomu-blog': { entries: cached } }));
  fetcher.loadDisk({ upsert: false });
  const expected = entries.map(entry => fetcher.getEntryById(entry.id)).filter(Boolean);
  const calls = [];
  const original = store.getEntryAssetSummaries;
  store.getEntryAssetSummaries = ids => { calls.push([...ids]); return original(ids); };
  t.after(() => { store.getEntryAssetSummaries = original; fs.rmSync(directory, { recursive: true, force: true }); });

  const page = fetcher.getSourceEntryHistory({ sourceId: 'qiaomu-blog', limit: 100, deferAssets: true });
  assert.equal(calls.length, 0, 'selecting an export page must not hydrate assets');
  const result = fetcher.getEntriesByIds([...page.entries.map(entry => entry.id), entries[1].id, 'missing', entries[0].id]);
  assert.equal(calls.length, 1, 'one batch must replace per-entry asset queries');
  assert.deepEqual(result, expected);
  assert.equal(result[0].content, '<p>Newer full cached content</p>');
  assert.equal(result[0].rewriteReady, true);
  assert.equal(fetcher.getEntryById(entries[1].id), null);
  assert.equal(fetcher.getEntryById(''), null);
});

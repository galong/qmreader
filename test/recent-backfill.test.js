const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-backfill-'));
process.env.QMREADER_DATA_DIR = dir;
const store = require('../lib/store');
const deepseek = require('../lib/deepseek');
const fetcher = require('../lib/fetcher');
const { candidates, backfill } = require('../scripts/backfill-recent-ai');
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const base = { sourceId: 'ds-ai-section', title: 'Working with engineers', content: '<p>Working with engineers requires clear goals and shared context.</p>' };

test('collection-window recovery includes unchanged entries and excludes deletion and disabled sources', t => {
  const since = Date.now() - 1000;
  store.upsertEntries(['recent', 'deleted', 'off'].map(id => ({ ...base, id, sourceId: id === 'off' ? 'disabled' : base.sourceId, publishedTs: 1 })));
  store.softDeleteEntry('deleted');
  t.mock.method(fetcher, 'loadDisk', () => {});
  t.mock.method(fetcher, 'getSourcesMeta', () => [
    { id: base.sourceId, enabled: true, autoRewrite: true },
    { id: 'disabled', enabled: true, autoRewrite: false },
  ]);
  assert.deepEqual(candidates({ since, until: Date.now() + 1000 }).map(e => e.id), ['recent']);
  assert.deepEqual(candidates({ since: 0, until: 1 }), []);
  assert.throws(() => store.getRecentAiEntries({ since: NaN, until: Date.now(), sourceIds: [base.sourceId] }));
});

test('dry-run reports missing assets without any generation calls', async t => {
  t.mock.method(deepseek, 'translateTitleBatch', () => { throw new Error('dry-run called AI'); });
  t.mock.method(deepseek, 'rewriteEntry', () => { throw new Error('dry-run called AI'); });
  const output = [];
  await backfill([store.getEntry('recent')], { emit: v => output.push(v) });
  assert.equal(output[0].missingRewrites, 1);
  assert.equal(store.getRewrite('recent'), null);
});

test('missing-only recovery never replaces an existing rewrite, including a concurrent completion', async t => {
  const original = '用户已编辑的内容，应该完整保留。';
  store.upsertEntries([{ ...base, id: 'keep' }, { ...base, id: 'race' }]);
  store.saveRewrite('keep', { body: original, model: 'deepseek-flash', contentHash: 'old' });
  t.mock.method(globalThis, 'fetch', async () => {
    store.saveRewrite('race', { body: original, model: 'deepseek-flash', contentHash: 'user' });
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: {
      content: Array.from({ length: 8 }, () => '团队合作需要明确的目标。先讨论实际问题，再共同确认方案，把事实与判断分开，及时沟通工作中的变化。').join('\n\n'),
    } }] }), { headers: { 'content-type': 'application/json' } });
  });
  const options = { onlyMissing: true, provider: 'openai-compatible', baseUrl: 'https://example.com/v1', apiKey: 'test', model: 'test' };
  assert.equal((await deepseek.rewriteEntry(store.getEntry('keep'), options)).rewrite.body, original);
  assert.equal((await deepseek.rewriteEntry(store.getEntry('race'), options)).rewrite.body, original);
  assert.equal(store.getRewrite('race').contentHash, 'user');
});

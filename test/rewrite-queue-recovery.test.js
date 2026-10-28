const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-queue-recovery-'));
process.env.QMREADER_DATA_DIR = dir;
const store = require('../lib/store');
const deepseek = require('../lib/deepseek');
const fetcher = require('../lib/fetcher');
const jobs = require('../lib/background-jobs');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const body = Array.from({ length: 6 }, () => '团队合作需要明确的目标。先讨论实际问题，再共同确认方案。').join('\n\n');
const article = id => ({ id, sourceId: 'blog', title: `Article ${id}`, publishedTs: Date.now(),
  content: `<p>${'A long enough English article body about working with engineers. '.repeat(4)}</p>` });

function mockWorld(t) {
  t.mock.method(fetcher, 'loadDisk', () => {});
  t.mock.method(fetcher, 'flushDisk', () => {});
  t.mock.method(fetcher, 'getSourceById', id => ({ id, enabled: true, autoRewrite: true }));
  t.mock.method(fetcher, 'getEntryById', id => store.getEntry(id));
  t.mock.method(deepseek, 'getConfig', () => ({ configured: true, model: 'test', maxTokens: 6000 }));
}

test('a job held by a killed worker is recovered after its lease and finished by the next worker', async t => {
  mockWorld(t);
  store.upsertEntries([article('killed')]);
  assert.equal(jobs.enqueueRewriteEntries([store.getEntry('killed')], { reason: 'refresh' }).enqueued, 1);
  // Worker A claims the job and is killed by a deploy before finishing.
  const claimed = store.claimRewriteJob('ai-dead', { leaseMs: 1000 });
  assert.equal(claimed.entryId, 'killed');
  assert.equal(store.claimRewriteJob('ai-next'), null, 'a live lease is not stolen');
  t.mock.method(Date, 'now', () => claimed.leaseUntil + 1);
  t.mock.method(deepseek, 'rewriteEntry', async entry => ({
    rewrite: store.saveRewrite(entry.id, { body, model: 'test', contentHash: deepseek.rewriteContentHash(entry) }), cached: false }));
  const result = await jobs.drainRewriteQueue({ workerId: 'ai-next' });
  assert.equal(result.rewritten, 1);
  assert.equal(store.getRewrite('killed').body, body);
  assert.equal(store.getRewriteJob(claimed.id).status, 'completed');
});

test('a fetch worker persists changed entries as jobs before reporting back', async t => {
  mockWorld(t);
  const fresh = article('fresh');
  store.upsertEntries([fresh]);
  t.mock.method(fetcher, 'fetchSource', async () => ({ status: 'ok', entries: [fresh], changedEntries: [store.getEntry('fresh')] }));
  let reported = null;
  await jobs.runRefreshJob({ kind: 'refresh', sourceIds: ['blog'], fetchOnly: true }, { onFetchDone: refresh => { reported = refresh; } });
  assert.equal(reported.rewriteJobsEnqueued, 1);
  const summary = store.getRewriteStatusSummaries(['fresh']).fresh;
  assert.equal(summary.status, 'pending', 'the job exists even if this process dies right now');
});

test('an entry that already has current Chinese is not enqueued again', t => {
  mockWorld(t);
  store.upsertEntries([article('done')]);
  const entry = store.getEntry('done');
  store.saveRewrite('done', { body, model: 'test', contentHash: deepseek.rewriteContentHash(entry) });
  assert.equal(jobs.enqueueRewriteEntries([entry]).enqueued, 0);
});

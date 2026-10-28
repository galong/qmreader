const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-catchup-'));
process.env.QMREADER_DATA_DIR = dir;
const store = require('../lib/store');
const deepseek = require('../lib/deepseek');
const fetcher = require('../lib/fetcher');
const podcastTranscript = require('../lib/podcast-transcript');
const jobs = require('../lib/background-jobs');
const { readingAssetState } = require('../lib/reading-state');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const body = Array.from({ length: 6 }, () => '团队合作需要明确的目标。先讨论实际问题，再共同确认方案。').join('\n\n');
const article = id => ({ id, sourceId: 'blog', title: `Article ${id}`, publishedTs: Date.now(),
  content: `<p>${'A long enough English article body about working with engineers. '.repeat(4)}</p>` });

function mockSources(t) {
  t.mock.method(fetcher, 'loadDisk', () => {});
  t.mock.method(fetcher, 'flushDisk', () => {});
  t.mock.method(fetcher, 'getSourcesMeta', () => [{ id: 'blog', enabled: true, autoRewrite: true }]);
  t.mock.method(fetcher, 'getSourceById', id => (id === 'blog' ? { id, enabled: true, autoRewrite: true } : null));
  t.mock.method(deepseek, 'getConfig', () => ({ configured: true, model: 'test', maxTokens: 6000 }));
}

test('rewrite outcomes back off and stop after the attempt limit', () => {
  store.upsertEntries([{ ...article('ledger'), sourceId: 'other' }]);
  const record = status => store.recordRewriteOutcome('ledger', { sourceId: 'blog', contentHash: 'h1', status, message: 'boom', retryAt: Date.now() + 60000 });
  assert.equal(record('retry').status, 'retry');
  assert.equal(record('retry').attempts, 2);
  record('retry');
  const last = record('retry');
  assert.equal(last.status, 'failed');
  assert.equal(last.attempts, 4);
  const done = store.recordRewriteOutcome('ledger', { sourceId: 'blog', contentHash: 'h2', status: 'completed' });
  assert.equal(done.status, 'completed');
  assert.equal(done.lastError, '');
});

test('catch-up rewrites articles a killed refresh worker never finished, newest first and bounded', async t => {
  mockSources(t);
  store.upsertEntries(['lost-1', 'lost-2', 'done'].map(article));
  store.saveRewrite('done', { body, model: 'test', contentHash: 'x' });
  const calls = [];
  t.mock.method(deepseek, 'rewriteEntry', async entry => {
    calls.push(entry.id);
    return { rewrite: store.saveRewrite(entry.id, { body, model: 'test', contentHash: deepseek.rewriteContentHash(entry) }), cached: false };
  });
  const result = await jobs.catchUpMissingRewrites({ limit: 1 });
  assert.equal(calls.length, 1);
  assert.equal(result.rewritten, 1);
  const second = await jobs.catchUpMissingRewrites({ limit: 5 });
  assert.equal(calls.length, 2, 'the second sweep picks up the remaining article');
  assert.equal(second.catchup.selected.includes('done'), false);
  assert.equal(store.getRewriteStatusSummaries([calls[0]])[calls[0]].status, 'completed');
});

test('catch-up waits for a scheduled retry and never repeats a permanent skip', async t => {
  mockSources(t);
  store.upsertEntries([article('flaky'), { ...article('tiny'), content: '<p>Short.</p>' }]);
  let attempts = 0;
  t.mock.method(deepseek, 'rewriteEntry', async () => {
    attempts++;
    throw new Error('upstream timeout');
  });
  await jobs.catchUpMissingRewrites({ limit: 10 });
  assert.equal(attempts, 1);
  const flaky = store.getRewriteStatusSummaries(['flaky']).flaky;
  assert.equal(flaky.status, 'retry');
  assert.ok(flaky.availableAt > Date.now() + 5 * 60 * 1000);
  const tiny = store.getRewriteStatusSummaries(['tiny']).tiny;
  assert.equal(tiny.status, 'skipped');
  assert.match(tiny.lastError, /正文太短/);

  const ids = jobs.rewriteCatchupCandidates().map(entry => entry.id);
  assert.equal(ids.includes('flaky'), false, 'retry is not due yet');
  assert.equal(ids.includes('tiny'), false, 'skip is permanent for this content');
  assert.equal(jobs.rewriteCatchupCandidates({ now: Date.now() + 11 * 60 * 1000 }).some(entry => entry.id === 'flaky'), true);
});

test('podcast rewrite hash ignores show-note churn and accepts legacy v1 rewrites', t => {
  t.mock.method(podcastTranscript, 'isTranscriptPodcast', () => true);
  t.mock.method(podcastTranscript, 'loadReadyTranscript', () => ({
    sourceUrl: 'https://www.xiaoyuzhoufm.com/episode/1', digestTranscriptHash: 'abc',
    transcriptDigest: '逐字稿分段提炼'.repeat(20), summary: '摘要',
  }));
  const episode = { id: 'pod', sourceId: 'bannatie', title: 'No.222', link: 'https://www.xiaoyuzhoufm.com/episode/1', content: '<p>show notes</p>' };
  const hash = deepseek.rewriteContentHash(episode);
  assert.match(hash, /^podcast-transcript-v2:/);
  assert.equal(deepseek.rewriteContentHash({ ...episode, content: '<p>show notes.</p>', summary: 'changed' }), hash);
  assert.equal(deepseek.rewriteIsCurrent({ body, contentHash: 'podcast-transcript-v1:old' }, episode), true);
  assert.equal(deepseek.rewriteIsCurrent({ body, contentHash: 'podcast-transcript-v2:other' }, episode), false);
  assert.equal(deepseek.rewriteIsCurrent({ body, contentHash: 'plain-old' }, { id: 'x', title: 'x', content: '<p>x</p>' }), false);
});

test('reader state reports settled skips and failures at any age, and does not poll for distant retries', () => {
  const now = 10 * 60 * 60 * 1000;
  const state = job => readingAssetState({ automatic: true, now, job });
  assert.deepEqual(state({ status: 'skipped', updatedAt: 1, lastError: '正文太短，无法自动重写' }),
    { status: 'unavailable', automatic: true, retryAfterMs: 0, reason: '正文太短，无法自动重写' });
  assert.equal(state({ status: 'failed', updatedAt: 1, lastError: 'HTTP 500' }).status, 'failed');
  assert.equal(state({ status: 'failed', updatedAt: 1, lastError: 'HTTP 500' }).reason, undefined, 'model errors stay server-side');
  const waiting = state({ status: 'retry', updatedAt: now, availableAt: now + 30 * 60 * 1000 });
  assert.equal(waiting.status, 'waiting');
  assert.equal(waiting.retryAfterMs, 0);
});

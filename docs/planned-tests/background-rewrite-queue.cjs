// Planning specifications copied from production; target exports are not implemented.
const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-background-test-'));
process.env.QMREADER_DATA_DIR = testDataDir;

const fetcher = require('../../lib/fetcher');
const deepseek = require('../../lib/deepseek');
const store = require('../../lib/store');
const jobs = require('../../lib/background-jobs');

after(() => fs.rmSync(testDataDir, { recursive: true, force: true }));

function stub(object, replacements) {
  const originals = {};
  for (const [key, value] of Object.entries(replacements)) {
    originals[key] = object[key];
    object[key] = value;
  }
  return () => Object.assign(object, originals);
}

test('every changed entry is persisted instead of collapsing work to a source limit', () => {
  const saved = [];
  const restoreStore = stub(store, {
    getRewrite: () => null,
    enqueueRewriteJob: (entryId, options) => {
      saved.push({ entryId, ...options });
      return { id: `job-${entryId}`, entryId, status: 'pending', enqueued: true };
    },
  });
  const restoreDeepseek = stub(deepseek, {
    rewriteContentHash: entry => `hash-${entry.id}`,
  });
  try {
    const entries = Array.from({ length: 12 }, (_, index) => ({
      id: `entry-${index}`,
      sourceId: 'ordinary-source',
      title: `Entry ${index}`,
      content: '<p>Enough content to enqueue.</p>',
    }));
    const result = jobs.enqueueRewriteEntries(entries, { reason: 'refresh changed entries' });
    assert.equal(result.enqueued, 12);
    assert.deepEqual(saved.map(item => item.entryId), entries.map(entry => entry.id));
  } finally {
    restoreDeepseek();
    restoreStore();
  }
});

test('startup backfill enqueues its exact limit in yielding chunks', async () => {
  const entries = Array.from({ length: 25 }, (_, index) => ({
    id: `backfill-${index}`,
    sourceId: 'ordinary-source',
    title: `Backfill ${index}`,
    content: '<p>Backfill source material.</p>',
  }));
  const restoreFetcher = stub(fetcher, {
    getEntries: () => entries,
    getEntryById: id => entries.find(entry => entry.id === id),
  });
  const restoreStore = stub(store, {
    getRewrite: () => null,
    getRewriteJobForEntry: () => null,
    enqueueRewriteJob: (entryId, options) => ({ id: `job-${entryId}`, entryId, ...options, status: 'pending', enqueued: true }),
  });
  const restoreDeepseek = stub(deepseek, {
    rewriteContentHash: entry => `hash-${entry.id}`,
  });
  try {
    const result = await jobs.backfillRewriteQueueAsync({ limit: 12, chunkSize: 3 });
    assert.equal(result.enqueued, 12);
    assert.equal(result.jobs.length, 12);
    assert.deepEqual(result.jobs.map(job => job.entryId), entries.slice(0, 12).map(entry => entry.id));
  } finally {
    restoreDeepseek();
    restoreStore();
    restoreFetcher();
  }
});

test('a rewrite worker claims and completes exactly one durable job', async () => {
  const entry = {
    id: 'queued-entry',
    sourceId: 'ordinary-source',
    title: 'Queued article',
    summary: 'A useful summary.',
    content: `<p>${'Useful source material. '.repeat(40)}</p>`,
  };
  const claimed = {
    id: 'job-one',
    entryId: entry.id,
    sourceId: entry.sourceId,
    contentHash: 'current-hash',
    status: 'running',
    attempts: 1,
    maxAttempts: 4,
  };
  const finishes = [];
  const restoreFetcher = stub(fetcher, {
    loadDisk: () => {},
    flushDisk: () => {},
    getEntryById: () => entry,
  });
  const restoreStore = stub(store, {
    claimRewriteJob: () => claimed,
    heartbeatRewriteJob: () => true,
    getRewrite: () => null,
    finishRewriteJob: (id, workerId, status, message) => {
      finishes.push({ id, workerId, status, message });
      return { ...claimed, status };
    },
    getRewriteQueueStats: () => ({ ready: 1, pending: 1 }),
  });
  const restoreDeepseek = stub(deepseek, {
    rewriteContentHash: () => 'current-hash',
    getConfig: () => ({ configured: true, model: 'deepseek-v4-flash', temperature: 0.6, maxTokens: 7000 }),
    rewriteEntry: async () => ({ cached: false, rewrite: { body: '完成的中文改写' } }),
  });
  try {
    const result = await jobs.processNextRewriteJob({ workerId: 'worker-one' });
    assert.equal(result.autoRewrite.rewritten, 1);
    assert.equal(finishes.length, 1);
    assert.equal(finishes[0].status, 'completed');
    assert.equal(finishes[0].workerId, 'worker-one');
  } finally {
    restoreDeepseek();
    restoreStore();
    restoreFetcher();
  }
});

test('a retryable rewrite failure releases the durable job with backoff', async () => {
  const entry = {
    id: 'retryable-entry',
    sourceId: 'ordinary-source',
    title: 'Retryable article',
    content: `<p>${'Useful source material. '.repeat(40)}</p>`,
  };
  const claimed = {
    id: 'job-retry', entryId: entry.id, sourceId: entry.sourceId,
    contentHash: 'retry-hash', status: 'running', attempts: 1, maxAttempts: 4,
  };
  let finishCall = null;
  const restoreFetcher = stub(fetcher, {
    loadDisk: () => {}, flushDisk: () => {}, getEntryById: () => entry,
  });
  const restoreStore = stub(store, {
    claimRewriteJob: () => claimed,
    heartbeatRewriteJob: () => true,
    getRewrite: () => null,
    finishRewriteJob: (id, workerId, status, message, options) => {
      finishCall = { id, workerId, status, message, options };
      return { ...claimed, status };
    },
    getRewriteQueueStats: () => ({ ready: 0, retry: 1 }),
  });
  const restoreDeepseek = stub(deepseek, {
    rewriteContentHash: () => 'retry-hash',
    getConfig: () => ({ configured: true, model: 'deepseek-v4-flash', temperature: 0.6, maxTokens: 7000 }),
    rewriteEntry: async () => {
      const error = new Error('temporary upstream failure');
      error.statusCode = 502;
      throw error;
    },
  });
  try {
    const result = await jobs.processNextRewriteJob({ workerId: 'worker-retry' });
    assert.equal(result.autoRewrite.failed[0].retry, true);
    assert.equal(finishCall.status, 'retry');
    assert.ok(finishCall.options.availableAt > Date.now());
  } finally {
    restoreDeepseek();
    restoreStore();
    restoreFetcher();
  }
});

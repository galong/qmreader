const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-upgrade-policy-'));
process.env.QMREADER_DATA_DIR = directory;
process.env.AUTO_REWRITE_WINDOW_START_HOUR = '0';
process.env.AUTO_REWRITE_WINDOW_END_HOUR = '0';
const jobs = require('../lib/background-jobs');
const fetcher = require('../lib/fetcher');
const store = require('../lib/store');
const deepseek = require('../lib/deepseek');
const { requestAiConfig } = require('../lib/request-ai-config');
after(() => fs.rmSync(directory, { recursive: true, force: true }));

test('title-only mode blocks durable producers, pending consumers and direct automatic body generation', async t => {
  const previous = process.env.AUTO_REWRITE_CONTENT_ENABLED;
  process.env.AUTO_REWRITE_CONTENT_ENABLED = '0';
  t.after(() => {
    if (previous === undefined) delete process.env.AUTO_REWRITE_CONTENT_ENABLED;
    else process.env.AUTO_REWRITE_CONTENT_ENABLED = previous;
  });
  t.mock.method(store, 'enqueueRewriteJob', () => { throw Error('must not enqueue body work'); });
  t.mock.method(store, 'claimRewriteJob', () => { throw Error('must not consume old body work'); });
  t.mock.method(deepseek, 'rewriteEntry', () => { throw Error('must not generate body'); });
  assert.equal(jobs.enqueueRewriteEntries([{ id: 'one', sourceId: 'pymnts' }]).enqueued, 0);
  assert.equal((await jobs.processNextRewriteJob()).idle, true);
  assert.equal((await jobs.autoRewriteEntries([{ id: 'one', sourceId: 'pymnts' }])).rewritten, 0);
  t.mock.method(fetcher, 'loadDisk', () => {});
  t.mock.method(fetcher, 'flushDisk', () => {});
  t.mock.method(fetcher, 'getEntries', () => []);
  t.mock.method(deepseek, 'getConfig', () => ({ configured: false }));
  for (const flag of ['queue', 'catchup']) {
    const result = await jobs.runRefreshJob({ kind: 'auto-rewrite', sourceIds: ['pymnts'], [flag]: true });
    assert.equal(result.autoRewrite.contentEnabled, false);
  }
});

test('requests using the server key follow the configured custom provider and ignore client routing', t => {
  const values = { AI_PROVIDER: 'openai-compatible', AI_BASE_URL: 'https://example.com/v1', AI_MODEL: 'gpt-5.5' };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  const config = requestAiConfig({ get: name => ({ 'x-ai-provider': 'evil', 'x-ai-base-url': 'https://wrong.example' }[name]), user: { id: 'reader' } });
  assert.equal(config.provider, values.AI_PROVIDER);
  assert.equal(config.baseUrl, values.AI_BASE_URL);
  assert.equal(config.model, values.AI_MODEL);
});

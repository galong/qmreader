const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-magpie-'));
process.env.QMREADER_DATA_DIR = dir;
const { siteMagpieConfig, ARGON, FLASH, BASE_URL } = require('../lib/site-magpie');
const { requestAiConfig } = require('../lib/request-ai-config');
const ai = require('../lib/deepseek');
const { createAiSpendGuard } = require('../lib/ai-spend-guard');
function env(t, name, value) {
  const previous = process.env[name];
  process.env[name] = value;
  t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
}
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('operator deadline switches at the exact boundary, surviving a fresh config read', t => {
  env(t, 'SITE_MAGPIE_API_KEY', 'site-test-key');
  env(t, 'SITE_MAGPIE_ARGON_UNTIL', '2026-10-21T00:00:00Z');
  const until = Date.parse(process.env.SITE_MAGPIE_ARGON_UNTIL);
  assert.equal(siteMagpieConfig({}, until - 1).model, ARGON);
  assert.equal(siteMagpieConfig({}, until).model, 'opencode-go/deepseek-v4.1-flash');
  assert.equal(siteMagpieConfig({}, until + 86400000).model, 'opencode-go/deepseek-v4.1-flash');
  env(t, 'SITE_MAGPIE_ARGON_UNTIL', 'invalid');
  assert.throws(() => siteMagpieConfig(), /Invalid/);
});

test('server key ignores caller routing while explicit BYOK remains independent', t => {
  env(t, 'SITE_MAGPIE_API_KEY', 'site-test-key');
  env(t, 'SITE_MAGPIE_ARGON_UNTIL', '2999-01-01T00:00:00Z');
  const headers = { 'x-ai-base-url': 'https://attacker.example/v1', 'x-ai-model': 'deepseek-v4-pro', 'x-ai-provider': 'anthropic' };
  const config = ai.getConfig(requestAiConfig({ get: name => headers[name] }));
  assert.equal(config.model, ARGON);
  assert.equal(config.baseUrl, BASE_URL);
  assert.equal(config.usesServerMagpieKey, true);
  // Background jobs and podcast condensation explicitly pass old defaults.
  assert.equal(ai.getConfig({ provider: 'deepseek', model: 'deepseek-flash' }).model, ARGON);
  const own = ai.getConfig({ apiKey: 'own-key', provider: 'openai-compatible', baseUrl: 'https://example.com/v1', model: 'own-model' });
  assert.equal(own.model, 'own-model');
  assert.equal(own.apiKey, 'own-key');
  assert.equal(own.usesServerMagpieKey, undefined);
});

test('Magpie retains quotas and rejects official, Pro and foreign endpoints', t => {
  env(t, 'SITE_MAGPIE_API_KEY', 'site-test-key');
  env(t, 'SITE_MAGPIE_ARGON_UNTIL', '');
  const config = ai.getConfig();
  const g = createAiSpendGuard({ file: path.join(dir, 'limits.sqlite'), limits: { globalConcurrent: 1 } });
  t.after(() => g.close());
  const body = { model: config.model, messages: [], max_tokens: 100 };
  for (const model of ['unapproved/model', 'deepseek-v4-pro', 'group/auto-deepseek-v4-pro']) {
    assert.throws(() => g.reserve({ ...config, model }, { ...body, model }, 1000), e => e.code === 'AI_MODEL_FORBIDDEN');
  }
  assert.throws(() => g.reserve({ ...config, baseUrl: 'https://api.deepseek.com/v1' }, body, 1000), e => e.code === 'AI_ENDPOINT_FORBIDDEN');
  const id = g.reserve(config, body, 1000);
  assert.throws(() => g.reserve(config, body, 1000), e => e.code === 'AI_CONCURRENCY');
  g.finish(id, { usage: { prompt_tokens: 10, completion_tokens: 10 } });
  assert.ok(g.reserve(config, body, 1000));
});

test('real request path uses Magpie and disables thinking only for Flash', async t => {
  env(t, 'SITE_MAGPIE_API_KEY', 'site-test-key');
  let sent;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    sent = JSON.parse(options.body);
    assert.equal(url, BASE_URL + '/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer site-test-key');
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '测试成功' } }], usage: { prompt_tokens: 5, completion_tokens: 5 } }));
  });
  for (const [deadline, model] of [['2999-01-01T00:00:00Z', ARGON], ['', 'opencode-go/deepseek-v4.1-flash']]) {
    env(t, 'SITE_MAGPIE_ARGON_UNTIL', deadline);
    await ai.__test.postChatCompletion(ai.getConfig(), { messages: [{ role: 'user', content: '测试' }], max_tokens: 100 });
    assert.equal(sent.model, model);
    assert.deepEqual(sent.thinking, model !== ARGON ? { type: 'disabled' } : undefined);
  }
});

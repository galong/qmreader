const { test } = require('node:test');
const assert = require('node:assert/strict');

const policy = require('../lib/auto-rewrite-policy');

test('automatic rewrite window uses Beijing time and an exclusive end hour', () => {
  const env = {
    AUTO_REWRITE_TIME_ZONE: 'Asia/Shanghai',
    AUTO_REWRITE_WINDOW_START_HOUR: '0',
    AUTO_REWRITE_WINDOW_END_HOUR: '7',
  };

  assert.equal(policy.autoRewriteWindowStatus(new Date('2026-08-26T16:00:00Z'), env).open, true);
  assert.equal(policy.autoRewriteWindowStatus(new Date('2026-08-26T22:59:59Z'), env).open, true);
  assert.equal(policy.autoRewriteWindowStatus(new Date('2026-08-26T23:00:00Z'), env).open, false);
});

test('automatic rewrite window supports ranges crossing midnight', () => {
  assert.equal(policy.isHourInWindow(23, 22, 3), true);
  assert.equal(policy.isHourInWindow(2, 22, 3), true);
  assert.equal(policy.isHourInWindow(3, 22, 3), false);
  assert.equal(policy.isHourInWindow(12, 0, 0), true);
  assert.equal(policy.autoRewriteWindowStatus(new Date(), {
    AUTO_REWRITE_WINDOW_START_HOUR: '0',
    AUTO_REWRITE_WINDOW_END_HOUR: '0',
  }).label, '全天');
});

test('automatic content generation can be disabled without disabling title translation', () => {
  assert.equal(policy.autoRewriteContentEnabled({}), true);
  assert.equal(policy.autoRewriteContentEnabled({ AUTO_REWRITE_CONTENT_ENABLED: '1' }), true);
  assert.equal(policy.autoRewriteContentEnabled({ AUTO_REWRITE_CONTENT_ENABLED: '0' }), false);
  assert.equal(policy.autoRewriteContentEnabled({ AUTO_REWRITE_CONTENT_ENABLED: 'off' }), false);
});

test('custom server AI options contain protocol settings but never the API key', () => {
  const env = {
    AI_PROVIDER: 'custom',
    AI_PROVIDER_NAME: 'Private Relay',
    AI_PROVIDER_TYPE: 'openai_compatible',
    AI_BASE_URL: 'https://relay.example/v1',
    AI_MODEL: 'gpt-example',
    AUTO_REWRITE_MODEL: 'gpt-rewrite',
    AI_API_KEY: 'must-not-leak',
  };
  const options = policy.serverAiOptions(env, { autoRewrite: true });

  assert.deepEqual(options, {
    provider: 'custom',
    providerName: 'Private Relay',
    providerType: 'openai_compatible',
    baseUrl: 'https://relay.example/v1',
    model: 'gpt-rewrite',
  });
  assert.equal(Object.hasOwn(options, 'apiKey'), false);
  assert.equal(policy.serverAiOptions(env).model, 'gpt-example');
});

test('configured source IDs are trimmed and deduplicated', () => {
  assert.deepEqual(
    [...policy.configuredDefaultSourceIds({ AUTO_REWRITE_SOURCE_IDS: 'a, b,a, ' })],
    ['a', 'b'],
  );
});

test('unset provider fields stay empty so the upstream config loader can read .env first', () => {
  assert.deepEqual(policy.serverAiOptions({}), {
    provider: '',
    providerName: '',
    providerType: '',
    baseUrl: '',
    model: '',
  });
});

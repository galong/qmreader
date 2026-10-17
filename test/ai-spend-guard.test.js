const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAiSpendGuard, runWithAiActor } = require('../lib/ai-spend-guard');

const config = { usesServerDeepSeekKey: true, model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com/v1', providerType: 'openai_compatible' };
const payload = { model: config.model, messages: [{ role: 'user', content: 'hello' }], max_tokens: 100 };
function fixture(t, limits = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-spend-guard-'));
  const file = path.join(dir, 'guard.sqlite');
  let now = Date.UTC(2026, 9, 15, 12);
  const guards = [];
  const open = () => { const g = createAiSpendGuard({ file, now: () => now, limits }); guards.push(g); return g; };
  t.after(() => { for (const g of guards) g.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { open, advance: ms => { now += ms; } };
}

test('persisted reservations enforce a shared daily ceiling across workers and restarts', t => {
  const f = fixture(t, { dailyBudgetMicros: 7000, globalConcurrent: 8 });
  const a = f.open(); const b = f.open();
  const ticket = a.reserve(config, payload, 1000);
  a.finish(ticket, { usage: { prompt_tokens: 1, completion_tokens: 1 } });
  assert.throws(() => b.reserve(config, payload, 1000), e => e.code === 'AI_DAILY_BUDGET');
  assert.throws(() => f.open().reserve(config, payload, 1000), e => e.code === 'AI_DAILY_BUDGET');
  f.advance(24 * 60 * 60 * 1000);
  assert.ok(b.reserve(config, payload, 1000));
});

test('each account has an independent quota but cannot bypass global concurrency', t => {
  const g = fixture(t, { userMinute: 1, globalConcurrent: 2 }).open();
  runWithAiActor('user:1', () => {
    assert.ok(g.reserve(config, payload, 1000));
    assert.throws(() => g.reserve(config, payload, 1000), e => e.code === 'AI_USER_RATE');
  });
  runWithAiActor('user:2', () => assert.ok(g.reserve(config, payload, 1000)));
  runWithAiActor('user:3', () => assert.throws(() => g.reserve(config, payload, 1000), e => e.code === 'AI_CONCURRENCY'));
});

test('failures release concurrency but retain cost reservation and request quota', t => {
  const f = fixture(t, { globalConcurrent: 1 }); const g = f.open();
  const ticket = g.reserve(config, payload, 1000);
  g.finish(ticket, { status: 'error' });
  assert.ok(g.reserve(config, payload, 1000));
  f.advance(7000);
  assert.ok(g.reserve(config, payload, 1000));
});

test('server-funded model, endpoint, output and input are checked at the last boundary', t => {
  const g = fixture(t).open();
  for (const bad of ['deepseek-v4-pro','deepseek-reasoner','claude-opus-4']) {
    assert.throws(() => g.reserve(config, { ...payload, model: bad }, 1000), e => e.code === 'AI_MODEL_FORBIDDEN');
  }
  assert.throws(() => g.reserve({ ...config, baseUrl: 'https://attacker.example/v1' }, payload, 1000), e => e.code === 'AI_ENDPOINT_FORBIDDEN');
  assert.throws(() => g.reserve(config, { ...payload, max_tokens: 16385 }, 1000), e => e.code === 'AI_OUTPUT_LIMIT');
  assert.throws(() => g.reserve(config, { ...payload, messages: [{ role: 'user', content: 'x'.repeat(110000) }] }, 1000), e => e.code === 'AI_INPUT_LIMIT');
});

test('long high-reasoning requests still reserve their entire allowance against the daily budget', t => {
  const g = fixture(t, {dailyBudgetMicros: 200000}).open();
  const long = {...payload, max_tokens:16384};
  const ticket = g.reserve(config, long, 1000);
  g.finish(ticket, {usage:{prompt_tokens:10,completion_tokens:10}});
  assert.throws(() => g.reserve(config, long, 1000), e => e.code === 'AI_DAILY_BUDGET');
});

test('zero budget disables paid calls; caller-owned keys do not spend the site allowance', t => {
  const g = fixture(t, { dailyBudgetMicros: 0 }).open();
  assert.throws(() => g.reserve(config, payload, 1000), e => e.code === 'AI_DAILY_BUDGET');
  assert.equal(g.reserve({ ...config, usesServerDeepSeekKey: false }, payload, 1000), null);
});

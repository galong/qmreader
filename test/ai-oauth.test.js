const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-ai-oauth-test-'));
process.env.QMREADER_DATA_DIR = testDataDir;

const store = require('../lib/store');
const deepseek = require('../lib/deepseek');
const protocols = require('../lib/ai-protocols');
const { createAiOAuth } = require('../lib/ai-oauth');
const { createSecretBox } = require('../lib/secret-box');
const { requestAiConfig } = require('../lib/request-ai-config');

after(() => fs.rmSync(testDataDir, { recursive: true, force: true }));

const SECRET = 'unit-test-secret-key-0123456789';
const alice = store.createUser({ email: 'alice-oauth@example.com', password: 'password-12345', displayName: 'Alice' });
const bob = store.createUser({ email: 'bob-oauth@example.com', password: 'password-12345', displayName: 'Bob' });

function jwt(claims) {
  const part = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${part({ alg: 'none' })}.${part(claims)}.sig`;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function makeOAuth(fetchImpl, overrides = {}) {
  return createAiOAuth({
    store,
    secretBox: createSecretBox(SECRET),
    fetchImpl,
    env: { AI_OAUTH_ENABLED: '1' },
    ...overrides,
  });
}

function stateOf(authUrl) {
  return new URL(authUrl).searchParams.get('state');
}

test('secret box round-trips, rejects tampering and refuses to run without a key', () => {
  const box = createSecretBox(SECRET);
  const sealed = box.encrypt({ access: 'tok-123' });
  assert.ok(!sealed.includes('tok-123'));
  assert.deepEqual(box.decrypt(sealed), { access: 'tok-123' });
  const parts = sealed.split('.');
  parts[3] = Buffer.from('tampered').toString('base64url');
  assert.throws(() => box.decrypt(parts.join('.')));
  assert.throws(() => createSecretBox(SECRET + 'x').decrypt(sealed));
  const none = createSecretBox('short');
  assert.equal(none.available, false);
  assert.throws(() => none.encrypt({ a: 1 }));
});

test('everything is off unless AI_OAUTH_ENABLED=1, and accounts need the encryption key', () => {
  const off = makeOAuth(async () => { throw new Error('no network'); }, { env: {} });
  assert.equal(off.status().enabled, false);
  assert.throws(() => off.start('codex', { userId: alice.id }), /未开启/);
  const noKey = makeOAuth(async () => { throw new Error('no network'); }, { secretBox: createSecretBox('') });
  assert.equal(noKey.status().kinds.codex, false);
  assert.equal(noKey.status().kinds.openrouter, true);
  assert.throws(() => noKey.start('chatgpt', { userId: alice.id }), /加密密钥/);
});

test('codex sign-in: PKCE, state binding, encrypted storage, no token in public views', async () => {
  const calls = [];
  const access = jwt({ exp: Math.floor(Date.now() / 1000) + 3600, 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-1' } });
  const oauth = makeOAuth(async (url, init) => {
    calls.push({ url, body: String(init.body) });
    return jsonResponse({
      access_token: access, refresh_token: 'refresh-secret-1', expires_in: 3600,
      id_token: jwt({ email: 'alice@openai.test', 'https://api.openai.com/auth': { chatgpt_plan_type: 'plus' } }),
    });
  });
  const started = oauth.start('codex', { userId: alice.id });
  assert.equal(started.mode, 'paste');
  const authUrl = new URL(started.authUrl);
  assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authUrl.searchParams.get('redirect_uri'), 'http://localhost:1455/auth/callback');
  const state = stateOf(started.authUrl);

  // another user cannot finish alice's sign-in
  await assert.rejects(oauth.finish({ kind: 'codex', callbackUrl: `http://localhost:1455/auth/callback?code=x&state=${state}` }, { userId: bob.id }), /过期或不匹配/);
  // a stolen/forged state is also gone after one failed attempt only if consumed; start again
  const second = oauth.start('codex', { userId: alice.id });
  const state2 = stateOf(second.authUrl);
  await assert.rejects(oauth.finish({ kind: 'codex', callbackUrl: `http://evil.test/auth/callback?code=x&state=${state2}` }, { userId: alice.id }), /不是登录完成后/);

  const third = oauth.start('codex', { userId: alice.id });
  const result = await oauth.finish({ kind: 'codex', callbackUrl: `http://localhost:1455/auth/callback?code=abc&state=${stateOf(third.authUrl)}` }, { userId: alice.id });
  assert.equal(result.account.email, 'alice@openai.test');
  assert.equal(result.account.plan, 'plus');
  assert.ok(!JSON.stringify(result).includes('refresh-secret-1'));
  assert.ok(calls[0].body.includes('code_verifier='));
  // state is single-use
  await assert.rejects(oauth.finish({ kind: 'codex', callbackUrl: `http://localhost:1455/auth/callback?code=abc&state=${stateOf(third.authUrl)}` }, { userId: alice.id }), /过期或不匹配/);

  const raw = store.getAiOAuthAccount(result.account.id, alice.id);
  assert.ok(!raw.secret.includes('refresh-secret-1') && !raw.secret.includes(access));
  assert.equal(store.getAiOAuthAccount(result.account.id, bob.id), null);
  assert.ok(!JSON.stringify(oauth.listAccounts(alice.id)).includes('secret'));

  const live = await oauth.resolveAccess(result.account.id, alice.id);
  assert.equal(live.access, access);
  assert.equal(live.accountId, 'acct-1');
  assert.match(live.base, /chatgpt\.com\/backend-api\/codex/);
  await assert.rejects(oauth.resolveAccess(result.account.id, bob.id), /不存在/);
});

test('refresh tokens rotate once even for concurrent requests, and an expired login asks to sign in again', async () => {
  let refreshCalls = 0;
  const fresh = jwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
  const oauth = makeOAuth(async (url, init) => {
    const body = String(init.body);
    if (body.includes('authorization_code')) {
      return jsonResponse({ access_token: jwt({}), refresh_token: 'r1', expires_in: 1, id_token: jwt({ email: 'rot@openai.test' }) });
    }
    refreshCalls += 1;
    await new Promise(resolve => setTimeout(resolve, 20));
    if (body.includes('revoked')) return jsonResponse({ error: 'invalid_grant' }, 400);
    return jsonResponse({ access_token: fresh, refresh_token: 'r2', expires_in: 3600 });
  });
  const started = oauth.start('codex', { userId: alice.id });
  const { account } = await oauth.finish({ kind: 'codex', callbackUrl: `http://localhost:1455/auth/callback?code=c&state=${stateOf(started.authUrl)}` }, { userId: alice.id });
  const [a, b] = await Promise.all([oauth.resolveAccess(account.id, alice.id), oauth.resolveAccess(account.id, alice.id)]);
  assert.equal(refreshCalls, 1);
  assert.equal(a.access, fresh);
  assert.equal(b.access, fresh);
  const stored = createSecretBox(SECRET).decrypt(store.getAiOAuthAccount(account.id, alice.id).secret);
  assert.equal(stored.refresh, 'r2');

  // an account whose refresh token was revoked
  const revoked = store.saveAiOAuthAccount({
    userId: alice.id, kind: 'codex', label: 'x', email: 'revoked@openai.test', plan: '',
    secret: createSecretBox(SECRET).encrypt({ kind: 'codex', access: 'old', refresh: 'revoked', expires: 1, clientId: 'c' }), expiresAt: 1,
  });
  await assert.rejects(oauth.resolveAccess(revoked.id, alice.id), /重新登录/);
});

test('chatgpt sign-in validates issuer, audience, nonce and the direct-use scope', async () => {
  let nonce = '';
  const make = (overrides = {}) => makeOAuth(async () => jsonResponse({
    access_token: jwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
    refresh_token: 'r', scope: 'openid chatgpt.tokens.use.direct',
    id_token: jwt({ iss: 'https://auth.openai.com', aud: ['client-9'], nonce, email: 'c@openai.test', ...overrides.claims }),
    ...overrides.tok,
  }));
  for (const [name, overrides, pattern] of [
    ['ok', {}, null],
    ['bad nonce', { claims: { nonce: 'other' } }, /校验未通过/],
    ['bad aud', { claims: { aud: ['someone-else'] } }, /校验未通过/],
    ['no scope', { tok: { scope: 'openid' } }, /暂不支持/],
  ]) {
    const oauth = make(overrides);
    const started = oauth.start('chatgpt', { userId: alice.id });
    nonce = new URL(started.authUrl).searchParams.get('nonce');
    if (overrides.claims && overrides.claims.nonce) overrides.claims.nonce = 'other';
    const callbackUrl = `http://127.0.0.1:1455/auth/callback?code=c&client_id=client-9&state=${stateOf(started.authUrl)}`;
    if (pattern) await assert.rejects(oauth.finish({ kind: 'chatgpt', callbackUrl }, { userId: alice.id }), pattern, name);
    else assert.equal((await oauth.finish({ kind: 'chatgpt', callbackUrl }, { userId: alice.id })).account.email, 'c@openai.test', name);
  }
});

test('openrouter returns an ordinary key through the https redirect and is never stored', async () => {
  const oauth = makeOAuth(async (url, init) => {
    assert.match(url, /openrouter\.ai\/api\/v1\/auth\/keys/);
    assert.ok(JSON.parse(init.body).code_verifier);
    return jsonResponse({ key: 'sk-or-v1-test' });
  });
  const started = oauth.start('openrouter', { userId: alice.id, origin: 'https://rss.example.com' });
  assert.equal(started.mode, 'redirect');
  assert.equal(new URL(started.authUrl).searchParams.get('callback_url'), 'https://rss.example.com/api/ai/oauth/callback');
  const state = stateOf(started.authUrl);
  // kind can be derived from the state, as the callback route does
  const result = await oauth.finish({ callbackUrl: `https://rss.example.com/api/ai/oauth/callback?code=zz&state=${state}` }, { userId: alice.id });
  assert.equal(result.apiKey, 'sk-or-v1-test');
  const id = oauth.stash(alice.id, result);
  assert.throws(() => oauth.claim(id, bob.id), /过期/);
  assert.equal(oauth.claim(oauth.stash(alice.id, result), alice.id).apiKey, 'sk-or-v1-test');
  assert.throws(() => oauth.start('openrouter', { userId: alice.id, origin: 'http://insecure.example.com' }), /公开地址/);
});

test('requestAiConfig routes account sign-in by id only and ignores caller routing', () => {
  const request = headers => ({ user: { id: 'u1' }, get: name => headers[name.toLowerCase()] || '' });
  const config = requestAiConfig(request({
    'x-ai-provider': 'codex-account', 'x-ai-oauth-account': 'acct', 'x-ai-base-url': 'https://evil.example/v1', 'x-ai-model': 'gpt-5.6-sol',
  }));
  assert.equal(config.providerType, 'openai_responses');
  assert.equal(config.baseUrl, '');
  assert.equal(config.oauthAccountId, 'acct');
  assert.equal(config.oauthUserId, 'u1');
  // a non-account provider with an account header falls back to the normal server-funded path
  assert.equal(requestAiConfig(request({ 'x-ai-provider': 'openai', 'x-ai-oauth-account': 'acct' })).oauthAccountId, undefined);
});

test('getConfig never lets an account token travel to a client-chosen host', () => {
  const config = deepseek.getConfig({ provider: 'chatgpt-account', oauthAccountId: 'a', oauthUserId: 'u', baseUrl: 'https://evil.example', model: 'm' });
  assert.equal(config.baseUrl, '');
  assert.equal(config.usesOAuth, true);
  assert.throws(() => deepseek.getConfig({ provider: 'openai', oauthAccountId: 'a', apiKey: 'k', baseUrl: 'https://api.openai.com/v1', model: 'm' }), /只支持 ChatGPT 或 Codex/);
  assert.throws(() => deepseek.getConfig({ provider: 'codex-account', apiKey: 'k', baseUrl: 'https://x.example', model: 'm' }), /登录/);
});

function withFetch(handler) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, init = {}) => { calls.push({ url: String(url), init }); return handler(String(url), init); };
  return { calls, restore: () => { global.fetch = original; } };
}

test('responses protocol streams text for ChatGPT / Codex accounts through the server-held token', async () => {
  deepseek.setOAuthResolver(async (id, userId) => {
    assert.equal(id, 'acct'); assert.equal(userId, 'u1');
    return { kind: 'codex', access: 'live-token', accountId: 'acct-1', base: 'https://chatgpt.com/backend-api/codex' };
  });
  const sse = [
    'data: {"type":"response.output_text.delta","delta":"po"}',
    'data: {"type":"response.output_text.delta","delta":"ng"}',
    'data: {"type":"response.completed","response":{"output":[]}}',
    '',
  ].join('\n\n');
  const f = withFetch(() => new Response(sse, { status: 200 }));
  try {
    const config = deepseek.getConfig({ provider: 'codex-account', oauthAccountId: 'acct', oauthUserId: 'u1', model: 'gpt-5.6-sol' });
    const text = await deepseek.__test.postChatCompletion(config, { messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'ping' }] });
    assert.equal(text, 'pong');
    assert.equal(f.calls[0].url, 'https://chatgpt.com/backend-api/codex/responses');
    assert.equal(f.calls[0].init.headers.Authorization, 'Bearer live-token');
    assert.equal(f.calls[0].init.headers['chatgpt-account-id'], 'acct-1');
    const body = JSON.parse(f.calls[0].init.body);
    assert.equal(body.instructions, 'sys');
    assert.equal(body.stream, true);
    assert.equal(body.input[0].content[0].type, 'input_text');
  } finally { f.restore(); deepseek.setOAuthResolver(null); }

  const failed = withFetch(() => new Response('data: {"type":"response.failed","response":{"error":{"message":"quota"}}}\n\n', { status: 200 }));
  try {
    deepseek.setOAuthResolver(async () => ({ kind: 'chatgpt', access: 't', accountId: '', base: 'https://api.openai.com/v1' }));
    const config = deepseek.getConfig({ provider: 'chatgpt-account', oauthAccountId: 'a', oauthUserId: 'u', model: 'm' });
    await assert.rejects(deepseek.__test.postChatCompletion(config, { messages: [{ role: 'user', content: 'x' }] }), /quota/);
  } finally { failed.restore(); deepseek.setOAuthResolver(null); }
});

test('gemini and azure protocols build the right request and read the right reply', async () => {
  const gemini = withFetch(() => jsonResponse({ candidates: [{ content: { parts: [{ text: 'hello' }] }, finishReason: 'STOP' }] }));
  try {
    const config = deepseek.getConfig({
      provider: 'google-gemini', providerType: 'gemini', apiKey: 'AIza-test', model: 'gemini-3.5-flash',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    });
    assert.equal(await deepseek.__test.postChatCompletion(config, { messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }, { role: 'assistant', content: 'a' }] }), 'hello');
    assert.equal(gemini.calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent');
    assert.equal(gemini.calls[0].init.headers['x-goog-api-key'], 'AIza-test');
    const body = JSON.parse(gemini.calls[0].init.body);
    assert.equal(body.systemInstruction.parts[0].text, 's');
    assert.deepEqual(body.contents.map(c => c.role), ['user', 'model']);
  } finally { gemini.restore(); }

  const truncated = withFetch(() => jsonResponse({ candidates: [{ content: { parts: [{ text: 'cut' }] }, finishReason: 'MAX_TOKENS' }] }));
  try {
    const config = deepseek.getConfig({ provider: 'google-gemini', providerType: 'gemini', apiKey: 'k', model: 'm', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' });
    await assert.rejects(deepseek.__test.postChatCompletion(config, { messages: [{ role: 'user', content: 'x' }] }), /token 上限/);
  } finally { truncated.restore(); }

  const azure = withFetch(() => jsonResponse({ choices: [{ message: { content: 'az' }, finish_reason: 'stop' }] }));
  try {
    const config = deepseek.getConfig({
      provider: 'azure-openai', providerType: 'azure_openai', apiKey: 'az-key', model: 'my-deploy',
      baseUrl: 'https://res1.openai.azure.com/openai/deployments/{deployment-id}/chat/completions?api-version=2024-10-21',
    });
    assert.equal(await deepseek.__test.postChatCompletion(config, { messages: [{ role: 'user', content: 'x' }] }), 'az');
    assert.equal(azure.calls[0].url, 'https://res1.openai.azure.com/openai/deployments/my-deploy/chat/completions?api-version=2024-10-21');
    assert.equal(azure.calls[0].init.headers['api-key'], 'az-key');
    assert.equal(azure.calls[0].init.headers.Authorization, undefined);
    const body = JSON.parse(azure.calls[0].init.body);
    assert.ok(body.max_completion_tokens && body.max_tokens === undefined && body.temperature === undefined);
  } finally { azure.restore(); }
  assert.throws(() => deepseek.getConfig({ provider: 'azure-openai', providerType: 'azure_openai', apiKey: 'k', model: 'm', baseUrl: 'https://{resource-name}.openai.azure.com/x' }), /占位符/);
});

test('model lists are read from each protocol and secrets stay out of error text', async () => {
  const gemini = withFetch(() => jsonResponse({ models: [
    { name: 'models/gemini-a', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/embed', supportedGenerationMethods: ['embedContent'] },
  ] }));
  try {
    const result = await deepseek.listModels({ provider: 'google-gemini', providerType: 'gemini', apiKey: 'k', model: 'gemini-a', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' });
    assert.deepEqual(result.models, ['gemini-a']);
    assert.match(gemini.calls[0].url, /v1beta\/models\?pageSize=1000$/);
  } finally { gemini.restore(); }

  deepseek.setOAuthResolver(async () => ({ kind: 'codex', access: 'tok', accountId: 'a', base: 'https://chatgpt.com/backend-api/codex' }));
  const codex = withFetch(() => jsonResponse({ models: [{ slug: 'gpt-x', visibility: 'list' }, { slug: 'hidden', visibility: 'hide' }] }));
  try {
    const result = await deepseek.listModels({ provider: 'codex-account', oauthAccountId: 'a', oauthUserId: 'u', model: 'gpt-x' });
    assert.deepEqual(result.models, ['gpt-x']);
    assert.match(codex.calls[0].url, /codex\/models\?client_version=/);
  } finally { codex.restore(); deepseek.setOAuthResolver(null); }

  assert.deepEqual(protocols.parseResponsesStream('data: {"type":"response.completed","response":{"output":[{"content":[{"type":"output_text","text":"fallback"}]}]}}\n').content, 'fallback');
});

test('legacy aigocode "codex" / "anthropic" profiles with an API key keep working', () => {
  const codex = deepseek.getConfig({ provider: 'codex', apiKey: 'k', model: 'codex-auto-review' });
  assert.equal(codex.usesOAuth, undefined);
  assert.equal(codex.providerType, 'openai_compatible');
  const official = deepseek.getConfig({ provider: 'anthropic-official', providerType: 'anthropic_compatible', apiKey: 'sk-ant-x', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5' });
  assert.equal(official.providerType, 'anthropic_compatible');
});

test('Responses stream must finish before partial text can be accepted', async () => {
  deepseek.setOAuthResolver(async () => ({ kind: 'codex', access: 'test', base: 'https://chatgpt.com/backend-api/codex' }));
  const f = withFetch(() => new Response('data: {"type":"response.output_text.delta","delta":"unfinished"}\n\n', { status: 200 }));
  try {
    const config = deepseek.getConfig({ provider: 'codex-account', oauthAccountId: 'acct', oauthUserId: 'u', model: 'test' });
    await assert.rejects(deepseek.__test.postChatCompletion(config, { messages: [{ role: 'user', content: 'test' }] }), /未完成|不完整/);
  } finally { f.restore(); deepseek.setOAuthResolver(null); }
});

test('account requests remain private BYOK when the website gateway is configured', t => {
  const previous = process.env.SITE_MAGPIE_API_KEY;
  process.env.SITE_MAGPIE_API_KEY = 'site-test-only';
  t.after(() => { if (previous === undefined) delete process.env.SITE_MAGPIE_API_KEY; else process.env.SITE_MAGPIE_API_KEY = previous; });
  const config = deepseek.getConfig({ provider: 'codex-account', oauthAccountId: 'acct', oauthUserId: 'user', model: 'selected-model' });
  assert.equal(config.usesOAuth, true);
  assert.equal(config.usesServerMagpieKey, undefined);
  assert.equal(config.model, 'selected-model');
  assert.throws(() => deepseek.getConfig({ provider: 'codex-account' }), /登录/);
});

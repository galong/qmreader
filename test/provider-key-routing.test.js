const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const store = {};
  const context = vm.createContext({
    window: {}, URL, document: { createElement: () => ({}) },
    state: { aiProfiles: [], aiProviders: [] },
    storage: { setItem: (k, v) => { store[k] = v; }, getItem: k => store[k] },
    readJson: (k, fallback) => (k in store ? JSON.parse(store[k]) : JSON.parse(fallback)),
    aiScope: () => 'user:1',
    createId: prefix => `${prefix}-${Math.random().toString(36).slice(2)}`,
    AI_PROVIDER_MAP: {},
    AI_PROVIDER_PRESETS: [],
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/provider-icons.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/ai-providers.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/ai-settings.js'), 'utf8'), context);
  return context;
}

test('profiles that share a credential migrate into one provider, unconfigured ones stay hidden', () => {
  const context = load();
  const base = { provider: 'deepseek', providerName: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-a', oauthAccountId: '' };
  const migrated = context.window.QMAiSettings.migrate([
    { id: 'm1', ...base, model: 'a' },
    { id: 'm2', ...base, model: 'b' },
    { id: 'm3', ...base, apiKey: 'sk-b', model: 'c' },
    { id: 'm4', ...base, apiKey: '', model: 'd' },
  ]);
  const providers = context.state.aiProviders;
  assert.equal(providers.length, 2);
  assert.equal(migrated[0].providerId, migrated[1].providerId);
  assert.notEqual(migrated[0].providerId, migrated[2].providerId);
  assert.equal(migrated[3].providerId, '', 'a profile without a key or account gets no provider');
  assert.equal(providers[0].apiKey, 'sk-a');
});

test('every preset is reachable from the add-service gallery', () => {
  const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const settings = fs.readFileSync(path.join(__dirname, '../public/ai-settings.js'), 'utf8');
  const block = app.slice(app.indexOf('const AI_PROVIDER_PRESETS = ['), app.indexOf('// Extra platforms, account sign-in'));
  const ids = [...block.matchAll(/^    id: '([a-z0-9_-]+)',$/gm)].map(m => m[1]);
  const extra = fs.readFileSync(path.join(__dirname, '../public/ai-providers.js'), 'utf8');
  ids.push(...[...extra.matchAll(/\{ id: '([a-z0-9_-]+)', name:/g)].map(m => m[1]));
  const hidden = new Set(['anthropic']);
  for (const id of new Set(ids)) {
    if (hidden.has(id)) continue;
    assert.ok(settings.includes(`'${id}'`), `${id} is missing from the gallery spec`);
  }
});

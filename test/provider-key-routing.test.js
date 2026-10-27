const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('automatic model discovery waits for a recognized key to match the selected service', () => {
  const calls = [];
  let profile;
  const context = vm.createContext({ window: {}, URL, readAiProfileForm: () => profile, fetchAiModels: () => calls.push(profile.provider), renderTemplateList() {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/ai-providers.js'), 'utf8'), context);
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('function aiProviderHost()'), source.indexOf('function mountAiProviderUi(')), context);
  context.api = () => {};
  for (const [key, provider] of [['sk-ant-test', 'anthropic-official'], ['sk-or-test', 'openrouter'], ['AIza1234567890123456789012345', 'google-gemini']]) {
    profile = { apiKey: key, provider: 'custom', baseUrl: 'https://unrelated.example/v1' };
    const before = calls.length;
    vm.runInContext('aiProviderHost().autoFetchModels()', context);
    assert.equal(calls.length, before, 'must not send recognizable credentials to the old service');
    profile = { ...profile, provider };
    vm.runInContext('aiProviderHost().autoFetchModels()', context);
    assert.equal(calls.length, before + 1);
  }
});

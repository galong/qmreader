const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
function fixture(data, refreshFails = false) {
  const messages = [];
  let refreshes = 0;
  const refresh = async () => { refreshes++; if (refreshFails) throw new Error('offline'); };
  const context = {
    data, messages, state: { me: { role: 'admin' }, articleLinkMenuUrl: 'https://example.com/article' },
    hideArticleLinkMenu() {}, api: async () => data, toast: text => messages.push(text),
    loadSources: refresh, loadEntries: refresh, loadContributors: refresh,
    updateListTitle() {}, renderList() {}, renderSidebar() {},
  };
  const helper = source.slice(source.indexOf('async function showSubmittedLinkResult('), source.indexOf('async function submitReaderLink('));
  const entryPoint = source.slice(source.indexOf('async function submitArticleLinkToSite('), source.indexOf('function openArticleLinkInWindow('));
  vm.runInNewContext(helper + entryPoint, context);
  return { context, messages, refreshes: () => refreshes };
}
test('collect-to-site reports pending submissions without claiming publication or rewrite', async () => {
  const f = fixture({ pending: true });
  await f.context.submitArticleLinkToSite();
  assert.match(f.messages[0], /审核队列/);
  assert.doesNotMatch(f.messages[0], /已收录|正在生成/);
  assert.equal(f.refreshes(), 0);
});
test('administrator collection reports publication and only promises queued rewrite', async () => {
  for (const rewriteQueued of [true, false]) {
    const f = fixture({ pending: false, rewriteQueued });
    await f.context.submitArticleLinkToSite();
    assert.match(f.messages[0], /已收录/);
    assert.equal(f.messages[0].includes('改写'), rewriteQueued);
    assert.equal(f.refreshes(), 3);
    assert.equal(f.context.state.articleLinkSubmitting, false);
  }
});
test('list refresh failure after collection never claims submission failed', async () => {
  const f = fixture({ pending: false, duplicate: true }, true);
  await f.context.submitArticleLinkToSite();
  assert.match(f.messages.at(-1), /已收录.*列表刷新失败/);
  assert.ok(f.messages.every(message => !message.includes('收录失败')));
});

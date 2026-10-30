const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderReadBootstrap, renderArticleBootstrap } = require('../lib/read-bootstrap');
test('public first-list payload is bounded and contains no article bodies', () => {
  const input = Array.from({ length: 80 }, (_, i) => ({ id: String(i), title: 'Article', content: 'body' }));
  const html = renderReadBootstrap(input, 10);
  const data = JSON.parse(html.slice(html.indexOf('>') + 1, html.lastIndexOf('</script>')));
  assert.equal(data.entries.length, 40);
  assert.equal(data.createdAt, 10);
  assert.equal('content' in data.entries[0], false);
});
test('article bootstrap preserves text without allowing script termination', () => {
  const reading = { entry: { id: 'a', content: '<p>original</p>' }, rewrite: { body: '</script><script>attack</script>\u2028正文' } };
  const html = renderArticleBootstrap(reading, '/articles/a/rewrite', 10);
  assert.equal((html.match(/<\/script>/g) || []).length, 1);
  assert.ok(!html.includes('<script>attack'));
  const data = JSON.parse(html.slice(html.indexOf('>') + 1, html.lastIndexOf('</script>')));
  assert.deepEqual(data.rewrite, reading.rewrite);
  assert.equal(data.pathname, '/articles/a/rewrite');
});
test('feed titles cannot terminate the inert bootstrap script', () => {
  const html = renderReadBootstrap([{ id: 'x', title: '</script><script>alert(1)</script>\u2028' }]);
  assert.equal((html.match(/<\/script>/g) || []).length, 1);
  assert.ok(!html.includes('<script>alert'));
  const data = JSON.parse(html.slice(html.indexOf('>') + 1, html.lastIndexOf('</script>')));
  assert.equal(data.entries[0].title, '</script><script>alert(1)</script>\u2028');
});

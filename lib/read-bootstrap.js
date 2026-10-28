'use strict';
// One response-scoped public list. Never persist account data or article bodies here.
function renderReadBootstrap(entries, now = Date.now()) {
  const payload = { version: 1, createdAt: now, entries: entries.slice(0, 40).map(entry => {
    const { content, ...metadata } = entry;
    return metadata;
  }) };
  const json = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<script id="qm-reader-bootstrap" type="application/json">${json}</script>`;
}
function renderArticleBootstrap(reading, pathname, now = Date.now()) {
  const json = JSON.stringify({ version: 1, createdAt: now, pathname, ...reading })
    .replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<script id="qm-article-bootstrap" type="application/json">${json}</script>`;
}
module.exports = { renderReadBootstrap, renderArticleBootstrap };

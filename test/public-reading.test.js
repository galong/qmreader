const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-public-reading-'));
process.env.QMREADER_DATA_DIR = directory;
const store = require('../lib/store');

test('real public HTTP serves first list, anonymous article and distinct minimal/full/plugin variants', { timeout: 15000 }, async t => {
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const entries = Array.from({ length: 42 }, (_, i) => ({ id: `public-${i}`, sourceId: 'qiaomu-blog', title: `Public reading ${i}`, content: '<p>Public body without registration.</p>', link: `https://example.com/public-${i}`, publishedTs: Date.now() - i * 60000, summary: 'Public summary' }));
  store.upsertEntries(entries);
  store.softDeleteEntry('public-1');
  store.upsertEntries([{ ...entries[0], id: 'opt-in-secret', sourceId: 'podscribe-pivot', title: 'Not opted in' }]);
  const port = 45000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), STARTUP_REFRESH_DELAY_MS: '-1', FRESHNESS_SWEEP_INTERVAL_MS: '-1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { child.kill('SIGTERM'); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('startup timeout')), 5000);
    child.stdout.on('data', chunk => { if (String(chunk).includes('QMReader listening')) { clearTimeout(timer); resolve(); } });
    child.once('exit', code => { clearTimeout(timer); reject(Error('server exited ' + code)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const job = store.enqueueRewriteJob('public-0', { sourceId: 'qiaomu-blog', contentHash: 'fixture' });
  const queuedResponse = await fetch(base + '/api/entry/public-0/rewrite');
  const queued = await queuedResponse.json();
  assert.equal(queued.status, 'queued');
  assert.equal(queued.rewrite, null);
  assert.equal(queued.retryAfterMs, 5000);
  assert.match(queuedResponse.headers.get('cache-control'), /no-store/);
  assert.equal(store.getRewriteJob(job.id).attempts, 0, 'GET never starts a paid generation');
  const queuedV1 = await fetch(base + '/api/v1/entries/public-0?include=rewrite').then(r => r.json());
  assert.equal(queuedV1.readingState.rewrite.status, 'queued');
  const exactMissing = await fetch(base + '/api/entry/public-0/rewrite?assetId=not-found').then(r => r.json());
  assert.equal(exactMissing.status, 'unavailable', 'an exact contribution does not borrow the public job status');
  store.saveRewrite('public-0', { body: 'Chinese ready in the background', model: 'deepseek-flash', contentHash: 'fixture' });
  const ready = await fetch(base + '/api/entry/public-0/rewrite').then(r => r.json());
  assert.equal(ready.status, 'ready');
  assert.match(ready.rewrite.body, /Chinese ready/);
  assert.equal(ready.retryAfterMs, 0);
  const v1 = await fetch(base + '/api/v1/entries/public-0?include=rewrite').then(r => r.json());
  assert.equal(v1.readingState.rewrite.status, 'ready', 'new background content invalidates the earlier API v1 response');
  const response = await fetch(base + '/');
  assert.equal(response.status, 200);
  const html = await response.text();
  const match = html.match(/<script id="qm-reader-bootstrap" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'first list travels with HTML');
  const bootstrap = JSON.parse(match[1]);
  assert.equal(bootstrap.entries.length, 40);
  assert.ok(bootstrap.entries.every(entry => !['public-1', 'opt-in-secret'].includes(entry.id)));
  assert.equal('content' in bootstrap.entries[0], false);
  assert.ok(!response.headers.has('set-cookie'));
  const [full, minimal, compact, webHot] = await Promise.all([
    fetch(base + '/api/entries?limit=40').then(r => r.json()),
    fetch(base + '/api/entries?limit=40&summary=minimal').then(r => r.json()),
    fetch(base + '/api/entries?limit=40', { headers: { 'X-Rss-List': 'reader-v1' } }).then(r => r.json()),
    fetch(base + '/api/entries?limit=40&summary=compact').then(r => r.json()),
  ]);
  assert.equal(full.entries.length, 40);
  assert.ok(full.entries[0].stats);
  assert.ok(webHot.entries[0].stats, 'popular view keeps ranking stats');
  assert.equal(minimal.entries[0].stats, null);
  assert.ok(minimal.entries[0].assets, 'web retains readiness indicators');
  assert.equal(compact.entries[0].assets, undefined);
  assert.equal(compact.entries[0].rewriteReady, true);
  assert.equal(compact.entries[0].rewriteStatus, 'ready');
  assert.deepEqual(full.entries.map(e => e.id), minimal.entries.map(e => e.id));
  assert.deepEqual(full.entries.map(e => e.id), compact.entries.map(e => e.id));
  const sourceFull = await fetch(base + '/api/sources/qiaomu-blog/entries?limit=2').then(r => r.json());
  const sourceCompactResponse = await fetch(base + '/api/sources/qiaomu-blog/entries?limit=2', {headers:{'X-Rss-List':'reader-v1'}});
  assert.match(sourceCompactResponse.headers.get('vary'), /X-Rss-List/i);
  const sourceCompact = await sourceCompactResponse.json();
  assert.deepEqual(sourceCompact.entries.map(e => e.id), sourceFull.entries.map(e => e.id));
  assert.equal(sourceCompact.entries[0].content, undefined);
  assert.equal(sourceCompact.entries[0].assets, undefined);
  assert.equal(sourceCompact.entries[0].rewriteStatus, sourceFull.entries[0].rewriteStatus);
  assert.equal((await fetch(base + '/api/me').then(r => r.json())).user, null);
  const article = await fetch(base + '/api/entry/public-0');
  assert.equal(article.status, 200);
  assert.match((await article.json()).entry.content, /Public body without registration/);
  assert.equal((await fetch(base + '/api/entry/public-1')).status, 404);
  assert.equal((await fetch(base + '/api/version').then(r => r.json())).version, require('../package.json').version);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const cheerio = require('cheerio');

test('service worker keeps private data out of caches and preserves HTTP errors', async () => {
  const handlers = {};
  const removed = [];
  const offline = new Response('offline');
  const context = {
    URL, Response,
    self: { location: { origin: 'https://rss.example' }, addEventListener: (name, fn) => { handlers[name] = fn; } },
    caches: {
      open: async () => ({ match: async () => offline, addAll: async () => {} }),
      keys: async () => ['qmreader-offline-v0', 'another-app'],
      delete: async key => { removed.push(key); },
    },
    fetch: async () => { throw new Error('offline'); },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8'), context);
  const dispatch = async (url, mode = 'cors', method = 'GET') => {
    let response;
    handlers.fetch({ request: { url, mode, method }, respondWith: value => { response = value; } });
    return response;
  };
  assert.equal(await dispatch('https://rss.example/api/me'), undefined);
  assert.equal(await dispatch('https://rss.example/api/auth/logout', 'cors', 'POST'), undefined);
  assert.equal(await dispatch('https://media.example/audio.mp3'), undefined);
  assert.equal(await dispatch('https://rss.example/articles/example', 'navigate'), offline);
  assert.equal(await dispatch('https://rss.example/icons/icon-192.png'), offline);
  context.fetch = async () => new Response('Not found', { status: 404 });
  assert.equal((await dispatch('https://rss.example/missing', 'navigate')).status, 404);
  let activation;
  handlers.activate({ waitUntil: value => { activation = value; } });
  await activation;
  assert.deepEqual(removed, ['qmreader-offline-v0']);
});

test('HTTP output exposes public content, unique SEO metadata and installable PWA assets', { timeout: 20000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-pwa-seo-'));
  const root = path.join(__dirname, '..');
  const fixture = spawn(process.execPath, ['-e', `
    const store = require('./lib/store');
    store.saveSubmittedEntry({ id: 'seo-fixture-12345678', sourceId: 'simonwillison', title: 'SEO fixture title', link: 'https://example.com/source', published: '2026-10-29T00:00:00Z', publishedTs: 1793232000000, summary: 'Public article summary', content: '<p>Original body</p>' });
    store.addComment('seo-fixture-12345678', { author: 'Test reader', body: 'Public insight <script>alert(1)</script>' });
  `], { cwd: root, env: { ...process.env, QMREADER_DATA_DIR: dir }, stdio: 'pipe' });
  assert.equal((await once(fixture, 'exit'))[0], 0);
  const port = 45000 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, QMREADER_DATA_DIR: dir, PORT: String(port), HOST: '127.0.0.1', STARTUP_REFRESH_DELAY_MS: '-1', FRESHNESS_SWEEP_INTERVAL_MS: '-1', ADMIN_EMAIL: '', ADMIN_PASSWORD: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('server startup timeout')), 10000);
      child.stdout.on('data', chunk => {
        output += chunk;
        if (output.includes('QMReader listening')) { clearTimeout(timer); resolve(); }
      });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`server exit: ${code}`)); });
    });
    const home = cheerio.load(await (await fetch(base + '/assets')).text());
    assert.equal(home('link[rel="canonical"]').length, 1);
    assert.equal(home('meta[name="description"]').length, 1);
    assert.equal(home('script[type="application/ld+json"]').length, 1);
    assert.ok(home('.public-summary a[href*="/articles/"]').length);
    const articleUrl = home('.public-summary a[href*="/articles/"]').first().attr('href');
    const article = cheerio.load(await (await fetch(articleUrl)).text());
    assert.equal(article('link[rel="canonical"]').length, 1);
    assert.match(article('meta[property="og:title"]').attr('content'), /SEO fixture title/);
    assert.match(article('.public-summary').text(), /Public insight/);
    assert.match(article('.public-summary').text(), /Test reader/);
    assert.equal(article('.public-summary script').length, 0);
    assert.equal(JSON.parse(article('script[type="application/ld+json"]').text())['@type'], 'Article');
    const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
    assert.ok(sitemap.includes(articleUrl));
    assert.match(await (await fetch(`${base}/robots.txt`)).text(), /OAI-SearchBot/);
    for (const route of ['/me', '/dashboard', '/admin']) {
      const response = await fetch(`${base}${route}`);
      assert.match(response.headers.get('x-robots-tag'), /noindex/);
      assert.match(response.headers.get('cache-control'), /no-store/);
      assert.match(await response.text(), /name="robots" content="noindex,follow"/);
    }
    assert.equal((await fetch(`${base}/articles/missing`)).status, 404);
    assert.equal((await fetch(`${base}/index.html`, { redirect: 'manual' })).status, 301);
    const manifestResponse = await fetch(`${base}/manifest.webmanifest`);
    assert.match(manifestResponse.headers.get('content-type'), /application\/manifest\+json/);
    const manifest = await manifestResponse.json();
    assert.equal(manifest.display, 'standalone');
    for (const icon of manifest.icons) {
      const response = await fetch(base + icon.src);
      const buffer = Buffer.from(await response.arrayBuffer());
      assert.equal(response.status, 200);
      assert.equal(buffer.toString('ascii', 1, 4), 'PNG');
      assert.equal(`${buffer.readUInt32BE(16)}x${buffer.readUInt32BE(20)}`, icon.sizes);
    }
    const worker = await fetch(`${base}/sw.js`);
    assert.equal(worker.headers.get('cache-control'), 'no-cache');
    assert.equal(worker.headers.get('service-worker-allowed'), '/');
    assert.match(await (await fetch(`${base}/offline.html`)).text(), /暂时无法连接/);
  } finally {
    child.kill('SIGTERM');
    await once(child, 'exit');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

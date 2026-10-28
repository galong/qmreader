const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-podcast-visibility-'));
const notes = path.join(directory, 'notes');
fs.mkdirSync(notes);
process.env.QMREADER_DATA_DIR = directory;
process.env.QMREADER_PODCAST_NOTES_DIR = notes;
const store = require('../lib/store');
const podcastTranscript = require('../lib/podcast-transcript');

test('podcast rewrites saved under the legacy v1 hash are still served after the v2 hash change', { timeout: 15000 }, async t => {
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const episodeId = '6ae1861197726cd46758f0f3';
  const sourceUrl = `https://www.xiaoyuzhoufm.com/episode/${episodeId}`;
  const transcript = '[00:01] 主播：文艺复兴背后的美第奇家族。\n'.repeat(80);
  fs.writeFileSync(path.join(notes, `${episodeId}.json`), JSON.stringify({
    episodeId, sourceId: 'bannatie', sourceUrl, transcript,
    transcriptDigest: '分段提炼'.repeat(40), digestVersion: podcastTranscript.DIGEST_VERSION,
    digestTranscriptHash: podcastTranscript.transcriptHash(transcript), summary: '摘要',
  }));
  store.upsertEntries([{ id: 'episode-224', sourceId: 'bannatie', title: 'No.224 美第奇家族·下', link: sourceUrl,
    content: '<p>show notes</p>', summary: 'show notes', publishedTs: Date.now() }]);
  store.saveRewrite('episode-224', { body: '[00:01] 美第奇家族的中文稿。', model: 'deepseek-flash',
    contentHash: 'podcast-transcript-v1:b6c3f3e450ef5dcfcad5197d804e3ebb2ac5897e69810d43a156421e3c513d2c' });

  const port = 46000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, HOST: '127.0.0.1', PORT: String(port),
    STARTUP_REFRESH_DELAY_MS: '-1', FRESHNESS_SWEEP_INTERVAL_MS: '-1', REWRITE_CATCHUP_INTERVAL_MS: '-1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { child.kill('SIGTERM'); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('startup timeout')), 5000);
    child.stdout.on('data', chunk => { if (String(chunk).includes('QMReader listening')) { clearTimeout(timer); resolve(); } });
    child.once('exit', code => { clearTimeout(timer); reject(Error('server exited ' + code)); });
  });
  const data = await fetch(`http://127.0.0.1:${port}/api/entry/episode-224/rewrite`).then(r => r.json());
  assert.equal(data.status, 'ready');
  assert.equal(data.rewrite.body, '美第奇家族的中文稿。', 'timestamps are stripped and the legacy rewrite is visible');
  assert.equal(data.rewrite.stale, false);
});

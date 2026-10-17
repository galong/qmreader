const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-getnote-rewrite-'));
process.env.QMREADER_YOUTUBE_NOTES_DIR = path.join(dir, 'getnote');
process.env.QMREADER_PODSCRIBE_NOTES_DIR = path.join(dir, 'podscribe');
fs.mkdirSync(process.env.QMREADER_YOUTUBE_NOTES_DIR);
const moduleUnderTest = require('../lib/podscribe-entry');
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const entry = { id:'fallback-episode', sourceId:'allin', link:'https://www.youtube.com/watch?v=_b3LfMflIGs', title:'The exact episode' };
const file = path.join(process.env.QMREADER_YOUTUBE_NOTES_DIR, '_b3LfMflIGs.json');
const text = 'A complete transcript from the exact original video. '.repeat(50);
const note = {videoId:'_b3LfMflIGs',sourceId:'allin',sourceUrl:entry.link,noteId:'12345678',status:'transcript',transcript:text};

test('ready GetNote video transcript feeds rewrite while raw private transcript stays unavailable publicly', async t => {
  fs.writeFileSync(file, JSON.stringify(note));
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Existing complete transcript should not need network'); });
  let input;
  const result = await moduleUnderTest.ensureReady(entry, async value => { input = value; return '完整文稿的事实提炼。'.repeat(30); });
  assert.equal(input, text.trim());
  assert.equal(result.transcriptProvider, 'getnote');
  assert.equal(result.transcriptPrivate, true);
  assert.equal(result.sourceUrl, entry.link);
  assert.ok(moduleUnderTest.loadReady(entry));
  await assert.rejects(() => moduleUnderTest.ensureTranscript(entry), error => error.statusCode === 403);
});

test('GetNote fallback refuses mismatched identity, processing notes and short summaries', () => {
  for (const changed of [{videoId:'aaaaaaaaaaa'}, {sourceId:'joerogan'}, {sourceUrl:'https://www.youtube.com/watch?v=aaaaaaaaaaa'}, {status:'processing'}, {transcript:'summary only'}]) {
    fs.writeFileSync(file, JSON.stringify({...note,...changed}));
    assert.equal(moduleUnderTest.loadGetnoteTranscript(entry), null);
  }
});

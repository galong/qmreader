const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-preserve-'));
process.env.QMREADER_DATA_DIR = dir;
const store = require('../lib/store');
const { createPlacement } = require('../lib/entry-placement.cjs');
const { createProgress } = require('../lib/translation-progress.cjs');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('moved articles survive a feed refresh and can return to the original channel', () => {
  store.upsertEntries([{ id: 'move-test', sourceId: 'original', title: 'Article' }]);
  const placement = createPlacement({ dbFile: path.join(dir, 'qmreader.sqlite'), getSource: id => ['original', 'destination'].includes(id) ? { id, name: id } : null });
  try {
    assert.equal(placement.move('move-test', 'destination', 'admin').sourceId, 'destination');
    store.upsertEntries([{ id: 'move-test', sourceId: 'original', title: 'Updated Article' }]);
    assert.equal(store.getEntry('move-test').sourceId, 'destination');
    assert.equal(placement.decorate({ id: 'move-test', sourceId: 'original' }).sourceId, 'destination');
    assert.throws(() => placement.move('move-test', 'missing', 'admin'), /invalid_source/);
    placement.move('move-test', 'original', 'admin');
    assert.equal(store.getEntry('move-test').sourceId, 'original');
    assert.deepEqual(placement.entries(), []);
  } finally { placement.close(); }
});

test('translation resumes only missing blocks after restart and force bypasses the checkpoint', async () => {
  const db = path.join(dir, 'progress.sqlite');
  const config = { provider: 'fixture', model: 'fixture' };
  const entry = { id: 'entry', title: 'Title' };
  const blocks = [{ i: 0, source: 'one' }, { i: 1, source: 'two' }];
  let progress = createProgress(db);
  await assert.rejects(progress.run(config, entry, blocks, async (c, e, chunk, record) => {
    record({ pairs: [{ i: 0, target: '一' }] });
    throw new Error('connection interrupted');
  }), /interrupted/);
  progress.close();
  progress = createProgress(db);
  try {
    const result = await progress.run(config, entry, blocks, async (c, e, chunk) => {
      assert.deepEqual(chunk.map(b => b.i), [1]);
      return { pairs: [{ i: 1, target: '二' }] };
    });
    assert.deepEqual(result.pairs.map(p => p.target), ['一', '二']);
    await progress.run(config, entry, blocks, async (c, e, chunk) => {
      assert.equal(chunk.length, 2);
      return { pairs: chunk.map(b => ({ i: b.i, target: '重译' })) };
    }, true);
  } finally { progress.close(); }
});

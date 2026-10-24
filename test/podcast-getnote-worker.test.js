const test = require('node:test');
const assert = require('node:assert/strict');
const { candidates } = require('../scripts/podcast-getnote-worker');

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-10-24T12:00:00Z');
const entry = (id, daysAgo) => ({ id, link: `https://www.xiaoyuzhoufm.com/episode/${id}`, title: id, publishedTs: now - daysAgo * DAY });
const eid = n => String(n).padStart(24, 'a');

test('a fresh episode from a well-archived show goes ahead of older backlog from a sparse show', () => {
  // zhangxiaojun already has many archived notes; mianji has none, so the old rule would always pick mianji first
  const state = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [eid(`9${i}`), { sourceId: 'zhangxiaojun', noteId: `n${i}`, status: 'complete' }]));
  const cache = {
    zhangxiaojun: { entries: [entry(eid(1), 0.5)] },
    mianji: { entries: [entry(eid(2), 20), entry(eid(3), 40)] },
  };
  assert.deepEqual(candidates(cache, state, now).map(item => item.episodeId), [eid(1), eid(2), eid(3)]);
});

test('older backlog keeps the per-show balancing when nothing is fresh', () => {
  const state = { [eid(90)]: { sourceId: 'zhangxiaojun', noteId: 'n', status: 'complete' } };
  const cache = {
    zhangxiaojun: { entries: [entry(eid(1), 10)] },
    mianji: { entries: [entry(eid(2), 30)] },
  };
  assert.deepEqual(candidates(cache, state, now).map(item => item.episodeId), [eid(2), eid(1)]);
});

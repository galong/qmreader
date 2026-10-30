const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ranking = require('../public/ranking');
const NOW = 1793318400000;
const HOUR = 36e5;

function entry(heat = {}, overrides = {}) {
  return { id: 'test', publishedTs: NOW, stats: { viewCount: 0, heat: { calculatedAt: NOW, ...heat } }, ...overrides };
}

test('bookmarks outweigh likes and even unbounded anonymous page views', () => {
  const score = value => ranking.breakdown(value, NOW).score;
  assert.ok(score(entry({ favorites: 1 })) > score(entry({ likes: 1 })));
  assert.ok(score(entry({ likes: 1 })) > score(entry({}, { stats: { viewCount: Number.MAX_VALUE } })));
});

test('recent interest can resurface old articles, and event heat decays by half life', () => {
  const old = entry({ favorites: 2 }, { publishedTs: NOW - 90 * 24 * HOUR });
  assert.ok(ranking.compare(old, entry(), NOW) < 0);
  const before = ranking.breakdown(entry({ favorites: 1 }), NOW);
  const after = ranking.breakdown(entry({ favorites: 1 }), NOW + 72 * HOUR);
  assert.ok(Math.abs(after.signals.favorites - 6 * Math.log1p(0.5)) < 1e-10);
  assert.ok(after.score < before.score);
});

test('feed refresh and old lifetime totals cannot reset heat; content updates are bounded', () => {
  const stale = entry({}, { publishedTs: NOW - 60 * 24 * HOUR, updatedAt: NOW,
    stats: { favoriteCount: 1000000, likeCount: 1000000, heat: { calculatedAt: NOW } }, assets: { latestAt: NOW } });
  assert.ok(ranking.breakdown(stale, NOW).score < ranking.breakdown(entry(), NOW).score);
  const updated = entry({ contentUpdatedAt: NOW });
  assert.equal(ranking.breakdown(updated, NOW).signals.updates, 0.5);
  assert.equal(ranking.breakdown(updated, NOW + 36 * HOUR).signals.updates, 0.25);
  assert.equal(ranking.breakdown(entry({ dislikes: 1 }), NOW).score, 0);
  assert.equal(ranking.breakdown(entry({ favorites: 'NaN', readers: Infinity }), NOW).score, 0.25);
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-popularity-'));
process.env.QMREADER_DATA_DIR = dir;
const store = require('../lib/store');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('database ranks before limiting; unique readers, unstar and repeated reactions remain truthful', () => {
  const realNow = Date.now;
  let time = NOW;
  Date.now = () => time;
  try {
    const user = store.createUser({ email: 'rank@example.com', password: 'password-test-123', displayName: 'Rank' });
    const rows = Array.from({ length: 501 }, (_, i) => ({ id: `rank-${i}`, sourceId: 'simonwillison',
      title: `Article ${i}`, link: `https://example.com/${i}`, publishedTs: NOW - i * HOUR,
      published: new Date(NOW - i * HOUR).toISOString(), summary: '', content: '<p>Body</p>' }));
    store.upsertEntries(rows);
    const id = 'rank-500';
    store.setUserEntryState(user.id, id, { starred: true, viewed: true });
    store.setUserEntryState(user.id, id, { viewed: true });
    store.setEntryReaction(id, user.id, 'like');
    let stats = store.getEntryStats([id], null, { includeHeat: true })[id];
    assert.equal(stats.heat.readers, 1);
    assert.equal(stats.heat.favorites, 1);
    assert.equal(store.getHotEntries({ sourceIds: ['simonwillison'], limit: 1 })[0].id, id);
    time += 72 * HOUR;
    store.setEntryReaction(id, user.id, 'like');
    stats = store.getEntryStats([id], null, { includeHeat: true })[id];
    assert.ok(Math.abs(stats.heat.likes - 0.5) < 1e-9, 'an idempotent like must not renew its timestamp');
    assert.ok(Math.abs(stats.heat.favorites - 0.5) < 1e-9);
    store.setUserEntryState(user.id, id, { starred: false });
    assert.equal(store.getEntryStats([id], null, { includeHeat: true })[id].heat.favorites, 0);
    assert.equal(store.getHotEntries({ sourceIds: ['nonexistent'], limit: 1 }).length, 0);
  } finally { Date.now = realNow; }
});

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { SOURCES } = require('../lib/sources');

test('source registry IDs are unique', () => {
  const ids = SOURCES.map(source => source.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('requested fintech feeds are enabled news sources', () => {
  const expectedFeeds = {
    'fintechnews-america': 'https://fintechnews.am/feed/',
    'fintechnews-africa': 'https://fintechnews.africa/feed/',
    'flagship-advisory': 'https://flagshipadvisorypartners.com/feed/',
    pymnts: 'https://www.pymnts.com/feed/',
  };

  for (const [id, feedUrl] of Object.entries(expectedFeeds)) {
    const source = SOURCES.find(candidate => candidate.id === id);
    assert.ok(source, `missing source: ${id}`);
    assert.equal(source.category, 'news');
    assert.equal(source.enabled, true);
    assert.equal(source.autoRewriteEnabled, true);
    assert.deepEqual(source.feeds, [feedUrl]);
  }

  const unexpectedDefaults = SOURCES
    .filter(source => source.autoRewriteEnabled && !Object.hasOwn(expectedFeeds, source.id))
    .map(source => source.id);
  assert.deepEqual(unexpectedDefaults, []);
});

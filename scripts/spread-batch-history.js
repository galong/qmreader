#!/usr/bin/env node
'use strict';
// One-off: spread daily batches already stored before ingest-time spreading.
// Dry-run by default; add --apply to write. Usage: --days=7
const store = require('../lib/store');
const fetcher = require('../lib/fetcher');

const SOURCE_IDS = ['producthunt', 'huggingface', 'github_trending'];

function plan({ days = 7, now = Date.now() } = {}) {
  const since = now - days * 24 * 60 * 60 * 1000;
  const changes = [];
  for (const sourceId of SOURCE_IDS) {
    const entries = store.getEntriesBySource(sourceId, { limit: 500 }).entries.filter(entry => entry.publishedTs >= since);
    for (const entry of fetcher.spreadBatchTimestamps({ id: sourceId }, entries)) {
      const before = entries.find(item => item.id === entry.id);
      if (before && before.publishedTs !== entry.publishedTs) changes.push({ id: entry.id, sourceId, from: before.publishedTs, to: entry.publishedTs });
    }
  }
  return changes;
}

if (require.main === module) {
  const days = Number((process.argv.find(arg => arg.startsWith('--days=')) || '--days=7').slice(7)) || 7;
  const changes = plan({ days });
  const apply = process.argv.includes('--apply');
  if (apply) for (const change of changes) store.setEntryPublishedTs(change.id, change.to);
  console.log(JSON.stringify({ apply, days, changed: changes.length,
    bySource: changes.reduce((acc, c) => ({ ...acc, [c.sourceId]: (acc[c.sourceId] || 0) + 1 }), {}) }));
}
module.exports = { plan };

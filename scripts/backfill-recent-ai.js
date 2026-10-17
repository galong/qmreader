#!/usr/bin/env node
'use strict';
// Explicit window, missing-only writes, bounded by the shared site spend guard.
const fetcher = require('../lib/fetcher');
const store = require('../lib/store');
const deepseek = require('../lib/deepseek');
const jobs = require('../lib/background-jobs');

function candidates({ since, until }) {
  fetcher.loadDisk({ upsert: false });
  const sourceIds = fetcher.getSourcesMeta().filter(s => s.enabled && s.autoRewrite !== false).map(s => s.id);
  return store.getRecentAiEntries({ since, until, sourceIds });
}

async function backfill(entries, { execute = false, emit = value => console.log(JSON.stringify(value)) } = {}) {
  const plan = entries.map(entry => ({ entryId: entry.id, sourceId: entry.sourceId, title: entry.title,
    titleMissing: !entry.titleZh && deepseek.needsEntryTitleTranslation(entry),
    rewriteMissing: !store.getRewrite(entry.id)?.body }));
  emit({ type: 'plan', entries: plan.length, missingTitles: plan.filter(x => x.titleMissing).length,
    missingRewrites: plan.filter(x => x.rewriteMissing).length, items: plan });
  if (!execute) return;
  let titles = 0; let rewrites = 0; const failed = []; const skipped = [];
  const pendingTitles = entries.filter((_, i) => plan[i].titleMissing);
  for (let i = 0; i < pendingTitles.length; i += 20) {
    try {
      const result = await deepseek.translateTitleBatch(pendingTitles.slice(i, i + 20), { author: 'system' });
      titles += result.translations.length;
      emit({ type: 'titles', count: result.translations.length });
    } catch (error) {
      emit({ type: 'title-error', code: error.code || '', error: error.message });
      if (error.code === 'AI_DAILY_BUDGET') throw error;
    }
  }
  for (const entry of entries) {
    const source = fetcher.getSourceById(entry.sourceId);
    if (!source || !fetcher.isEnabled(source) || source.autoRewrite === false || !store.getEntry(entry.id)) continue;
    if (store.getRewrite(entry.id)?.body) continue;
    emit({ type: 'start', entryId: entry.id, title: entry.title });
    const result = await jobs.autoRewriteEntries([store.getEntry(entry.id)], { onlyMissing: true });
    rewrites += result.rewritten;
    failed.push(...result.failed);
    if (Array.isArray(result.skipped)) skipped.push(...result.skipped);
    emit({ type: 'result', entryId: entry.id, ...result });
    if (result.failed.some(x => x.code === 'AI_DAILY_BUDGET')) break;
  }
  const remaining = entries.filter(e => store.getEntry(e.id) && !store.getRewrite(e.id)?.body).map(e => e.id);
  const missingTitles = entries.filter(e => {
    const latest = store.getEntry(e.id);
    return latest && !latest.titleZh && deepseek.needsEntryTitleTranslation(latest);
  }).map(e => e.id);
  const result = { type: 'complete', titles, rewrites, remaining, missingTitles, failed, skipped };
  emit(result);
  return result;
}

async function main() {
  const arg = key => process.argv.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3);
  const since = Date.parse(arg('from') || '');
  const until = Date.parse(arg('until') || '');
  if (!Number.isSafeInteger(since) || !Number.isSafeInteger(until) || since >= until) {
    throw new Error('Use explicit --from=ISO-date-with-timezone --until=ISO-date-with-timezone; add --execute to write');
  }
  let entries = candidates({ since, until });
  const selected = new Set((arg('ids') || '').split(',').filter(Boolean));
  if (selected.size) entries = entries.filter(e => selected.has(e.id));
  const priorities = (arg('priority') || '').split(',').filter(Boolean);
  entries.sort((a, b) => (priorities.includes(a.id) ? priorities.indexOf(a.id) : priorities.length) -
    (priorities.includes(b.id) ? priorities.indexOf(b.id) : priorities.length));
  const result = await backfill(entries, { execute: process.argv.includes('--execute') });
  if (result?.remaining.length || result?.missingTitles.length) process.exitCode = 2;
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { candidates, backfill };

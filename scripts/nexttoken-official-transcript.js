#!/usr/bin/env node
// Next Token｜词元之外: use the show's official transcript (nexttoken.tv/weekly/NNN/transcript.md)
// instead of a GetNote transcription. Writes the same private note file the rewrite worker reads.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SOURCE_ID = 'nexttoken';
const DATA_DIR = process.env.QMREADER_DATA_DIR || path.join(__dirname, '..', 'data');
const NOTES_DIR = process.env.QMREADER_PODCAST_NOTES_DIR || '/var/lib/qmreader-podcast-notes';
const BACKFILL_PATH = path.join(NOTES_DIR, 'backfill-20260921.json');
const OFFICIAL_ORIGIN = 'https://nexttoken.tv';
const MAX_BYTES = 2 * 1024 * 1024;
const MIN_TRANSCRIPT_CHARS = 1000;
const TRANSCRIPT_SOURCE = 'nexttoken.tv';

function episodeUrl(value) {
  try {
    const url = new URL(value);
    if (url.hostname !== 'www.xiaoyuzhoufm.com' || !/^\/episode\/[a-f0-9]{24}$/.test(url.pathname)) return '';
    return `https://www.xiaoyuzhoufm.com${url.pathname}`;
  } catch { return ''; }
}

function weeklyNumber(title) {
  const match = /#\s*0*(\d{1,3})\b/.exec(String(title || ''));
  return match ? String(Number(match[1])).padStart(3, '0') : '';
}

function officialTranscriptUrl(number) {
  return `${OFFICIAL_ORIGIN}/weekly/${number}/transcript.md`;
}

function cleanTranscript(markdown) {
  return String(markdown || '')
    .replace(/^﻿/, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(line => !/^\[阅读网页版\]\(/.test(line) && !/^>\s*正文保留节目字幕原文/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function transcriptHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function writePrivateJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function episodes() {
  const cache = readJson(path.join(DATA_DIR, 'cache.json'), {});
  const backfill = readJson(BACKFILL_PATH, {});
  const seen = new Set();
  const list = [];
  for (const entry of [...(cache[SOURCE_ID]?.entries || []), ...(backfill[SOURCE_ID]?.entries || [])]) {
    const url = episodeUrl(entry.link);
    const number = weeklyNumber(entry.title);
    if (!url || !number || seen.has(url)) continue;
    seen.add(url);
    list.push({ entryId: entry.id, title: entry.title, url, episodeId: url.split('/').pop(), number,
      publishedTs: Number(entry.publishedTs) || 0 });
  }
  return list.sort((a, b) => b.publishedTs - a.publishedTs);
}

async function fetchOfficial(number) {
  const url = officialTranscriptUrl(number);
  const res = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`官网转写请求失败 ${res.status}`);
  const text = await res.text();
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('官网转写过大');
  return { url, text: cleanTranscript(text) };
}

async function syncEpisode(item) {
  const file = path.join(NOTES_DIR, `${item.episodeId}.json`);
  const existing = readJson(file, null);
  const official = await fetchOfficial(item.number);
  if (!official) return { status: 'not-published', number: item.number };
  if (official.text.length < MIN_TRANSCRIPT_CHARS) throw new Error(`官网转写过短 (${official.text.length})`);
  const hash = transcriptHash(official.text);
  if (existing && existing.transcriptSource === TRANSCRIPT_SOURCE && existing.officialHash === hash) {
    return { status: 'unchanged', number: item.number };
  }
  // Drop any digest built from the previous transcript; the rewrite worker regenerates it.
  const { transcriptDigest, digestVersion, digestTranscriptHash, digestUpdatedAt, ...kept } = existing || {};
  writePrivateJson(file, {
    ...kept,
    episodeId: item.episodeId, sourceId: SOURCE_ID, sourceUrl: item.url, title: item.title,
    transcript: official.text, transcriptSource: TRANSCRIPT_SOURCE,
    officialUrl: official.url.replace(/\.md$/, ''), officialHash: hash,
    updatedAt: new Date().toISOString(),
  });
  return { status: existing ? 'replaced' : 'created', number: item.number, length: official.text.length };
}

async function main() {
  const results = [];
  let failed = false;
  for (const item of episodes()) {
    try { results.push(await syncEpisode(item)); }
    catch (error) {
      failed = true;
      results.push({ status: 'error', number: item.number, error: String(error.message || error).slice(0, 200) });
    }
  }
  console.log(JSON.stringify({ status: 'done', results }));
  if (failed) process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { weeklyNumber, officialTranscriptUrl, cleanTranscript, episodes, syncEpisode };

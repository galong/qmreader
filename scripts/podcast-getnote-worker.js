#!/usr/bin/env node
// Archive one new Xiaoyuzhou episode per run. systemd schedules this on the server.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// nexttoken uses the official nexttoken.tv transcript (scripts/nexttoken-official-transcript.js, server only for now).
const SOURCE_IDS = ['zhangxiaojun', '42zhangjing', 'latetalk', 'bannatie', 'crossing', 'aialchemy', '35huan', 'zhixing', 'mianji'];
const DATA_DIR = process.env.QMREADER_DATA_DIR || path.join(__dirname, '..', 'data');
const NOTES_DIR = process.env.QMREADER_PODCAST_NOTES_DIR || '/var/lib/qmreader-podcast-notes';
const CLI = process.env.GETNOTE_CLI || '/usr/bin/getnote';
const STATE_PATH = path.join(NOTES_DIR, 'state.json');
const BACKFILL_PATH = path.join(NOTES_DIR, 'backfill-20260921.json');
const PENDING_RECHECK_MS = 15 * 60 * 1000;
const MIN_SUBMIT_INTERVAL_MS = 75 * 1000;
const MAX_DAILY_SUBMISSIONS = 45;
const DAY_MS = 24 * 60 * 60 * 1000;
const FRESH_MS = 3 * DAY_MS;

function writePrivateJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function loadEpisodeCache() {
  const cache = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'cache.json'), 'utf8'));
  let backfill = {};
  try { backfill = JSON.parse(fs.readFileSync(BACKFILL_PATH, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const sourceId of SOURCE_IDS) {
    const current = cache[sourceId]?.entries || [];
    const seen = new Set(current.map(entry => episodeUrl(entry.link)).filter(Boolean));
    const older = (backfill[sourceId]?.entries || []).filter(entry => {
      const url = episodeUrl(entry.link);
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    });
    cache[sourceId] = { ...(cache[sourceId] || {}), entries: [...current, ...older] };
  }
  return cache;
}

function episodeUrl(value) {
  try {
    const url = new URL(value);
    if (url.hostname !== 'www.xiaoyuzhoufm.com' || !/^\/episode\/[a-f0-9]{24}$/.test(url.pathname)) return '';
    return `https://www.xiaoyuzhoufm.com${url.pathname}`;
  } catch { return ''; }
}

function chinaDay(timestamp) {
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function nextChinaDay(timestamp) {
  return Math.floor((timestamp + 8 * 60 * 60 * 1000) / DAY_MS) * DAY_MS + DAY_MS - 8 * 60 * 60 * 1000 + 5 * 60 * 1000;
}

function candidates(cache, state, now = Date.now()) {
  const records = Object.values(state).filter(record => record && typeof record === 'object' && record.noteId);
  const sourceCounts = Object.fromEntries(SOURCE_IDS.map(id => [id, records.filter(record => record.sourceId === id).length]));
  const submittedToday = records.filter(record => chinaDay(Date.parse(record.submittedAt || record.attemptedAt || 0)) === chinaDay(now)).length;
  const lastSubmitAt = Math.max(0, ...records.map(record => Date.parse(record.submittedAt || record.attemptedAt || 0) || 0));
  const canSubmit = submittedToday < MAX_DAILY_SUBMISSIONS && now - lastSubmitAt >= MIN_SUBMIT_INTERVAL_MS &&
    now >= Number(state._meta?.quotaResetAt || 0);
  const seen = new Set();
  return SOURCE_IDS.flatMap(sourceId => (cache[sourceId]?.entries || []).map(entry => ({
    sourceId,
    entryId: entry.id,
    episodeId: episodeUrl(entry.link).split('/').pop(),
    title: entry.title,
    url: episodeUrl(entry.link),
    publishedTs: Number(entry.publishedTs) || 0,
  })))
    .filter(item => {
      if (!/^[a-f0-9]{24}$/.test(item.episodeId || '') || !item.url) return false;
      if (seen.has(item.episodeId)) return false;
      seen.add(item.episodeId);
      const record = state[item.episodeId] || {};
      if (record.status === 'complete' || now < Number(record.retryAfter || 0)) return false;
      if (!record.noteId) return canSubmit;
      return now - (Date.parse(record.attemptedAt || 0) || 0) >= PENDING_RECHECK_MS;
    })
    .sort((a, b) => {
      const aSubmitted = Boolean(state[a.episodeId]?.noteId);
      const bSubmitted = Boolean(state[b.episodeId]?.noteId);
      if (aSubmitted !== bSubmitted) return Number(bSubmitted) - Number(aSubmitted);
      // 新期优先：精读站每天追新靠它，不能排在历史补档后面（排晚了会被迫改用付费的豆包转写）
      const aFresh = now - a.publishedTs < FRESH_MS;
      const bFresh = now - b.publishedTs < FRESH_MS;
      if (!aSubmitted && aFresh !== bFresh) return Number(bFresh) - Number(aFresh);
      if (!aSubmitted && aFresh && bFresh) return b.publishedTs - a.publishedTs;
      if (!aSubmitted && sourceCounts[a.sourceId] !== sourceCounts[b.sourceId]) return sourceCounts[a.sourceId] - sourceCounts[b.sourceId];
      return b.publishedTs - a.publishedTs;
    });
}

function runCli(args) {
  const result = spawnSync(CLI, [...args, '-o', 'json'], {
    encoding: 'utf8', timeout: 190000, maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, HOME: process.env.HOME || '/root' },
  });
  if (result.error) throw new Error(`Get笔记 CLI 失败: ${result.error.code || result.error.message}`);
  let body;
  try { body = JSON.parse(result.stdout || ''); }
  catch { throw new Error('Get笔记 CLI 未返回可解析 JSON'); }
  if (!body.success && !body.data?.note_id && !body.data?.id) {
    const reason = String(body.error?.reason || body.error?.code || 'unknown');
    const error = new Error(`Get笔记 CLI 返回失败: ${reason}`);
    error.reason = reason;
    throw error;
  }
  return body;
}

function noteIdFrom(value) {
  const data = value?.data || {};
  const id = data.note?.note_id || data.note?.id || data.note_id || data.id;
  return id ? String(id) : '';
}

function visibleNote(item, noteId, summary, transcript) {
  if (summary.length < 100) return null;
  const transcriptReady = transcript.length >= 1000 && /\[\d{2}:\d{2}/.test(transcript);
  return {
    episodeId: item.episodeId, sourceId: item.sourceId, sourceUrl: item.url,
    title: item.title, noteId, noteUrl: `https://www.biji.com/note/${noteId}`,
    summary, transcript: transcriptReady ? transcript : '', updatedAt: new Date().toISOString(),
  };
}

function processEpisode(item, state) {
  const record = state[item.episodeId] || {};
  let noteId = record.noteId;
  if (!noteId) {
    const episodeId = item.url.split('/').pop();
    const prefix = item.sourceId === '42zhangjing' ? '42' : item.sourceId;
    const saved = runCli(['save', item.url, '--tag', 'QMReader播客', '--idempotency-key', `qmreader-${prefix}-${episodeId}`]);
    noteId = noteIdFrom(saved);
    if (!noteId) throw new Error('Get笔记保存结果缺少 note_id');
    state[item.episodeId] = { ...record, sourceId: item.sourceId, url: item.url, noteId, status: 'processing', submittedAt: new Date().toISOString(), attemptedAt: new Date().toISOString() };
    writePrivateJson(STATE_PATH, state);
  }
  const detail = runCli(['note', noteId]);
  const note = detail.data?.note || {};
  const summary = String(note.content || '').trim();
  const transcript = String(note.web_page?.content || '').trim();
  const visible = visibleNote(item, noteId, summary, transcript);
  if (visible) writePrivateJson(path.join(NOTES_DIR, `${item.episodeId}.json`), visible);
  if (!visible?.transcript) {
    state[item.episodeId] = { ...state[item.episodeId], status: 'processing', attemptedAt: new Date().toISOString() };
    writePrivateJson(STATE_PATH, state);
    return { status: 'processing', entryId: item.entryId, noteId, summaryLength: summary.length, transcriptLength: transcript.length };
  }
  state[item.episodeId] = { ...state[item.episodeId], status: 'complete', completedAt: new Date().toISOString() };
  writePrivateJson(STATE_PATH, state);
  return { status: 'complete', entryId: item.entryId, noteId, summaryLength: summary.length, transcriptLength: transcript.length };
}

function main() {
  const cache = loadEpisodeCache();
  const state = loadState();
  const item = candidates(cache, state)[0];
  if (!item) return console.log(JSON.stringify({ status: 'idle' }));
  try { console.log(JSON.stringify(processEpisode(item, state))); }
  catch (error) {
    const now = Date.now();
    const quotaLimited = ['quota_day', 'quota_month'].includes(error.reason);
    const retryAfter = quotaLimited ? nextChinaDay(now) : now + 30 * 60 * 1000;
    if (quotaLimited) state._meta = { ...(state._meta || {}), quotaResetAt: retryAfter };
    state[item.episodeId] = { ...(state[item.episodeId] || {}), status: 'error', attemptedAt: new Date(now).toISOString(), retryAfter, error: String(error.message || error).slice(0, 200) };
    writePrivateJson(STATE_PATH, state);
    console.error(JSON.stringify({ status: 'error', entryId: item.entryId, error: state[item.episodeId].error }));
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { candidates, chinaDay, nextChinaDay, episodeUrl, noteIdFrom, loadEpisodeCache, visibleNote };

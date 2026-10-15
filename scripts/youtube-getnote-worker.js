#!/usr/bin/env node
// Process one YouTube podcast note per run on the Reader server.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { SOURCE_IDS, videoIdFromUrl } = require('../lib/youtube-notes');

const DATA_DIR = process.env.QMREADER_DATA_DIR || path.join(__dirname, '..', 'data');
const NOTES_DIR = process.env.QMREADER_YOUTUBE_NOTES_DIR || '/var/lib/qmreader-youtube-notes';
const PODCAST_NOTES_DIR = process.env.QMREADER_PODCAST_NOTES_DIR || '/var/lib/qmreader-podcast-notes';
const CLI = process.env.GETNOTE_CLI || '/usr/bin/getnote';
const STATE_FILE = path.join(NOTES_DIR, 'getnote-state.json');
const MIN_SUBMIT_INTERVAL_MS = 75 * 1000;
const RECHECK_MS = 20 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_NOTES = {
  JtomF4bGxHs: '1921997063949813072',
  J3SIbt2s28Y: '1921997212125660496',
};

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

function writePrivateJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}

function sourceEntries(cache) {
  return [...SOURCE_IDS].flatMap(sourceId => (cache[sourceId]?.entries || [])
    .map(entry => ({ sourceId, title: entry.title, url: entry.link,
      videoId: videoIdFromUrl(entry.link), publishedTs: Number(entry.publishedTs) || 0 }))
    .filter(item => item.videoId));
}

function bootstrapState(entries, state) {
  state.videos ||= {};
  state.seededSources ||= {};
  for (const [videoId, noteId] of Object.entries(TRIAL_NOTES)) {
    const item = entries.find(entry => entry.videoId === videoId);
    if (item && !state.videos[videoId]?.noteId) state.videos[videoId] = {
      sourceId: item.sourceId, noteId, status: 'processing', attemptedAt: '', submittedAt: new Date().toISOString(),
    };
  }
  for (const sourceId of SOURCE_IDS) {
    if (state.seededSources[sourceId]) continue;
    const existing = entries.filter(item => item.sourceId === sourceId).sort((a, b) => b.publishedTs - a.publishedTs);
    for (const item of existing.slice(1)) state.videos[item.videoId] ||= { sourceId, status: 'skipped_initial' };
    if (existing.length) state.seededSources[sourceId] = new Date().toISOString();
  }
  return state;
}

function lastSubmittedAt(state, podcastState = {}) {
  const records = [...Object.values(state.videos || {}), ...Object.values(podcastState || {})];
  return Math.max(0, ...records.map(record => Date.parse(record?.submittedAt || 0) || 0));
}

function chinaDay(timestamp) {
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function nextChinaDay(timestamp) {
  return Math.floor((timestamp + 8 * 60 * 60 * 1000) / DAY_MS) * DAY_MS + DAY_MS - 8 * 60 * 60 * 1000 + 5 * 60 * 1000;
}

function candidates(entries, state, now = Date.now(), podcastState = {}) {
  const records = [...Object.values(state.videos || {}), ...Object.values(podcastState || {})];
  const submittedToday = records.filter(record => record?.noteId &&
    chinaDay(Date.parse(record.submittedAt || 0) || 0) === chinaDay(now)).length;
  const canSubmit = now - lastSubmittedAt(state, podcastState) >= MIN_SUBMIT_INTERVAL_MS &&
    submittedToday < 45 && now >= Number(podcastState._meta?.quotaResetAt || 0) &&
    now >= Number(state._meta?.quotaResetAt || 0);
  return entries.filter(item => {
    const record = state.videos?.[item.videoId];
    if (record?.status === 'complete' || record?.status === 'skipped_initial') return false;
    if (now < Number(record?.retryAfter || 0)) return false;
    if (record?.noteId) return now - (Date.parse(record.attemptedAt || 0) || 0) >= RECHECK_MS;
    return canSubmit;
  }).sort((a, b) => b.publishedTs - a.publishedTs);
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
  if (!body.success) {
    const reason = String(body.error?.reason || body.error?.code || 'unknown');
    const error = new Error(`Get笔记 CLI 返回失败: ${reason}`);
    error.reason = reason;
    throw error;
  }
  return body;
}

function processVideo(item, state) {
  const record = state.videos[item.videoId] || {};
  let noteId = record.noteId;
  if (!noteId) {
    const saved = runCli(['save', item.url, '--tag', 'QMReader视频',
      '--idempotency-key', `qmreader-youtube-${item.videoId}`]);
    noteId = saved.data?.note?.note_id || saved.data?.note_id || saved.data?.id;
    if (!noteId) throw new Error('Get笔记保存结果缺少 note_id');
    noteId = String(noteId);
    state.videos[item.videoId] = { sourceId: item.sourceId, noteId,
      status: 'processing', submittedAt: new Date().toISOString(), attemptedAt: '' };
    writePrivateJson(STATE_FILE, state);
  }
  const detail = runCli(['note', String(noteId)]);
  const note = detail.data?.note || {};
  const summary = String(note.content || '').trim();
  const transcript = String(note.web_page?.content || '').trim();
  const transcriptReady = transcript.length >= 1000 && /\[\d{2}:\d{2}\s*-\s*\d{2}:\d{2}/.test(transcript);
  if (summary || transcriptReady) writePrivateJson(path.join(NOTES_DIR, `${item.videoId}.json`), {
    videoId: item.videoId, sourceId: item.sourceId, sourceUrl: item.url,
    title: item.title, status: transcriptReady ? 'transcript' : 'processing', noteId,
    noteUrl: `https://www.biji.com/note/${noteId}`, summary,
    transcript: transcriptReady ? transcript : '', updatedAt: new Date().toISOString(),
  });
  const status = transcriptReady && summary.length >= 100 ? 'complete' : 'processing';
  state.videos[item.videoId] = { ...state.videos[item.videoId], sourceId: item.sourceId,
    status, attemptedAt: new Date().toISOString() };
  writePrivateJson(STATE_FILE, state);
  return { sourceId: item.sourceId, videoId: item.videoId, status,
    summaryLength: summary.length, transcriptLength: transcriptReady ? transcript.length : 0 };
}

function main() {
  const cache = readJson(path.join(DATA_DIR, 'cache.json'));
  const state = bootstrapState(sourceEntries(cache), readJson(STATE_FILE));
  writePrivateJson(STATE_FILE, state);
  const podcastState = readJson(path.join(PODCAST_NOTES_DIR, 'state.json'));
  const item = candidates(sourceEntries(cache), state, Date.now(), podcastState)[0];
  if (!item) return console.log(JSON.stringify({ status: 'idle' }));
  try { console.log(JSON.stringify(processVideo(item, state))); }
  catch (error) {
    const record = state.videos[item.videoId] || {};
    const quotaLimited = ['quota_day', 'quota_month'].includes(error.reason);
    const retryAfter = quotaLimited ? nextChinaDay(Date.now()) : Date.now() + 60 * 60 * 1000;
    if (quotaLimited) state._meta = { ...(state._meta || {}), quotaResetAt: retryAfter };
    state.videos[item.videoId] = { ...record, sourceId: item.sourceId, status: 'error',
      attemptedAt: new Date().toISOString(), retryAfter,
      error: String(error.message || error).slice(0, 200) };
    writePrivateJson(STATE_FILE, state);
    console.error(JSON.stringify({ sourceId: item.sourceId, videoId: item.videoId,
      status: 'error', error: state.videos[item.videoId].error }));
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { sourceEntries, bootstrapState, candidates, processVideo };

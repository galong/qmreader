#!/usr/bin/env node
// Process at most one recent YouTube video per run. Never download media.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { SOURCE_IDS, videoIdFromUrl } = require('../lib/youtube-notes');

const DATA_DIR = process.env.QMREADER_DATA_DIR || path.join(__dirname, '..', 'data');
const NOTES_DIR = process.env.QMREADER_YOUTUBE_NOTES_DIR || '/var/lib/qmreader-youtube-notes';
const YT_DLP = process.env.QMREADER_YT_DLP || '/opt/qiaomu-apps/qmreader/.venv-ytdlp/bin/yt-dlp';
const STATE_FILE = path.join(NOTES_DIR, 'state.json');
const RETRY_MS = 24 * 60 * 60 * 1000;

function writePrivateJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

function sourceEntries(cache) {
  return [...SOURCE_IDS].flatMap(sourceId => (cache[sourceId]?.entries || [])
    .map(entry => ({ sourceId, title: entry.title, url: entry.link, videoId: videoIdFromUrl(entry.link), publishedTs: Number(entry.publishedTs) || 0 }))
    .filter(item => item.videoId));
}

function bootstrapState(entries, state) {
  state.videos ||= {};
  state.seededSources ||= {};
  for (const sourceId of SOURCE_IDS) {
    if (state.seededSources[sourceId]) continue;
    const existing = entries.filter(item => item.sourceId === sourceId).sort((a, b) => b.publishedTs - a.publishedTs);
    if (!existing.length) continue;
    for (const item of existing.slice(1)) state.videos[item.videoId] ||= { sourceId, status: 'skipped_initial' };
    state.seededSources[sourceId] = new Date().toISOString();
  }
  return state;
}

function candidates(entries, state, now = Date.now()) {
  return entries.filter(item => {
    const record = state.videos?.[item.videoId];
    if (!record) return true;
    return ['none', 'error'].includes(record.status) && Number(record.attempts || 0) < 3 && Number(record.nextRetryAt || 0) <= now;
  }).sort((a, b) => b.publishedTs - a.publishedTs);
}

function selectCaption(metadata) {
  const groups = [
    ['manual', metadata.subtitles || {}, /^en(?:-[\w]+)?$/i],
    ['automatic', metadata.automatic_captions || {}, /^en(?:-[\w]+)?$/i],
    ['manual', metadata.subtitles || {}, /^zh(?:-[\w]+)?$/i],
    ['automatic', metadata.automatic_captions || {}, /^zh(?:-[\w]+)?$/i],
  ];
  for (const [kind, tracks, pattern] of groups) {
    const language = Object.keys(tracks).find(key => pattern.test(key) && Array.isArray(tracks[key]) && tracks[key].length);
    if (language) return { language, kind };
  }
  return null;
}

function srtToText(value) {
  const blocks = String(value || '').replace(/\r/g, '').split(/\n\s*\n/);
  const lines = [];
  for (const block of blocks) {
    const text = block.split('\n')
      .filter(line => !/^\d+$/.test(line.trim()) && !/^\d{2}:\d{2}:\d{2}[,.]\d+\s*-->/.test(line.trim()))
      .map(line => line.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim())
      .filter(Boolean).join(' ');
    if (text && text !== lines.at(-1)) lines.push(text);
  }
  return lines.join('\n');
}

function runYtDlp(args) {
  const result = spawnSync(YT_DLP, ['--no-playlist', '--no-warnings', ...args], {
    encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`yt-dlp ${result.error?.code || result.status}: ${String(result.stderr || '').slice(-300)}`);
  }
  return result.stdout;
}

function getCaptions(item) {
  const metadata = JSON.parse(runYtDlp(['--dump-single-json', '--skip-download', item.url]));
  if (metadata.id !== item.videoId) throw new Error('yt-dlp 返回的视频 ID 不匹配');
  const selected = selectCaption(metadata);
  if (!selected) return { status: 'none' };
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-youtube-caption-'));
  try {
    runYtDlp(['--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', selected.language,
      '--sub-format', 'vtt/best', '--convert-subs', 'srt', '--paths', temp, '-o', '%(id)s.%(ext)s', item.url]);
    const file = fs.readdirSync(temp).find(name => name.startsWith(`${item.videoId}.`) && name.endsWith('.srt'));
    if (!file) throw new Error('字幕轨存在，但 yt-dlp 未输出 SRT');
    const text = srtToText(fs.readFileSync(path.join(temp, file), 'utf8'));
    if (text.length < 80 || text.length > 1_000_000) throw new Error('字幕文字长度不符合验收范围');
    return { status: 'caption', language: selected.language, kind: selected.kind, text };
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

function main() {
  const cache = loadJson(path.join(DATA_DIR, 'cache.json'), {});
  const state = bootstrapState(sourceEntries(cache), loadJson(STATE_FILE, {}));
  writePrivateJson(STATE_FILE, state);
  const item = candidates(sourceEntries(cache), state)[0];
  if (!item) return console.log(JSON.stringify({ status: 'idle' }));
  const previous = state.videos[item.videoId] || {};
  const attempts = Number(previous.attempts || 0) + 1;
  try {
    const result = getCaptions(item);
    writePrivateJson(path.join(NOTES_DIR, `${item.videoId}.json`), {
      videoId: item.videoId, sourceId: item.sourceId, sourceUrl: item.url, title: item.title,
      ...result, updatedAt: new Date().toISOString(),
    });
    state.videos[item.videoId] = {
      sourceId: item.sourceId, status: result.status, attempts,
      nextRetryAt: result.status === 'none' ? Date.now() + RETRY_MS : 0,
    };
    writePrivateJson(STATE_FILE, state);
    console.log(JSON.stringify({ sourceId: item.sourceId, videoId: item.videoId, status: result.status, captionLength: result.text?.length || 0 }));
  } catch (error) {
    state.videos[item.videoId] = { sourceId: item.sourceId, status: 'error', attempts, nextRetryAt: Date.now() + 60 * 60 * 1000,
      error: String(error.message || error).slice(0, 250) };
    writePrivateJson(STATE_FILE, state);
    console.error(JSON.stringify({ sourceId: item.sourceId, videoId: item.videoId, status: 'error', error: state.videos[item.videoId].error }));
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { sourceEntries, bootstrapState, candidates, selectCaption, srtToText };

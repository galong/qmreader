#!/usr/bin/env node
// Rewrite one ready podcast episode from a digest covering its full transcript.
const fs = require('node:fs');
const path = require('node:path');
const fetcher = require('../lib/fetcher');
const deepseek = require('../lib/deepseek');
const store = require('../lib/store');
const podcastTranscript = require('../lib/podcast-transcript');

const SOURCE_IDS = ['zhangxiaojun', '42zhangjing', 'latetalk', 'bannatie', 'nexttoken'];
const NOTES_DIR = process.env.QMREADER_PODCAST_NOTES_DIR || '/var/lib/qmreader-podcast-notes';

function writePrivateNote(episodeId, note) {
  const file = path.join(NOTES_DIR, `${episodeId}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(note, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function rewriteCandidates() {
  const entries = SOURCE_IDS.flatMap(sourceId => fetcher.getEntries({ sourceId, limit: 10 }));
  return entries.filter(entry => {
    const note = podcastTranscript.loadTranscriptNote(entry);
    if (!note) return false;
    const rewrite = store.getRewrite(entry.id);
    return !rewrite || rewrite.contentHash !== deepseek.rewriteContentHash(entry);
  }).sort((a, b) => Number(b.publishedTs || 0) - Number(a.publishedTs || 0));
}

async function processEntry(entry) {
  const episodeId = podcastTranscript.episodeIdFromLink(entry.link);
  const note = podcastTranscript.loadTranscriptNote(entry);
  if (!note || !episodeId) throw new Error('播客逐字稿不存在');
  if (!podcastTranscript.loadReadyTranscript(entry)) {
    const digest = await deepseek.condensePodcastTranscript(note.transcript, { title: entry.title });
    writePrivateNote(episodeId, {
      ...note,
      transcriptDigest: digest,
      digestVersion: podcastTranscript.DIGEST_VERSION,
      digestTranscriptHash: podcastTranscript.transcriptHash(note.transcript),
      digestUpdatedAt: new Date().toISOString(),
    });
  }
  const result = await deepseek.rewriteEntry(entry, {
    provider: 'deepseek', model: 'deepseek-v4-flash', author: '向阳乔木',
    temperature: 0.5, maxTokens: 9000,
  });
  return { status: result.cached ? 'cached' : 'rewritten', sourceId: entry.sourceId, entryId: entry.id, episodeId,
    transcriptLength: note.transcript.length, digestLength: podcastTranscript.loadReadyTranscript(entry)?.transcriptDigest.length || 0,
    rewriteLength: result.rewrite.body.length };
}

async function main() {
  const entry = rewriteCandidates()[0];
  if (!entry) return console.log(JSON.stringify({ status: 'idle' }));
  try { console.log(JSON.stringify(await processEntry(entry))); }
  catch (error) {
    console.error(JSON.stringify({ status: 'error', entryId: entry.id, error: String(error.message || error).slice(0, 250) }));
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { rewriteCandidates, processEntry };

const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');

const OPML_URL = 'https://raw.githubusercontent.com/ginobefun/BestBlogs/main/opml/bestblogs_wechat2rss_opml_all.opml';
const FEED_ORIGIN = 'https://wechat2rss.bestblogs.dev';
const CACHE_FILE = path.join(process.env.QMREADER_DATA_DIR || path.join(__dirname, '..', 'data'), 'bestblogs-wechat-catalog.json');
const CACHE_MS = 6 * 60 * 60 * 1000;
const HASH = /^[a-f0-9]{40}$/;
const SUPPLEMENTAL_ACCOUNTS = [
  { id: '6ef6642246e0614f6db52b06b5443f2c782d4ab2', name: 'elsewhere别处发生' },
  { id: '1246d10fc107e600ae8897ec3dcb9be31cda79d7', name: '葬AI' },
].map(item => ({ ...item, feedUrl: feedUrl(item.id) }));
let cached = null;
let cachedAt = 0;
let inflight = null;

function feedUrl(id) {
  return HASH.test(String(id || '')) ? `${FEED_ORIGIN}/feed/${id}.xml` : '';
}

function withSupplementalAccounts(records) {
  const seen = new Set(records.map(item => item.id));
  return [...records, ...SUPPLEMENTAL_ACCOUNTS.filter(item => !seen.has(item.id))];
}

function parseOpml(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  if (!$('opml body').length) throw new Error('BestBlogs OPML 格式无效');
  const seen = new Set();
  const records = [];
  $('opml body outline').each((_, element) => {
    const name = String($(element).attr('title') || $(element).attr('text') || '').trim();
    const url = String($(element).attr('xmlUrl') || '');
    const match = /^https:\/\/wechat2rss\.bestblogs\.dev\/feed\/([a-f0-9]{40})\.xml$/.exec(url);
    if (!name || name.length > 150 || !match || seen.has(match[1])) return;
    seen.add(match[1]);
    records.push({ id: match[1], name, feedUrl: feedUrl(match[1]) });
  });
  if (records.length < 100) throw new Error('BestBlogs OPML 条目数量异常');
  return withSupplementalAccounts(records);
}

function readSnapshot() {
  try {
    const records = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (Array.isArray(records) && records.length >= 100 && records.every(item => feedUrl(item.id) === item.feedUrl)) return withSupplementalAccounts(records);
  } catch { /* no persisted catalog yet */ }
  return null;
}

async function catalog({ refresh = false } = {}) {
  if (!cached) cached = readSnapshot();
  if (cached && !refresh && Date.now() - cachedAt < CACHE_MS) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const response = await fetch(OPML_URL, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'QMReader/1.0' } });
      if (!response.ok) throw new Error(`BestBlogs OPML HTTP ${response.status}`);
      const xml = await response.text();
      if (xml.length > 2_000_000) throw new Error('BestBlogs OPML 过大');
      const records = parseOpml(xml);
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      const temp = `${CACHE_FILE}.${process.pid}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(records), { mode: 0o600 });
      fs.renameSync(temp, CACHE_FILE);
      cached = records;
      cachedAt = Date.now();
      return records;
    } catch (error) {
      if (cached) { cachedAt = Date.now() - CACHE_MS + 5 * 60 * 1000; return cached; }
      throw error;
    } finally { inflight = null; }
  })();
  return inflight;
}

module.exports = { OPML_URL, feedUrl, parseOpml, catalog };

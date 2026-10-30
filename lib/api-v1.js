const { createResponseCache, sendCached } = require('./response-cache');

const API_VERSION = '1';
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 30;
const POOL_SIZE = 2000;

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseSince(value) {
  if (value === undefined || value === '') return 0;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return Number(text);
  const ts = Date.parse(text);
  return Number.isFinite(ts) ? ts : 0;
}

function encodeCursor(entry) {
  return Buffer.from(`${entry.publishedTs}|${entry.id}`).toString('base64url');
}

function decodeCursor(cursor) {
  try {
    const [ts, id] = Buffer.from(String(cursor), 'base64url').toString().split('|');
    const publishedTs = Number(ts);
    if (!Number.isFinite(publishedTs) || !id) return null;
    return { publishedTs, id };
  } catch {
    return null;
  }
}

// Newest first; ties broken by id so cursor paging is stable.
function afterCursor(entry, cursor) {
  if (entry.publishedTs !== cursor.publishedTs) return entry.publishedTs < cursor.publishedTs;
  return entry.id < cursor.id;
}

function listItem(entry, publicUrl) {
  return {
    id: entry.id,
    sourceId: entry.sourceId,
    title: entry.title,
    titleZh: entry.titleZh || null,
    link: entry.link,
    url: publicUrl ? publicUrl(entry) : null,
    author: entry.author || '',
    published: entry.published,
    publishedTs: entry.publishedTs,
    summary: entry.summary || '',
    image: entry.image || null,
    assets: entry.assets || null,
    stats: entry.stats ? {
      viewCount: entry.stats.viewCount,
      favoriteCount: entry.stats.favoriteCount,
      likeCount: entry.stats.likeCount,
    } : null,
  };
}

function mount(app, { fetcher, store, createRateLimiter, clientIp, entryByIdOrPrefix, rewriteContent, translationResponse, rewriteResponse, rewriteReadingState, publicUrl, sourcesMeta, requireLogin }) {
  const listCache = createResponseCache({ ttlMs: 10000, max: 300 });
  const detailCache = createResponseCache({ ttlMs: 30000, max: 300 });
  const sourcesCache = createResponseCache({ ttlMs: 15000, max: 4 });

  const readLimit = createRateLimiter({
    windowMs: 60 * 1000,
    max: 120,
    message: '请求过于频繁，请稍后再试',
    key: req => (req.user ? `v1u:${req.user.id}` : `v1ip:${clientIp(req)}`),
  });

  app.use('/api/v1', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, If-None-Match');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'ETag, Retry-After');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.setHeader('X-QMReader-API', API_VERSION);
    if (req.method === 'OPTIONS') return res.status(204).end();
    return next();
  });
  app.use('/api/v1', readLimit);

  app.get('/api/v1/ping', (req, res) => {
    res.json({ ok: true, version: API_VERSION, serverTime: Date.now(), authenticated: Boolean(req.user) });
  });

  app.get('/api/v1/sources', (req, res) => {
    const entry = sourcesCache.get('all', () => ({ sources: sourcesMeta() }));
    sendCached(req, res, entry, { shared: !req.user, sMaxAge: 60 });
  });

  app.get('/api/v1/entries', (req, res) => {
    const limit = clampInt(req.query.limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
    const since = parseSince(req.query.since);
    const cursor = req.query.cursor ? decodeCursor(req.query.cursor) : null;
    if (req.query.cursor && !cursor) return res.status(400).json({ error: 'invalid cursor' });
    const source = String(req.query.source || '').slice(0, 80);
    const category = String(req.query.category || '').slice(0, 80);
    const q = String(req.query.q || '').trim().slice(0, 100);
    const optIn = String(req.query.optIn || '').split(',').filter(Boolean).sort().join(',');
    const key = JSON.stringify([source, category, q, optIn, since, req.query.cursor || '', limit]);

    const entry = listCache.get(key, () => {
      const pool = fetcher.getEntries({
        sourceId: source || undefined,
        category: category || undefined,
        q: q || undefined,
        limit: POOL_SIZE,
        viewer: null,
        deferAssets: true,
        allowedOptInSourceIds: new Set(optIn.split(',').filter(Boolean)),
      });
      pool.sort((a, b) => (b.publishedTs - a.publishedTs) || (a.id < b.id ? 1 : -1));
      let rows = since ? pool.filter(e => e.publishedTs > since) : pool;
      if (cursor) rows = rows.filter(e => afterCursor(e, cursor));
      const page = fetcher.withTranslations(rows.slice(0, limit), null);
      return {
        entries: page.map(e => listItem(e, publicUrl)),
        nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null,
        serverTime: Date.now(),
      };
    });
    sendCached(req, res, entry, { shared: true });
  });

  app.get('/api/v1/entries/:id', (req, res) => {
    const include = new Set(String(req.query.include || '').split(',').map(s => s.trim()).filter(Boolean));
    const compute = () => {
      const found = entryByIdOrPrefix(req.params.id, req.user);
      if (!found) return null;
      const out = { entry: rewriteContent(found) };
      if (include.has('translation')) out.translation = translationResponse(found, req.user);
      if (include.has('rewrite')) {
        out.rewrite = rewriteResponse(found, req.user);
        if (rewriteReadingState) out.readingState = { rewrite: rewriteReadingState(found, out.rewrite) };
      }
      return out;
    };
    if (req.user) {
      const out = compute();
      if (!out) return res.status(404).json({ error: 'entry not found' });
      res.setHeader('Cache-Control', 'private, no-cache');
      return res.json(out);
    }
    const key = `${req.params.id}|${[...include].sort().join(',')}`;
    const entry = detailCache.get(key, () => compute() || { error: 'entry not found', __missing: true });
    if (entry.payload && entry.payload.__missing) return res.status(404).json({ error: 'entry not found' });
    return sendCached(req, res, entry, { shared: true, sMaxAge: 30 });
  });

  app.get('/api/v1/me', requireLogin, (req, res) => {
    res.json({ user: req.user });
  });

  app.get('/api/v1/me/states', requireLogin, (req, res) => {
    res.json({ states: store.getUserEntryStates(req.user.id), serverTime: Date.now() });
  });
}

module.exports = { mount, encodeCursor, decodeCursor, afterCursor, parseSince };

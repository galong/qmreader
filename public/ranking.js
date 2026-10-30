(function (root) {
  'use strict';
  const HALF_LIFE = 72 * 36e5;
  function count(value) { return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0; }
  function decay(timestamp, now, halfLife = HALF_LIFE) {
    const at = Number(timestamp);
    return at > 0 && Number.isFinite(at) ? Math.pow(2, -Math.max(0, now - at) / halfLife) : 0;
  }
  function breakdown(entry = {}, now = Date.now()) {
    const stats = entry.stats || {};
    const heat = stats.heat || {};
    const assets = entry.assets || {};
    const publicationDecay = decay(entry.publishedTs, now);
    const heatDecay = decay(heat.calculatedAt, now);
    const recent = key => count(heat[key]) * heatDecay;
    const signals = {
      freshness: 0.25 * publicationDecay,
      favorites: 6 * Math.log1p(recent('favorites')),
      likes: 3 * Math.log1p(recent('likes')),
      // Authenticated readers have one row per account/article, regardless of reloads.
      reads: Math.min(2, 0.5 * Math.log1p(recent('readers')))
        + Math.min(0.5, 0.08 * Math.log1p(count(stats.viewCount))) * publicationDecay,
      // A public content update adds a bounded bonus; it never refreshes lifetime votes.
      updates: 0.5 * decay(heat.contentUpdatedAt, now, 36 * 36e5),
      helpful: 0, comments: 0, annotations: 0, aiAssets: 0, chat: 0,
    };
    const penalties = { dislikes: 4 * Math.log1p(recent('dislikes')), title: 0 };
    const positive = Object.values(signals).reduce((sum, value) => sum + value, 0);
    const negative = penalties.dislikes;
    return { score: Math.max(0, positive - negative), raw: positive - negative, positive, negative,
      signals, penalties, ageHours: entry.publishedTs ? Math.max(0, now - entry.publishedTs) / 36e5 : 0,
      decay: publicationDecay ? 1 / publicationDecay : Infinity };
  }
  function compare(a, b, now = Date.now()) {
    return breakdown(b, now).score - breakdown(a, now).score
      || count(b.publishedTs) - count(a.publishedTs)
      || String(a.id).localeCompare(String(b.id));
  }
  const api = { breakdown, compare, HALF_LIFE };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QMRanking = api;
})(typeof globalThis === 'object' ? globalThis : this);

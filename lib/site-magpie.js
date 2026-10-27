'use strict';

// Only operator-owned environment can enable or route the site's gateway key.
const BASE_URL = 'https://magpie.qiaomu.ai/v1';
const ARGON = 'aigocode/gemini-4-argon';
const FLASH = 'group/qmreader-deepseek-flash';

function siteMagpieConfig(options = {}, now = Date.now()) {
  if (String(options.apiKey || '').trim()) return null;
  const apiKey = String(process.env.SITE_MAGPIE_API_KEY || '').trim();
  if (!apiKey) return null;
  const deadline = String(process.env.SITE_MAGPIE_ARGON_UNTIL || '').trim();
  const until = deadline ? Date.parse(deadline) : 0;
  if (!Number.isFinite(until)) throw new Error('Invalid SITE_MAGPIE_ARGON_UNTIL');
  return {
    provider: 'openai-compatible',
    providerType: 'openai_compatible',
    providerTitle: 'Magpie',
    apiKey, configured: true, baseUrl: BASE_URL,
    model: now < until ? ARGON : require('./ai-router').chain()[0],
    usesServerMagpieKey: true,
    usesServerDeepSeekKey: false,
  };
}

module.exports = { BASE_URL, ARGON, FLASH, siteMagpieConfig };

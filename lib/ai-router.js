'use strict';
// Site-funded AI routing: ordered model chain with a per-model circuit breaker.
// Order follows Artificial Analysis intelligence + measured latency/Chinese rewrite output (2026-10-21).
const { BASE_URL } = require('./site-magpie');

const OFFICIAL = 'official:deepseek-v4-flash';
const DEFAULT_CHAIN = [
  'opencode-go/deepseek-v4.1-flash',             // 1 primary: opencode channel, AA 45
  'aigocode-team-ds/deepseek-v4.1-flash',        // 2 same model, other channel
  'deepseek/deepseek-flash',                     // 3 Magpie's official DeepSeek route (fastest)
  'siliconflow/deepseek-ai/DeepSeek-V4.1-Flash', // 4 same model, siliconflow
  'opencode-go/claude-haiku-5-5',                // 5 other vendor, AA 43
  'siliconflow/zai-org/GLM-5.2',                 // 6 other vendor, strong Chinese
  'aigocode/gemini-3.8-flash',                   // 7 other vendor, AA 41
  OFFICIAL,                                      // 8 direct api.deepseek.com with the site's own key
];
const FAIL_OPEN_MS = 5 * 60000;
const RATE_OPEN_MS = 60000;
const BAD_MODEL_OPEN_MS = 60 * 60000;
const open = new Map();

function chain() {
  const raw = String(process.env.AI_ROUTE_CHAIN || '').trim();
  const list = raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_CHAIN;
  // DeepSeek Flash-only preference: never route to a Pro model.
  return list.filter(m => !/deepseek[^/]*pro/i.test(m));
}
function models() { return chain().filter(m => m !== OFFICIAL); }
function isOpen(model, now = Date.now()) { return (open.get(model) || 0) > now; }
function trip(model, error, now = Date.now()) {
  const status = Number(error && error.upstreamStatus) || 0;
  const ms = status === 429 ? RATE_OPEN_MS : (status === 400 || status === 401 || status === 403 || status === 404) ? BAD_MODEL_OPEN_MS : FAIL_OPEN_MS;
  open.set(model, now + ms);
}
function reset() { open.clear(); }

function configsFor(base) {
  const all = chain().map(model => {
    if (model === OFFICIAL) {
      const apiKey = String(process.env.DEEPSEEK_API_KEY || '').trim();
      if (!apiKey) return null;
      return {
        provider: 'deepseek', providerType: 'openai_compatible', providerTitle: 'DeepSeek',
        apiKey, configured: true,
        baseUrl: String(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').trim(),
        model: 'deepseek-v4-flash', temperature: base.temperature, maxTokens: base.maxTokens,
        usesServerDeepSeekKey: true, usesServerMagpieKey: false, singleAttempt: true, routeModel: OFFICIAL,
      };
    }
    // Gemini ignores `thinking: disabled` and burns tokens on hidden reasoning; it needs reasoning_effort instead.
    if (/gemini/i.test(model)) return { ...base, model, baseUrl: BASE_URL, singleAttempt: true, reasoningEffort: 'none', routeModel: model };
    return { ...base, model, baseUrl: BASE_URL, singleAttempt: true, disableThinking: true, routeModel: model };
  }).filter(Boolean);
  const live = all.filter(c => !isOpen(c.routeModel));
  return live.length ? live : all; // everything tripped: try the whole chain rather than fail closed
}

module.exports = { OFFICIAL, DEFAULT_CHAIN, chain, models, isOpen, trip, reset, configsFor };

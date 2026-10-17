'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { DatabaseSync } = require('node:sqlite');
const { BASE_URL: MAGPIE_BASE_URL, ARGON, FLASH } = require('./site-magpie');

const actorContext = new AsyncLocalStorage();
const DAY = 86400000;
const FLASH_MODELS = new Set(['deepseek-v4-flash', 'deepseek-flash']);
const MAX_SITE_OUTPUT_TOKENS = 16384;
function runWithAiActor(actor, fn) { return actorContext.run(String(actor), fn); }
function denied(code, message, retryAfter = 60, statusCode = 429) {
  return Object.assign(new Error(message), { code, statusCode, retryAfter });
}
function envLimit(name, fallback) {
  if (process.env[name] === undefined) return fallback;
  const value = Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${name}`);
  return value;
}

function createAiSpendGuard({ file, now = Date.now, limits = {} }) {
  const policy = {
    dailyBudgetMicros: envLimit('AI_DAILY_BUDGET_MICROS', 5000000),
    userMinute: envLimit('AI_USER_REQUESTS_PER_MINUTE', 10),
    userDay: envLimit('AI_USER_REQUESTS_PER_DAY', 100),
    globalConcurrent: envLimit('AI_MAX_CONCURRENT', 3),
    userConcurrent: 2,
    maxInputBytes: 100000,
    maxOutputTokens: MAX_SITE_OUTPUT_TOKENS,
    ...limits,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  fs.chmodSync(file, 0o600);
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS ai_spend_reservations (
      id TEXT PRIMARY KEY, actor TEXT NOT NULL, day TEXT NOT NULL,
      started_at INTEGER NOT NULL, active_until INTEGER NOT NULL,
      reserved_micros INTEGER NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL,
      prompt_tokens INTEGER, completion_tokens INTEGER
    );
    CREATE INDEX IF NOT EXISTS ai_spend_day ON ai_spend_reservations(day);
    CREATE INDEX IF NOT EXISTS ai_spend_actor ON ai_spend_reservations(actor, started_at);
  `);

  function reserve(config, payload, timeout) {
    if (!config.usesServerDeepSeekKey && !config.usesServerMagpieKey) return null;
    const allowedModels = config.usesServerMagpieKey ? new Set([ARGON, FLASH]) : FLASH_MODELS;
    if (!allowedModels.has(config.model) || payload.model !== config.model) {
      throw denied('AI_MODEL_FORBIDDEN', '网站额度仅支持管理员配置的模型', 0, 400);
    }
    const url = new URL(config.baseUrl);
    const expectedOrigin = config.usesServerMagpieKey ? new URL(MAGPIE_BASE_URL).origin : 'https://api.deepseek.com';
    if (url.origin !== expectedOrigin || url.username || url.password || url.search || url.hash ||
        !['', '/', '/v1', '/v1/'].includes(url.pathname) || config.providerType !== 'openai_compatible') {
      throw denied('AI_ENDPOINT_FORBIDDEN', '网站额度仅支持管理员配置的接口', 0, 400);
    }
    const inputBytes = Buffer.byteLength(JSON.stringify(payload));
    if (inputBytes > policy.maxInputBytes) throw denied('AI_INPUT_LIMIT', '本次 AI 输入过长，请缩短内容', 0, 413);
    const output = payload.max_tokens;
    if (!Number.isSafeInteger(output) || output < 1 || output > policy.maxOutputTokens) {
      throw denied('AI_OUTPUT_LIMIT', '本次 AI 输出额度超出限制', 0, 400);
    }
    // Internal allowance units (historically Flash peak prices), NOT Magpie pricing.
    // Bytes overestimate text tokens;
    // 2048 covers protocol overhead. Failed/uncertain requests keep their reservation.
    // This is a site safety allowance, not a provider invoice or account-wide budget.
    const cost = (inputBytes + 2048) * 2 + output * 8;
    const timestamp = now();
    const day = new Date(timestamp + 8 * 3600000).toISOString().slice(0, 10);
    const actor = actorContext.getStore() || 'system';
    const retryDay = Math.ceil((DAY - ((timestamp + 8 * 3600000) % DAY)) / 1000);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM ai_spend_reservations WHERE started_at < ? AND active_until <= ?')
        .run(timestamp - 30 * DAY, timestamp);
      const spent = db.prepare('SELECT coalesce(sum(reserved_micros),0) AS total FROM ai_spend_reservations WHERE day=?').get(day).total;
      if (spent + cost > policy.dailyBudgetMicros) throw denied('AI_DAILY_BUDGET', '今日网站 AI 额度已用完，可使用自己的 API Key', retryDay);
      if (actor !== 'system') {
        const minute = db.prepare('SELECT count(*) AS total FROM ai_spend_reservations WHERE actor=? AND started_at>?').get(actor, timestamp - 60000).total;
        const daily = db.prepare('SELECT count(*) AS total FROM ai_spend_reservations WHERE actor=? AND day=?').get(actor, day).total;
        if (minute >= policy.userMinute) throw denied('AI_USER_RATE', 'AI 请求过于频繁，请稍后重试');
        if (daily >= policy.userDay) throw denied('AI_USER_DAILY', '今日个人网站 AI 额度已用完，可使用自己的 API Key', retryDay);
      }
      const active = db.prepare('SELECT count(*) AS total FROM ai_spend_reservations WHERE active_until>?').get(timestamp).total;
      const userActive = db.prepare('SELECT count(*) AS total FROM ai_spend_reservations WHERE actor=? AND active_until>?').get(actor, timestamp).total;
      if (active >= policy.globalConcurrent || actor !== 'system' && userActive >= policy.userConcurrent) {
        throw denied('AI_CONCURRENCY', 'AI 正在处理其他请求，请稍后重试', 10);
      }
      const id = randomUUID();
      db.prepare(`INSERT INTO ai_spend_reservations
        (id,actor,day,started_at,active_until,reserved_micros,model,status) VALUES (?,?,?,?,?,?,?,?)`)
        .run(id, actor, day, timestamp, timestamp + timeout + 5000, cost, payload.model, 'pending');
      db.exec('COMMIT');
      return id;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  function finish(id, { status = 'ok', usage } = {}) {
    if (!id) return;
    const tokens = n => Number.isSafeInteger(n) && n >= 0 ? n : null;
    const prompt = tokens(usage?.prompt_tokens);
    const completion = tokens(usage?.completion_tokens);
    const cost = status === 'ok' && prompt !== null && completion !== null && prompt + completion > 0
      ? prompt * 2 + completion * 8 : null;
    // Retain the same conservative rate; only release unused successful allowance.
    // Failed/unknown requests keep the full reservation, including across restarts.
    db.prepare(`UPDATE ai_spend_reservations SET active_until=0,status=?,prompt_tokens=?,completion_tokens=?,
      reserved_micros=COALESCE(?,reserved_micros) WHERE id=?`)
      .run(status, prompt, completion, Number.isSafeInteger(cost) ? cost : null, id);
  }

  function reconcileCompleted(day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Expected a budget date');
    return db.prepare(`UPDATE ai_spend_reservations SET reserved_micros=prompt_tokens*2+completion_tokens*8
      WHERE day=? AND status='ok' AND active_until=0
        AND typeof(prompt_tokens)='integer' AND typeof(completion_tokens)='integer'
        AND prompt_tokens>=0 AND completion_tokens>=0 AND prompt_tokens+completion_tokens>0
        AND reserved_micros<>prompt_tokens*2+completion_tokens*8`).run(day).changes;
  }
  return { reserve, finish, reconcileCompleted, close: () => db.close() };
}

let sharedGuard;
function siteAiSpendGuard() {
  if (!sharedGuard) {
    const dataDir = process.env.QMREADER_DB_FILE ? path.dirname(path.resolve(process.env.QMREADER_DB_FILE))
      : process.env.QMREADER_DATA_DIR || path.join(__dirname, '..', 'data');
    sharedGuard = createAiSpendGuard({ file: path.join(dataDir, 'ai-spend.sqlite') });
  }
  return sharedGuard;
}
module.exports = { MAX_SITE_OUTPUT_TOKENS, createAiSpendGuard, runWithAiActor, siteAiSpendGuard };

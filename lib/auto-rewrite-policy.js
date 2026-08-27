const DEFAULT_TIME_ZONE = 'Asia/Shanghai';
const DEFAULT_START_HOUR = 0;
const DEFAULT_END_HOUR = 7;

function parseHour(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : fallback;
}

function normalizeTimeZone(value) {
  const timeZone = String(value || DEFAULT_TIME_ZONE).trim() || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(0));
    return timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function zonedParts(now, timeZone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now).map(part => [part.type, part.value]));
}

function isHourInWindow(hour, startHour, endHour) {
  if (startHour === endHour) return true;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

function formatHour(hour) {
  return `${String(hour).padStart(2, '0')}:00`;
}

function autoRewriteWindowStatus(now = new Date(), env = process.env) {
  const timeZone = normalizeTimeZone(env.AUTO_REWRITE_TIME_ZONE);
  const startHour = parseHour(env.AUTO_REWRITE_WINDOW_START_HOUR, DEFAULT_START_HOUR);
  const endHour = parseHour(env.AUTO_REWRITE_WINDOW_END_HOUR, DEFAULT_END_HOUR);
  const parts = zonedParts(now, timeZone);
  const hour = Number(parts.hour);
  return {
    open: isHourInWindow(hour, startHour, endHour),
    timeZone,
    startHour,
    endHour,
    label: `${formatHour(startHour)}-${formatHour(endHour)}`,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function serverAiOptions(env = process.env, { autoRewrite = false } = {}) {
  const provider = String(env.AI_PROVIDER || '').trim();
  const isDeepSeek = !provider || provider.toLowerCase() === 'deepseek';
  return {
    provider,
    providerName: String(env.AI_PROVIDER_NAME || '').trim(),
    providerType: String(env.AI_PROVIDER_TYPE || '').trim(),
    baseUrl: String(isDeepSeek ? env.DEEPSEEK_BASE_URL || '' : env.AI_BASE_URL || '').trim(),
    model: String(
      (autoRewrite ? env.AUTO_REWRITE_MODEL : '')
      || (isDeepSeek ? env.DEEPSEEK_MODEL : env.AI_MODEL)
      || ''
    ).trim(),
  };
}

function configuredDefaultSourceIds(env = process.env) {
  return new Set(String(env.AUTO_REWRITE_SOURCE_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean));
}

module.exports = {
  autoRewriteWindowStatus,
  configuredDefaultSourceIds,
  isHourInWindow,
  serverAiOptions,
};

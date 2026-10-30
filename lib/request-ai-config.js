const SERVER_DEEPSEEK_MODEL = 'deepseek-flash';

function header(req, name) {
  return String(req.get(name) || '').trim();
}

const OAUTH_PROVIDERS = new Set(['chatgpt-account', 'codex-account']);

function requestAiConfig(req) {
  const apiKey = header(req, 'x-ai-key') || header(req, 'x-deepseek-key');

  // A signed-in ChatGPT / Codex account is referenced by id only. The tokens stay on the
  // server and the endpoint is fixed there, so no client-chosen base URL is ever honoured.
  const oauthAccountId = header(req, 'x-ai-oauth-account');
  const oauthProvider = header(req, 'x-ai-provider').toLowerCase();
  if (!apiKey && oauthAccountId && OAUTH_PROVIDERS.has(oauthProvider)) {
    return {
      apiKey: '',
      provider: oauthProvider,
      providerName: oauthProvider === 'codex-account' ? 'Codex' : 'ChatGPT',
      providerType: 'openai_responses',
      baseUrl: '',
      model: header(req, 'x-ai-model'),
      temperature: header(req, 'x-ai-temperature'),
      maxTokens: header(req, 'x-ai-max-tokens'),
      oauthAccountId,
      oauthUserId: req.user ? String(req.user.id) : '',
    };
  }

  // Never combine the server-owned DeepSeek key with client-controlled routing.
  // Custom providers remain available only when the caller supplies its own key.
  if (!apiKey) {
    const server = require('./auto-rewrite-policy').serverAiOptions();
    return {
      apiKey: '',
      provider: server.provider || 'deepseek',
      providerName: server.providerName || 'DeepSeek',
      providerType: server.providerType || 'openai_compatible',
      baseUrl: server.baseUrl,
      model: server.model || SERVER_DEEPSEEK_MODEL,
      temperature: '',
      maxTokens: '',
    };
  }

  return {
    apiKey,
    provider: header(req, 'x-ai-provider') || 'deepseek',
    providerName: header(req, 'x-ai-provider-name'),
    providerType: header(req, 'x-ai-provider-type') || 'openai_compatible',
    baseUrl: header(req, 'x-ai-base-url'),
    model: header(req, 'x-ai-model'),
    temperature: header(req, 'x-ai-temperature'),
    maxTokens: header(req, 'x-ai-max-tokens'),
  };
}

module.exports = {
  SERVER_DEEPSEEK_MODEL,
  requestAiConfig,
};

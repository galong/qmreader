/* AI provider catalogue, key detection and account sign-in panel.
 * Aligned with qiaomu clipper's provider-catalog / oauth flow. Loaded before app.js,
 * which merges `presets` into its own list and calls the hooks below. */
(function () {
  'use strict';

  const ACCOUNT = '账号登录';
  const ACCOUNT_BASE = 'https://chatgpt.com/backend-api/codex';
  const ACCOUNT_MODELS = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];

  // Presets that the app does not already carry. Ids that app.js already uses are never redefined.
  const presets = [
    { id: 'chatgpt-account', name: 'ChatGPT 账号', providerType: 'openai_responses', category: ACCOUNT, baseUrl: 'https://api.openai.com/v1', defaultModel: ACCOUNT_MODELS[0], quickModels: ACCOUNT_MODELS, description: 'Plus / Pro / Business 套餐额度，登录即用', signIn: 'chatgpt', recommended: true },
    { id: 'codex-account', name: 'Codex 账号', providerType: 'openai_responses', category: ACCOUNT, baseUrl: ACCOUNT_BASE, defaultModel: ACCOUNT_MODELS[0], quickModels: ACCOUNT_MODELS, description: 'ChatGPT 套餐里的 Codex 额度，登录即用', signIn: 'codex' },
    { id: 'tokendance', name: '词元跳动', providerType: 'openai_compatible', category: '国内聚合', baseUrl: 'https://tokendance.space/gateway/v1', defaultModel: 'deepseek-v4-flash', quickModels: ['deepseek-v4-flash', 'qwen3.8-flash', 'kimi-k3'], apiKeyUrl: 'https://tokendance.space/keys', description: '一个 Key 用所有模型，支持一步授权', signIn: 'tokendance' },
    { id: 'opencode-go', name: 'OpenCode Go', providerType: 'openai_compatible', category: '海外聚合', baseUrl: 'https://opencode.ai/zen/go/v1', defaultModel: 'deepseek-v4.1-flash', quickModels: ['deepseek-v4.1-flash', 'glm-5.3-flash', 'kimi-k3', 'longcat-2.0', 'mimo-v2.6-flash'], apiKeyUrl: 'https://opencode.ai/auth', description: 'opencode.ai 订阅，仅聊天模型' },
    { id: 'anthropic-official', name: 'Anthropic 官方', providerType: 'anthropic_compatible', category: '海外大模型', baseUrl: 'https://api.anthropic.com', defaultModel: 'claude-sonnet-5', quickModels: ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5'], apiKeyUrl: 'https://console.anthropic.com/settings/keys', description: 'Claude 官方 Messages 接口' },
    { id: 'google-gemini', name: 'Google Gemini', providerType: 'gemini', category: '海外大模型', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-3.5-flash', quickModels: ['gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-3.1-pro-preview'], apiKeyUrl: 'https://aistudio.google.com/apikey', description: 'Gemini Developer API（原生 generateContent）' },
    { id: 'azure-openai', name: 'Azure OpenAI', providerType: 'azure_openai', category: '海外大模型', baseUrl: 'https://{resource-name}.openai.azure.com/openai/deployments/{deployment-id}/chat/completions?api-version=2024-10-21', defaultModel: '', quickModels: [], apiKeyUrl: 'https://oai.azure.com/portal/', description: '把 {resource-name} 换成资源名；模型填部署名称，会替换 {deployment-id}' },
    { id: 'mistral', name: 'Mistral', providerType: 'openai_compatible', category: '海外大模型', baseUrl: 'https://api.mistral.ai/v1', defaultModel: 'mistral-large-latest', quickModels: ['mistral-large-latest', 'mistral-small-latest'], apiKeyUrl: 'https://console.mistral.ai/api-keys', description: 'Mistral 官方接口' },
    { id: 'perplexity', name: 'Perplexity', providerType: 'openai_compatible', category: '海外大模型', baseUrl: 'https://api.perplexity.ai', defaultModel: 'sonar', quickModels: ['sonar', 'sonar-pro'], apiKeyUrl: 'https://www.perplexity.ai/settings/api', description: '联网搜索模型' },
    { id: 'nvidia', name: 'NVIDIA', providerType: 'openai_compatible', category: '海外大模型', baseUrl: 'https://integrate.api.nvidia.com/v1', defaultModel: 'meta/llama-3.3-70b-instruct', quickModels: ['meta/llama-3.3-70b-instruct'], apiKeyUrl: 'https://build.nvidia.com/settings/api-keys', description: 'NVIDIA NIM 托管模型' },
    { id: 'fireworks', name: 'Fireworks AI', providerType: 'openai_compatible', category: '海外聚合', baseUrl: 'https://api.fireworks.ai/inference/v1', defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct', quickModels: ['accounts/fireworks/models/llama-v3p3-70b-instruct'], apiKeyUrl: 'https://fireworks.ai/account/api-keys', description: 'Fireworks 开源模型托管' },
    { id: 'cerebras', name: 'Cerebras', providerType: 'openai_compatible', category: '海外聚合', baseUrl: 'https://api.cerebras.ai/v1', defaultModel: 'llama-3.3-70b', quickModels: ['llama-3.3-70b'], apiKeyUrl: 'https://cloud.cerebras.ai/', description: '高速推理' },
    { id: 'minimax', name: 'MiniMax', providerType: 'openai_compatible', category: '国内大模型', baseUrl: 'https://api.minimaxi.com/v1', defaultModel: '', quickModels: [], apiKeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key', description: 'MiniMax 官方接口，填 Key 后点「获取模型」' },
    { id: 'stepfun', name: '阶跃星辰', providerType: 'openai_compatible', category: '国内大模型', baseUrl: 'https://api.stepfun.com/v1', defaultModel: '', quickModels: [], apiKeyUrl: 'https://platform.stepfun.com/interface-key', description: '阶跃星辰官方接口，填 Key 后点「获取模型」' },
    { id: 'qianfan', name: '百度千帆', providerType: 'openai_compatible', category: '国内大模型', baseUrl: 'https://qianfan.baidubce.com/v2', defaultModel: '', quickModels: [], apiKeyUrl: 'https://console.bce.baidu.com/iam/#/iam/apikey/list', description: '百度千帆 v2 接口，填 Key 后点「获取模型」' },
    { id: 'hunyuan', name: '腾讯混元', providerType: 'openai_compatible', category: '国内大模型', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', defaultModel: '', quickModels: [], apiKeyUrl: 'https://console.cloud.tencent.com/hunyuan/api-key', description: '腾讯混元官方接口，填 Key 后点「获取模型」' },
    { id: 'mimo', name: '小米 MiMo', providerType: 'openai_compatible', category: '国内大模型', baseUrl: 'https://api.xiaomimimo.com/v1', defaultModel: '', quickModels: [], apiKeyUrl: 'https://platform.xiaomimimo.com/', description: '小米 MiMo 官方接口，填 Key 后点「获取模型」' },
  ];

  // Existing app presets that gain a one-click authorisation.
  const SIGN_IN_FOR_EXISTING = { openrouter: 'openrouter' };

  let cachedStatus = null;
  let statusPromise = null;

  function loadStatus(api, { force = false } = {}) {
    if (cachedStatus && !force) return Promise.resolve(cachedStatus);
    if (statusPromise && !force) return statusPromise;
    statusPromise = api('/api/ai/oauth/status')
      .then(data => { cachedStatus = data; return data; })
      .catch(() => { cachedStatus = { enabled: false, storage: false, kinds: {}, accounts: [] }; return cachedStatus; })
      .finally(() => { statusPromise = null; });
    return statusPromise;
  }

  window.QMAiProviders = {
    ACCOUNT,
    presets,
    signInForExisting: SIGN_IN_FOR_EXISTING,
    loadStatus,
    status() { return cachedStatus; },
    resetStatus() { cachedStatus = null; },
  };
})();

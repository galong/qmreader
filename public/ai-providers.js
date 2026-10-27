/* AI provider catalogue, key detection and account sign-in panel.
 * Aligned with qiaomu clipper's provider-catalog / oauth flow. Loaded before app.js,
 * which merges `presets` into its own list and calls the hooks below. */
(function () {
  'use strict';

  const ACCOUNT = '账号登录';
  const SIGN_IN_NOTE = {
    chatgpt: '用 ChatGPT 套餐额度（Plus / Pro / Business）调用模型，无需 API Key。登录凭证加密保存在服务器，不会出现在浏览器里。',
    codex: '用 ChatGPT 套餐里的 Codex 额度调用模型，无需 API Key。登录凭证加密保存在服务器，不会出现在浏览器里。',
    openrouter: '授权后自动生成一个 OpenRouter Key 并填入下方，Key 只保存在当前浏览器。',
    tokendance: '授权后自动生成一个词元跳动 Key 并填入下方，Key 只保存在当前浏览器。',
  };
  const PASTE_HINT = {
    chatgpt: '登录完成后浏览器会跳到一个打不开的 http://127.0.0.1:1455/… 页面，把地址栏里的完整网址复制粘贴到这里。',
    codex: '登录完成后浏览器会跳到一个打不开的 http://localhost:1455/… 页面，把地址栏里的完整网址复制粘贴到这里。',
    openrouter: '如果授权窗口没有自动关闭，把最后跳转页面的完整网址粘贴到这里。',
    tokendance: '如果授权窗口没有自动关闭，把最后跳转页面的完整网址粘贴到这里。',
  };
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

  // Key shapes that identify a vendor on their own. Plain `sk-` keys are ambiguous and never guessed.
  const KEY_PREFIXES = [
    [/^sk-ant-/, 'anthropic-official'],
    [/^sk-or-/, 'openrouter'],
    [/^AIza[0-9A-Za-z_-]{20,}/, 'google-gemini'],
    [/^xai-/, 'grok'],
    [/^gsk_/, 'groq'],
    [/^pplx-/, 'perplexity'],
    [/^nvapi-/, 'nvidia'],
    [/^fw_/, 'fireworks'],
    [/^csk-/, 'cerebras'],
  ];

  function hostOf(url) {
    try { return new URL(String(url || '').replace(/[{}<>]/g, 'x')).hostname.toLowerCase(); } catch { return ''; }
  }

  function detectByKey(apiKey) {
    const key = String(apiKey || '').trim();
    const hit = KEY_PREFIXES.find(([re]) => re.test(key));
    return hit ? hit[1] : '';
  }

  // Only an unambiguous host (exactly one non-account preset) identifies a vendor by address.
  function detectByAddress(baseUrl, all) {
    const host = hostOf(baseUrl);
    if (!host) return '';
    const hits = all.filter(p => p.category !== ACCOUNT && !/[{<]/.test(p.baseUrl) && hostOf(p.baseUrl) === host);
    return hits.length === 1 ? hits[0].id : '';
  }

  function detect({ apiKey = '', baseUrl = '', all = [] } = {}) {
    return detectByKey(apiKey) || detectByAddress(baseUrl, all);
  }

  // ---- gallery ---------------------------------------------------------------------

  let query = '';
  let cachedStatus = null;
  let statusPromise = null;

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children) if (child) node.append(child);
    return node;
  }

  function applyFilter(list) {
    const needle = query.trim().toLowerCase();
    for (const group of list.querySelectorAll('.ai-template-group')) {
      let visible = 0;
      for (const button of group.querySelectorAll('.ai-template')) {
        const hay = `${button.dataset.search || ''} ${button.textContent}`.toLowerCase();
        const show = !needle || hay.includes(needle);
        button.hidden = !show;
        if (show) visible += 1;
      }
      group.hidden = visible === 0;
    }
    let empty = list.querySelector('.ai-template-empty');
    const any = [...list.querySelectorAll('.ai-template')].some(b => !b.hidden);
    if (!any && !empty) list.append(el('div', { class: 'ai-template-empty', text: '没有匹配的服务，可以选「自定义」手动填写。' }));
    if (any && empty) empty.remove();
  }

  function renderTemplates(list, { categories, presets: all, onStatus } = {}) {
    if (!list) return;
    if (!list.previousElementSibling || !list.previousElementSibling.classList.contains('ai-template-search')) {
      const search = el('input', { class: 'ai-template-search', type: 'search', placeholder: '搜索服务，例如 Gemini / 千问 / OpenRouter', 'aria-label': '搜索 AI 服务', autocomplete: 'off' });
      search.addEventListener('input', () => { query = search.value; applyFilter(list); });
      list.before(search);
    }
    list.textContent = '';
    const st = cachedStatus;
    for (const category of categories) {
      const items = all.filter(p => p.category === category);
      if (!items.length) continue;
      const buttons = el('div', { class: 'ai-template-buttons' });
      for (const preset of items) {
        const accountOff = preset.category === ACCOUNT && st && !(st.kinds && st.kinds[preset.signIn]);
        buttons.append(el('button', {
          type: 'button', class: 'ai-template' + (accountOff ? ' is-off' : ''), 'data-preset': preset.id,
          'data-search': `${preset.id} ${preset.providerType}`, title: accountOff ? '服务器未开启账号登录' : preset.description,
        }, el('span', { text: preset.name + (preset.recommended ? ' · 推荐' : '') + (preset.signIn && preset.category !== ACCOUNT ? ' · 可登录' : '') })));
      }
      list.append(el('div', { class: 'ai-template-group' }, el('div', { class: 'ai-template-category', text: category }), buttons));
    }
    list.append(el('div', { class: 'ai-template-group' },
      el('div', { class: 'ai-template-category', text: '自定义' }),
      el('div', { class: 'ai-template-buttons' }, el('button', { type: 'button', class: 'ai-template', 'data-preset': 'custom', 'data-search': 'custom openai compatible 自定义 兼容' }, el('span', { text: 'OpenAI 兼容' })))));
    applyFilter(list);
    if (!st && onStatus) onStatus();
  }

  // ---- sign-in panel ---------------------------------------------------------------

  function loadStatus(api, { force = false } = {}) {
    if (cachedStatus && !force) return Promise.resolve(cachedStatus);
    if (statusPromise && !force) return statusPromise;
    statusPromise = api('/api/ai/oauth/status')
      .then(data => { cachedStatus = data; return data; })
      .catch(() => { cachedStatus = { enabled: false, storage: false, kinds: {}, accounts: [] }; return cachedStatus; })
      .finally(() => { statusPromise = null; });
    return statusPromise;
  }

  function panelBox() {
    let box = document.getElementById('ai-signin-panel');
    if (box) return box;
    box = el('div', { id: 'ai-signin-panel', class: 'ai-signin-panel', hidden: true });
    const anchor = document.getElementById('ai-config-note');
    if (anchor) anchor.before(box);
    return box;
  }

  function setCredentialFieldsHidden(hidden) {
    const key = document.getElementById('ai-api-key');
    const label = key && key.closest('label');
    if (label) label.hidden = hidden;
    const base = document.getElementById('ai-base-url');
    if (base) base.readOnly = hidden;
  }

  function renderSignIn(profile, preset, host) {
    const box = panelBox();
    const kind = preset && preset.signIn;
    const isAccount = preset && preset.category === ACCOUNT;
    setCredentialFieldsHidden(Boolean(isAccount));
    box.textContent = '';
    if (!kind) { box.hidden = true; return; }
    const st = cachedStatus;
    if (!st) {
      box.hidden = false;
      box.append(el('div', { class: 'ai-signin-note', text: '正在检查登录功能…' }));
      loadStatus(host.api).then(() => { renderSignIn(host.profile(), preset, host); host.refreshGallery(); });
      return;
    }
    const available = Boolean(st.kinds && st.kinds[kind]);
    if (!available) {
      if (!isAccount) { box.hidden = true; return; }
      box.hidden = false;
      box.append(el('div', { class: 'ai-signin-note', text: st.enabled ? '服务器还没有配置凭证加密密钥（QMREADER_SECRET_KEY），暂时不能保存登录凭证。' : '服务器管理员尚未开启账号登录功能（AI_OAUTH_ENABLED=1）。' }));
      return;
    }
    box.hidden = false;
    const status = el('div', { class: 'ai-signin-status' });
    const pasteRow = el('div', { class: 'ai-signin-paste', hidden: true });
    const pasteInput = el('input', { type: 'text', placeholder: '粘贴登录完成后的完整网址', autocomplete: 'off', 'aria-label': '登录回调网址' });
    const say = (text, error = false) => { status.textContent = text; status.classList.toggle('is-error', error); };
    const accounts = (st.accounts || []).filter(a => a.kind === kind);
    const current = accounts.find(a => a.id === profile.oauthAccountId);
    let popupListener = null;

    async function conclude(result) {
      if (result.account) {
        await loadStatus(host.api, { force: true });
        host.connect(result.account.id, result.label);
      } else if (result.apiKey) {
        host.useKey(result.apiKey, result.label);
      }
      pasteRow.hidden = true;
      pasteInput.value = '';
    }

    async function signIn() {
      say('正在准备登录…');
      try {
        const started = await host.api('/api/ai/oauth/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind }) });
        const popup = window.open(started.authUrl, 'qm-ai-signin', 'width=520,height=720');
        say(popup ? '已打开登录窗口，完成后回到这里。' : '浏览器拦截了弹窗，请点下面的链接继续登录。');
        if (!popup) box.append(el('a', { href: started.authUrl, target: '_blank', rel: 'noopener', text: '打开登录页面' }));
        pasteRow.hidden = false;
        if (started.mode === 'redirect') {
          if (popupListener) window.removeEventListener('message', popupListener);
          popupListener = async (event) => {
            if (event.origin !== location.origin || !event.data || event.data.type !== 'qm-ai-oauth') return;
            window.removeEventListener('message', popupListener);
            popupListener = null;
            if (!event.data.resultId) { say('授权没有完成，请重试或粘贴网址。', true); return; }
            try {
              await conclude(await host.api('/api/ai/oauth/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resultId: event.data.resultId }) }));
            } catch (err) { say(err.message, true); }
          };
          window.addEventListener('message', popupListener);
        }
      } catch (err) { say(err.message, true); }
    }

    async function finishByPaste() {
      const callbackUrl = pasteInput.value.trim();
      if (!callbackUrl) { say('请先粘贴登录完成后的网址。', true); return; }
      say('正在完成登录…');
      try {
        await conclude(await host.api('/api/ai/oauth/finish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, callbackUrl }) }));
      } catch (err) { say(err.message, true); }
    }

    async function signOut() {
      if (!current) return;
      try {
        await host.api(`/api/ai/oauth/accounts/${encodeURIComponent(current.id)}`, { method: 'DELETE' });
        await loadStatus(host.api, { force: true });
        host.disconnect();
      } catch (err) { say(err.message, true); }
    }

    const verb = isAccount ? '登录' : '一键授权';
    const actions = el('div', { class: 'ai-signin-actions' });
    if (isAccount && current) {
      say(`已登录：${current.label}${current.plan ? ` · ${current.plan}` : ''}`);
      actions.append(el('button', { type: 'button', class: 'ghost-btn', text: '重新登录', onclick: signIn }), el('button', { type: 'button', class: 'ghost-btn danger', text: '退出登录', onclick: signOut }));
    } else {
      if (isAccount) say(accounts.length ? '这个配置还没有绑定账号，可以选择已登录的账号或登录新账号。' : '尚未登录。');
      for (const account of accounts) {
        actions.append(el('button', { type: 'button', class: 'ghost-btn', text: `使用 ${account.label}`, onclick: () => host.connect(account.id, account.label) }));
      }
      actions.append(el('button', { type: 'button', class: 'ghost-btn primary', text: `${verb} ${preset.name.replace(/ 账号$/, '')}`.trim(), onclick: signIn }));
    }
    pasteRow.append(el('div', { class: 'ai-signin-hint', text: PASTE_HINT[kind] }), pasteInput, el('button', { type: 'button', class: 'ghost-btn', text: '完成登录', onclick: finishByPaste }));
    box.append(el('div', { class: 'ai-signin-note', text: SIGN_IN_NOTE[kind] }), actions, status, pasteRow);
  }

  // ---- key / address detection ----------------------------------------------------

  function renderDetectHint(host, all) {
    const key = document.getElementById('ai-api-key');
    if (!key) return;
    let hint = document.getElementById('ai-detect-hint');
    if (!hint) {
      hint = el('div', { id: 'ai-detect-hint', class: 'ai-detect-hint', hidden: true });
      const label = key.closest('label');
      if (label) label.after(hint);
    }
    const current = host.profile();
    const byKey = detectByKey(key.value);
    const guess = byKey || (current && current.provider === 'custom' ? detectByAddress(document.getElementById('ai-base-url').value, all) : '');
    const target = all.find(p => p.id === guess);
    if (!target || (current && current.provider === guess)) {
      hint.hidden = true;
      return;
    }
    hint.textContent = '';
    hint.hidden = false;
    hint.append(`看起来是 ${target.name} 的${byKey ? ' Key' : '地址'}，`, el('button', { type: 'button', class: 'ai-detect-apply', text: '切换到这个服务', onclick: () => { hint.hidden = true; host.applyPreset(target.id, key.value.trim()); } }));
  }

  function bindDetection(host, all) {
    const key = document.getElementById('ai-api-key');
    const base = document.getElementById('ai-base-url');
    if (!key || key.dataset.qmDetect) return;
    key.dataset.qmDetect = '1';
    key.addEventListener('input', () => renderDetectHint(host, all));
    // A finished paste or edit reads the model list on its own; failures stay quiet and the preset list remains.
    key.addEventListener('change', () => { renderDetectHint(host, all); host.autoFetchModels(); });
    if (base) base.addEventListener('change', () => renderDetectHint(host, all));
  }

  window.QMAiProviders = {
    ACCOUNT,
    presets,
    signInForExisting: SIGN_IN_FOR_EXISTING,
    detect,
    renderTemplates,
    renderSignIn,
    bindDetection,
    renderDetectHint,
    loadStatus,
    resetStatus() { cachedStatus = null; },
  };
})();

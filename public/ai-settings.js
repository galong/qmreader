/* AI services and models, ported from qiaomu clipper (provider-dialogs / provider-catalog / model-picker).
 * Providers (an account or a key) and models (one per provider model) are shown as two lists; adding goes
 * through a card gallery and a model checklist; the chat box switches models through a searchable popover.
 * Storage stays the existing profile list: one profile is one model, and it carries a copy of its provider's
 * credentials, so every API call keeps working unchanged. Loaded before app.js, which calls the hooks below. */
(function () {
  'use strict';

  const ICONS = window.QM_BRAND_ICONS || {};
  const $ = (sel, root = document) => root.querySelector(sel);

  // ---- tiny DOM helpers (rows, cards and chips are divs: global button styles stretch buttons) ----

  function el(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function press(node, label, run) {
    node.setAttribute('role', 'button');
    node.tabIndex = 0;
    node.setAttribute('aria-label', label);
    node.addEventListener('click', run);
    node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(); } });
    return node;
  }

  function button(label, kind, run) {
    const b = el('button', kind, label);
    b.type = 'button';
    b.addEventListener('click', run);
    return b;
  }

  function input(type, value = '', placeholder = '') {
    const i = el('input');
    i.type = type;
    i.value = value;
    i.placeholder = placeholder;
    i.spellcheck = false;
    i.autocomplete = 'off';
    return i;
  }

  function field(id, label, control, hint) {
    const row = el('div', 'pd-field');
    const l = el('label', '', label);
    l.htmlFor = id;
    control.id = id;
    row.append(l, control);
    if (hint) row.append(hint);
    return row;
  }

  function icon(name) {
    return typeof lucideIcon === 'function' ? lucideIcon(name, { className: 'app-icon' }) : '';
  }

  function iconButton(label, name, run) {
    const b = el('button', 'pd-icon-btn');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.innerHTML = icon(name);
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); run(); });
    return b;
  }

  // ---- catalogue: the order and wording follow clipper's provider gallery ----------------------

  const GROUPS = ['account', 'relay', 'provider'];
  const GROUP_LABEL = {
    account: '账号登录 · 无需 Key',
    relay: '聚合中转 · 一个 Key 用多家模型',
    provider: '服务商',
  };

  // [preset id, group, brand icon, display name, one-line sub]
  const SPEC = [
    ['chatgpt-account', 'account', 'openai', 'ChatGPT', 'Plus · Pro · Business'],
    ['codex-account', 'account', 'codex', 'Codex', 'ChatGPT 套餐里的 Codex'],
    ['tokendance', 'relay', '', '词元跳动', 'tokendance.space · 一个 Key 用所有模型', 262],
    ['siliconflow', 'relay', 'siliconflow', '硅基流动'],
    ['openrouter', 'relay', 'openrouter', 'OpenRouter'],
    ['opencode-go', 'relay', 'opencode', 'OpenCode Go', 'opencode.ai · 仅显示当前支持的聊天模型'],
    ['aihubmix', 'relay', '', 'AiHubMix'],
    ['codex', 'relay', '', 'Codex / aigocode'],
    ['openai', 'provider', 'openai', 'OpenAI'],
    ['anthropic-official', 'provider', 'anthropic', 'Anthropic'],
    ['google-gemini', 'provider', 'gemini', 'Google Gemini', 'Gemini Developer API'],
    ['deepseek', 'provider', 'deepseek', 'DeepSeek'],
    ['moonshot', 'provider', 'moonshot', 'Kimi'],
    ['zhipu', 'provider', 'zhipu', '智谱 GLM'],
    ['qwen', 'provider', 'qwen', '通义千问', '阿里云百炼'],
    ['doubao', 'provider', 'doubao', '豆包', '火山方舟'],
    ['minimax', 'provider', 'minimax', 'MiniMax'],
    ['stepfun', 'provider', 'stepfun', '阶跃星辰'],
    ['qianfan', 'provider', '', '百度千帆'],
    ['hunyuan', 'provider', '', '腾讯混元'],
    ['mimo', 'provider', '', '小米 MiMo'],
    ['grok', 'provider', 'xai', 'xAI'],
    ['mistral', 'provider', 'mistral', 'Mistral'],
    ['groq', 'provider', 'groq', 'Groq'],
    ['perplexity', 'provider', 'perplexity', 'Perplexity'],
    ['nvidia', 'provider', 'nvidia', 'NVIDIA'],
    ['together', 'provider', '', 'Together AI'],
    ['fireworks', 'provider', '', 'Fireworks AI'],
    ['cerebras', 'provider', '', 'Cerebras'],
    ['azure-openai', 'provider', 'azure', 'Azure OpenAI', '填写资源名与部署名'],
    ['workers_ai', 'provider', '', 'Cloudflare Workers AI'],
  ];
  // Same vendor listed twice in older builds; the gallery shows the official entry only.
  const HIDDEN = new Set(['anthropic']);

  const HOST_ICONS = [
    [/chatgpt\.com|api\.openai\.com/, 'openai'], [/anthropic\.com/, 'anthropic'], [/googleapis\.com/, 'gemini'], [/deepseek/, 'deepseek'],
    [/moonshot/, 'moonshot'], [/bigmodel|z\.ai/, 'zhipu'], [/dashscope|aliyun/, 'qwen'], [/volces|volcengine/, 'doubao'], [/minimax/, 'minimax'],
    [/stepfun/, 'stepfun'], [/x\.ai/, 'xai'], [/mistral/, 'mistral'], [/groq/, 'groq'], [/perplexity/, 'perplexity'], [/siliconflow/, 'siliconflow'],
    [/openrouter/, 'openrouter'], [/11434|ollama/, 'ollama'], [/huggingface/, 'huggingface'], [/openai\.azure/, 'azure'], [/nvidia/, 'nvidia'], [/opencode\.ai/, 'opencode'],
  ];

  function safeHost(url) {
    try { return new URL(String(url || '').replace(/[{}<>]/g, 'x')).host; } catch { return ''; }
  }

  let catalogCache = null;
  function catalog() {
    if (catalogCache && catalogCache.size === AI_PROVIDER_PRESETS.length) return catalogCache.list;
    const byId = new Map(AI_PROVIDER_PRESETS.map(p => [p.id, p]));
    const list = [];
    const used = new Set();
    for (const [id, group, brand, name, sub, hue] of SPEC) {
      const preset = byId.get(id);
      if (!preset) continue;
      used.add(id);
      list.push({ id, group, icon: brand, name: name || preset.name, sub: sub || safeHost(preset.baseUrl), preset, hue });
    }
    for (const preset of AI_PROVIDER_PRESETS) {
      if (used.has(preset.id) || HIDDEN.has(preset.id)) continue;
      const group = preset.category === '账号登录' ? 'account' : /聚合/.test(preset.category || '') ? 'relay' : 'provider';
      list.push({ id: preset.id, group, icon: '', name: preset.name, sub: safeHost(preset.baseUrl), preset });
    }
    catalogCache = { size: AI_PROVIDER_PRESETS.length, list };
    return list;
  }

  const hueOf = text => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

  function entryOf(provider) {
    return catalog().find(e => e.id === provider.presetId) || null;
  }

  // An icon tile: the vendor's mark, else the first letter on a tinted square.
  function iconTile(provider, size = 'md') {
    const tile = el('span', `provider-tile is-${size}`);
    const entry = entryOf(provider || {});
    const key = (entry && entry.icon) || (HOST_ICONS.find(([re]) => re.test(String(provider && provider.baseUrl || '').toLowerCase())) || [])[1];
    if (key && ICONS[key]) {
      tile.innerHTML = ICONS[key];
    } else {
      const name = (entry && entry.name) || (provider && provider.name) || '?';
      tile.classList.add('is-letter');
      tile.style.setProperty('--h', String((entry && entry.hue) || hueOf(name)));
      tile.textContent = [...String(name).trim()][0]?.toUpperCase() || '?';
    }
    return tile;
  }

  // ---- storage: providers beside the profile list ---------------------------------------------

  function providersKey() { return `qm_ai_providers:${aiScope()}`; }

  function newId() { return createId('aip'); }

  function readStored() {
    const stored = readJson(providersKey(), 'null');
    return Array.isArray(stored) ? stored.filter(p => p && p.id) : [];
  }

  function hasCredential(profile) { return Boolean(profile.apiKey || profile.oauthAccountId); }

  function providerFromProfile(profile) {
    const preset = AI_PROVIDER_MAP[profile.provider];
    return {
      id: newId(),
      name: profile.providerName || (preset && preset.name) || profile.name || '自定义',
      presetId: profile.provider || 'custom',
      providerType: profile.providerType || 'openai_compatible',
      category: profile.providerCategory || '',
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey || '',
      oauthAccountId: profile.oauthAccountId || '',
      apiKeyUrl: profile.apiKeyUrl || '',
    };
  }

  // Called while the profile list loads: pairs each configured profile with a provider, creating the
  // provider on first sight so profiles saved by older builds show up in the two lists.
  function migrate(profiles) {
    const providers = readStored();
    const next = profiles.map(profile => {
      if (profile.providerId && providers.some(p => p.id === profile.providerId)) return profile;
      if (!hasCredential(profile)) return { ...profile, providerId: '' };
      let match = providers.find(p => p.presetId === profile.provider && p.baseUrl === profile.baseUrl
        && (p.apiKey || '') === (profile.apiKey || '') && (p.oauthAccountId || '') === (profile.oauthAccountId || ''));
      if (!match) { match = providerFromProfile(profile); providers.push(match); }
      return { ...profile, providerId: match.id };
    });
    state.aiProviders = providers;
    return next;
  }

  function persistProviders() {
    try { storage.setItem(providersKey(), JSON.stringify(state.aiProviders || [])); } catch { /* quota */ }
  }

  function providers() { return state.aiProviders || (state.aiProviders = []); }
  function providerById(id) { return providers().find(p => p.id === id); }
  function modelsOf(provider) { return state.aiProfiles.filter(p => p.providerId === provider.id); }
  function visibleModels() { return state.aiProfiles.filter(p => p.providerId && providerById(p.providerId)); }

  // The denormalised copy every profile keeps of its provider.
  function copyProvider(profile, provider) {
    return {
      ...profile,
      provider: provider.presetId || 'custom',
      providerName: provider.name,
      providerType: provider.providerType || 'openai_compatible',
      providerCategory: provider.category || '',
      apiKeyUrl: provider.apiKeyUrl || '',
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey || '',
      oauthAccountId: provider.oauthAccountId || '',
      providerId: provider.id,
    };
  }

  function changed() {
    if (typeof aiSettingsChanged === 'function') aiSettingsChanged();
    render();
  }

  function providerNeedsLogin(provider) {
    const preset = AI_PROVIDER_MAP[provider.presetId];
    return Boolean(preset && preset.category === window.QMAiProviders.ACCOUNT);
  }

  // ---- settings lists ---------------------------------------------------------------------------

  function providerSub(provider) {
    if (providerNeedsLogin(provider)) {
      const account = ((window.QMAiProviders.status() || {}).accounts || []).find(a => a.id === provider.oauthAccountId);
      if (provider.oauthAccountId) return { text: `已登录：${account ? account.label : provider.name}`, warn: false };
      return { text: '尚未登录', warn: true };
    }
    if (!provider.apiKey) return { text: '未填写 API Key', warn: true };
    return { text: safeHost(provider.baseUrl), warn: false };
  }

  function renderProviderList() {
    const list = $('#provider-list');
    if (!list) return;
    list.textContent = '';
    for (const provider of providers()) {
      const row = el('div', 'provider-list-item');
      const text = el('div', 'provider-list-text');
      const sub = providerSub(provider);
      text.append(el('div', 'provider-name-text', provider.name), el('div', `provider-list-sub${sub.warn ? ' is-warn' : ''}`, sub.text));
      const info = el('div', 'provider-list-item-info');
      info.append(iconTile(provider, 'md'), text);
      const actions = el('div', 'provider-list-item-actions');
      actions.append(
        iconButton('编辑', 'pen-line', () => openProviderEditor(provider)),
        iconButton('删除', 'trash-2', () => deleteProvider(provider)),
      );
      row.append(info, actions);
      list.append(row);
    }
    if (!providers().length) list.append(el('div', 'ai-set-empty', '还没有服务商，先添加一个。'));
  }

  function renderModelList() {
    const list = $('#model-list');
    if (!list) return;
    list.textContent = '';
    const models = visibleModels().slice().sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    for (const profile of models) {
      const provider = providerById(profile.providerId);
      const row = el('div', 'model-list-item');
      const text = el('div', 'model-list-text');
      text.append(el('div', 'model-name', profile.name), el('div', 'model-provider', provider ? provider.name : '未知服务商'));
      const info = el('div', 'model-list-item-info');
      info.append(iconTile(provider || {}, 'md'), text);
      const actions = el('div', 'model-list-item-actions');
      if (profile.isDefault) {
        actions.append(el('span', 'pd-tag is-default', '默认'));
      } else {
        actions.append(button('设为默认', 'pd-set-default', () => setDefault(profile)));
      }
      actions.append(
        iconButton('编辑', 'pen-line', () => openModelEditor(profile)),
        iconButton('复制', 'copy-plus', () => duplicateModel(profile)),
        iconButton('删除', 'trash-2', () => deleteModel(profile)),
      );
      row.append(info, actions);
      list.append(row);
    }
    if (!models.length) list.append(el('div', 'ai-set-empty', providers().length ? '还没有模型，点下面的「添加模型」。' : '先添加一个服务商，再选择它的模型。'));
  }

  function render() {
    renderProviderList();
    renderModelList();
    if (providers().some(providerNeedsLogin) && !window.QMAiProviders.status()) {
      window.QMAiProviders.loadStatus(api).then(() => renderProviderList());
    }
  }

  function setDefault(profile) {
    state.aiProfiles = state.aiProfiles.map(p => ({ ...p, isDefault: p.id === profile.id }));
    state.activeAiProfileId = profile.id;
    changed();
  }

  async function deleteProvider(provider) {
    const used = modelsOf(provider).length;
    if (used) { toast(`「${provider.name}」下还有 ${used} 个模型，请先删除这些模型。`, 4000); return; }
    const ok = await showConfirmDialog({ title: '删除服务商', message: `确定删除「${provider.name}」吗？`, confirmText: '删除', danger: true });
    if (!ok) return;
    state.aiProviders = providers().filter(p => p.id !== provider.id);
    persistProviders();
    changed();
  }

  async function deleteModel(profile) {
    const ok = await showConfirmDialog({
      title: '删除模型',
      message: `确定删除「${profile.name}」吗？使用它的翻译、改写和对话会切回默认模型。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    state.aiProfiles = ensureSingleDefault(state.aiProfiles.filter(p => p.id !== profile.id));
    const fallback = (visibleModels().find(p => p.isDefault) || visibleModels()[0] || state.aiProfiles[0] || {}).id || '';
    for (const key of ['activeAiProfileId', 'translationAiProfileId', 'rewriteAiProfileId', 'agentAiProfileId']) {
      if (!state.aiProfiles.some(p => p.id === state[key])) state[key] = fallback;
    }
    changed();
  }

  function duplicateModel(profile) {
    const copy = { ...profile, id: createId('ai'), name: `${profile.name} 副本`, isDefault: false, updatedAt: Date.now() };
    state.aiProfiles = [...state.aiProfiles, copy];
    changed();
  }

  // ---- dialogs ---------------------------------------------------------------------------------

  let dialogOpen = null;

  function openDialog(title) {
    const modal = $('#pd-modal');
    const body = $('.pd-body', modal);
    const actions = $('.pd-actions', modal);
    $('.pd-title', modal).textContent = title;
    body.textContent = '';
    actions.textContent = '';
    modal.classList.remove('hidden', 'pd-wide');
    dialogOpen = { modal, body, actions, close };
    function close() { modal.classList.add('hidden'); dialogOpen = null; }
    return dialogOpen;
  }

  function closeDialog() { if (dialogOpen) dialogOpen.close(); }

  // -- provider gallery

  function openProviderPicker() {
    const dlg = openDialog('添加服务商');
    dlg.modal.classList.add('pd-wide');
    const entries = catalog();
    const added = entry => providers().find(p => p.presetId === entry.id);
    const search = input('search', '', '搜索服务商…');
    search.className = 'pd-search';
    search.setAttribute('aria-label', '搜索服务商');
    const grid = el('div', 'pd-gallery');
    dlg.body.append(search, grid);

    const open = entry => window.QMAiProviders.loadStatus(api).then(() => showProviderForm(dlg, entry, null, openProviderPicker));
    const card = (entry, existing) => {
      const c = press(el('div', `pd-card${existing ? ' is-added' : ''}`), entry.name, () => open(entry));
      const text = el('div', 'pd-card-text');
      text.append(el('div', 'pd-card-name', entry.name), el('div', 'pd-card-sub', entry.sub));
      c.append(iconTile({ presetId: entry.id, baseUrl: entry.preset.baseUrl, name: entry.name }, 'lg'), text);
      if (existing) c.append(el('span', 'pd-card-mark', '✓'));
      return c;
    };

    const renderGallery = () => {
      const q = search.value.trim().toLowerCase();
      grid.textContent = '';
      let count = 0;
      for (const group of GROUPS) {
        const list = entries.filter(e => e.group === group && (!q || `${e.name} ${e.sub} ${e.id}`.toLowerCase().includes(q)));
        if (!list.length) continue;
        count += list.length;
        grid.append(el('div', 'pd-group', GROUP_LABEL[group]));
        const row = el('div', 'pd-cards');
        list.forEach(e => row.append(card(e, added(e))));
        grid.append(row);
      }
      if (!q || '自定义 custom openai 兼容'.includes(q)) {
        grid.append(el('div', 'pd-group', '其他'));
        const row = el('div', 'pd-cards');
        const c = press(el('div', 'pd-card is-custom'), '自定义', () => open(null));
        const text = el('div', 'pd-card-text');
        text.append(el('div', 'pd-card-name', '自定义'), el('div', 'pd-card-sub', '任意兼容的接口地址'));
        c.append(el('span', 'provider-tile is-lg is-plus', '+'), text);
        row.append(c);
        grid.append(row);
        count++;
      }
      if (!count) grid.append(el('div', 'pd-empty', '没有匹配的服务商'));
    };
    search.addEventListener('input', renderGallery);
    renderGallery();
    dlg.actions.append(button('取消', '', dlg.close));
    search.focus();
  }

  function openProviderEditor(provider) {
    const dlg = openDialog('编辑服务商');
    window.QMAiProviders.loadStatus(api).then(() => showProviderForm(dlg, entryOf(provider), provider, () => {}));
  }

  // Sign-in plumbing shared by the account entries (stored on the server) and the key hand-offs.
  function createSignIn({ kind, status, paste, pasteInput, onAccount, onKey }) {
    let listener = null;
    const say = (text, error = false) => { status.textContent = text; status.classList.toggle('is-error', error); };

    async function conclude(result) {
      if (result.account) { await window.QMAiProviders.loadStatus(api, { force: true }); onAccount(result.account, result.label); }
      else if (result.apiKey) onKey(result.apiKey, result.label);
      paste.hidden = true;
      pasteInput.value = '';
    }

    return {
      say,
      async start() {
        say('正在准备登录…');
        try {
          const started = await api('/api/ai/oauth/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind }) });
          const popup = window.open(started.authUrl, 'qm-ai-signin', 'width=520,height=720');
          say(popup ? '请在打开的窗口里完成登录…' : '浏览器拦截了弹窗，请点下面的链接继续登录。');
          if (!popup) {
            const a = el('a', '', '打开登录页面');
            a.href = started.authUrl; a.target = '_blank'; a.rel = 'noopener';
            status.append(' ', a);
          }
          paste.hidden = false;
          if (started.mode === 'redirect') {
            if (listener) window.removeEventListener('message', listener);
            listener = async event => {
              if (event.origin !== location.origin || !event.data || event.data.type !== 'qm-ai-oauth') return;
              window.removeEventListener('message', listener);
              listener = null;
              if (!event.data.resultId) { say('授权没有完成，请重试或粘贴网址。', true); return; }
              try {
                await conclude(await api('/api/ai/oauth/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resultId: event.data.resultId }) }));
              } catch (err) { say(err.message, true); }
            };
            window.addEventListener('message', listener);
          }
        } catch (err) { say(err.message, true); }
      },
      async finish() {
        const callbackUrl = pasteInput.value.trim();
        if (!callbackUrl) { say('请先粘贴登录完成后的网址。', true); return; }
        say('正在完成登录…');
        try {
          await conclude(await api('/api/ai/oauth/finish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, callbackUrl }) }));
        } catch (err) { say(err.message, true); }
      },
      cancel() { if (listener) { window.removeEventListener('message', listener); listener = null; } },
    };
  }

  const NOTE = {
    chatgpt: '使用你的 ChatGPT 套餐额度，不需要 API Key。登录凭证加密保存在服务器，不会出现在浏览器里。',
    codex: '使用你的 Codex 套餐额度，不需要 API Key。登录凭证加密保存在服务器，不会出现在浏览器里。',
    openrouter: '在浏览器里确认后，会自动为你创建 Key，不用复制粘贴。',
    tokendance: '在浏览器里确认后，会自动为你创建 Key。',
  };
  const SIGN_IN_LABEL = { chatgpt: '登录 ChatGPT', codex: '登录 Codex', openrouter: '用 OpenRouter 登录', tokendance: '授权词元跳动' };
  const PASTE_HINT = {
    chatgpt: '登录完成后浏览器会跳到一个打不开的 http://127.0.0.1:1455/… 页面，把地址栏里的完整网址粘贴到这里。',
    codex: '登录完成后浏览器会跳到一个打不开的 http://localhost:1455/… 页面，把地址栏里的完整网址粘贴到这里。',
  };

  function showProviderForm(dlg, entry, existing, back) {
    dlg.modal.classList.remove('pd-wide');
    dlg.body.textContent = '';
    dlg.actions.textContent = '';
    $('.pd-title', dlg.modal).textContent = existing ? '编辑服务商' : '添加服务商';

    const preset = entry ? entry.preset : null;
    const signInKind = preset && preset.signIn ? preset.signIn : '';
    const isAccount = Boolean(preset && preset.category === window.QMAiProviders.ACCOUNT);
    const keySignIn = Boolean(signInKind && !isAccount);
    let oauthAccountId = existing ? existing.oauthAccountId || '' : '';
    let signer = null;
    let renderExtras = () => {};

    const head = el('div', 'pd-head');
    const nameInput = input('text', existing ? existing.name : '', '服务商名称');
    head.append(iconTile({ presetId: entry ? entry.id : 'custom', baseUrl: existing ? existing.baseUrl : (preset ? preset.baseUrl : ''), name: existing ? existing.name : '' }, 'lg'));
    if (entry) head.append(el('strong', '', entry.name)); else head.append(nameInput);
    dlg.body.append(head);

    const note = el('div', 'pd-note');
    const status = el('div', 'pd-status');
    status.setAttribute('role', 'status');
    const keyInput = input('password', existing ? existing.apiKey || '' : '', 'sk-…');
    const urlInput = input('text', existing ? existing.baseUrl : (preset ? preset.baseUrl : ''), 'https://');
    const paste = el('div', 'pd-paste');
    paste.hidden = true;
    const pasteInput = input('text', '', '如果没有自动继续，把最后停留页面的地址粘贴到这里');
    let signInBtn = null;
    const serverStatus = window.QMAiProviders.status();

    const accountLabel = id => {
      const account = (((window.QMAiProviders.status() || {}).accounts) || []).find(a => a.id === id);
      return account ? `${account.label}${account.plan ? ` · ${account.plan}` : ''}` : (entry ? entry.name : '');
    };
    const signedIn = label => {
      status.textContent = `已登录：${label}`;
      status.classList.remove('is-error');
      if (signInBtn) signInBtn.textContent = '重新登录';
    };

    if (signInKind) {
      const available = Boolean(serverStatus && serverStatus.kinds && serverStatus.kinds[signInKind]);
      signer = createSignIn({
        kind: signInKind, status, paste, pasteInput,
        onAccount: (account, label) => { oauthAccountId = account.id; signedIn(label || accountLabel(account.id)); renderExtras(); },
        onKey: (key, label) => { keyInput.value = key; status.textContent = `${label || ''} 授权完成，Key 已填入。`; status.classList.remove('is-error'); },
      });
      note.textContent = NOTE[signInKind] || '';
      dlg.body.append(note);
      if (isAccount && !available) {
        status.textContent = serverStatus && serverStatus.enabled
          ? '服务器还没有配置凭证加密密钥（QMREADER_SECRET_KEY），暂时不能保存登录凭证。'
          : '服务器管理员尚未开启账号登录功能（AI_OAUTH_ENABLED=1）。';
        status.classList.add('is-error');
        dlg.body.append(status);
      } else if (available) {
        signInBtn = button(SIGN_IN_LABEL[signInKind], 'pd-primary', () => { signer.start(); });
        const row = el('div', 'pd-signin');
        row.append(signInBtn);
        const extras = el('div', 'pd-signin-extras');
        renderExtras = () => {
          extras.textContent = '';
          if (!isAccount) return;
          const accounts = (((window.QMAiProviders.status() || {}).accounts) || []).filter(a => a.kind === signInKind);
          for (const account of accounts) {
            if (account.id === oauthAccountId) continue;
            extras.append(button(`使用 ${account.label}`, 'pd-link', () => { oauthAccountId = account.id; signedIn(accountLabel(account.id)); renderExtras(); }));
          }
          if (oauthAccountId) extras.append(button('退出登录', 'pd-link is-danger', async () => {
            try {
              await api(`/api/ai/oauth/accounts/${encodeURIComponent(oauthAccountId)}`, { method: 'DELETE' });
              await window.QMAiProviders.loadStatus(api, { force: true });
              oauthAccountId = '';
              status.textContent = '';
              if (signInBtn) signInBtn.textContent = SIGN_IN_LABEL[signInKind];
              if (existing) { existing.oauthAccountId = ''; persistProviders(); }
              renderExtras();
            } catch (err) { signer.say(err.message, true); }
          }));
        };
        dlg.body.append(row, extras, status, paste);
        paste.append(pasteInput, button('继续', '', () => {
          if (pasteInput.value.trim()) signer.finish();
          else signer.say('请先粘贴登录完成后的网址。', true);
        }));
        if (PASTE_HINT[signInKind]) pasteInput.placeholder = '粘贴登录完成后的完整网址';
        if (oauthAccountId) signedIn(accountLabel(oauthAccountId));
        renderExtras();
      }
    } else if (entry && entry.group === 'local') {
      dlg.body.append(note);
    }
    if (!isAccount) {
      const keyHint = el('div', 'pd-hint');
      const keyUrl = (preset && preset.apiKeyUrl) || (existing && existing.apiKeyUrl) || '';
      if (keyUrl) {
        const a = el('a', '', '获取 API Key');
        a.href = keyUrl; a.target = '_blank'; a.rel = 'noopener noreferrer';
        keyHint.append(a);
      }
      const placeholderUrl = preset && /[{<]/.test(preset.baseUrl);
      if (!entry) dlg.body.append(field('pd-url', '接口地址', urlInput, el('div', 'pd-hint', 'OpenAI 兼容的地址，例如 https://example.com/v1')));
      const keyRow = field('pd-key', keySignIn ? 'API Key（授权后自动填入）' : 'API Key', keyInput, keyHint);
      const reveal = press(el('span', 'pd-reveal', '显示'), '显示', () => {
        keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
        reveal.textContent = keyInput.type === 'password' ? '显示' : '隐藏';
      });
      const wrap = el('div', 'pd-input-wrap');
      keyInput.replaceWith(wrap);
      wrap.append(keyInput, reveal);
      keyRow.classList.add('has-reveal');
      dlg.body.append(keyRow);
      if (entry && placeholderUrl) {
        dlg.body.append(field('pd-url', '接口地址', urlInput, el('div', 'pd-hint', preset.description || '把地址里的占位符换成你自己的值。')));
      } else if (entry) {
        const more = el('details', 'pd-more');
        more.append(el('summary', '', '接口地址'), field('pd-url', '接口地址', urlInput, el('div', 'pd-hint', '一般不用改。')));
        dlg.body.append(more);
      }
    }

    const error = el('div', 'pd-status is-error');
    error.setAttribute('role', 'alert');
    dlg.body.append(error);

    const save = () => {
      const name = (entry ? entry.name : nameInput.value).trim();
      const baseUrl = normalizeBaseUrl(urlInput.value.trim() || (preset ? preset.baseUrl : ''));
      const apiKey = keyInput.value.trim();
      error.textContent = '';
      if (!name) { error.textContent = '请填写名称'; return; }
      if (!baseUrl) { error.textContent = '请填写接口地址'; return; }
      if (/[{<]/.test(baseUrl)) { error.textContent = '请把接口地址里的占位符换成你自己的值。'; return; }
      if (isAccount) { if (!oauthAccountId) { error.textContent = '请先登录'; return; } }
      else if (!apiKey) { error.textContent = '请填写 API Key'; return; }
      const next = {
        id: existing ? existing.id : newId(),
        name,
        presetId: entry ? entry.id : 'custom',
        providerType: preset ? preset.providerType : 'openai_compatible',
        category: preset ? preset.category : '',
        baseUrl,
        apiKey: isAccount ? '' : apiKey,
        oauthAccountId: isAccount ? oauthAccountId : '',
        apiKeyUrl: preset ? preset.apiKeyUrl || '' : '',
      };
      state.aiProviders = existing ? providers().map(p => (p.id === existing.id ? next : p)) : [...providers(), next];
      state.aiProfiles = state.aiProfiles.map(p => (p.providerId === next.id ? { ...copyProvider(p, next), updatedAt: Date.now() } : p));
      persistProviders();
      if (signer) signer.cancel();
      dlg.close();
      changed();
      if (!existing && !modelsOf(next).length) openModelPicker(next);
    };

    if (!existing) dlg.actions.append(button('返回', 'pd-ghost', () => { if (signer) signer.cancel(); back(); }));
    dlg.actions.append(button('取消', '', () => { if (signer) signer.cancel(); dlg.close(); }), button(existing ? '保存' : '添加服务商', 'pd-primary', save));
    (entry ? keyInput : nameInput).focus();
  }

  // -- models

  function fallbackModels(provider) {
    const preset = AI_PROVIDER_MAP[provider.presetId];
    const ids = [...new Set([...(preset && preset.quickModels || []), preset && preset.defaultModel].filter(Boolean))];
    return ids.map(id => ({ id, name: id }));
  }

  async function fetchModels(provider, signal) {
    const config = configFromProfile({ ...copyProvider({ id: '', name: provider.name, model: '' }, provider) });
    if (!config.apiKey && !config.oauthAccountId) throw new Error('missing-api-key');
    if (provider.providerType === 'azure_openai') throw new Error('deployment-models');
    const data = await api('/api/ai/models', { method: 'POST', aiConfig: config, headers: { 'Content-Type': 'application/json' }, body: '{}', signal });
    return (data.models || []).map(m => (typeof m === 'string' ? { id: m, name: m } : { id: m.id, name: m.name || m.id }));
  }

  function newModelProfile(provider, model, isDefault) {
    const now = Date.now();
    return normalizeProfile(copyProvider({
      id: createId('ai'), name: model.name, model: model.id, temperature: 0.7, maxTokens: 2000, isDefault, createdAt: now, updatedAt: now,
    }, provider));
  }

  function openModelPicker(startProvider) {
    const list = providers();
    const dlg = openDialog('添加模型');
    dlg.modal.classList.add('pd-wide');
    if (!list.length) {
      dlg.modal.classList.remove('pd-wide');
      dlg.body.append(el('div', 'pd-empty', '先添加一个服务商，再选择它的模型。'));
      dlg.actions.append(button('取消', '', dlg.close), button('添加服务商', 'pd-primary', () => openProviderPicker()));
      return;
    }
    let provider = startProvider || (list.length === 1 ? list[0] : undefined);
    const picked = new Map();
    let available = [];
    let version = 0;
    let controller;

    const chips = el('div', 'pd-chips');
    chips.setAttribute('role', 'radiogroup');
    chips.setAttribute('aria-label', '服务商');
    const search = input('search', '', '搜索模型…');
    search.className = 'pd-search';
    search.setAttribute('aria-label', '搜索模型');
    const status = el('div', 'pd-status');
    status.setAttribute('role', 'status');
    const listEl = el('div', 'pd-models');
    const manual = el('details', 'pd-more');
    manual.append(el('summary', '', '手动填写模型 ID'));
    const manualId = input('text', '', 'gpt-5.6-luna');
    const manualName = input('text', '', '默认与模型 ID 相同');
    manual.append(field('pd-mid', '模型 ID', manualId), field('pd-mname', '显示名称（可选）', manualName));
    dlg.body.append(chips, search, status, listEl, manual);

    const addBtn = button('', 'pd-primary', () => commit());
    const refresh = () => {
      const n = picked.size + (manualId.value.trim() ? 1 : 0);
      addBtn.textContent = n ? `添加 ${n} 个模型` : '添加模型';
      addBtn.disabled = n === 0 || !provider;
    };
    const exists = id => Boolean(provider) && state.aiProfiles.some(p => p.providerId === provider.id && p.model === id);

    const renderList = () => {
      const q = search.value.trim().toLowerCase();
      const preset = provider ? AI_PROVIDER_MAP[provider.presetId] : null;
      const recommended = preset && preset.defaultModel;
      listEl.textContent = '';
      for (const m of available.filter(m => !q || `${m.name} ${m.id}`.toLowerCase().includes(q))) {
        const isIn = exists(m.id);
        const on = picked.has(m.id);
        const row = press(el('div', `pd-model${on ? ' is-picked' : ''}${isIn ? ' is-added' : ''}`), m.name, () => {
          if (isIn) return;
          if (picked.has(m.id)) picked.delete(m.id); else picked.set(m.id, m);
          renderList(); refresh();
        });
        row.setAttribute('role', 'checkbox');
        row.setAttribute('aria-checked', String(isIn || on));
        if (isIn) row.setAttribute('aria-disabled', 'true');
        const text = el('div', 'pd-model-text');
        text.append(el('div', 'pd-model-name', m.name));
        if (m.name !== m.id) text.append(el('div', 'pd-model-id', m.id));
        row.append(el('span', 'pd-check', isIn || on ? '✓' : ''), text);
        if (recommended && m.id === recommended) row.append(el('span', 'pd-tag', '推荐'));
        if (isIn) row.append(el('span', 'pd-tag', '已添加'));
        listEl.append(row);
      }
    };

    const load = async () => {
      if (controller) controller.abort();
      const my = ++version;
      available = []; picked.clear(); listEl.textContent = ''; refresh();
      status.classList.remove('is-error');
      if (!provider) { status.textContent = '请先在上面选择服务商'; return; }
      controller = new AbortController();
      status.textContent = '正在获取模型列表…';
      try {
        available = await fetchModels(provider, controller.signal);
        if (my !== version) return;
        status.textContent = available.length ? '' : '服务商没有返回任何模型，可以手动填写模型 ID。';
        if (!available.length) manual.open = true;
        renderList();
      } catch (err) {
        if (my !== version || (err && err.name === 'AbortError')) return;
        const reason = err instanceof Error ? err.message : '';
        const retry = press(el('span', 'pd-retry', '刷新模型列表'), '刷新模型列表', () => load());
        manual.open = true;
        const common = fallbackModels(provider);
        if (common.length && reason !== 'missing-api-key') {
          available = common;
          status.textContent = '没能读到最新的模型列表，先列出常用模型。可以刷新重试。 ';
          status.append(retry);
          renderList();
          return;
        }
        status.classList.add('is-error');
        const base = reason === 'missing-api-key' ? '请先填写服务商的 API Key，或手动填写模型 ID。'
          : reason === 'deployment-models' ? '请把 Azure 的部署名称填写为模型 ID。'
            : `获取模型列表失败${reason ? `（${reason}）` : ''}。请检查接口地址、API Key 和网络，然后刷新重试，或手动填写模型 ID。`;
        status.textContent = `${base} `;
        if (reason !== 'missing-api-key' && reason !== 'deployment-models') status.append(retry);
        if (common.length) { available = common; renderList(); }
      }
    };

    const renderChips = () => {
      chips.textContent = '';
      list.forEach(p => {
        const c = press(el('div', `pd-chip${provider && provider.id === p.id ? ' is-on' : ''}`), p.name, () => {
          if (provider && provider.id === p.id) return;
          provider = p; manualId.value = ''; manualName.value = ''; renderChips(); load();
        });
        c.setAttribute('role', 'radio');
        c.setAttribute('aria-checked', String(Boolean(provider && provider.id === p.id)));
        c.append(iconTile(p, 'sm'), el('span', '', p.name));
        chips.append(c);
      });
      if (list.length === 1) chips.hidden = true;
    };

    const commit = () => {
      if (!provider || addBtn.disabled) return;
      const items = [...picked.values()];
      const id = manualId.value.trim();
      if (id && !items.some(m => m.id === id)) items.push({ id, name: manualName.value.trim() || id });
      const fresh = items.filter(m => !exists(m.id));
      if (!fresh.length) return;
      const hasDefault = visibleModels().some(p => p.isDefault);
      const created = fresh.map((m, i) => newModelProfile(provider, m, !hasDefault && i === 0));
      let profiles = [...state.aiProfiles, ...created];
      if (!hasDefault) profiles = profiles.map(p => ({ ...p, isDefault: p.id === created[0].id }));
      // Purposes that still point at an unconfigured placeholder switch to the new default.
      const placeholder = id => { const p = state.aiProfiles.find(x => x.id === id); return !p || !p.providerId; };
      state.aiProfiles = profiles;
      const target = (profiles.find(p => p.isDefault) || created[0]).id;
      for (const key of ['activeAiProfileId', 'translationAiProfileId', 'rewriteAiProfileId', 'agentAiProfileId']) {
        if (placeholder(state[key])) state[key] = target;
      }
      if (controller) controller.abort();
      dlg.close();
      changed();
    };

    search.addEventListener('input', renderList);
    manualId.addEventListener('input', refresh);
    dlg.actions.append(button('取消', '', () => { if (controller) controller.abort(); dlg.close(); }), addBtn);
    renderChips();
    refresh();
    load();
  }

  function openModelEditor(profile) {
    const dlg = openDialog('编辑模型');
    const provider = providerById(profile.providerId);
    const head = el('div', 'pd-head');
    head.append(iconTile(provider || {}, 'md'), el('strong', '', provider ? provider.name : '未知服务商'));
    const nameInput = input('text', profile.name, '显示名称');
    const idInput = input('text', profile.model || '', '模型 ID');
    const error = el('div', 'pd-status is-error');
    error.setAttribute('role', 'alert');
    dlg.body.append(head, field('pd-mname', '显示名称', nameInput, el('div', 'pd-hint', '在界面中显示的模型名称。')),
      field('pd-mid', '模型 ID', idInput, el('div', 'pd-hint', '服务商提供的模型标识，通常是一个不含空格的简短名称。')), error);
    dlg.actions.append(button('取消', '', dlg.close), button('保存', 'pd-primary', () => {
      const name = nameInput.value.trim();
      const model = idInput.value.trim();
      if (!name || !model) { error.textContent = '请填写显示名称和模型 ID'; return; }
      state.aiProfiles = state.aiProfiles.map(p => (p.id === profile.id ? { ...p, name, model, updatedAt: Date.now() } : p));
      dlg.close();
      changed();
    }));
    nameInput.focus();
  }

  // ---- the chat box's model switcher (clipper's model-picker) ----------------------------------------

  function shortModelName(name) {
    const match = /^[^:：]{1,28}(?::\s+|：\s*)(\S.*)$/.exec(String(name || '').trim());
    return match ? match[1] : name;
  }

  function matches(query, profile, provider) {
    const hay = `${profile.name} ${profile.model} ${provider ? provider.name : ''}`.toLowerCase();
    return query.toLowerCase().split(/\s+/).filter(Boolean).every(word => hay.includes(word));
  }

  // Wires an existing trigger button and popover into a searchable, grouped, keyboard-friendly list.
  function bindChatPicker({ trigger, pop, getCurrentId, onSelect, onManage }) {
    pop.hidden = true;
    pop.textContent = '';
    const searchRow = el('div', 'clip-picker-search');
    const search = el('input');
    search.type = 'text';
    search.placeholder = '搜索模型';
    search.setAttribute('aria-label', '搜索模型');
    search.setAttribute('role', 'combobox');
    search.setAttribute('aria-expanded', 'true');
    search.autocomplete = 'off';
    search.spellcheck = false;
    searchRow.innerHTML = icon('search');
    searchRow.append(search);
    const listEl = el('div', 'clip-picker-list');
    listEl.setAttribute('role', 'listbox');
    const footer = el('div', 'clip-picker-footer');
    const manage = el('button', 'clip-picker-manage');
    manage.type = 'button';
    manage.innerHTML = `${icon('plus')}<span>添加或管理服务商</span>`;
    footer.append(manage);
    pop.append(searchRow, listEl, footer);

    let rows = [];
    let rowProfiles = [];
    let active = -1;

    const paintActive = () => {
      rows.forEach((row, i) => row.classList.toggle('is-active', i === active));
      if (rows[active]) rows[active].scrollIntoView({ block: 'nearest' });
    };

    const renderList = () => {
      const query = search.value.trim();
      const currentId = getCurrentId();
      rows = []; rowProfiles = [];
      const children = [];
      for (const provider of providers()) {
        const models = modelsOf(provider).filter(p => matches(query, p, provider));
        if (!models.length) continue;
        const group = el('div', 'clip-picker-group');
        group.setAttribute('role', 'presentation');
        group.append(iconTile(provider, 'sm'), el('span', 'clip-picker-provider', provider.name));
        if (provider.oauthAccountId) group.append(el('span', 'clip-picker-note', '套餐'));
        children.push(group);
        for (const profile of models) {
          const row = el('div', 'clip-picker-row');
          row.setAttribute('role', 'option');
          const selected = profile.id === currentId;
          row.setAttribute('aria-selected', String(selected));
          row.classList.toggle('is-current', selected);
          const mark = el('span', 'clip-picker-check');
          if (selected) mark.innerHTML = icon('check');
          row.append(mark, el('span', 'clip-picker-name', shortModelName(profile.name)));
          row.title = profile.name === profile.model ? profile.name : `${profile.name}\n${profile.model}`;
          const index = rows.length;
          row.addEventListener('mousemove', () => { if (active !== index) { active = index; paintActive(); } });
          row.addEventListener('click', () => choose(profile.id));
          rows.push(row); rowProfiles.push(profile);
          children.push(row);
        }
      }
      if (!children.length) children.push(el('div', 'clip-picker-empty', providers().length ? '没有匹配的模型' : '还没有模型，先添加服务商。'));
      listEl.replaceChildren(...children);
      const currentRow = rows.findIndex(r => r.classList.contains('is-current'));
      active = query ? (rows.length ? 0 : -1) : currentRow;
      paintActive();
    };

    function choose(id) {
      close();
      if (id !== getCurrentId()) onSelect(id);
    }

    function onOutside(event) {
      if (!pop.contains(event.target) && !trigger.contains(event.target)) close();
    }

    function close() {
      if (pop.hidden) return;
      pop.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onOutside, true);
      trigger.focus({ preventScroll: true });
    }

    function open() {
      if (!pop.hidden) return;
      search.value = '';
      pop.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      renderList();
      search.focus({ preventScroll: true });
      document.addEventListener('pointerdown', onOutside, true);
    }

    trigger.addEventListener('click', () => { if (pop.hidden) open(); else close(); });
    search.addEventListener('input', renderList);
    manage.addEventListener('click', () => { close(); onManage(); });
    pop.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (event.isComposing) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!rows.length) return;
        active = (active + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
        paintActive();
      } else if (event.key === 'Enter' && event.target === search) {
        event.preventDefault();
        event.stopPropagation();
        const profile = rowProfiles[active];
        if (profile) choose(profile.id);
      }
    });
    return { open, close, refresh: () => { if (!pop.hidden) renderList(); } };
  }

  window.QMAiSettings = {
    migrate,
    persistProviders,
    render,
    iconTile,
    shortModelName,
    bindChatPicker,
    visibleModels,
    addProvider: openProviderPicker,
    addModel: () => openModelPicker(),
    closeDialog,
    hasDialog: () => Boolean(dialogOpen),
  };
})();

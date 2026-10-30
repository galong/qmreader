const crypto = require('node:crypto');

// Server-side sign-in for AI accounts, modelled on qiaomu clipper's oauth/accounts.ts.
//  - codex / chatgpt: OpenAI's registered redirect is localhost:1455, which a hosted
//    site cannot receive, so the user pastes the address the browser lands on.
//  - openrouter / tokendance: the code is exchanged for an ordinary API key, which
//    goes back to the browser exactly like a pasted key (never stored here).
// Tokens of codex / chatgpt accounts are kept AES-256-GCM encrypted and never leave the server.

const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_REDIRECT = 'http://localhost:1455/auth/callback';
const CODEX_VERSION = '0.159.0';
const SIWC_REDIRECT = 'http://127.0.0.1:1455/auth/callback';
const SIWC_RESOURCE = 'https://api.openai.com/v1';
const SIWC_DIRECT_SCOPE = 'chatgpt.tokens.use.direct';
const SIWC_ISSUER = 'https://auth.openai.com';

const DEFAULT_ENDPOINTS = {
  codexAuthorize: 'https://auth.openai.com/oauth/authorize',
  codexToken: 'https://auth.openai.com/oauth/token',
  siwcAuthorize: 'https://auth.openai.com/api/accounts/authorize',
  siwcToken: 'https://auth.openai.com/api/accounts/oauth/token',
  codexBase: 'https://chatgpt.com/backend-api/codex',
  chatgptBase: 'https://api.openai.com/v1',
  tokendanceAuth: 'https://tokendance.space/auth',
  tokendanceExchange: 'https://tokendance.space/portal/api/v1/auth/keys',
  openrouterAuth: 'https://openrouter.ai/auth',
  openrouterExchange: 'https://openrouter.ai/api/v1/auth/keys',
};

const KINDS = ['codex', 'chatgpt', 'openrouter', 'tokendance'];
const ACCOUNT_KINDS = new Set(['codex', 'chatgpt']);
const PENDING_TTL_MS = 10 * 60 * 1000;
const PENDING_MAX = 500;
const REFRESH_MARGIN_MS = 3 * 60 * 1000;
const APP_URL = 'https://github.com/joeseesun/qmreader';

function fail(message, statusCode = 400, extra = {}) {
  return Object.assign(new Error(message), { statusCode }, extra);
}

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function randomString(bytes) {
  return b64url(crypto.randomBytes(bytes));
}

function pkcePair() {
  const verifier = randomString(48);
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) };
}

function jwtClaims(token) {
  try {
    const part = String(token || '').split('.')[1];
    return part ? JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) : {};
  } catch {
    return {};
  }
}

function stableHostId(userId) {
  const hex = crypto.createHash('sha256').update(`qmreader:siwc:${userId}`).digest('hex').slice(0, 32);
  return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function createAiOAuth({ store, secretBox, fetchImpl = globalThis.fetch, env = process.env, endpoints = {}, now = Date.now } = {}) {
  const urls = { ...DEFAULT_ENDPOINTS, ...endpoints };
  const pending = new Map();
  const refreshing = new Map();

  const enabled = () => String(env.AI_OAUTH_ENABLED || '').trim() === '1';

  function status() {
    const on = enabled();
    const storage = Boolean(secretBox && secretBox.available);
    return {
      enabled: on,
      storage,
      kinds: {
        codex: on && storage,
        chatgpt: on && storage,
        openrouter: on,
        tokendance: on,
      },
    };
  }

  function assertKind(kind) {
    if (!KINDS.includes(kind)) throw fail('不支持的登录方式');
    const state = status();
    if (!state.enabled) throw fail('服务器未开启账号登录功能', 403);
    if (!state.kinds[kind]) throw fail('服务器未配置凭证加密密钥，无法保存登录凭证', 503);
  }

  function prunePending() {
    const t = now();
    for (const [key, item] of pending) if (item.expires <= t) pending.delete(key);
    while (pending.size >= PENDING_MAX) pending.delete(pending.keys().next().value);
  }

  async function postToken(url, body, label) {
    const json = typeof body !== 'string';
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': json ? 'application/json' : 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: json ? JSON.stringify(body) : body,
        signal: AbortSignal.timeout(20000),
      });
    } catch (error) {
      throw fail(`${label}失败：网络不可达`, 502);
    }
    const text = await response.text();
    let data = {};
    try { data = JSON.parse(text); } catch { /* keep raw text for the message */ }
    if (!response.ok) {
      const reason = data.error_description || (data.error && data.error.message) || (typeof data.error === 'string' ? data.error : '') || text.slice(0, 160);
      throw fail(`${label}失败（${response.status}）${reason ? `：${String(reason).slice(0, 160)}` : ''}`, response.status === 429 ? 429 : 400, { upstreamStatus: response.status });
    }
    return data;
  }

  function buildCredentials(kind, tok, base = {}) {
    const id = jwtClaims(tok.id_token);
    const authId = id['https://api.openai.com/auth'] || {};
    const accessClaims = jwtClaims(tok.access_token);
    const authAccess = accessClaims['https://api.openai.com/auth'] || {};
    const lifetime = Number(tok.expires_in) || (accessClaims.exp ? accessClaims.exp - now() / 1000 : 3600);
    return {
      kind,
      clientId: base.clientId || '',
      access: tok.access_token,
      refresh: tok.refresh_token || base.refresh || '',
      idToken: tok.id_token || base.idToken || '',
      expires: now() + lifetime * 1000,
      accountId: authId.chatgpt_account_id || authAccess.chatgpt_account_id || base.accountId || '',
      email: id.email || base.email || '',
      plan: authId.chatgpt_plan_type || authAccess.chatgpt_plan_type || base.plan || '',
    };
  }

  function start(kind, { userId, origin } = {}) {
    assertKind(kind);
    if (!userId) throw fail('请先登录', 401);
    prunePending();
    const { verifier, challenge } = pkcePair();
    const state = randomString(24);
    const item = { kind, userId, verifier, expires: now() + PENDING_TTL_MS };
    let authUrl;
    let mode = 'paste';
    let redirect;
    if (kind === 'codex') {
      redirect = CODEX_REDIRECT;
      authUrl = `${urls.codexAuthorize}?${new URLSearchParams({
        response_type: 'code', client_id: CODEX_CLIENT_ID, redirect_uri: redirect,
        scope: 'openid profile email offline_access api.connectors.read api.connectors.invoke',
        code_challenge: challenge, code_challenge_method: 'S256',
        id_token_add_organizations: 'true', codex_cli_simplified_flow: 'true', state, originator: 'codex_cli_rs',
      })}`;
    } else if (kind === 'chatgpt') {
      redirect = SIWC_REDIRECT;
      item.nonce = randomString(18);
      authUrl = `${urls.siwcAuthorize}?${new URLSearchParams({
        client_id: 'dynamic_agent_client', agent_name_hint: 'qmreader', ext_agent_host_id: stableHostId(userId),
        response_type: 'code', redirect_uri: redirect, resource: SIWC_RESOURCE,
        scope: `openid profile email offline_access resource.invoke ${SIWC_DIRECT_SCOPE}`,
        state, nonce: item.nonce, code_challenge: challenge, code_challenge_method: 'S256',
      })}`;
    } else {
      const base = String(origin || '').replace(/\/+$/, '');
      if (!/^https:\/\//.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) {
        throw fail('无法确定站点公开地址，请设置 AI_OAUTH_PUBLIC_URL');
      }
      mode = 'redirect';
      redirect = `${base}/api/ai/oauth/callback`;
      const common = { callback_url: redirect, code_challenge: challenge, code_challenge_method: 'S256' };
      authUrl = kind === 'openrouter'
        ? `${urls.openrouterAuth}?${new URLSearchParams({ ...common, key_label: 'QMReader', state })}`
        : `${urls.tokendanceAuth}?${new URLSearchParams({ ...common, app_url: APP_URL, key_name: 'QMReader', state })}`;
    }
    item.redirect = redirect;
    pending.set(state, item);
    return { kind, mode, authUrl, redirect, expiresInMs: PENDING_TTL_MS };
  }

  function parseCallback(raw, redirect) {
    let url;
    try { url = new URL(String(raw || '').trim()); } catch { throw fail('粘贴的内容不是有效网址'); }
    const expected = new URL(redirect);
    if (url.origin !== expected.origin || url.pathname !== expected.pathname) throw fail('这个地址不是登录完成后的跳转地址，请检查后重新粘贴');
    return url;
  }

  async function finish({ kind, callbackUrl, state: givenState } = {}, { userId } = {}) {
    let state = givenState;
    let rawUrl = callbackUrl;
    if (!state) {
      try { state = new URL(String(callbackUrl || '').trim()).searchParams.get('state') || ''; } catch { state = ''; }
    }
    if (!kind && pending.has(state)) kind = pending.get(state).kind;
    assertKind(kind);
    const item = pending.get(String(state || ''));
    if (!item || item.expires <= now() || item.kind !== kind || item.userId !== userId) throw fail('登录请求已过期或不匹配，请重新开始');
    pending.delete(state);
    const back = parseCallback(rawUrl, item.redirect);
    const code = back.searchParams.get('code');
    if (!code) throw fail(back.searchParams.get('error_description') || '登录没有完成');

    if (kind === 'openrouter' || kind === 'tokendance') {
      const label = kind === 'openrouter' ? 'OpenRouter' : '词元跳动';
      const data = await postToken(kind === 'openrouter' ? urls.openrouterExchange : urls.tokendanceExchange,
        { code, code_verifier: item.verifier, code_challenge_method: 'S256' }, `授权${label}`);
      if (typeof data.key !== 'string' || !data.key) throw fail(`${label}没有返回 Key，请重新授权`, 502);
      return { kind, label, apiKey: data.key };
    }

    let credentials;
    if (kind === 'codex') {
      const tok = await postToken(urls.codexToken, new URLSearchParams({
        grant_type: 'authorization_code', code, redirect_uri: CODEX_REDIRECT, client_id: CODEX_CLIENT_ID, code_verifier: item.verifier,
      }).toString(), '登录 Codex');
      if (!tok.access_token || !tok.refresh_token) throw fail('Codex 没有返回登录凭证', 502);
      credentials = buildCredentials('codex', tok, { clientId: CODEX_CLIENT_ID });
    } else {
      const clientId = String(back.searchParams.get('client_id') || '').trim();
      if (!clientId) throw fail('OpenAI 没有完成应用注册，请重试');
      const tok = await postToken(urls.siwcToken, new URLSearchParams({
        grant_type: 'authorization_code', client_id: clientId, code, code_verifier: item.verifier, redirect_uri: SIWC_REDIRECT, resource: SIWC_RESOURCE,
      }).toString(), '登录 ChatGPT');
      if (!tok.access_token || !tok.refresh_token || !tok.id_token) throw fail('OpenAI 没有返回登录凭证', 502);
      const id = jwtClaims(tok.id_token);
      const aud = Array.isArray(id.aud) ? id.aud : [id.aud];
      if (String(id.iss || '').replace(/\/$/, '') !== SIWC_ISSUER || !aud.includes(clientId) || id.nonce !== item.nonce) throw fail('登录凭证校验未通过，请重试');
      if (!String(tok.scope || '').split(/\s+/).includes(SIWC_DIRECT_SCOPE)) throw fail('这个 ChatGPT 账号暂不支持通过 API 使用套餐额度');
      credentials = buildCredentials('chatgpt', tok, { clientId });
    }

    const label = credentials.email || (kind === 'codex' ? 'Codex' : 'ChatGPT');
    const saved = store.saveAiOAuthAccount({
      userId, kind, label, email: credentials.email, plan: credentials.plan,
      secret: secretBox.encrypt(credentials), expiresAt: credentials.expires,
    });
    return { kind, label, account: publicAccount(saved) };
  }

  function publicAccount(row) {
    return {
      id: row.id, kind: row.kind, label: row.label, email: row.email || '', plan: row.plan || '',
      expiresAt: row.expires_at || row.expiresAt || 0,
    };
  }

  function listAccounts(userId) {
    return store.listAiOAuthAccounts(userId).map(publicAccount);
  }

  function removeAccount(id, userId) {
    return store.deleteAiOAuthAccount(id, userId);
  }

  async function refresh(row, credentials) {
    let tok;
    try {
      tok = credentials.kind === 'codex'
        ? await postToken(urls.codexToken, { client_id: credentials.clientId || CODEX_CLIENT_ID, grant_type: 'refresh_token', refresh_token: credentials.refresh, scope: 'openid profile email' }, '刷新 Codex 登录')
        : await postToken(urls.siwcToken, new URLSearchParams({ grant_type: 'refresh_token', client_id: credentials.clientId, refresh_token: credentials.refresh, resource: SIWC_RESOURCE }).toString(), '刷新 ChatGPT 登录');
    } catch (error) {
      if (error.upstreamStatus === 400 || error.upstreamStatus === 401) {
        throw fail(`${credentials.kind === 'codex' ? 'Codex' : 'ChatGPT'} 登录已过期，请在 AI 设置里重新登录`, 401);
      }
      throw error;
    }
    if (!tok.access_token) throw fail('刷新登录失败', 502);
    const next = buildCredentials(credentials.kind, tok, credentials);
    store.updateAiOAuthSecret(row.id, secretBox.encrypt(next), next.expires);
    return next;
  }

  // The bearer a request should carry, renewed when about to expire. Refresh tokens
  // rotate, so concurrent requests for one account share a single refresh.
  async function resolveAccess(accountId, userId) {
    if (!status().enabled) throw fail('服务器未开启账号登录功能', 403);
    const row = store.getAiOAuthAccount(accountId, userId);
    if (!row) throw fail('这个登录账号不存在或已被移除，请在 AI 设置里重新登录', 401);
    const credentials = secretBox.decrypt(row.secret);
    let live = credentials;
    if (credentials.expires - now() <= REFRESH_MARGIN_MS) {
      if (!refreshing.has(row.id)) {
        refreshing.set(row.id, refresh(row, credentials).finally(() => refreshing.delete(row.id)));
      }
      live = await refreshing.get(row.id);
    }
    return {
      kind: live.kind,
      access: live.access,
      accountId: live.accountId,
      base: live.kind === 'codex' ? urls.codexBase : urls.chatgptBase,
    };
  }

  // A key obtained through the redirect page waits here, single use, so it is never written into a page.
  const results = new Map();
  function stash(userId, data) {
    const t = now();
    for (const [key, item] of results) if (item.expires <= t) results.delete(key);
    const id = randomString(18);
    results.set(id, { userId, data, expires: t + 2 * 60 * 1000 });
    return id;
  }
  function claim(id, userId) {
    const item = results.get(String(id || ''));
    results.delete(String(id || ''));
    if (!item || item.expires <= now() || item.userId !== userId) throw fail('授权结果已过期，请重新授权');
    return item.data;
  }

  return { stash, claim, status, start, finish, listAccounts, removeAccount, resolveAccess, publicAccount, CODEX_VERSION, ACCOUNT_KINDS, urls };
}

module.exports = { createAiOAuth, jwtClaims, pkcePair, CODEX_VERSION, CODEX_CLIENT_ID, DEFAULT_ENDPOINTS };

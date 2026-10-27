// Wire formats beyond OpenAI-chat and Anthropic-messages, aligned with qiaomu clipper's chat-llm.ts:
// Gemini generateContent, Azure OpenAI deployments and the Responses API used by ChatGPT / Codex accounts.

const CODEX_VERSION = '0.159.0';

function textOf(content) {
  return String(content == null ? '' : content);
}

function splitMessages(body) {
  const messages = Array.isArray(body && body.messages) ? body.messages : [];
  const system = messages
    .filter(m => m && m.role === 'system' && m.content)
    .map(m => textOf(m.content).trim())
    .filter(Boolean)
    .join('\n\n');
  const turns = messages
    .filter(m => m && m.role !== 'system' && m.content)
    .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', text: textOf(m.content) }));
  return { system, turns: turns.length ? turns : [{ role: 'user', text: 'ping' }] };
}

// ---- Gemini ---------------------------------------------------------------

function geminiUrl(config) {
  const base = config.baseUrl.replace(/\/+$/, '');
  if (/:generateContent$/i.test(base)) return base.replace('{model-id}', encodeURIComponent(config.model));
  const root = /\/models$/i.test(base) ? base.replace(/\/models$/i, '') : base;
  return `${root}/models/${encodeURIComponent(config.model)}:generateContent`;
}

function geminiModelsUrl(config) {
  const base = config.baseUrl.replace(/\/+$/, '').replace(/\/models\/[^/]*$/i, '').replace(/\/models$/i, '');
  return `${base}/models?pageSize=1000`;
}

function geminiPayload(config, body) {
  const { system, turns } = splitMessages(body);
  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: turns.map(t => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.text }] })),
    generationConfig: {
      temperature: body.temperature === undefined ? config.temperature : body.temperature,
      maxOutputTokens: body.max_tokens || config.maxTokens,
    },
  };
}

function geminiResult(data) {
  const candidate = data && Array.isArray(data.candidates) ? data.candidates[0] : null;
  const parts = candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  return {
    content: parts.map(p => (p && typeof p.text === 'string' ? p.text : '')).join(''),
    finishReason: String(candidate && candidate.finishReason || '').toLowerCase(),
  };
}

function geminiModelIds(data) {
  return (Array.isArray(data && data.models) ? data.models : [])
    .filter(m => m && Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
    .map(m => String(m.name || '').replace(/^models\//, ''))
    .filter(Boolean);
}

// ---- Azure OpenAI -----------------------------------------------------------

function azureUrl(baseUrl, deployment) {
  return String(baseUrl).replace('{deployment-id}', encodeURIComponent(deployment));
}

// ---- Responses (ChatGPT / Codex accounts) --------------------------------------

function responsesHeaders(auth) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    Authorization: `Bearer ${auth.access}`,
  };
  if (auth.kind === 'codex') {
    if (auth.accountId) headers['chatgpt-account-id'] = auth.accountId;
    headers['OpenAI-Beta'] = 'responses=experimental';
    headers.originator = 'codex_cli_rs';
    headers.version = CODEX_VERSION;
  }
  return headers;
}

function responsesPayload(config, body) {
  const { system, turns } = splitMessages(body);
  return {
    model: config.model,
    instructions: system || 'You are a helpful assistant.',
    input: turns.map(t => ({
      type: 'message',
      role: t.role,
      content: [{ type: t.role === 'assistant' ? 'output_text' : 'input_text', text: t.text }],
    })),
    store: false,
    stream: true,
  };
}

function responsesUrl(auth) {
  return `${auth.base.replace(/\/+$/, '')}/responses`;
}

function responsesModelsRequest(auth) {
  const headers = { Accept: 'application/json', Authorization: `Bearer ${auth.access}` };
  if (auth.kind !== 'codex') return { url: `${auth.base}/models`, headers };
  if (auth.accountId) headers['chatgpt-account-id'] = auth.accountId;
  headers.originator = 'codex_cli_rs';
  return { url: `${auth.base}/models?client_version=${CODEX_VERSION}`, headers };
}

function responsesModelIds(data) {
  const entries = Array.isArray(data && data.models) ? data.models : (Array.isArray(data && data.data) ? data.data : []);
  const ids = [];
  for (const entry of entries) {
    const id = entry && (entry.slug || entry.id);
    if (typeof id !== 'string' || !id || (entry.visibility && entry.visibility !== 'list')) continue;
    ids.push(id);
  }
  return ids;
}

// Read a complete SSE body. Returns the text and the terminal status.
function parseResponsesStream(raw) {
  let text = '';
  let completedText = '';
  let status = '';
  for (const line of String(raw || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let event;
    try { event = JSON.parse(payload); } catch { continue; }
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') text += event.delta;
    else if (event.type === 'response.completed') {
      status = 'completed';
      const output = event.response && Array.isArray(event.response.output) ? event.response.output : [];
      completedText = output.flatMap(item => (Array.isArray(item && item.content) ? item.content : []))
        .map(part => (part && part.type === 'output_text' && typeof part.text === 'string' ? part.text : ''))
        .join('');
    } else if (event.type === 'response.incomplete') {
      status = `incomplete:${event.response && event.response.incomplete_details && event.response.incomplete_details.reason || ''}`;
    } else if (event.type === 'response.failed' || event.type === 'error') {
      const err = event.response && event.response.error ? event.response.error : event.error || event;
      status = `failed:${String(err && (err.message || err.code) || 'unknown').slice(0, 160)}`;
    }
  }
  return { content: text || completedText, status };
}

module.exports = {
  CODEX_VERSION,
  azureUrl,
  geminiModelIds,
  geminiModelsUrl,
  geminiPayload,
  geminiResult,
  geminiUrl,
  parseResponsesStream,
  responsesHeaders,
  responsesModelIds,
  responsesModelsRequest,
  responsesPayload,
  responsesUrl,
};

const BASE_URL = 'https://api.qiaomu.ai/podscribe/v1';
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const searchCache = new Map();

function validSlug(value) {
  return typeof value === 'string' && value.length <= 180 && SLUG.test(value);
}

async function request(path, { fetchImpl = fetch } = {}) {
  let response;
  try {
    response = await fetchImpl(`${BASE_URL}${path}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    const error = new Error('播客文稿服务暂时无法连接，请稍后重试');
    error.statusCode = 503;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(response.status === 404 ? '未找到这期播客或源文稿' : '播客文稿服务暂时不可用');
    error.statusCode = response.status === 404 ? 404 : 502;
    throw error;
  }
  const size = Number(response.headers.get('content-length') || 0);
  if (size > 8 * 1024 * 1024) throw new Error('源文稿过大');
  const body = await response.text();
  if (body.length > 8 * 1024 * 1024) throw new Error('源文稿过大');
  const result = JSON.parse(body);
  if (!result.ok) {
    const error = new Error(result.error?.message || '播客文稿服务返回错误');
    error.statusCode = 502;
    throw error;
  }
  return result;
}

async function search(query, options) {
  const q = String(query || '').trim();
  if (!q || q.length > 200) {
    const error = new Error('搜索词长度须为 1 到 200 字');
    error.statusCode = 400;
    throw error;
  }
  const cacheKey = q.toLocaleLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  let result;
  try { result = await request(`/search?q=${encodeURIComponent(q)}`, options); }
  catch (error) { if (cached) return cached.value; throw error; }
  const { data } = result;
  const value = {
    podcasts: Array.isArray(data.podcasts) ? data.podcasts : [],
    episodes: Array.isArray(data.episodes) ? data.episodes : [],
  };
  if (searchCache.size > 100) searchCache.delete(searchCache.keys().next().value);
  searchCache.set(cacheKey, { value, expiresAt: Date.now() + 2 * 60 * 1000 });
  return value;
}

async function episodes(showSlug, page = 1, options) {
  if (!validSlug(showSlug) || !Number.isInteger(page) || page < 1 || page > 1000) {
    const error = new Error('节目或页码无效');
    error.statusCode = 400;
    throw error;
  }
  let result;
  try {
    result = await request(`/podcasts/${showSlug}/episodes?page=${page}&with_dates=true`, options);
  } catch (error) {
    if (error.statusCode === 400 || error.statusCode === 404) throw error;
    result = await request(`/podcasts/${showSlug}/episodes?page=${page}`, options);
  }
  return { episodes: result.data.episodes || [], pagination: result.meta?.pagination || null };
}

function publishedDate(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(raw)) return null;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function nonnegativeCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

async function transcript(showSlug, episodeSlug, options) {
  if (!validSlug(showSlug) || !validSlug(episodeSlug)) {
    const error = new Error('播客单集标识无效');
    error.statusCode = 400;
    throw error;
  }
  const { data } = await request(`/episodes/${showSlug}/${episodeSlug}/transcript?format=json`, options);
  const segments = data.transcript?.segments;
  if (!Array.isArray(segments) || !segments.length) {
    const error = new Error('这期播客暂无完整源文稿');
    error.statusCode = 404;
    throw error;
  }
  return {
    episode: data.episode,
    podcast: data.podcast,
    transcript: {
      language: data.episode?.language || '',
      wordCount: data.transcript.word_count || 0,
      segments: segments.map(item => ({ start: item.start || '', text: String(item.text || '') })),
    },
  };
}

module.exports = { search, episodes, transcript, validSlug, publishedDate, nonnegativeCount };

/* Bounded read requests. Article reads do not wait for account/catalog requests. */
(function (root) {
  'use strict';
  const PRIMARY = 'https://rss.qiaomu.ai', EDGE = 'https://rss-edge.qiaomu.ai';
  let preferred = PRIMARY, preferredUntil = 0;
  async function requestJson(url, options = {}, dependencies = {}) {
    const fetcher = dependencies.fetch || root.fetch.bind(root);
    const totalMs = options.timeoutMs || 12000;
    const deadline = Date.now() + totalMs;
    const { timeoutMs: _timeout, publicRead, ...rest } = options;
    const retryable = !rest.method || rest.method.toUpperCase() === 'GET';
    const parsed = new URL(url, dependencies.origin || root.location?.origin || 'https://local.invalid');
    const eligible = publicRead === true && retryable && [PRIMARY, EDGE].includes(parsed.origin) &&
      !parsed.username && !parsed.password && !rest.body &&
      /^\/api\/(?:sources|entries|sources\/[\w-]+\/entries|entry\/[\w-]+(?:\/(?:rewrite|translation))?)$/.test(parsed.pathname) &&
      [...parsed.searchParams.keys()].every(key => ['limit', 'cursor', 'source', 'category', 'q', 'ready', 'summary', 'optIn'].includes(key)) &&
      [...new Headers(rest.headers).keys()].every(key => ['accept', 'x-rss-list'].includes(key));
    const first = eligible && preferredUntil > Date.now() ? preferred : parsed.origin;
    const routes = eligible ? [first, first === PRIMARY ? EDGE : PRIMARY] : [];
    for (let attempt = 0; ; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw Error('请求超时，请重试');
      const controller = new AbortController();
      const originalSignal = rest.signal;
      let expired = false, timer;
      const abort = () => controller.abort(originalSignal.reason);
      if (originalSignal?.aborted) abort(); else originalSignal?.addEventListener('abort', abort, { once: true });
      try {
        return await Promise.race([
          (async () => {
            const target = eligible ? routes[attempt] + parsed.pathname + parsed.search : url;
            const response = await fetcher(target, { ...rest, signal: controller.signal,
              ...(eligible ? { credentials: 'omit', mode: 'cors', redirect: 'error' } : {}) });
            if (Number(response.headers?.get('content-length') || 0) > 12000000) throw Error('响应内容过大');
            const text = await response.text();
            if (text.length > 12000000) throw Error('响应内容过大');
            let data;
            try { data = JSON.parse(text); }
            catch { if (!response.ok) throw Object.assign(Error('服务暂时不可用'), { status: response.status }); throw Error('响应内容格式不正确'); }
            if (!response.ok) throw Object.assign(Error(data.error || '服务暂时不可用'), { status: response.status });
            if (eligible) { preferred = routes[attempt]; preferredUntil = Date.now() + 300000; }
            return data;
          })(),
          new Promise((_, reject) => {
            timer = setTimeout(() => { expired = true; controller.abort(); reject(Error('请求超时，请重试')); }, Math.min(remaining, retryable && !attempt ? totalMs / 2 : remaining));
          }),
        ]);
      } catch (error) {
        if (originalSignal?.aborted) throw Object.assign(Error('请求已取消'), { name: 'AbortError' });
        const transient = expired || error instanceof TypeError || [408, 502, 503, 504].includes(error.status);
        if (!retryable || attempt || !transient || Date.now() >= deadline) throw error;
      } finally { clearTimeout(timer); originalSignal?.removeEventListener('abort', abort); }
    }
  }
  root.qmRequestJson = requestJson;
  if (typeof module !== 'undefined') module.exports = { requestJson };
})(typeof window === 'undefined' ? globalThis : window);

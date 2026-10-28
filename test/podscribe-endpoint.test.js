const test = require('node:test');
const assert = require('node:assert/strict');
const podscribe = require('../lib/podscribe');

test('Podscribe uses its public default and a co-located endpoint configured after module loading', async () => {
  const saved = process.env.PODSCRIBE_BASE_URL;
  const urls = [];
  const fetchImpl = async url => {
    urls.push(url);
    return new Response(JSON.stringify({ ok: true, data: { episodes: [] } }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    delete process.env.PODSCRIBE_BASE_URL;
    await podscribe.episodes('fixture-show', 1, { fetchImpl });
    process.env.PODSCRIBE_BASE_URL = 'http://127.0.0.1:5230/v1///';
    await podscribe.episodes('fixture-show', 2, { fetchImpl });
    assert.equal(urls[0], 'https://api.qiaomu.ai/podscribe/v1/podcasts/fixture-show/episodes?page=1&with_dates=true');
    assert.equal(urls[1], 'http://127.0.0.1:5230/v1/podcasts/fixture-show/episodes?page=2&with_dates=true');
  } finally {
    if (saved === undefined) delete process.env.PODSCRIBE_BASE_URL;
    else process.env.PODSCRIBE_BASE_URL = saved;
  }
});

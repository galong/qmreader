const { test } = require('node:test');
const assert = require('node:assert/strict');
function reader() { delete require.cache[require.resolve('../public/request-json')]; return require('../public/request-json').requestJson; }
test('anonymous public reads recover via the alternate host without credentials', async () => {
  const requestJson = reader();
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) throw new TypeError('fetch failed');
    return Response.json({ entry: { id: 'test' } });
  };
  assert.deepEqual(await requestJson('/api/entry/test', { publicRead: true }, { fetch, origin: 'https://rss.qiaomu.ai' }), { entry: { id: 'test' } });
  assert.equal(calls[1].url, 'https://rss-edge.qiaomu.ai/api/entry/test');
  assert.equal(calls[1].options.credentials, 'omit');
});

test('permissions, missing articles and rate limits never use the alternate route', async () => {
  for (const status of [401, 403, 404, 429]) {
    let calls = 0;
    await assert.rejects(reader()('/api/entry/test', { publicRead: true }, {
      origin: 'https://rss.qiaomu.ai', fetch: async () => { calls++; return Response.json({error:'blocked'}, {status}); }
    }));
    assert.equal(calls, 1);
  }
});
test('authenticated, custom, private-query and write requests do not change host', async () => {
  for (const [url, options, origin] of [
    ['/api/entry/test', {publicRead:false}, 'https://rss.qiaomu.ai'],
    ['/api/entry/test', {publicRead:true,headers:{Authorization:'test'}}, 'https://rss.qiaomu.ai'],
    ['/api/entry/test?token=test', {publicRead:true}, 'https://rss.qiaomu.ai'],
    ['/api/entry/test', {publicRead:true}, 'https://custom.example'],
    ['/api/entry/test', {publicRead:true,method:'POST'}, 'https://rss.qiaomu.ai'],
  ]) {
    const calls=[];
    await assert.rejects(reader()(url, options, {origin, fetch:async target => {calls.push(target);throw new TypeError('offline');}}));
    assert.ok(calls.length <= 2);
    assert.ok(calls.every(target => target === url));
    if (options.method) assert.equal(calls.length,1);
  }
});
test('stalled body is aborted before alternate response and caller cancellation cannot recover', async () => {
  let firstSignal;
  const calls=[];
  const result=await reader()('/api/entry/test',{publicRead:true,timeoutMs:80},{origin:'https://rss.qiaomu.ai',fetch:async (url,options)=>{
    calls.push(url);
    if(calls.length===1){firstSignal=options.signal;return {ok:true,headers:new Headers(),text:()=>new Promise(()=>{})};}
    return Response.json({ok:true});
  }});
  assert.deepEqual(result,{ok:true});assert.equal(firstSignal.aborted,true);assert.equal(calls.length,2);
  const controller=new AbortController(); controller.abort();
  let cancelledCalls=0;
  await assert.rejects(reader()('/api/entry/test',{publicRead:true,signal:controller.signal},{origin:'https://rss.qiaomu.ai',fetch:async ()=>{cancelledCalls++;throw new TypeError('abort');}}),{name:'AbortError'});
  assert.equal(cancelledCalls,1);
});

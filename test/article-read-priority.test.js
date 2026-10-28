const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
const helper = source.slice(source.indexOf('function loadEntryExtrasAfterReading('), source.indexOf('async function openEntry(e,'));
function reader() {
 const calls=[]; const r={state:{activeEntry:{id:'a'},articleOpenId:1}};
 for(const name of ['recordEntryView','syncEntryState','loadTranslation','loadAnnotations','loadComments','loadAgentMessages'])r[name]=()=>calls.push(name);
 vm.runInNewContext(helper,r); return {...r,calls};
}
test('article body arrives before account writes or supplementary reads are sent',async()=>{
 const r=reader();let done;const body=new Promise(resolve=>done=resolve);
 r.loadEntryExtrasAfterReading({id:'a'},body,1);assert.equal(r.calls.length,0);
 done({rewrite:{body:'正文'}});await body;await Promise.resolve();assert.equal(r.calls.length,6);
});
test('navigation cancels obsolete supplementary requests, including A to B to A',async()=>{
 const r=reader();let done;const body=new Promise(resolve=>done=resolve);
 r.loadEntryExtrasAfterReading({id:'a'},body,1);r.state.articleOpenId=3;
 done({});await body;await Promise.resolve();assert.equal(r.calls.length,0);
});
test('a failed body request does not permanently disable independent reading features',async()=>{
 const r=reader();let fail;const body=new Promise((_,reject)=>fail=reject);
 r.loadEntryExtrasAfterReading({id:'a'},body,1);fail(Error('offline'));await body.catch(()=>{});await Promise.resolve();assert.equal(r.calls.length,6);
});

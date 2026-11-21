import test from 'node:test';
import assert from 'node:assert/strict';
const {checkCloudflareAccess} = await import('../services/spine-service/access-check.mjs').catch(() => ({}));
const accountId = '0123456789abcdef0123456789abcdef', apiToken = 'fixture-private-token-not-real';
const model = '@cf/black-forest-labs/flux-2-klein-4b';

test('access check makes only two fixed read-only requests and omits private response data', async () => {
  assert.equal(typeof checkCloudflareAccess, 'function');
  const paths = [];
  const report = await checkCloudflareAccess({accountId, apiToken, fetchImpl: async (url, options) => {
    assert.equal(new URL(url).origin, 'https://api.cloudflare.com');
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Authorization, 'Bearer ' + apiToken); assert.equal(options.body, undefined);
    paths.push(new URL(url).pathname);
    return Response.json({success: true, errors: [], result: url.includes('/tokens/verify') ?
      {status: 'active', id: apiToken, extra: accountId} : [{name: model, secret: apiToken}]});
  }});
  assert.deepEqual(paths.sort(), ['/client/v4/accounts/' + accountId + '/ai/models/search', '/client/v4/user/tokens/verify']);
  assert.deepEqual(report, {token: {http: 200, status: 'ACTIVE', codes: []}, workersAI: {http: 200, status: 'OK', codes: [], modelFound: true}});
  assert.equal(JSON.stringify(report).includes(apiToken), false); assert.equal(JSON.stringify(report).includes(accountId), false);
});

test('access check distinguishes active token from account access refusal using numeric codes only', async () => {
  assert.equal(typeof checkCloudflareAccess, 'function');
  const report = await checkCloudflareAccess({accountId, apiToken, fetchImpl: async url => url.includes('/tokens/verify') ?
    Response.json({success: true, errors: [], result: {status: 'active'}}) :
    Response.json({success: false, errors: [{code: 10000, message: apiToken}, {code: apiToken}], result: null}, {status: 403})});
  assert.equal(report.token.status, 'ACTIVE');
  assert.deepEqual(report.workersAI, {http: 403, status: 'REFUSED', codes: [10000], modelFound: null});
  assert.equal(JSON.stringify(report).includes(apiToken), false);
});

test('redirects, oversized bodies and malformed replies do not leak arbitrary provider text', async () => {
  assert.equal(typeof checkCloudflareAccess, 'function');
  for (const response of [() => new Response(apiToken, {status: 302, headers: {Location: 'https://example.com/' + apiToken}}),
    () => new Response('x'.repeat(65537), {headers: {'Content-Type': 'application/json'}}),
    () => new Response('not-json:' + apiToken, {headers: {'Content-Type': 'application/json'}}),
    () => Response.json({success: true, errors: [], result: {status: apiToken}})]) {
    const report = await checkCloudflareAccess({accountId, apiToken, fetchImpl: async () => response()});
    assert.equal(report.token.status, 'UNCONFIRMED');
    assert.equal(JSON.stringify(report).includes(apiToken), false);
  }
});

test('the read-only check has a bounded deadline even when transport ignores abort', async () => {
  assert.equal(typeof checkCloudflareAccess, 'function');
  const report = await checkCloudflareAccess({accountId, apiToken, timeoutMs: 20, fetchImpl: async () => new Promise(() => {})});
  assert.equal(report.token.status, 'UNCONFIRMED'); assert.equal(report.workersAI.status, 'UNCONFIRMED');
  assert.equal(report.token.http, null); assert.equal(report.workersAI.http, null);
});

test('9B preflight searches the selected model and rejects arbitrary model profiles before network',async()=>{
  let calls=0;
  const fetchImpl=async(url,options)=>{
    calls++;assert.equal(options.method,'GET');assert.equal(options.body,undefined);
    if(url.includes('/tokens/verify'))return Response.json({success:true,errors:[],result:{status:'active'}});
    assert.equal(new URL(url).searchParams.get('search'),'flux-2-klein-9b');
    return Response.json({success:true,errors:[],result:[{name:'@cf/black-forest-labs/flux-2-klein-9b'}]});
  };
  const report=await checkCloudflareAccess({accountId,apiToken,profile:'quality-v2-9b',fetchImpl});
  assert.equal(report.workersAI.modelFound,true);assert.equal(calls,2);
  await assert.rejects(checkCloudflareAccess({accountId,apiToken,profile:'arbitrary',fetchImpl}),{code:'SERVICE_CONFIG'});
  assert.equal(calls,2);
});
